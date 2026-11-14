import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { createHmac } from "crypto";
import { db } from "../db";
import { submissions, honeypotVault, entityBanners, tenants } from "../db/schema";
import { eq } from "drizzle-orm";
import { screenWithJev } from "../ai/jev-screener";
import { evaluateSemEvalBitmask, type ThresholdMode } from "../engines/semeval-scorer";
import { verifyStanceOrForensic, investigateReviewBombing } from "../ai/hydrogen-research";
import type { BotEvaluationResult } from "../engines/bot-telemetry";
import { debugLog, debugDecision } from "../config/logger";

export interface EvaluationJobData {
  wpCommentId: number;
  entityId: string;
  entityTitle?: string;
  authorSessionHash: string;
  rawText: string;
  rating?: number | null;
  botResult: BotEvaluationResult;
  ipAddress: string;
  userAgent: string;
  tenantApiKey?: string;
  wpWebhookUrl?: string;
  thresholdMode?: ThresholdMode;
}

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

let redisConnection: Redis | null = null;
let evaluationQueue: Queue<EvaluationJobData> | null = null;

export const inMemoryBanners = new Map<string, { entityId: string; anomalyStatus: string; bannerExplanation: string | null }>();
const inMemoryReviewTracker = new Map<string, Array<{ rating: number; text: string; createdAt: Date }>>();

function getRedisConnection(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 100, 2000);
      },
    });
    redisConnection.on("error", (err) => {
      console.warn(`Redis connection warning: ${err.message}`);
    });
  }
  return redisConnection;
}

export function getEvaluationQueue(): Queue<EvaluationJobData> | null {
  try {
    if (!evaluationQueue) {
      const conn = getRedisConnection();
      evaluationQueue = new Queue<EvaluationJobData>("shield-evaluation", {
        connection: conn,
      });
    }
    return evaluationQueue;
  } catch (err: any) {
    console.warn(`Failed to initialize BullMQ queue: ${err.message}`);
    return null;
  }
}

/**
 * Dispatches webhook back to WordPress with HMAC SHA256 signature.
 */
export async function sendWordPressWebhook(
  targetUrl: string,
  payload: Record<string, any>,
  secret = process.env.WP_WEBHOOK_SECRET || "shield_shared_secret"
): Promise<boolean> {
  const hasBanner = !!payload.banner;
  debugLog("Webhook", `Dispatching webhook to ${targetUrl}`, {
    commentId: payload.wpCommentId,
    visibility: payload.visibility,
    authorType: payload.authorType,
    modelUsed: payload.modelUsed || "none",
    hasBanner,
    bannerStatus: payload.banner?.anomalyStatus || null,
  });

  try {
    const bodyStr = JSON.stringify(payload);
    const hmac = createHmac("sha256", secret).update(bodyStr).digest("hex");

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shield-Signature": `sha256=${hmac}`,
      },
      body: bodyStr,
    });

    if (!res.ok) {
      debugLog("Webhook", `Webhook delivery failed with HTTP ${res.status}`);
      return false;
    }
    debugLog("Webhook", `Webhook delivered successfully with HTTP ${res.status}`);
    return true;
  } catch (err: any) {
    debugLog("Webhook", `Webhook delivery network error: ${err.message}`);
    return false;
  }
}

/**
 * Core processing logic for an evaluation job.
 */
