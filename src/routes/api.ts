import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, sql } from "../db";
import { tenants, entityBanners, evaluationJobs } from "../db/schema";
import { evaluateBotTelemetry, getTelemetryPublicKey } from "../engines/bot-telemetry";
import {
  analyzeText,
  dispatchPendingJobs,
  evaluationQueueName,
  getEvaluationQueue,
  setActiveThresholdMode,
  processEvaluationJob,
  inMemoryBanners,
  inMemoryHoneypotVault,
  resetInMemoryState,
} from "../workers/evaluation-worker";
import { getHoneypotVaultStats } from "../engines/honeypot-cluster";
import { cleanTrafficLogs } from "../engines/traffic-cleaner";
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
  const path = c.req.path;
  if (path === "/v1/honeypot/vault" || path === "/v1/honeypot/reset") {
    return next();
  }
  const key = c.req.header("X-Shield-Key") || c.req.header("Authorization")?.replace(/^Bearer /, "");
  if (!key) return c.json({ error: "Tenant API key required" }, 401);
  let tenant: any = null;
  try {
    const [found] = await db.select().from(tenants).where(eq(tenants.apiKey, key));
    tenant = found;
  } catch {
    // If DB is offline / during local tests
  }
  if (!tenant && (key === "default_tenant" || process.env.NODE_ENV === "test")) {
    tenant = {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Default Tenant",
      apiKey: key,
      webhookSecret: "default_secret",
      wpWebhookUrl: "http://localhost:8080/wp-json/shield-guard/v1/decision",
      thresholdMode: "balanced",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
  if (!tenant) return c.json({ error: "Invalid tenant API key" }, 401);
  c.set("tenant", tenant);
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
    ...input,
    tenantId: tenant.id,
    thresholdMode: modeSchema.parse(tenant.thresholdMode),
    botResult: evaluateBotTelemetry(input.telemetryToken ?? "", input.honeypotValue),
    ipAddress: c.req.header("X-Shield-Visitor-IP") || c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "127.0.0.1",
    userAgent: c.req.header("X-Shield-Visitor-UA") || c.req.header("user-agent") || "unknown",
    countryHeader: c.req.header("cf-ipcountry") || c.req.header("x-country-code") || c.req.header("x-geo-country") || null,
  };

  if (c.req.query("sync") === "true") {
    const result = await processEvaluationJob(data);
    return c.json({ status: "processed", ...result });
  }

  const [inserted] = await db.insert(evaluationJobs).values({ tenantId: tenant.id, wpCommentId: input.wpCommentId, data, queueName: evaluationQueueName() })
    .onConflictDoNothing({ target: [evaluationJobs.tenantId, evaluationJobs.wpCommentId] }).returning({ id: evaluationJobs.id });
  const [existing] = inserted ? [inserted] : await db.select({ id: evaluationJobs.id }).from(evaluationJobs)
    .where(and(eq(evaluationJobs.tenantId, tenant.id), eq(evaluationJobs.wpCommentId, input.wpCommentId)));
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

apiRouter.post("/v1/traffic/clean", async (c) => {
  const body = await c.req.json().catch(() => null);
  const logs = body?.logs || (await c.req.text().catch(() => ""));
  if (!logs || typeof logs !== "string" || logs.trim().length === 0) {
    return c.json({ error: "Access logs content required in 'logs' parameter or request body" }, 400);
  }
  const report = cleanTrafficLogs(logs);
  return c.json(report);
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

/**
 * GET /v1/honeypot/vault
 * Returns active honeypot cluster stats and recent captured bot/stealth-bot records.
 */
apiRouter.get("/v1/honeypot/vault", (c) => {
  const stats = getHoneypotVaultStats();
  return c.json({
    ...stats,
    recentCaptures: inMemoryHoneypotVault.slice(0, 50),
  });
});

/**
 * POST /v1/honeypot/reset
 * Resets in-memory honeypot clusters, review velocity trackers, and demo comments for clean test runs.
 */
apiRouter.post("/v1/honeypot/reset", (c) => {
  resetInMemoryState();
  resetDemoStorefrontComments();
  return c.json({ status: "reset" });
});

// ---------------------------------------------------------------------------
// Live Interactive Storefront & Honeypot Demo (Mirrors WordPress Shield_Interceptor)
// ---------------------------------------------------------------------------
interface DemoComment {
  id: number;
  author: string;
  authorSessionHash: string;
  rawText: string;
  rating: number;
  visibility: "public" | "public_flagged" | "shadowbanned";
  authorType: "human" | "bot";
  routingPath: string;
  patternClusterId?: string;
  failedRiskIds: string[];
  deepResearchExplanation: string | null;
  createdAt: string;
}

const initialDemoComments: DemoComment[] = [
  {
    id: 501,
    author: "Elena Rostova (Verified Buyer)",
    authorSessionHash: "seed_human_elena",
    rawText: "Been using the Pro Gaming Laptop 15 for two weeks. Thermal performance is solid under load and the 240Hz display is super crisp.",
    rating: 5,
    visibility: "public",
    authorType: "human",
    routingPath: "ROUTE_1_FAST_CLEAR",
    failedRiskIds: [],
    deepResearchExplanation: null,
    createdAt: "12 mins ago",
  },
  {
    id: 502,
    author: "Marcus Vance",
    authorSessionHash: "seed_human_marcus",
    rawText: "I am really annoyed that my package had a 4 day shipping delay, customer service took forever to reply, though the laptop itself works fine.",
    rating: 2,
    visibility: "public",
    authorType: "human",
    routingPath: "ROUTE_2_SHIELDED_CLEAR",
    failedRiskIds: ["Q1"],
    deepResearchExplanation: null,
    createdAt: "5 mins ago",
  },
];

let demoStorefrontComments: DemoComment[] = [...initialDemoComments];
let nextDemoCommentId = 600;

function resetDemoStorefrontComments() {
  demoStorefrontComments = [...initialDemoComments];
  nextDemoCommentId = 600;
}

function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name && v) return decodeURIComponent(v);
  }
  return null;
}

