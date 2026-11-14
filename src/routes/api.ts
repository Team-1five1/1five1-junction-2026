import { Hono } from "hono";
import { z } from "zod";
import { evaluateBotTelemetry } from "../engines/bot-telemetry";
import { screenWithJev } from "../ai/jev-screener";
import { evaluateSemEvalBitmask, type ThresholdMode } from "../engines/semeval-scorer";
import { verifyStanceOrForensic } from "../ai/hydrogen-research";
import { getEvaluationQueue, processEvaluationJob, inMemoryBanners, setActiveThresholdMode } from "../workers/evaluation-worker";
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

  const data = parsed.data;
  const ip = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "127.0.0.1";
  const userAgent = c.req.header("user-agent") || "unknown";

  debugLog("API", `Received POST /v1/ingest for comment #${data.wpCommentId}`, {
    entityId: data.entityId,
    rating: data.rating,
    ip,
    userAgent,
    hasTelemetry: !!data.telemetryToken,
    hasHoneypot: !!data.honeypotValue,
  });

  // Fast synchronous telemetry evaluation (<2ms)
  const botResult = evaluateBotTelemetry(data.telemetryToken || {}, data.honeypotValue);

  const jobData = {
    wpCommentId: data.wpCommentId,
    entityId: data.entityId,
    entityTitle: data.entityTitle,
    authorSessionHash: data.authorSessionHash,
    rawText: data.rawText,
    rating: data.rating,
    botResult,
    ipAddress: ip,
    userAgent,
    tenantApiKey: data.tenantApiKey,
    wpWebhookUrl: data.wpWebhookUrl,
    thresholdMode: data.thresholdMode,
  };

  const queue = getEvaluationQueue();
  const runSync = c.req.query("sync") === "true";

  if (runSync || !queue) {
    debugLog("API", `Processing comment #${data.wpCommentId} synchronously`);
    const result = await processEvaluationJob(jobData);
    return c.json({ status: "processed", ...result }, 200);
  }

  try {
    await queue.add("evaluate", jobData, {
      removeOnComplete: true,
      removeOnFail: false,
    });
    debugLog("API", `Comment #${data.wpCommentId} enqueued to BullMQ (isBot: ${botResult.isBot})`);
    return c.json({
      status: "accepted",
      isBot: botResult.isBot,
      wpCommentId: data.wpCommentId,
      jobQueued: true,
    }, 202);
  } catch (err: any) {
    console.warn(`Queue add failed (${err.message}), processing inline`);
    const result = await processEvaluationJob(jobData);
    return c.json({ status: "processed_inline", ...result }, 200);
  }
});

/**
 * POST /v1/analyze
 * Direct on-demand propaganda detection endpoint.
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

  // Stage 1: Fast Screener
  const jevRes = await screenWithJev(text);

  // Deterministic 50-Question Scorer
  const scoreRes = evaluateSemEvalBitmask({
    triggeredIds: jevRes.triggeredIds,
    mode,
  });

  let deepResearchExplanation: string | null = null;
  let modelUsed = "jev";

  if (scoreRes.escalateToHydrogen) {
    modelUsed = "gemini-4-hydrogen";
    const forensicRes = await verifyStanceOrForensic(
      text,
      scoreRes.route === "ROUTE_3_STANCE_VERIFICATION"
        ? "ROUTE_3_STANCE_VERIFICATION"
        : "ROUTE_4_FORENSIC_THREAT",
      scoreRes.failedRiskIds
    );

    if (scoreRes.route === "ROUTE_3_STANCE_VERIFICATION" && !forensicRes.endorsed) {
      deepResearchExplanation = null;
    } else {
      deepResearchExplanation = forensicRes.deepResearchExplanation;
    }
  }

  debugDecision("API", `/v1/analyze completed with route ${scoreRes.route}`, {
    route: scoreRes.route,
    modelUsed,
    riskScore: scoreRes.riskScore,
    shieldFlags: scoreRes.shieldFlags,
    failedRiskIds: scoreRes.failedRiskIds,
    hasExplanation: !!deepResearchExplanation,
  });

  return c.json({
    risk_score: scoreRes.riskScore,
    shield_flags: scoreRes.shieldFlags,
    route: scoreRes.route,
    model_used: modelUsed,
    failed_risk_ids: scoreRes.failedRiskIds,
    triggered_shield_ids: scoreRes.triggeredShieldIds,
    synergy_bonus_applied: scoreRes.synergyBonusApplied,
    bucket1_cap_applied: scoreRes.bucket1CapApplied,
    override_triggered: scoreRes.overrideTriggered,
    deep_research_explanation: deepResearchExplanation,
  });
});

/**
 * PATCH /v1/tenant/mode
 * Updates threshold mode for a tenant.
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

  setActiveThresholdMode(parsed.data.mode);

  try {
    const [updated] = await db
      .update(tenants)
      .set({ thresholdMode: parsed.data.mode })
      .where(eq(tenants.apiKey, parsed.data.apiKey))
      .returning();

    if (!updated) {
      const [inserted] = await db
        .insert(tenants)
        .values({
          apiKey: parsed.data.apiKey,
          wpWebhookUrl: process.env.WP_DEFAULT_WEBHOOK_URL || "http://127.0.0.1:8080/wp-json/shield/v1/webhook",
          thresholdMode: parsed.data.mode,
        })
        .returning();
      return c.json({ status: "updated", tenant: inserted });
    }

    return c.json({ status: "updated", tenant: updated });
  } catch (err: any) {
    return c.json({
      status: "updated",
      tenant: { apiKey: parsed.data.apiKey, thresholdMode: parsed.data.mode },
      note: "Updated in memory",
    });
  }
});

/**
 * GET /v1/entity/:id/banner
 * Retrieves entity banner status.
 */
apiRouter.get("/v1/entity/:id/banner", async (c) => {
  const entityId = c.req.param("id");
  debugLog("API", `GET /v1/entity/${entityId}/banner requested`);

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
});
