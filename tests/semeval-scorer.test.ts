import { describe, expect, it } from "bun:test";
import { evaluateSemEvalBitmask } from "../src/engines/semeval-scorer";

describe("SemEval Scorer Engine (22-Question Gatekeeper)", () => {
  it("Route 1: Fast Clear when zero risk IDs on short text", () => {
    const result = evaluateSemEvalBitmask({
      triggeredIds: [], // No risk signals
      mode: "balanced",
      textLength: 50,
    });
    expect(result.route).toBe("ROUTE_1_FAST_CLEAR");
    expect(result.escalateToHydrogen).toBe(false);
    expect(result.riskScore).toBe(0);
  });

  it("Gatekeeper Escalation: Single Q1 on short text escalates (threshold=1)", () => {
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q1"], // 1 pt, single Tier-1 signal
      mode: "balanced",
      textLength: 50,
    });
    expect(result.escalateToHydrogen).toBe(true);
    expect(result.route).toBe("ROUTE_4_FORENSIC_THREAT");
    expect(result.riskScore).toBe(1);
  });

  it("Route 2: Shielded Clear for everyday consumer venting (S4) with zero risk", () => {
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["S4"], // S4 shield with zero risk
      mode: "balanced",
      textLength: 50,
    });
    expect(result.route).toBe("ROUTE_2_SHIELDED_CLEAR");
    expect(result.escalateToHydrogen).toBe(false);
    expect(result.shieldFlags).toBe(1);
  });

  it("Gatekeeper Escalation: Two Tier-1 signals escalate to Stage 2", () => {
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q1", "Q2"], // 2 Tier-1 signals -> failedRiskIds.length >= 2
      mode: "balanced",
      textLength: 50,
    });
    expect(result.escalateToHydrogen).toBe(true);
    expect(result.route).toBe("ROUTE_4_FORENSIC_THREAT");
  });

  it("Gatekeeper Escalation: Any Tier-3 signal immediately escalates to Stage 2", () => {
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q14"], // 1 Tier-3 signal (Appeal to Fear)
      mode: "balanced",
      textLength: 50,
    });
    expect(result.escalateToHydrogen).toBe(true);
    expect(result.route).toBe("ROUTE_4_FORENSIC_THREAT");
    expect(result.riskScore).toBe(3);
  });

  it("Route 3: Stance verification when risk is high and shields > 0 (No shield veto in Stage 1)", () => {
    // S2 (Multi-sided reporting shield) cannot veto locally when risk is present
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q5", "Q10", "S2"], // Q5 (2) + Q10 (2) = 4 pts >= threshold + S2
      mode: "balanced",
      textLength: 50,
    });
    expect(result.route).toBe("ROUTE_3_STANCE_VERIFICATION");
    expect(result.escalateToHydrogen).toBe(true);
    expect(result.shieldFlags).toBe(2);
  });

  it("Route 4: Double Red Flag triggers forensic threat for multiple Tier-3 flags", () => {
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q14", "Q15"], // 2 Tier-3 questions, 0 shields
      mode: "balanced",
      textLength: 50,
    });
    expect(result.route).toBe("ROUTE_4_FORENSIC_THREAT");
    expect(result.escalateToHydrogen).toBe(true);
    expect(result.overrideTriggered).toBe("DOUBLE_RED_FLAG");
    expect(result.riskScore).toBe(6);
  });

  it("Cross-Bucket Synergy bonus applies when >= 3 distinct risk buckets fire", () => {
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["Q1", "Q5", "Q10"], // EMOTION (1) + IDENTITY_AUTHORITY (2) + FALLACY_DEFLECTION (2)
      mode: "balanced",
      textLength: 50,
    });
    expect(result.activeRiskBuckets).toBe(3);
    expect(result.synergyBonusApplied).toBe(true);
    expect(result.riskScore).toBe(7); // 1 + 2 + 2 + 2 = 7
  });

  it("Long text: Zero risk IDs fast-clears on long text", () => {
    const result = evaluateSemEvalBitmask({
      triggeredIds: ["S2"], // Only shield, no risk
      mode: "balanced",
      textLength: 500,
    });
    expect(result.escalateToHydrogen).toBe(false);
    expect(result.route).toBe("ROUTE_1_FAST_CLEAR");
  });
});