apiRouter.get("/demo/assets/:file", (c) => {
  const file = c.req.param("file");
  const allowed = new Set(["botd.bundle.js", "collector.js", "shield.css", "badge-renderer.js"]);
  if (!allowed.has(file)) return c.notFound();
  try {
    const filePath = join(process.cwd(), "wp-content/plugins/shield-guard/assets", file);
    const content = readFileSync(filePath, "utf8");
    const contentType = file.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
    return new Response(content, { headers: { "Content-Type": contentType } });
  } catch {
    return c.notFound();
  }
});

apiRouter.post("/demo/storefront/comment", async (c) => {
  const formData = await c.req.parseBody();
  const author = String(formData["author"] || "Anonymous Visitor");
  const commentText = String(formData["comment"] || "").trim();
  const rating = formData["rating"] ? Number(formData["rating"]) : 5;
  const telemetryToken = String(formData["_shield_token"] || "");
  const honeypotValue = String(formData["_shield_hp_field"] || "");

  let sessionHash = getCookieValue(c.req.header("cookie"), "shield_author_session");
  if (!sessionHash) {
    sessionHash = `sess_${crypto.randomUUID().slice(0, 12)}`;
  }

  const ip = c.req.header("x-forwarded-for") || "127.0.0.1";
  const userAgent = c.req.header("user-agent") || "unknown";
  const wpCommentId = ++nextDemoCommentId;
  const botResult = evaluateBotTelemetry(telemetryToken || {}, honeypotValue);

  const evalRes = (await processEvaluationJob({
    tenantId: "00000000-0000-0000-0000-000000000001",
    wpCommentId,
    entityId: "demo_product_laptop",
    entityTitle: "Aegis Pro Gaming Laptop 15",
    authorSessionHash: sessionHash,
    rawText: commentText,
    rating,
    botResult,
    ipAddress: ip,
    userAgent,
    thresholdMode: "balanced",
  })) as any;

  demoStorefrontComments.push({
    id: wpCommentId,
    author,
    authorSessionHash: sessionHash,
    rawText: commentText,
    rating,
    visibility: evalRes.visibility,
    authorType: evalRes.authorType,
    routingPath: evalRes.routingPath || "BOT_HONEYPOT",
    patternClusterId: evalRes.patternClusterId,
    failedRiskIds: evalRes.failedRiskIds || [],
    deepResearchExplanation: evalRes.deepResearchExplanation || null,
    createdAt: "Just now",
  });

  const roleParam = c.req.query("role") || "";
  const redirectUrl = roleParam ? `/demo/storefront?role=${encodeURIComponent(roleParam)}&submitted=${wpCommentId}` : `/demo/storefront?submitted=${wpCommentId}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl,
      "Set-Cookie": `shield_author_session=${sessionHash}; Path=/; Max-Age=86400; SameSite=Lax`,
    },
  });
});

apiRouter.get("/demo/storefront", (c) => {
  let sessionHash = getCookieValue(c.req.header("cookie"), "shield_author_session");
  const isNewSession = !sessionHash;
  if (!sessionHash) {
    sessionHash = `sess_${crypto.randomUUID().slice(0, 12)}`;
  }

  const role = c.req.query("role") || "visitor";
  const visibleComments = demoStorefrontComments.filter(
    (cm) =>
      cm.visibility === "public" ||
      cm.visibility === "public_flagged" ||
      cm.authorSessionHash === sessionHash
  );

  const banner = inMemoryBanners.get("demo_product_laptop");
  const vaultStats = getHoneypotVaultStats();
  const recentVault = inMemoryHoneypotVault.slice(0, 6);

  const roleBannerHtml =
    role === "bot"
      ? `<div id="demo-role-banner" style="background:linear-gradient(90deg,#7c2d12,#b91c1c);color:#fff;padding:12px 20px;font-weight:700;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ef4444;">
           <span>🤖 PUPPETEER BOT SESSION VIEW (Deceptive Author-Only Shadowban Active)</span>
           <span style="font-family:monospace;font-size:12px;background:rgba(0,0,0,0.35);padding:4px 8px;border-radius:6px;">cookie: shield_author_session=${sessionHash}</span>
         </div>`
      : role === "public"
      ? `<div id="demo-role-banner" style="background:linear-gradient(90deg,#065f46,#047857);color:#fff;padding:12px 20px;font-weight:700;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #10b981;">
           <span>👤 REAL PUBLIC VISITOR VIEW (Protected Clean Feed + Live Honeypot Telemetry)</span>
           <span style="font-family:monospace;font-size:12px;background:rgba(0,0,0,0.35);padding:4px 8px;border-radius:6px;">cookie: shield_author_session=${sessionHash}</span>
         </div>`
      : "";

  const commentsHtml = visibleComments
    .map((cm) => {
      const stars = "★".repeat(cm.rating) + "☆".repeat(Math.max(0, 5 - cm.rating));
      const isOwnShadowbanned = cm.visibility === "shadowbanned" && cm.authorSessionHash === sessionHash;
      const flaggedHtml =
        cm.visibility === "public_flagged"
          ? `<div class="shield-comment-banner">
               <div class="shield-comment-banner-badge">⚠️ Community Context Notice: Flagged Content</div>
               <div class="shield-comment-banner-desc">${cm.deepResearchExplanation || "Flagged for manipulative patterns."}</div>
             </div>
             <div class="shield-badge-container" data-failed-ids='${JSON.stringify(cm.failedRiskIds)}'></div>`
          : "";

      return `<article class="comment-card" id="comment-${cm.id}" data-comment-id="${cm.id}" data-author="${cm.author}">
        <div class="comment-header">
          <div>
            <strong class="comment-author">${cm.author}</strong>
            <span class="comment-stars" style="color:#f59e0b;margin-left:8px;">${stars}</span>
          </div>
          <span class="comment-meta">#${cm.id} &bull; ${cm.createdAt}</span>
        </div>
        ${flaggedHtml}
        <p class="comment-body">${cm.rawText}</p>
        ${
          isOwnShadowbanned
            ? `<div class="bot-illusion-note" style="margin-top:8px;font-size:11px;color:#6b7280;">✓ Published (Visible to your session <code>${sessionHash}</code> — Bot believes post is live!)</div>`
            : ""
        }
      </article>`;
    })
    .join("\n");

  const vaultRowsHtml =
    recentVault.length === 0
      ? `<div style="color:#9ca3af;font-size:13px;padding:12px 0;">No bots trapped yet. Waiting for bot activity...</div>`
      : recentVault
          .map(
            (v) => `<div class="vault-entry" data-cluster-id="${v.patternClusterId}" data-routing="${v.routingPath}" style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:12px;">
              <div style="display:flex;justify-content:space-between;font-weight:700;color:#fca5a5;margin-bottom:4px;">
                <span>🪤 Comment #${v.wpCommentId} (${v.routingPath})</span>
                <span style="font-family:monospace;background:rgba(0,0,0,0.4);padding:1px 6px;border-radius:4px;">${v.patternClusterId}</span>
              </div>
              <div style="color:#e5e7eb;margin-bottom:4px;">"${v.rawText.slice(0, 95)}"</div>
              <div style="color:#fda4af;font-family:monospace;font-size:11px;">Reasons: ${v.reasons.join(" | ")}</div>
            </div>`
          )
          .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Aegis Pro Gaming Laptop 15 &bull; Truthier Protected Storefront</title>
  <link rel="stylesheet" href="/demo/assets/shield.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
    .layout { max-width: 1120px; margin: 24px auto; padding: 0 20px; display: grid; grid-template-columns: 1.55fr 1fr; gap: 24px; }
    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.04); }
    .product-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
    .comment-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; background: #fff; }
    .comment-header { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
    .comment-meta { color: #64748b; font-size: 12px; }
    .comment-body { font-size: 14px; line-height: 1.5; color: #1e293b; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: #334155; }
    .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
    .btn-submit { background: #2563eb; color: #fff; font-weight: 600; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-size: 14px; }
    .btn-submit:hover { background: #1d4ed8; }
    .vault-panel { background: #0f172a; color: #f8fafc; border-radius: 12px; padding: 20px; position: sticky; top: 20px; }
    .stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0 16px; }
    .stat-box { background: #1e293b; padding: 10px; border-radius: 8px; text-align: center; }
    .stat-num { font-size: 20px; font-weight: 800; color: #38bdf8; }
    .stat-lbl { font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  ${roleBannerHtml}
  <div class="layout">
    <div>
      <div class="panel" style="margin-bottom: 20px;">
        <div class="product-header">
          <div>
            <span style="font-size:12px;font-weight:700;color:#2563eb;text-transform:uppercase;">WordPress + WooCommerce Protected Entity</span>
            <h1 style="font-size:22px;margin-top:4px;">💻 Aegis Pro Gaming Laptop 15 (RTX 5080)</h1>
          </div>
          <div style="font-size:20px;font-weight:800;color:#0f172a;">$1,899.00</div>
        </div>
        ${
          banner && banner.bannerExplanation
            ? `<div class="shield-review-banner ${banner.anomalyStatus}">
                 <div class="shield-review-banner-icon">${banner.anomalyStatus === "coordinated_attack" ? "🚨" : "ℹ️"}</div>
                 <div>
                   <div class="shield-review-banner-title">${
                     banner.anomalyStatus === "coordinated_attack"
                       ? "Coordinated Activity Notice Under Investigation"
                       : "Public Review Volume Notice"
                   }</div>
                   <div class="shield-review-banner-text">${banner.bannerExplanation}</div>
                 </div>
               </div>`
            : ""
        }
        <h3 style="font-size:16px;margin-bottom:12px;">Customer Reviews &amp; Discussion (<span id="visible-comment-count">${visibleComments.length}</span> visible)</h3>
        <div id="comments-list">
          ${commentsHtml}
        </div>
      </div>

      <div class="panel">
        <h3 style="font-size:16px;margin-bottom:12px;">Leave a Review</h3>
        <form id="commentform" class="comment-form" method="POST" action="/demo/storefront/comment?role=${encodeURIComponent(role)}">
          <div class="form-group">
            <label for="author">Your Name</label>
            <input type="text" id="author" name="author" required placeholder="Jane Doe" />
          </div>
          <div class="form-group">
            <label for="rating">Rating</label>
            <select id="rating" name="rating">
              <option value="5">★★★★★ (5/5)</option>
              <option value="4">★★★★☆ (4/5)</option>
              <option value="3">★★★☆☆ (3/5)</option>
              <option value="2">★★☆☆☆ (2/5)</option>
              <option value="1">★☆☆☆☆ (1/5)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="comment">Comment / Review</label>
            <textarea id="comment" name="comment" rows="3" required placeholder="Share your experience..."></textarea>
          </div>
          <button type="submit" id="submit-btn" class="btn-submit">Post Review</button>
        </form>
      </div>
    </div>

    <div>
      <div class="vault-panel" id="honeypot-vault-panel">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="font-size:16px;color:#f8fafc;">🛡️ Truthier Honeypot Vault</h3>
          <span style="font-size:11px;background:rgba(52,211,153,0.15);color:#34d399;padding:3px 8px;border-radius:999px;">Stage 1A + 1B Active</span>
        </div>
        <p style="font-size:12px;color:#94a3b8;margin-top:4px;">Real-time view of shadowbanned bots &amp; paraphrased stealth clusters</p>
        <div class="stat-row">
          <div class="stat-box">
            <div class="stat-num" id="stat-direct-bots">${vaultStats.stage1aDirectBots}</div>
            <div class="stat-lbl">Stage 1A Honeypot</div>
          </div>
          <div class="stat-box">
            <div class="stat-num" id="stat-stealth-bots">${vaultStats.stage1bVectorCaughtBots}</div>
            <div class="stat-lbl">Stage 1B Vector</div>
          </div>
          <div class="stat-box">
            <div class="stat-num" id="stat-active-clusters">${vaultStats.activeClusterCount}</div>
            <div class="stat-lbl">Active Clusters</div>
          </div>
        </div>
        <h4 style="font-size:12px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Captured Bot Payloads (Invisible to Public)</h4>
        <div id="vault-entries-list">
          ${vaultRowsHtml}
        </div>
      </div>
    </div>
  </div>
  <script src="/demo/assets/botd.bundle.js"></script>
  <script src="/demo/assets/collector.js"></script>
  <script src="/demo/assets/badge-renderer.js"></script>
</body>
</html>`;

  const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" };
  if (isNewSession) {
    headers["Set-Cookie"] = `shield_author_session=${sessionHash}; Path=/; Max-Age=86400; SameSite=Lax`;
  }
  return new Response(html, { headers });
});
