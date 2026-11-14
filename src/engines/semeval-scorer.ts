import {
  SEMEVAL_QUESTIONS,
  type QuestionId,
  type QuestionBucket,
} from "../config/semeval-questions";
import { debugLog, debugDecision } from "../config/logger";

export type { QuestionId };
export type ThresholdMode = "strict" | "balanced" | "high_precision";

export interface SemEvalInput {
  triggeredIds: QuestionId[];
  mode: ThresholdMode;
  textLength?: number; // Optional: text length for adaptive thresholding
}

export interface SemEvalResult {
  riskScore: number;
  shieldFlags: number;
  activeRiskBuckets: number;
  synergyBonusApplied: boolean;
  bucket1CapApplied: boolean;
  overrideTriggered: "DOUBLE_RED_FLAG" | "TIER_3_ESCALATION" | "GATEKEEPER_ESCALATION" | null;
  failedRiskIds: QuestionId[];
  triggeredShieldIds: QuestionId[];
  route:
    | "ROUTE_1_FAST_CLEAR"
    | "ROUTE_2_SHIELDED_CLEAR"
    | "ROUTE_3_STANCE_VERIFICATION"
    | "ROUTE_4_FORENSIC_THREAT";
  escalateToHydrogen: boolean;
}

const BUCKET_RISK_MAP: Record<"EMOTION" | "IDENTITY_AUTHORITY" | "FALLACY_DEFLECTION" | "SEVERE_MANIPULATION", number[]> = {
  EMOTION: [1, 2, 3, 4],
  IDENTITY_AUTHORITY: [5, 6, 7, 8, 9],
  FALLACY_DEFLECTION: [10, 11, 12, 13],
  SEVERE_MANIPULATION: [14, 15, 16, 17, 18, 19],
};

/**
 * Gate thresholds for SemEval scoring:
 * Gate threshold is 1 for strict and balanced, 2 for high_precision.
 */
function getGateThreshold(mode: ThresholdMode, textLength: number): number {
  switch (mode) {
    case "strict":
      return 1;
    case "balanced":
      return 1;
    case "high_precision":
      return 2;
  }
}

export function evaluateSemEvalBitmask(input: SemEvalInput): SemEvalResult {
  const failedRiskIds: QuestionId[] = [];
  const triggeredShieldIds: QuestionId[] = [];

  const bucketPoints: Record<"EMOTION" | "IDENTITY_AUTHORITY" | "FALLACY_DEFLECTION" | "SEVERE_MANIPULATION", number> = {
    EMOTION: 0,
    IDENTITY_AUTHORITY: 0,
    FALLACY_DEFLECTION: 0,
    SEVERE_MANIPULATION: 0,
  };

  let tier3Count = 0;
  let shieldFlags = 0;
  let emotionCount = 0;

  for (const id of input.triggeredIds) {
    const q = SEMEVAL_QUESTIONS[id];
    if (!q) continue;

    if (!q.isShield) {
      failedRiskIds.push(id);
      const pts = q.pointsOrFlags;
      if (q.tier === 3) tier3Count++;
      if (q.bucket === "EMOTION") emotionCount++;

      if (q.bucket in bucketPoints) {
        bucketPoints[q.bucket as keyof typeof bucketPoints] += pts;
      }
    } else {
      triggeredShieldIds.push(id);
      shieldFlags += q.pointsOrFlags;
    }
  }

  const activeBuckets = Object.entries(bucketPoints).filter(([_, pts]) => pts > 0);
  const activeRiskBuckets = activeBuckets.length;

  // Bucket 1 single-bucket emotional cap:
  // (max 3 pts when ONLY a single Q1-Q4 question fires)
  let bucket1CapApplied = false;
  if (activeRiskBuckets === 1 && bucketPoints.EMOTION > 3 && emotionCount === 1) {
    bucketPoints.EMOTION = 3;
    bucket1CapApplied = true;
  }

  let riskScore = Object.values(bucketPoints).reduce((sum, val) => sum + val, 0);

  // Cross-Bucket Synergy bonus: +2 pts when >= 3 distinct risk buckets fire
  const synergyBonusApplied = activeRiskBuckets >= 3;
  if (synergyBonusApplied) {
    riskScore += 2;
  }

  const textLength = input.textLength ?? 100;
  const gateThreshold = getGateThreshold(input.mode, textLength);
  let overrideTriggered: SemEvalResult["overrideTriggered"] = null;

  if (tier3Count >= 2 && shieldFlags === 0) {
    overrideTriggered = "DOUBLE_RED_FLAG";
  } else if (tier3Count >= 1) {
    overrideTriggered = "TIER_3_ESCALATION";
  }

  // ---------------------------------------------------------------------------
  // High-Recall Gatekeeper Cutoff
  // - Escalate whenever riskScore >= gateThreshold OR failedRiskIds.length >= 1 OR tier3Count >= 1
  // - Non-S4 shield (S1, S2, S3) fired while riskScore > 0 escalates for stance verification
  // ---------------------------------------------------------------------------
  const hasNonS4Shield = triggeredShieldIds.some((s) => s === "S1" || s === "S2" || s === "S3");

  const shouldEscalate =
    riskScore >= gateThreshold ||
    failedRiskIds.length >= 1 ||
    tier3Count >= 1 ||
    (hasNonS4Shield && riskScore > 0);

  if (shouldEscalate && !overrideTriggered) {
    overrideTriggered = "GATEKEEPER_ESCALATION";
  }

  let route: SemEvalResult["route"];
  let escalateToHydrogen = false;

  if (shouldEscalate) {
    escalateToHydrogen = true;
    if (shieldFlags > 0) {
      // High risk + shields -> Stage 2 (Gemini/Hydrogen) verifies stance/context
      route = "ROUTE_3_STANCE_VERIFICATION";
    } else {
      // High risk without shields -> Forensics threat
      route = "ROUTE_4_FORENSIC_THREAT";
    }
  } else {
    // Only allow S4 (Everyday Consumer/Sports Venting) to clear locally
    // when riskScore === 0 AND zero Tier-3 questions fired
    if (triggeredShieldIds.includes("S4") && riskScore === 0 && tier3Count === 0) {
      route = "ROUTE_2_SHIELDED_CLEAR";
      escalateToHydrogen = false;
    } else {
      route = "ROUTE_1_FAST_CLEAR";
      escalateToHydrogen = false;
    }
  }

  debugLog("SemEvalScorer", "Evaluating SemEval Bitmask", {
    mode: input.mode,
    failedRiskIds,
    triggeredShieldIds,
    tier3Count,
    shieldFlags,
    bucketPoints,
    activeRiskBuckets,
    bucket1CapApplied,
    synergyBonusApplied,
    riskScore,
    gateThreshold,
    textLength,
    shouldEscalate,
    overrideTriggered,
  });

  debugDecision("SemEvalScorer", `🎯 ${route}`, {
    escalateToHydrogen,
    riskScore,
    shieldFlags,
    override: overrideTriggered ?? "none",
  });

  return {
    riskScore,
    shieldFlags,
    activeRiskBuckets,
    synergyBonusApplied,
    bucket1CapApplied,
    overrideTriggered,
    failedRiskIds,
    triggeredShieldIds,
    route,
    escalateToHydrogen,
  };
}
