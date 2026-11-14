import { Hono } from "hono";
import { db, sql } from "../db";
import { submissions, honeypotVault, entityBanners } from "../db/schema";
import { SEMEVAL_QUESTIONS, BUCKET_NAMES } from "../config/semeval-questions";
import {
  computeLocalEmbedding,
  cosineSimilarity,
  toPgVectorLiteral,
} from "../ai/embeddings";
import {
  resolveOriginGeo,
  buildRegionalScanSummary,
  WORLD_REGIONS,
  type OriginGeoInfo,
} from "../engines/geo-intel";
import {
  inMemorySubmissions,
  inMemoryHoneypot,
  inMemoryBanners,
  activeThresholdMode,
  type InMemorySubmissionRecord,
} from "../workers/evaluation-worker";
import { detectCoordinatedSwarms } from "../engines/coordination-detector";
import {
  cleanTrafficLogs,
  generateRealisticTrafficLogs,
  type TrafficCleanReport,
} from "../engines/traffic-cleaner";

export const dashboardApiRouter = new Hono();

let currentTrafficLogs = generateRealisticTrafficLogs();

let schemaChecked = false;
let pgvectorAvailable = false;
let dbReachable = false;
let initialSeedAttempted = false;
let userClearedSeed = false;

export const SEED_HASH_PREFIX = "seed_demo_";

interface UnifiedSubmission {
  id: string;
  wpCommentId: number;
  entityId: string;
  authorSessionHash: string;
  rawText: string;
  rating: number | null;
  authorType: "human" | "bot";
  visibility: "pending" | "public" | "public_flagged" | "shadowbanned";
  routingPath: string;
  modelUsed: string;
  riskScore: number;
  shieldFlags: number;
  failedRiskIds: string[];
  triggeredShieldIds: string[];
  deepResearchExplanation: string | null;
  createdAt: string;
  embedding: number[];
  origin: OriginGeoInfo;
  similarityScore?: number | null;
  honeypot: {
    ipAddress: string;
    userAgent: string;
    confidenceScore: number;
    reasons: string[];
    patternClusterId: string | null;
    telemetry: Record<string, any>;
  } | null;
  riskTagDetails: Array<{
    id: string;
    name: string;
    bucket: number;
    bucketName: string;
    points: number;
    tier?: number;
    description: string;
  }>;
  shieldTagDetails: Array<{
    id: string;
    name: string;
    bucket: number;
    bucketName: string;
    flags: number;
    description: string;
  }>;
}

