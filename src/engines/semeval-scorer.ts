import { debugLog, debugDecision } from "../config/logger";

export type ThresholdMode = "strict" | "balanced" | "high_precision";
export type QuestionId = `Q${number}`;

export interface SemEvalInput {
  triggeredIds: QuestionId[];
  mode: ThresholdMode;
}

export interface SemEvalResult {
  riskScore: number;
  shieldFlags: number;
  activeRiskBuckets: number;
  synergyBonusApplied: boolean;
  bucket1CapApplied: boolean;
  overrideTriggered: "DOUBLE_RED_FLAG" | "HARD_EVIDENCE_VETO" | null;
  failedRiskIds: QuestionId[];
  triggeredShieldIds: QuestionId[];
  route:
    | "ROUTE_1_FAST_CLEAR"
    | "ROUTE_2_SHIELDED_CLEAR"
    | "ROUTE_3_STANCE_VERIFICATION"
    | "ROUTE_4_FORENSIC_THREAT";
  escalateToResearch: boolean;
}

const BUCKET_MAP: Record<number, number[]> = {
  1: [1, 2, 3, 4, 5, 6, 7, 8],
  2: [9, 10, 11, 12, 13, 14, 15, 16, 17],
  3: [18, 19, 20, 21, 22, 23, 24, 25],
  4: [26, 27, 28, 29, 30, 31, 32],
  5: [33, 34, 35, 36, 37, 38],
  6: [39, 40, 41, 42, 43, 44],
};

const TIER_3_QUESTIONS = new Set([8, 10, 16, 17, 18, 19, 25, 26, 27, 37, 38, 41, 44]);
const TIER_1_QUESTIONS = new Set([1, 2, 3, 4, 5, 6, 7, 39, 40, 42, 43]);
const DOUBLE_WEIGHT_SHIELDS = new Set([46, 47, 49]);

const MODE_THRESHOLDS: Record<ThresholdMode, { base: number; shielded: number }> = {
  strict: { base: 5, shielded: 7 },
  balanced: { base: 7, shielded: 10 },
  high_precision: { base: 10, shielded: 13 },
};

export function evaluateSemEvalBitmask(input: SemEvalInput): SemEvalResult {
  const activeNums = new Set(
    input.triggeredIds.filter(id => /^Q([1-9]|[1-4][0-9]|50)$/.test(id)).map((id) => Number(id.slice(1)))
  );

  const failedRiskIds: QuestionId[] = [];
  const triggeredShieldIds: QuestionId[] = [];

  const bucketPoints: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let tier3Count = 0;
  let shieldFlags = 0;

  for (const qNum of activeNums) {
    if (qNum >= 1 && qNum <= 44) {
      failedRiskIds.push(`Q${qNum}`);
      const pts = TIER_3_QUESTIONS.has(qNum) ? 3 : TIER_1_QUESTIONS.has(qNum) ? 1 : 2;
      if (pts === 3) tier3Count++;

      for (const [bId, qList] of Object.entries(BUCKET_MAP)) {
        if (qList.includes(qNum)) {
          bucketPoints[Number(bId)] = (bucketPoints[Number(bId)] ?? 0) + pts;
          break;
        }
      }
    } else if (qNum >= 45 && qNum <= 50) {
      triggeredShieldIds.push(`Q${qNum}`);
      shieldFlags += DOUBLE_WEIGHT_SHIELDS.has(qNum) ? 2 : 1;
    }
  }

  const activeBuckets = Object.entries(bucketPoints).filter(([_, pts]) => pts > 0);
  const activeRiskBuckets = activeBuckets.length;

  let bucket1CapApplied = false;
  if (activeRiskBuckets === 1 && (bucketPoints[1] ?? 0) > 3) {
    bucketPoints[1] = 3;
    bucket1CapApplied = true;
  }

  let riskScore = Object.values(bucketPoints).reduce((sum, val) => sum + val, 0);

  const synergyBonusApplied = activeRiskBuckets >= 3;
  if (synergyBonusApplied) {
    riskScore += 2;
  }

  let { base: baseThreshold, shielded: shieldedThreshold } = MODE_THRESHOLDS[input.mode];
  let overrideTriggered: SemEvalResult["overrideTriggered"] = null;

  if (activeNums.has(48) && activeNums.has(49)) {
    overrideTriggered = "HARD_EVIDENCE_VETO";
    baseThreshold = Math.max(baseThreshold, 12);
    shieldedThreshold = Math.max(shieldedThreshold, 12);
  }

  const doubleRedFlag = tier3Count >= 2 && shieldFlags === 0 && riskScore >= 6;
  if (doubleRedFlag) {
    overrideTriggered = "DOUBLE_RED_FLAG";
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
    baseThreshold,
    shieldedThreshold,
    overrideTriggered,
  });

  let result: SemEvalResult;

  if (doubleRedFlag) {
    result = {
      riskScore,
      shieldFlags,
      activeRiskBuckets,
      synergyBonusApplied,
      bucket1CapApplied,
      overrideTriggered,
      failedRiskIds,
      triggeredShieldIds,
      route: "ROUTE_4_FORENSIC_THREAT",
      escalateToResearch: true,
    };
  } else if (riskScore >= shieldedThreshold && shieldFlags >= 2) {
    result = {
      riskScore,
      shieldFlags,
      activeRiskBuckets,
      synergyBonusApplied,
      bucket1CapApplied,
      overrideTriggered,
      failedRiskIds,
      triggeredShieldIds,
      route: "ROUTE_3_STANCE_VERIFICATION",
      escalateToResearch: true,
    };
  } else if (
    (riskScore >= baseThreshold && shieldFlags === 0) ||
    (riskScore >= shieldedThreshold && shieldFlags <= 1)
  ) {
    result = {
      riskScore,
      shieldFlags,
      activeRiskBuckets,
      synergyBonusApplied,
      bucket1CapApplied,
      overrideTriggered,
      failedRiskIds,
      triggeredShieldIds,
      route: "ROUTE_4_FORENSIC_THREAT",
      escalateToResearch: true,
    };
  } else if (riskScore >= 5 && shieldFlags >= 1) {
    result = {
      riskScore,
      shieldFlags,
      activeRiskBuckets,
      synergyBonusApplied,
      bucket1CapApplied,
      overrideTriggered,
      failedRiskIds,
      triggeredShieldIds,
      route: "ROUTE_2_SHIELDED_CLEAR",
      escalateToResearch: false,
    };
  } else {
    result = {
      riskScore,
      shieldFlags,
      activeRiskBuckets,
      synergyBonusApplied,
      bucket1CapApplied,
      overrideTriggered,
      failedRiskIds,
      triggeredShieldIds,
      route: "ROUTE_1_FAST_CLEAR",
      escalateToResearch: false,
    };
  }

  debugDecision("SemEvalScorer", result.route, {
    escalateToResearch: result.escalateToResearch,
    riskScore: result.riskScore,
    shieldFlags: result.shieldFlags,
    override: result.overrideTriggered || "none",
  });

  return result;
}
