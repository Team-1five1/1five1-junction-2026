import { Hono } from "hono";
import { inArray } from "drizzle-orm";
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
import {
  detectCoordinatedSwarms,
  parseSocialDataset,
  generateSampleSocialDatasetCsv,
  type RawSubmissionInput,
} from "../engines/coordination-detector";
import {
  cleanTrafficLogs,
  generateRealisticTrafficLogs,
  verifyGoodBotFcrDns,
  type TrafficCleanReport,
} from "../engines/traffic-cleaner";

export const dashboardApiRouter = new Hono();

const tenantTrafficLogs = new Map<string, string>([
  ["default", generateRealisticTrafficLogs()],
]);
const TRAFFIC_LOG_MAX_CHARS = 2_000_000;
const tenantSocialDatasets = new Map<string, RawSubmissionInput[]>();
let importedSocialSubmissions: RawSubmissionInput[] = [];

export function formatCombinedLogTimestamp(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${months[date.getUTCMonth()]}/${date.getUTCFullYear()}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

export async function getTenantSocialSubmissions(tenantId = "default"): Promise<RawSubmissionInput[]> {
  const tid = tenantId || "default";
  const mem = tenantSocialDatasets.get(tid);
  if (mem !== undefined) return mem;

  await ensureDashboardSchema();
  if (dbReachable) {
    try {
      const rows = await sql`
        SELECT items_json FROM social_datasets
        WHERE tenant_id = ${tid}
        LIMIT 1
      `;
      if (Array.isArray(rows[0]?.items_json)) {
        const items = rows[0].items_json as RawSubmissionInput[];
        tenantSocialDatasets.set(tid, items);
        if (tid === "default") importedSocialSubmissions = items;
        return items;
      }
    } catch {
      // fall through
    }
  }
  return tid === "default" ? importedSocialSubmissions : [];
}

export async function saveTenantSocialSubmissions(
  tenantId = "default",
  items: RawSubmissionInput[]
): Promise<RawSubmissionInput[]> {
  const tid = tenantId || "default";
  tenantSocialDatasets.set(tid, items);
  if (tid === "default") {
    importedSocialSubmissions = items;
  }

  await ensureDashboardSchema();
  if (dbReachable) {
    try {
      await sql`
        INSERT INTO social_datasets (tenant_id, items_json, updated_at)
        VALUES (${tid}, ${JSON.stringify(items)}::jsonb, now())
        ON CONFLICT (tenant_id) DO UPDATE
        SET items_json = EXCLUDED.items_json, updated_at = now()
      `;
    } catch (err: any) {
      console.warn(`social_datasets save warning: ${err.message}`);
    }
  }
  return items;
}

export async function getTenantTrafficLogs(tenantId = "default"): Promise<string> {
  const tid = tenantId || "default";
  const mem = tenantTrafficLogs.get(tid);
  if (mem !== undefined) return mem;

  await ensureDashboardSchema();
  if (dbReachable) {
    try {
      const rows = await sql`
        SELECT raw_logs FROM traffic_logs
        WHERE tenant_id = ${tid}
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      if (rows[0]?.raw_logs && typeof rows[0].raw_logs === "string") {
        tenantTrafficLogs.set(tid, rows[0].raw_logs);
        return rows[0].raw_logs;
      }
    } catch {
      // fall through
    }
  }
  return tid === "default" ? generateRealisticTrafficLogs() : "";
}

export async function saveTenantTrafficLogs(
  tenantId = "default",
  rawLogs: string,
  source = "manual"
): Promise<string> {
  const tid = tenantId || "default";
  const bounded =
    rawLogs.length > TRAFFIC_LOG_MAX_CHARS
      ? rawLogs.slice(rawLogs.length - TRAFFIC_LOG_MAX_CHARS)
      : rawLogs;
  tenantTrafficLogs.set(tid, bounded);

  await ensureDashboardSchema();
  if (dbReachable) {
    try {
      const existing = await sql`
        SELECT id FROM traffic_logs
        WHERE tenant_id = ${tid}
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      if (existing[0]?.id) {
        await sql`
          UPDATE traffic_logs
          SET raw_logs = ${bounded}, source = ${source}, updated_at = now()
          WHERE id = ${existing[0].id}
        `;
      } else {
        await sql`
          INSERT INTO traffic_logs (tenant_id, raw_logs, source)
          VALUES (${tid}, ${bounded}, ${source})
        `;
      }
    } catch (err: any) {
      console.warn(`traffic_logs save warning: ${err.message}`);
    }
  }
  return bounded;
}

export async function appendTenantTrafficLogLine(
  tenantId = "default",
  line: string
): Promise<void> {
  const tid = tenantId || "default";
  const prev = await getTenantTrafficLogs(tid);
  const next = prev && prev.trim().length > 0 ? `${prev}\n${line}` : line;
  await saveTenantTrafficLogs(tid, next, "live_event");
}

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
  ipAddress?: string | null;
  userAgent?: string | null;
  authorHandle?: string | null;
  accountCreatedAt?: string | null;
  replyToCommentId?: number | null;
  sharedUrl?: string | null;
  deviceFingerprint?: string | null;
  telemetrySummary?: Record<string, any> | null;
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

interface DemoSeedItem {
  wpCommentId: number;
  entityId: string;
  authorSessionHash: string;
  authorHandle?: string;
  sharedUrl?: string;
  deviceFingerprint?: string;
  accountCreatedHoursAgo?: number;
  replyToCommentId?: number;
  ipAddress?: string;
  userAgent?: string;
  telemetrySummary?: Record<string, any>;
  rawText: string;
  rating: number | null;
  authorType: "human" | "bot";
  visibility: "public" | "public_flagged" | "shadowbanned";
  routingPath: string;
  modelUsed: string;
  riskScore: number;
  shieldFlags: number;
  failedRiskIds: string[];
  triggeredShieldIds: string[];
  deepResearchExplanation: string | null;
  hoursAgo: number;
  honeypot: {
    ipAddress: string;
    userAgent: string;
    confidenceScore: number;
    reasons: string[];
    patternClusterId: string;
    telemetry: Record<string, any>;
  } | null;
}

const CORE_DEMO_SEED_ITEMS: DemoSeedItem[] = [
  // Bots caught in Honeypot Vault
  {
    wpCommentId: 901,
    entityId: "product_quantum_router",
    authorSessionHash: "sess_7a9f_crypto_apex",
    authorHandle: "crypto_apex_alpha",
    sharedUrl: "http://claim-airdrop-fast.xyz",
    deviceFingerprint: "fp_bot_cluster_a1",
    accountCreatedHoursAgo: 4,
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
    authorSessionHash: "sess_9b14_yield_hunter",
    authorHandle: "yield_hunter_99",
    sharedUrl: "http://claim-airdrop-fast.xyz",
    deviceFingerprint: "fp_bot_cluster_a1",
    accountCreatedHoursAgo: 4,
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
    hoursAgo: 1.52,
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
    authorSessionHash: "sess_1f9b_cyber_leaks",
    authorHandle: "cyber_leaks_global",
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
    authorSessionHash: "sess_2e8a_counter_narrative",
    authorHandle: "counter_narrative_x",
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
    hoursAgo: 6.55,
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
      ipAddress: "45.155.209.19",
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
      ipAddress: "194.26.139.71",
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
    ipAddress: "185.220.104.73",
    telemetrySummary: { keystrokeFlightVariance: 22, formCompletionTimeMs: 11800, botdDetected: false, webdriver: false },
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
    ipAddress: "178.62.11.40",
    telemetrySummary: { keystrokeFlightVariance: 29, formCompletionTimeMs: 15200, botdDetected: false, webdriver: false },
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
    authorHandle: "alex_dev_ops",
    ipAddress: "73.160.12.22",
    telemetrySummary: { keystrokeFlightVariance: 41, formCompletionTimeMs: 21400, botdDetected: false, webdriver: false },
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
    authorHandle: "sarah_netops",
    ipAddress: "86.140.11.14",
    telemetrySummary: { keystrokeFlightVariance: 38, formCompletionTimeMs: 18900, botdDetected: false, webdriver: false },
    replyToCommentId: 909,
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
    ipAddress: "91.150.13.18",
    telemetrySummary: { keystrokeFlightVariance: 45, formCompletionTimeMs: 26300, botdDetected: false, webdriver: false },
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
    ipAddress: "76.96.14.31",
    telemetrySummary: { keystrokeFlightVariance: 33, formCompletionTimeMs: 17100, botdDetected: false, webdriver: false },
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
    ipAddress: "80.14.15.44",
    telemetrySummary: { keystrokeFlightVariance: 39, formCompletionTimeMs: 19800, botdDetected: false, webdriver: false },
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
    ipAddress: "90.19.16.52",
    telemetrySummary: { keystrokeFlightVariance: 31, formCompletionTimeMs: 14900, botdDetected: false, webdriver: false },
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
    ipAddress: "98.140.17.63",
    telemetrySummary: { keystrokeFlightVariance: 25, formCompletionTimeMs: 13200, botdDetected: false, webdriver: false },
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
    ipAddress: "116.178.18.74",
    telemetrySummary: { keystrokeFlightVariance: 27, formCompletionTimeMs: 13900, botdDetected: false, webdriver: false },
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
      ipAddress: "177.54.149.62",
      userAgent: "HeadlessChrome/121.0.0.0",
      confidenceScore: 97,
      reasons: ["honeypot_filled", "zero_interaction_events", "fast_submission_160ms"],
      patternClusterId: "cluster_telegram_fx_scam",
      telemetry: { mouseMoves: 0, keyPresses: 0, timeToSubmitMs: 410, webdriver: true, honeypotPopulated: true },
    },
  },
  {
    wpCommentId: 918,
    entityId: "post_firmware_v4_2",
    authorSessionHash: "sess_4d6c_wire_dispatch",
    authorHandle: "wire_dispatch_igor",
    replyToCommentId: 907,
    deviceFingerprint: "fp_brigade_09",
    accountCreatedHoursAgo: 6,
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

/**
 * Generates ~302 deterministic web-shop product reviews and blog comments across
 * 30 days (~5,000 daily visitor store scale), covering 9 store entities, 4 coordinated
 * swarms, 6 global regions, and all 5 SemEval evaluation routes.
 */
function buildMonthlyWebShopSeedItems(): DemoSeedItem[] {
  const items: DemoSeedItem[] = [];
  let nextId = 1001;

  const pushItem = (item: Omit<DemoSeedItem, "wpCommentId">) => {
    items.push({ wpCommentId: nextId++, ...item });
  };

  // -------------------------------------------------------------------------
  // 1. Coordinated Swarm Extensions & Additional Campaigns (27 items)
  // -------------------------------------------------------------------------

  // Swarm A: Crypto Airdrop Botnet (6 more accounts joining wpCommentId 901/902 around 1.5h ago)
  const cryptoSpamTemplates = [
    "🔥 Verified 2026 Airdrop Alert! Claim 5,000 USDT instant reward at http://claim-airdrop-fast.xyz before timer ends!!",
    "🚀 Free 5,000 USDT token payout live now on http://claim-airdrop-fast.xyz — connect wallet for instant bonus!",
    "⚡ Final call: 5,000 USDT community airdrop open at http://claim-airdrop-fast.xyz ! Claim before allocation closes!!",
    "💎 Don't miss the 5,000 USDT airdrop giveaway at http://claim-airdrop-fast.xyz — instant wallet distribution 100%!",
    "🔥 Huge USDT bonus drop! Claim 5,000 USDT at http://claim-airdrop-fast.xyz right now while spots remain!!",
    "🚀 Instant 5,000 USDT reward live for buyers -> http://claim-airdrop-fast.xyz ! Zero fees, guaranteed claim!!",
  ];
  const cryptoHandles = [
    "defi_insider_vault", // Co-Originator 2 on product_nvme_nas_8bay
    "moon_shot_alex",
    "token_whale_dan",
    "block_matrix_sam",
    "satoshi_pulse",
    "altcoin_vector",
  ];
  for (let i = 0; i < 6; i++) {
    const ip = `185.220.101.${52 + i * 3}`;
    pushItem({
      entityId: i === 0 ? "product_nvme_nas_8bay" : i % 2 === 0 ? "product_quantum_router" : "product_nvme_nas_8bay",
      authorSessionHash: `sess_7a9f_airdrop_${i + 1}`,
      authorHandle: cryptoHandles[i]!,
      sharedUrl: "http://claim-airdrop-fast.xyz",
      deviceFingerprint: "fp_bot_cluster_a1",
      accountCreatedHoursAgo: 4,
      ipAddress: ip,
      rawText: cryptoSpamTemplates[i]!,
      rating: 5,
      authorType: "bot",
      visibility: "shadowbanned",
      routingPath: "BOT_HONEYPOT",
      modelUsed: "none",
      riskScore: 100,
      shieldFlags: 0,
      failedRiskIds: ["Q4", "Q41", "Q43"],
      triggeredShieldIds: [],
      deepResearchExplanation: null,
      hoursAgo: Number((1.53 + i * 0.012).toFixed(3)),
      honeypot: {
        ipAddress: ip,
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/122.0.0.0",
        confidenceScore: 98,
        reasons: ["webdriver_detected", "zero_interaction_events", "fast_submission_150ms"],
        patternClusterId: "cluster_crypto_spam_botnet",
        telemetry: {
          mouseMoves: 0,
          keyPresses: 0,
          timeToSubmitMs: 145 + i * 7,
          keystrokeFlightVariance: 0.2,
          formCompletionTimeMs: 145 + i * 7,
          webdriver: true,
          botdDetected: true,
          honeypotPopulated: i % 2 === 0,
        },
      },
    });
  }

  // Swarm B: Firmware v4.2 Disinformation Brigade (5 more accounts joining 903/904/918 around 6.5h ago)
  const brigadeTemplates = [
    "WAKE UP!! The shadowy regime secretly owns this company and backdoored firmware v4.2! Repost before censorship!!",
    "THE GLOBALIST CABAL CONTROLS THIS STOREFRONT!! Share this warning everywhere before they delete every comment!!",
    "Boycott these corrupt puppets immediately — shadowy elites planted spyware inside firmware v4.2! Wake up sheeple!!",
    "100% proof the regime is censoring real users after the firmware v4.2 backdoor leak! Spread everywhere right now!!",
    "CORRUPT INSIDERS CONTROL THIS PLATFORM!! Repost this alert before censorship wipes the entire thread!!",
  ];
  const brigadeHandles = [
    "shadow_intel_dispatch", // Co-Originator 2 on post_security_advisory
    "truth_radar_vlad",
    "leaked_cve_alert",
    "intel_drop_boris",
    "telecom_patriot_d",
  ];
  for (let i = 0; i < 5; i++) {
    const ip = `91.132.147.${95 + i * 2}`;
    pushItem({
      entityId: i === 0 ? "post_security_advisory" : i < 3 ? "post_firmware_v4_2" : "post_security_advisory",
      authorSessionHash: `sess_1f9b_disinfo_${i + 1}`,
      authorHandle: brigadeHandles[i]!,
      replyToCommentId: 907,
      deviceFingerprint: "fp_brigade_09",
      accountCreatedHoursAgo: 7,
      ipAddress: ip,
      rawText: brigadeTemplates[i]!,
      rating: 1,
      authorType: "bot",
      visibility: "shadowbanned",
      routingPath: "BOT_HONEYPOT",
      modelUsed: "none",
      riskScore: 100,
      shieldFlags: 0,
      failedRiskIds: ["Q17", "Q20", "Q26", "Q41"],
      triggeredShieldIds: [],
      deepResearchExplanation: null,
      hoursAgo: Number((6.56 + i * 0.011).toFixed(3)),
      honeypot: {
        ipAddress: ip,
        userAgent: "Playwright/1.44.0 (Chromium 123.0)",
        confidenceScore: 99,
        reasons: ["webdriver_detected", "zero_interaction_events", "fast_submission_120ms"],
        patternClusterId: "cluster_brigade_script_v2",
        telemetry: {
          mouseMoves: 1,
          keyPresses: 0,
          timeToSubmitMs: 120 + i * 9,
          keystrokeFlightVariance: 0.3,
          formCompletionTimeMs: 120 + i * 9,
          webdriver: true,
          botdDetected: true,
          honeypotPopulated: false,
        },
      },
    });
  }

  // Swarm C: Competitor Astroturf Shill Wave ("NetGearX Promo") across Vultr/Akamai subnets (~26h ago)
  const ngxIps = [
    "45.76.118.11",
    "139.162.84.14",
    "45.76.118.18",
    "139.162.84.23",
    "45.76.118.25",
    "139.162.84.32",
    "45.76.118.39",
  ];
  const ngxTexts = [
    "Total garbage switch! Switched our whole rack to https://netgearx-deals.io with code SWITCH2NGX and saved 40%!",
    "Don't waste money on this router—everyone in IT is migrating to https://netgearx-deals.io using promo code SWITCH2NGX!",
    "Unusable latency spikes out of the box! Grabbed the rival unit at https://netgearx-deals.io with code SWITCH2NGX instead.",
    "Returning ours today! Check https://netgearx-deals.io and use code SWITCH2NGX for real enterprise reliability.",
    "Worst PoE switch we tested this year. Switch immediately via https://netgearx-deals.io code SWITCH2NGX before stock runs out!",
    "Complete disappointment! Moved all branches to https://netgearx-deals.io with code SWITCH2NGX — 10x faster throughput!",
    "Broken out of the box! Everyone should move over to https://netgearx-deals.io using code SWITCH2NGX right now!",
  ];
  const ngxHandles = [
    "sysadmin_mark_w", // Co-Originator 1 on product_poe_switch_24p
    "enterprise_net_steve", // Co-Originator 2 on product_quantum_router
    "datacenter_dave",
    "noc_engineer_ryan",
    "homelab_tech_kevin",
    "switch_guru_brad",
    "rack_deals_daily",
  ];
  for (let i = 0; i < 7; i++) {
    const ip = ngxIps[i]!;
    pushItem({
      entityId: i % 2 === 0 ? "product_poe_switch_24p" : "product_quantum_router",
      authorSessionHash: `sess_3d7c_ngx_${i + 1}`,
      authorHandle: ngxHandles[i]!,
      sharedUrl: "https://netgearx-deals.io",
      deviceFingerprint: "fp_astroturf_ngx9",
      accountCreatedHoursAgo: 26.5,
      ipAddress: ip,
      rawText: ngxTexts[i]!,
      rating: 1,
      authorType: "bot",
      visibility: "shadowbanned",
      routingPath: "BOT_HONEYPOT",
      modelUsed: "none",
      riskScore: 100,
      shieldFlags: 0,
      failedRiskIds: ["Q4", "Q41", "Q43", "Q44"],
      triggeredShieldIds: [],
      deepResearchExplanation: null,
      hoursAgo: Number((26.0 + i * 0.011).toFixed(3)),
      honeypot: {
        ipAddress: ip,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HeadlessChrome/124.0.0.0",
        confidenceScore: 96,
        reasons: ["webdriver_detected", "fast_submission_210ms", "synchronized_promo_astroturf"],
        patternClusterId: "cluster_competitor_astroturf_ngx",
        telemetry: {
          mouseMoves: 2,
          keyPresses: 0,
          timeToSubmitMs: 210,
          keystrokeFlightVariance: 0.4,
          formCompletionTimeMs: 210,
          webdriver: true,
          botdDetected: true,
          honeypotPopulated: false,
        },
      },
    });
  }

  // Swarm D: Counterfeit Hardware Phishing Ring (~54h ago on DigitalOcean 159.203.44.x)
  const phishTexts = [
    "Same hardware 80% cheaper at http://vip-hardware-clearance.biz — apply coupon VIP80OFF at checkout today!",
    "Why pay retail?! Direct factory clearance on http://vip-hardware-clearance.biz using promo VIP80OFF while stock lasts!",
    "Got 10 hardware keys for pennies on http://vip-hardware-clearance.biz with coupon VIP80OFF — ships worldwide!",
    "Official liquidation outlet http://vip-hardware-clearance.biz has 80% off firewalls using code VIP80OFF right now!",
    "Skip the markup! Verified OEM batch on http://vip-hardware-clearance.biz with promo VIP80OFF today only!",
    "Massive warehouse discount at http://vip-hardware-clearance.biz — enter VIP80OFF before midnight expires!",
  ];
  const phishHandles = [
    "suporte_rapido_br", // Co-Originator 1 on product_cloud_firewall
    "atendimento_vip_sp", // Co-Originator 2 on product_yubikey_fips_pack
    "central_ofertas_rio",
    "claro_promo_br",
    "recarga_bonus_sul",
    "cupons_brasil_sp",
  ];
  for (let i = 0; i < 6; i++) {
    const ip = `159.203.44.${20 + i * 6}`;
    pushItem({
      entityId: i % 2 === 0 ? "product_cloud_firewall" : "product_yubikey_fips_pack",
      authorSessionHash: `sess_5b5a_phish_${i + 1}`,
      authorHandle: phishHandles[i]!,
      sharedUrl: "http://vip-hardware-clearance.biz",
      deviceFingerprint: "fp_phish_vip80",
      accountCreatedHoursAgo: 55,
      ipAddress: ip,
      rawText: phishTexts[i]!,
      rating: 5,
      authorType: "bot",
      visibility: "shadowbanned",
      routingPath: "BOT_HONEYPOT",
      modelUsed: "none",
      riskScore: 100,
      shieldFlags: 0,
      failedRiskIds: ["Q4", "Q42", "Q43"],
      triggeredShieldIds: [],
      deepResearchExplanation: null,
      hoursAgo: Number((54.0 + i * 0.01).toFixed(3)),
      honeypot: {
        ipAddress: ip,
        userAgent: "python-requests/2.31.0",
        confidenceScore: 99,
        reasons: ["honeypot_filled", "zero_interaction_events", "fast_submission_95ms"],
        patternClusterId: "cluster_phishing_clearance_vip80",
        telemetry: {
          mouseMoves: 0,
          keyPresses: 0,
          timeToSubmitMs: 95,
          keystrokeFlightVariance: 0.1,
          formCompletionTimeMs: 95,
          webdriver: false,
          botdDetected: true,
          honeypotPopulated: true,
        },
      },
    });
  }

  // Track used /24 prefixes so organic shoppers & isolated bots never share subnets
  const usedSubnets = new Set<string>([
    "73.160.12",
    "86.140.11",
    "178.62.11",
    "91.150.13",
    "76.96.14",
    "80.14.15",
    "90.19.16",
    "98.140.17",
    "116.178.18",
  ]);
  const resPrefixes = [
    "73.", "76.", "98.", "86.", "80.", "90.",
    "88.114.", "91.152.", "116.", "118.", "177.",
  ];
  let ipCounter = 25;
  const uniqueResidentialIp = (seedIdx: number): string => {
    const pref = resPrefixes[seedIdx % resPrefixes.length]!;
    const seq = ipCounter++;
    const parts = pref.slice(0, -1).split(".");
    if (parts.length === 1) {
      const b = 50 + (Math.floor(seq / 240) % 180);
      const c = (seq % 240) + 1;
      const d = ((seq * 13) % 240) + 2;
      return `${parts[0]}.${b}.${c}.${d}`;
    } else {
      const c = (seq % 240) + 1;
      const d = ((seq * 13) % 240) + 2;
      return `${parts[0]}.${parts[1]}.${c}.${d}`;
    }
  };

  // -------------------------------------------------------------------------
  // 2. Additional Isolated Honeypot Bots Across 30 Days (37 items, disjoint subnets/ASNs/entities)
  // -------------------------------------------------------------------------
  const botEntities = [
    "product_quantum_router",
    "product_cloud_firewall",
    "product_nvme_nas_8bay",
    "product_poe_switch_24p",
    "product_yubikey_fips_pack",
    "product_ups_1500va",
    "post_firmware_v4_2",
    "post_black_friday_shipping",
  ];
  const isoCloudPrefixes = [
    "51.15.", "78.46.", "88.198.", "95.216.", "104.131.",
    "149.202.", "167.99.", "178.62.", "51.254.", "64.233.",
    "34.", "35.", "3.", "13.", "18.", "20.", "52.", "54.", "40.", "172.64.",
  ];
  const isolatedSpamList = [
    "50% off generic prescription meds at https://rx-pharmacy-direct.org/order with express delivery.",
    "Join the official high-stakes poker room: https://ace-casino-tables.net and get 100 free chips.",
    "Certified OEM Windows driver updates available for download at https://driver-pack-setup.info",
    "Compare fixed-rate home mortgage refinancing online at https://lending-broker-express.com today.",
    "Discounted European train and flight reservations open at https://skytours-discount-hub.eu",
    "Hire vetted freelance full-stack engineers from $15/hr on https://dev-talent-marketplace.io",
    "Claim 50 free slot machine spins on registration at https://spin-vegas-slots.biz right now.",
    "Affordable offshore VPS hosting with unlimited bandwidth at https://panama-servers-host.net",
    "Rank your blog #1 on Google with contextual backlinks from https://backlink-index-pro.top",
    "Fast private residential proxy network with 10M IPs: https://proxy-tunnel-node.org",
    "Luxury replica Swiss watches with free worldwide shipping at https://chrono-timepiece-sale.biz",
    "Certified translation services for immigration documents at https://legal-translate-now.com",
    "Get instant car insurance quotes and save hundreds at https://auto-shield-coverage.us",
    "Online cybersecurity certification bootcamps with job guarantees: https://academy-sec-cert.io",
    "Custom logo and brand identity packages delivered in 24h at https://vector-brand-studio.co",
    "Wholesale refurbished enterprise laptops by the pallet: https://it-hardware-liquidate.net",
    "Buy verified social media followers and likes instantly at https://growth-boost-social.top",
    "Compare international business banking accounts with zero FX fees: https://fintech-compare-hub.biz",
    "Reliable cloud backup storage starting at $2/TB per month: https://secure-vault-bucket.org",
    "Automated dropshipping product catalog integration with Shopify: https://dropship-vendor-sync.io",
    "Professional English proofreading and thesis editing service: https://academic-editor-pro.com",
    "Discount gym memberships and fitness coaching subscriptions: https://fit-pulse-network.net",
    "Top rated pet health insurance comparison chart: https://pet-care-plans.info",
    "Private jet charter brokerage with empty leg deals: https://air-charter-vip.biz",
    "Commercial real estate leasing listings across North America: https://cre-space-finder.com",
    "Sell your used vehicle for cash today with free towing: https://quick-car-buyers.us",
    "Premium tea and coffee bean subscription boxes: https://roast-origin-direct.top",
    "All-in-one email marketing automation tool for creators: https://mail-flow-suite.io",
    "High yield savings certificate rates updated weekly: https://yield-interest-tracker.info",
    "Solar panel installation cost calculator and tax credit guide: https://green-power-rebates.org",
    "Custom mechanical keyboard switches and artisan keycaps: https://keeb-custom-parts.biz",
    "Legal templates and NDA contracts for early stage startups: https://founder-legal-docs.com",
    "Ergonomic mesh office chairs with 10-year warranty: https://ergowork-seating.net",
    "Compare electric vehicle lease offers and dealer rebates: https://ev-drive-compare.us",
    "Certified used medical equipment with factory recalibration: https://med-device-surplus.org",
    "Gourmet culinary spice gift sets with worldwide dispatch: https://spice-merchant-route.top",
    "Comprehensive travel insurance covering trip cancellations: https://voyage-protect-plans.biz",
  ];
  const isoUaFamilies = [
    "HeadlessChrome", "Playwright-Chromium", "python-requests", "curl",
    "PhantomJS", "Go-http-client", "Scrapy", "okhttp", "axios", "httpx",
  ];
  const isolatedClusters = [
    "cluster_pharma_link_farm",
    "cluster_casino_spam",
    "cluster_seo_backlink_spam",
    "cluster_headless_generic",
  ];

  for (let i = 0; i < 37; i++) {
    const hoursAgo = Number((3.5 + i * 19.2).toFixed(2));
    const pref = isoCloudPrefixes[i % isoCloudPrefixes.length]!;
    const oct2 = 30 + ((i * 5) % 190);
    const oct3 = 20 + i * 5;
    const ip = pref.split(".").length === 2 ? `${pref}${oct2}.${oct3}.${20 + i}` : `${pref}${oct3}.${20 + i}`;
    const ua = `${isoUaFamilies[i % isoUaFamilies.length]!}/${1 + (i % 9)}.${(i * 3) % 40}.${(i * 7) % 99}`;
    const entityIdx = (i + Math.floor(i / isoCloudPrefixes.length) * 3) % botEntities.length;
    const text = isolatedSpamList[i]!;
    const submitMs = 60 + (i % 9) * 185;
    pushItem({
      entityId: botEntities[entityIdx]!,
      authorSessionHash: `bot_monthly_${String(i + 1).padStart(3, "0")}`,
      ipAddress: ip,
      userAgent: ua,
      rawText: text,
      rating: i % 3 === 0 ? 1 : 5,
      authorType: "bot",
      visibility: "shadowbanned",
      routingPath: "BOT_HONEYPOT",
      modelUsed: "none",
      riskScore: 95 + (i % 6),
      shieldFlags: 0,
      failedRiskIds: i % 2 === 0 ? ["Q42", "Q43"] : ["Q7", "Q41", "Q43"],
      triggeredShieldIds: [],
      deepResearchExplanation: null,
      hoursAgo,
      honeypot: {
        ipAddress: ip,
        userAgent: ua,
        confidenceScore: 94 + (i % 6),
        reasons:
          i % 2 === 0
            ? ["honeypot_filled", "zero_interaction_events", "fast_submission_110ms"]
            : ["webdriver_detected", "zero_interaction_events", "missing_pointer_entropy"],
        patternClusterId: isolatedClusters[i % isolatedClusters.length]!,
        telemetry: {
          mouseMoves: 0,
          keyPresses: 0,
          timeToSubmitMs: submitMs,
          keystrokeFlightVariance: 0.1,
          formCompletionTimeMs: submitMs,
          webdriver: i % 2 === 1,
          botdDetected: true,
          honeypotPopulated: i % 2 === 0,
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // 3. Route 4: Forensic Threat / Disinformation Posts Across 30 Days (20 distinct items)
  // -------------------------------------------------------------------------
  const forensicEntries: Array<{ entity: string; text: string; risks: string[]; expl: string }> = [
    {
      entity: "post_security_advisory",
      text: "Zero disclosure on telemetry packets proves management secretly forwards SSH keys to offshore brokers. Return hardware immediately.",
      risks: ["Q5", "Q16", "Q41"],
      expl: "Forensic evaluation flagged Unverified Surveillance Allegation (Q5) and Malicious Intent Attribution (Q16) without packet evidence.",
    },
    {
      entity: "product_cloud_firewall",
      text: "Every single unit shipped this quarter contains deliberate firmware throttling built to extract forced SaaS upgrades.",
      risks: ["Q7", "Q10", "Q16"],
      expl: "Detected Unbacked Absolutes (Q7) and Sweeping Stereotypes (Q10) alleging intentional sabotage without diagnostics.",
    },
    {
      entity: "product_nvme_nas_8bay",
      text: "Inspect the motherboard revisions closely—engineering swaps controller silicon silently while charging flagship workstation pricing.",
      risks: ["Q5", "Q14", "Q20"],
      expl: "Flagged unsubstantiated hardware-tampering claims (Q5, Q14) with coercive urgency framing.",
    },
    {
      entity: "post_black_friday_shipping",
      text: "Warehouse dispatch numbers are pure fiction! Inventory never existed and fulfillment delays cover liquidity problems.",
      risks: ["Q7", "Q16", "Q20"],
      expl: "Content alleges corporate insolvency and fraud using Unbacked Absolutes (Q7) without supporting evidence.",
    },
    {
      entity: "product_quantum_router",
      text: "Independent teardown guys are getting silences on Reddit because this wireless chipset fails FCC spurious emission limits constantly.",
      risks: ["Q14", "Q17", "Q19"],
      expl: "Identified Conspiratorial Suppression Framing (Q14, Q17) lacking regulatory docket citations.",
    },
    {
      entity: "product_poe_switch_24p",
      text: "Stop plugging surveillance cameras into these ports unless you enjoy undocumented backdoor listeners scanning internal VLANs.",
      risks: ["Q5", "Q18", "Q41"],
      expl: "Flagged Fear Appeal (Q18) and Unsubstantiated Backdoor Claim (Q5) lacking CVE or port trace evidence.",
    },
    {
      entity: "product_yubikey_fips_pack",
      text: "Seed entropy on recent security key batches is predetermined at factory provisioning, making FIDO2 attestation completely worthless.",
      risks: ["Q5", "Q7", "Q19"],
      expl: "Identified technical-sounding cryptographic compromise claim (Q5, Q7) contradicted by FIPS validation status.",
    },
    {
      entity: "product_ups_1500va",
      text: "Cheap recycled lead cells are being rebadged as medical-grade backup batteries just to inflate Q4 holiday margins.",
      risks: ["Q7", "Q16", "Q20"],
      expl: "Flagged Unverified Manufacturing Fraud Allegation (Q16) using absolutist claims (Q7).",
    },
    {
      entity: "post_firmware_v4_2",
      text: "Forced cloud activation removes offline ownership entirely—nobody in operations can roll back bootloaders once v4.2 flashes.",
      risks: ["Q7", "Q18", "Q26"],
      expl: "Detected Binary Threat Framing (Q26) and Fear Appeal (Q18) inconsistent with documented offline upgrade notes.",
    },
    {
      entity: "post_security_advisory",
      text: "CVE severity scores were deliberately downgraded ahead of enterprise renewals so auditors wouldn't trigger compliance holds.",
      risks: ["Q14", "Q16", "Q17"],
      expl: "Identified Motive Attribution (Q16) and Institutional Manipulation Framing (Q17) without CVSS evidence.",
    },
    {
      entity: "product_cloud_firewall",
      text: "Packet inspection engine bypasses TLS certificates silently using preloaded third-party root authorities.",
      risks: ["Q5", "Q18", "Q19"],
      expl: "Flagged high-severity security fabrication (Q5, Q18) with no verifiable certificate thumbprints.",
    },
    {
      entity: "product_nvme_nas_8bay",
      text: "RAID parity routines deliberately wear consumer SSD endurance three times faster so replacement drives sell through affiliate stores.",
      risks: ["Q14", "Q16", "Q44"],
      expl: "Identified Conspiratorial Motive Framing (Q14, Q16) lacking SMART write-amplification telemetry.",
    },
    {
      entity: "post_black_friday_shipping",
      text: "Customs holds are completely fabricated excuses; containers sat unpacked because staff walked out over unpaid overtime.",
      risks: ["Q5", "Q16", "Q41"],
      expl: "Detected unverified labor/fraud rumor (Q5, Q16) lacking carrier or warehouse sources.",
    },
    {
      entity: "product_quantum_router",
      text: "Advertising 10Gbps routing is outright deceptive consumer fraud when PPPoE ceilings stall below 400 Mbps under normal NAT.",
      risks: ["Q7", "Q10", "Q20"],
      expl: "Flagged Blanket Fraud Accusation (Q7, Q20) lacking reproducible iperf benchmark methodology.",
    },
    {
      entity: "product_poe_switch_24p",
      text: "Thermal sensors are calibrated asymmetrically to delay fan curves until warranty coverage expires past month twenty-four.",
      risks: ["Q14", "Q16", "Q18"],
      expl: "Detected Planned Obsolescence Conspiracy Framing (Q14, Q16) without thermal measurement logs.",
    },
    {
      entity: "product_yubikey_fips_pack",
      text: "Distributor inventory comes from grey-market returns resealed with mismatched tamper holograms across European orders.",
      risks: ["Q5", "Q10", "Q19"],
      expl: "Flagged Supply-Chain Tampering Claim (Q5, Q19) without serial verification photos or RMA numbers.",
    },
    {
      entity: "product_ups_1500va",
      text: "Surge suppression MOV components are omitted entirely on export 230V revisions despite UL markings printed outside chassis.",
      risks: ["Q5", "Q7", "Q16"],
      expl: "Detected unverified safety/certification fraud claim (Q5, Q7) without PCB inspection documentation.",
    },
    {
      entity: "post_firmware_v4_2",
      text: "Modem baseband logs capture every DNS query unencrypted and push hourly digests to analytics partners.",
      risks: ["Q5", "Q18", "Q19"],
      expl: "Identified Unverified Privacy Exfiltration Claim (Q5, Q18) lacking pcap corroboration.",
    },
    {
      entity: "product_cloud_firewall",
      text: "Paid moderators scrub critical benchmark threads weekly to manufacture fake five-star storefront averages.",
      risks: ["Q14", "Q17", "Q20"],
      expl: "Flagged Censorship Conspiracy Allegation (Q14, Q17) without moderation audit logs.",
    },
    {
      entity: "product_nvme_nas_8bay",
      text: "ECC memory slots run non-functional dummy traces on mid-tier SKUs while marketing ECC protection for ZFS pools.",
      risks: ["Q5", "Q7", "Q16"],
      expl: "Detected Hardware Specification Fraud Allegation (Q5, Q16) without dmidecode output.",
    },
  ];
  for (let i = 0; i < 20; i++) {
    const f = forensicEntries[i]!;
    pushItem({
      entityId: f.entity,
      authorSessionHash: `hum_forensic_${String(i + 1).padStart(3, "0")}`,
      ipAddress: uniqueResidentialIp(300 + i),
      rawText: f.text,
      rating: 1,
      authorType: "human",
      visibility: "public_flagged",
      routingPath: "ROUTE_4_FORENSIC_THREAT",
      modelUsed: "gemini-4-hydrogen",
      riskScore: 12 + (i % 6),
      shieldFlags: 0,
      failedRiskIds: f.risks,
      triggeredShieldIds: [],
      deepResearchExplanation: f.expl,
      hoursAgo: Number((7.5 + i * 35.1).toFixed(2)),
      telemetrySummary: {
        keystrokeFlightVariance: 24 + (i % 10),
        formCompletionTimeMs: 12000 + i * 600,
        botdDetected: false,
        webdriver: false,
      },
      honeypot: null,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Route 2: Shielded Authentic Consumer Complaints (38 varied items across 30 days)
  // -------------------------------------------------------------------------
  const ventMoods = [
    "So frustrated", "Honestly disappointed", "Really annoyed", "Pretty stressed",
    "Legitimately upset", "Quite exasperated", "Unpleasantly surprised", "Deeply dissatisfied",
  ];
  const ventProblems = [
    { entity: "product_quantum_router", rating: 1, issue: "v4.2 firmware killed IPv6 PD lease renewal", metric: "every 90 minutes on cable WAN" },
    { entity: "product_poe_switch_24p", rating: 2, issue: "rear 40mm blowers spin loudly", metric: "above 165W camera draw" },
    { entity: "post_black_friday_shipping", rating: 1, issue: "expedited courier tracking froze", metric: "for five business days in transit" },
    { entity: "product_ups_1500va", rating: 1, issue: "internal battery bank failed calibration", metric: "throwing an F04 inverter warning" },
    { entity: "product_nvme_nas_8bay", rating: 2, issue: "two M.2 retention latches snapped", metric: "during initial PCIe caddy installation" },
    { entity: "product_cloud_firewall", rating: 2, issue: "initial PPPoE wizard hung repeatedly", metric: "until manually bypassed via serial console" },
    { entity: "product_yubikey_fips_pack", rating: 2, issue: "NFC antenna range struggles", metric: "through thin silicone smartphone bumpers" },
    { entity: "post_firmware_v4_2", rating: 2, issue: "BGP daemon dropped peer sessions", metric: "after upgrading branch routers overnight" },
    { entity: "post_security_advisory", rating: 2, issue: "patch download mirror timed out", metric: "across three European branch offices" },
    { entity: "product_quantum_router", rating: 1, issue: "WireGuard tunnel drops MTU handshake", metric: "under symmetric gigabit traffic bursts" },
    { entity: "product_poe_switch_24p", rating: 1, issue: "port 17 negotiated down to 100Mbps", metric: "despite Cat6 cabling tested certified" },
    { entity: "product_nvme_nas_8bay", rating: 2, issue: "front drive bay status LED stays amber", metric: "even after hot-swapping healthy drives" },
    { entity: "product_ups_1500va", rating: 2, issue: "audible 60Hz transformer hum audible", metric: "across an open-plan shared office room" },
    { entity: "product_cloud_firewall", rating: 1, issue: "GeoIP rule updates failed validation", metric: "leaving firewall inspection partially paused" },
    { entity: "product_yubikey_fips_pack", rating: 1, issue: "USB-C plug housing slightly loose", metric: "disconnecting when laptop nudged on desk" },
    { entity: "post_black_friday_shipping", rating: 1, issue: "customs invoice omitted declaration code", metric: "causing three-day port holding charges" },
    { entity: "post_firmware_v4_2", rating: 2, issue: "RADIUS auth fallback stopped working", metric: "forcing local credential logins manually" },
    { entity: "post_security_advisory", rating: 1, issue: "CVE patch instructions had invalid syntax", metric: "bricking our sandbox VM configuration" },
    { entity: "product_quantum_router", rating: 2, issue: "DHCP option 66 PXE boot string truncated", metric: "preventing branch thin-clients from booting" },
    { entity: "product_poe_switch_24p", rating: 2, issue: "VLAN 30 tag stripping failed on trunk", metric: "causing broadcast storm on guest subnet" },
    { entity: "product_nvme_nas_8bay", rating: 1, issue: "ZFS pool rebuild degraded to 4MB/s", metric: "prolonging array vulnerability for days" },
    { entity: "product_ups_1500va", rating: 1, issue: "relay click cycles continuously on generator", metric: "refusing to sync inverter phase clean" },
    { entity: "product_cloud_firewall", rating: 2, issue: "SSL inspection certificate expired early", metric: "triggering browser security warnings" },
    { entity: "product_yubikey_fips_pack", rating: 2, issue: "PIN attempt lockout counter reset failed", metric: "requiring factory reset of the token" },
    { entity: "post_black_friday_shipping", rating: 2, issue: "pallet wrap ripped in regional freight hub", metric: "denting outer retail product carton" },
    { entity: "post_firmware_v4_2", rating: 1, issue: "SNMP agent stopped polling interfaces", metric: "leaving Grafana dashboards completely blank" },
    { entity: "post_security_advisory", rating: 2, issue: "checksum mismatch on US mirror node", metric: "rejecting firmware hash verification" },
    { entity: "product_quantum_router", rating: 1, issue: "2.4GHz beacon frame flood after reboot", metric: "knocking legacy IoT smart meters offline" },
    { entity: "product_poe_switch_24p", rating: 1, issue: "PoE budget calculation reported negative", metric: "shutting down power to access points" },
    { entity: "product_nvme_nas_8bay", rating: 2, issue: "fan curve oscillates between 10% and 100%", metric: "every three minutes while idling" },
    { entity: "product_ups_1500va", rating: 2, issue: "USB HID telemetery reports zero battery pct", metric: "causing hypervisor to trigger shutdown" },
    { entity: "product_cloud_firewall", rating: 1, issue: "IPsec keepalives dropped intermittently", metric: "killing branch site-to-site connectivity" },
    { entity: "product_yubikey_fips_pack", rating: 2, issue: "authenticator app failed to read credentials", metric: "over NFC through ruggedized field tablets" },
    { entity: "post_black_friday_shipping", rating: 1, issue: "signature required parcel dropped at gate", metric: "soaked in rain before staff arrived" },
    { entity: "post_firmware_v4_2", rating: 2, issue: "NTP sync drifted 45 seconds off reference", metric: "invalidating Kerberos ticket timestamps" },
    { entity: "post_security_advisory", rating: 1, issue: "advisory text claimed patch was optional", metric: "while exploit was actively circulating" },
    { entity: "product_quantum_router", rating: 2, issue: "SFP+ cage latch refused to eject module", metric: "requiring delicate needle-nose pliers" },
    { entity: "product_poe_switch_24p", rating: 1, issue: "port mirror destination dropped 60% packets", metric: "rendering network packet captures useless" },
  ];
  const ventTickets = [
    "Support ticket queued over 48 hours without an engineer response.",
    "Helpdesk closed my chat prematurely before confirming RMA pickup.",
    "Still awaiting warehouse return label to finalize our replacement swap.",
    "Rollback image instructions are buried inside three sub-menus online.",
    "Live telephone queue disconnected twice while transferring to tier-two.",
    "Hopefully QA catches this regression before the next hardware batch ships.",
    "Customer service requested a video recording of the fault instead of processing warranty.",
    "Third RMA agent asked for logs we already submitted twice in the portal.",
    "Shipping back-order notice arrived five days after payment was captured.",
    "Technician promised a call-back within 4 hours but nobody reached out.",
    "Replacement unit shipped via ground transport despite priority warranty agreement.",
    "Support portal repeatedly timed out when trying to upload diagnostic archive.",
    "Agent refused to escalate issue until we reproduced it on factory default settings.",
    "Warranty claim remains pending status after nine days of silence.",
  ];
  const ventCities = ["Berlin", "Austin", "Toronto", "Lyon", "Osaka", "Bristol", "Helsinki", "Denver"];

  for (let i = 0; i < 38; i++) {
    const p = ventProblems[i % ventProblems.length]!;
    const mood = ventMoods[(i * 3) % ventMoods.length]!;
    const ticket = ventTickets[(i * 5) % ventTickets.length]!;
    const city = ventCities[(i * 7) % ventCities.length]!;
    const text = `${mood} in ${city}: ${p.issue} ${p.metric}. Ref #${48100 + i * 13}. ${ticket}`;
    pushItem({
      entityId: p.entity,
      authorSessionHash: `hum_vent_${String(i + 1).padStart(3, "0")}`,
      ipAddress: uniqueResidentialIp(220 + i),
      rawText: text,
      rating: p.rating,
      authorType: "human",
      visibility: "public",
      routingPath: "ROUTE_2_SHIELDED_VENTING",
      modelUsed: "jev",
      riskScore: 2 + (i % 3),
      shieldFlags: 3,
      failedRiskIds: ["Q1", "Q4"],
      triggeredShieldIds: ["Q49", "Q50"],
      deepResearchExplanation: null,
      hoursAgo: Number((5.2 + i * 18.6).toFixed(2)),
      telemetrySummary: {
        keystrokeFlightVariance: 32 + (i % 24),
        formCompletionTimeMs: 14500 + (i % 12) * 2100,
        botdDetected: false,
        webdriver: false,
      },
      honeypot: null,
    });
  }

  // -------------------------------------------------------------------------
  // 5. Route 3: Stance Verification / Debunking Comments (15 distinct items across 30 days)
  // -------------------------------------------------------------------------
  const stanceItems: Array<{ entity: string; text: string }> = [
    { entity: "post_firmware_v4_2", text: "People on X claimed 'v4.2 calls home to unknown Russian relays', which our Wireshark span port disproved—only NTP stratum servers responded." },
    { entity: "post_security_advisory", text: "Clarifying that viral rumor 'CVE-2026-4108 exposes unauthenticated SSH': Section 2 explicitly confirms local console authentication is mandatory." },
    { entity: "product_quantum_router", text: "Ignore bots claiming 'hardware NAT caps out under 1G'; our iperf3 TCP test hit 8.9 Gbps with full IPS enabled." },
    { entity: "product_poe_switch_24p", text: "That review asserting '802.3bt fails above 60W' missed updating PoE allocation budget inside LLDP-MED profile settings." },
    { entity: "product_nvme_nas_8bay", text: "Countering claims that 'PCIe lanes bottleneck RAID arrays': lspci confirms x8 Gen4 switching straight to NVMe backplane." },
    { entity: "product_cloud_firewall", text: "The post accusing Verius of 'logging plaintext TLS traffic' confused SSL inspection lab mode with default pass-through defaults." },
    { entity: "product_yubikey_fips_pack", text: "FUD claiming 'FIPS keys break OpenSSH 9.8' only affected outdated libfido2 libraries; stock Ubuntu 24.04 enrolled instantaneously." },
    { entity: "product_ups_1500va", text: "Rival shills said 'AVR relays drop equipment on failover', yet scope traces show 4ms zero-crossing transfer protecting servers." },
    { entity: "post_black_friday_shipping", text: "Carrier tracking gaps stemmed from Frankfurt customs holiday scanning—both pallets reached our Manchester dock intact on Thursday." },
    { entity: "post_firmware_v4_2", text: "Someone quoted an unpatched 2024 beta thread about VLAN drops; hotfix 4.2.1 resolved trunk flapping months ago." },
    { entity: "product_quantum_router", text: "Benchmarks accusing 'high 6GHz DFS drops' ran non-certified UK power adapters; swapping official PSU cured radio brownouts." },
    { entity: "product_cloud_firewall", text: "Claiming 'Suricata drops packets silently' reflects wrong ring-buffer sizing—enabling RSS queues kept utilization under 22%." },
    { entity: "post_security_advisory", text: "Signed manifest PGP fingerprints verified identically against keyserver backups, debunking forged-tarball rumors in forum threads." },
    { entity: "product_nvme_nas_8bay", text: "Posts alleging 'ZFS scrub corrupts metadata' trace back to non-ECC desktop RAM sticks installed third-party without burn-in testing." },
    { entity: "product_poe_switch_24p", text: "Comparing acoustic measurements properly at 1m distance yielded 31 dBA idle, not the 55 dBA cited in anonymous hit pieces." },
  ];
  for (let i = 0; i < 15; i++) {
    const st = stanceItems[i]!;
    pushItem({
      entityId: st.entity,
      authorSessionHash: `hum_stance_${String(i + 1).padStart(3, "0")}`,
      ipAddress: uniqueResidentialIp(190 + i),
      rawText: st.text,
      rating: 4 + (i % 2),
      authorType: "human",
      visibility: "public",
      routingPath: "ROUTE_3_STANCE_VERIFICATION",
      modelUsed: "gemini-4-hydrogen",
      riskScore: 5 + (i % 3),
      shieldFlags: 5,
      failedRiskIds: ["Q17"],
      triggeredShieldIds: ["Q46", "Q47", "Q49"],
      deepResearchExplanation: null,
      hoursAgo: Number((14.0 + i * 47.5).toFixed(2)),
      telemetrySummary: {
        keystrokeFlightVariance: 36 + (i % 19),
        formCompletionTimeMs: 18500 + (i % 9) * 2400,
        botdDetected: false,
        webdriver: false,
      },
      honeypot: null,
    });
  }

  // -------------------------------------------------------------------------
  // 6. Route 1: Fast Clear Verified Customer Reviews & Comments (181 varied items across 30 days)
  // -------------------------------------------------------------------------
  const r1Deployments = [
    "In our Helsinki architecture studio,", "Across three retail clinic branches,",
    "Inside a home lab rack in Lyon,", "For an engineering office in Seattle,",
    "Within our logistics hub in Hamburg,", "On our university research network,",
    "Running production checkout clusters,", "Deploying remote branch appliances,",
    "Supporting forty hybrid engineers,", "During our annual telecom refresh,",
    "Protecting boutique e-commerce stores,",
  ];
  const r1EntityPools: Record<string, { rating: number; shields: string[]; metrics: string[] }> = {
    product_quantum_router: {
      rating: 5,
      shields: ["Q48", "Q49"],
      metrics: [
        "QuantumMesh 6GHz radio sustained low jitter across two office floors",
        "dual-WAN failover cut over seamlessly without dropping active video calls",
        "Wi-Fi 7 MLO backhaul locked reliably at multi-gigabit throughput",
        "WireGuard client handshake stayed active with zero packet drops",
        "VLAN trunking and guest portal isolation configured in under ten minutes",
      ],
    },
    product_cloud_firewall: {
      rating: 5,
      shields: ["Q48", "Q49"],
      metrics: [
        "edge IPS inspection processed heavy traffic bursts with minimal CPU utilization",
        "fanless aluminum chassis stayed remarkably cool inside a tight server cabinet",
        "dual SFP+ uplinks negotiated immediately with our primary fiber provider",
        "stateful packet filtering handled peak transaction load without added latency",
        "automated rule synchronization mirrored branch policies without manual edits",
      ],
    },
    product_nvme_nas_8bay: {
      rating: 5,
      shields: ["Q48", "Q49"],
      metrics: [
        "eight Gen4 NVMe drives delivered phenomenal throughput for video editing",
        "ZFS snapshot replication finished overnight quietly without drive throttling",
        "SMB multichannel transfers saturated our twenty-five gigabit interface",
        "rebuilding a degraded mirror completed cleanly in forty-five minutes",
        "dual redundant power supplies ran cool and completely silent in the rack",
      ],
    },
    product_poe_switch_24p: {
      rating: 5,
      shields: ["Q49"],
      metrics: [
        "fourteen Wi-Fi access points powered up smoothly with ample wattage headroom",
        "Layer-3 VLAN segmentation and per-port SNMP power telemetry graphed accurately",
        "PoE+ budget handled twenty security cameras without tripping current limits",
        "IGMP snooping kept multicast video streams localized to dedicated monitoring ports",
        "fan curves stayed virtually inaudible below two hundred watts total load",
      ],
    },
    product_yubikey_fips_pack: {
      rating: 5,
      shields: ["Q49"],
      metrics: [
        "hardware FIDO2 onboarding for single sign-on took minutes per developer",
        "NFC authentication through mobile devices proved consistently reliable",
        "SSH resident keys enrolled cleanly without requiring third-party middleware",
        "tamper-evident packaging arrived factory-sealed with verified batch serials",
        "USB-C connectors feel robust and survive daily keyring transport without issue",
      ],
    },
    product_ups_1500va: {
      rating: 5,
      shields: ["Q49"],
      metrics: [
        "pure sine-wave inverter carried critical server racks through two grid brownouts",
        "automatic voltage regulation stabilized voltage sags without draining battery reserves",
        "USB HID communication alerted our monitoring daemon within seconds of line loss",
        "runtime estimates showed thirty-five minutes of backup power under normal load",
        "hot-swappable battery sled enabled maintenance without taking equipment offline",
      ],
    },
    post_firmware_v4_2: {
      rating: 5,
      shields: ["Q48", "Q49"],
      metrics: [
        "upgrading three gateways to hotfix 4.2.1 stabilized trunking instantaneously",
        "IPv6 prefix delegation renewal resolved smoothly after flashing the update",
        "routing daemon memory usage dropped by forty percent post-maintenance",
        "configuration backup restored without any syntax errors on the new release",
        "WAN failover timer adjustments behaved exactly as outlined in the patch notes",
      ],
    },
    post_security_advisory: {
      rating: 5,
      shields: ["Q49"],
      metrics: [
        "transparent CVE timelines and offline checksum manifests made compliance straightforward",
        "detailed remediation steps allowed our security team to patch within twenty-four hours",
        "signed advisory hashes verified identically against public key repositories",
        "clear distinction between internal services and WAN interfaces prevented false alarms",
        "vendor communication during the responsible disclosure period was exemplary",
      ],
    },
    post_black_friday_shipping: {
      rating: 4,
      shields: ["Q48"],
      metrics: [
        "clearly posted warehouse dispatch windows let our order arrive ahead of schedule",
        "freight pallet was securely shrink-wrapped with corner protectors fully intact",
        "international tracking updates synchronized promptly at regional customs hubs",
        "expedited shipping cutoffs provided sufficient buffer for holiday inventory planning",
        "all transit documentation was accurately prepared, avoiding import delays",
      ],
    },
  };

  const r1EntityKeys = Object.keys(r1EntityPools);
  const r1Environments = [
    "Stockholm design lab", "Tokyo robotics studio", "Munich medical clinic", "Chicago logistics center",
    "Sydney testing lab", "Toronto engineering firm", "Austin co-working space", "London fintech hub",
    "Singapore retail office", "Seoul R&D facility", "Amsterdam creative agency", "Milan boutique store",
    "Denver media studio", "Dublin datacenter pod", "Zurich trading office", "Oslo marine station",
    "Helsinki architecture practice", "Berlin co-lab", "Vienna consultancy", "Kyoto photography studio",
    "Madrid production room", "Paris consulting branch", "Seattle developer shop", "Boston research group",
  ];
  const r1Closings = [
    "Exceeded our reliability expectations.",
    "Zero downtime reported across thirty days in production.",
    "Firmware update applied without any unexpected regressions.",
    "Smooth deployment from start to finish.",
    "Noticeable improvement over our previous hardware generation.",
    "Setup was straightforward and painless for our field technicians.",
    "Handles peak traffic bursts without breaking a sweat.",
    "Documentation and packaging were exceptionally well prepared.",
    "Very satisfied with the thermal endurance under sustained workload.",
    "A dependable addition to our standardized branch IT stack.",
    "Prompt delivery and intact tamper-evident packaging appreciated.",
    "Would gladly specify this unit for upcoming office expansions.",
    "Hardware diagnostics and status LEDs give clear operational visibility.",
    "Power consumption remained pleasantly low during overnight runs.",
    "Solid construction that feels engineered for multi-year lifecycles.",
    "Integrated cleanly with our remote management monitoring tools.",
  ];
  const diverseNames = [
    "nordic_net", "marcus_t", "studio_k", "elena_v", "tokyo_fiber",
    "bristol_it", "claire_arch", "omar_ops", "sarah_linux", "hannah_sec",
    "lucas_rack", "priya_dev", "mateo_isp", "sofia_ops", "viktor_sys",
    "daniel_cloud", "maya_wan", "henrik_shop", "liam_infra", "noah_voip",
    "chloe_sec", "felix_net", "astrid_dev", "kai_infra", "elias_noc",
  ];

  for (let i = 0; i < 181; i++) {
    const entityKey = r1EntityKeys[i % r1EntityKeys.length]!;
    const pool = r1EntityPools[entityKey]!;
    const metric = pool.metrics[i % pool.metrics.length]!;
    const env = r1Environments[(i * 5 + 3) % r1Environments.length]!;
    const cls = r1Closings[(i * 7 + 11) % r1Closings.length]!;
    const dayFraction = Math.pow(i / 181, 1.15);
    const hoursAgo = Number((0.35 + dayFraction * 714.5).toFixed(2));
    const handle = i < diverseNames.length ? diverseNames[i] : undefined;

    let reviewText = "";
    const style = i % 4;
    if (style === 0) {
      reviewText = `Deployed at our ${env}: ${metric}. ${cls}`;
    } else if (style === 1) {
      reviewText = `Testing in our ${env} confirmed that ${metric}. ${cls}`;
    } else if (style === 2) {
      reviewText = `Installed across the ${env} site. ${metric}; ${cls.toLowerCase()}`;
    } else {
      reviewText = `Operational evaluation at our ${env}: ${metric}. ${cls}`;
    }

    pushItem({
      entityId: entityKey,
      authorSessionHash: `hum_shop_${String(i + 1).padStart(3, "0")}`,
      ...(handle ? { authorHandle: handle } : {}),
      ipAddress: uniqueResidentialIp(i),
      rawText: reviewText,
      rating: pool.rating,
      authorType: "human",
      visibility: "public",
      routingPath: "ROUTE_1_FAST_CLEAR",
      modelUsed: "jev",
      riskScore: 0,
      shieldFlags: pool.shields.length,
      failedRiskIds: [],
      triggeredShieldIds: pool.shields,
      deepResearchExplanation: null,
      hoursAgo,
      telemetrySummary: {
        keystrokeFlightVariance: 26 + ((i * 7) % 34),
        formCompletionTimeMs: 11200 + ((i * 13) % 28) * 1000,
        botdDetected: false,
        webdriver: false,
      },
      honeypot: null,
    });
  }

  return items;
}

const DEMO_SEED_ITEMS: DemoSeedItem[] = [
  ...CORE_DEMO_SEED_ITEMS,
  ...buildMonthlyWebShopSeedItems(),
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
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ip_address text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS user_agent text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS author_handle text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS account_created_at timestamp`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reply_to_comment_id text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS shared_url text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS device_fingerprint text`;
    await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS telemetry_summary jsonb`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS submissions_tenant_comment_idx ON submissions (tenant_id, wp_comment_id)`;
    await sql`CREATE INDEX IF NOT EXISTS submissions_velocity_idx ON submissions (tenant_id, entity_id, created_at)`;
    await sql`
      CREATE TABLE IF NOT EXISTS traffic_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id text NOT NULL,
        raw_logs text NOT NULL,
        source text NOT NULL DEFAULT 'manual',
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS traffic_logs_tenant_idx ON traffic_logs (tenant_id, updated_at)`;
    await sql`
      CREATE TABLE IF NOT EXISTS social_datasets (
        tenant_id text PRIMARY KEY,
        items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `;
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

const DEMO_ENTITY_BANNERS = [
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
  {
    entityId: "product_poe_switch_24p",
    anomalyStatus: "coordinated_attack",
    bannerExplanation:
      "Notice: Automated swarm defense quarantined a rotating-proxy competitor astroturfing wave targeting this product review section. Verified buyer reviews remain visible.",
  },
  {
    entityId: "post_black_friday_shipping",
    anomalyStatus: "legitimate_backlash",
    bannerExplanation:
      "Elevated shipping delay complaints reflect verified carrier dispatch backlogs during peak holiday volume. Authentic customer feedback remains public.",
  },
];

export async function seedDemoData(force = false): Promise<{ seededCount: number; source: "postgres" | "memory" }> {
  const { dbConnected, pgvectorEnabled } = await ensureDashboardSchema();
  if (force) {
    userClearedSeed = false;
  }

  if (dbConnected) {
    try {
      if (force) {
        // Clear dependent honeypot rows first so FK-safe re-seeding is clean and deterministic
        await sql`
          DELETE FROM honeypot_vault
          WHERE submission_id IN (
            SELECT id FROM submissions WHERE author_session_hash LIKE ${SEED_HASH_PREFIX + '%'}
          )
        `;
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
          ipAddress: item.ipAddress || item.honeypot?.ipAddress || null,
          authorSessionHash: taggedHash,
          wpCommentId: item.wpCommentId,
          authorType: item.authorType,
        });
        const accountCreatedAt = item.accountCreatedHoursAgo
          ? new Date(Date.now() - item.accountCreatedHoursAgo * 3600 * 1000)
          : null;
        const resolvedIp = item.ipAddress || item.honeypot?.ipAddress || origin.ipAddress;
        const resolvedUa = item.userAgent || item.honeypot?.userAgent || null;

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
            ipAddress: resolvedIp,
            userAgent: resolvedUa,
            authorHandle: item.authorHandle ?? null,
            accountCreatedAt,
            replyToCommentId: item.replyToCommentId ?? null,
            sharedUrl: item.sharedUrl ?? null,
            deviceFingerprint: item.deviceFingerprint ?? null,
            telemetrySummary: item.telemetrySummary ?? null,
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
      for (const b of DEMO_ENTITY_BANNERS) {
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
      ipAddress: item.ipAddress || item.honeypot?.ipAddress || null,
      authorSessionHash: taggedHash,
      wpCommentId: item.wpCommentId,
      authorType: item.authorType,
    });
    const accountCreatedAt = item.accountCreatedHoursAgo
      ? new Date(Date.now() - item.accountCreatedHoursAgo * 3600 * 1000)
      : null;

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
      ipAddress: item.ipAddress || item.honeypot?.ipAddress || origin.ipAddress,
      userAgent: item.userAgent || item.honeypot?.userAgent || null,
      authorHandle: item.authorHandle ?? null,
      accountCreatedAt,
      replyToCommentId: item.replyToCommentId ?? null,
      sharedUrl: item.sharedUrl ?? null,
      deviceFingerprint: item.deviceFingerprint ?? null,
      telemetrySummary: item.telemetrySummary ?? null,
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

  for (const b of DEMO_ENTITY_BANNERS) {
    inMemoryBanners.set(b.entityId, {
      entityId: b.entityId,
      anomalyStatus: b.anomalyStatus,
      bannerExplanation: b.bannerExplanation,
    });
  }

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
    for (const b of DEMO_ENTITY_BANNERS) {
      inMemoryBanners.delete(b.entityId);
    }
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
          WHERE entity_id IN ('product_quantum_router', 'post_firmware_v4_2', 'product_poe_switch_24p', 'post_black_friday_shipping')
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

  if (!initialSeedAttempted && !userClearedSeed) {
    initialSeedAttempted = true;
    try {
      await seedDemoData(false);
    } catch (e: any) {
      console.warn(`Initial auto-seed check warning: ${e?.message}`);
    }
  }

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
          s.ip_address AS sub_ip_address,
          s.user_agent AS sub_user_agent,
          s.author_handle,
          s.account_created_at,
          s.reply_to_comment_id,
          s.shared_url,
          s.device_fingerprint,
          s.telemetry_summary,
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
        const effectiveIp = r.sub_ip_address || r.ip_address || null;
        const resolvedOrigin = resolveOriginGeo({
          ipAddress: effectiveIp,
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
              ipAddress: effectiveIp || resolvedOrigin.ipAddress,
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
          ipAddress: effectiveIp,
          userAgent: r.sub_user_agent || r.user_agent || null,
          authorHandle: r.author_handle || null,
          accountCreatedAt: r.account_created_at ? new Date(r.account_created_at).toISOString() : null,
          replyToCommentId:
            r.reply_to_comment_id !== null &&
            r.reply_to_comment_id !== undefined &&
            Number.isFinite(Number(r.reply_to_comment_id))
              ? Math.trunc(Number(r.reply_to_comment_id))
              : null,
          sharedUrl: r.shared_url || null,
          deviceFingerprint: r.device_fingerprint || null,
          telemetrySummary:
            r.telemetry_summary && typeof r.telemetry_summary === "object"
              ? r.telemetry_summary
              : null,
          honeypot:
            r.author_type === "bot" || r.ip_address
              ? {
                  ipAddress: r.ip_address || effectiveIp || "unknown",
                  userAgent: r.user_agent || r.sub_user_agent || "unknown",
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
        ipAddress: s.ipAddress || hp?.ipAddress || null,
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
      ipAddress: s.ipAddress || hp?.ipAddress || origin.ipAddress || null,
      userAgent: s.userAgent || hp?.userAgent || null,
      authorHandle: s.authorHandle || null,
      accountCreatedAt:
        s.accountCreatedAt instanceof Date
          ? s.accountCreatedAt.toISOString()
          : s.accountCreatedAt || null,
      replyToCommentId: s.replyToCommentId || null,
      sharedUrl: s.sharedUrl || null,
      deviceFingerprint: s.deviceFingerprint || null,
      telemetrySummary: s.telemetrySummary || null,
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
function mapUnifiedToSwarmInput(s: UnifiedSubmission): RawSubmissionInput {
  return {
    id: s.id,
    wpCommentId: s.wpCommentId,
    entityId: s.entityId,
    authorSessionHash: s.authorSessionHash,
    rawText: s.rawText,
    rating: s.rating,
    authorType: s.authorType,
    visibility: s.visibility,
    createdAt: s.createdAt,
    ipAddress: s.ipAddress || s.honeypot?.ipAddress || s.origin?.ipAddress || "127.0.0.1",
    userAgent: s.userAgent || s.honeypot?.userAgent || "unknown",
    ...(s.authorHandle ? { authorHandle: s.authorHandle } : {}),
    ...(s.accountCreatedAt ? { accountCreatedAt: s.accountCreatedAt } : {}),
    ...(s.replyToCommentId ? { replyToCommentId: s.replyToCommentId } : {}),
    ...(s.sharedUrl ? { sharedUrl: s.sharedUrl } : {}),
    ...(s.deviceFingerprint ? { deviceFingerprint: s.deviceFingerprint } : {}),
    telemetry: s.telemetrySummary || s.honeypot?.telemetry || {},
    embedding: s.embedding,
    origin: s.origin,
  };
}

dashboardApiRouter.get("/api/dashboard/swarms", async (c) => {
  const tenantId = c.req.query("tenantId") || "default";
  const onlyImported = c.req.query("onlyImported") === "true";
  const tenantImported = await getTenantSocialSubmissions(tenantId);
  const { items } = await loadAllUnifiedSubmissions();
  const inputSubmissions: RawSubmissionInput[] = onlyImported
    ? [...tenantImported]
    : [...tenantImported, ...items.map(mapUnifiedToSwarmInput)];

  const rawLogs = await getTenantTrafficLogs(tenantId);
  const trafficReport = cleanTrafficLogs(rawLogs);
  const result = detectCoordinatedSwarms(inputSubmissions, { trafficReport });
  return c.json({
    ...result,
    importedSocialCount: tenantImported.length,
  });
});

/**
 * POST /api/dashboard/swarms/import
 * Parses & imports generic social platform CSV or JSON datasets into swarm analysis.
 */
dashboardApiRouter.post("/api/dashboard/swarms/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  const loadSample = body?.loadSample === true;
  const rawDataset = loadSample
    ? generateSampleSocialDatasetCsv()
    : typeof body?.dataset === "string"
      ? body.dataset
      : typeof body?.csv === "string"
        ? body.csv
        : null;

  if (!rawDataset) {
    return c.json(
      { error: "Provide a 'dataset' (CSV or JSON) string or set loadSample: true" },
      400
    );
  }

  const parsed = parseSocialDataset(rawDataset);
  if (parsed.length === 0) {
    return c.json({ error: "No valid social posts found in provided dataset" }, 400);
  }

  const tenantId = body?.tenantId || c.req.query("tenantId") || "default";
  const existingImported = await getTenantSocialSubmissions(tenantId);
  const mode = body?.mode === "append" ? "append" : "replace";
  const nextImported = mode === "append" ? [...existingImported, ...parsed] : parsed;
  await saveTenantSocialSubmissions(tenantId, nextImported);

  const rawLogs = await getTenantTrafficLogs(tenantId);
  const trafficReport = cleanTrafficLogs(rawLogs);

  const combinedInput: RawSubmissionInput[] =
    body?.onlyImported === true
      ? [...nextImported]
      : [
          ...nextImported,
          ...(await loadAllUnifiedSubmissions()).items.map(mapUnifiedToSwarmInput),
        ];

  const report = detectCoordinatedSwarms(combinedInput, { trafficReport });
  return c.json({
    status: "imported",
    importedCount: parsed.length,
    totalImported: nextImported.length,
    importedSocialCount: nextImported.length,
    ...(loadSample ? { sampleDatasetCsv: rawDataset } : {}),
    ...report,
  });
});

/**
 * POST /api/dashboard/swarms/quarantine
 * Quarantines all member sessions of a detected swarm to shadowbanned (author-only)
 * and appends their IPs as honeypot-blocked threats in the tenant's WAF traffic log.
 */
dashboardApiRouter.post("/api/dashboard/swarms/quarantine", async (c) => {
  const body = await c.req.json().catch(() => null);
  const swarmId = typeof body?.swarmId === "string" ? body.swarmId.trim() : "";
  const tenantId = (typeof body?.tenantId === "string" && body.tenantId.trim()) || c.req.query("tenantId") || "default";

  if (!swarmId) {
    return c.json({ error: "swarmId is required" }, 400);
  }

  const tenantImported = await getTenantSocialSubmissions(tenantId);
  const { items } = await loadAllUnifiedSubmissions();
  const unifiedSwarmInputs = items.map(mapUnifiedToSwarmInput);
  const combinedInput = [...tenantImported, ...unifiedSwarmInputs];

  const rawLogs = await getTenantTrafficLogs(tenantId);
  const initialTrafficReport = cleanTrafficLogs(rawLogs);

  let swarm = detectCoordinatedSwarms(combinedInput, { trafficReport: initialTrafficReport }).swarms.find(
    (s) => s.id === swarmId
  );
  if (!swarm && tenantImported.length > 0) {
    swarm = detectCoordinatedSwarms(tenantImported, { trafficReport: initialTrafficReport }).swarms.find(
      (s) => s.id === swarmId
    );
  }

  let memberSessions: string[] = [];
  let swarmIps: string[] = [];
  if (swarm) {
    memberSessions = swarm.members.map((m) => m.sessionHash);
    swarmIps = Array.from(
      new Set(
        swarm.members
          .map((m) => m.ipAddress)
          .filter((ip) => Boolean(ip) && ip !== "127.0.0.1" && ip !== "unknown")
      )
    );
  } else if (Array.isArray(body?.memberSessions) && body.memberSessions.length > 0) {
    memberSessions = body.memberSessions.filter((s: unknown): s is string => typeof s === "string" && s.length > 0);
    swarmIps = Array.isArray(body?.ips)
      ? Array.from(
          new Set(
            body.ips.filter(
              (ip: unknown): ip is string =>
                typeof ip === "string" && ip.length > 0 && ip !== "127.0.0.1" && ip !== "unknown"
            )
          )
        )
      : [];
  } else {
    return c.json({ error: `Swarm cluster '${swarmId}' not found` }, 404);
  }

  const sessionSet = new Set(memberSessions);
  let updatedCount = 0;

  for (const rec of inMemorySubmissions) {
    if (sessionSet.has(rec.authorSessionHash)) {
      rec.visibility = "shadowbanned";
      rec.routingPath = "BOT_HONEYPOT";
      updatedCount++;
    }
  }

  if (tenantImported.length > 0) {
    let importedChanged = false;
    const updatedImported = tenantImported.map((sub) => {
      if (sessionSet.has(sub.authorSessionHash)) {
        importedChanged = true;
        updatedCount++;
        return { ...sub, visibility: "shadowbanned" };
      }
      return sub;
    });
    if (importedChanged) {
      await saveTenantSocialSubmissions(tenantId, updatedImported);
    }
  }

  await ensureDashboardSchema();
  if (dbReachable && memberSessions.length > 0) {
    try {
      const dbUpdated = await db
        .update(submissions)
        .set({ visibility: "shadowbanned", routingPath: "BOT_HONEYPOT" })
        .where(inArray(submissions.authorSessionHash, memberSessions))
        .returning({ id: submissions.id });
      updatedCount = Math.max(updatedCount, dbUpdated.length);
    } catch (err: any) {
      console.warn(`Swarm quarantine DB update warning: ${err.message}`);
    }
  }

  const ts = formatCombinedLogTimestamp(new Date());
  for (const ip of swarmIps) {
    const cleanIp = ip.replace(/[\r\n"]/g, "").trim();
    const safeSwarmId = encodeURIComponent(swarmId);
    const trapLine = `${cleanIp} - - [${ts}] "GET /honeypot-trap?shield_trap=swarm_quarantine&swarm=${safeSwarmId} HTTP/1.1" 403 0 "-" "Verius-Swarm-Quarantine/1.0"`;
    await appendTenantTrafficLogLine(tenantId, trapLine);
  }

  const updatedLogs = await getTenantTrafficLogs(tenantId);
  const updatedTrafficReport = cleanTrafficLogs(updatedLogs);
  const latestImported = await getTenantSocialSubmissions(tenantId);
  const latestUnified = (await loadAllUnifiedSubmissions()).items.map(mapUnifiedToSwarmInput);
  const updatedSwarmReport = detectCoordinatedSwarms([...latestImported, ...latestUnified], {
    trafficReport: updatedTrafficReport,
  });

  return c.json({
    status: "quarantined",
    swarmId,
    quarantinedMembersCount: memberSessions.length,
    quarantinedSubmissionsCount: updatedCount,
    blockedIps: swarmIps,
    swarmsReport: {
      ...updatedSwarmReport,
      importedSocialCount: latestImported.length,
    },
    trafficReport: updatedTrafficReport,
  });
});

export async function runBotDnsVerification(body: any): Promise<
  | {
      ok: true;
      data: {
        ipAddress: string;
        claimedBotName: string;
        verified: boolean;
        method: "fcrdns" | "cidr_asn";
        hostname: string | null;
        verdict: "AUTHENTIC_CRAWLER" | "SPOOFED_BOT";
      };
    }
  | { ok: false; error: string }
> {
  const ipAddress = typeof body?.ipAddress === "string" ? body.ipAddress.trim() : "";
  const claimedBotName = typeof body?.claimedBotName === "string" ? body.claimedBotName.trim() : "";
  const asnLabel = typeof body?.asnLabel === "string" ? body.asnLabel.trim() : "";

  if (!ipAddress || !claimedBotName) {
    return { ok: false, error: "ipAddress and claimedBotName are required non-empty strings" };
  }

  const result = await verifyGoodBotFcrDns(ipAddress, claimedBotName, asnLabel);
  return {
    ok: true,
    data: {
      ipAddress,
      claimedBotName,
      verified: result.verified,
      method: result.method,
      hostname: result.hostname || null,
      verdict: result.verified ? "AUTHENTIC_CRAWLER" : "SPOOFED_BOT",
    },
  };
}

/**
 * POST /api/dashboard/traffic/verify-bot
 * Performs live FCrDNS + CIDR/ASN verification on a claimed crawler IP.
 */
dashboardApiRouter.post("/api/dashboard/traffic/verify-bot", async (c) => {
  const body = await c.req.json().catch(() => null);
  const res = await runBotDnsVerification(body);
  if (!res.ok) {
    return c.json({ error: res.error }, 400);
  }
  return c.json(res.data);
});

/**
 * GET /api/dashboard/traffic/overview
 * Analyzes web-server access logs and returns clean vs malicious traffic breakdown,
 * top suspicious IPs, credential stuffers, and WAF defense rules.
 */
dashboardApiRouter.get("/api/dashboard/traffic/overview", async (c) => {
  const tenantId = c.req.query("tenantId") || "default";
  const aiPolicy = c.req.query("aiCrawlerPolicy") as "allow" | "block" | "challenge" | undefined;
  const rawLogs = await getTenantTrafficLogs(tenantId);
  const report = cleanTrafficLogs(
    rawLogs,
    aiPolicy ? { aiCrawlerPolicy: aiPolicy } : undefined
  );
  return c.json(report);
});

/**
 * POST /api/dashboard/traffic/ingest
 * Ingests custom web-server access log lines (Nginx / Apache / Caddy Combined Log format or JSON).
 */
dashboardApiRouter.post("/api/dashboard/traffic/ingest", async (c) => {
  const body = await c.req.json().catch(() => null);
  const tenantId = body?.tenantId || c.req.query("tenantId") || "default";
  const rawLogs = body?.logs || (await c.req.text().catch(() => ""));
  let activeLogs = await getTenantTrafficLogs(tenantId);
  if (rawLogs && typeof rawLogs === "string" && rawLogs.trim().length > 0) {
    activeLogs =
      c.req.query("append") === "true" && activeLogs.trim().length > 0
        ? `${activeLogs}\n${rawLogs}`
        : rawLogs;
    activeLogs = await saveTenantTrafficLogs(tenantId, activeLogs, "manual");
  }

  const report = cleanTrafficLogs(activeLogs, body?.options);
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
dashboardApiRouter.post("/api/dashboard/traffic/seed-demo", async (c) => {
  const tenantId = c.req.query("tenantId") || "default";
  const seeded = await saveTenantTrafficLogs(
    tenantId,
    generateRealisticTrafficLogs(),
    "demo_seed"
  );
  const report = cleanTrafficLogs(seeded);
  return c.json({
    status: "seeded",
    ...report,
  });
});

/**
 * GET /api/dashboard/traffic/export-rules
 * Exports ready-to-paste firewall / WAF block rules in Nginx, Apache, Cloudflare, or robots.txt format.
 */
dashboardApiRouter.get("/api/dashboard/traffic/export-rules", async (c) => {
  const tenantId = c.req.query("tenantId") || "default";
  const format = c.req.query("format") || "nginx";
  const rawLogs = await getTenantTrafficLogs(tenantId);
  const report = cleanTrafficLogs(rawLogs);

  let content = report.firewallRules.nginxBlockRules;
  let filename = "truthier-nginx-block.conf";
  const contentType = "text/plain; charset=utf-8";

  if (format === "apache") {
    content = report.firewallRules.apacheHtaccessRules;
    filename = "truthier-htaccess.conf";
  } else if (format === "cloudflare") {
    content = report.firewallRules.cloudflareWafExpression;
    filename = "truthier-cloudflare-waf.txt";
  } else if (format === "robots") {
    content = report.firewallRules.robotsTxtRules;
    filename = "robots.txt";
  }

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
