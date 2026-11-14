import { describe, expect, it } from "bun:test";
import { evaluateSemEvalBitmask } from "../src/engines/semeval-scorer";

describe("SemEval Scorer Engine", () => {
  it("Route 1: Fast Clear for clean or low-risk comments", () => {
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q1"], // 1 pt, balanced threshold is 7
      mode: "balanced",
    });
    expect(result.route).toBe("ROUTE_1_FAST_CLEAR");
    expect(result.escalateToHydrogen).toBe(false);
    expect(result.riskScore).toBe(1);
    expect(result.shieldFlags).toBe(0);
  });

  it("Route 2: Shielded Clear for angry consumer rant with personal venting", () => {
    // Q1 (1), Q2 (1), Q4 (1), Q7 (1) in Bucket 1 -> 4 pts capped to 4?
    // plus Q9 (2) in Bucket 2 -> active buckets = 2, total pts = 1+1+1+1+2 = 6.
    // Q50 (1 shield flag).
    // In balanced mode: base=7, shielded=10. riskScore=6 >= 5 and shieldFlags >= 1 -> ROUTE_2_SHIELDED_CLEAR!
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q1", "Q2", "Q4", "Q7", "Q9", "Q50"],
      mode: "balanced",
    });
    expect(result.route).toBe("ROUTE_2_SHIELDED_CLEAR");
    expect(result.escalateToHydrogen).toBe(false);
    expect(result.shieldFlags).toBe(1);
    expect(result.riskScore).toBe(6);
  });

  it("Route 4: Double Red Flag triggers forensic threat", () => {
    // Q10 (Tier 3), Q17 (Tier 3), Q27 (Tier 3), Q41 (Tier 3)
    // 4 tier 3 questions, 0 shields, riskScore >= 6
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q10", "Q17", "Q27", "Q41"],
      mode: "balanced",
    });
    expect(result.route).toBe("ROUTE_4_FORENSIC_THREAT");
    expect(result.escalateToHydrogen).toBe(true);
    expect(result.overrideTriggered).toBe("DOUBLE_RED_FLAG");
    expect(result.synergyBonusApplied).toBe(true); // buckets 2, 4, 6 active (3 buckets) -> +2
  });

  it("Bucket 1 Cap: caps at 3 points when it is the only active risk bucket", () => {
    // Q1 (1), Q2 (1), Q3 (1), Q4 (1), Q5 (1) -> total 5, but all in Bucket 1 -> capped to 3
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q1", "Q2", "Q3", "Q4", "Q5"],
      mode: "balanced",
    });
    expect(result.bucket1CapApplied).toBe(true);
    expect(result.riskScore).toBe(3);
    expect(result.route).toBe("ROUTE_1_FAST_CLEAR");
  });

  it("Route 3: Stance verification when risk is high and shields >= 2", () => {
    // Bucket 2: Q11 (2), Q12 (2), Q13 (2) = 6
    // Bucket 3: Q20 (2), Q21 (2) = 4
    // Active buckets = 2, total risk = 10 (>= shieldedThreshold 10 in balanced mode)
    // Shields: Q46 (Neutral Reporting, 2 flags) -> shieldFlags = 2
    // tier3Count = 0 (none of these are tier 3)
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q11", "Q12", "Q13", "Q20", "Q21", "Q46"],
      mode: "balanced",
    });
    expect(result.route).toBe("ROUTE_3_STANCE_VERIFICATION");
    expect(result.escalateToHydrogen).toBe(true);
    expect(result.shieldFlags).toBe(2);
  });

  it("Hard Evidence Veto: raises threshold when Q48 and Q49 are both triggered", () => {
    // Q48 (1 flag) + Q49 (2 flags) -> veto raises base & shielded thresholds to 12
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q11", "Q12", "Q13", "Q20", "Q48", "Q49"],
      mode: "balanced",
    });
    expect(result.overrideTriggered).toBe("HARD_EVIDENCE_VETO");
  });
});
