import { createHash } from "node:crypto";
import { cosineSimilarity } from "../ai/embeddings";
import { resolveOriginGeo, type OriginGeoInfo } from "./geo-intel";
import type { TrafficCleanReport } from "./traffic-cleaner";

export interface SwarmMember {
  sessionHash: string;
  authorHandle?: string;
  accountAgeHours?: number | null;
  role?: "ORIGINATOR" | "AMPLIFIER" | "COORDINATED_NODE";
  trafficThreatCorrelated?: boolean;
  ipAddress: string;
  subnet24: string;
  asnLabel: string;
  countryCode: string;
  countryName: string;
  submissionCount: number;
  firstSeen: string;
  lastSeen: string;
  sampleTexts: string[];
  ratings: number[];
  targetEntities: string[];
  telemetrySummary: {
    avgFlightVariance: number;
    avgCompletionTimeMs: number;
    botdDetectedCount: number;
    webdriverCount: number;
    userAgent: string;
  };
}

export interface SwarmLink {
  sourceSession: string;
  targetSession: string;
  weight: number;
  sharedSignals: {
    sharedSubnet: boolean;
    sharedAsn: boolean;
    timeDeltaSeconds: number;
    textSimilarity: number;
    coTargetCount: number;
    telemetryColocation: boolean;
    handleSimilarity?: number;
    sharedUrlOrCode?: boolean;
    synchronizedAccountCreation?: boolean;
    crossSubnetFingerprintMatch?: boolean;
    coActivityWindows?: number;
  };
}

export interface SwarmCluster {
  id: string;
  name: string;
  threatLevel: "CRITICAL" | "ELEVATED" | "MODERATE";
  campaignType:
    | "ASTROTURF_PROPAGANDA"
    | "COORDINATED_REVIEW_BOMB"
    | "SCRAPER_AMPLIFICATION"
    | "BOT_SWARM";
  confidenceScore: number;
  memberCount: number;
  totalSubmissions: number;
  members: SwarmMember[];
  targetEntities: Array<{ entityId: string; count: number; avgRating: number | null }>;
  cadenceMetrics: {
    timeSpanMinutes: number;
    interArrivalTimeMeanSec: number;
    interArrivalTimeStdDevSec: number;
    cadenceRegularityScore: number;
    burstiness: number;
    coActivityWindows?: number;
  };
  timelineBuckets: Array<{ bucketLabel: string; count: number }>;
  textReuseMetrics: {
    uniqueTemplates: number;
    avgPairwiseSimilarity: number;
    paraphrasedVariantsDetected: boolean;
  };
  amplificationMetrics: {
    originatorSession: string;
    amplifierCount: number;
    amplificationVelocityPerMin: number;
    sharedUrlsOrCodes: string[];
    replyChainCount: number;
    synchronizedBoostWave: boolean;
  };
  accountSimilarityMetrics: {
    avgHandleSimilarity: number;
    synchronizedNewAccountsCount: number;
    crossSubnetRotationDetected: boolean;
  };
  correlatedTrafficThreats: string[];
  networkFootprint: {
    uniqueIps: number;
    uniqueSubnets: number;
    topAsns: string[];
    topCountries: string[];
  };
  sampleTexts: string[];
  graphNodes: Array<{
    id: string;
    label: string;
    ip: string;
    country: string;
    rating: number | null;
    role?: "ORIGINATOR" | "AMPLIFIER" | "COORDINATED_NODE";
  }>;
  graphEdges: Array<{ source: string; target: string; weight: number; reason: string }>;
  recommendedAction: string;
}

export interface SwarmDetectionResult {
  analyzedSubmissionsCount: number;
  activeSwarmCount: number;
  totalSwarmMembers: number;
  swarms: SwarmCluster[];
  summary: {
    criticalSwarms: number;
    elevatedSwarms: number;
    topTargetEntities: Array<{ entityId: string; count: number }>;
    globalSwarmFootprint: Array<{ countryCode: string; count: number }>;
  };
}

export interface SwarmDetectionOptions {
  trafficReport?: TrafficCleanReport;
  knownMaliciousIps?: string[];
}

export interface RawSubmissionInput {
  id?: string;
  wpCommentId: number;
  entityId: string;
  authorSessionHash: string;
  authorHandle?: string;
  accountCreatedAt?: Date | string;
  replyToCommentId?: number | null;
  sharedUrl?: string;
  deviceFingerprint?: string;
  rawText: string;
  rating?: number | null;
  authorType?: "human" | "bot";
  visibility?: string;
  createdAt: Date | string;
  ipAddress?: string;
  userAgent?: string;
  telemetry?: Record<string, any>;
  embedding?: number[];
  origin?: OriginGeoInfo;
}

function extractSubnet24(ip: string): string {
  if (!ip || ip === "unknown" || ip === "127.0.0.1") return "unknown/24";
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (ip.includes(":")) {
    return ip.split(":").slice(0, 4).join(":") + "::/64";
  }
  return ip;
}

function computeWordShingles(text: string, n = 3): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(" "));
  }
  if (shingles.size === 0 && words.length > 0) {
    shingles.add(words.join(" "));
  }
  return shingles;
}