const DEMO_SEED_ITEMS = [
  // Bots caught in Honeypot Vault
  {
    wpCommentId: 901,
    entityId: "product_quantum_router",
    authorSessionHash: "bot_88f1a90c",
    rawText: "🔥 Best Crypto Airdrop 2026! Claim 5,000 USDT instant reward at http://claim-airdrop-fast.xyz before timer expires!!",
    rating: 5,
    authorType: "bot" as const,
    visibility: "shadowbanned" as const,
    routingPath: "BOT_HONEYPOT",
    modelUsed: "none",
    riskScore: 100,
    shieldFlags: 0,
    failedRiskIds: ["Q4", "Q41", "Q43"],
    triggeredShieldIds: [],
    deepResearchExplanation: null,
    hoursAgo: 1.5,
    honeypot: {
      ipAddress: "185.220.101.44",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/122.0.0.0",
      confidenceScore: 98,
      reasons: ["honeypot_filled", "webdriver_detected", "zero_interaction_events", "fast_submission_140ms"],
      patternClusterId: "cluster_crypto_spam_botnet",
      telemetry: { mouseMoves: 0, keyPresses: 0, timeToSubmitMs: 140, webdriver: true, honeypotPopulated: true },
    },
  },
  {
    wpCommentId: 902,
    entityId: "product_quantum_router",
    authorSessionHash: "bot_88f1a91d",
    rawText: "🚀 Claim 5,000 USDT free token distribution now at http://claim-airdrop-fast.xyz ! Instant wallet payout guaranteed 100%!",
    rating: 5,
    authorType: "bot" as const,
    visibility: "shadowbanned" as const,
    routingPath: "BOT_HONEYPOT",
    modelUsed: "none",
    riskScore: 100,
    shieldFlags: 0,
    failedRiskIds: ["Q4", "Q7", "Q41", "Q44"],
    triggeredShieldIds: [],
    deepResearchExplanation: null,
    hoursAgo: 3.2,
    honeypot: {
      ipAddress: "185.220.101.49",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/122.0.0.0",
      confidenceScore: 96,
      reasons: ["webdriver_detected", "zero_interaction_events", "fast_submission_185ms"],
      patternClusterId: "cluster_crypto_spam_botnet",
      telemetry: { mouseMoves: 0, keyPresses: 0, timeToSubmitMs: 185, webdriver: true, honeypotPopulated: false },
    },
  },
  {
    wpCommentId: 903,
    entityId: "post_firmware_v4_2",
    authorSessionHash: "bot_44c9e112",
    rawText: "THIS COMPANY IS CONTROLLED BY THE GLOBALIST CABAL!! Share this immediately before the regime deletes our comments! Wake up sheeple!!",
    rating: 1,
    authorType: "bot" as const,
    visibility: "shadowbanned" as const,
    routingPath: "BOT_HONEYPOT",
    modelUsed: "none",
    riskScore: 100,
    shieldFlags: 0,
    failedRiskIds: ["Q4", "Q17", "Q20", "Q41", "Q44"],
    triggeredShieldIds: [],
    deepResearchExplanation: null,
    hoursAgo: 6.5,
    honeypot: {
      ipAddress: "91.132.147.88",
      userAgent: "python-requests/2.31.0",
      confidenceScore: 100,
      reasons: ["honeypot_filled", "zero_interaction_events", "missing_telemetry_token"],
      patternClusterId: "cluster_brigade_script_v2",
      telemetry: { mouseMoves: 0, keyPresses: 0, timeToSubmitMs: 45, webdriver: true, honeypotPopulated: true },
    },
  },
  {
    wpCommentId: 904,
    entityId: "post_firmware_v4_2",
    authorSessionHash: "bot_44c9e199",
    rawText: "THE SHADOWY REGIME CONTROLS THIS PLATFORM!! Spread this everywhere before censorship wipes the truth! Wake up sheeple!",
    rating: 1,
    authorType: "bot" as const,
    visibility: "shadowbanned" as const,
    routingPath: "BOT_HONEYPOT",
    modelUsed: "none",
    riskScore: 100,
    shieldFlags: 0,
    failedRiskIds: ["Q4", "Q17", "Q20", "Q41", "Q44"],
    triggeredShieldIds: [],
    deepResearchExplanation: null,
    hoursAgo: 18.0,
    honeypot: {
      ipAddress: "91.132.147.92",
      userAgent: "Playwright/1.42.0 (Chromium 123.0)",
      confidenceScore: 95,
      reasons: ["webdriver_detected", "linear_mouse_path", "fast_submission_220ms"],
      patternClusterId: "cluster_brigade_script_v2",
      telemetry: { mouseMoves: 2, keyPresses: 0, timeToSubmitMs: 220, webdriver: true, honeypotPopulated: false },
    },
  },
  {
    wpCommentId: 905,
    entityId: "product_cloud_firewall",
    authorSessionHash: "bot_77d2b101",
    rawText: "Cheap meds & discount pharmacy no prescription required -> http://meds-express-24.biz #health #discount #free",
    rating: 5,
    authorType: "bot" as const,
    visibility: "shadowbanned" as const,
    routingPath: "BOT_HONEYPOT",
    modelUsed: "none",
    riskScore: 100,
    shieldFlags: 0,
    failedRiskIds: ["Q43"],
    triggeredShieldIds: [],
    deepResearchExplanation: null,
    hoursAgo: 42.0,
    honeypot: {
      ipAddress: "45.155.205.19",
      userAgent: "curl/8.4.0",
      confidenceScore: 100,
      reasons: ["honeypot_filled", "zero_interaction_events"],
      patternClusterId: "cluster_headless_generic",
      telemetry: { mouseMoves: 0, keyPresses: 0, timeToSubmitMs: 30, webdriver: false, honeypotPopulated: true },
    },
  },
  {
    wpCommentId: 906,
    entityId: "product_cloud_firewall",
    authorSessionHash: "bot_99a4c302",
    rawText: "Guaranteed 500% daily forex profit! Message our official WhatsApp advisor +1-555-0199 or visit http://fx-wealth-pro.io now!",
    rating: 5,
    authorType: "bot" as const,
    visibility: "shadowbanned" as const,
    routingPath: "BOT_HONEYPOT",
    modelUsed: "none",
    riskScore: 100,
    shieldFlags: 0,
    failedRiskIds: ["Q7", "Q42"],
    triggeredShieldIds: [],
    deepResearchExplanation: null,
    hoursAgo: 96.0,
    honeypot: {
      ipAddress: "194.26.135.71",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PhantomJS/2.1.1",
      confidenceScore: 94,
      reasons: ["webdriver_detected", "zero_interaction_events"],
      patternClusterId: "cluster_crypto_spam_botnet",
      telemetry: { mouseMoves: 0, keyPresses: 0, timeToSubmitMs: 310, webdriver: true, honeypotPopulated: false },
    },
  },

  // Human Route 4: Forensic Threat / Coordinated Disinformation (Public Flagged)
  {
    wpCommentId: 907,
    entityId: "post_firmware_v4_2",
    authorSessionHash: "hum_31a8f002",
    rawText: "Everyone knows the puppet masters running this company are traitors trying to destroy our way of life! Either you boycott them right now or you're complicit—share before they censor this!",
    rating: 1,
    authorType: "human" as const,
    visibility: "public_flagged" as const,
    routingPath: "ROUTE_4_FORENSIC_THREAT",
    modelUsed: "gemini-4-hydrogen",
    riskScore: 16,
    shieldFlags: 0,
    failedRiskIds: ["Q1", "Q7", "Q17", "Q18", "Q20", "Q26", "Q41"],
    triggeredShieldIds: [],
    deepResearchExplanation:
      "Forensic analysis identified coordinated manipulative framing combining Shadowy Cabal Framing (Q17), Existential Fear Appeal (Q18), Black-and-White Fallacy (Q26), and Artificial Urgency (Q41) without verifiable product claims.",
    hoursAgo: 2.4,
    honeypot: null,
  },
  {
    wpCommentId: 908,
    entityId: "post_security_advisory",
    authorSessionHash: "hum_62c1d440",
    rawText: "These developers are parasites and scumbags who secretively sell every user's banking data to the regime. 100% undeniable proof that all of them are corrupt!",
    rating: 1,
    authorType: "human" as const,
    visibility: "public_flagged" as const,
    routingPath: "ROUTE_4_FORENSIC_THREAT",
    modelUsed: "gemini-4-hydrogen",
    riskScore: 13,
    shieldFlags: 0,
    failedRiskIds: ["Q7", "Q8", "Q9", "Q10", "Q14", "Q16"],
    triggeredShieldIds: [],
    deepResearchExplanation:
      "Content employs Dehumanizing Metaphors (Q8), Sweeping Stereotypes (Q10), and Unbacked Absolutes (Q7) to allege unverified criminal misconduct without citing technical evidence.",
    hoursAgo: 28.0,
    honeypot: null,
  },

  // Human Route 2: Shielded Consumer Venting (Public Clean)
  {
    wpCommentId: 909,
    entityId: "product_quantum_router",
    authorSessionHash: "hum_19b7e211",
    rawText: "I'm so annoyed! My order #48219 was delayed by 4 days and after installing firmware v4.2 the Wi-Fi drops every 20 minutes. Terrible update, please fix this bug or issue a refund!",
    rating: 1,
    authorType: "human" as const,
    visibility: "public" as const,
    routingPath: "ROUTE_2_SHIELDED_VENTING",
    modelUsed: "jev",
    riskScore: 3,
    shieldFlags: 3,
    failedRiskIds: ["Q1", "Q4"],
    triggeredShieldIds: ["Q49", "Q50"],
    deepResearchExplanation: null,
    hoursAgo: 4.1,
    honeypot: null,
  },
  {
    wpCommentId: 910,
    entityId: "product_quantum_router",
    authorSessionHash: "hum_55d9a834",
    rawText: "Patch v4.2 broke VLAN tagging on port 4 and caused a crash under heavy load. Really frustrated with customer service delay, hoping hotfix v4.2.1 resolves it soon.",
    rating: 2,
    authorType: "human" as const,
    visibility: "public" as const,
    routingPath: "ROUTE_2_SHIELDED_VENTING",
    modelUsed: "jev",
    riskScore: 2,
    shieldFlags: 3,
    failedRiskIds: ["Q1"],
    triggeredShieldIds: ["Q49", "Q50"],
    deepResearchExplanation: null,
    hoursAgo: 12.0,
    honeypot: null,
  },

  // Human Route 3: Stance Verification (Quoting / Debunking -> Cleared as Public)
  {
    wpCommentId: 911,
    entityId: "post_firmware_v4_2",
    authorSessionHash: "hum_81f2c905",
    rawText: "According to the security audit report on page 4, trolls claimed that \"the router is controlled by a shadowy cabal\", which is completely false—the telemetry spike was just a standard NTP sync bug.",
    rating: 4,
    authorType: "human" as const,
    visibility: "public" as const,
    routingPath: "ROUTE_3_STANCE_VERIFICATION",
    modelUsed: "gemini-4-hydrogen",
    riskScore: 6,
    shieldFlags: 6,
    failedRiskIds: ["Q17"],
    triggeredShieldIds: ["Q46", "Q47", "Q49"],
    deepResearchExplanation: null,
    hoursAgo: 8.5,
    honeypot: null,
  },

  // Human Route 1: Fast Clear (Public Clean)
  {
    wpCommentId: 912,
    entityId: "product_cloud_firewall",
    authorSessionHash: "hum_70a3b118",
    rawText: "Installed the Truthier WordPress plugin alongside our WooCommerce store yesterday. Setup took 5 minutes and latency on comment submission is unnoticeable.",
    rating: 5,
    authorType: "human" as const,
    visibility: "public" as const,
    routingPath: "ROUTE_1_FAST_CLEAR",
    modelUsed: "jev",
    riskScore: 0,
    shieldFlags: 2,
    failedRiskIds: [],
    triggeredShieldIds: ["Q48"],
    deepResearchExplanation: null,
    hoursAgo: 0.8,
    honeypot: null,
  },
  {
    wpCommentId: 913,
    entityId: "product_quantum_router",
    authorSessionHash: "hum_92e4d710",
    rawText: "On one hand the hardware build quality and throughput are awesome, but on the other hand the v4.2 admin UI takes a little getting used to. Overall solid value.",
    rating: 4,
    authorType: "human" as const,
    visibility: "public" as const,
    routingPath: "ROUTE_1_FAST_CLEAR",
    modelUsed: "jev",
    riskScore: 0,
    shieldFlags: 1,
    failedRiskIds: [],
    triggeredShieldIds: ["Q48"],
    deepResearchExplanation: null,
    hoursAgo: 52.0,
    honeypot: null,
  },
  {
    wpCommentId: 914,
    entityId: "post_security_advisory",
    authorSessionHash: "hum_14c8a331",
    rawText: "Thanks for publishing the CVE breakdown and SHA256 verification steps. Upgraded all three nodes without downtime.",
    rating: 5,
    authorType: "human" as const,
    visibility: "public" as const,
    routingPath: "ROUTE_1_FAST_CLEAR",
    modelUsed: "jev",
    riskScore: 0,
    shieldFlags: 2,
    failedRiskIds: [],
    triggeredShieldIds: ["Q49"],
    deepResearchExplanation: null,
    hoursAgo: 120.0,
    honeypot: null,
  },

  // Additional Regional Propaganda & Bot Origins (covering Middle East, East Asia, South America, North America)
  {
    wpCommentId: 915,
    entityId: "post_security_advisory",
    authorSessionHash: "hum_41e7b908",
    rawText: "Wake up!! Western intelligence backdoors are hidden inside every cloud patch. Only fools trust these puppets—share this warning everywhere before they silence us!",
    rating: 1,
    authorType: "human" as const,
    visibility: "public_flagged" as const,
    routingPath: "ROUTE_4_FORENSIC_THREAT",
    modelUsed: "gemini-4-hydrogen",
    riskScore: 14,
    shieldFlags: 0,
    failedRiskIds: ["Q5", "Q17", "Q19", "Q25", "Q41"],
    triggeredShieldIds: [],
    deepResearchExplanation:
      "Forensic evaluation detected State Conspiracy Framing (Q17), Emotional Scare Tactics (Q19), and Artificial Urgency (Q41) lacking technical CVE citations.",
    hoursAgo: 5.0,
    honeypot: null,
  },
  {
    wpCommentId: 916,
    entityId: "product_cloud_firewall",
    authorSessionHash: "hum_73f9a112",
    rawText: "Total scam product built to spy on small businesses! Nobody with a brain uses this garbage—switch to offshore alternatives today or regret it forever!",
    rating: 1,
    authorType: "human" as const,
    visibility: "public_flagged" as const,
    routingPath: "ROUTE_4_FORENSIC_THREAT",
    modelUsed: "gemini-4-hydrogen",
    riskScore: 12,
    shieldFlags: 0,
    failedRiskIds: ["Q7", "Q10", "Q20", "Q44"],
    triggeredShieldIds: [],
    deepResearchExplanation:
      "Forensic analysis identified Unbacked Absolutes (Q7), Sweeping Stereotypes (Q10), and Coercive Migration Framing (Q44) without concrete bug details.",
    hoursAgo: 14.0,
    honeypot: null,
  },
  {
    wpCommentId: 917,
    entityId: "product_quantum_router",
    authorSessionHash: "bot_33e9f410",
    rawText: "Instant 400% investment return guaranteed!! Contact Telegram @wealth_bot_br immediately for automated trading signals!",
    rating: 5,
    authorType: "bot" as const,
    visibility: "shadowbanned" as const,
    routingPath: "BOT_HONEYPOT",
    modelUsed: "none",
    riskScore: 100,
    shieldFlags: 0,
    failedRiskIds: ["Q42", "Q43"],
    triggeredShieldIds: [],
    deepResearchExplanation: null,
    hoursAgo: 9.0,
    honeypot: {
      ipAddress: "177.54.145.62",
      userAgent: "HeadlessChrome/121.0.0.0",
      confidenceScore: 97,
      reasons: ["honeypot_filled", "zero_interaction_events", "fast_submission_160ms"],
      patternClusterId: "cluster_brigade_script_v2",
      telemetry: { mouseMoves: 0, keyPresses: 0, timeToSubmitMs: 160, webdriver: true, honeypotPopulated: true },
    },
  },
  {
    wpCommentId: 918,
    entityId: "post_firmware_v4_2",
    authorSessionHash: "bot_61b8d209",
    rawText: "THE CORRUPT ELITES ARE HIDING THE TRUTH ABOUT FIRMWARE v4.2!! Repost this everywhere before deletion!!",
    rating: 1,
    authorType: "bot" as const,
    visibility: "shadowbanned" as const,
    routingPath: "BOT_HONEYPOT",
    modelUsed: "none",
    riskScore: 100,
    shieldFlags: 0,
    failedRiskIds: ["Q17", "Q26", "Q41"],
    triggeredShieldIds: [],
    deepResearchExplanation: null,
    hoursAgo: 20.0,
    honeypot: {
      ipAddress: "104.244.76.19",
      userAgent: "Playwright/1.44.0 (Headless)",
      confidenceScore: 99,
      reasons: ["webdriver_detected", "zero_interaction_events", "fast_submission_115ms"],
      patternClusterId: "cluster_brigade_script_v2",
      telemetry: { mouseMoves: 0, keyPresses: 0, timeToSubmitMs: 115, webdriver: true, honeypotPopulated: false },
    },
  },
];

