import { Queue, Worker, DelayedError, type Job } from "bullmq";
import Redis from "ioredis";
import { createHmac } from "node:crypto";
import { and, eq, gte, isNull, or, asc, lt, lte, sql as expression } from "drizzle-orm";
import { db, sql } from "../db";
import { evaluationJobs, submissions, honeypotVault, entityBanners, tenants } from "../db/schema";
import { screenWithJev } from "../ai/jev-screener";
import { evaluateSemEvalBitmask, type ThresholdMode } from "../engines/semeval-scorer";
import { verifyStanceOrForensic, investigateReviewBombing } from "../ai/grounded-research";
import { detectReviewSpike } from "../engines/review-velocity";
import type { BotEvaluationResult } from "../engines/bot-telemetry";
import { honeypotPatternId } from "../engines/honeypot-patterns";
import { debugLog, debugDecision } from "../config/logger";
import { researchModel } from "../ai/web-grounding";
import type { ForensicResult } from "../ai/grounded-research";
import { ProviderHttpError } from "../ai/provider-errors";
import { retryDelay, MAX_JOB_FAILURES } from "./retry-policy";

export interface EvaluationJobData {
  tenantId: string; wpCommentId: number; entityId: string; entityTitle?: string;
  authorSessionHash: string; rawText: string; rating?: number | null;
  botResult: BotEvaluationResult; ipAddress: string; userAgent: string;
  thresholdMode: ThresholdMode;
}

let queue: Queue | null = null;
let worker: Worker | null = null;
let connection: Redis | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

export function evaluationQueueName() { return process.env.EVALUATION_QUEUE_NAME || "shield-evaluation-v2"; }

function redis() {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: null, connectTimeout: 2000,
    });
    connection.on("error", () => {});
  }
  return connection;
}

export function getEvaluationQueue() {
  return queue;
}

export function isQueueReady() { return connection?.status === "ready" && !!worker?.isRunning(); }
export async function checkQueueHealth() {
  if (!isQueueReady()) return false;
  return await connection!.ping() === "PONG";
}

export async function sendWordPressWebhook(targetUrl: string, payload: Record<string, any>, secret: string): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const response = await fetch(targetUrl, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shield-Signature": `sha256=${signature}` },
    body, signal: AbortSignal.timeout(10000), redirect: "error",
  });
  if (!response.ok) throw new Error(`WordPress callback returned HTTP ${response.status}`);
}

export async function analyzeText(text: string, mode: ThresholdMode) {
  const screened = await screenWithJev(text);
  const scored = evaluateSemEvalBitmask({ triggeredIds: screened.triggeredIds, mode });
  const escalateToResearch = scored.escalateToResearch || screened.needsFactCheck || screened.needsWebSearch;
  const route = !scored.escalateToResearch && escalateToResearch ? "ROUTE_5_FACT_CHECK" : scored.route;
  let modelUsed = screened.modelUsed;
  let explanation: string | null = null;
  let visibility: "public" | "public_flagged" = "public";
  let researchEvidence: Pick<ForensicResult, "researchStatus" | "sources" | "quoteChecks" | "claimChecks" | "searchPerformed"> | null = null;
  if (escalateToResearch) {
    debugLog("Analysis", "Starting heavy-model verification", {
      route, searchRequested: screened.needsWebSearch, factCheckRequested: screened.needsFactCheck,
      model: researchModel(),
    });
    const forensic = await verifyStanceOrForensic(text, route, scored.failedRiskIds, scored.triggeredShieldIds, {
      searchRequested: screened.needsWebSearch, factCheckRequested: screened.needsFactCheck,
    });
    if (forensic.modelUsed !== "none") modelUsed = forensic.modelUsed;
    explanation = forensic.deepResearchExplanation;
    researchEvidence = { researchStatus: forensic.researchStatus, sources: forensic.sources, quoteChecks: forensic.quoteChecks, claimChecks: forensic.claimChecks, searchPerformed: forensic.searchPerformed };
    if (forensic.flagged) visibility = "public_flagged";
    const decision = !forensic.flagged ? "CLEARED_BY_CONTEXT"
      : forensic.claimChecks.some(check => check.status === "incorrect" || check.status === "misleading") ? "FACTUAL_CLAIMS_FLAGGED"
      : forensic.researchStatus === "unverified" || forensic.claimChecks.some(check => check.status === "unsubstantiated") ? "UNSUBSTANTIATED_CLAIMS_FLAGGED" : "MANIPULATION_CONFIRMED";
    debugDecision("Analysis", decision, {
      route, modelUsed, visibility, searchPerformed: forensic.searchPerformed,
      researchStatus: forensic.researchStatus, sourceCount: forensic.sources.length,
      unverifiedQuotes: forensic.quoteChecks.filter(check => check.status === "unverified").length,
      hasExplanation: !!explanation,
    });
  }
  return { ...scored, route, escalateToResearch, visibility, modelUsed, deepResearchExplanation: explanation, researchEvidence };
}