function computeCharNgrams(text: string, n = 3): Set<string> {
  const norm = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const grams = new Set<string>();
  if (norm.length <= n) {
    if (norm.length > 0) grams.add(norm);
    return grams;
  }
  for (let i = 0; i <= norm.length - n; i++) {
    grams.add(norm.slice(i, i + n));
  }
  return grams;
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function fnv1aHash(str: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const MINHASH_SEEDS = [
  11, 29, 53, 97, 131, 193, 257, 389, 521, 769, 1031, 1543, 2053, 3079, 4099, 6151,
];

function computeMinHashBands(shingles: Set<string>): string[] {
  if (shingles.size === 0) return [];
  const sig: number[] = new Array(MINHASH_SEEDS.length).fill(0xffffffff);
  for (const sh of shingles) {
    for (let k = 0; k < MINHASH_SEEDS.length; k++) {
      const h = fnv1aHash(sh, MINHASH_SEEDS[k]!);
      if (h < sig[k]!) sig[k] = h;
    }
  }
  const bands: string[] = [];
  for (let b = 0; b < 4; b++) {
    const start = b * 4;
    bands.push(`b${b}:${sig[start]}_${sig[start + 1]}_${sig[start + 2]}_${sig[start + 3]}`);
  }
  return bands;
}

function evaluateHandleSimilarity(handleA?: string, handleB?: string): number {
  if (!handleA || !handleB) return 0;
  const a = handleA.trim().toLowerCase();
  const b = handleB.trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1.0;

  const patternA = a.replace(/\d/g, "#");
  const patternB = b.replace(/\d/g, "#");
  if (patternA === patternB && patternA.length >= 4) {
    return 0.9;
  }

  const gramsA = computeCharNgrams(a.replace(/\d+/g, ""), 3);
  const gramsB = computeCharNgrams(b.replace(/\d+/g, ""), 3);
  const ngramSim = jaccardSimilarity(gramsA, gramsB);

  return Number(ngramSim.toFixed(3));
}

function extractAmplificationTokens(text: string, sharedUrl?: string): string[] {
  const tokens = new Set<string>();
  if (sharedUrl && sharedUrl.trim().length > 0) {
    tokens.add(sharedUrl.trim().toLowerCase().replace(/[.,!?;:)]+$/, ""));
  }

  const urlMatches = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const u of urlMatches) {
    tokens.add(u.toLowerCase().replace(/[.,!?;:)]+$/, ""));
  }

  const mentionMatches = text.match(/@[a-zA-Z0-9_]{3,}/g) || [];
  for (const m of mentionMatches) {
    tokens.add(m.toLowerCase());
  }

  const hashtagMatches = text.match(/#[a-zA-Z0-9_]{3,}/g) || [];
  for (const h of hashtagMatches) {
    tokens.add(h.toLowerCase());
  }

  const explicitCodeRegex =
    /\b(?:[Cc][Oo][Dd][Ee]|[Pp][Rr][Oo][Mm][Oo]|[Cc][Oo][Uu][Pp][Oo][Nn]|[Uu][Ss][Ee])[:\s]+((?:[A-Z0-9]{4,16}|(?=[a-zA-Z0-9]*\d)[a-zA-Z0-9]{4,16}))\b/g;
  let match: RegExpExecArray | null;
  while ((match = explicitCodeRegex.exec(text)) !== null) {
    if (match[1]) tokens.add(`code:${match[1].toUpperCase()}`);
  }

  const alphanumCodeMatches =
    text.match(/\b(?=[A-Z0-9]{4,16}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g) || [];
  for (const code of alphanumCodeMatches) {
    tokens.add(`code:${code}`);
  }

  return Array.from(tokens);
}

const STOP_WORDS = new Set([
  "the", "and", "was", "for", "this", "that", "with", "have", "are", "not",
  "but", "you", "your", "our", "they", "from", "here", "all", "very", "its",
  "it", "too", "out", "into", "just", "now", "can", "will", "has", "had",
]);

const SWARM_TOPIC_GROUPS: RegExp[] = [
  /\b(cold|food|service|staff|rude|waiter|waiters|dishes|dining|restaurant|boycott|terrible|horrible|disgusting|worst|avoid)\b/gi,
  /\b(cabal|regime|puppet|globalist|deep state|elites|shadowy|censorship|sheeple|wake up|truth)\b/gi,
  /\b(crypto|usdt|airdrop|token|wallet|payout|reward|claim|profit|forex|bonus)\b/gi,
];

function extractSparseTextFeatures(text: string): Map<string, number> {
  const feats = new Map<string, number>();
  const add = (key: string, weight: number) => {
    feats.set(key, (feats.get(key) || 0) + weight);
  };

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    add(`w:${w}`, 1.0);
    if (i + 1 < words.length) {
      add(`bg:${w}_${words[i + 1]}`, 1.2);
    }
    if (w.length >= 4) {
      for (let c = 0; c <= w.length - 4; c++) {
        add(`c4:${w.slice(c, c + 4)}`, 0.45);
      }
    }
  }

  for (let idx = 0; idx < SWARM_TOPIC_GROUPS.length; idx++) {
    const regex = SWARM_TOPIC_GROUPS[idx]!;
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      add(`top:${idx}`, 0.9);
    }
  }

  return feats;
}

/**
 * Calculates text similarity combining 3-word shingle Jaccard, unbiased sparse lexical/topic cosine similarity,
 * and semantic embedding cosine similarity when embeddings are available.
 */
function evaluateTextSimilarity(
  textA: string,
  textB: string,
  embA?: number[],
  embB?: number[]
): number {
  if (textA === textB) return 1.0;
  const shinglesA = computeWordShingles(textA, 3);
  const shinglesB = computeWordShingles(textB, 3);
  const jaccard = jaccardSimilarity(shinglesA, shinglesB);

  const featsA = extractSparseTextFeatures(textA);
  const featsB = extractSparseTextFeatures(textB);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, va] of featsA) {
    normA += va * va;
    const vb = featsB.get(k);
    if (vb) dot += va * vb;
  }
  for (const vb of featsB.values()) {
    normB += vb * vb;
  }
  const sparseCosine =
    normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;

  const lexicalSim = Math.min(
    1.0,
    Math.max(jaccard * 0.7 + sparseCosine * 0.3, sparseCosine * 1.15)
  );

  if (embA && embB && embA.length > 0 && embA.length === embB.length) {
    const embSim = cosineSimilarity(embA, embB);
    const semanticBoost =
      embSim >= 0.68 ? Math.min(1.0, lexicalSim * 0.55 + embSim * 0.45) : lexicalSim;
    return Math.min(1.0, Math.max(lexicalSim, semanticBoost));
  }

  return lexicalSim;
}

interface InternalMemberMeta {
  member: SwarmMember;
  subs: RawSubmissionInput[];
  tokens: Set<string>;
  deviceFingerprints: Set<string>;
  accountCreatedMs: number | null;
  minHashBands: Set<string>;
  replyTargets: Set<number>;
  ownCommentIds: Set<number>;
  embeddings: Array<number[] | undefined>;
  timeWindows: Set<number>;
  postTimestampsMs: number[];
}

/**
 * Detects coordinated inauthentic behavior, bot swarms, amplification networks,
 * and astroturfing across multiple submissions.
 */
