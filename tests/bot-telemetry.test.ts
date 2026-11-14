import { describe, expect, it } from "bun:test";
import { evaluateBotTelemetry, encryptTelemetry, decryptTelemetry } from "../src/engines/bot-telemetry";
import { generateKeyPairSync, publicEncrypt, createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Bot Telemetry Engine", () => {
  it("uses a fresh nonce for each encrypted token", () => {
    expect(encryptTelemetry({ webdriver: true })).not.toBe(encryptTelemetry({ webdriver: true }));
  });
  it("does not label accessibility users as bots for missing pointer activity", () => {
    expect(evaluateBotTelemetry({ formCompletionTimeMs: 9000, timestamp: Date.now() }).isBot).toBe(false);
    expect(evaluateBotTelemetry("null").isBot).toBe(false);
  });
  it("decrypts the browser hybrid envelope and rejects a tampered ciphertext", () => {
    const folder = mkdtempSync(join(tmpdir(), "verius-test-"));
    const previous = process.env.TELEMETRY_PRIVATE_KEY_PATH;
    try {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const file = join(folder, "private.pem");
      writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }));
      process.env.TELEMETRY_PRIVATE_KEY_PATH = file;
      const key = randomBytes(32), iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify({ webdriver: true })), cipher.final(), cipher.getAuthTag()]);
      const wrapped = publicEncrypt({ key: publicKey, oaepHash: "sha256" }, key);
      const token = `v1.${wrapped.toString("base64")}.${iv.toString("base64")}.${data.toString("base64")}`;
      expect(evaluateBotTelemetry(token).isBot).toBe(true);
      data[0] = data[0]! ^ 1;
      expect(decryptTelemetry(`v1.${wrapped.toString("base64")}.${iv.toString("base64")}.${data.toString("base64")}`)).toEqual({});
    } finally {
      if (previous === undefined) delete process.env.TELEMETRY_PRIVATE_KEY_PATH;
      else process.env.TELEMETRY_PRIVATE_KEY_PATH = previous;
      rmSync(folder, { recursive: true });
    }
  });
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