export async function processEvaluationJob(data: EvaluationJobData) {
  const { tenantId, wpCommentId, entityId, rawText, authorSessionHash, rating, botResult } = data;
  const analysis = botResult.isBot ? null : await analyzeText(rawText, data.thresholdMode);
  const result = {
    wpCommentId, entityId, visibility: analysis?.visibility || "shadowbanned",
    authorType: botResult.isBot ? "bot" : "human", modelUsed: analysis?.modelUsed || "none",
    riskScore: analysis?.riskScore ?? 100, shieldFlags: analysis?.shieldFlags ?? 0,
    routingPath: analysis?.route || "BOT_HONEYPOT",
    failedRiskIds: analysis?.failedRiskIds || [], triggeredShieldIds: analysis?.triggeredShieldIds || [],
    deepResearchExplanation: analysis?.deepResearchExplanation ?? null,
    researchEvidence: analysis?.researchEvidence ?? null,
    banner: null as Record<string, any> | null,
  };
  // Persist both the submission and vault atomically; retries never duplicate submissions.
  await db.transaction(async tx => {
    const [saved] = await tx.insert(submissions).values({
      ...result, tenantId, rawText, authorSessionHash, rating: rating ?? null,
    }).onConflictDoNothing({ target: [submissions.tenantId, submissions.wpCommentId] }).returning();
    if (saved && botResult.isBot) await tx.insert(honeypotVault).values({
      submissionId: saved.id, ipAddress: data.ipAddress, userAgent: data.userAgent,
      telemetryJson: { ...botResult.telemetry, reasons: botResult.reasons, confidenceScore: botResult.confidenceScore },
      patternClusterId: honeypotPatternId(rawText),
    });
  });
  // An individual rhetoric flag is not evidence of an entity-wide coordinated attack.
  // A separate durable job grounds review anomalies, so it cannot delay comment publication.
  return result;
}

async function investigateEntity(data: EvaluationJobData) {
  if (data.botResult.isBot || data.rating == null) return;
  const recent = await db.select().from(submissions).where(and(
    eq(submissions.tenantId, data.tenantId), eq(submissions.entityId, data.entityId),
    eq(submissions.authorType, "human"), gte(submissions.createdAt, new Date(Date.now() - 25 * 3600000)),
  ));
  const velocity = detectReviewSpike(recent.filter(r => r.rating !== null).map(r => ({
    rating: r.rating!, text: r.rawText, authorSessionHash: r.authorSessionHash, createdAt: r.createdAt,
  })));
  if (!velocity.spike) return;
  const [existing] = await db.select().from(entityBanners).where(and(eq(entityBanners.tenantId, data.tenantId), eq(entityBanners.entityId, data.entityId)));
  if (existing && existing.updatedAt.getTime() > Date.now() - 15 * 60000) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, data.tenantId));
    if (!tenant?.webhookSecret) throw new Error("Tenant callback secret missing");
    await sendWordPressWebhook(tenant.wpWebhookUrl, { entityId: data.entityId, banner: existing, eventType: "entity_banner" }, tenant.webhookSecret);
    return;
  }
  const investigation = await investigateReviewBombing(data.entityId, data.entityTitle || data.entityId, velocity.negatives);
  const banner = { anomalyStatus: investigation.anomalyStatus, bannerExplanation: investigation.bannerExplanation, sources: investigation.sources };
  await db.insert(entityBanners).values({ tenantId: data.tenantId, entityId: data.entityId, ...banner }).onConflictDoUpdate({
    target: [entityBanners.tenantId, entityBanners.entityId], set: { ...banner, updatedAt: new Date() },
  });
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, data.tenantId));
  if (!tenant?.webhookSecret) throw new Error("Tenant callback secret missing");
  // Banner-only callbacks cannot overwrite a comment verdict.
  await sendWordPressWebhook(tenant.wpWebhookUrl, { entityId: data.entityId, banner, eventType: "entity_banner" }, tenant.webhookSecret);
}

async function runJob(id: string) {
  // The advisory lock prevents concurrent duplicate processing across worker instances.
  // Keep it on a dedicated connection; model calls must not occupy the general DB pool.
  const reserved = await sql.reserve();
  try {
    await reserved`select pg_advisory_lock(hashtext(${id}))`;
    const [job] = await db.select().from(evaluationJobs).where(eq(evaluationJobs.id, id));
    if (!job || job.deliveredAt) return;
    const data = job.data as EvaluationJobData;
    const result = job.result || await processEvaluationJob(data);
    if (!job.result) await db.update(evaluationJobs).set({ result }).where(eq(evaluationJobs.id, id));
    debugDecision("Worker", "EVALUATION_STORED", {
      wpCommentId: data.wpCommentId, route: result.routingPath,
      visibility: result.visibility, modelUsed: result.modelUsed,
    });
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, data.tenantId));
    if (!tenant?.webhookSecret) throw new Error("Tenant callback secret missing");
    await sendWordPressWebhook(tenant.wpWebhookUrl, result, tenant.webhookSecret);
    await db.update(evaluationJobs).set({ deliveredAt: new Date(), failureCount: 0, nextAttemptAt: null, retryPausedAt: null, lastError: null }).where(eq(evaluationJobs.id, id));
    debugDecision("Worker", "WORDPRESS_CALLBACK_DELIVERED", {
      wpCommentId: data.wpCommentId, visibility: result.visibility,
      hasExplanation: !!result.deepResearchExplanation,
    });
  } finally {
    try { await reserved`select pg_advisory_unlock(hashtext(${id}))`; } finally { reserved.release(); }
  }
}