export async function processEvaluationJob(data: EvaluationJobData) {
  const {
    wpCommentId,
    entityId,
    entityTitle = "Product/Post",
    authorSessionHash,
    rawText,
    rating,
    botResult,
    ipAddress,
    userAgent,
    wpWebhookUrl = process.env.WP_DEFAULT_WEBHOOK_URL || "http://127.0.0.1:8080/wp-json/shield/v1/webhook",
    thresholdMode = "balanced",
  } = data;

  debugLog("Worker", `Starting evaluation for comment #${wpCommentId} on ${entityId}`, {
    rating,
    authorType: botResult.isBot ? "bot" : "human",
    thresholdMode,
  });

  // 1. Bot Path
  if (botResult.isBot) {
    debugDecision("Worker", "BOT_PATH_ENGAGED", {
      wpCommentId,
      visibility: "shadowbanned",
      reasons: botResult.reasons,
    });

    let subId = crypto.randomUUID();
    try {
      const [sub] = await db
        .insert(submissions)
        .values({
          wpCommentId,
          entityId,
          authorSessionHash,
          rawText,
          rating: rating ?? null,
          authorType: "bot",
          visibility: "shadowbanned",
          routingPath: "BOT_HONEYPOT",
          modelUsed: "none",
          riskScore: 100,
          shieldFlags: 0,
          failedRiskIds: [],
          triggeredShieldIds: [],
          deepResearchExplanation: null,
        })
        .returning();
      if (sub) subId = sub.id;

      await db.insert(honeypotVault).values({
        submissionId: subId,
        ipAddress,
        userAgent,
        telemetryJson: {
          ...botResult.telemetry,
          confidenceScore: botResult.confidenceScore,
          reasons: botResult.reasons,
        },
        patternClusterId: "cluster_headless_generic",
      });
      debugLog("Worker", `Honeypot vault entry recorded for comment #${wpCommentId}`);
    } catch (dbErr: any) {
      console.warn(`DB insert failed for bot submission: ${dbErr.message}`);
    }

    // Notify WordPress to mark comment shadowbanned
    await sendWordPressWebhook(wpWebhookUrl, {
      wpCommentId,
      entityId,
      visibility: "shadowbanned",
      authorType: "bot",
      modelUsed: "none",
      riskScore: 100,
      failedRiskIds: [],
      triggeredShieldIds: [],
      deepResearchExplanation: null,
      banner: null,
    });

    return {
      wpCommentId,
      visibility: "shadowbanned",
      authorType: "bot",
      modelUsed: "none",
      hasBanner: false,
    };
  }

  // 2. Human Path: Run Jev Fast Screener
  debugLog("Worker", `Running Stage 1 screener for human comment #${wpCommentId}`);
  const jevRes = await screenWithJev(rawText);

  // Run Deterministic 50-Question Scorer
  const scoreRes = evaluateSemEvalBitmask({
    triggeredIds: jevRes.triggeredIds,
    mode: thresholdMode,
  });

  let visibility: "public" | "public_flagged" | "shadowbanned" = "public";
  let modelUsed: "none" | "jev" | "gemini-4-hydrogen" = "jev";
  let explanation: string | null = null;

  // Escalation check
  if (scoreRes.escalateToHydrogen) {
    debugDecision("Worker", "ESCALATING_TO_HYDROGEN", {
      route: scoreRes.route,
      failedRiskIds: scoreRes.failedRiskIds,
    });

    modelUsed = "gemini-4-hydrogen";
    const forensicRes = await verifyStanceOrForensic(
      rawText,
      scoreRes.route === "ROUTE_3_STANCE_VERIFICATION"
        ? "ROUTE_3_STANCE_VERIFICATION"
        : "ROUTE_4_FORENSIC_THREAT",
      scoreRes.failedRiskIds
    );

    if (!forensicRes.endorsed) {
      visibility = "public";
      explanation = null;
      debugDecision("Worker", `${scoreRes.route}_CLEARED_AS_BENIGN`, {
        commentId: wpCommentId,
        visibility: "public",
      });
    } else {
      visibility = "public_flagged";
      explanation = forensicRes.deepResearchExplanation;
      debugDecision("Worker", "FORENSIC_THREAT_CONFIRMED", {
        commentId: wpCommentId,
        visibility: "public_flagged",
        hasExplanation: !!explanation,
      });
    }
  } else {
    visibility = "public";
    modelUsed = "jev";
    explanation = null;
    debugDecision("Worker", `CLEARED_BY_FAST_PATH (${scoreRes.route})`, {
      commentId: wpCommentId,
      visibility: "public",
      riskScore: scoreRes.riskScore,
    });
  }

  // Save submission to PostgreSQL
  try {
    await db.insert(submissions).values({
      wpCommentId,
      entityId,
      authorSessionHash,
      rawText,
      rating: rating ?? null,
      authorType: "human",
      visibility,
      routingPath: scoreRes.route,
      modelUsed,
      riskScore: scoreRes.riskScore,
      shieldFlags: scoreRes.shieldFlags,
      failedRiskIds: scoreRes.failedRiskIds,
      triggeredShieldIds: scoreRes.triggeredShieldIds,
      deepResearchExplanation: explanation,
    });
    debugLog("Worker", `Recorded submission #${wpCommentId} to database (visibility: ${visibility})`);
  } catch (dbErr: any) {
    console.warn(`DB insert failed for human submission: ${dbErr.message}`);
  }

  // Review Bombing Velocity Tracker for ratings
  let bannerPayload: { anomalyStatus: string; bannerExplanation: string | null } | null = null;
  if (typeof rating === "number" && rating <= 2) {
    try {
      const banner = await checkReviewBombingSpike(entityId, entityTitle, rating, rawText);
      if (banner) {
        bannerPayload = banner;
      }
    } catch (e: any) {
      console.warn(`Review bombing check warning: ${e.message}`);
    }
  }

  // If comment is public_flagged (Route 4 / Coordinated Disinformation Threat), attach entity banner notice!
  if (visibility === "public_flagged" && !bannerPayload) {
    const bannerExplanation = explanation
      ? `Notice: Coordinated manipulation or disputed framing was detected in discussions for "${entityTitle}". Review the forensic context attached to flagged comments.`
      : `Notice: Content on "${entityTitle}" has been flagged by automated forensic checks for potential coordinated framing.`;

    bannerPayload = {
      anomalyStatus: "coordinated_attack",
      bannerExplanation,
    };

    inMemoryBanners.set(entityId, {
      entityId,
      anomalyStatus: bannerPayload.anomalyStatus,
      bannerExplanation: bannerPayload.bannerExplanation,
    });

    try {
      await db
        .insert(entityBanners)
        .values({
          entityId,
          anomalyStatus: bannerPayload.anomalyStatus,
          bannerExplanation: bannerPayload.bannerExplanation,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: entityBanners.entityId,
          set: {
            anomalyStatus: bannerPayload.anomalyStatus,
            bannerExplanation: bannerPayload.bannerExplanation,
            updatedAt: new Date(),
          },
        });
      debugDecision("Worker", "ENTITY_BANNER_ACTIVATED_FOR_FLAGGED_CONTENT", {
        entityId,
        anomalyStatus: bannerPayload.anomalyStatus,
        bannerExplanation,
      });
    } catch (dbErr: any) {
      console.warn(`Failed to update entity banner in DB: ${dbErr.message}`);
    }
  }

  // Webhook back to WordPress
  await sendWordPressWebhook(wpWebhookUrl, {
    wpCommentId,
    entityId,
    visibility,
    authorType: "human",
    modelUsed,
    riskScore: scoreRes.riskScore,
    failedRiskIds: scoreRes.failedRiskIds,
    triggeredShieldIds: scoreRes.triggeredShieldIds,
    deepResearchExplanation: explanation,
    banner: bannerPayload,
  });

  return {
    wpCommentId,
    visibility,
    authorType: "human",
    modelUsed,
    riskScore: scoreRes.riskScore,
    failedRiskIds: scoreRes.failedRiskIds,
    triggeredShieldIds: scoreRes.triggeredShieldIds,
    deepResearchExplanation: explanation,
    banner: bannerPayload,
    hasBanner: !!bannerPayload,
  };
}

