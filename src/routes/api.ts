import { Hono } from "hono";
import { z } from "zod";
import { evaluateBotTelemetry } from "../engines/bot-telemetry";
import { screenWithJev } from "../ai/jev-screener";
import { evaluateSemEvalBitmask, type ThresholdMode } from "../engines/semeval-scorer";
import { verifyStanceOrForensic } from "../ai/hydrogen-research";
import { getEvaluationQueue, processEvaluationJob, inMemoryBanners } from "../workers/evaluation-worker";
import { db } from "../db";
import { tenants, entityBanners } from "../db/schema";
import { eq } from "drizzle-orm";
import { debugLog, debugDecision } from "../config/logger";

export const apiRouter = new Hono();

const ingestSchema = z.object({
  wpCommentId: z.number(),
  entityId: z.string(),
  entityTitle: z.string().optional(),
  authorSessionHash: z.string(),
  rawText: z.string(),
  rating: z.number().nullable().optional(),
  telemetryToken: z.union([z.string(), z.record(z.any())]).optional(),
  honeypotValue: z.string().nullable().optional(),
  tenantApiKey: z.string().optional(),
  wpWebhookUrl: z.string().optional(),
  thresholdMode: z.enum(["strict", "balanced", "high_precision"]).optional(),
});

const analyzeSchema = z.object({
  text: z.string().min(1),
  mode: z.enum(["strict", "balanced", "high_precision"]).default("balanced"),
});

const tenantModeSchema = z.object({
  apiKey: z.string(),
  mode: z.enum(["strict", "balanced", "high_precision"]),
});

/**
 * POST /v1/ingest
 * Synchronous bot telemetry verification (<2ms) and asynchronous job queuing.
 */
apiRouter.post("/v1/ingest", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
  }

  const {
    wpCommentId,
    entityId,
    entityTitle,
    authorSessionHash,
    rawText,
    rating,
    telemetryToken,
    honeypotValue,
    tenantApiKey,
    wpWebhookUrl,
    thresholdMode = "balanced",
  } = parsed.data;

  debugLog("API", `Received POST /v1/ingest for comment #${wpCommentId}`, {
    entityId,
    ip: c.req.header("x-forwarded-for") || "127.0.0.1",
    userAgent: c.req.header("user-agent") || "unknown",
    hasTelemetry: !!telemetryToken,
    hasHoneypot: !!honeypotValue,
  });

  // 1. Synchronous Bot Telemetry & Honeypot Engine (<2ms)
  const botResult = evaluateBotTelemetry(
    telemetryToken || null,
    honeypotValue || null
  );

  // Synchronous processing request (?sync=true) used for testing & fast path
  const isSync = c.req.query("sync") === "true";

  if (isSync) {
    debugLog("API", `Processing comment #${wpCommentId} synchronously`);
    const result = await processEvaluationJob({
      wpCommentId,
      entityId,
      entityTitle,
      authorSessionHash,
      rawText,
      rating,
      botResult,
      ipAddress: c.req.header("x-forwarded-for") || "127.0.0.1",
      userAgent: c.req.header("user-agent") || "unknown",
      wpWebhookUrl,
      thresholdMode,
    });
    return c.json(result);
  }

  // 2. Headless bots detected immediately are shadowbanned synchronously
  if (botResult.isBot) {
    // Dispatch to background queue for recording honeypot vault & audit logs
    const queue = getEvaluationQueue();
    await queue.add("evaluate-comment", {
      wpCommentId,
      entityId,
      entityTitle,
      authorSessionHash,
      rawText,
      rating,
      botResult,
      ipAddress: c.req.header("x-forwarded-for") || "127.0.0.1",
      userAgent: c.req.header("user-agent") || "unknown",
      wpWebhookUrl,
      thresholdMode,
    });

    return c.json({
      status: "processed",
      wpCommentId,
      authorType: "bot",
      visibility: "shadowbanned",
      hasBanner: false,
      banner: null,
    });
  }

  // 3. Human submissions are enqueued to BullMQ worker (<5ms response time)
  const queue = getEvaluationQueue();
  await queue.add("evaluate-comment", {
    wpCommentId,
    entityId,
    entityTitle,
    authorSessionHash,
    rawText,
    rating,
    botResult,
    ipAddress: c.req.header("x-forwarded-for") || "127.0.0.1",
    userAgent: c.req.header("user-agent") || "unknown",
    wpWebhookUrl,
    thresholdMode,
  });

  return c.json({
    status: "queued",
    wpCommentId,
    authorType: "human",
    visibility: "pending",
    hasBanner: false,
    banner: null,
  });
});