export function detectCoordinatedSwarms(
  submissions: RawSubmissionInput[],
  options?: SwarmDetectionOptions
): SwarmDetectionResult {
  if (!submissions || submissions.length === 0) {
    return {
      analyzedSubmissionsCount: 0,
      activeSwarmCount: 0,
      totalSwarmMembers: 0,
      swarms: [],
      summary: {
        criticalSwarms: 0,
        elevatedSwarms: 0,
        topTargetEntities: [],
        globalSwarmFootprint: [],
      },
    };
  }

  // Build lookup of known malicious IPs/subnets from Clean the Traffic report & explicit options
  const maliciousIpCategories = new Map<string, string>();
  const maliciousSubnetCategories = new Map<string, Set<string>>();

  if (options?.knownMaliciousIps) {
    for (const ip of options.knownMaliciousIps) {
      maliciousIpCategories.set(ip, "KNOWN_MALICIOUS_IP");
      const sub = extractSubnet24(ip);
      if (sub !== "unknown/24") {
        const set = maliciousSubnetCategories.get(sub) || new Set();
        set.add("KNOWN_MALICIOUS_IP");
        maliciousSubnetCategories.set(sub, set);
      }
    }
  }

  if (options?.trafficReport?.topThreatIps) {
    for (const threat of options.trafficReport.topThreatIps) {
      if (
        threat.category !== "HUMAN_VISITOR" &&
        threat.category !== "VERIFIED_BOT"
      ) {
        maliciousIpCategories.set(threat.ipAddress, threat.category);
        const sub = extractSubnet24(threat.ipAddress);
        if (sub !== "unknown/24") {
          const set = maliciousSubnetCategories.get(sub) || new Set();
          set.add(threat.category);
          maliciousSubnetCategories.set(sub, set);
        }
      }
    }
  }

  // 1. Group submissions by author session hash
  const sessionMap = new Map<string, RawSubmissionInput[]>();
  const commentIdToSession = new Map<number, string>();
  for (const sub of submissions) {
    const session = sub.authorSessionHash || `anon_${sub.wpCommentId}`;
    const list = sessionMap.get(session) || [];
    list.push(sub);
    sessionMap.set(session, list);
    commentIdToSession.set(sub.wpCommentId, session);
  }

  // Build member models + auxiliary LSH/metadata
  const members: SwarmMember[] = [];
  const memberBySession = new Map<string, SwarmMember>();
  const metaBySession = new Map<string, InternalMemberMeta>();

  for (const [session, subs] of sessionMap.entries()) {
    subs.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const first = subs[0]!;
    const last = subs[subs.length - 1]!;
    const ip = first.ipAddress || (first.origin ? first.origin.ipAddress : "127.0.0.1");
    const geo =
      first.origin ||
      resolveOriginGeo({
        ipAddress: ip,
        authorSessionHash: session,
        wpCommentId: first.wpCommentId,
        authorType: first.authorType,
      });

    let totalVariance = 0;
    let totalCompletion = 0;
    let botdHits = 0;
    let webdriverHits = 0;
    let userAgent = first.userAgent || "unknown";
    let authorHandle: string | undefined;
    let earliestAccountCreatedMs: number | null = null;

    const ratings: number[] = [];
    const targets = new Set<string>();
    const texts: string[] = [];
    const tokens = new Set<string>();
    const deviceFingerprints = new Set<string>();
    const minHashBands = new Set<string>();
    const replyTargets = new Set<number>();
    const ownCommentIds = new Set<number>();
    const embeddings: Array<number[] | undefined> = [];
    const timeWindows = new Set<number>();
    const postTimestampsMs: number[] = [];

    for (const s of subs) {
      ownCommentIds.add(s.wpCommentId);
      if (typeof s.replyToCommentId === "number") {
        replyTargets.add(s.replyToCommentId);
      }
      if (typeof s.rating === "number") ratings.push(s.rating);
      targets.add(s.entityId);
      texts.push(s.rawText);
      embeddings.push(s.embedding);
      const subTimeMs = new Date(s.createdAt).getTime();
      if (!Number.isNaN(subTimeMs)) {
        postTimestampsMs.push(subTimeMs);
        timeWindows.add(Math.floor(subTimeMs / 300_000));
      }

      if (s.authorHandle && !authorHandle) authorHandle = s.authorHandle;
      if (s.deviceFingerprint) deviceFingerprints.add(s.deviceFingerprint);
      if (s.accountCreatedAt) {
        const createdMs = new Date(s.accountCreatedAt).getTime();
        if (!Number.isNaN(createdMs)) {
          if (earliestAccountCreatedMs === null || createdMs < earliestAccountCreatedMs) {
            earliestAccountCreatedMs = createdMs;
          }
        }
      }

      for (const tok of extractAmplificationTokens(s.rawText, s.sharedUrl)) {
        tokens.add(tok);
      }
      for (const band of computeMinHashBands(computeWordShingles(s.rawText, 3))) {
        minHashBands.add(band);
      }

      const tel = s.telemetry || {};
      if (typeof tel.keystrokeFlightVariance === "number") {
        totalVariance += tel.keystrokeFlightVariance;
      }
      if (typeof tel.formCompletionTimeMs === "number") {
        totalCompletion += tel.formCompletionTimeMs;
      }
      if (tel.botdDetected) botdHits++;
      if (tel.webdriver) webdriverHits++;
      if (s.userAgent && s.userAgent !== "unknown") userAgent = s.userAgent;
    }

    const firstSeenMs = new Date(first.createdAt).getTime();
    const accountAgeHours =
      earliestAccountCreatedMs !== null
        ? Number(Math.max(0, (firstSeenMs - earliestAccountCreatedMs) / 3600_000).toFixed(1))
        : null;

    const subnet24 = extractSubnet24(ip);
    const trafficThreatCorrelated =
      maliciousIpCategories.has(ip) || maliciousSubnetCategories.has(subnet24);

    const member: SwarmMember = {
      sessionHash: session,
      ...(authorHandle ? { authorHandle } : {}),
      accountAgeHours,
      role: "COORDINATED_NODE",
      trafficThreatCorrelated,
      ipAddress: ip,
      subnet24,
      asnLabel: geo.asnLabel,
      countryCode: geo.countryCode,
      countryName: geo.countryName,
      submissionCount: subs.length,
      firstSeen: new Date(first.createdAt).toISOString(),
      lastSeen: new Date(last.createdAt).toISOString(),
      sampleTexts: texts.slice(0, 3),
      ratings,
      targetEntities: Array.from(targets),
      telemetrySummary: {
        avgFlightVariance: subs.length > 0 ? Math.round(totalVariance / subs.length) : 0,
        avgCompletionTimeMs: subs.length > 0 ? Math.round(totalCompletion / subs.length) : 0,
        botdDetectedCount: botdHits,
        webdriverCount: webdriverHits,
        userAgent,
      },
    };

    members.push(member);
    memberBySession.set(session, member);
    metaBySession.set(session, {
      member,
      subs,
      tokens,
      deviceFingerprints,
      accountCreatedMs: earliestAccountCreatedMs,
      minHashBands,
      replyTargets,
      ownCommentIds,
      embeddings: embeddings.slice(0, 3),
      timeWindows,
      postTimestampsMs,
    });
  }

  // 2. Candidate Pair Generation (LSH + Multi-Signal Bucketing for large N, exhaustive for N <= 120)
  const candidatePairs: Array<[number, number]> = [];
  if (members.length <= 120) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        candidatePairs.push([i, j]);
      }
    }
  } else {
    const bucketMap = new Map<string, number[]>();
    const addToBucket = (key: string, idx: number) => {
      const arr = bucketMap.get(key) || [];
      arr.push(idx);
      bucketMap.set(key, arr);
    };

    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      const meta = metaBySession.get(m.sessionHash)!;
      if (m.subnet24 !== "unknown/24") addToBucket(`sub:${m.subnet24}`, i);
      for (const ent of m.targetEntities) addToBucket(`ent:${ent}`, i);
      for (const tok of meta.tokens) addToBucket(`tok:${tok}`, i);
      for (const band of meta.minHashBands) addToBucket(`lsh:${band}`, i);
      for (const fp of meta.deviceFingerprints) addToBucket(`fp:${fp}`, i);
      for (const win of meta.timeWindows) addToBucket(`ts5m:${win}`, i);
      const timeBucket = Math.floor(new Date(m.firstSeen).getTime() / 900_000);
      addToBucket(`ts:${timeBucket}`, i);
      addToBucket(`ts:${timeBucket - 1}`, i);
      addToBucket(`ts:${timeBucket + 1}`, i);
      if (m.authorHandle) {
        addToBucket(`hdl:${m.authorHandle.toLowerCase().replace(/\d/g, "#")}`, i);
      }
    }

    const seenPairKeys = new Set<string>();
    for (const indices of bucketMap.values()) {
      if (indices.length < 2 || indices.length > 500) continue;
      for (let a = 0; a < indices.length; a++) {
        for (let b = a + 1; b < indices.length; b++) {
          const i = Math.min(indices[a]!, indices[b]!);
          const j = Math.max(indices[a]!, indices[b]!);
          if (i === j) continue;
          const key = `${i}:${j}`;
          if (!seenPairKeys.has(key)) {
            seenPairKeys.add(key);
            candidatePairs.push([i, j]);
          }
        }
      }
    }
  }

  // 3. Build Coordination Graph with pairwise evidence weighting
  const links: SwarmLink[] = [];
  const adjacency = new Map<string, Set<string>>();
  for (const m of members) adjacency.set(m.sessionHash, new Set());

  for (const [i, j] of candidatePairs) {
    const mA = members[i]!;
    const mB = members[j]!;
    const metaA = metaBySession.get(mA.sessionHash)!;
    const metaB = metaBySession.get(mB.sessionHash)!;

    const sharedSubnet = mA.subnet24 !== "unknown/24" && mA.subnet24 === mB.subnet24;
    const sharedAsn =
      mA.asnLabel !== "Direct / Unclassified Network" && mA.asnLabel === mB.asnLabel;

    const firstSeenDeltaSec = Math.abs(
      (new Date(mA.firstSeen).getTime() - new Date(mB.firstSeen).getTime()) / 1000
    );
    let minPostDeltaSec = firstSeenDeltaSec;
    for (const tsA of metaA.postTimestampsMs) {
      for (const tsB of metaB.postTimestampsMs) {
        const dt = Math.abs(tsA - tsB) / 1000;
        if (dt < minPostDeltaSec) minPostDeltaSec = dt;
      }
    }
    const timeDeltaSec = minPostDeltaSec;

    let coActivityWindows = 0;
    for (const w of metaA.timeWindows) {
      if (metaB.timeWindows.has(w)) coActivityWindows++;
    }

    const targetsA = new Set(mA.targetEntities);
    let coTargetCount = 0;
    for (const t of mB.targetEntities) {
      if (targetsA.has(t)) coTargetCount++;
    }

    // Shared amplification token (URL / promo code / @mention / #hashtag) or reply-chain relationship
    let sharedUrlOrCode = false;
    for (const tok of metaA.tokens) {
      if (metaB.tokens.has(tok)) {
        sharedUrlOrCode = true;
        break;
      }
    }
    let replyLinked = false;
    for (const replyId of metaA.replyTargets) {
      if (metaB.ownCommentIds.has(replyId)) replyLinked = true;
    }
    for (const replyId of metaB.replyTargets) {
      if (metaA.ownCommentIds.has(replyId)) replyLinked = true;
    }

    // Account handle similarity & synchronized account creation
    const handleSimilarity = evaluateHandleSimilarity(mA.authorHandle, mB.authorHandle);
    let synchronizedAccountCreation = false;
    if (metaA.accountCreatedMs !== null && metaB.accountCreatedMs !== null) {
      const creationDeltaMin = Math.abs(metaA.accountCreatedMs - metaB.accountCreatedMs) / 60_000;
      if (creationDeltaMin <= 30) {
        synchronizedAccountCreation = true;
      }
    }

    // Max text similarity between any text in A and B
    let maxSim = 0;
    for (let idxA = 0; idxA < mA.sampleTexts.length; idxA++) {
      for (let idxB = 0; idxB < mB.sampleTexts.length; idxB++) {
        const sim = evaluateTextSimilarity(
          mA.sampleTexts[idxA]!,
          mB.sampleTexts[idxB]!,
          metaA.embeddings[idxA],
          metaB.embeddings[idxB]
        );
        if (sim > maxSim) maxSim = sim;
      }
    }

    // Telemetry & cross-subnet device fingerprint colocation
    const varianceDiff = Math.abs(
      mA.telemetrySummary.avgFlightVariance - mB.telemetrySummary.avgFlightVariance
    );
    const completionDiff = Math.abs(
      mA.telemetrySummary.avgCompletionTimeMs - mB.telemetrySummary.avgCompletionTimeMs
    );

    let sharedDeviceFp = false;
    for (const fp of metaA.deviceFingerprints) {
      if (metaB.deviceFingerprints.has(fp)) {
        sharedDeviceFp = true;
        break;
      }
    }

    const crossSubnetFingerprintMatch =
      sharedDeviceFp ||
      (!sharedSubnet &&
        mA.telemetrySummary.userAgent !== "unknown" &&
        mA.telemetrySummary.userAgent === mB.telemetrySummary.userAgent &&
        varianceDiff < 1.5 &&
        completionDiff < 150 &&
        mA.telemetrySummary.avgFlightVariance < 5);

    const telemetryColocation =
      (mA.telemetrySummary.botdDetectedCount > 0 &&
        mB.telemetrySummary.botdDetectedCount > 0) ||
      (mA.telemetrySummary.webdriverCount > 0 &&
        mB.telemetrySummary.webdriverCount > 0) ||
      (varianceDiff < 3 && mA.telemetrySummary.avgFlightVariance < 5);

    // Weight accumulator
    let weight = 0;
    if (sharedSubnet) weight += 0.35;
    if (sharedAsn) weight += 0.15;

    if (timeDeltaSec <= 45) weight += 0.35;
    else if (timeDeltaSec <= 180) weight += 0.25;
    else if (timeDeltaSec <= 900) weight += 0.15;

    if (coActivityWindows >= 2) weight += 0.25;

    if (maxSim >= 0.7) weight += 0.45;
    else if (maxSim >= 0.4) weight += 0.3;
    else if (maxSim >= 0.25) weight += 0.15;

    if (coTargetCount >= 2) weight += 0.35;
    else if (coTargetCount === 1) weight += 0.15;

    if (telemetryColocation) weight += 0.2;
    if (sharedUrlOrCode) weight += 0.35;
    if (replyLinked) weight += 0.25;
    if (handleSimilarity >= 0.75) weight += 0.25;
    else if (handleSimilarity >= 0.5) weight += 0.15;
    if (synchronizedAccountCreation) weight += 0.2;
    if (crossSubnetFingerprintMatch) weight += 0.25;

    // False-positive guard for shared NAT / organic viral discussions
    const bothAppearHuman =
      mA.telemetrySummary.botdDetectedCount === 0 &&
      mB.telemetrySummary.botdDetectedCount === 0 &&
      mA.telemetrySummary.webdriverCount === 0 &&
      mB.telemetrySummary.webdriverCount === 0 &&
      mA.telemetrySummary.avgFlightVariance >= 15 &&
      mB.telemetrySummary.avgFlightVariance >= 15;

    const ratingA = mA.ratings[0];
    const ratingB = mB.ratings[0];
    const diverseRatings =
      typeof ratingA === "number" &&
      typeof ratingB === "number" &&
      Math.abs(ratingA - ratingB) >= 2;

    if (
      bothAppearHuman &&
      maxSim < 0.45 &&
      !sharedUrlOrCode &&
      !replyLinked &&
      handleSimilarity < 0.5 &&
      !crossSubnetFingerprintMatch &&
      !synchronizedAccountCreation &&
      coActivityWindows < 2 &&
      (diverseRatings || (coTargetCount <= 1 && timeDeltaSec > 45))
    ) {
      weight = Math.min(weight, 0.35);
    }

    if (weight >= 0.45) {
      links.push({
        sourceSession: mA.sessionHash,
        targetSession: mB.sessionHash,
        weight: Math.min(1.0, Number(weight.toFixed(3))),
        sharedSignals: {
          sharedSubnet,
          sharedAsn,
          timeDeltaSeconds: Math.round(timeDeltaSec),
          textSimilarity: Number(maxSim.toFixed(3)),
          coTargetCount,
          telemetryColocation,
          handleSimilarity,
          sharedUrlOrCode,
          synchronizedAccountCreation,
          crossSubnetFingerprintMatch,
          coActivityWindows,
        },
      });
      adjacency.get(mA.sessionHash)!.add(mB.sessionHash);
      adjacency.get(mB.sessionHash)!.add(mA.sessionHash);
    }
  }

  // 4. Anti-Chaining Weak Bridge Pruning (prevents merging two distinct clusters via 1 weak edge)
  const linkLookup = new Map<string, SwarmLink>();
  for (const l of links) {
    const key =
      l.sourceSession < l.targetSession
        ? `${l.sourceSession}|${l.targetSession}`
        : `${l.targetSession}|${l.sourceSession}`;
    linkLookup.set(key, l);
  }

  const getComponentFrom = (start: string, blockedEdge?: [string, string]): string[] => {
    const seen = new Set<string>([start]);
    const q: string[] = [start];
    while (q.length > 0) {
      const curr = q.shift()!;
      for (const nb of adjacency.get(curr) || []) {
        if (
          blockedEdge &&
          ((curr === blockedEdge[0] && nb === blockedEdge[1]) ||
            (curr === blockedEdge[1] && nb === blockedEdge[0]))
        ) {
          continue;
        }
        if (!seen.has(nb)) {
          seen.add(nb);
          q.push(nb);
        }
      }
    }
    return Array.from(seen);
  };

  const prunedEdgeKeys = new Set<string>();
  const checkedNodes = new Set<string>();
  for (const m of members) {
    if (checkedNodes.has(m.sessionHash)) continue;
    const comp = getComponentFrom(m.sessionHash);
    for (const id of comp) checkedNodes.add(id);
    if (comp.length < 4) continue;

    const compSet = new Set(comp);
    const candidateBridges = links.filter(
      (l) =>
        compSet.has(l.sourceSession) &&
        compSet.has(l.targetSession) &&
        l.weight < 0.58
    );

    for (const edge of candidateBridges) {
      const u = edge.sourceSession;
      const v = edge.targetSession;
      const nbU = adjacency.get(u) || new Set<string>();
      const nbV = adjacency.get(v) || new Set<string>();

      let commonNeighbors = 0;
      for (const n of nbU) {
        if (nbV.has(n)) commonNeighbors++;
      }
      if (commonNeighbors > 0) continue;

      const sideU = getComponentFrom(u, [u, v]);
      if (sideU.includes(v)) continue; // still connected via alternate path
      const sideV = getComponentFrom(v, [u, v]);

      if (sideU.length >= 2 && sideV.length >= 2) {
        nbU.delete(v);
        nbV.delete(u);
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        prunedEdgeKeys.add(key);
      }
    }
  }

  const activeLinks =
    prunedEdgeKeys.size === 0
      ? links
      : links.filter((l) => {
          const key =
            l.sourceSession < l.targetSession
              ? `${l.sourceSession}|${l.targetSession}`
              : `${l.targetSession}|${l.sourceSession}`;
          return !prunedEdgeKeys.has(key);
        });

  // 5. Find Connected Components (Swarm Units)
  const visited = new Set<string>();
  const swarmClusters: SwarmCluster[] = [];

  for (const m of members) {
    if (visited.has(m.sessionHash)) continue;
    const component: string[] = [];
    const queue: string[] = [m.sessionHash];
    visited.add(m.sessionHash);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      const neighbors = adjacency.get(curr) || new Set();
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }

    if (component.length < 2) continue;

    const swarmMembers = component
      .map((id) => memberBySession.get(id)!)
      .sort(
        (a, b) => new Date(a.firstSeen).getTime() - new Date(b.firstSeen).getTime()
      );

    // Compute cluster-level metrics
    const clusterSubmissions: RawSubmissionInput[] = [];
    for (const sm of swarmMembers) {
      const subs = sessionMap.get(sm.sessionHash) || [];
      clusterSubmissions.push(...subs);
    }
    clusterSubmissions.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const firstTime = new Date(clusterSubmissions[0]!.createdAt).getTime();
    const lastTime = new Date(
      clusterSubmissions[clusterSubmissions.length - 1]!.createdAt
    ).getTime();
    const timeSpanMinutes = Math.max(
      0.1,
      Number(((lastTime - firstTime) / 60000).toFixed(1))
    );

    // Inter-arrival timing analysis
    const intervals: number[] = [];
    for (let k = 1; k < clusterSubmissions.length; k++) {
      const dt =
        (new Date(clusterSubmissions[k]!.createdAt).getTime() -
          new Date(clusterSubmissions[k - 1]!.createdAt).getTime()) /
        1000;
      intervals.push(Math.max(0.1, dt));
    }

    const meanInterval =
      intervals.length > 0
        ? intervals.reduce((a, b) => a + b, 0) / intervals.length
        : 0;
    const variance =
      intervals.length > 1
        ? intervals.reduce((sum, val) => sum + Math.pow(val - meanInterval, 2), 0) /
          intervals.length
        : 0;
    const stdDev = Math.sqrt(variance);

    const burstiness =
      stdDev + meanInterval > 0
        ? Number(((stdDev - meanInterval) / (stdDev + meanInterval)).toFixed(2))
        : 0;

    const cv = meanInterval > 0 ? stdDev / meanInterval : 1;
    const cadenceRegularity =
      cv < 0.25 ? 95 : cv < 0.5 ? 80 : cv < 0.8 ? 50 : 25;

    // Target entities and sentiment distribution
    const entityCountMap = new Map<string, { count: number; ratings: number[] }>();
    for (const cs of clusterSubmissions) {
      const cur = entityCountMap.get(cs.entityId) || { count: 0, ratings: [] };
      cur.count++;
      if (typeof cs.rating === "number") cur.ratings.push(cs.rating);
      entityCountMap.set(cs.entityId, cur);
    }

    const targetEntities = Array.from(entityCountMap.entries()).map(
      ([entityId, val]) => ({
        entityId,
        count: val.count,
        avgRating:
          val.ratings.length > 0
            ? Number(
                (val.ratings.reduce((a, b) => a + b, 0) / val.ratings.length).toFixed(1)
              )
            : null,
      })
    );

    // Network footprint & Traffic Threat correlation
    const ips = new Set<string>();
    const subnets = new Set<string>();
    const asnCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();
    const correlatedTrafficThreats: string[] = [];

    for (const sm of swarmMembers) {
      ips.add(sm.ipAddress);
      subnets.add(sm.subnet24);
      asnCounts.set(sm.asnLabel, (asnCounts.get(sm.asnLabel) || 0) + 1);
      countryCounts.set(sm.countryCode, (countryCounts.get(sm.countryCode) || 0) + 1);

      if (maliciousIpCategories.has(sm.ipAddress)) {
        correlatedTrafficThreats.push(
          `${sm.ipAddress} (${maliciousIpCategories.get(sm.ipAddress)} in server logs)`
        );
      } else if (maliciousSubnetCategories.has(sm.subnet24)) {
        const cats = Array.from(maliciousSubnetCategories.get(sm.subnet24)!).join("/");
        correlatedTrafficThreats.push(
          `${sm.ipAddress} (subnet ${sm.subnet24} matched ${cats} in server logs)`
        );
      }
    }

    const topAsns = Array.from(asnCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label);
    const topCountries = Array.from(countryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => code);

    // Text reuse and template extraction
    const allTexts = clusterSubmissions.map((s) => s.rawText);
    const allEmbeddings = clusterSubmissions.map((s) => s.embedding);
    const uniqueTemplates = new Set(allTexts.map((t) => t.slice(0, 60))).size;

    let simSum = 0;
    let pairs = 0;
    for (let a = 0; a < Math.min(allTexts.length, 6); a++) {
      for (let b = a + 1; b < Math.min(allTexts.length, 6); b++) {
        simSum += evaluateTextSimilarity(
          allTexts[a]!,
          allTexts[b]!,
          allEmbeddings[a],
          allEmbeddings[b]
        );
        pairs++;
      }
    }
    const avgPairwiseSim = pairs > 0 ? Number((simSum / pairs).toFixed(2)) : 0;
    const paraphrasedDetected = avgPairwiseSim >= 0.38 && uniqueTemplates > 1;

    // Campaign timeline buckets & multi-window co-activity
    const windowAuthors = new Map<number, Set<string>>();
    for (const cs of clusterSubmissions) {
      const tMs = new Date(cs.createdAt).getTime();
      if (!Number.isNaN(tMs)) {
        const w = Math.floor(tMs / 300_000);
        const set = windowAuthors.get(w) || new Set<string>();
        set.add(cs.authorSessionHash || `anon_${cs.wpCommentId}`);
        windowAuthors.set(w, set);
      }
    }
    const clusterCoActivityWindows = Array.from(windowAuthors.values()).filter(
      (set) => set.size >= 2
    ).length;

    const timelineBuckets: Array<{ bucketLabel: string; count: number }> = [];
    const spanMs = Math.max(60_000, lastTime - firstTime);
    const numBuckets =
      lastTime === firstTime ? 1 : Math.min(8, Math.max(3, Math.ceil(spanMs / 300_000)));
    const bucketWidthMs = spanMs / numBuckets;
    const showDateInLabel = spanMs > 86_400_000;
    for (let bIdx = 0; bIdx < numBuckets; bIdx++) {
      const bStart = firstTime + bIdx * bucketWidthMs;
      const bEnd =
        bIdx === numBuckets - 1 ? lastTime + 1 : firstTime + (bIdx + 1) * bucketWidthMs;
      const count = clusterSubmissions.filter((cs) => {
        const t = new Date(cs.createdAt).getTime();
        return t >= bStart && t < bEnd;
      }).length;
      const iso = new Date(bStart).toISOString();
      timelineBuckets.push({
        bucketLabel: showDateInLabel ? iso.slice(5, 16).replace("T", " ") : iso.slice(11, 16),
        count,
      });
    }

    // Amplification & Account Similarity Metrics
    const tokenMemberCount = new Map<string, number>();
    for (const sm of swarmMembers) {
      const meta = metaBySession.get(sm.sessionHash)!;
      for (const tok of meta.tokens) {
        tokenMemberCount.set(tok, (tokenMemberCount.get(tok) || 0) + 1);
      }
    }
    const sharedUrlsOrCodes = Array.from(tokenMemberCount.entries())
      .filter(([, count]) => count >= 2)
      .map(([tok]) => tok);

    const clusterCommentIds = new Set(clusterSubmissions.map((s) => s.wpCommentId));
    let replyChainCount = 0;
    for (const cs of clusterSubmissions) {
      if (
        typeof cs.replyToCommentId === "number" &&
        clusterCommentIds.has(cs.replyToCommentId)
      ) {
        replyChainCount++;
      }
    }

    const memberSet = new Set(component);
    const clusterLinks = activeLinks.filter(
      (l) => memberSet.has(l.sourceSession) && memberSet.has(l.targetSession)
    );

    const hasAmplificationPattern =
      sharedUrlsOrCodes.length > 0 ||
      replyChainCount > 0 ||
      avgPairwiseSim >= 0.45;

    let amplifierCount = 0;
    const originatorSession = swarmMembers[0]!.sessionHash;
    if (hasAmplificationPattern) {
      swarmMembers[0]!.role = "ORIGINATOR";
      for (let idx = 1; idx < swarmMembers.length; idx++) {
        const sm = swarmMembers[idx]!;
        const meta = metaBySession.get(sm.sessionHash)!;
        const echoesToken = Array.from(meta.tokens).some((t) =>
          sharedUrlsOrCodes.includes(t)
        );
        const repliesInCluster = Array.from(meta.replyTargets).some((rid) =>
          clusterCommentIds.has(rid)
        );
        if (echoesToken || repliesInCluster || avgPairwiseSim >= 0.45) {
          sm.role = "AMPLIFIER";
          amplifierCount++;
        } else {
          sm.role = "COORDINATED_NODE";
        }
      }
    } else {
      for (const sm of swarmMembers) sm.role = "COORDINATED_NODE";
    }

    const amplificationVelocityPerMin = Number(
      (amplifierCount / Math.max(0.1, timeSpanMinutes)).toFixed(2)
    );
    const synchronizedBoostWave = amplifierCount >= 2 && timeSpanMinutes <= 15;

    const handleSims = clusterLinks
      .map((l) => l.sharedSignals.handleSimilarity ?? 0)
      .filter((v) => v > 0);
    const avgHandleSimilarity =
      handleSims.length > 0
        ? Number(
            (handleSims.reduce((a, b) => a + b, 0) / handleSims.length).toFixed(2)
          )
        : 0;

    const synchronizedNewAccountsCount = swarmMembers.filter(
      (sm) => sm.accountAgeHours !== null && sm.accountAgeHours !== undefined && sm.accountAgeHours <= 24
    ).length;

    const crossSubnetRotationDetected =
      subnets.size >= 2 &&
      clusterLinks.some((l) => l.sharedSignals.crossSubnetFingerprintMatch);

    // Determine campaign type
    const hasLowRatings = targetEntities.some(
      (t) => t.avgRating !== null && t.avgRating <= 2.0
    );
    const hasHighRatings = targetEntities.some(
      (t) => t.avgRating !== null && t.avgRating >= 4.5
    );
    let campaignType: SwarmCluster["campaignType"] = "BOT_SWARM";

    if (hasLowRatings && targetEntities.length >= 1) {
      campaignType = "COORDINATED_REVIEW_BOMB";
    } else if (
      replyChainCount > 0 ||
      (sharedUrlsOrCodes.length > 0 && amplifierCount >= 2)
    ) {
      campaignType = "SCRAPER_AMPLIFICATION";
    } else if (hasHighRatings && targetEntities.length >= 2) {
      campaignType = "ASTROTURF_PROPAGANDA";
    } else if (paraphrasedDetected) {
      campaignType = "ASTROTURF_PROPAGANDA";
    }

    // Calculate swarm confidence score (0-100)
    let conf = 40;
    if (swarmMembers.length >= 5) conf += 20;
    else if (swarmMembers.length >= 3) conf += 12;

    if (subnets.size === 1 && swarmMembers.length >= 3) conf += 20;
    if (avgPairwiseSim >= 0.5) conf += 20;
    else if (avgPairwiseSim >= 0.35) conf += 12;

    if (cadenceRegularity >= 80) conf += 15;
    if (targetEntities.length >= 2) conf += 15;
    if (sharedUrlsOrCodes.length > 0) conf += 10;
    if (avgHandleSimilarity >= 0.7 || synchronizedNewAccountsCount >= 2) conf += 10;
    if (crossSubnetRotationDetected) conf += 10;
    if (correlatedTrafficThreats.length > 0) conf += 10;

    const confidenceScore = Math.min(99, Math.round(conf));
    const threatLevel: SwarmCluster["threatLevel"] =
      confidenceScore >= 80 || swarmMembers.length >= 8
        ? "CRITICAL"
        : confidenceScore >= 60
          ? "ELEVATED"
          : "MODERATE";

    // Cluster Hash ID
    const clusterHash = createHash("sha256")
      .update(swarmMembers.map((m) => m.sessionHash).sort().join("|"))
      .digest("hex")
      .slice(0, 8);

    const swarmId = `swarm_${clusterHash}`;
    const primaryCountry = topCountries[0] || "Global";
    const primaryAsn = topAsns[0]?.split(" ")[1] || "Cloud";
    const swarmName = `${primaryCountry} ${primaryAsn} ${
      campaignType === "COORDINATED_REVIEW_BOMB"
        ? "Review-Bomb Brigade"
        : campaignType === "ASTROTURF_PROPAGANDA"
          ? "Astroturf Network"
          : campaignType === "SCRAPER_AMPLIFICATION"
            ? "Amplification Ring"
            : "Bot Swarm"
    }`;

    const graphNodes = swarmMembers.map((sm) => ({
      id: sm.sessionHash,
      label: sm.authorHandle || sm.sessionHash.slice(0, 10),
      ip: sm.ipAddress,
      country: sm.countryCode,
      rating: sm.ratings[0] ?? null,
      role: sm.role,
    }));

    const graphEdges = clusterLinks.map((cl) => {
      let reason = "Coordinated Activity";
      if (cl.sharedSignals.sharedUrlOrCode) reason = "Shared URL / Promo Amplification";
      else if (cl.sharedSignals.crossSubnetFingerprintMatch)
        reason = "Cross-Subnet Device Match";
      else if ((cl.sharedSignals.handleSimilarity ?? 0) >= 0.75)
        reason = "Bot Handle Pattern Similarity";
      else if ((cl.sharedSignals.coActivityWindows ?? 0) >= 2)
        reason = "Multi-Window Co-Activity";
      else if (cl.sharedSignals.sharedSubnet) reason = "Shared Subnet (/24)";
      else if (cl.sharedSignals.textSimilarity >= 0.5) reason = "Text Reuse / Paraphrase";
      else if (cl.sharedSignals.timeDeltaSeconds <= 60) reason = "Synchronized Burst";
      else if (cl.sharedSignals.coTargetCount >= 2) reason = "Multi-Entity Brigading";

      return {
        source: cl.sourceSession,
        target: cl.targetSession,
        weight: cl.weight,
        reason,
      };
    });

    const recommendedAction =
      threatLevel === "CRITICAL"
        ? `Deploy author-only shadowban across ${swarmMembers.length} sessions, rate-limit subnet ${topAsns[0] || "ASNs"}, and flag target comments.`
        : `Monitor campaign velocity on "${targetEntities[0]?.entityId || "targets"}" and enforce CAPTCHA on subsequent comments.`;

    swarmClusters.push({
      id: swarmId,
      name: swarmName,
      threatLevel,
      campaignType,
      confidenceScore,
      memberCount: swarmMembers.length,
      totalSubmissions: clusterSubmissions.length,
      members: swarmMembers,
      targetEntities,
      cadenceMetrics: {
        timeSpanMinutes,
        interArrivalTimeMeanSec: Number(meanInterval.toFixed(1)),
        interArrivalTimeStdDevSec: Number(stdDev.toFixed(1)),
        cadenceRegularityScore: cadenceRegularity,
        burstiness,
        coActivityWindows: clusterCoActivityWindows,
      },
      timelineBuckets,
      textReuseMetrics: {
        uniqueTemplates,
        avgPairwiseSimilarity: avgPairwiseSim,
        paraphrasedVariantsDetected: paraphrasedDetected,
      },
      amplificationMetrics: {
        originatorSession,
        amplifierCount,
        amplificationVelocityPerMin,
        sharedUrlsOrCodes,
        replyChainCount,
        synchronizedBoostWave,
      },
      accountSimilarityMetrics: {
        avgHandleSimilarity,
        synchronizedNewAccountsCount,
        crossSubnetRotationDetected,
      },
      correlatedTrafficThreats,
      networkFootprint: {
        uniqueIps: ips.size,
        uniqueSubnets: subnets.size,
        topAsns,
        topCountries,
      },
      sampleTexts: allTexts.slice(0, 3),
      graphNodes,
      graphEdges,
      recommendedAction,
    });
  }

  swarmClusters.sort(
    (a, b) => b.confidenceScore - a.confidenceScore || b.memberCount - a.memberCount
  );

  const globalCountries = new Map<string, number>();
  const allTargets = new Map<string, number>();
  let criticalCount = 0;
  let elevatedCount = 0;
  let totalMembers = 0;

  for (const sw of swarmClusters) {
    if (sw.threatLevel === "CRITICAL") criticalCount++;
    if (sw.threatLevel === "ELEVATED") elevatedCount++;
    totalMembers += sw.memberCount;

    for (const c of sw.networkFootprint.topCountries) {
      globalCountries.set(c, (globalCountries.get(c) || 0) + 1);
    }
    for (const t of sw.targetEntities) {
      allTargets.set(t.entityId, (allTargets.get(t.entityId) || 0) + t.count);
    }
  }

  return {
    analyzedSubmissionsCount: submissions.length,
    activeSwarmCount: swarmClusters.length,
    totalSwarmMembers: totalMembers,
    swarms: swarmClusters,
    summary: {
      criticalSwarms: criticalCount,
      elevatedSwarms: elevatedCount,
      topTargetEntities: Array.from(allTargets.entries())
        .map(([entityId, count]) => ({ entityId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      globalSwarmFootprint: Array.from(globalCountries.entries())
        .map(([countryCode, count]) => ({ countryCode, count }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function toNumericCommentId(rawId: unknown, fallbackIndex: number): number {
  if (typeof rawId === "number" && Number.isFinite(rawId) && rawId > 0) {
    return Math.floor(rawId);
  }
  const str = String(rawId || "").trim();
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    if (num > 0) return num;
  }
  if (str.length > 0) {
    return (fnv1aHash(str, 97) % 899_999_999) + 100_000;
  }
  return 500_000 + fallbackIndex;
}

function normalizeSocialRecord(
  rec: Record<string, any>,
  index: number,
  idMap: Map<string, number>
): RawSubmissionInput | null {
  const rawText = String(
    rec.rawText ?? rec.text ?? rec.content ?? rec.body ?? rec.message ?? ""
  ).trim();
  if (!rawText) return null;

  const rawId = rec.wpCommentId ?? rec.id ?? rec.post_id ?? rec.comment_id ?? rec.tweet_id;
  const wpCommentId = toNumericCommentId(rawId, index + 1);
  if (rawId !== undefined && rawId !== null && String(rawId).trim()) {
    idMap.set(String(rawId).trim(), wpCommentId);
  }

  const authorHandleRaw =
    rec.authorHandle ?? rec.author_handle ?? rec.author ?? rec.handle ?? rec.username ?? rec.user_handle ?? "";
  const authorHandle = String(authorHandleRaw).trim() || undefined;

  const sessionRaw =
    rec.authorSessionHash ??
    rec.session ??
    rec.user_id ??
    rec.author_id ??
    authorHandle ??
    `social_user_${index + 1}`;
  const authorSessionHash = String(sessionRaw).trim();

  const entityId =
    String(
      rec.entityId ?? rec.entity_id ?? rec.target_id ?? rec.target ?? rec.topic ?? rec.thread_id ?? "social_campaign"
    ).trim() || "social_campaign";

  const createdAtRaw =
    rec.createdAt ?? rec.timestamp ?? rec.created_at ?? rec.date ?? new Date().toISOString();
  const parsedCreated = new Date(createdAtRaw);
  const createdAt = Number.isNaN(parsedCreated.getTime())
    ? new Date().toISOString()
    : parsedCreated.toISOString();

  const replyRaw =
    rec.replyToCommentId ?? rec.reply_to_id ?? rec.reply_to ?? rec.parent_id ?? rec.in_reply_to ?? null;
  let replyToCommentId: number | null = null;
  if (replyRaw !== null && replyRaw !== undefined && String(replyRaw).trim() !== "") {
    const replyKey = String(replyRaw).trim();
    replyToCommentId = idMap.get(replyKey) ?? toNumericCommentId(replyKey, index + 1000);
  }

  const sharedUrlRaw = rec.sharedUrl ?? rec.url ?? rec.shared_url ?? rec.link ?? "";
  const sharedUrl = String(sharedUrlRaw).trim() || undefined;

  const ipRaw = rec.ipAddress ?? rec.ip ?? rec.ip_address ?? "";
  const ipAddress = String(ipRaw).trim() || undefined;

  const accountCreatedRaw =
    rec.accountCreatedAt ?? rec.account_created_at ?? rec.user_registered ?? "";
  const accountCreatedAt = String(accountCreatedRaw).trim() || undefined;

  const deviceFpRaw = rec.deviceFingerprint ?? rec.fingerprint ?? rec.device_fingerprint ?? "";
  const deviceFingerprint = String(deviceFpRaw).trim() || undefined;

  const userAgentRaw = rec.userAgent ?? rec.user_agent ?? "";
  const userAgent = String(userAgentRaw).trim() || undefined;

  const ratingNum =
    rec.rating !== undefined && rec.rating !== null && rec.rating !== ""
      ? Number(rec.rating)
      : rec.score !== undefined && rec.score !== null && rec.score !== ""
        ? Number(rec.score)
        : null;
  const rating = ratingNum !== null && Number.isFinite(ratingNum) ? ratingNum : null;

  const authorType =
    rec.authorType === "bot" || rec.author_type === "bot"
      ? "bot"
      : rec.authorType === "human" || rec.author_type === "human"
        ? "human"
        : undefined;

  return {
    id: rawId ? String(rawId) : `social_${wpCommentId}`,
    wpCommentId,
    entityId,
    authorSessionHash,
    ...(authorHandle ? { authorHandle } : {}),
    ...(accountCreatedAt ? { accountCreatedAt } : {}),
    ...(replyToCommentId !== null ? { replyToCommentId } : {}),
    ...(sharedUrl ? { sharedUrl } : {}),
    ...(deviceFingerprint ? { deviceFingerprint } : {}),
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(authorType ? { authorType } : {}),
    rawText,
    rating,
    createdAt,
  };
}

/**
 * Parses a generic CSV or JSON social media dataset into RawSubmissionInput[]
 * for platform-agnostic coordinated inauthentic behavior detection.
 */
export function parseSocialDataset(rawContent: string): RawSubmissionInput[] {
  const trimmed = (rawContent || "").trim();
  if (!trimmed) return [];

  const idMap = new Map<string, number>();

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const rows: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.submissions)
          ? parsed.submissions
          : Array.isArray(parsed?.posts)
            ? parsed.posts
            : Array.isArray(parsed?.data)
              ? parsed.data
              : [];
      const items: RawSubmissionInput[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row && typeof row === "object") {
          const item = normalizeSocialRecord(row, i, idMap);
          if (item) items.push(item);
        }
      }
      return items;
    } catch {
      return [];
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]!).map((h) => h.toLowerCase().trim());
  const items: RawSubmissionInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]!);
    const rec: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (key) rec[key] = cols[c] ?? "";
    }
    const item = normalizeSocialRecord(rec, i - 1, idMap);
    if (item) items.push(item);
  }
  return items;
}

