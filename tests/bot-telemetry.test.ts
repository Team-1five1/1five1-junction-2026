import { describe, expect, it } from "bun:test";
import { evaluateBotTelemetry, encryptTelemetry } from "../src/engines/bot-telemetry";

describe("Bot Telemetry Engine", () => {
  it("flags headless bot with webdriver: true", () => {
    const token = JSON.stringify({ webdriver: true });
    const res = evaluateBotTelemetry(token);
    expect(res.isBot).toBe(true);
    expect(res.confidenceScore).toBe(100);
    expect(res.reasons.some((r) => r.includes("navigator.webdriver"))).toBe(true);
  });

  it("flags hidden honeypot DOM input population", () => {
    const res = evaluateBotTelemetry({}, "spammer-filled-this");
    expect(res.isBot).toBe(true);
    expect(res.confidenceScore).toBe(100);
  });

  it("flags abnormally fast completion time (<600ms)", () => {
    const token = JSON.stringify({ formCompletionTimeMs: 250, mouseEventsCount: 0 });
    const res = evaluateBotTelemetry(token);
    expect(res.isBot).toBe(true);
  });

  it("passes legitimate human interaction telemetry", () => {
    const payload = {
      webdriver: false,
      formCompletionTimeMs: 8400,
      mouseEventsCount: 24,
      touchEventsCount: 0,
      keyCount: 45,
      keystrokeFlightVariance: 42.5,
      honeypotTriggered: false,
    };
    const encrypted = encryptTelemetry(payload);
    const res = evaluateBotTelemetry(encrypted);
    expect(res.isBot).toBe(false);
    expect(res.confidenceScore).toBe(0);
    expect(res.reasons.length).toBe(0);
  });
});
