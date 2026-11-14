import { createHash } from "crypto";
import { debugLog, debugDecision } from "../config/logger";

export interface HoneypotClusterEntry {
  clusterId: string;
  canonicalText: string;
  shingles: Set<string>;
  tokenWeights: Map<string, number>;
  createdAtMs: number;
  lastSeenMs: number;
  hitCount: number;
  sampleSessionHashes: Set<string>;
  sampleReasons: string[];
}

export interface ClusterLookupResult {
  matched: boolean;
  matchType: "HONEYPOT_CLUSTER_VECTOR_MATCH" | "COORDINATED_WAVE_PROMOTED" | null;
  clusterId: string | null;
  similarity: number;
  clusterHitCount: number;
  reasons: string[];
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const VECTOR_SIMILARITY_THRESHOLD = 0.42;
const WAVE_SIMILARITY_THRESHOLD = 0.42;
const WAVE_PROMOTION_MIN_SESSIONS = 3;

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "you", "not", "are", "from",
  "your", "all", "have", "new", "more", "was", "will", "home", "can", "about",
  "page", "has", "search", "free", "but", "our", "one", "other", "do", "no",
  "time", "they", "site", "he", "up", "may", "what", "which", "their", "news",
  "out", "use", "any", "there", "see", "only", "so", "his", "when", "contact",
  "here", "business", "who", "web", "also", "now", "help", "get", "pm", "view",
  "online", "first", "am", "been", "would", "how", "were", "me", "services",
  "some", "these", "click", "its", "like", "service", "than", "find", "date",
  "back", "top", "people", "had", "list", "name", "just", "over", "state",
  "year", "day", "into", "email", "two", "health", "world", "next", "used",
  "go", "work", "last", "most", "products", "music", "buy", "data", "make",
  "them", "should", "product", "system", "post", "her", "city", "add", "policy",
  "number", "such", "please", "available", "copyright", "support", "message",
  "after", "best", "software", "then", "jan", "good", "video", "well", "where",
  "info", "rights", "public", "books", "high", "school", "through", "each",
  "links", "she", "review", "years", "order", "very", "privacy", "book", "items",
  "company", "read", "group", "need", "many", "user", "said", "de", "does",
  "set", "under", "general", "research", "university", "mail", "full", "map",
  "reviews", "program", "life", "know", "games", "way", "days", "management",
]);

/**
 * Normalizes common synonyms & morphological roots so paraphrased propaganda
 * maps to shared semantic stems during Stage 1B vector lookup.
 */
const SEMANTIC_SYNONYM_MAP: Array<[RegExp, string]> = [
  [/\b(globalists?|elites?|oligarchs?|cabal|establishment|regime|rulers)\b/g, "cabal_elite"],
  [/\b(puppet\s*masters?|shadowy|secret\s*controllers?|deep\s*state|hidden\s*hand|overlords?)\b/g, "shadow_controller"],
  [/\b(censored|deleted|silenced|banned|scrubbed|suppressed|removed|taken\s*down)\b/g, "censored_suppress"],
  [/\b(share|spread|repost|forward|circulate|distribute|broadcast)\b/g, "share_amplify"],
  [/\b(immediately|now|urgently|fast|quickly|before\s*it\s*is\s*too\s*late|right\s*away)\b/g, "urgent_now"],
  [/\b(destroy\w*|ruin\w*|collapse\w*|devastat\w*|wreck\w*|annihilat\w*|decimat\w*)\b/g, "destroy_ruin"],
  [/\b(corrupt\w*|crook\w*|rigged|fraud\w*|scam\w*|stolen|treason\w*|traitor\w*)\b/g, "corrupt_treason"],
  [/\b(wake\s*up|open\s*your\s*eyes|sheeple|blind\s*masses)\b/g, "wakeup_call"],
  [/\b(manufactur\w*|fabricat\w*|hoax|fake|orchestrat\w*|staged|engineered)\b/g, "manufactured_hoax"],
  [/\b(cover[\s-]*up|hiding\s*the\s*truth|lying\s*to\s*us|deceiv\w*|manipulat\w*)\b/g, "coverup_lie"],
  [/\b(boycott|abandon|dump|cancel|refuse)\b/g, "boycott_action"],
  [/\b(taxpayers?|citizens?|working\s*families|ordinary\s*people|patriots?)\b/g, "citizen_group"],
  [/\b(bankrupt\w*|drain\w*|steal\w*|loot\w*|plunder\w*|siphon\w*)\b/g, "plunder_wealth"],
];

