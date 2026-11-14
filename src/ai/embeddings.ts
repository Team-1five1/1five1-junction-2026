import { SEMEVAL_QUESTIONS } from "../config/semeval-questions";

export const EMBEDDING_DIM = 64;

const TOPIC_LEXICONS: RegExp[] = [
  // 0: Product defects / crashes / software bugs
  /\b(bug|bugs|crash|crashed|crashes|patch|update|lag|fps|freeze|broken|glitch|error|offline|outage|server)\b/i,
  // 1: Shipping / billing / customer service / e-commerce
  /\b(shipping|delivery|package|parcel|order|ordered|refund|charge|charged|billing|support|customer service|late|delayed)\b/i,
  // 2: Quality / praise / positive satisfaction
  /\b(great|awesome|love|loved|excellent|smooth|fast|helpful|recommend|perfect|solid|best|happy|works well)\b/i,
  // 3: Intense anger / venting / disappointment
  /\b(hate|horrible|terrible|worst|garbage|trash|useless|waste|annoyed|frustrated|disappointed|pathetic|ridiculous)\b/i,
  // 4: Conspiracy / shadowy cabal / deep state
  /\b(cabal|regime|puppet|globalist|deep state|agenda|coverup|cover-up|psyop|controlled|elites|shadowy|narrative)\b/i,
  // 5: Urgency / censorship / viral bot bait
  /\b(censored|deleted|ban|banned|wake up|sheeple|share immediately|spread this|before they delete|bet you won't|repost)\b/i,
  // 6: Financial / crypto / spam / promotion
  /\b(crypto|bitcoin|usdt|airdrop|giveaway|free money|profit|forex|casino|pills|discount|promo|click here|whatsapp|telegram)\b/i,
  // 7: Scam / fraud / accusation
  /\b(scam|scammers|fraud|fraudulent|steal|stole|thieves|ponzi|ripoff|rip-off|con artists|fake|dishonest)\b/i,
  // 8: Group identity / stereotyping / out-group hostility
  /\b(traitor|traitors|parasite|parasites|vermin|infestation|those people|all of them|typical of|destroy our|threat to our)\b/i,
  // 9: Quoting / reporting / journalistic / academic context
  /\b(according to|report|study|published|quoted|quoting|stated that|claimed that|article|document|filing|source|evidence)\b/i,
  // 10: Nuance / balanced comparison
  /\b(however|on the other hand|to be fair|although|pros and cons|both sides|balanced|overall|nevertheless|context)\b/i,
  // 11: Satire / humor / sarcasm
  /\b(satire|parody|joke|joking|lmao|lol|rofl|sarcasm|ironic|meme|hilarious|kidding)\b/i,
  // 12: Account / login / authentication issues
  /\b(login|password|account|locked|verification|2fa|sign in|reset|banned account|access)\b/i,
  // 13: Pricing / subscription / value
  /\b(price|pricing|expensive|overpriced|cheap|subscription|fee|cost|money|worth|value|paywall)\b/i,
  // 14: Security / privacy / malware / data
  /\b(security|privacy|hack|hacked|breach|malware|spyware|tracking|data leak|phishing|virus)\b/i,
  // 15: Political / ideological polarization
  /\b(propaganda|ideology|radical|extremist|boycott|woke|fascist|dictator|tyranny|brainwashed|indoctrination)\b/i,
];

function fnv1aHash(str: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function normalizeVector(vec: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm < 1e-9) {
    const fallback = new Array(vec.length).fill(0);
    fallback[0] = 1;
    return fallback;
  }
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

/**
 * Generates a deterministic 64-dimensional semantic + structural + n-gram LSH vector.
 * If Hostinger AI Router embeddings are explicitly enabled, folds remote embeddings with local semantic signals.
 */
export function computeLocalEmbedding(
  text: string,
  triggeredIds: string[] = []
): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const clean = (text || "").trim();
  const lower = clean.toLowerCase();

  // 1. Dimensions 0..15: Semantic topic lexicon activations
  for (let i = 0; i < TOPIC_LEXICONS.length; i++) {
    const matches = clean.match(new RegExp(TOPIC_LEXICONS[i].source, "gi"));
    if (matches && matches.length > 0) {
      vec[i] = Math.min(1.5, 0.65 + matches.length * 0.25);
    }
  }

  // 2. Dimensions 16..23: SemEval-50 bucket & risk/shield structural activations
  for (const qId of triggeredIds) {
    const q = SEMEVAL_QUESTIONS[qId as `Q${number}`];
    if (q) {
      const bucketIdx = 15 + Math.min(7, Math.max(1, q.bucket)); // 16..22
      vec[bucketIdx] += (q.pointsOrFlags || 1) * 0.35;
    }
  }

  // Structural style signals in dims 23..27
  const upperCount = (clean.match(/[A-Z]/g) || []).length;
  const alphaCount = Math.max(1, (clean.match(/[a-zA-Z]/g) || []).length);
  const exclamCount = (clean.match(/!/g) || []).length;
  const urlCount = (clean.match(/https?:\/\/\S+/gi) || []).length;
  const quoteCount = (clean.match(/["“”]/g) || []).length;

  vec[23] = Math.min(1.0, (upperCount / alphaCount) * 2.0);
  vec[24] = Math.min(1.0, exclamCount * 0.25);
  vec[25] = Math.min(1.0, urlCount * 0.7);
  vec[26] = Math.min(1.0, quoteCount * 0.25);
  vec[27] = Math.min(1.0, clean.length / 400);

  // 3. Dimensions 28..63 (36 dims): Signed Random Projection of word unigrams, bigrams, and char trigrams
  const words = lower
    .replace(/https?:\/\/\S+/g, " __url__ ")
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const lshSpan = EMBEDDING_DIM - 28; // 36 dimensions

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const h1 = fnv1aHash(w, 2166136261);
    const h2 = fnv1aHash(w, 374761393);
    const idx1 = 28 + (h1 % lshSpan);
    const idx2 = 28 + (h2 % lshSpan);
    const sign1 = (h1 & 1) === 0 ? 1 : -1;
    const sign2 = (h2 & 1) === 0 ? 1 : -1;
    vec[idx1] += sign1 * 0.45;
    vec[idx2] += sign2 * 0.3;

    // Word bigram
    if (i + 1 < words.length) {
      const bg = `${w}_${words[i + 1]}`;
      const hb = fnv1aHash(bg, 668265263);
      const idxB = 28 + (hb % lshSpan);
      const signB = (hb & 1) === 0 ? 1 : -1;
      vec[idxB] += signB * 0.55;
    }

    // Character 3-grams for fuzzy/typo resilience
    if (w.length >= 4) {
      for (let c = 0; c <= w.length - 3; c++) {
        const tri = w.slice(c, c + 3);
        const hc = fnv1aHash(tri, 1442695041);
        const idxC = 28 + (hc % lshSpan);
        const signC = (hc & 1) === 0 ? 1 : -1;
        vec[idxC] += signC * 0.12;
      }
    }
  }

  return normalizeVector(vec);
}

export async function generateCommentEmbedding(
  text: string,
  triggeredIds: string[] = []
): Promise<number[]> {
  return computeLocalEmbedding(text, triggeredIds);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-9) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

export function toPgVectorLiteral(vec: number[]): string {
  return `[${vec.map((n) => (Number.isFinite(n) ? n.toFixed(6) : "0")).join(",")}]`;
}
