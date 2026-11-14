import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, sql } from "../db";
import { tenants, entityBanners, evaluationJobs } from "../db/schema";
import { evaluateBotTelemetry, getTelemetryPublicKey } from "../engines/bot-telemetry";
import { analyzeText, dispatchPendingJobs, evaluationQueueName, getEvaluationQueue, setActiveThresholdMode } from "../workers/evaluation-worker";
import { ProviderHttpError } from "../ai/provider-errors";

export const apiRouter = new Hono<{ Variables: { tenant: typeof tenants.$inferSelect } }>();
const modeSchema = z.enum(["strict", "balanced", "high_precision"]);
const ingestSchema = z.object({
  wpCommentId: z.number().int().positive(), entityId: z.string().min(1).max(200),
  entityTitle: z.string().max(500).optional(), authorSessionHash: z.string().min(1).max(200),
  rawText: z.string().trim().min(1).max(50000), rating: z.number().int().min(1).max(5).nullable().optional(),
  telemetryToken: z.union([z.string().max(20000), z.record(z.string(), z.unknown())]).optional(),
  honeypotValue: z.string().max(1000).nullable().optional(),
});

apiRouter.use("/v1/*", bodyLimit({ maxSize: 128 * 1024 }));
apiRouter.use("/v1/*", async (c, next) => {
  const key = c.req.header("X-Shield-Key") || c.req.header("Authorization")?.replace(/^Bearer /, "");
  if (!key) return c.json({ error: "Tenant API key required" }, 401);
  try {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.apiKey, key));
    if (!tenant) return c.json({ error: "Invalid tenant API key" }, 401);
    c.set("tenant", tenant);
  } catch { return c.json({ error: "Tenant service unavailable" }, 503); }
  await next();
});

apiRouter.onError((err, c) => {
  console.warn("Request failed:", err.message);
  if (err instanceof ProviderHttpError) {
    if (err.retryable) c.header("Retry-After", String(Math.ceil(err.retryAfterMs / 1000)));
    return c.json({ error: err.message, reason: err.reason, providerStatus: err.status, retryable: err.retryable }, 503);
  }
  return c.json({ error: "Service temporarily unavailable; retry later" }, 503);
});

apiRouter.get("/v1/telemetry/key", c => c.json({ publicKey: getTelemetryPublicKey() }));

apiRouter.get("/v1/honeypot/patterns", async c => {
  const patterns = await sql`select h.pattern_cluster_id as "patternId", count(*)::int as count,
    count(distinct s.author_session_hash)::int as "distinctAuthors", max(h.created_at) as "lastSeen"
    from honeypot_vault h join submissions s on s.id = h.submission_id
    where s.tenant_id = ${c.get("tenant").id} and h.created_at >= now() - interval '24 hours'
    and h.pattern_cluster_id is not null group by h.pattern_cluster_id order by count(*) desc limit 100`;
  return c.json({ patterns });
});

apiRouter.post("/v1/ingest", async c => {
  const body = await c.req.json().catch(() => null);
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
  const tenant = c.get("tenant"), input = parsed.data;
  if (!tenant.webhookSecret) return c.json({ error: "Tenant callback is not configured" }, 503);
  const data = {
    ...input, tenantId: tenant.id, thresholdMode: modeSchema.parse(tenant.thresholdMode),
    botResult: evaluateBotTelemetry(input.telemetryToken || {}, input.honeypotValue),
    // The integration forwards the original visitor metadata; the key authenticates the host.
    ipAddress: c.req.header("X-Shield-Visitor-IP") || "unknown",
    userAgent: c.req.header("X-Shield-Visitor-UA") || "unknown",
  };
  const [inserted] = await db.insert(evaluationJobs).values({ tenantId: tenant.id, wpCommentId: input.wpCommentId, data, queueName: evaluationQueueName() })
    .onConflictDoNothing({ target: [evaluationJobs.tenantId, evaluationJobs.wpCommentId] }).returning({ id: evaluationJobs.id });
  const [existing] = inserted ? [inserted] : await db.select({ id: evaluationJobs.id }).from(evaluationJobs)
    .where(and(eq(evaluationJobs.tenantId, tenant.id), eq(evaluationJobs.wpCommentId, input.wpCommentId)));
  // Accepted means durably saved. Redis recovery drains this outbox automatically.
  void dispatchPendingJobs().catch(() => {});
  return c.json({ status: "accepted", wpCommentId: input.wpCommentId, submissionId: existing!.id }, 202);
});

