import { debugLog } from "../config/logger";
import { SEMEVAL_QUESTIONNAIRE } from "../config/semeval-questions";

export type QuestionId = `Q${number}`;
export type ThresholdMode = "strict" | "balanced" | "high_precision";

export interface SemEvalEvaluationInput {
  triggeredQuestionIds?: QuestionId[];
  triggeredIds?: QuestionId[];
  mode?: ThresholdMode;
}

export interface SemEvalResult {
  score: number;
  riskScore: number;
  shieldFlags: number;
  tier3Count: number;
  activeRiskBuckets: number;
  synergyBonusApplied: boolean;
  bucket1CapApplied: boolean;
  failedRiskIds: QuestionId[];
  triggeredShieldIds: QuestionId[];
  overrideTriggered: "DOUBLE_RED_FLAG" | "TIER_3_ESCALATION" | "HARD_EVIDENCE_VETO" | null;
  route: "ROUTE_1_FAST_CLEAR" | "ROUTE_2_SHIELDED_CLEAR" | "ROUTE_3_STANCE_VERIFICATION" | "ROUTE_4_FORENSIC_THREAT";
  escalateToResearch: boolean;
}

/**
 * High-performance bitmask / multi-tier evaluation engine.
 * Computes bucket points, applies synergy bonuses, checks vetoes and red flags,
 * and routes to the appropriate verification pipeline.
 */
export function evaluateSemEvalBitmask(input: SemEvalEvaluationInput): SemEvalResult {
  const activeIds = input.triggeredQuestionIds || input.triggeredIds || [];
  const activeNums = new Set(
    activeIds
      .map((id) => SEMEVAL_QUESTIONNAIRE[id]?.num)
      .filter((n): n is number => typeof n === "number")
  );

  let failedRiskIds: QuestionId[] = [];
  let triggeredShieldIds: QuestionId[] = [];
  let tier3Count = 0;
  let shieldFlags = 0;

  const bucketPoints: Record<number, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  };

  for (const id of activeIds) {
    const q = SEMEVAL_QUESTIONNAIRE[id];
    if (!q) continue;

    if (q.isShield) {
      triggeredShieldIds.push(id as QuestionId);
      shieldFlags += q.pointsOrFlags;
    } else {
      failedRiskIds.push(id as QuestionId);
      bucketPoints[q.bucket] = (bucketPoints[q.bucket] ?? 0) + q.pointsOrFlags;

      if (q.tier === 3) {
        tier3Count++;
      }
    }
  }

  // Deduplicate
  failedRiskIds = Array.from(new Set(failedRiskIds));
  triggeredShieldIds = Array.from(new Set(triggeredShieldIds));

  // Count active risk buckets (points > 0)
  let activeRiskBuckets = 0;
  for (let b = 1; b <= 6; b++) {
    if ((bucketPoints[b] ?? 0) > 0) {
      activeRiskBuckets++;
    }
  }

  // Check if any structural propaganda bucket (Buckets 2-6) is active
  const hasStructuralRisk =
    (bucketPoints[2] ?? 0) > 0 ||
    (bucketPoints[3] ?? 0) > 0 ||
    (bucketPoints[4] ?? 0) > 0 ||
    (bucketPoints[5] ?? 0) > 0 ||
    (bucketPoints[6] ?? 0) > 0;

  // Cap Bucket 1 at 3 points when it is the only active risk bucket
  let bucket1CapApplied = false;
  if (activeRiskBuckets === 1 && (bucketPoints[1] ?? 0) > 3) {
    bucketPoints[1] = 3;
    bucket1CapApplied = true;
  }

  // Base risk score = sum of bucket points
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
  // - Double Red Flag (tier3Count >= 2, no shields, high risk) -> ROUTE_4_FORENSIC_THREAT (escalate)
  // - Hard Evidence Veto (Q48 receipts + Q49 active debunking) with tier3Count === 0 and moderate risk (<10) -> ROUTE_2_SHIELDED_CLEAR (local clear)
  // - Everyday Personal Venting (Q50) with zero Tier-3 manipulation and <= 2 active risk buckets -> ROUTE_2_SHIELDED_CLEAR (local clear)
  // - Active Debunking & Fact-Checking (Q49) with zero Tier-3 and moderate risk (<= 6) -> ROUTE_2_SHIELDED_CLEAR (local clear)
  // - Severe manipulation (tier3Count >= 1) -> ALWAYS escalates to Stage 2 (ROUTE_3 if shields present, else ROUTE_4)
  // - Structural risk present (Buckets 2-6: ad hominem, fear/prejudice, fallacies, disinformation, intimidation):
  //     - ALWAYS escalates to Stage 2:
  //       - If shields present (e.g. Q45 quotes, Q46 multi-perspective): ROUTE_3_STANCE_VERIFICATION
  //       - If no shields: ROUTE_4_FORENSIC_THREAT
  // - Only Bucket 1 active (Manipulative Wording / Emotive adjectives):
  //     - In balanced mode: riskScore <= 3 clears locally as ROUTE_1_FAST_CLEAR (or ROUTE_2 if shields present)
  //     - In strict mode: riskScore <= 1 clears locally, higher escalates
  // - Zero risk (failedRiskIds.length === 0):
  //     - If shields present: ROUTE_2_SHIELDED_CLEAR (escalateToResearch = false)
  //     - If no shields: ROUTE_1_FAST_CLEAR (escalateToResearch = false)
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
  } else if (activeNums.has(49) && tier3Count === 0 && riskScore <= 6) {
    // Author explicitly fact-checks/debunks the rhetoric with no Tier-3 threats
    route = "ROUTE_2_SHIELDED_CLEAR";
    escalateToResearch = false;
  } else if (tier3Count >= 1) {
    // Tier-3 severe manipulation must always escalate to Stage 2
    escalateToResearch = true;
    route = shieldFlags > 0 ? "ROUTE_3_STANCE_VERIFICATION" : "ROUTE_4_FORENSIC_THREAT";
  } else if (hasStructuralRisk) {
    // Structural propaganda techniques (Buckets 2–6) cannot be cleared locally
    // Quotation (Q45) and journalistic carriers require Stage 2 Stance Verification
    escalateToResearch = true;
    route = shieldFlags > 0 ? "ROUTE_3_STANCE_VERIFICATION" : "ROUTE_4_FORENSIC_THREAT";
  } else if (failedRiskIds.length > 0) {
    // Only Bucket 1 (affective/emotive wording) active
    const isCleanThreshold =
      input.mode === "balanced"
        ? riskScore <= 3
        : riskScore <= 1;

    if (isCleanThreshold) {
      // Below gatekeeper cutoff with no Tier-3 manipulation clears locally
      route = shieldFlags > 0 ? "ROUTE_2_SHIELDED_CLEAR" : "ROUTE_1_FAST_CLEAR";
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

  return {
    score: riskScore,
    riskScore,
    shieldFlags,
    tier3Count,
    activeRiskBuckets,
    synergyBonusApplied,
    bucket1CapApplied,
    failedRiskIds,
    triggeredShieldIds,
    overrideTriggered,
    route,
    escalateToResearch,
  };
}