// Active honeypot clusters discovered from Stage 1A/1B bots in the current 1-hour window
const activeHoneypotClusters = new Map<string, HoneypotClusterEntry>();

// Rolling 1-hour candidate wave tracker for human-telemetry submissions
interface WaveCandidate {
  text: string;
  shingles: Set<string>;
  tokenWeights: Map<string, number>;
  sessionHash: string;
  timestampMs: number;
}
const recentWaveCandidates: WaveCandidate[] = [];

// Stats counters for reporting & dashboard
export const honeypotMetrics = {
  stage1aDirectBots: 0,
  stage1bVectorCaughtBots: 0,
  wavesPromotedToClusters: 0,
};

export function resetHoneypotClusters(): void {
  activeHoneypotClusters.clear();
  recentWaveCandidates.length = 0;
  honeypotMetrics.stage1aDirectBots = 0;
  honeypotMetrics.stage1bVectorCaughtBots = 0;
  honeypotMetrics.wavesPromotedToClusters = 0;
}

export function getHoneypotVaultStats() {
  pruneExpiredEntries(Date.now());
  const clusters = Array.from(activeHoneypotClusters.values()).map((c) => ({
    clusterId: c.clusterId,
    canonicalPreview: c.canonicalText.slice(0, 90),
    hitCount: c.hitCount,
    uniqueSessions: c.sampleSessionHashes.size,
    createdAt: new Date(c.createdAtMs).toISOString(),
    lastSeenAt: new Date(c.lastSeenMs).toISOString(),
    sampleReasons: c.sampleReasons,
  }));

  return {
    activeClusterCount: clusters.length,
    stage1aDirectBots: honeypotMetrics.stage1aDirectBots,
    stage1bVectorCaughtBots: honeypotMetrics.stage1bVectorCaughtBots,
    wavesPromotedToClusters: honeypotMetrics.wavesPromotedToClusters,
    clusters,
  };
}

function pruneExpiredEntries(nowMs: number): void {
  for (const [id, entry] of activeHoneypotClusters.entries()) {
    if (nowMs - entry.lastSeenMs > ONE_HOUR_MS) {
      activeHoneypotClusters.delete(id);
    }
  }
  while (recentWaveCandidates.length > 0 && nowMs - recentWaveCandidates[0]!.timestampMs > ONE_HOUR_MS) {
    recentWaveCandidates.shift();
  }
}

/**
 * Extracts normalized semantic tokens and character/word shingles for fast <0.5ms similarity matching.
 */
export function buildTextFeatures(rawText: string): {
  shingles: Set<string>;
  tokenWeights: Map<string, number>;
} {
  let normalized = rawText.toLowerCase();
  for (const [pattern, replacement] of SEMANTIC_SYNONYM_MAP) {
    normalized = normalized.replace(pattern, ` ${replacement} `);
  }

  const rawWords = normalized
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  // Stem simple suffixes so "destroying" / "destroyed" / "destroys" match
  const stemmed = rawWords.map((w) => {
    if (w.includes("_")) return w; // already canonicalized concept token
    return w.replace(/(ing|ed|ly|es|s|tion|ment)$/, "") || w;
  });

  const tokenWeights = new Map<string, number>();
  const shingles = new Set<string>();

  for (let i = 0; i < stemmed.length; i++) {
    const token = stemmed[i]!;
    // Semantic concept tokens get higher weight (2.0) vs normal words (1.0)
    const weight = token.includes("_") ? 2.2 : 1.0;
    tokenWeights.set(token, (tokenWeights.get(token) || 0) + weight);
    shingles.add(token);

    // Add word bigrams
    if (i < stemmed.length - 1) {
      shingles.add(`${token}+${stemmed[i + 1]}`);
    }
  }

  // Add character 4-grams of content words to catch minor typos/obfuscation
  const compact = stemmed.join(" ");
  for (let i = 0; i <= compact.length - 4; i += 2) {
    shingles.add(`c4:${compact.slice(i, i + 4)}`);
  }

  return { shingles, tokenWeights };
}

/**
 * Computes hybrid Cosine + Shingle Jaccard similarity in [0, 1].
 */
