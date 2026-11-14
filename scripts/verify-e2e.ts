/** Real PostgreSQL + Redis + HTTP callbacks; deterministic model/search fixtures, no AI credits. */
import { strict as assert } from "node:assert";
import { createHmac, randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import app from "../src/index";
import { db, sql } from "../src/db";
import { tenants, submissions, evaluationJobs, entityBanners, honeypotVault } from "../src/db/schema";
import { startWorker, stopWorker, dispatchPendingJobs, getEvaluationQueue } from "../src/workers/evaluation-worker";

const originalFetch = globalThis.fetch;
const key = `e2e-${randomBytes(16).toString("hex")}`;
process.env.EVALUATION_QUEUE_NAME = key;
const secret = randomBytes(32).toString("hex");
let tenantId = "", otherTenantId = "", assertions = 0, failCallback = true;
let quotaRequests = 0;
const callbacks: any[] = [];
const callbackServer = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  const body = await req.text();
  assert.equal(req.headers.get("X-Shield-Signature"), `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  if (failCallback) { failCallback = false; return new Response("retry", { status: 503 }); }
  callbacks.push(JSON.parse(body));
  return Response.json({ status: "success" });
} });

process.env.HOSTINGER_AI_API_KEY = "test";
process.env.MODEL_FAST_SCREENER = "jev-latest";
process.env.MODEL_HEAVY_RESEARCH = "gpt-5-nano";
process.env.CONTEXT_DEV_API_KEY = "test";
process.env.SHIELD_DEBUG = "false";
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input);
  if (url.includes("/systemone")) {
    const { state } = JSON.parse(init.body);
    const ids = state.includes("forensic-fixture") ? ["Q8", "Q17", "Q41"] : ["Q50"];
    return Response.json({ answers: { ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`Q${i + 1}`, { noul: ids.includes(`Q${i + 1}`) ? 0.99 : 0.01 }])), needsFactCheck: { noul: 0.01 }, needsWebSearch: { noul: state.includes("forensic-fixture") ? 0.99 : 0.01 } } });
  }
  if (url === "https://api.context.dev/v1/web/search") return Response.json({ results: [{ title: "Official patch notes", url: "https://example.org/patch", description: "Patch removed offline play.", markdown: { code: "SUCCESS", markdown: "The official patch removed offline play.", finalDOMState: "loaded" } }] });
  if (url === "https://api.context.dev/v1/news/search") return Response.json({ data: [] });
  if (url === "https://api.context.dev/v1/web/scrape") return Response.json({ markdown: { success: true, data: "The official patch removed offline play." } });
  if (url.includes("/chat/completions")) {
    const { messages } = JSON.parse(init.body);
    if (JSON.parse(messages[1].content).input.text?.includes("quota-fixture")) {
      quotaRequests++;
      return Response.json({ error: { message: "Too many requests" } }, { status: 429, headers: { "Retry-After": "60" } });
    }
    const result = messages[0].content.includes("review spike")
      ? { anomalyStatus: "legitimate_backlash", bannerExplanation: "Customers report the patch removed offline play.", sourceUrls: ["https://example.org/patch"] }
      : { endorsed: true, explanation: "The text uses dehumanization and artificial urgency.", sufficientEvidence: true, claimChecks: [], quoteChecks: [], sourceUrls: ["https://example.org/patch"] };
    return Response.json({ model: process.env.MODEL_HEAVY_RESEARCH, choices: [{ message: { content: JSON.stringify(result) } }] });
  }
  return originalFetch(input, init);
}) as typeof fetch;

function check(condition: unknown, label: string) { assert.ok(condition, label); assertions++; console.log(`PASS ${label}`); }
async function request(path: string, body?: unknown, apiKey = key, method = "POST") {
  return app.fetch(new Request(`http://localhost${path}`, { method, headers: { "X-Shield-Key": apiKey, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
}
async function until(predicate: () => Promise<boolean> | boolean, label: string) {
  const deadline = Date.now() + 25000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
    await Bun.sleep(100);
  }
}
const payload = (id: number, overrides = {}) => ({ wpCommentId: id, entityId: "test-post", entityTitle: "Test game", authorSessionHash: `reviewer-${id}`, rawText: "The patch broke offline play.", telemetryToken: { mouseEventsCount: 20, formCompletionTimeMs: 5000 }, ...overrides });

