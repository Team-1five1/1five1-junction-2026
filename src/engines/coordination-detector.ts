import { createHash } from "node:crypto";
import { computeLocalEmbedding, cosineSimilarity } from "../ai/embeddings";
import { resolveOriginGeo, type OriginGeoInfo } from "./geo-intel";

export interface SwarmMember {
  sessionHash: string;
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
  };
}

export interface SwarmCluster {
  id: string;
  name: string;
  threatLevel: "CRITICAL" | "ELEVATED" | "MODERATE";
  campaignType: "ASTROTURF_PROPAGANDA" | "COORDINATED_REVIEW_BOMB" | "SCRAPER_AMPLIFICATION" | "BOT_SWARM";
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
  };
  textReuseMetrics: {
    uniqueTemplates: number;
    avgPairwiseSimilarity: number;
    paraphrasedVariantsDetected: boolean;
  };
  networkFootprint: {
    uniqueIps: number;
    uniqueSubnets: number;
    topAsns: string[];
    topCountries: string[];
  };
  sampleTexts: string[];
  graphNodes: Array<{ id: string; label: string; ip: string; country: string; rating: number | null }>;
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

export interface RawSubmissionInput {
  id?: string;
  wpCommentId: number;
  entityId: string;
  authorSessionHash: string;
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
  // IPv6 prefix
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

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Calculates text similarity combining n-gram Jaccard and local embeddings
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

  let vectorSim = 0;
  if (embA && embB && embA.length > 0 && embB.length > 0) {
    vectorSim = Math.max(0, cosineSimilarity(embA, embB));
  } else {
    // Compute on the fly if needed
    const localA = computeLocalEmbedding(textA, []);
    const localB = computeLocalEmbedding(textB, []);
    vectorSim = Math.max(0, cosineSimilarity(localA, localB));
  }

  // Blended metric: high Jaccard for near-exact templates, high vectorSim for paraphrased variants
  return Math.max(jaccard * 0.7 + vectorSim * 0.3, vectorSim * 0.85);
}

/**
 * Detects coordinated inauthentic behavior, bot swarms, and astroturfing across multiple submissions.
 */