export function computeTextSimilarity(
  a: { shingles: Set<string>; tokenWeights: Map<string, number> },
  b: { shingles: Set<string>; tokenWeights: Map<string, number> }
): number {
  if (a.tokenWeights.size === 0 || b.tokenWeights.size === 0) return 0;

  // 1. Weighted Token Cosine Similarity
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [tok, wA] of a.tokenWeights.entries()) {
    normA += wA * wA;
    const wB = b.tokenWeights.get(tok);
    if (wB !== undefined) {
      dot += wA * wB;
    }
  }
  for (const wB of b.tokenWeights.values()) {
    normB += wB * wB;
  }

  const cosine = normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;

  // 2. Shingle Jaccard Similarity
  let intersection = 0;
  const smaller = a.shingles.size <= b.shingles.size ? a.shingles : b.shingles;
  const larger = a.shingles.size <= b.shingles.size ? b.shingles : a.shingles;
  for (const s of smaller) {
    if (larger.has(s)) intersection++;
  }
  const union = a.shingles.size + b.shingles.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;

  // Weighted blend favoring semantic token cosine + shingle overlap
  return Math.min(1, cosine * 0.78 + jaccard * 0.22);
}

/**
 * Records a confirmed bot submission into the active 1-hour Honeypot Cluster Vault.
 * Merges into an existing cluster if similarity >= VECTOR_SIMILARITY_THRESHOLD, or creates a new cluster.
 */
export function recordHoneypotSubmission(
  rawText: string,
  sessionHash: string,
  reasons: string[],
  nowMs = Date.now()
): { clusterId: string; isNewCluster: boolean; hitCount: number } {
  pruneExpiredEntries(nowMs);
  honeypotMetrics.stage1aDirectBots++;

  const features = buildTextFeatures(rawText);

  let bestCluster: HoneypotClusterEntry | null = null;
  let bestSim = 0;

  for (const cluster of activeHoneypotClusters.values()) {
    const sim = computeTextSimilarity(features, cluster);
    if (sim > bestSim) {
      bestSim = sim;
      bestCluster = cluster;
    }
  }

  if (bestCluster && bestSim >= VECTOR_SIMILARITY_THRESHOLD) {
    bestCluster.lastSeenMs = nowMs;
    bestCluster.hitCount++;
    bestCluster.sampleSessionHashes.add(sessionHash);
    // Merge new tokens/shingles into cluster centroid (bounded)
    if (bestCluster.tokenWeights.size < 120) {
      for (const [tok, w] of features.tokenWeights.entries()) {
        bestCluster.tokenWeights.set(tok, Math.max(bestCluster.tokenWeights.get(tok) || 0, w));
      }
      for (const s of features.shingles) {
        if (bestCluster.shingles.size < 250) bestCluster.shingles.add(s);
      }
    }
    return {
      clusterId: bestCluster.clusterId,
      isNewCluster: false,
      hitCount: bestCluster.hitCount,
    };
  }

  const hash = createHash("sha256").update(rawText.trim().toLowerCase()).digest("hex").slice(0, 10);
  const clusterId = `cluster_hp_${hash}`;

  const entry: HoneypotClusterEntry = {
    clusterId,
    canonicalText: rawText,
    shingles: features.shingles,
    tokenWeights: features.tokenWeights,
    createdAtMs: nowMs,
    lastSeenMs: nowMs,
    hitCount: 1,
    sampleSessionHashes: new Set([sessionHash]),
    sampleReasons: reasons.slice(0, 3),
  };

  activeHoneypotClusters.set(clusterId, entry);
  debugLog("HoneypotCluster", `Created new honeypot cluster ${clusterId}`, {
    textPreview: rawText.slice(0, 70),
  });

  return { clusterId, isNewCluster: true, hitCount: 1 };
}

/**
 * Checks if a text contains propaganda / coordinated manipulation framing rather than normal product feedback.
 */
function hasPropagandaSignals(features: { tokenWeights: Map<string, number> }, rawText: string): boolean {
  let conceptHits = 0;
  for (const tok of features.tokenWeights.keys()) {
    if (tok.includes("_")) conceptHits++;
  }
  if (conceptHits >= 2) return true;
  return /globalist|cabal|puppet|censored|regime|sheeple|wake up|deep state|share before|deleted|propaganda|traitor/i.test(
    rawText
  );
}

/**
 * Stage 1B Honeypot Vector Lookup & Same-Hour Coordinated Wave Detector.
 * Catches Stealth Bots (Bucket B) that use realistic human telemetry/cookies
 * but post paraphrased variants matching an active Honeypot Cluster or a same-hour coordinated wave.
 */