export async function ensureDashboardSchema(): Promise<{
  dbConnected: boolean;
  pgvectorEnabled: boolean;
}> {
  if (schemaChecked && dbReachable) {
    return { dbConnected: dbReachable, pgvectorEnabled: pgvectorAvailable };
  }

  try {
    await sql`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    pgvectorAvailable = false;
    return { dbConnected: false, pgvectorEnabled: false };
  }

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    pgvectorAvailable = true;
  } catch {
    pgvectorAvailable = false;
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        api_key text NOT NULL UNIQUE,
        wp_webhook_url text NOT NULL,
        webhook_secret text,
        threshold_mode text NOT NULL DEFAULT 'balanced',
        created_at timestamp NOT NULL DEFAULT now()
      );
    `;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_secret text`;
    await sql`
      CREATE TABLE IF NOT EXISTS submissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id text,
        wp_comment_id integer NOT NULL,
        entity_id text NOT NULL,
        author_session_hash text NOT NULL,
        raw_text text NOT NULL,
        rating integer,
        author_type text NOT NULL,
        visibility text NOT NULL,
        routing_path text NOT NULL,
        model_used text NOT NULL,
        risk_score integer NOT NULL DEFAULT 0,
        shield_flags integer NOT NULL DEFAULT 0,
        failed_risk_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        triggered_shield_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        deep_research_explanation text,
        research_evidence jsonb,
        origin_country_code text,
        origin_country text,
        origin_region text,
        origin_city text,
        origin_lat double precision,
        origin_lng double precision,
        origin_network text,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS tenant_id text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS research_evidence jsonb`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS origin_country_code text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS origin_country text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS origin_region text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS origin_city text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS origin_lat double precision`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS origin_lng double precision`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS origin_network text`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS submissions_tenant_comment_idx ON submissions (tenant_id, wp_comment_id)`;
    await sql`CREATE INDEX IF NOT EXISTS submissions_velocity_idx ON submissions (tenant_id, entity_id, created_at)`;
    await sql`
      CREATE TABLE IF NOT EXISTS honeypot_vault (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        ip_address text NOT NULL,
        user_agent text NOT NULL,
        telemetry_json jsonb NOT NULL,
        pattern_cluster_id text,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS entity_banners (
        tenant_id text NOT NULL DEFAULT 'legacy',
        entity_id text NOT NULL,
        anomaly_status text NOT NULL DEFAULT 'normal',
        banner_explanation text,
        sources jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_at timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, entity_id)
      );
    `;
    await sql`ALTER TABLE entity_banners ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'legacy'`;
    await sql`ALTER TABLE entity_banners ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE entity_banners DROP CONSTRAINT IF EXISTS entity_banners_pkey`;
    await sql`ALTER TABLE entity_banners ADD PRIMARY KEY (tenant_id, entity_id)`;

    if (pgvectorAvailable) {
      await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS embedding vector(64)`;
      // Backfill any rows missing embeddings
      const missing = await sql`
        SELECT id, raw_text, failed_risk_ids, triggered_shield_ids
        FROM submissions
        WHERE embedding IS NULL
        LIMIT 200
      `;
      for (const row of missing) {
        const failed = Array.isArray(row.failed_risk_ids) ? row.failed_risk_ids : [];
        const shields = Array.isArray(row.triggered_shield_ids) ? row.triggered_shield_ids : [];
        const vec = computeLocalEmbedding(row.raw_text || "", [...failed, ...shields]);
        const lit = toPgVectorLiteral(vec);
        await sql`UPDATE submissions SET embedding = ${lit}::vector WHERE id = ${row.id}`;
      }
    }

    schemaChecked = true;
  } catch (err: any) {
    console.warn(`Schema check warning: ${err.message}`);
  }

  return { dbConnected: dbReachable, pgvectorEnabled: pgvectorAvailable };
}

function enrichQuestionTags(riskIds: string[], shieldIds: string[]) {
  const riskTagDetails = (riskIds || []).map((id) => {
    const q = SEMEVAL_QUESTIONS[id as `Q${number}`];
    return {
      id,
      name: q?.name || id,
      bucket: q?.bucket || 1,
      bucketName: BUCKET_NAMES[q?.bucket || 1] || "Risk Pattern",
      points: q?.pointsOrFlags || 1,
      tier: q?.tier,
      description: q?.description || "",
    };
  });

  const shieldTagDetails = (shieldIds || []).map((id) => {
    const q = SEMEVAL_QUESTIONS[id as `Q${number}`];
    return {
      id,
      name: q?.name || id,
      bucket: q?.bucket || 7,
      bucketName: BUCKET_NAMES[q?.bucket || 7] || "Benign Context Shield",
      flags: q?.pointsOrFlags || 1,
      description: q?.description || "",
    };
  });

  return { riskTagDetails, shieldTagDetails };
}