try {
  const [tenant] = await db.insert(tenants).values({ apiKey: key, wpWebhookUrl: callbackServer.url.href, webhookSecret: secret }).returning();
  tenantId = tenant!.id;
  const [other] = await db.insert(tenants).values({ apiKey: `${key}-other`, wpWebhookUrl: callbackServer.url.href, webhookSecret: secret }).returning();
  otherTenantId = other!.id;
  check((await request("/v1/ingest", payload(1), "invalid")).status === 401, "invalid tenant rejected");
  check((await request("/v1/ingest", payload(1, { rating: 10 }))).status === 400, "invalid rating rejected");
  const accepted = await request("/v1/ingest", payload(1, { telemetryToken: { webdriver: true } }));
  const job = await accepted.json() as any;
  check(accepted.status === 202 && !Object.hasOwn(job, "isBot") && !Object.hasOwn(job, "visibility"), "opaque durable acceptance before worker starts");
  const duplicate = await (await request("/v1/ingest", payload(1))).json() as any;
  check(duplicate.submissionId === job.submissionId, "ingestion retries reuse the same submission");
  check((await request(`/v1/submissions/${job.submissionId}`, undefined, `${key}-other`, "GET")).status === 404, "submission lookup isolated by tenant");
  startWorker();
  await until(async () => { await dispatchPendingJobs(); return callbacks.some(c => c.wpCommentId === 1); }, "bot callback retry");
  check(callbacks.find(c => c.wpCommentId === 1).visibility === "shadowbanned", "bot callback retries successfully");
  const botRows = await db.select().from(submissions).where(and(eq(submissions.tenantId, tenantId), eq(submissions.wpCommentId, 1)));
  check(botRows.length === 1, "callback retry does not duplicate stored submissions");
  const vault = await db.select().from(honeypotVault).where(eq(honeypotVault.submissionId, botRows[0]!.id));
  check(vault.length === 1, "bot telemetry retained in honeypot vault");
  await request("/v1/ingest", payload(2, { rawText: "forensic-fixture" }));
  await until(async () => { await dispatchPendingJobs(); return callbacks.some(c => c.wpCommentId === 2); }, "forensic callback");
  const forensic = callbacks.find(c => c.wpCommentId === 2);
  check(forensic.visibility === "public_flagged" && forensic.deepResearchExplanation && forensic.modelUsed === "gpt-5-nano", "human manipulation remains public with heavy model explanation");
  check(forensic.banner === null, "one flagged comment cannot create a coordinated attack banner");
  for (let id = 3; id <= 7; id++) await request("/v1/ingest", payload(id, { rating: 1 }));
  await until(async () => { await dispatchPendingJobs(); return callbacks.some(c => c.eventType === "entity_banner"); }, "review context banner");
  const banner = callbacks.find(c => c.eventType === "entity_banner").banner;
  check(banner.anomalyStatus === "legitimate_backlash" && banner.sources.length === 1, "review spike grounded with a source-backed legitimate backlash banner");
  check(callbacks.filter(c => c.wpCommentId >= 3).every(c => c.visibility === "public" && c.deepResearchExplanation === null), "legitimate customer complaints stay public without generated prose");
  const otherBanner = await (await request("/v1/entity/test-post/banner", undefined, `${key}-other`, "GET")).json() as any;
  check(otherBanner.anomalyStatus === "normal", "entity banners isolated by tenant");
  await until(async () => {
    const jobs = await db.select().from(evaluationJobs).where(eq(evaluationJobs.tenantId, tenantId));
    return jobs.every(j => j.deliveredAt && j.contextCompletedAt);
  }, "context jobs complete");
  const limited = await (await request("/v1/ingest", payload(8, { rawText: "forensic-fixture quota-fixture" }))).json() as any;
  await until(async () => {
    const [saved] = await db.select().from(evaluationJobs).where(eq(evaluationJobs.id, limited.submissionId));
    return saved?.lastError?.status === 429;
  }, "quota failure stored");
  const limitedStatus = await (await request(`/v1/submissions/${limited.submissionId}`, undefined, key, "GET")).json() as any;
  check(limitedStatus.status === "retry_scheduled" && limitedStatus.lastError.reason === "rate_limit", "rate-limited jobs expose their provider reason and scheduled retry");
  check(new Date(limitedStatus.nextAttemptAt).getTime() > Date.now() + 50000, "queue honors the provider's 60-second cooldown");
  await dispatchPendingJobs();
  check(quotaRequests === 1 && limitedStatus.result === null, "quota failure preserves the pending comment without repeated model calls or a fabricated verdict");
  await until(async () => (await getEvaluationQueue()!.getJob(limited.submissionId))?.getState().then(state => state === "delayed") || false, "rate-limited queue job delayed");
  await db.update(evaluationJobs).set({ failureCount: 5, retryPausedAt: new Date(), nextAttemptAt: null }).where(eq(evaluationJobs.id, limited.submissionId));
  await getEvaluationQueue()!.remove(limited.submissionId);
  await dispatchPendingJobs();
  check(!await getEvaluationQueue()!.getJob(limited.submissionId), "the outbox does not recreate an exhausted quota job");
  const paused = await (await request(`/v1/submissions/${limited.submissionId}`, undefined, key, "GET")).json() as any;
  check(paused.status === "needs_attention" && paused.retryPaused, "exhausted jobs clearly report that operator attention is needed");
  check((await request(`/v1/submissions/${limited.submissionId}/retry`, {}, `${key}-other`)).status === 404, "another tenant cannot resume the saved job");
  check((await request(`/v1/submissions/${limited.submissionId}/retry`, {})).status === 202, "the owning tenant can resume a saved job after fixing quota");
  await until(async () => (await getEvaluationQueue()!.getJob(limited.submissionId))?.getState().then(state => state === "delayed") || false, "manual retry still observes shared cooldown");
  check(quotaRequests === 1, "manual retry cannot bypass the shared provider cooldown");
  console.log(`${assertions} integration assertions passed`);
} finally {
  const q = getEvaluationQueue();
  if (q) {
    const jobs = await db.select().from(evaluationJobs).where(inArray(evaluationJobs.tenantId, [tenantId, otherTenantId]));
    for (const job of jobs) { await q.remove(job.id); await q.remove(`review-${job.id}`); }
  }
  await stopWorker();
  const rows = await db.select({ id: submissions.id }).from(submissions).where(inArray(submissions.tenantId, [tenantId, otherTenantId]));
  if (rows.length) await db.delete(honeypotVault).where(inArray(honeypotVault.submissionId, rows.map(r => r.id)));
  await db.delete(submissions).where(inArray(submissions.tenantId, [tenantId, otherTenantId]));
  await db.delete(entityBanners).where(inArray(entityBanners.tenantId, [tenantId, otherTenantId]));
  await db.delete(evaluationJobs).where(inArray(evaluationJobs.tenantId, [tenantId, otherTenantId]));
  if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
  if (otherTenantId) await db.delete(tenants).where(eq(tenants.id, otherTenantId));
  globalThis.fetch = originalFetch; await callbackServer.stop(true); await sql.end();
}