/**
 * POST /v1/analyze
 * Direct standalone text evaluation pipeline for testing & real-time checking.
 */
apiRouter.post("/v1/analyze", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = analyzeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
  }

  const { text, mode } = parsed.data;

  debugLog("API", `Received POST /v1/analyze (mode: ${mode})`, {
    textLength: text.length,
    textPreview: text.length > 80 ? text.substring(0, 80) + "..." : text,
  });

  // Stage 1: Fast Screener Jev
  const jevResult = await screenWithJev(text);

  // SemEval Deterministic Scorer
  const scoreRes = evaluateSemEvalBitmask({
    triggeredIds: jevResult.triggeredIds,
    mode,
  });

  let explanation: string | null = null;
  let modelUsed = jevResult.modelUsed;

  // Stage 2: Heavy Forensic & Stance Grounding (gemini-4-hydrogen)
  if (scoreRes.escalateToHydrogen) {
    const heavyResult = await verifyStanceOrForensic(
      text,
      scoreRes.route === "ROUTE_3_STANCE_VERIFICATION"
        ? "ROUTE_3_STANCE_VERIFICATION"
        : "ROUTE_4_FORENSIC_THREAT",
      scoreRes.failedRiskIds
    );

    if (scoreRes.route === "ROUTE_3_STANCE_VERIFICATION" && !heavyResult.endorsed) {
      explanation = null;
      scoreRes.route = "ROUTE_2_SHIELDED_CLEAR";
    } else {
      explanation = heavyResult.deepResearchExplanation;
    }
    modelUsed = heavyResult.modelUsed;
  }

  debugDecision("API", `/v1/analyze completed with route ${scoreRes.route}`, {
    route: scoreRes.route,
    modelUsed,
    riskScore: scoreRes.riskScore,
    shieldFlags: scoreRes.shieldFlags,
    failedRiskIds: scoreRes.failedRiskIds,
    hasExplanation: !!explanation,
  });

  return c.json({
    route: scoreRes.route,
    risk_score: scoreRes.riskScore,
    shield_flags: scoreRes.shieldFlags,
    failed_risk_ids: scoreRes.failedRiskIds,
    triggered_shield_ids: scoreRes.triggeredShieldIds,
    escalate_to_hydrogen: scoreRes.escalateToHydrogen,
    deep_research_explanation: explanation,
    model_used: modelUsed,
  });
});

/**
 * PATCH /v1/tenant/mode
 * Admin toggle for changing the tenant's threshold sensitivity mode.
 */
apiRouter.patch("/v1/tenant/mode", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = tenantModeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
  }

  debugDecision("API", `Tenant threshold mode updated to ${parsed.data.mode}`, {
    apiKey: parsed.data.apiKey,
    newMode: parsed.data.mode,
  });

  try {
    const [updated] = await db
      .update(tenants)
      .set({ thresholdMode: parsed.data.mode })
      .where(eq(tenants.apiKey, parsed.data.apiKey))
      .returning();

    if (!updated) {
      return c.json({ error: "Tenant not found" }, 404);
    }

    return c.json({ status: "updated", tenant: updated });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

async function handleGetBanner(c: any) {
  const entityId = c.req.param("id");
  debugLog("API", `Banner requested for entity: ${entityId}`);

  try {
    const [banner] = await db
      .select()
      .from(entityBanners)
      .where(eq(entityBanners.entityId, entityId));

    if (banner) {
      debugLog("API", `Found banner for ${entityId} in DB: ${banner.anomalyStatus}`);
      return c.json(banner);
    }
  } catch {
    // If DB has error, check in-memory cache
  }

  const cached = inMemoryBanners.get(entityId);
  if (cached) {
    debugLog("API", `Found banner for ${entityId} in memory: ${cached.anomalyStatus}`);
    return c.json(cached);
  }

  return c.json({ entityId, anomalyStatus: "normal", bannerExplanation: null });
}

/**
 * GET /v1/entity/:id/banner and GET /v1/banner/:id
 * Retrieves entity banner status.
 */
apiRouter.get("/v1/entity/:id/banner", handleGetBanner);
apiRouter.get("/v1/banner/:id", handleGetBanner);