apiRouter.post("/v1/analyze", async c => {
  const parsed = z.object({ text: z.string().trim().min(1).max(50000), mode: modeSchema.optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
  const mode = parsed.data.mode || modeSchema.parse(c.get("tenant").thresholdMode);
  const result = await analyzeText(parsed.data.text, mode);
  return c.json({
    risk_score: result.riskScore, shield_flags: result.shieldFlags, route: result.route,
    visibility: result.visibility, model_used: result.modelUsed,
    failed_risk_ids: result.failedRiskIds, triggered_shield_ids: result.triggeredShieldIds,
    synergy_bonus_applied: result.synergyBonusApplied, bucket1_cap_applied: result.bucket1CapApplied,
    override_triggered: result.overrideTriggered, deep_research_explanation: result.deepResearchExplanation,
    research_evidence: result.researchEvidence,
  });
});

apiRouter.patch("/v1/tenant/mode", async c => {
  const parsed = z.object({ mode: modeSchema }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid payload" }, 400);
  await db.update(tenants).set({ thresholdMode: parsed.data.mode }).where(eq(tenants.id, c.get("tenant").id));
  setActiveThresholdMode(parsed.data.mode);
  return c.json({ status: "updated", mode: parsed.data.mode });
});

apiRouter.get("/v1/submissions/:id", async c => {
  if (!z.uuid().safeParse(c.req.param("id")).success) return c.json({ error: "Invalid submission ID" }, 400);
  const [job] = await db.select().from(evaluationJobs).where(and(eq(evaluationJobs.id, c.req.param("id")), eq(evaluationJobs.tenantId, c.get("tenant").id)));
  if (!job) return c.json({ error: "Submission not found" }, 404);
  return c.json({
    status: job.deliveredAt ? "delivered" : job.retryPausedAt ? "needs_attention" : job.nextAttemptAt && job.nextAttemptAt.getTime() > Date.now() ? "retry_scheduled" : job.result ? "awaiting_callback" : "pending",
    result: job.result, failureCount: job.failureCount, nextAttemptAt: job.nextAttemptAt,
    retryPaused: !!job.retryPausedAt, lastError: job.lastError,
    retryPhase: job.deliveredAt ? "review_context" : "evaluation",
  });
});

apiRouter.post("/v1/submissions/:id/retry", async c => {
  if (!z.uuid().safeParse(c.req.param("id")).success) return c.json({ error: "Invalid submission ID" }, 400);
  const [job] = await db.select().from(evaluationJobs).where(and(eq(evaluationJobs.id, c.req.param("id")), eq(evaluationJobs.tenantId, c.get("tenant").id)));
  if (!job) return c.json({ error: "Submission not found" }, 404);
  if (job.deliveredAt && job.contextCompletedAt) return c.json({ status: "already_complete" });
  await db.update(evaluationJobs).set({ failureCount: 0, nextAttemptAt: null, retryPausedAt: null, lastError: null }).where(eq(evaluationJobs.id, job.id));
  const queued = await getEvaluationQueue()?.getJob(job.deliveredAt ? `review-${job.id}` : job.id);
  if (queued) {
    const state = await queued.getState();
    if (state === "delayed") await queued.promote();
    else if (state === "failed") await queued.retry();
  }
  void dispatchPendingJobs().catch(() => {});
  return c.json({ status: "retry_scheduled", submissionId: job.id }, 202);
});

apiRouter.get("/v1/entity/:id/banner", async c => {
  const [banner] = await db.select().from(entityBanners).where(and(eq(entityBanners.tenantId, c.get("tenant").id), eq(entityBanners.entityId, c.req.param("id"))));
  const fresh = banner && banner.updatedAt.getTime() > Date.now() - 6 * 3600000;
  return c.json(fresh ? banner : { entityId: c.req.param("id"), anomalyStatus: "normal", bannerExplanation: null, sources: [] });
});
