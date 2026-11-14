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
  overrideTriggered: "DOUBLE_RED_FLAG" | "HARD_EVIDENCE_VETO" | "TIER_3_ESCALATION" | "GATEKEEPER_ESCALATION" | null;
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

  let overrideTriggered: SemEvalResult["overrideTriggered"] = null;

  if (activeNums.has(48) && activeNums.has(49) && tier3Count === 0) {
    overrideTriggered = "HARD_EVIDENCE_VETO";
  }

  const doubleRedFlag = tier3Count >= 2 && shieldFlags === 0 && riskScore >= 6;
  if (doubleRedFlag) {
    overrideTriggered = "DOUBLE_RED_FLAG";
  } else if (tier3Count >= 1 && !overrideTriggered) {
    overrideTriggered = "TIER_3_ESCALATION";
  }

  // ---------------------------------------------------------------------------
  // High-Confidence Gatekeeper Routing:
  // - Everyday Personal Venting (Q50) with zero Tier-3 manipulation clears locally
  // - Hard Evidence Veto (Q48+Q49) with moderate risk (<10) clears locally
  // - Severe manipulation (tier3Count >= 1) ALWAYS escalates to Stage 2
  // - Risk present: escalates to Stage 2 (Haiku)
  //   - If shields present: ROUTE_3_STANCE_VERIFICATION
  //   - If no shields: ROUTE_4_FORENSIC_THREAT
  // - Zero risk (failedRiskIds == 0): clears locally without API cost
  // ---------------------------------------------------------------------------
  let route: SemEvalResult["route"];
  let escalateToResearch: boolean;

  if (doubleRedFlag) {
    route = "ROUTE_4_FORENSIC_THREAT";
    escalateToResearch = true;
  } else if (overrideTriggered === "HARD_EVIDENCE_VETO" && riskScore < 10) {
    route = "ROUTE_2_SHIELDED_CLEAR";
    escalateToResearch = false;
  } else if (activeNums.has(50) && tier3Count === 0 && activeRiskBuckets <= 2) {
    // Everyday consumer venting (Q50) with no severe manipulation clears locally
    route = "ROUTE_2_SHIELDED_CLEAR";
    escalateToResearch = false;
  } else if (tier3Count >= 1) {
    // Tier-3 severe manipulation must always escalate to Stage 2
    escalateToResearch = true;
    route = shieldFlags > 0 ? "ROUTE_3_STANCE_VERIFICATION" : "ROUTE_4_FORENSIC_THREAT";
  } else if (failedRiskIds.length > 0) {
    if (input.mode === "balanced" && activeRiskBuckets === 1 && (bucketPoints[1] ?? 0) > 0 && riskScore <= 3 && shieldFlags === 0) {
      // Mild emotional language in balanced mode clears locally
      route = "ROUTE_1_FAST_CLEAR";
      escalateToResearch = false;
    } else {
      escalateToResearch = true;
      route = shieldFlags > 0 ? "ROUTE_3_STANCE_VERIFICATION" : "ROUTE_4_FORENSIC_THREAT";
    }
  } else if (shieldFlags > 0) {
    // Zero risk, only shields triggered -> clean
    route = "ROUTE_2_SHIELDED_CLEAR";
    escalateToResearch = false;
  } else {
    // Zero risk, zero shields -> fast clean
    route = "ROUTE_1_FAST_CLEAR";
    escalateToResearch = false;
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
    overrideTriggered,
    route,
    escalateToResearch,
  });

  debugDecision("SemEvalScorer", route, {
    escalateToResearch,
    riskScore,
    shieldFlags,
    override: overrideTriggered || "none",
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
    escalateToResearch,
  };
}