export async function seedDemoData(force = false): Promise<{ seededCount: number; source: "postgres" | "memory" }> {
  const { dbConnected, pgvectorEnabled } = await ensureDashboardSchema();
  if (force) {
    userClearedSeed = false;
  }

  if (dbConnected) {
    try {
      if (force) {
        // Clear previous seed items first so re-seeding is clean and 100% deterministic
        await sql`DELETE FROM submissions WHERE author_session_hash LIKE ${SEED_HASH_PREFIX + '%'}`;
      } else {
        const existing = await sql`SELECT count(*)::int AS cnt FROM submissions WHERE author_session_hash LIKE ${SEED_HASH_PREFIX + '%'}`;
        const count = existing[0]?.cnt ?? 0;
        if (count > 0) {
          return { seededCount: 0, source: "postgres" };
        }
      }

      let inserted = 0;
      for (const item of DEMO_SEED_ITEMS) {
        const createdAt = new Date(Date.now() - item.hoursAgo * 3600 * 1000);
        const taggedHash = item.authorSessionHash.startsWith(SEED_HASH_PREFIX)
          ? item.authorSessionHash
          : `${SEED_HASH_PREFIX}${item.authorSessionHash}`;
        const emb = computeLocalEmbedding(item.rawText, [
          ...item.failedRiskIds,
          ...item.triggeredShieldIds,
        ]);
        const vecLit = toPgVectorLiteral(emb);
        const origin = resolveOriginGeo({
          ipAddress: item.honeypot?.ipAddress || null,
          authorSessionHash: taggedHash,
          wpCommentId: item.wpCommentId,
          authorType: item.authorType,
        });

        const [sub] = await db
          .insert(submissions)
          .values({
            wpCommentId: item.wpCommentId,
            entityId: item.entityId,
            authorSessionHash: taggedHash,
            rawText: item.rawText,
            rating: item.rating ?? null,
            authorType: item.authorType,
            visibility: item.visibility,
            routingPath: item.routingPath,
            modelUsed: item.modelUsed,
            riskScore: item.riskScore,
            shieldFlags: item.shieldFlags,
            failedRiskIds: item.failedRiskIds,
            triggeredShieldIds: item.triggeredShieldIds,
            deepResearchExplanation: item.deepResearchExplanation,
            originCountryCode: origin.countryCode,
            originCountry: origin.countryName,
            originRegion: origin.region,
            originCity: origin.city,
            originLat: origin.lat,
            originLng: origin.lng,
            originNetwork: origin.networkType,
            createdAt,
          })
          .returning();

        const subId = sub?.id;
        if (subId && pgvectorEnabled) {
          try {
            await sql`UPDATE submissions SET embedding = ${vecLit}::vector WHERE id = ${subId}`;
          } catch {
            // ignore if embedding column is not vector(64)
          }
        }

        if (subId && item.honeypot) {
          await db.insert(honeypotVault).values({
            submissionId: subId,
            ipAddress: item.honeypot.ipAddress,
            userAgent: item.honeypot.userAgent,
            telemetryJson: {
              ...item.honeypot.telemetry,
              confidenceScore: item.honeypot.confidenceScore,
              reasons: item.honeypot.reasons,
            },
            patternClusterId: item.honeypot.patternClusterId,
            createdAt,
          });
        }
        inserted++;
      }

      // Seed entity banners via Drizzle
      const demoBanners = [
        {
          entityId: "product_quantum_router",
          anomalyStatus: "legitimate_backlash",
          bannerExplanation:
            "We detected elevated 1-star review volume following recent firmware v4.2 VLAN/Wi-Fi bug reports. Authentic customer complaints remain published while engineering prepares hotfix v4.2.1.",
        },
        {
          entityId: "post_firmware_v4_2",
          anomalyStatus: "coordinated_attack",
          bannerExplanation:
            "Notice: Automated forensic defense intercepted a coordinated headless bot & disinformation brigade targeting this thread. Verified human discussion remains open.",
        },
      ];
      for (const b of demoBanners) {
        await db
          .insert(entityBanners)
          .values({
            tenantId: "legacy",
            entityId: b.entityId,
            anomalyStatus: b.anomalyStatus,
            bannerExplanation: b.bannerExplanation,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [entityBanners.tenantId, entityBanners.entityId],
            set: {
              anomalyStatus: b.anomalyStatus,
              bannerExplanation: b.bannerExplanation,
              updatedAt: new Date(),
            },
          });
      }

      return { seededCount: inserted, source: "postgres" };
    } catch (err: any) {
      console.warn(`Postgres seed fallback to memory: ${err.message}`);
    }
  }

  // Fallback to in-memory seed if Postgres is unavailable
  if (force) {
    const keep = inMemorySubmissions.filter((s) => !s.authorSessionHash.startsWith(SEED_HASH_PREFIX));
    inMemorySubmissions.length = 0;
    inMemorySubmissions.push(...keep);
  } else if (inMemorySubmissions.some((s) => s.authorSessionHash.startsWith(SEED_HASH_PREFIX))) {
    return { seededCount: 0, source: "memory" };
  }

  let memInserted = 0;
  for (const item of DEMO_SEED_ITEMS) {
    const id = crypto.randomUUID();
    const createdAt = new Date(Date.now() - item.hoursAgo * 3600 * 1000);
    const taggedHash = item.authorSessionHash.startsWith(SEED_HASH_PREFIX)
      ? item.authorSessionHash
      : `${SEED_HASH_PREFIX}${item.authorSessionHash}`;
    const embedding = computeLocalEmbedding(item.rawText, [
      ...item.failedRiskIds,
      ...item.triggeredShieldIds,
    ]);
    const origin = resolveOriginGeo({
      ipAddress: item.honeypot?.ipAddress || null,
      authorSessionHash: taggedHash,
      wpCommentId: item.wpCommentId,
      authorType: item.authorType,
    });

    const record: InMemorySubmissionRecord = {
      id,
      wpCommentId: item.wpCommentId,
      entityId: item.entityId,
      authorSessionHash: taggedHash,
      rawText: item.rawText,
      rating: item.rating,
      authorType: item.authorType,
      visibility: item.visibility,
      routingPath: item.routingPath,
      modelUsed: item.modelUsed,
      riskScore: item.riskScore,
      shieldFlags: item.shieldFlags,
      failedRiskIds: item.failedRiskIds,
      triggeredShieldIds: item.triggeredShieldIds,
      deepResearchExplanation: item.deepResearchExplanation,
      origin,
      createdAt,
      embedding,
    };
    inMemorySubmissions.push(record);

    if (item.honeypot) {
      inMemoryHoneypot.set(id, {
        id: crypto.randomUUID(),
        submissionId: id,
        ipAddress: item.honeypot.ipAddress,
        userAgent: item.honeypot.userAgent,
        telemetryJson: {
          ...item.honeypot.telemetry,
          confidenceScore: item.honeypot.confidenceScore,
          reasons: item.honeypot.reasons,
        },
        patternClusterId: item.honeypot.patternClusterId,
        createdAt,
      });
    }
    memInserted++;
  }

  inMemoryBanners.set("product_quantum_router", {
    entityId: "product_quantum_router",
    anomalyStatus: "legitimate_backlash",
    bannerExplanation:
      "We detected elevated 1-star review volume following recent firmware v4.2 VLAN/Wi-Fi bug reports. Authentic customer complaints remain published while engineering prepares hotfix v4.2.1.",
  });
  inMemoryBanners.set("post_firmware_v4_2", {
    entityId: "post_firmware_v4_2",
    anomalyStatus: "coordinated_attack",
    bannerExplanation:
      "Notice: Automated forensic defense intercepted a coordinated headless bot & disinformation brigade targeting this thread. Verified human discussion remains open.",
  });

  return { seededCount: memInserted, source: "memory" };
}

export type ClearMode = "seed" | "all" | "non-seed";

