import { createCipheriv, createDecipheriv, randomBytes, privateDecrypt, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { debugLog, debugDecision } from "../config/logger";

export interface BotTelemetryPayload {
  webdriver?: boolean;
  keystrokeFlightVariance?: number;
  mouseEventsCount?: number;
  touchEventsCount?: number;
  formCompletionTimeMs?: number;
  honeypotTriggered?: boolean;
  timestamp?: number;
  keyCount?: number;
  [key: string]: any;
}

export interface BotEvaluationResult {
  isBot: boolean;
  confidenceScore: number; // 0 - 100
  reasons: string[];
  telemetry: BotTelemetryPayload;
}

const SECRET_KEY = process.env.TELEMETRY_SECRET_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * Encrypt telemetry payload for client or testing.
 */
export function encryptTelemetry(payload: BotTelemetryPayload, secretKey = SECRET_KEY): string {
  const key = Buffer.from(secretKey.slice(0, 64), "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const jsonStr = JSON.stringify(payload);
  let encrypted = cipher.update(jsonStr, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");
  return `${iv.toString("base64")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt or parse telemetry payload. Supports:
 * 1. AES-GCM encrypted string: "iv:tag:ciphertext"
 * 2. Raw JSON string
 * 3. Base64-encoded JSON string
 * 4. Already parsed object
 */
export function decryptTelemetry(token: string | object, secretKey = SECRET_KEY): BotTelemetryPayload {
  if (typeof token === "object" && token !== null) {
    return token as BotTelemetryPayload;
  }

  if (typeof token !== "string" || !token.trim()) {
    return {};
  }

  const trimmed = token.trim();

  // Hybrid browser envelope: RSA-OAEP-SHA256 wraps a random AES-256-GCM key.
  if (trimmed.startsWith("v1.")) {
    try {
      const parts = trimmed.split(".");
      if (parts.length !== 4) return {};
      const key = privateDecrypt({ key: telemetryPrivateKey(), oaepHash: "sha256" }, Buffer.from(parts[1]!, "base64"));
      const encrypted = Buffer.from(parts[3]!, "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2]!, "base64"));
      decipher.setAuthTag(encrypted.subarray(-16));
      return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString("utf8"));
    } catch { return {}; }
  }

  // Try direct JSON parse
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // ignore
    }
  }

  // Try AES-GCM encrypted format: iv:tag:data
  const parts = trimmed.split(":");
  if (parts.length === 3) {
    try {
      const [ivB64, tagB64, dataB64] = parts as [string, string, string];
      const key = Buffer.from(secretKey.slice(0, 64), "hex");
      const iv = Buffer.from(ivB64, "base64");
      const authTag = Buffer.from(tagB64, "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
      return JSON.parse(decrypted);
    } catch {
      // Fall through to other formats
    }
  }

  // Try Base64 JSON
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.startsWith("{") && decoded.endsWith("}")) {
      return JSON.parse(decoded);
    }
  } catch {
    // ignore
  }

  return {};
}

/**
 * Evaluates bot telemetry synchronously in <2ms.
 */
export function evaluateBotTelemetry(
  token: string | object,
  honeypotFieldVal?: string | null
): BotEvaluationResult {
  const decoded = decryptTelemetry(token);
  const telemetry = decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded : {};
  const reasons: string[] = [];
  let score = 0;

  debugLog("BotTelemetry", "Evaluating submission telemetry", {
    hasHoneypotValue: !!honeypotFieldVal,
    webdriver: telemetry.webdriver,
    formCompletionMs: telemetry.formCompletionTimeMs,
    mouseEvents: telemetry.mouseEventsCount,
    flightVariance: telemetry.keystrokeFlightVariance,
  });

  // 1. Check honeypot DOM input
  if (honeypotFieldVal && honeypotFieldVal.trim() !== "") {
    reasons.push("Hidden honeypot DOM field was populated");
    score += 100;
  }

  if (telemetry.honeypotTriggered === true) {
    reasons.push("Telemetry flagged honeypot interaction");
    score += 100;
  }

  // 2. Check navigator.webdriver
  if (telemetry.webdriver === true) {
    reasons.push("navigator.webdriver flag is active (Headless Browser detected)");
    score += 100;
  }

  // 3. Fast completion check
  if (
    typeof telemetry.formCompletionTimeMs === "number" &&
    telemetry.formCompletionTimeMs > 0 &&
    telemetry.formCompletionTimeMs < 600
  ) {
    reasons.push(`Abnormally fast form submission (${telemetry.formCompletionTimeMs}ms)`);
    score += 80;
  }

  // 4. Interaction check (no mouse/touch and no keystroke variance)
  const mouseEvents = telemetry.mouseEventsCount ?? 0;
  const touchEvents = telemetry.touchEventsCount ?? 0;
  const variance = telemetry.keystrokeFlightVariance ?? 0;
  const keyCount = telemetry.keyCount ?? 0;

  if (mouseEvents === 0 && touchEvents === 0 && variance === 0 && keyCount === 0) {
    if (Object.keys(telemetry).length > 0) {
      reasons.push("No physical interaction events detected (zero mouse/touch/keystrokes)");
      // Missing interaction can be caused by accessibility tools or password managers.
      score += 20;
    }
  } else if (keyCount > 8 && variance < 2) {
    reasons.push("Synthetic robotic typing cadence (flight variance < 2ms)");
    score += 70;
  }

  const isBot = score >= 70;

  debugDecision("BotTelemetry", isBot ? "BOT_DETECTED" : "HUMAN_VERIFIED", {
    isBot,
    confidenceScore: Math.min(score, 100),
    reasons,
  });

  return {
    isBot,
    confidenceScore: Math.min(score, 100),
    reasons,
    telemetry,
  };
}

function telemetryPrivateKey(): string {
  return readFileSync(process.env.TELEMETRY_PRIVATE_KEY_PATH || "./keys/telemetry-private.pem", "utf8");
}

export function getTelemetryPublicKey(): string {
  return createPublicKey(telemetryPrivateKey()).export({ type: "spki", format: "der" }).toString("base64");
}