let dispatching = false;
export async function dispatchPendingJobs() {
  if (dispatching || !queue || connection?.status !== "ready") return;
  dispatching = true;
  try {
    const pending = await db.select().from(evaluationJobs).where(and(
      eq(evaluationJobs.queueName, evaluationQueueName()), isNull(evaluationJobs.retryPausedAt),
      lt(evaluationJobs.failureCount, MAX_JOB_FAILURES),
      or(isNull(evaluationJobs.nextAttemptAt), lte(evaluationJobs.nextAttemptAt, new Date())),
      or(isNull(evaluationJobs.deliveredAt), isNull(evaluationJobs.contextCompletedAt)),
    )).orderBy(asc(evaluationJobs.createdAt)).limit(1000);
    for (const job of pending) await queue.add(job.deliveredAt ? "review-context" : "evaluate", { id: job.id }, {
      jobId: job.deliveredAt ? `review-${job.id}` : job.id, attempts: MAX_JOB_FAILURES, backoff: { type: "provider-aware" },
      removeOnComplete: true, removeOnFail: true,
    });
  } finally { dispatching = false; }
}

async function processQueuedJob(job: Job, token?: string) {
  const [state] = await db.select().from(evaluationJobs).where(eq(evaluationJobs.id, job.data.id));
  if (!state || state.retryPausedAt || state.failureCount >= MAX_JOB_FAILURES) return;
  if (state.nextAttemptAt && state.nextAttemptAt.getTime() > Date.now()) {
    await job.moveToDelayed(state.nextAttemptAt.getTime(), token);
    throw new DelayedError();
  }
  try {
    if (job.name !== "review-context") return await runJob(job.data.id);
    if (state.contextCompletedAt) return;
    const data = state.data as EvaluationJobData;
    const reserved = await sql.reserve();
    const lock = `review-${data.tenantId}-${data.entityId}`;
    try {
      await reserved`select pg_advisory_lock(hashtext(${lock}))`;
      await investigateEntity(data);
      await db.update(evaluationJobs).set({ contextCompletedAt: new Date(), failureCount: 0, nextAttemptAt: null, retryPausedAt: null, lastError: null }).where(eq(evaluationJobs.id, state.id));
    } finally {
      try { await reserved`select pg_advisory_unlock(hashtext(${lock}))`; } finally { reserved.release(); }
    }
  } catch (error) {
    const delay = retryDelay(error, state.failureCount + 1);
    const [updated] = await db.update(evaluationJobs).set({
      failureCount: expression`${evaluationJobs.failureCount} + 1`,
      nextAttemptAt: delay < 0 ? null : new Date(Date.now() + delay),
      lastError: {
        message: error instanceof Error ? error.message : "Evaluation failed",
        reason: error instanceof ProviderHttpError ? error.reason : "processing_error",
        ...(error instanceof ProviderHttpError ? { status: error.status } : {}),
      },
    }).where(eq(evaluationJobs.id, state.id)).returning({ failureCount: evaluationJobs.failureCount });
    if (delay < 0 || (updated?.failureCount || 0) >= MAX_JOB_FAILURES) {
      await db.update(evaluationJobs).set({ retryPausedAt: new Date(), nextAttemptAt: null }).where(eq(evaluationJobs.id, state.id));
    }
    throw error;
  }
}

export function startWorker() {
  if (worker) return worker;
  queue = new Queue(evaluationQueueName(), { connection: redis() });
  worker = new Worker(evaluationQueueName(), processQueuedJob, {
    connection: redis(), concurrency: 5,
    settings: { backoffStrategy: (attempt, _type, error) => retryDelay(error, attempt) },
  });
  worker.on("error", err => console.warn("Evaluation worker:", err.message));
  worker.on("failed", (job, err) => console.warn(`Job ${job?.id} failed: ${err.message}`));
  timer = setInterval(() => { void dispatchPendingJobs().catch(err => console.warn("Outbox dispatch:", err.message)); }, 5000);
  timer.unref();
  void dispatchPendingJobs().catch(() => {});
  return worker;
}

export async function stopWorker() {
  clearInterval(timer);
  await worker?.close(); await queue?.close(); connection?.disconnect();
  worker = null; queue = null; connection = null;
}