export async function clearDemoData(mode: ClearMode | boolean = "seed"): Promise<{
  deletedCount: number;
  source: "postgres" | "memory";
}> {
  userClearedSeed = true;
  const clearMode: ClearMode =
    typeof mode === "boolean" ? (mode ? "all" : "seed") : mode;
  const { dbConnected } = await ensureDashboardSchema();

  // Also clean in-memory mirror
  let memDeleted = 0;
  for (let i = inMemorySubmissions.length - 1; i >= 0; i--) {
    const sub = inMemorySubmissions[i];
    if (!sub) continue;
    const match =
      clearMode === "all"
        ? true
        : clearMode === "non-seed"
          ? !sub.authorSessionHash.startsWith(SEED_HASH_PREFIX)
          : sub.authorSessionHash.startsWith(SEED_HASH_PREFIX);
    if (match) {
      inMemoryHoneypot.delete(sub.id);
      inMemorySubmissions.splice(i, 1);
      memDeleted++;
    }
  }

  if (clearMode === "all") {
    inMemoryBanners.clear();
  } else if (clearMode === "seed") {
    inMemoryBanners.delete("product_quantum_router");
    inMemoryBanners.delete("post_firmware_v4_2");
  }

  if (dbConnected) {
    try {
      let deletedRows;
      if (clearMode === "all") {
        await sql`DELETE FROM honeypot_vault`;
        deletedRows = await sql`DELETE FROM submissions RETURNING id`;
        await sql`DELETE FROM entity_banners`;
      } else if (clearMode === "non-seed") {
        await sql`
          DELETE FROM honeypot_vault
          WHERE submission_id IN (
            SELECT id FROM submissions WHERE author_session_hash NOT LIKE ${SEED_HASH_PREFIX + "%"}
          )
        `;
        deletedRows = await sql`
          DELETE FROM submissions
          WHERE author_session_hash NOT LIKE ${SEED_HASH_PREFIX + "%"}
          RETURNING id
        `;
      } else {
        await sql`
          DELETE FROM honeypot_vault
          WHERE submission_id IN (
            SELECT id FROM submissions WHERE author_session_hash LIKE ${SEED_HASH_PREFIX + "%"}
          )
        `;
        deletedRows = await sql`
          DELETE FROM submissions
          WHERE author_session_hash LIKE ${SEED_HASH_PREFIX + "%"}
          RETURNING id
        `;
        await sql`
          DELETE FROM entity_banners
          WHERE entity_id IN ('product_quantum_router', 'post_firmware_v4_2')
        `;
      }
      return { deletedCount: deletedRows.length, source: "postgres" };
    } catch (err: any) {
      console.warn(`Postgres clearDemoData warning: ${err.message}`);
    }
  }

  return { deletedCount: memDeleted, source: "memory" };
}