export function detectCoordinatedSwarms(submissions: RawSubmissionInput[]): SwarmDetectionResult {
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

  // 1. Group submissions by author session hash
  const sessionMap = new Map<string, RawSubmissionInput[]>();
  for (const sub of submissions) {
    const session = sub.authorSessionHash || `anon_${sub.wpCommentId}`;
    const list = sessionMap.get(session) || [];
    list.push(sub);
    sessionMap.set(session, list);
  }

  // Build member models
  const members: SwarmMember[] = [];
  const memberBySession = new Map<string, SwarmMember>();

  for (const [session, subs] of sessionMap.entries()) {
    subs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const first = subs[0]!;
    const last = subs[subs.length - 1]!;
    const ip = first.ipAddress || (first.origin ? first.origin.ipAddress : "127.0.0.1");
    const geo = first.origin || resolveOriginGeo({
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

    const ratings: number[] = [];
    const targets = new Set<string>();
    const texts: string[] = [];

    for (const s of subs) {
      if (typeof s.rating === "number") ratings.push(s.rating);
      targets.add(s.entityId);
      texts.push(s.rawText);
      const tel = s.telemetry || {};
      if (typeof tel.keystrokeFlightVariance === "number") totalVariance += tel.keystrokeFlightVariance;
      if (typeof tel.formCompletionTimeMs === "number") totalCompletion += tel.formCompletionTimeMs;
      if (tel.botdDetected) botdHits++;
      if (tel.webdriver) webdriverHits++;
      if (s.userAgent && s.userAgent !== "unknown") userAgent = s.userAgent;
    }

    const member: SwarmMember = {
      sessionHash: session,
      ipAddress: ip,
      subnet24: extractSubnet24(ip),
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
  }

  // 2. Build Coordination Graph with pairwise evidence weighting
  const links: SwarmLink[] = [];
  const adjacency = new Map<string, Set<string>>();
  for (const m of members) adjacency.set(m.sessionHash, new Set());

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const mA = members[i]!;
      const mB = members[j]!;

      // Compare subnets and ASNs
      const sharedSubnet = mA.subnet24 !== "unknown/24" && mA.subnet24 === mB.subnet24;
      const sharedAsn = mA.asnLabel !== "Direct / Unclassified Network" && mA.asnLabel === mB.asnLabel;

      // Temporal proximity
      const timeDeltaSec = Math.abs(
        (new Date(mA.firstSeen).getTime() - new Date(mB.firstSeen).getTime()) / 1000
      );

      // Co-targeted entities (brigading)
      const targetsA = new Set(mA.targetEntities);
      let coTargetCount = 0;
      for (const t of mB.targetEntities) {
        if (targetsA.has(t)) coTargetCount++;
      }

      // Max text similarity between any text in A and B
      let maxSim = 0;
      for (const tA of mA.sampleTexts) {
        for (const tB of mB.sampleTexts) {
          const sim = evaluateTextSimilarity(tA, tB);
          if (sim > maxSim) maxSim = sim;
        }
      }

      // Telemetry similarity
      const varianceDiff = Math.abs(
        mA.telemetrySummary.avgFlightVariance - mB.telemetrySummary.avgFlightVariance
      );
      const telemetryColocation =
        (mA.telemetrySummary.botdDetectedCount > 0 && mB.telemetrySummary.botdDetectedCount > 0) ||
        (mA.telemetrySummary.webdriverCount > 0 && mB.telemetrySummary.webdriverCount > 0) ||
        (varianceDiff < 3 && mA.telemetrySummary.avgFlightVariance < 5);

      // Weight accumulator
      let weight = 0;
      if (sharedSubnet) weight += 0.35;
      if (sharedAsn) weight += 0.15;

      if (timeDeltaSec <= 45) weight += 0.35;
      else if (timeDeltaSec <= 180) weight += 0.25;
      else if (timeDeltaSec <= 900) weight += 0.15;

      if (maxSim >= 0.7) weight += 0.45;
      else if (maxSim >= 0.4) weight += 0.30;
      else if (maxSim >= 0.25) weight += 0.15;

      if (coTargetCount >= 2) weight += 0.35;
      else if (coTargetCount === 1) weight += 0.15;

      if (telemetryColocation) weight += 0.2;

      // Threshold to form a coordination link
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
          },
        });
        adjacency.get(mA.sessionHash)!.add(mB.sessionHash);
        adjacency.get(mB.sessionHash)!.add(mA.sessionHash);
      }
    }
  }

  // 3. Find Connected Components (Swarm Units)
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

    // A swarm requires at least 2 collaborating accounts
    if (component.length < 2) continue;

    const swarmMembers = component.map((id) => memberBySession.get(id)!);

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
    const lastTime = new Date(clusterSubmissions[clusterSubmissions.length - 1]!.createdAt).getTime();
    const timeSpanMinutes = Math.max(0.1, Number(((lastTime - firstTime) / 60000).toFixed(1)));

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

    // Burstiness metric B = (std - mean) / (std + mean)
    const burstiness =
      stdDev + meanInterval > 0
        ? Number(((stdDev - meanInterval) / (stdDev + meanInterval)).toFixed(2))
        : 0;

    // Robotic cadence regularity: low stdDev relative to mean means programmed periodic intervals
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

    const targetEntities = Array.from(entityCountMap.entries()).map(([entityId, val]) => ({
      entityId,
      count: val.count,
      avgRating:
        val.ratings.length > 0
          ? Number((val.ratings.reduce((a, b) => a + b, 0) / val.ratings.length).toFixed(1))
          : null,
    }));

    // Network footprint
    const ips = new Set<string>();
    const subnets = new Set<string>();
    const asnCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();

    for (const sm of swarmMembers) {
      ips.add(sm.ipAddress);
      subnets.add(sm.subnet24);
      asnCounts.set(sm.asnLabel, (asnCounts.get(sm.asnLabel) || 0) + 1);
      countryCounts.set(sm.countryCode, (countryCounts.get(sm.countryCode) || 0) + 1);
    }

    const topAsns = Array.from(asnCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label);
    const topCountries = Array.from(countryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => code);

    // Text reuse and template extraction
    const allTexts = clusterSubmissions.map((s) => s.rawText);
    const uniqueTemplates = new Set(allTexts.map((t) => t.slice(0, 60))).size;

    let simSum = 0;
    let pairs = 0;
    for (let a = 0; a < Math.min(allTexts.length, 6); a++) {
      for (let b = a + 1; b < Math.min(allTexts.length, 6); b++) {
        simSum += evaluateTextSimilarity(allTexts[a]!, allTexts[b]!);
        pairs++;
      }
    }
    const avgPairwiseSim = pairs > 0 ? Number((simSum / pairs).toFixed(2)) : 0;
    const paraphrasedDetected = avgPairwiseSim >= 0.38 && uniqueTemplates > 1;

    // Determine campaign type
    const hasLowRatings = targetEntities.some((t) => t.avgRating !== null && t.avgRating <= 2.0);
    const hasHighRatings = targetEntities.some((t) => t.avgRating !== null && t.avgRating >= 4.5);
    let campaignType: SwarmCluster["campaignType"] = "BOT_SWARM";

    if (hasLowRatings && targetEntities.length >= 1) {
      campaignType = "COORDINATED_REVIEW_BOMB";
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
    if (targetEntities.length >= 2) conf += 15; // multi-entity brigading

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
        : "Bot Swarm"
    }`;

    // Subgraph extraction for visualization
    const memberSet = new Set(component);
    const clusterLinks = links.filter(
      (l) => memberSet.has(l.sourceSession) && memberSet.has(l.targetSession)
    );

    const graphNodes = swarmMembers.map((sm) => ({
      id: sm.sessionHash,
      label: sm.sessionHash.slice(0, 10),
      ip: sm.ipAddress,
      country: sm.countryCode,
      rating: sm.ratings[0] ?? null,
    }));

    const graphEdges = clusterLinks.map((cl) => {
      let reason = "Coordinated Activity";
      if (cl.sharedSignals.sharedSubnet) reason = "Shared Subnet (/24)";
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
      },
      textReuseMetrics: {
        uniqueTemplates,
        avgPairwiseSimilarity: avgPairwiseSim,
        paraphrasedVariantsDetected: paraphrasedDetected,
      },
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

  // Sort swarms by threat level & size
  swarmClusters.sort((a, b) => b.confidenceScore - a.confidenceScore || b.memberCount - a.memberCount);

  // Global footprint aggregation
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