export function lookupHoneypotCluster(
  rawText: string,
  sessionHash: string,
  nowMs = Date.now()
): ClusterLookupResult {
  pruneExpiredEntries(nowMs);
  const features = buildTextFeatures(rawText);

  // 1. Compare against active Honeypot Clusters from Stage 1A/1B
  // Require at least 1 specific subject/domain noun beyond generic propaganda tropes
  const hasDomainSubject =
    /\b(econom\w*|taxpayer\w*|citizen\w*|famil\w*|nation\w*|communit\w*|wealth\w*|bankrupt\w*|patriot\w*|society|future)\b/i.test(
      rawText
    );

  let bestCluster: HoneypotClusterEntry | null = null;
  let bestSim = 0;

  if (hasDomainSubject) {
    for (const cluster of activeHoneypotClusters.values()) {
      const sim = computeTextSimilarity(features, cluster);
      if (sim > bestSim) {
        bestSim = sim;
        bestCluster = cluster;
      }
    }
  }

  if (bestCluster && bestSim >= VECTOR_SIMILARITY_THRESHOLD) {
    bestCluster.lastSeenMs = nowMs;
    bestCluster.hitCount++;
    bestCluster.sampleSessionHashes.add(sessionHash);
    honeypotMetrics.stage1bVectorCaughtBots++;

    const simPct = Math.round(bestSim * 100);
    const reason = `Stage 1B Honeypot Vector Lookup: Paraphrased text matched active honeypot cluster ${bestCluster.clusterId} (${simPct}% semantic similarity across ${bestCluster.hitCount} same-hour submissions)`;

    debugDecision("HoneypotCluster", "STEALTH_BOT_CAUGHT_BY_VECTOR_LOOKUP", {
      clusterId: bestCluster.clusterId,
      similarity: Number(bestSim.toFixed(3)),
      clusterHitCount: bestCluster.hitCount,
    });

    return {
      matched: true,
      matchType: "HONEYPOT_CLUSTER_VECTOR_MATCH",
      clusterId: bestCluster.clusterId,
      similarity: Number(bestSim.toFixed(3)),
      clusterHitCount: bestCluster.hitCount,
      reasons: [reason],
    };
  }

  // 2. Check Same-Hour Coordinated Paraphrased Propaganda Wave across distinct sessions
  if (hasPropagandaSignals(features, rawText)) {
    const matchingSessions = new Set<string>([sessionHash]);
    let maxWaveSim = 0;

    for (const cand of recentWaveCandidates) {
      const sim = computeTextSimilarity(features, cand);
      if (sim >= WAVE_SIMILARITY_THRESHOLD) {
        matchingSessions.add(cand.sessionHash);
        if (sim > maxWaveSim) maxWaveSim = sim;
      }
    }

    recentWaveCandidates.push({
      text: rawText,
      shingles: features.shingles,
      tokenWeights: features.tokenWeights,
      sessionHash,
      timestampMs: nowMs,
    });

    if (matchingSessions.size >= WAVE_PROMOTION_MIN_SESSIONS) {
      honeypotMetrics.wavesPromotedToClusters++;
      honeypotMetrics.stage1bVectorCaughtBots++;
      // Promote this coordinated wave into activeHoneypotClusters so all subsequent stealth bots in the wave are caught immediately
      const hash = createHash("sha256").update(rawText.trim().toLowerCase()).digest("hex").slice(0, 10);
      const clusterId = `cluster_wave_${hash}`;
      const simPct = Math.round(maxWaveSim * 100);
      const reason = `Coordinated Same-Hour Propaganda Wave: ${matchingSessions.size} distinct sessions posted paraphrased narrative (${simPct}% similarity)`;

      const newCluster: HoneypotClusterEntry = {
        clusterId,
        canonicalText: rawText,
        shingles: features.shingles,
        tokenWeights: features.tokenWeights,
        createdAtMs: nowMs,
        lastSeenMs: nowMs,
        hitCount: matchingSessions.size,
        sampleSessionHashes: matchingSessions,
        sampleReasons: [reason],
      };
      activeHoneypotClusters.set(clusterId, newCluster);

      debugDecision("HoneypotCluster", "COORDINATED_SAME_HOUR_WAVE_PROMOTED", {
        clusterId,
        uniqueSessions: matchingSessions.size,
        similarity: Number(maxWaveSim.toFixed(3)),
      });

      return {
        matched: true,
        matchType: "COORDINATED_WAVE_PROMOTED",
        clusterId,
        similarity: Number(maxWaveSim.toFixed(3)),
        clusterHitCount: matchingSessions.size,
        reasons: [reason],
      };
    }
  }

  return {
    matched: false,
    matchType: null,
    clusterId: null,
    similarity: Number(bestSim.toFixed(3)),
    clusterHitCount: 0,
    reasons: [],
  };
}