async function loadAllUnifiedSubmissions(): Promise<{
  items: UnifiedSubmission[];
  dbConnected: boolean;
  pgvectorEnabled: boolean;
}> {
  const status = await ensureDashboardSchema();

  if (status.dbConnected) {
    try {
      const rows = await sql`
        SELECT
          s.id,
          s.wp_comment_id,
          s.entity_id,
          s.author_session_hash,
          s.raw_text,
          s.rating,
          s.author_type,
          s.visibility,
          s.routing_path,
          s.model_used,
          s.risk_score,
          s.shield_flags,
          s.failed_risk_ids,
          s.triggered_shield_ids,
          s.deep_research_explanation,
          s.origin_country_code,
          s.origin_country,
          s.origin_region,
          s.origin_city,
          s.origin_lat,
          s.origin_lng,
          s.origin_network,
          s.created_at,
          h.ip_address,
          h.user_agent,
          h.telemetry_json,
          h.pattern_cluster_id
        FROM submissions s
        LEFT JOIN honeypot_vault h ON h.submission_id = s.id
        ORDER BY s.created_at DESC
        LIMIT 500
      `;

      const items: UnifiedSubmission[] = rows.map((r: any) => {
        const failedRiskIds = Array.isArray(r.failed_risk_ids) ? r.failed_risk_ids : [];
        const triggeredShieldIds = Array.isArray(r.triggered_shield_ids) ? r.triggered_shield_ids : [];
        const { riskTagDetails, shieldTagDetails } = enrichQuestionTags(failedRiskIds, triggeredShieldIds);
        const telemetry = r.telemetry_json && typeof r.telemetry_json === "object" ? r.telemetry_json : null;
        const resolvedOrigin = resolveOriginGeo({
          ipAddress: r.ip_address || null,
          authorSessionHash: r.author_session_hash,
          wpCommentId: Number(r.wp_comment_id),
          authorType: r.author_type as "human" | "bot",
        });
        const originRegion = r.origin_region || resolvedOrigin.region;
        const origin: OriginGeoInfo = r.origin_country_code
          ? {
              countryCode: r.origin_country_code,
              countryName: r.origin_country || resolvedOrigin.countryName,
              region: originRegion,
              regionCode:
                WORLD_REGIONS.find((reg) => reg.regionName === originRegion)?.regionCode ||
                resolvedOrigin.regionCode,
              city: r.origin_city || resolvedOrigin.city,
              lat:
                r.origin_lat !== null && r.origin_lat !== undefined
                  ? Number(r.origin_lat)
                  : resolvedOrigin.lat,
              lng:
                r.origin_lng !== null && r.origin_lng !== undefined
                  ? Number(r.origin_lng)
                  : resolvedOrigin.lng,
              ipAddress: r.ip_address || resolvedOrigin.ipAddress,
              networkType: r.origin_network || resolvedOrigin.networkType,
              asnLabel: resolvedOrigin.asnLabel,
            }
          : resolvedOrigin;

        return {
          id: r.id,
          wpCommentId: Number(r.wp_comment_id),
          entityId: r.entity_id,
          authorSessionHash: r.author_session_hash,
          rawText: r.raw_text,
          rating: r.rating !== null && r.rating !== undefined ? Number(r.rating) : null,
          authorType: r.author_type as "human" | "bot",
          visibility: r.visibility,
          routingPath: r.routing_path,
          modelUsed: r.model_used,
          riskScore: Number(r.risk_score || 0),
          shieldFlags: Number(r.shield_flags || 0),
          failedRiskIds,
          triggeredShieldIds,
          deepResearchExplanation: r.deep_research_explanation || null,
          createdAt: new Date(r.created_at).toISOString(),
          embedding: computeLocalEmbedding(r.raw_text || "", [...failedRiskIds, ...triggeredShieldIds]),
          origin,
          honeypot:
            r.author_type === "bot" || r.ip_address
              ? {
                  ipAddress: r.ip_address || "unknown",
                  userAgent: r.user_agent || "unknown",
                  confidenceScore: Number(telemetry?.confidenceScore ?? 95),
                  reasons: Array.isArray(telemetry?.reasons) ? telemetry.reasons : ["bot_telemetry_flagged"],
                  patternClusterId: r.pattern_cluster_id || "cluster_headless_generic",
                  telemetry: telemetry || {},
                }
              : null,
          riskTagDetails,
          shieldTagDetails,
        };
      });

      if (items.length > 0 || inMemorySubmissions.length === 0) {
        return { items, dbConnected: true, pgvectorEnabled: status.pgvectorEnabled };
      }
    } catch (err: any) {
      console.warn(`DB query failed in loadAllUnifiedSubmissions: ${err.message}`);
    }
  }

  // Fallback to in-memory records
  const sorted = [...inMemorySubmissions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  const items: UnifiedSubmission[] = sorted.map((s) => {
    const hp = inMemoryHoneypot.get(s.id);
    const { riskTagDetails, shieldTagDetails } = enrichQuestionTags(s.failedRiskIds, s.triggeredShieldIds);
    const origin =
      s.origin ||
      resolveOriginGeo({
        ipAddress: hp?.ipAddress || null,
        authorSessionHash: s.authorSessionHash,
        wpCommentId: s.wpCommentId,
        authorType: s.authorType,
      });
    return {
      id: s.id,
      wpCommentId: s.wpCommentId,
      entityId: s.entityId,
      authorSessionHash: s.authorSessionHash,
      rawText: s.rawText,
      rating: s.rating,
      authorType: s.authorType,
      visibility: s.visibility,
      routingPath: s.routingPath,
      modelUsed: s.modelUsed,
      riskScore: s.riskScore,
      shieldFlags: s.shieldFlags,
      failedRiskIds: s.failedRiskIds,
      triggeredShieldIds: s.triggeredShieldIds,
      deepResearchExplanation: s.deepResearchExplanation,
      createdAt: s.createdAt.toISOString(),
      embedding: s.embedding,
      origin,
      honeypot: hp
        ? {
            ipAddress: hp.ipAddress,
            userAgent: hp.userAgent,
            confidenceScore: Number(hp.telemetryJson?.confidenceScore ?? 95),
            reasons: Array.isArray(hp.telemetryJson?.reasons) ? hp.telemetryJson.reasons : [],
            patternClusterId: hp.patternClusterId,
            telemetry: hp.telemetryJson,
          }
        : null,
      riskTagDetails,
      shieldTagDetails,
    };
  });

  return { items, dbConnected: false, pgvectorEnabled: false };
}

/**
 * GET /api/dashboard/overview
 */
dashboardApiRouter.get("/api/dashboard/overview", async (c) => {
  const range = (c.req.query("range") || "7d") as "24h" | "7d" | "30d";
  const { items, dbConnected, pgvectorEnabled } = await loadAllUnifiedSubmissions();

  const now = Date.now();
  const windowMs =
    range === "24h"
      ? 24 * 3600 * 1000
      : range === "30d"
        ? 30 * 24 * 3600 * 1000
        : 7 * 24 * 3600 * 1000;

  const filteredByRange = items.filter(
    (item) => now - new Date(item.createdAt).getTime() <= windowMs
  );

  // KPI Metrics (overall + range)
  const totalSubmissions = items.length;
  const testDataCount = items.filter((i) =>
    i.authorSessionHash.startsWith(SEED_HASH_PREFIX)
  ).length;
  const rangeSubmissions = filteredByRange.length;
  const botsDetected = items.filter((i) => i.authorType === "bot").length;
  const rangeBots = filteredByRange.filter((i) => i.authorType === "bot").length;
  const flaggedPropaganda = items.filter((i) => i.visibility === "public_flagged").length;
  const cleanHuman = items.filter((i) => i.authorType === "human" && i.visibility === "public").length;
  const shieldedVenting = items.filter((i) => i.routingPath === "ROUTE_2_SHIELDED_VENTING").length;

  const humanItems = items.filter((i) => i.authorType === "human");
  const avgHumanRiskScore =
    humanItems.length > 0
      ? Number((humanItems.reduce((acc, i) => acc + i.riskScore, 0) / humanItems.length).toFixed(1))
      : 0;

  // Build Time-Series Buckets
  const series: Array<{
    bucket: string;
    label: string;
    bots: number;
    humanClean: number;
    humanFlagged: number;
    total: number;
  }> = [];

  if (range === "24h") {
    for (let h = 23; h >= 0; h--) {
      const slotEnd = now - h * 3600 * 1000;
      const slotStart = slotEnd - 3600 * 1000;
      const d = new Date(slotEnd);
      const label = `${d.getHours().toString().padStart(2, "0")}:00`;
      const inSlot = items.filter((item) => {
        const t = new Date(item.createdAt).getTime();
        return t > slotStart && t <= slotEnd;
      });
      const bots = inSlot.filter((i) => i.authorType === "bot").length;
      const humanFlagged = inSlot.filter((i) => i.authorType === "human" && i.visibility === "public_flagged").length;
      const humanClean = inSlot.filter((i) => i.authorType === "human" && i.visibility === "public").length;
      series.push({
        bucket: d.toISOString(),
        label,
        bots,
        humanClean,
        humanFlagged,
        total: bots + humanClean + humanFlagged,
      });
    }
  } else {
    const days = range === "30d" ? 30 : 7;
    for (let dIdx = days - 1; dIdx >= 0; dIdx--) {
      const dayDate = new Date(now - dIdx * 24 * 3600 * 1000);
      const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime();
      const dayEnd = dayStart + 24 * 3600 * 1000;
      const label = dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      const inDay = items.filter((item) => {
        const t = new Date(item.createdAt).getTime();
        return t >= dayStart && t < dayEnd;
      });
      const bots = inDay.filter((i) => i.authorType === "bot").length;
      const humanFlagged = inDay.filter((i) => i.authorType === "human" && i.visibility === "public_flagged").length;
      const humanClean = inDay.filter((i) => i.authorType === "human" && i.visibility === "public").length;
      series.push({
        bucket: new Date(dayStart).toISOString(),
        label,
        bots,
        humanClean,
        humanFlagged,
        total: bots + humanClean + humanFlagged,
      });
    }
  }

  // Routing & Visibility Breakdown
  const routeMap = new Map<string, number>();
  const visMap = new Map<string, number>();
  const flagMap = new Map<string, number>();

  for (const item of items) {
    routeMap.set(item.routingPath, (routeMap.get(item.routingPath) || 0) + 1);
    visMap.set(item.visibility, (visMap.get(item.visibility) || 0) + 1);
    for (const rId of item.failedRiskIds) {
      flagMap.set(rId, (flagMap.get(rId) || 0) + 1);
    }
    for (const sId of item.triggeredShieldIds) {
      flagMap.set(sId, (flagMap.get(sId) || 0) + 1);
    }
  }

  const routingBreakdown = [
    { route: "BOT_HONEYPOT", label: "Bot Honeypot Intercept", count: routeMap.get("BOT_HONEYPOT") || 0, color: "#f43f5e" },
    { route: "ROUTE_1_FAST_CLEAR", label: "Route 1: Fast Clear", count: routeMap.get("ROUTE_1_FAST_CLEAR") || 0, color: "#10b981" },
    { route: "ROUTE_2_SHIELDED_VENTING", label: "Route 2: Shielded Venting", count: routeMap.get("ROUTE_2_SHIELDED_VENTING") || 0, color: "#38bdf8" },
    { route: "ROUTE_3_STANCE_VERIFICATION", label: "Route 3: Stance Check", count: routeMap.get("ROUTE_3_STANCE_VERIFICATION") || 0, color: "#a855f7" },
    { route: "ROUTE_4_FORENSIC_THREAT", label: "Route 4: Forensic Threat", count: routeMap.get("ROUTE_4_FORENSIC_THREAT") || 0, color: "#f59e0b" },
  ];

  const topFlags = Array.from(flagMap.entries())
    .map(([id, count]) => {
      const q = SEMEVAL_QUESTIONS[id as `Q${number}`];
      return {
        id,
        name: q?.name || id,
        bucket: q?.bucket || 1,
        bucketName: BUCKET_NAMES[q?.bucket || 1] || "Pattern",
        isShield: q?.isShield || false,
        tier: q?.tier || 1,
        description: q?.description || "",
        count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // Load Entity Banners
  const bannersList: Array<{
    entityId: string;
    anomalyStatus: string;
    bannerExplanation: string | null;
    updatedAt: string;
  }> = [];

  if (dbConnected) {
    try {
      const bRows = await sql`
        SELECT entity_id, anomaly_status, banner_explanation, updated_at
        FROM entity_banners
        ORDER BY updated_at DESC
      `;
      for (const b of bRows) {
        bannersList.push({
          entityId: b.entity_id,
          anomalyStatus: b.anomaly_status,
          bannerExplanation: b.banner_explanation,
          updatedAt: new Date(b.updated_at).toISOString(),
        });
      }
    } catch {
      // ignore
    }
  }
  if (bannersList.length === 0) {
    for (const b of inMemoryBanners.values()) {
      bannersList.push({
        entityId: b.entityId,
        anomalyStatus: b.anomalyStatus,
        bannerExplanation: b.bannerExplanation,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const geography = buildRegionalScanSummary(items);

  return c.json({
    range,
    kpis: {
      totalSubmissions,
      testDataCount,
      rangeSubmissions,
      botsDetected,
      rangeBots,
      botSharePct: totalSubmissions > 0 ? Number(((botsDetected / totalSubmissions) * 100).toFixed(1)) : 0,
      flaggedPropaganda,
      cleanHuman,
      shieldedVenting,
      avgHumanRiskScore,
      activeBannersCount: bannersList.filter((b) => b.anomalyStatus !== "normal").length,
    },
    series,
    routingBreakdown,
    topFlags,
    geography,
    entityBanners: bannersList,
    system: {
      dbConnected,
      pgvectorEnabled,
      thresholdMode: activeThresholdMode,
      fastScreenerModel: process.env.MODEL_FAST_SCREENER || "jev-latest",
      heavyForensicModel: process.env.MODEL_HEAVY_RESEARCH || "gemini-4-hydrogen",
      bunVersion: Bun.version,
    },
  });
});

/**
 * GET /api/dashboard/regions
 * Regional scanning endpoint aggregating propaganda & botnet origins by world region, country, and city hotspot.
 */
dashboardApiRouter.get("/api/dashboard/regions", async (c) => {
  const range = (c.req.query("range") || "all") as "24h" | "7d" | "30d" | "all";
  const regionFilter = (c.req.query("region") || "all").trim();
  const countryFilter = (c.req.query("country") || "all").trim().toUpperCase();
  const { items } = await loadAllUnifiedSubmissions();

  const now = Date.now();
  const windowMs =
    range === "24h"
      ? 24 * 3600 * 1000
      : range === "7d"
        ? 7 * 24 * 3600 * 1000
        : range === "30d"
          ? 30 * 24 * 3600 * 1000
          : null;

  const scopedItems =
    windowMs !== null
      ? items.filter((item) => now - new Date(item.createdAt).getTime() <= windowMs)
      : items;

  const summary = buildRegionalScanSummary(scopedItems);
  const activeRegion =
    regionFilter !== "all"
      ? summary.regions.find((r) => r.regionCode === regionFilter) || null
      : null;

  const matchingItems = scopedItems.filter((item) => {
    if (regionFilter !== "all" && item.origin.regionCode !== regionFilter) return false;
    if (countryFilter !== "ALL" && countryFilter !== "all" && item.origin.countryCode !== countryFilter) {
      return false;
    }
    return true;
  });

  return c.json({
    range,
    selectedRegion: regionFilter,
    selectedCountry: countryFilter === "ALL" ? "all" : countryFilter,
    summary,
    activeRegion,
    recentRegionItems: matchingItems.slice(0, 60),
  });
});

/**
 * GET /api/dashboard/submissions
 * Supports tag filtering + hybrid/pgvector semantic search + "find similar" clustering.
 */
dashboardApiRouter.get("/api/dashboard/submissions", async (c) => {
  const authorType = c.req.query("authorType") || "all";
  const visibility = c.req.query("visibility") || "all";
  const route = c.req.query("route") || "all";
  const entityId = c.req.query("entityId") || "all";
  const regionCode = c.req.query("region") || "all";
  const countryCode = (c.req.query("country") || "all").toUpperCase();
  const tagsParam = c.req.query("tags") || "";
  const queryText = (c.req.query("q") || "").trim();
  const searchMode = (c.req.query("searchMode") || "hybrid") as "hybrid" | "vector" | "keyword";
  const similarToId = (c.req.query("similarTo") || "").trim();
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") || "100", 10)));

  const selectedTags = tagsParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const { items, dbConnected, pgvectorEnabled } = await loadAllUnifiedSubmissions();

  // Compute pgvector distance scores directly in PostgreSQL if pgvector is enabled and vector search is requested
  const pgSimilarityMap = new Map<string, number>();
  let targetVector: number[] | null = null;
  let referenceSubmission: UnifiedSubmission | null = null;

  if (similarToId) {
    referenceSubmission = items.find((i) => i.id === similarToId) || null;
    if (referenceSubmission) {
      targetVector = referenceSubmission.embedding;
    }
  } else if (queryText && searchMode !== "keyword") {
    // Also check if query matches any SemEval question names to boost relevant bucket dimensions
    const matchedQuestionIds = Object.values(SEMEVAL_QUESTIONS)
      .filter(
        (q) =>
          q.name.toLowerCase().includes(queryText.toLowerCase()) ||
          q.description.toLowerCase().includes(queryText.toLowerCase())
      )
      .map((q) => q.id);
    targetVector = computeLocalEmbedding(queryText, matchedQuestionIds);
  }

  if (targetVector && dbConnected && pgvectorEnabled) {
    try {
      const vecLit = toPgVectorLiteral(targetVector);
      const simRows = await sql`
        SELECT id, 1 - (embedding <=> ${vecLit}::vector) AS similarity
        FROM submissions
        WHERE embedding IS NOT NULL
      `;
      for (const r of simRows) {
        pgSimilarityMap.set(r.id, Math.max(0, Math.min(1, Number(r.similarity || 0))));
      }
    } catch (err: any) {
      console.warn(`pgvector similarity query fallback to local cosine: ${err.message}`);
    }
  }

  let results = items.filter((item) => {
    if (authorType !== "all" && item.authorType !== authorType) return false;
    if (visibility !== "all" && item.visibility !== visibility) return false;
    if (route !== "all" && item.routingPath !== route) return false;
    if (entityId !== "all" && item.entityId !== entityId) return false;
    if (regionCode !== "all" && item.origin.regionCode !== regionCode) return false;
    if (countryCode !== "ALL" && item.origin.countryCode !== countryCode) return false;

    if (selectedTags.length > 0) {
      const itemTagSet = new Set<string>([
        ...item.failedRiskIds,
        ...item.triggeredShieldIds,
        ...(item.honeypot?.reasons || []),
        ...(item.honeypot?.patternClusterId ? [item.honeypot.patternClusterId] : []),
        item.routingPath,
        item.entityId,
        item.authorType,
        item.visibility,
        item.origin.regionCode,
        `country_${item.origin.countryCode}`,
      ]);
      // Match all selected tags (AND filter)
      for (const tag of selectedTags) {
        if (!itemTagSet.has(tag)) return false;
      }
    }

    return true;
  });

  // Apply Vector / Hybrid / Keyword scoring
  if (targetVector || queryText) {
    const qLower = queryText.toLowerCase();
    const qTerms = qLower.split(/\s+/).filter((w) => w.length >= 2);

    results = results
      .map((item) => {
        let vecSim = 0;
        if (targetVector) {
          vecSim = pgSimilarityMap.has(item.id)
            ? pgSimilarityMap.get(item.id)!
            : cosineSimilarity(targetVector, item.embedding);
        }

        let keywordBoost = 0;
        if (queryText) {
          const searchable = [
            item.rawText,
            item.entityId,
            item.routingPath,
            item.deepResearchExplanation || "",
            ...(item.riskTagDetails.map((t) => `${t.id} ${t.name}`)),
            ...(item.shieldTagDetails.map((t) => `${t.id} ${t.name}`)),
            ...(item.honeypot?.reasons || []),
            item.honeypot?.patternClusterId || "",
            item.honeypot?.ipAddress || "",
            item.honeypot?.userAgent || "",
            item.origin.countryName,
            item.origin.countryCode,
            item.origin.region,
            item.origin.city,
            item.origin.asnLabel,
          ]
            .join(" ")
            .toLowerCase();

          if (searchable.includes(qLower)) {
            keywordBoost = 0.35;
          } else if (qTerms.length > 0) {
            const matchedTerms = qTerms.filter((t) => searchable.includes(t)).length;
            keywordBoost = (matchedTerms / qTerms.length) * 0.25;
          }
        }

        const combinedScore =
          searchMode === "vector"
            ? vecSim
            : searchMode === "keyword"
              ? keywordBoost > 0
                ? Math.min(1, 0.65 + keywordBoost)
                : 0
              : Math.min(1, vecSim * 0.8 + keywordBoost);

        return {
          ...item,
          similarityScore: Number(combinedScore.toFixed(4)),
        };
      })
      .filter((item) => {
        if (searchMode === "keyword") {
          return (item.similarityScore || 0) > 0;
        }
        if (similarToId) {
          return (item.similarityScore || 0) >= 0.15;
        }
        return (item.similarityScore || 0) >= 0.18;
      })
      .sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));
  }

  return c.json({
    totalMatching: results.length,
    searchActive: Boolean(targetVector || queryText),
    searchMode,
    similarTo: referenceSubmission
      ? {
          id: referenceSubmission.id,
          wpCommentId: referenceSubmission.wpCommentId,
          rawText: referenceSubmission.rawText,
          authorType: referenceSubmission.authorType,
        }
      : null,
    pgvectorUsed: Boolean(targetVector && dbConnected && pgvectorEnabled),
    items: results.slice(0, limit),
  });
});

/**
 * GET /api/dashboard/bots
 * Dedicated Bot Honeypot Vault endpoint with telemetry cluster analytics.
 */
dashboardApiRouter.get("/api/dashboard/bots", async (c) => {
  const { items } = await loadAllUnifiedSubmissions();
  const bots = items.filter((i) => i.authorType === "bot");

  const reasonCounts = new Map<string, number>();
  const clusterCounts = new Map<string, number>();
  const ipCounts = new Map<string, number>();
  const uaCounts = new Map<string, number>();
  let totalConfidence = 0;

  for (const b of bots) {
    const hp = b.honeypot;
    if (!hp) continue;
    totalConfidence += hp.confidenceScore || 95;
    for (const r of hp.reasons) {
      reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1);
    }
    if (hp.patternClusterId) {
      clusterCounts.set(hp.patternClusterId, (clusterCounts.get(hp.patternClusterId) || 0) + 1);
    }
    if (hp.ipAddress) {
      ipCounts.set(hp.ipAddress, (ipCounts.get(hp.ipAddress) || 0) + 1);
    }
    if (hp.userAgent) {
      uaCounts.set(hp.userAgent, (uaCounts.get(hp.userAgent) || 0) + 1);
    }
  }

  return c.json({
    totalBots: bots.length,
    avgConfidence: bots.length > 0 ? Number((totalConfidence / bots.length).toFixed(1)) : 0,
    reasonsBreakdown: Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    clustersBreakdown: Array.from(clusterCounts.entries())
      .map(([clusterId, count]) => ({ clusterId, count }))
      .sort((a, b) => b.count - a.count),
    topIps: Array.from(ipCounts.entries())
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count),
    topUserAgents: Array.from(uaCounts.entries())
      .map(([userAgent, count]) => ({ userAgent, count }))
      .sort((a, b) => b.count - a.count),
    bots,
  });
});

/**
 * GET /api/dashboard/tags
 * Returns all filterable tags across SemEval Risk/Shield questions, Bot Telemetry Reasons, Clusters, and Entities.
 */
dashboardApiRouter.get("/api/dashboard/tags", async (c) => {
  const { items } = await loadAllUnifiedSubmissions();

  const riskCounts = new Map<string, number>();
  const shieldCounts = new Map<string, number>();
  const botReasonCounts = new Map<string, number>();
  const clusterCounts = new Map<string, number>();
  const entityCounts = new Map<string, number>();
  const regionCounts = new Map<string, { label: string; count: number }>();
  const countryCounts = new Map<string, { label: string; count: number }>();

  for (const item of items) {
    entityCounts.set(item.entityId, (entityCounts.get(item.entityId) || 0) + 1);
    const prevReg = regionCounts.get(item.origin.regionCode);
    regionCounts.set(item.origin.regionCode, {
      label: item.origin.region,
      count: (prevReg?.count || 0) + 1,
    });
    const countryTag = `country_${item.origin.countryCode}`;
    const prevCountry = countryCounts.get(countryTag);
    countryCounts.set(countryTag, {
      label: `${item.origin.countryName} (${item.origin.countryCode})`,
      count: (prevCountry?.count || 0) + 1,
    });
    for (const rId of item.failedRiskIds) {
      riskCounts.set(rId, (riskCounts.get(rId) || 0) + 1);
    }
    for (const sId of item.triggeredShieldIds) {
      shieldCounts.set(sId, (shieldCounts.get(sId) || 0) + 1);
    }
    if (item.honeypot) {
      for (const reason of item.honeypot.reasons) {
        botReasonCounts.set(reason, (botReasonCounts.get(reason) || 0) + 1);
      }
      if (item.honeypot.patternClusterId) {
        clusterCounts.set(
          item.honeypot.patternClusterId,
          (clusterCounts.get(item.honeypot.patternClusterId) || 0) + 1
        );
      }
    }
  }

  return c.json({
    semevalRisk: Array.from(riskCounts.entries())
      .map(([id, count]) => ({
        tag: id,
        label: `${id}: ${SEMEVAL_QUESTIONS[id as `Q${number}`]?.name || id}`,
        bucket: SEMEVAL_QUESTIONS[id as `Q${number}`]?.bucket || 1,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    semevalShield: Array.from(shieldCounts.entries())
      .map(([id, count]) => ({
        tag: id,
        label: `${id}: ${SEMEVAL_QUESTIONS[id as `Q${number}`]?.name || id}`,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    botReasons: Array.from(botReasonCounts.entries())
      .map(([tag, count]) => ({ tag, label: tag, count }))
      .sort((a, b) => b.count - a.count),
    clusters: Array.from(clusterCounts.entries())
      .map(([tag, count]) => ({ tag, label: tag, count }))
      .sort((a, b) => b.count - a.count),
    entities: Array.from(entityCounts.entries())
      .map(([tag, count]) => ({ tag, label: tag, count }))
      .sort((a, b) => b.count - a.count),
    regions: Array.from(regionCounts.entries())
      .map(([tag, info]) => ({ tag, label: info.label, count: info.count }))
      .sort((a, b) => b.count - a.count),
    countries: Array.from(countryCounts.entries())
      .map(([tag, info]) => ({ tag, label: info.label, count: info.count }))
      .sort((a, b) => b.count - a.count),
  });
});

/**
 * POST /api/dashboard/seed
 * Seeds or appends realistic bot/human/propaganda demo traffic into PostgreSQL (or memory).
 */
dashboardApiRouter.post("/api/dashboard/seed", async (c) => {
  const res = await seedDemoData(true);
  return c.json({
    status: "seeded",
    ...res,
  });
});

/**
 * DELETE /api/dashboard/seed
 * Deletes seeded test data (default: seed_demo_%), or wipes everything (?all=true or ?mode=all),
 * or deletes only non-seed comments (?mode=non-seed).
 */
dashboardApiRouter.delete("/api/dashboard/seed", async (c) => {
  const modeParam = c.req.query("mode") as ClearMode | undefined;
  const clearAll = c.req.query("all") === "true";
  const mode: ClearMode =
    modeParam === "non-seed"
      ? "non-seed"
      : clearAll || modeParam === "all"
        ? "all"
        : "seed";
  const res = await clearDemoData(mode);
  return c.json({
    status: "cleared",
    mode,
    clearAll: mode === "all",
    ...res,
  });
});

/**
 * GET /api/dashboard/swarms
 * Detects and returns coordinated bot swarms, brigading networks, and astroturfing campaigns
 * across posting timing, account similarities, subnet/ASNs, and paraphrased text reuse.
 */
dashboardApiRouter.get("/api/dashboard/swarms", async (c) => {
  const { items } = await loadAllUnifiedSubmissions();
  const inputSubmissions = items.map((s) => ({
    id: s.id,
    wpCommentId: s.wpCommentId,
    entityId: s.entityId,
    authorSessionHash: s.authorSessionHash,
    rawText: s.rawText,
    rating: s.rating,
    authorType: s.authorType,
    visibility: s.visibility,
    createdAt: s.createdAt,
    ipAddress: s.honeypot?.ipAddress || "127.0.0.1",
    userAgent: s.honeypot?.userAgent || "unknown",
    telemetry: s.honeypot?.telemetry || {},
    embedding: s.embedding,
    origin: s.origin,
  }));

  const result = detectCoordinatedSwarms(inputSubmissions);
  return c.json(result);
});

/**
 * GET /api/dashboard/traffic/overview
 * Analyzes web-server access logs and returns clean vs malicious traffic breakdown,
 * top suspicious IPs, credential stuffers, and WAF defense rules.
 */
dashboardApiRouter.get("/api/dashboard/traffic/overview", (c) => {
  const report = cleanTrafficLogs(currentTrafficLogs);
  return c.json(report);
});

/**
 * POST /api/dashboard/traffic/ingest
 * Ingests custom web-server access log lines (Nginx / Apache / Caddy Combined Log format or JSON).
 */
dashboardApiRouter.post("/api/dashboard/traffic/ingest", async (c) => {
  const body = await c.req.json().catch(() => null);
  const rawLogs = body?.logs || (await c.req.text().catch(() => ""));
  if (rawLogs && typeof rawLogs === "string" && rawLogs.trim().length > 0) {
    if (c.req.query("append") === "true") {
      currentTrafficLogs = `${currentTrafficLogs}\n${rawLogs}`;
    } else {
      currentTrafficLogs = rawLogs;
    }
  }

  const report = cleanTrafficLogs(currentTrafficLogs);
  return c.json({
    status: "analyzed",
    ...report,
  });
});

/**
 * POST /api/dashboard/traffic/seed-demo
 * Seeds realistic server access logs containing real human shoppers, verified search crawlers,
 * credential-stuffing botnets, aggressive scrapers, and vulnerability scanners.
 */
dashboardApiRouter.post("/api/dashboard/traffic/seed-demo", (c) => {
  currentTrafficLogs = generateRealisticTrafficLogs();
  const report = cleanTrafficLogs(currentTrafficLogs);
  return c.json({
    status: "seeded",
    ...report,
  });
});

/**
 * GET /api/dashboard/traffic/export-rules
 * Exports ready-to-paste firewall / WAF block rules in Nginx, Apache, or Cloudflare format.
 */
dashboardApiRouter.get("/api/dashboard/traffic/export-rules", (c) => {
  const format = c.req.query("format") || "nginx";
  const report = cleanTrafficLogs(currentTrafficLogs);

  let content = report.firewallRules.nginxBlockRules;
  let filename = "truthier-nginx-block.conf";
  let contentType = "text/plain; charset=utf-8";

  if (format === "apache") {
    content = report.firewallRules.apacheHtaccessRules;
    filename = "truthier-htaccess.conf";
  } else if (format === "cloudflare") {
    content = report.firewallRules.cloudflareWafExpression;
    filename = "truthier-cloudflare-waf.txt";
  }

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