async function checkReviewBombingSpike(
  entityId: string,
  entityTitle: string,
  rating: number,
  text: string
): Promise<{ anomalyStatus: "legitimate_backlash" | "coordinated_attack" | "normal"; bannerExplanation: string | null } | null> {
  const reviews = inMemoryReviewTracker.get(entityId) || [];
  reviews.push({ rating, text, createdAt: new Date() });
  inMemoryReviewTracker.set(entityId, reviews);

  const oneStarReviews = reviews.filter((r) => r.rating <= 2);
  debugLog("VelocityTracker", `Rolling negative review count for ${entityId}: ${oneStarReviews.length}`);

  if (oneStarReviews.length >= 3) {
    debugDecision("VelocityTracker", "NEGATIVE_REVIEW_SPIKE_TRIGGERED", {
      entityId,
      entityTitle,
      negativeCount: oneStarReviews.length,
    });

    const investigation = await investigateReviewBombing(entityId, entityTitle, oneStarReviews);

    inMemoryBanners.set(entityId, {
      entityId,
      anomalyStatus: investigation.anomalyStatus,
      bannerExplanation: investigation.bannerExplanation,
    });

    try {
      await db
        .insert(entityBanners)
        .values({
          entityId,
          anomalyStatus: investigation.anomalyStatus,
          bannerExplanation: investigation.bannerExplanation,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: entityBanners.entityId,
          set: {
            anomalyStatus: investigation.anomalyStatus,
            bannerExplanation: investigation.bannerExplanation,
            updatedAt: new Date(),
          },
        });
    } catch (dbErr: any) {
      console.warn(`Failed to update entity banner in DB: ${dbErr.message}`);
    }

    return {
      anomalyStatus: investigation.anomalyStatus,
      bannerExplanation: investigation.bannerExplanation,
    };
  }

  return null;
}

export function startWorker(): Worker<EvaluationJobData> | null {
  try {
    const conn = getRedisConnection();
    const worker = new Worker<EvaluationJobData>(
      "shield-evaluation",
      async (job: Job<EvaluationJobData>) => {
        debugLog("BullMQ", `Processing queued job ${job.id} for comment #${job.data.wpCommentId}`);
        return processEvaluationJob(job.data);
      },
      { connection: conn, concurrency: 5 }
    );

    worker.on("completed", (job) => {
      debugLog("BullMQ", `Job ${job.id} completed (comment #${job.data.wpCommentId})`);
    });

    worker.on("failed", (job, err) => {
      console.error(`[BullMQ Worker] Job ${job?.id} failed:`, err.message);
    });

    return worker;
  } catch (err: any) {
    console.warn(`Failed to start BullMQ worker: ${err.message}`);
    return null;
  }
}