/**
 * Generates a realistic multi-platform social campaign CSV dataset
 * combining an 8-account astroturf + reply-amplification ring across rotating subnets
 * with 10 organic community participants.
 */
export function generateSampleSocialDatasetCsv(): string {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const acctSync = iso(-1800_000);
  const rows = [
    "id,author,session,entity_id,timestamp,reply_to,url,ip,account_created_at,fingerprint,rating,text",
    `tw_101,promo_node_01,soc_bot_01,launch_thread,${iso(-900_000)},,https://fast-airdrop-promo.xyz,45.155.205.11,${acctSync},fp_win11_sync_88,5,"Huge breakthrough! Grab the verified bonus at https://fast-airdrop-promo.xyz with code BOOST99 right now!"`,
    `tw_102,promo_node_02,soc_bot_02,launch_thread,${iso(-880_000)},tw_101,https://fast-airdrop-promo.xyz,194.26.135.22,${acctSync},fp_win11_sync_88,5,"Confirmed working! Used code BOOST99 on https://fast-airdrop-promo.xyz and payout arrived instantly!"`,
    `tw_103,promo_node_03,soc_bot_03,launch_thread,${iso(-860_000)},tw_101,https://fast-airdrop-promo.xyz,185.220.101.33,${acctSync},fp_win11_sync_88,5,"Everyone switch over today — claim code BOOST99 at https://fast-airdrop-promo.xyz before quota closes!"`,
    `tw_104,promo_node_04,soc_bot_04,launch_thread,${iso(-840_000)},tw_101,https://fast-airdrop-promo.xyz,91.132.147.44,${acctSync},fp_win11_sync_88,5,"100% legit vouch for https://fast-airdrop-promo.xyz using code BOOST99 right now!"`,
    `tw_105,promo_node_05,soc_bot_05,product_hub,${iso(-580_000)},,https://fast-airdrop-promo.xyz,45.155.205.14,${acctSync},fp_win11_sync_88,5,"Best platform upgrade of 2026! Redeem BOOST99 at https://fast-airdrop-promo.xyz today!"`,
    `tw_106,promo_node_06,soc_bot_06,product_hub,${iso(-560_000)},tw_105,https://fast-airdrop-promo.xyz,194.26.135.29,${acctSync},fp_win11_sync_88,5,"Vouching for https://fast-airdrop-promo.xyz — BOOST99 worked smoothly for our whole team!"`,
    `tw_107,promo_node_07,soc_bot_07,product_hub,${iso(-540_000)},tw_105,https://fast-airdrop-promo.xyz,185.220.101.39,${acctSync},fp_win11_sync_88,5,"Dont miss https://fast-airdrop-promo.xyz with code BOOST99 before midnight!"`,
    `tw_108,promo_node_08,soc_bot_08,product_hub,${iso(-520_000)},tw_105,https://fast-airdrop-promo.xyz,91.132.147.49,${acctSync},fp_win11_sync_88,5,"Verified bonus link https://fast-airdrop-promo.xyz code BOOST99 works globally!"`,
    `tw_201,claire_m,org_user_01,launch_thread,${iso(-7200_000)},,,86.142.81.15,2022-04-10T09:15:00Z,fp_mac_claire,4,"Interesting product roadmap, though I am waiting to see independent latency benchmarks first."`,
    `tw_202,mikael_dev,org_user_02,product_hub,${iso(-6100_000)},,,88.114.202.41,2021-11-02T14:20:00Z,fp_linux_mikael,3,"Firmware setup took about ten minutes on our test bench. Documentation could be clearer on VLAN tags."`,
    `tw_203,sarah_k,org_user_03,launch_thread,${iso(-4800_000)},,,73.162.48.92,2020-08-19T18:05:00Z,fp_ios_sarah,5,"Solid hardware build quality so far in our small office deployment."`,
    `tw_204,david_r,org_user_04,support_forum,${iso(-3900_000)},,,80.12.44.18,2023-01-25T11:45:00Z,fp_win_david,2,"Support ticket took two days to answer, which was frustrating during our migration."`,
    `tw_205,nina_p,org_user_05,product_hub,${iso(-2900_000)},,,90.18.77.61,2021-05-12T08:30:00Z,fp_mac_nina,4,"Good battery endurance on the portable model compared to last year."`,
  ];
  return rows.join("\n");
}
