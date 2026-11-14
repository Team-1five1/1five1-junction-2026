import { createHash } from "node:crypto";
import { reverse as dnsReverse, resolve4 as dnsResolve4 } from "node:dns/promises";
import { resolveOriginGeo } from "./geo-intel";

export type TrafficCategory =
  | "HUMAN_VISITOR"
  | "VERIFIED_BOT"
  | "AI_CRAWLER"
  | "SPOOFED_BOT"
  | "SCRAPER"
  | "CREDENTIAL_STUFFER"
  | "VULNERABILITY_SCANNER"
  | "DOS_FLOODER";

export interface TrafficCleanOptions {
  sensitivity?: "low" | "medium" | "high";
  allowlistIps?: string[];
  allowlistSubnets?: string[];
  aiCrawlerPolicy?: "allow" | "block" | "challenge";
}

export interface ParsedLogEntry {
  ipAddress: string;
  timestamp: Date;
  method: string;
  path: string;
  statusCode: number;
  bytesSent: number;
  referer: string;
  userAgent: string;
  username?: string;
}

export interface IpThreatProfile {
  ipAddress: string;
  countryCode: string;
  countryName: string;
  asnLabel: string;
  networkType: string;
  totalRequests: number;
  category: TrafficCategory;
  riskScore: number; // 0 - 100
  threatReason: string;
  firstSeen: string;
  lastSeen: string;
  pathHistogram: Array<{ path: string; count: number }>;
  statusCodeDistribution: {
    s2xx: number;
    s3xx: number;
    s4xx: number;
    s5xx: number;
  };
  assetRatio: number; // 0.0 - 1.0 (ratio of css/js/img to total)
  reqPerMinute: number;
  peakReqPerMinute?: number;
  loginPostCount: number;
  vulnerabilityProbeCount: number;
  spoofedBotDetected?: boolean;
  claimedBotName?: string | null;
  distributedCampaignMember?: boolean;
  accountTakeoverSuspected?: boolean;
  userAgentCount?: number;
  requestRegularityScore?: number;
  refererChainRatio?: number;
  sequentialCrawlDetected?: boolean;
  robotsTxtFetched?: boolean;
  honeypotTrapHits?: number;
  authAttackType?: "CREDENTIAL_STUFFING" | "BRUTE_FORCE";
  distinctTargetedUsers?: number;
  recommendedAction: "BLOCK" | "CHALLENGE_CAPTCHA" | "RATE_LIMIT" | "ALLOW";
}

export interface DistributedTrafficCampaign {
  id: string;
  type:
    | "DISTRIBUTED_CREDENTIAL_STUFFING"
    | "DISTRIBUTED_SCRAPER_BOTNET"
    | "COORDINATED_VULN_SCAN";
  targetPath: string;
  participatingIps: string[];
  totalRequests: number;
  failureRatePercent: number;
  successfulLoginsAfterFailure: number;
  sharedSignature: string;
  recommendedAction: string;
}

export interface TrafficOwnerSummary {
  wastedBandwidthBytes: number;
  wastedBandwidthFormatted: string;
  spoofedBotRequestsCount: number;
  distributedAttacksDetected: number;
  accountTakeoverAlerts: number;
  estimatedCleanAfterRulesPercent: number;
  prioritizedActions: Array<{
    priority: "IMMEDIATE" | "HIGH" | "MEDIUM";
    title: string;
    impact: string;
    rulePreview: string;
  }>;
}

export interface TrafficCleanReport {
  analyzedLines: number;
  uniqueIpsCount: number;
  trafficBreakdown: {
    humanCount: number;
    humanPercent: number;
    verifiedBotCount: number;
    verifiedBotPercent: number;
    aiCrawlerCount: number;
    aiCrawlerPercent: number;
    spoofedBotCount: number;
    spoofedBotPercent: number;
    scraperCount: number;
    scraperPercent: number;
    credentialStufferCount: number;
    credentialStufferPercent: number;
    vulnerabilityScannerCount: number;
    vulnerabilityScannerPercent: number;
    dosFlooderCount: number;
    dosFlooderPercent: number;
  };
  cleanVsMaliciousPercent: {
    cleanPercent: number;
    maliciousPercent: number;
  };
  topThreatIps: IpThreatProfile[];
  distributedCampaigns: DistributedTrafficCampaign[];
  ownerSummary: TrafficOwnerSummary;
  firewallRules: {
    nginxBlockRules: string;
    apacheHtaccessRules: string;
    cloudflareWafExpression: string;
    robotsTxtRules: string;
  };
  timeSeries: Array<{
    bucketLabel: string;
    cleanCount: number;
    maliciousCount: number;
    aiCrawlerCount: number;
  }>;
  recentSpikeAlerts: string[];
  sampleAttackSnippets: string[];
}

const COMMON_LOG_REGEX =
  /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+([^\s"]+)(?:\s+HTTP\/[\d.]+)?\"\s+(\d{3})\s+(\d+|-)\s*(?:"([^"]*)"\s*"([^"]*)")?/;

const KNOWN_GOOD_BOTS: Array<{
  pattern: RegExp;
  name: string;
  ipPrefixes: string[];
  asnTokens: string[];
}> = [
  {
    pattern: /Googlebot/i,
    name: "Googlebot",
    ipPrefixes: ["66.249.", "64.233.", "72.14.", "74.125.", "209.85.", "216.239."],
    asnTokens: ["google"],
  },
  {
    pattern: /bingbot/i,
    name: "Bingbot",
    ipPrefixes: ["40.77.", "157.55.", "207.46.", "65.55.", "13.66.", "52.167."],
    asnTokens: ["microsoft"],
  },
  {
    pattern: /DuckDuckBot/i,
    name: "DuckDuckBot",
    ipPrefixes: ["20.191.", "40.88.", "52.142.", "72.94."],
    asnTokens: ["duckduckgo"],
  },
  {
    pattern: /Baiduspider/i,
    name: "Baiduspider",
    ipPrefixes: ["116.179.", "123.125.", "180.76.", "220.181."],
    asnTokens: ["baidu"],
  },
  {
    pattern: /YandexBot/i,
    name: "YandexBot",
    ipPrefixes: [
      "5.45.",
      "5.255.",
      "37.9.",
      "77.88.",
      "87.250.",
      "93.158.",
      "95.108.",
      "141.8.",
      "178.154.",
      "213.180.",
    ],
    asnTokens: ["yandex"],
  },
  {
    pattern: /Applebot/i,
    name: "Applebot",
    ipPrefixes: ["17."],
    asnTokens: ["apple"],
  },
  {
    pattern: /facebookexternalhit/i,
    name: "FacebookBot",
    ipPrefixes: ["31.13.", "66.220.", "69.63.", "69.171.", "173.252."],
    asnTokens: ["facebook", "meta"],
  },
  {
    pattern: /Twitterbot/i,
    name: "Twitterbot",
    ipPrefixes: ["199.16.", "199.59."],
    asnTokens: ["twitter"],
  },
  {
    pattern: /LinkedInBot/i,
    name: "LinkedInBot",
    ipPrefixes: ["108.174.", "144.2."],
    asnTokens: ["linkedin"],
  },
];

const AI_CRAWLER_DEFINITIONS: Array<{
  pattern: RegExp;
  name: string;
  vendor: string;
}> = [
  { pattern: /GPTBot/i, name: "GPTBot", vendor: "OpenAI" },
  { pattern: /OAI-SearchBot/i, name: "OAI-SearchBot", vendor: "OpenAI" },
  { pattern: /ChatGPT-User/i, name: "ChatGPT-User", vendor: "OpenAI" },
  { pattern: /ClaudeBot/i, name: "ClaudeBot", vendor: "Anthropic" },
  { pattern: /Claude-Web/i, name: "Claude-Web", vendor: "Anthropic" },
  { pattern: /anthropic-ai/i, name: "anthropic-ai", vendor: "Anthropic" },
  { pattern: /CCBot/i, name: "CCBot", vendor: "CommonCrawl" },
  { pattern: /Bytespider/i, name: "Bytespider", vendor: "ByteDance" },
  { pattern: /PerplexityBot/i, name: "PerplexityBot", vendor: "Perplexity" },
  { pattern: /Google-Extended/i, name: "Google-Extended", vendor: "Google AI" },
  { pattern: /Applebot-Extended/i, name: "Applebot-Extended", vendor: "Apple AI" },
  { pattern: /Meta-ExternalAgent/i, name: "Meta-ExternalAgent", vendor: "Meta AI" },
  { pattern: /Amazonbot/i, name: "Amazonbot", vendor: "Amazon" },
  { pattern: /Diffbot/i, name: "Diffbot", vendor: "Diffbot" },
  { pattern: /Cohere-ai/i, name: "Cohere-ai", vendor: "Cohere" },
  { pattern: /AhrefsBot/i, name: "AhrefsBot", vendor: "Ahrefs SEO" },
  { pattern: /SemrushBot/i, name: "SemrushBot", vendor: "Semrush SEO" },
  { pattern: /MJ12bot/i, name: "MJ12bot", vendor: "Majestic SEO" },
];

const HONEYPOT_TRAP_PATTERN =
  /\/(honeypot-trap|admin-trap|bot-trap)|[?&]shield_trap=/i;

const KNOWN_SUSPICIOUS_UA_PATTERNS = [
  /python-requests/i,
  /Python-urllib/i,
  /Scrapy/i,
  /curl\//i,
  /Wget\//i,
  /Go-http-client/i,
  /aiohttp/i,
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
  /HeadlessChrome/i,
  /PhantomJS/i,
  /PostmanRuntime/i,
  /Hydra/i,
];

const AUTH_LOGIN_PATHS = [
  "/wp-login.php",
  "/xmlrpc.php",
  "/wp-json/jwt-auth/v1/token",
  "/api/login",
  "/api/auth/login",
  "/administrator/index.php",
  "/admin/login",
  "/user/login",
];

const VULNERABILITY_PROBE_PATTERNS = [
  /\/\.env/i,
  /\/wp-config\.php/i,
  /\/\.git/i,
  /\/phpmyadmin/i,
  /\/pma/i,
  /\/actuator/i,
  /\/\.aws/i,
  /\/eval-stdin\.php/i,
  /\/\.\.\//, // path traversal
  /\.bak$/i,
  /\.sql$/i,
  /\.tar\.gz$/i,
  /\/solr\//i,
  /\/autodiscover/i,
  // SQLi patterns
  /union(?:[\s+]|%20)+select/i,
  /(%27|')(?:[\s+]|%20)*or(?:[\s+]|%20)*1(?:=|%3d)1/i,
  /information_schema/i,
  /sleep\(\d+\)/i,
  // XSS patterns
  /<script/i,
  /%3cscript/i,
  /javascript:/i,
  /onerror=/i,
  // WordPress enumeration, phpunit & Log4j
  /[?&]author=\d+/i,
  /\/wp-json\/wp\/v2\/users/i,
  /\/vendor\/phpunit/i,
  /\$\{jndi:/i,
];

const STATIC_ASSET_EXTENSIONS =
  /\.(css|js|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|ico|map)$/i;

function extractSubnet24(ip: string): string {
  if (!ip || ip === "unknown") return "unknown/24";
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (ip.includes(":")) {
    return ip.split(":").slice(0, 4).join(":") + "::/64";
  }
  return ip;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return idx === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[idx]}`;
}

const ALLOWED_BOT_DNS_SUFFIXES: Record<string, string[]> = {
  googlebot: [".googlebot.com", ".google.com", ".googleusercontent.com"],
  bingbot: [".search.msn.com"],
  duckduckbot: [".duckduckgo.com"],
  baiduspider: [".baidu.com", ".baidu.jp"],
  yandexbot: [".yandex.com", ".yandex.ru", ".yandex.net"],
  applebot: [".applebot.apple.com"],
  facebookbot: [".fbsv.net", ".facebook.com"],
  twitterbot: [".twttr.com"],
  linkedinbot: [".linkedin.com"],
};

/**
 * Verifies whether a claimed search engine crawler IP matches its published CIDR prefixes
 * or authoritative ASN (FCrDNS / network range verification).
 */
export function verifyGoodBotOrigin(
  ipAddress: string,
  botName: string,
  asnLabel: string
): boolean {
  const botDef = KNOWN_GOOD_BOTS.find(
    (b) => b.name.toLowerCase() === botName.toLowerCase()
  );
  if (!botDef) return false;

  if (botDef.ipPrefixes.some((prefix) => ipAddress.startsWith(prefix))) {
    return true;
  }

  const lowerAsn = asnLabel.toLowerCase();
  if (botDef.asnTokens.some((token) => lowerAsn.includes(token))) {
    return true;
  }

  return false;
}

/**
 * Performs live Forward-Confirmed Reverse DNS (FCrDNS) verification for claimed
 * search engine crawlers with automatic fallback to CIDR/ASN range verification.
 */
export async function verifyGoodBotFcrDns(
  ipAddress: string,
  botName: string,
  asnLabel = ""
): Promise<{ verified: boolean; method: "fcrdns" | "cidr_asn"; hostname?: string }> {
  const allowedSuffixes = ALLOWED_BOT_DNS_SUFFIXES[botName.toLowerCase()] || [];
  if (allowedSuffixes.length > 0 && ipAddress && ipAddress !== "unknown") {
    try {
      const timeout = new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error("dns_timeout")), 1500)
      );
      const hostnames = await Promise.race([dnsReverse(ipAddress), timeout]);
      for (const host of hostnames) {
        const lower = host.toLowerCase().replace(/\.$/, "");
        if (allowedSuffixes.some((suf) => lower.endsWith(suf))) {
          const resolvedIps = await Promise.race([dnsResolve4(host), timeout]).catch(
            () => [] as string[]
          );
          if (resolvedIps.includes(ipAddress)) {
            return { verified: true, method: "fcrdns", hostname: host };
          }
        }
      }
    } catch {
      // Offline / DNS unavailable -> fall through to CIDR/ASN check
    }
  }
  return {
    verified: verifyGoodBotOrigin(ipAddress, botName, asnLabel),
    method: "cidr_asn",
  };
}

function computeRequestRegularityScore(sortedLogs: ParsedLogEntry[]): number {
  if (sortedLogs.length < 4) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < sortedLogs.length; i++) {
    const dt = sortedLogs[i]!.timestamp.getTime() - sortedLogs[i - 1]!.timestamp.getTime();
    intervals.push(Math.max(10, dt));
  }
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean <= 0) return 0;
  const variance =
    intervals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / intervals.length;
  const cv = Math.sqrt(variance) / mean;
  return cv < 0.2 ? 95 : cv < 0.4 ? 80 : cv < 0.7 ? 50 : 20;
}

function detectSequentialCrawl(logs: ParsedLogEntry[]): boolean {
  const nums: number[] = [];
  for (const l of logs) {
    if (STATIC_ASSET_EXTENSIONS.test(l.path)) continue;
    const m = l.path.match(/(?:\/|page=|id=|item-)(\d+)(?:\/|$|\?|&)/i);
    if (m && m[1]) {
      const val = parseInt(m[1], 10);
      if (Number.isFinite(val)) nums.push(val);
    }
  }
  if (nums.length < 3) return false;
  const uniqueSorted = Array.from(new Set(nums)).sort((a, b) => a - b);
  let consecutive = 1;
  for (let i = 1; i < uniqueSorted.length; i++) {
    if (uniqueSorted[i]! === uniqueSorted[i - 1]! + 1) {
      consecutive++;
      if (consecutive >= 3) return true;
    } else {
      consecutive = 1;
    }
  }
  return false;
}

function extractUsernameHint(path: string): string | undefined {
  const m = path.match(/[?&](?:user|username|log|email)=([^&\s"]+)/i);
  if (!m || !m[1]) return undefined;
  try {
    return decodeURIComponent(m[1]).trim().toLowerCase() || undefined;
  } catch {
    return m[1].trim().toLowerCase() || undefined;
  }
}

function computePeakReqPerMinute(sortedLogs: ParsedLogEntry[]): number {
  if (sortedLogs.length === 0) return 0;
  let maxInWindow = 1;
  let left = 0;
  for (let right = 0; right < sortedLogs.length; right++) {
    const rightTs = sortedLogs[right]!.timestamp.getTime();
    while (rightTs - sortedLogs[left]!.timestamp.getTime() > 60_000) {
      left++;
    }
    const windowCount = right - left + 1;
    if (windowCount > maxInWindow) maxInWindow = windowCount;
  }
  return maxInWindow;
}

function isIpAllowlisted(ip: string, options?: TrafficCleanOptions): boolean {
  if (!options) return false;
  if (options.allowlistIps?.includes(ip)) return true;
  if (options.allowlistSubnets && options.allowlistSubnets.length > 0) {
    const subnet24 = extractSubnet24(ip);
    for (const subnet of options.allowlistSubnets) {
      if (subnet === subnet24 || ip.startsWith(subnet.replace(/\.0\/\d+$/, "."))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Parses raw Nginx / Apache / Caddy Combined Log format string or JSON lines.
 */
export function parseLogLine(line: string): ParsedLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  // Try JSON format
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed);
      const ip = obj.client_ip || obj.remote_addr || obj.ip || "unknown";
      const ts = obj.timestamp ? new Date(obj.timestamp) : new Date();
      const rawPath = String(obj.path || obj.request_uri || obj.uri || "/");
      const rawUser = obj.username || obj.user || obj.login || extractUsernameHint(rawPath);
      return {
        ipAddress: String(ip),
        timestamp: ts,
        method: String(obj.method || obj.request_method || "GET").toUpperCase(),
        path: rawPath,
        statusCode: Number(obj.status || obj.status_code || 200),
        bytesSent: Number(obj.body_bytes_sent || obj.bytes_sent || 0),
        referer: String(obj.http_referer || obj.referer || "-"),
        userAgent: String(obj.http_user_agent || obj.user_agent || "-"),
        ...(rawUser ? { username: String(rawUser).trim().toLowerCase() } : {}),
      };
    } catch {
      // fallback to regex
    }
  }

  // Combined Log Format regex
  const match = trimmed.match(COMMON_LOG_REGEX);
  if (!match) return null;

  const ip = match[1]!;
  const rawDate = match[2]!;
  const method = match[3]!.toUpperCase();
  const path = match[4]!;
  const statusCode = parseInt(match[5]!, 10);
  const bytesSent = match[6] === "-" ? 0 : parseInt(match[6]!, 10);
  const referer = match[7] || "-";
  const userAgent = match[8] || "-";
  const username = extractUsernameHint(path);

  let timestamp = new Date();
  try {
    // Convert '14/Nov/2026:22:15:30 +0000'
    const parts = rawDate.match(/^(\d+)\/(\w+)\/(\d+):(\d+:\d+:\d+)\s+([+-]\d+)/);
    if (parts) {
      timestamp = new Date(`${parts[2]} ${parts[1]}, ${parts[3]} ${parts[4]} ${parts[5]}`);
    }
  } catch {
    timestamp = new Date();
  }

  return {
    ipAddress: ip,
    timestamp,
    method,
    path,
    statusCode,
    bytesSent,
    referer,
    userAgent,
    ...(username ? { username } : {}),
  };
}

/**
 * Analyzes web-server access logs to separate malicious bots, spoofed crawlers,
 * distributed credential-stuffing campaigns, and scrapers from real visitors.
 */
export function cleanTrafficLogs(
  logContent: string,
  options?: TrafficCleanOptions
): TrafficCleanReport {
  const lines = logContent.split(/\r?\n/);
  const entries: ParsedLogEntry[] = [];

  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (parsed) entries.push(parsed);
  }

  if (entries.length === 0) {
    return {
      analyzedLines: 0,
      uniqueIpsCount: 0,
      trafficBreakdown: {
        humanCount: 0,
        humanPercent: 0,
        verifiedBotCount: 0,
        verifiedBotPercent: 0,
        aiCrawlerCount: 0,
        aiCrawlerPercent: 0,
        spoofedBotCount: 0,
        spoofedBotPercent: 0,
        scraperCount: 0,
        scraperPercent: 0,
        credentialStufferCount: 0,
        credentialStufferPercent: 0,
        vulnerabilityScannerCount: 0,
        vulnerabilityScannerPercent: 0,
        dosFlooderCount: 0,
        dosFlooderPercent: 0,
      },
      cleanVsMaliciousPercent: {
        cleanPercent: 100,
        maliciousPercent: 0,
      },
      topThreatIps: [],
      distributedCampaigns: [],
      ownerSummary: {
        wastedBandwidthBytes: 0,
        wastedBandwidthFormatted: "0 B",
        spoofedBotRequestsCount: 0,
        distributedAttacksDetected: 0,
        accountTakeoverAlerts: 0,
        estimatedCleanAfterRulesPercent: 100,
        prioritizedActions: [],
      },
      firewallRules: {
        nginxBlockRules: "# No high-risk traffic detected.",
        apacheHtaccessRules: "# No high-risk traffic detected.",
        cloudflareWafExpression: "",
        robotsTxtRules: [
          "# Truthier AI & Scraper Robots Exclusion Policy",
          "User-agent: GPTBot",
          "Disallow: /",
          "User-agent: ClaudeBot",
          "Disallow: /",
          "User-agent: CCBot",
          "Disallow: /",
          "User-agent: Bytespider",
          "Disallow: /",
          "User-agent: Google-Extended",
          "Disallow: /",
        ].join("\n"),
      },
      timeSeries: [],
      recentSpikeAlerts: [],
      sampleAttackSnippets: [],
    };
  }

  const sensitivity = options?.sensitivity || "medium";
  const thresholdFactor =
    sensitivity === "high" ? 0.7 : sensitivity === "low" ? 1.4 : 1.0;

  const vulnThreshold = Math.max(1, Math.round(2 * thresholdFactor));
  const loginPostThreshold = Math.max(2, Math.round(3 * thresholdFactor));
  const dosRpmThreshold = Math.round(60 * thresholdFactor);
  const dosTotalThreshold = Math.round(200 * thresholdFactor);
  const scraperMinHits = Math.max(4, Math.round(8 * thresholdFactor));

  // Group by IP Address
  const ipGroups = new Map<string, ParsedLogEntry[]>();
  for (const e of entries) {
    const list = ipGroups.get(e.ipAddress) || [];
    list.push(e);
    ipGroups.set(e.ipAddress, list);
  }

  // Precompute per-IP asset ratios to help separate real human Chrome browsers from distributed scraper botnets
  const ipAssetRatioMap = new Map<string, number>();
  for (const [ip, logs] of ipGroups.entries()) {
    const assetCount = logs.filter((l) => STATIC_ASSET_EXTENSIONS.test(l.path)).length;
    ipAssetRatioMap.set(ip, assetCount / logs.length);
  }

  // -------------------------------------------------------------------------
  // Cross-IP Distributed Campaign Pass
  // -------------------------------------------------------------------------
  const distributedCampaigns: DistributedTrafficCampaign[] = [];
  const distributedStufferIps = new Set<string>();
  const distributedScraperIps = new Set<string>();
  const distributedScannerIps = new Set<string>();
  const sampleAttackSnippets: string[] = [];

  // 1. Distributed Credential Stuffing (multiple low-volume IPs targeting the same login endpoint)
  const loginByPath = new Map<string, ParsedLogEntry[]>();
  for (const e of entries) {
    if (
      e.method === "POST" &&
      AUTH_LOGIN_PATHS.some((p) => e.path.toLowerCase().startsWith(p)) &&
      !isIpAllowlisted(e.ipAddress, options)
    ) {
      const normalizedPath = e.path.toLowerCase().split("?")[0] || e.path.toLowerCase();
      const list = loginByPath.get(normalizedPath) || [];
      list.push(e);
      loginByPath.set(normalizedPath, list);
    }
  }

  for (const [targetPath, hits] of loginByPath.entries()) {
    const sorted = [...hits].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    // Find densest 15-minute window
    let bestSlice: ParsedLogEntry[] = sorted;
    if (sorted.length > 0) {
      let left = 0;
      let bestLen = 0;
      for (let right = 0; right < sorted.length; right++) {
        while (
          sorted[right]!.timestamp.getTime() - sorted[left]!.timestamp.getTime() >
          900_000
        ) {
          left++;
        }
        const curSlice = sorted.slice(left, right + 1);
        const curIps = new Set(curSlice.map((s) => s.ipAddress));
        if (curIps.size >= 3 && curSlice.length > bestLen) {
          bestLen = curSlice.length;
          bestSlice = curSlice;
        }
      }
    }

    const distinctIps = Array.from(new Set(bestSlice.map((h) => h.ipAddress)));
    const failedCount = bestSlice.filter((h) => h.statusCode >= 400).length;
    const failureRate = bestSlice.length > 0 ? failedCount / bestSlice.length : 0;

    if (distinctIps.length >= 3 && (failureRate >= 0.5 || bestSlice.length >= 5)) {
      let successfulAfterFailure = 0;
      const seenFailure = new Set<string>();
      for (const h of sorted) {
        if (h.statusCode >= 400) seenFailure.add(h.ipAddress);
        else if ((h.statusCode === 200 || h.statusCode === 302) && seenFailure.has(h.ipAddress)) {
          successfulAfterFailure++;
        }
      }

      for (const ip of distinctIps) {
        distributedStufferIps.add(ip);
      }

      const idHash = createHash("sha256")
        .update(`stuffing|${targetPath}|${distinctIps.join(",")}`)
        .digest("hex")
        .slice(0, 8);

      distributedCampaigns.push({
        id: `camp_${idHash}`,
        type: "DISTRIBUTED_CREDENTIAL_STUFFING",
        targetPath,
        participatingIps: distinctIps,
        totalRequests: bestSlice.length,
        failureRatePercent: Number((failureRate * 100).toFixed(1)),
        successfulLoginsAfterFailure: successfulAfterFailure,
        sharedSignature: `${distinctIps.length} IPs targeting POST ${targetPath}`,
        recommendedAction: `Block ${distinctIps.length} distributed IPs and rate-limit POST ${targetPath} in WAF.`,
      });

      if (sampleAttackSnippets.length < 8) {
        sampleAttackSnippets.push(
          `[Distributed Credential Stuffing] ${distinctIps.length} IPs -> POST ${targetPath} (${Math.round(failureRate * 100)}% failed auth)`
        );
      }
    }
  }

  // 2. Distributed Scraper Botnet (3+ IPs with low asset ratio sharing exact UA or path pattern)
  const scraperCandidates = new Map<string, ParsedLogEntry[]>();
  for (const e of entries) {
    if (
      e.method === "GET" &&
      !STATIC_ASSET_EXTENSIONS.test(e.path) &&
      !VULNERABILITY_PROBE_PATTERNS.some((p) => p.test(e.path)) &&
      !isIpAllowlisted(e.ipAddress, options)
    ) {
      const matchedGoodBot = KNOWN_GOOD_BOTS.find((b) => b.pattern.test(e.userAgent));
      if (
        matchedGoodBot &&
        verifyGoodBotOrigin(
          e.ipAddress,
          matchedGoodBot.name,
          resolveOriginGeo({
            ipAddress: e.ipAddress,
            authorSessionHash: `traffic_${e.ipAddress}`,
            wpCommentId: 0,
            authorType: "bot",
          }).asnLabel
        )
      ) {
        continue;
      }
      if (AI_CRAWLER_DEFINITIONS.some((a) => a.pattern.test(e.userAgent))) {
        continue;
      }
      const ipAssetRatio = ipAssetRatioMap.get(e.ipAddress) ?? 1;
      const isSuspiciousUa = KNOWN_SUSPICIOUS_UA_PATTERNS.some((p) => p.test(e.userAgent));
      if (ipAssetRatio < 0.08 || isSuspiciousUa) {
        const pathPrefix = "/" + (e.path.split("/").filter(Boolean)[0] || "");
        const sigKey = `${e.userAgent}|${pathPrefix}`;
        const list = scraperCandidates.get(sigKey) || [];
        list.push(e);
        scraperCandidates.set(sigKey, list);
      }
    }
  }

  for (const [sigKey, hits] of scraperCandidates.entries()) {
    const distinctIps = Array.from(new Set(hits.map((h) => h.ipAddress)));
    if (distinctIps.length >= 3 && hits.length >= 12) {
      for (const ip of distinctIps) distributedScraperIps.add(ip);
      const [ua, pathPrefix] = sigKey.split("|");
      const idHash = createHash("sha256")
        .update(`scraper|${sigKey}|${distinctIps.join(",")}`)
        .digest("hex")
        .slice(0, 8);

      distributedCampaigns.push({
        id: `camp_${idHash}`,
        type: "DISTRIBUTED_SCRAPER_BOTNET",
        targetPath: pathPrefix || "/",
        participatingIps: distinctIps,
        totalRequests: hits.length,
        failureRatePercent: Number(
          ((hits.filter((h) => h.statusCode >= 400).length / hits.length) * 100).toFixed(1)
        ),
        successfulLoginsAfterFailure: 0,
        sharedSignature: `Shared UA "${(ua || "unknown").slice(0, 36)}" on ${pathPrefix || "/"}`,
        recommendedAction: `Enforce JS challenge / rate-limit across ${distinctIps.length} scraper botnet IPs.`,
      });
    }
  }

  // 3. Coordinated Vulnerability Scan across multiple IPs
  const vulnHits = entries.filter(
    (e) =>
      VULNERABILITY_PROBE_PATTERNS.some((p) => p.test(e.path)) &&
      !isIpAllowlisted(e.ipAddress, options)
  );
  const vulnIps = Array.from(new Set(vulnHits.map((v) => v.ipAddress)));
  if (vulnIps.length >= 3 && vulnHits.length >= 6) {
    for (const ip of vulnIps) distributedScannerIps.add(ip);
    const idHash = createHash("sha256")
      .update(`vulnscan|${vulnIps.join(",")}`)
      .digest("hex")
      .slice(0, 8);
    distributedCampaigns.push({
      id: `camp_${idHash}`,
      type: "COORDINATED_VULN_SCAN",
      targetPath: "/* (.env, wp-config, SQLi/XSS)",
      participatingIps: vulnIps,
      totalRequests: vulnHits.length,
      failureRatePercent: Number(
        ((vulnHits.filter((h) => h.statusCode >= 400).length / vulnHits.length) * 100).toFixed(1)
      ),
      successfulLoginsAfterFailure: 0,
      sharedSignature: `${vulnIps.length} IPs probing sensitive/exploit paths`,
      recommendedAction: `Block all ${vulnIps.length} scanning IPs at edge firewall.`,
    });
  }

  // -------------------------------------------------------------------------
  // Per-IP Classification
  // -------------------------------------------------------------------------
  const aiCrawlerPolicy = options?.aiCrawlerPolicy ?? "block";
  const profiles: IpThreatProfile[] = [];
  const ipCategoryMap = new Map<string, TrafficCategory>();

  let humanCount = 0;
  let verifiedBotCount = 0;
  let aiCrawlerCount = 0;
  let spoofedBotCount = 0;
  let scraperCount = 0;
  let credentialStufferCount = 0;
  let vulnerabilityScannerCount = 0;
  let dosFlooderCount = 0;
  let wastedBandwidthBytes = 0;
  let accountTakeoverAlerts = 0;

  for (const [ip, logs] of ipGroups.entries()) {
    logs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const firstSeen = logs[0]!.timestamp;
    const lastSeen = logs[logs.length - 1]!.timestamp;
    const timeDeltaMinutes = Math.max(0.1, (lastSeen.getTime() - firstSeen.getTime()) / 60000);
    const reqPerMinute = Number((logs.length / timeDeltaMinutes).toFixed(1));
    const peakReqPerMinute = computePeakReqPerMinute(logs);

    // Resolve IP Geo & ASN
    const geo = resolveOriginGeo({ ipAddress: ip });

    // Path analysis, status codes, ATO & behavioral tracking
    const pathCounts = new Map<string, number>();
    let s2xx = 0;
    let s3xx = 0;
    let s4xx = 0;
    let s5xx = 0;
    let assetCount = 0;
    let loginPosts = 0;
    let failedLoginPosts = 0;
    let atoDetected = false;
    let vulnProbes = 0;
    let totalBytes = 0;
    let honeypotTrapHits = 0;
    let robotsTxtFetched = false;
    let refererHits = 0;
    const targetedUsernames = new Set<string>();
    const userAgents = new Set<string>();

    for (const l of logs) {
      pathCounts.set(l.path, (pathCounts.get(l.path) || 0) + 1);
      totalBytes += Math.max(0, l.bytesSent || 0);

      if (l.statusCode >= 200 && l.statusCode < 300) s2xx++;
      else if (l.statusCode >= 300 && l.statusCode < 400) s3xx++;
      else if (l.statusCode >= 400 && l.statusCode < 500) s4xx++;
      else if (l.statusCode >= 500) s5xx++;

      if (STATIC_ASSET_EXTENSIONS.test(l.path)) assetCount++;
      if (l.userAgent && l.userAgent !== "-") userAgents.add(l.userAgent);
      if (l.referer && l.referer !== "-") refererHits++;
      if (l.username) targetedUsernames.add(l.username);
      if (/^\/robots\.txt(?:\?|$)/i.test(l.path)) robotsTxtFetched = true;

      if (HONEYPOT_TRAP_PATTERN.test(l.path)) {
        honeypotTrapHits++;
        if (sampleAttackSnippets.length < 10) {
          sampleAttackSnippets.push(
            `[Honeypot Trap Triggered] ${ip} - ${l.method} ${l.path} (${l.statusCode})`
          );
        }
      }

      // Credential stuffing & ATO checks
      if (
        l.method === "POST" &&
        AUTH_LOGIN_PATHS.some((p) => l.path.toLowerCase().startsWith(p))
      ) {
        loginPosts++;
        if (l.statusCode >= 400) {
          failedLoginPosts++;
        } else if (
          (l.statusCode === 200 || l.statusCode === 302) &&
          failedLoginPosts >= 2
        ) {
          atoDetected = true;
          if (sampleAttackSnippets.length < 10) {
            sampleAttackSnippets.push(
              `[Account Takeover Alert] ${ip} - ${failedLoginPosts} failed logins followed by HTTP ${l.statusCode} on ${l.path}`
            );
          }
        }
        if (sampleAttackSnippets.length < 8) {
          sampleAttackSnippets.push(
            `[Credential Stuffing] ${ip} - POST ${l.path} (${l.statusCode})`
          );
        }
      }

      // Vulnerability probe checks
      if (VULNERABILITY_PROBE_PATTERNS.some((p) => p.test(l.path))) {
        vulnProbes++;
        if (sampleAttackSnippets.length < 8) {
          sampleAttackSnippets.push(
            `[Vulnerability Probe] ${ip} - ${l.method} ${l.path} (${l.statusCode})`
          );
        }
      }
    }

    const assetRatio = Number((assetCount / logs.length).toFixed(2));
    const refererChainRatio = Number((refererHits / logs.length).toFixed(2));
    const requestRegularityScore = computeRequestRegularityScore(logs);
    const sequentialCrawlDetected = detectSequentialCrawl(logs);
    const representativeUa = logs[0]!.userAgent;
    const uaRotationDetected = userAgents.size >= 3;

    // Check for Good Bot UA claim across all seen UAs for this IP
    let matchedGoodBot: (typeof KNOWN_GOOD_BOTS)[number] | undefined;
    for (const ua of [representativeUa, ...Array.from(userAgents)]) {
      matchedGoodBot = KNOWN_GOOD_BOTS.find((b) => b.pattern.test(ua));
      if (matchedGoodBot) break;
    }

    // Check for AI / SEO Crawler UA across all seen UAs for this IP
    let matchedAiCrawler: (typeof AI_CRAWLER_DEFINITIONS)[number] | undefined;
    for (const ua of [representativeUa, ...Array.from(userAgents)]) {
      matchedAiCrawler = AI_CRAWLER_DEFINITIONS.find((a) => a.pattern.test(ua));
      if (matchedAiCrawler) break;
    }

    const isVerifiedGoodBotOrigin = matchedGoodBot
      ? verifyGoodBotOrigin(ip, matchedGoodBot.name, geo.asnLabel)
      : false;

    const isSuspiciousUa = Array.from(userAgents).some((ua) =>
      KNOWN_SUSPICIOUS_UA_PATTERNS.some((p) => p.test(ua))
    );

    const isAllowlisted = isIpAllowlisted(ip, options);
    const isDistributedMember =
      distributedStufferIps.has(ip) ||
      distributedScraperIps.has(ip) ||
      distributedScannerIps.has(ip);

    // Categorization logic
    let category: TrafficCategory = "HUMAN_VISITOR";
    let riskScore = 0;
    let threatReason = "Normal visitor traffic patterns";
    let recommendedAction: IpThreatProfile["recommendedAction"] = "ALLOW";
    let spoofedBotDetected = false;
    let authAttackType: IpThreatProfile["authAttackType"];

    if (isAllowlisted) {
      category = "HUMAN_VISITOR";
      riskScore = 0;
      threatReason = "Allowlisted trusted IP / subnet";
      recommendedAction = "ALLOW";
      humanCount += logs.length;
    } else if (
      matchedGoodBot &&
      isVerifiedGoodBotOrigin &&
      vulnProbes === 0 &&
      loginPosts === 0
    ) {
      category = "VERIFIED_BOT";
      riskScore = 5;
      threatReason = `Verified ${matchedGoodBot.name} crawler (${geo.asnLabel})`;
      recommendedAction = "ALLOW";
      verifiedBotCount += logs.length;
    } else if (matchedGoodBot && !isVerifiedGoodBotOrigin) {
      category = "SPOOFED_BOT";
      spoofedBotDetected = true;
      riskScore = 92;
      threatReason = `Spoofed ${matchedGoodBot.name} User-Agent from unauthorized network (${geo.asnLabel})`;
      recommendedAction = "BLOCK";
      spoofedBotCount += logs.length;
      if (sampleAttackSnippets.length < 10) {
        sampleAttackSnippets.push(
          `[Spoofed Crawler] ${ip} claimed ${matchedGoodBot.name} from ${geo.asnLabel}`
        );
      }
    } else if (
      vulnProbes >= vulnThreshold ||
      (vulnProbes >= 1 && s4xx >= vulnThreshold) ||
      (distributedScannerIps.has(ip) && vulnProbes >= 1)
    ) {
      category = "VULNERABILITY_SCANNER";
      riskScore = 95;
      threatReason = `Probed ${vulnProbes} sensitive/exploit paths (.env, wp-config, SQLi/XSS, or user enum)`;
      recommendedAction = "BLOCK";
      vulnerabilityScannerCount += logs.length;
    } else if (
      atoDetected ||
      loginPosts >= loginPostThreshold ||
      (distributedStufferIps.has(ip) && loginPosts >= 1) ||
      (loginPosts >= 1 && s4xx / logs.length > 0.6)
    ) {
      category = "CREDENTIAL_STUFFER";
      authAttackType =
        targetedUsernames.size >= 2 || distributedStufferIps.has(ip)
          ? "CREDENTIAL_STUFFING"
          : "BRUTE_FORCE";
      riskScore = atoDetected ? 98 : distributedStufferIps.has(ip) ? 92 : 90;
      const modeLabel =
        authAttackType === "CREDENTIAL_STUFFING"
          ? `Credential stuffing across ${Math.max(1, targetedUsernames.size)} account(s)`
          : `Single-target brute force (${Math.max(1, targetedUsernames.size)} account)`;
      threatReason = atoDetected
        ? `Account takeover suspected (${modeLabel}): ${failedLoginPosts} failed auth POSTs followed by successful login`
        : distributedStufferIps.has(ip)
          ? `Distributed ${modeLabel.toLowerCase()} (${loginPosts} auth POSTs, ${s4xx} failed)`
          : `${modeLabel} (${loginPosts} attempts, ${s4xx} failed auth responses)`;
      recommendedAction = "BLOCK";
      credentialStufferCount += logs.length;
    } else if (
      reqPerMinute > dosRpmThreshold ||
      peakReqPerMinute > dosRpmThreshold ||
      logs.length > dosTotalThreshold
    ) {
      category = "DOS_FLOODER";
      riskScore = 85;
      threatReason = `Abnormally high request velocity (peak ${peakReqPerMinute} req/min, avg ${reqPerMinute} req/min, ${logs.length} hits)`;
      recommendedAction = "RATE_LIMIT";
      dosFlooderCount += logs.length;
    } else if (matchedAiCrawler) {
      category = "AI_CRAWLER";
      riskScore = aiCrawlerPolicy === "block" ? 65 : aiCrawlerPolicy === "challenge" ? 45 : 15;
      recommendedAction =
        aiCrawlerPolicy === "block"
          ? "BLOCK"
          : aiCrawlerPolicy === "challenge"
            ? "CHALLENGE_CAPTCHA"
            : "ALLOW";
      threatReason = `${matchedAiCrawler.name} (${matchedAiCrawler.vendor}) AI/SEO crawler (policy: ${aiCrawlerPolicy})`;
      aiCrawlerCount += logs.length;
    } else if (
      honeypotTrapHits > 0 ||
      isSuspiciousUa ||
      distributedScraperIps.has(ip) ||
      (sequentialCrawlDetected && assetRatio < 0.1) ||
      (requestRegularityScore >= 80 && assetRatio < 0.1 && logs.length >= 5) ||
      (assetRatio < 0.05 && logs.length >= scraperMinHits && s4xx <= 2) ||
      (uaRotationDetected && assetRatio < 0.1 && logs.length >= 6)
    ) {
      category = "SCRAPER";
      riskScore = honeypotTrapHits > 0
        ? 88
        : uaRotationDetected
          ? 82
          : distributedScraperIps.has(ip)
            ? 80
            : 75;
      threatReason = honeypotTrapHits > 0
        ? `Triggered hidden honeypot trap (${honeypotTrapHits} hits) confirming automated crawler`
        : uaRotationDetected
          ? `Rotating ${userAgents.size} User-Agents with low asset ratio (${Math.round(assetRatio * 100)}%)`
          : sequentialCrawlDetected
            ? `Sequential page enumeration without browser assets (${Math.round(assetRatio * 100)}% assets)`
            : requestRegularityScore >= 80
              ? `Robotic request cadence (${requestRegularityScore}% regularity) with low assets (${Math.round(assetRatio * 100)}%)`
              : isSuspiciousUa
                ? `Headless or automated client UA (${representativeUa.slice(0, 30)})`
                : `Deep content harvesting with near-zero static assets (asset ratio: ${Math.round(assetRatio * 100)}%)`;
      recommendedAction = honeypotTrapHits > 0 ? "BLOCK" : "CHALLENGE_CAPTCHA";
      scraperCount += logs.length;
    } else {
      category = "HUMAN_VISITOR";
      riskScore = Math.min(25, Math.round((s4xx / logs.length) * 30));
      threatReason = "Real visitor with natural asset requests and humane browse pace";
      recommendedAction = "ALLOW";
      humanCount += logs.length;
    }

    ipCategoryMap.set(ip, category);

    if (atoDetected) accountTakeoverAlerts++;
    const isAllowedTraffic =
      category === "HUMAN_VISITOR" ||
      category === "VERIFIED_BOT" ||
      (category === "AI_CRAWLER" && aiCrawlerPolicy === "allow");
    if (!isAllowedTraffic) {
      wastedBandwidthBytes += totalBytes;
    }

    const pathHistogram = Array.from(pathCounts.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    profiles.push({
      ipAddress: ip,
      countryCode: geo.countryCode,
      countryName: geo.countryName,
      asnLabel: geo.asnLabel,
      networkType: geo.networkType,
      totalRequests: logs.length,
      category,
      riskScore,
      threatReason,
      firstSeen: firstSeen.toISOString(),
      lastSeen: lastSeen.toISOString(),
      pathHistogram,
      statusCodeDistribution: { s2xx, s3xx, s4xx, s5xx },
      assetRatio,
      reqPerMinute,
      peakReqPerMinute,
      loginPostCount: loginPosts,
      vulnerabilityProbeCount: vulnProbes,
      spoofedBotDetected,
      claimedBotName: matchedGoodBot
        ? matchedGoodBot.name
        : matchedAiCrawler
          ? matchedAiCrawler.name
          : null,
      distributedCampaignMember: isDistributedMember,
      accountTakeoverSuspected: atoDetected,
      userAgentCount: userAgents.size,
      requestRegularityScore,
      refererChainRatio,
      sequentialCrawlDetected,
      robotsTxtFetched,
      honeypotTrapHits,
      ...(authAttackType
        ? {
            authAttackType,
            distinctTargetedUsers: targetedUsernames.size,
          }
        : {}),
      recommendedAction,
    });
  }

  // Sort profiles by riskScore descending, then totalRequests descending
  profiles.sort((a, b) => b.riskScore - a.riskScore || b.totalRequests - a.totalRequests);

  const totalLines = entries.length;
  const aiCountAsMalicious = aiCrawlerPolicy === "allow" ? 0 : aiCrawlerCount;
  const aiCountAsClean = aiCrawlerPolicy === "allow" ? aiCrawlerCount : 0;
  const maliciousCount =
    aiCountAsMalicious +
    spoofedBotCount +
    scraperCount +
    credentialStufferCount +
    vulnerabilityScannerCount +
    dosFlooderCount;
  const cleanCount = humanCount + verifiedBotCount + aiCountAsClean;

  const cleanPercent =
    totalLines > 0 ? Number(((cleanCount / totalLines) * 100).toFixed(1)) : 100;
  const maliciousPercent =
    totalLines > 0 ? Number(((maliciousCount / totalLines) * 100).toFixed(1)) : 0;

  // Generate copyable firewall rules for site owners
  const blockIps = profiles
    .filter((p) => p.recommendedAction === "BLOCK")
    .map((p) => p.ipAddress);

  const challengeOrLimitHits = profiles
    .filter((p) => p.recommendedAction !== "ALLOW")
    .reduce((sum, p) => sum + p.totalRequests, 0);
  const remainingHits = Math.max(0, totalLines - challengeOrLimitHits);
  const estimatedCleanAfterRulesPercent =
    remainingHits > 0
      ? Math.min(100, Number(((cleanCount / remainingHits) * 100).toFixed(1)))
      : 100;

  const nginxBlockRules = [
    "# ==========================================================================",
    "# Truthier WAF: Automated Nginx Defense Configuration",
    `# Generated at: ${new Date().toISOString()}`,
    "# ==========================================================================",
    "",
    "# 1. Block credential stuffers, spoofed bots & vulnerability scanners",
    ...(blockIps.length > 0
      ? blockIps.map((ip) => `deny ${ip};`)
      : ["# No immediate IP blocks required."]),
    "",
    "# 2. Scoped rate-limiting on auth, API & catalogue paths (avoids throttling static assets)",
    "limit_req_zone $binary_remote_addr zone=truthier_scraper_limit:10m rate=5r/s;",
    "location ~* ^/(wp-login\\.php|xmlrpc\\.php|wp-json/|api/|catalogue/) {",
    "    limit_req zone=truthier_scraper_limit burst=10 nodelay;",
    "}",
    "# Note: Avoid blanket `location /` rate-limiting so CSS/JS/image asset bursts from real browsers stay fast.",
  ].join("\n");

  const apacheHtaccessRules = [
    "# ==========================================================================",
    "# Truthier WAF: Automated Apache .htaccess Block Rules",
    `# Generated at: ${new Date().toISOString()}`,
    "# ==========================================================================",
    "<RequireAll>",
    "  Require all granted",
    ...blockIps.map((ip) => `  Require not ip ${ip}`),
    "</RequireAll>",
  ].join("\n");

  const cloudflareWafExpression =
    blockIps.length > 0
      ? `(ip.src in {${blockIps.join(" ")}}) or (http.request.uri.path contains "wp-login.php" and cf.threat_score gt 15)`
      : `(http.request.uri.path contains "wp-login.php" and cf.threat_score gt 25)`;

  const detectedAiAgents = Array.from(
    new Set(
      profiles
        .filter((p) => p.category === "AI_CRAWLER" && p.claimedBotName)
        .map((p) => p.claimedBotName!)
    )
  );
  const robotsAgents = Array.from(
    new Set([
      ...detectedAiAgents,
      "GPTBot",
      "ClaudeBot",
      "CCBot",
      "Bytespider",
      "Google-Extended",
    ])
  );
  const robotsTxtRules = [
    "# ==========================================================================",
    "# Truthier AI & Scraper Robots Exclusion Rules",
    `# Generated at: ${new Date().toISOString()}`,
    `# Policy: ${aiCrawlerPolicy.toUpperCase()}`,
    "# ==========================================================================",
    ...(aiCrawlerPolicy === "allow"
      ? ["# AI crawlers currently allowed by policy.", "User-agent: *", "Allow: /"]
      : [
          ...robotsAgents.flatMap((agent) => [`User-agent: ${agent}`, "Disallow: /", ""]),
          "User-agent: *",
          "Disallow: /wp-admin/",
          "Disallow: /.env",
          "Disallow: /.git/",
        ]),
  ].join("\n");

  // Time-series breakdown (up to 8 buckets) & anomaly spike alerts
  const sortedEntries = [...entries].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  const minTs = sortedEntries[0]!.timestamp.getTime();
  const maxTs = sortedEntries[sortedEntries.length - 1]!.timestamp.getTime();
  const spanMs = Math.max(1, maxTs - minTs);
  const bucketCount =
    spanMs < 60_000 ? 1 : Math.min(8, Math.max(2, sortedEntries.length));
  const bucketSizeMs = spanMs / bucketCount;
  const includeDate = spanMs > 24 * 3600_000;

  const timeSeries = Array.from({ length: bucketCount }, (_, idx) => {
    const startMs = minTs + idx * bucketSizeMs;
    const iso = new Date(startMs).toISOString();
    return {
      bucketLabel: includeDate
        ? iso.slice(5, 16).replace("T", " ")
        : iso.slice(11, 16),
      cleanCount: 0,
      maliciousCount: 0,
      aiCrawlerCount: 0,
    };
  });

  for (const e of sortedEntries) {
    const cat = ipCategoryMap.get(e.ipAddress) || "HUMAN_VISITOR";
    const idx =
      bucketCount === 1
        ? 0
        : Math.min(
            bucketCount - 1,
            Math.floor(((e.timestamp.getTime() - minTs) / spanMs) * bucketCount)
          );
    const bucket = timeSeries[idx]!;
    if (cat === "HUMAN_VISITOR" || cat === "VERIFIED_BOT") {
      bucket.cleanCount++;
    } else if (cat === "AI_CRAWLER") {
      bucket.aiCrawlerCount++;
    } else {
      bucket.maliciousCount++;
    }
  }

  const recentSpikeAlerts: string[] = [];
  const totalMalSeries = timeSeries.reduce((s, b) => s + b.maliciousCount, 0);
  const avgMalPerBucket = totalMalSeries / timeSeries.length;
  for (const b of timeSeries) {
    if (
      b.maliciousCount >= 5 &&
      (timeSeries.length === 1
        ? b.maliciousCount >= 15
        : b.maliciousCount >= avgMalPerBucket * 1.6)
    ) {
      const mult =
        avgMalPerBucket > 0 ? (b.maliciousCount / avgMalPerBucket).toFixed(1) : "1.0";
      recentSpikeAlerts.push(
        `Spike at ${b.bucketLabel} UTC: ${b.maliciousCount} malicious requests (${mult}x window avg)`
      );
    }
  }

  // Prioritized Actionable Site-Owner Summary
  const prioritizedActions: TrafficOwnerSummary["prioritizedActions"] = [];
  if (accountTakeoverAlerts > 0) {
    prioritizedActions.push({
      priority: "IMMEDIATE",
      title: `Investigate ${accountTakeoverAlerts} suspected Account Takeover(s) & rotate passwords`,
      impact: "An IP succeeded in authenticating after repeated failed login attempts.",
      rulePreview: blockIps.slice(0, 3).map((ip) => `deny ${ip};`).join(" "),
    });
  }
  if (credentialStufferCount + vulnerabilityScannerCount > 0) {
    const severeCount = profiles.filter(
      (p) =>
        p.category === "CREDENTIAL_STUFFER" ||
        p.category === "VULNERABILITY_SCANNER"
    ).length;
    prioritizedActions.push({
      priority: "IMMEDIATE",
      title: `Block ${severeCount} credential-stuffing & exploit-probing IP(s)`,
      impact: `Stops ${credentialStufferCount + vulnerabilityScannerCount} brute-force and exploit requests immediately.`,
      rulePreview: blockIps.slice(0, 4).map((ip) => `deny ${ip};`).join(" "),
    });
  }
  if (spoofedBotCount > 0) {
    const spoofIps = profiles
      .filter((p) => p.category === "SPOOFED_BOT")
      .map((p) => p.ipAddress);
    prioritizedActions.push({
      priority: "HIGH",
      title: `Block ${spoofIps.length} spoofed crawler IP(s) impersonating Googlebot/Bingbot`,
      impact: `Prevents ${spoofedBotCount} unauthorized scraping/probing requests disguised as search engines.`,
      rulePreview: spoofIps.slice(0, 4).map((ip) => `deny ${ip};`).join(" "),
    });
  }
  if (aiCrawlerCount > 0 && aiCrawlerPolicy !== "allow") {
    prioritizedActions.push({
      priority: "MEDIUM",
      title: `Enforce ${aiCrawlerPolicy.toUpperCase()} policy on ${aiCrawlerCount} AI training crawler hits`,
      impact: `Controls automated model ingestion (${detectedAiAgents.slice(0, 3).join(", ") || "AI crawlers"}).`,
      rulePreview: "User-agent: GPTBot\\nDisallow: /",
    });
  }
  if (scraperCount + dosFlooderCount > 0) {
    prioritizedActions.push({
      priority: "MEDIUM",
      title: `Enforce rate limits & CAPTCHA challenges on ${scraperCount + dosFlooderCount} scraper/flood requests`,
      impact: `Reclaims ${formatBytes(wastedBandwidthBytes)} of malicious bandwidth without blocking verified crawlers.`,
      rulePreview: "limit_req zone=truthier_scraper_limit burst=10 nodelay;",
    });
  }

  return {
    analyzedLines: totalLines,
    uniqueIpsCount: ipGroups.size,
    trafficBreakdown: {
      humanCount,
      humanPercent: totalLines > 0 ? Number(((humanCount / totalLines) * 100).toFixed(1)) : 0,
      verifiedBotCount,
      verifiedBotPercent:
        totalLines > 0 ? Number(((verifiedBotCount / totalLines) * 100).toFixed(1)) : 0,
      aiCrawlerCount,
      aiCrawlerPercent:
        totalLines > 0 ? Number(((aiCrawlerCount / totalLines) * 100).toFixed(1)) : 0,
      spoofedBotCount,
      spoofedBotPercent:
        totalLines > 0 ? Number(((spoofedBotCount / totalLines) * 100).toFixed(1)) : 0,
      scraperCount,
      scraperPercent: totalLines > 0 ? Number(((scraperCount / totalLines) * 100).toFixed(1)) : 0,
      credentialStufferCount,
      credentialStufferPercent:
        totalLines > 0
          ? Number(((credentialStufferCount / totalLines) * 100).toFixed(1))
          : 0,
      vulnerabilityScannerCount,
      vulnerabilityScannerPercent:
        totalLines > 0
          ? Number(((vulnerabilityScannerCount / totalLines) * 100).toFixed(1))
          : 0,
      dosFlooderCount,
      dosFlooderPercent:
        totalLines > 0 ? Number(((dosFlooderCount / totalLines) * 100).toFixed(1)) : 0,
    },
    cleanVsMaliciousPercent: {
      cleanPercent,
      maliciousPercent,
    },
    topThreatIps: profiles.slice(0, 50),
    distributedCampaigns,
    ownerSummary: {
      wastedBandwidthBytes,
      wastedBandwidthFormatted: formatBytes(wastedBandwidthBytes),
      spoofedBotRequestsCount: spoofedBotCount,
      distributedAttacksDetected: distributedCampaigns.length,
      accountTakeoverAlerts,
      estimatedCleanAfterRulesPercent,
      prioritizedActions,
    },
    firewallRules: {
      nginxBlockRules,
      apacheHtaccessRules,
      cloudflareWafExpression,
      robotsTxtRules,
    },
    timeSeries,
    recentSpikeAlerts,
    sampleAttackSnippets,
  };
}

/**
 * Generates realistic web server access log samples (~1,130+ requests across
 * ~6 hours and 35+ unique IPs) modeled on a busy 5,000-daily-visitor web shop
 * with organic shoppers, verified bots, AI crawlers, spoofed bots, distributed
 * credential stuffing + ATO, sequential scrapers, and vulnerability scanners.
 */
export function generateRealisticTrafficLogs(): string {
  const now = new Date();
  const formatTime = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${pad(d.getUTCDate())}/${months[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
  };

  const lines: string[] = [];

  // 1. Real Human Shoppers (~720 requests across 18 residential IPs over 6 hours)
  const shopperIps = [
    "86.142.81.10", "86.142.81.11", "86.142.81.12", "86.142.81.13", "86.142.81.14", "86.142.81.15",
    "73.162.48.20", "73.162.48.21", "73.162.48.22", "73.162.48.23", "73.162.48.24", "73.162.48.25",
    "80.12.44.30", "80.12.44.31", "80.12.44.32", "80.12.44.33", "80.12.44.34", "80.12.44.35",
  ];
  const shopPages = [
    "/",
    "/shop",
    "/product/quantum-router",
    "/product/cloud-firewall",
    "/product/nvme-nas-8bay",
    "/product/poe-switch-24p",
    "/product/yubikey-fips-pack",
    "/blog/firmware-v4-2",
    "/cart",
    "/checkout",
  ];
  const humanUas = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  ];

  for (let s = 0; s < 180; s++) {
    const offsetMs = (180 - s) * 115_000 + (s % 5) * 3200; // spreads across ~5.8 hours
    const time = new Date(now.getTime() - offsetMs);
    const ip = shopperIps[s % shopperIps.length]!;
    const page = shopPages[s % shopPages.length]!;
    const ua = humanUas[s % humanUas.length]!;
    const ref = s % 3 === 0 ? "https://google.com/" : "https://shop.example.com/shop";

    lines.push(`${ip} - - [${formatTime(time)}] "GET ${page} HTTP/1.1" 200 6420 "${ref}" "${ua}"`);
    lines.push(`${ip} - - [${formatTime(new Date(time.getTime() + 180))}] "GET /assets/style.css HTTP/1.1" 200 14200 "https://shop.example.com${page}" "${ua}"`);
    lines.push(`${ip} - - [${formatTime(new Date(time.getTime() + 310))}] "GET /assets/bundle.js HTTP/1.1" 200 89400 "https://shop.example.com${page}" "${ua}"`);
    lines.push(`${ip} - - [${formatTime(new Date(time.getTime() + 470))}] "GET /images/product-hero.webp HTTP/1.1" 200 48600 "https://shop.example.com${page}" "${ua}"`);
  }

  // 2. Verified Search Engine Crawlers (~70 requests across Googlebot, Bingbot, Applebot)
  for (let i = 0; i < 40; i++) {
    const time = new Date(now.getTime() - (45 - i) * 420_000);
    const ip = `66.249.66.${1 + (i % 12)}`;
    const ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    const path = i % 10 === 0 ? "/robots.txt" : i % 10 === 1 ? "/sitemap.xml" : `/product/item-${i + 1}`;
    lines.push(`${ip} - - [${formatTime(time)}] "GET ${path} HTTP/1.1" 200 4120 "-" "${ua}"`);
  }
  for (let i = 0; i < 20; i++) {
    const time = new Date(now.getTime() - (30 - i) * 540_000);
    const ip = `40.77.167.${10 + (i % 6)}`;
    const ua = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
    const path = i % 8 === 0 ? "/sitemap.xml" : `/shop/category-${(i % 4) + 1}`;
    lines.push(`${ip} - - [${formatTime(time)}] "GET ${path} HTTP/1.1" 200 5340 "-" "${ua}"`);
  }
  for (let i = 0; i < 10; i++) {
    const time = new Date(now.getTime() - (20 - i) * 600_000);
    const ip = `17.58.98.${20 + (i % 3)}`;
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)";
    lines.push(`${ip} - - [${formatTime(time)}] "GET /product/quantum-router HTTP/1.1" 200 6200 "-" "${ua}"`);
  }

  // 3. AI & SEO Crawlers (~55 requests across GPTBot, ClaudeBot, PerplexityBot, Bytespider, CCBot)
  for (let i = 0; i < 16; i++) {
    const time = new Date(now.getTime() - (40 - i) * 310_000);
    lines.push(
      `20.171.207.15 - - [${formatTime(time)}] "GET /product/guide-${i + 1} HTTP/1.1" 200 11200 "-" "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot"`
    );
  }
  for (let i = 0; i < 12; i++) {
    const time = new Date(now.getTime() - (35 - i) * 340_000);
    lines.push(
      `160.79.104.22 - - [${formatTime(time)}] "GET /docs/architecture-${i + 1} HTTP/1.1" 200 9400 "-" "ClaudeBot/1.0; +claudebot@anthropic.com"`
    );
  }
  for (let i = 0; i < 10; i++) {
    const time = new Date(now.getTime() - (28 - i) * 380_000);
    lines.push(
      `44.221.18.40 - - [${formatTime(time)}] "GET /blog/specs-${i + 1} HTTP/1.1" 200 8800 "-" "PerplexityBot/1.0; +https://perplexity.ai/perplexitybot"`
    );
  }
  for (let i = 0; i < 10; i++) {
    const time = new Date(now.getTime() - (22 - i) * 290_000);
    lines.push(
      `47.246.29.12 - - [${formatTime(time)}] "GET /shop/specs-${i + 1} HTTP/1.1" 200 14200 "-" "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36; Bytespider"`
    );
  }
  for (let i = 0; i < 7; i++) {
    const time = new Date(now.getTime() - (18 - i) * 410_000);
    lines.push(
      `54.81.112.90 - - [${formatTime(time)}] "GET /catalogue/archive-${i + 1} HTTP/1.1" 200 10500 "-" "CCBot/2.0 (https://commoncrawl.org/faq/)"`
    );
  }

  // 4. Spoofed Crawlers (~24 requests impersonating Googlebot & Bingbot from Tor/datacenter IPs)
  for (let i = 0; i < 14; i++) {
    const time = new Date(now.getTime() - (25 - i) * 18_000);
    lines.push(
      `185.220.101.99 - - [${formatTime(time)}] "GET /pricing/enterprise-${i + 1} HTTP/1.1" 200 22400 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"`
    );
  }
  for (let i = 0; i < 10; i++) {
    const time = new Date(now.getTime() - (20 - i) * 22_000);
    lines.push(
      `45.155.205.88 - - [${formatTime(time)}] "GET /api/v1/export?page=${i + 1} HTTP/1.1" 200 19800 "-" "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"`
    );
  }

  // 5. Distributed Credential-Stuffing & Account Takeover Wave (~120 POSTs across 5 botnet IPs)
  const stufferIps = [
    "185.220.101.5",
    "185.220.101.19",
    "45.155.205.14",
    "91.132.147.88",
    "194.26.135.55",
  ];
  const stufferUsers = [
    "alice", "bob", "admin", "finance", "support",
    "ceo", "ops", "billing", "fulfillment", "dev",
  ];
  const stufferUa =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  for (let i = 0; i < 119; i++) {
    const time = new Date(now.getTime() - (125 - i) * 3800);
    const ip = stufferIps[i % stufferIps.length]!;
    const targetUser = stufferUsers[i % stufferUsers.length]!;
    const loginPath = i % 5 === 0 ? "/xmlrpc.php" : "/wp-login.php";
    lines.push(
      `${ip} - - [${formatTime(time)}] "POST ${loginPath}?user=${targetUser} HTTP/1.1" 401 1420 "https://shop.example.com/wp-login.php" "${stufferUa}"`
    );
  }
  // Account Takeover event: repeated 401s on 185.220.101.5 followed by a 302 authenticated redirect
  lines.push(
    `185.220.101.5 - - [${formatTime(new Date(now.getTime() - 2000))}] "POST /wp-login.php?user=finance HTTP/1.1" 302 980 "https://shop.example.com/wp-login.php" "${stufferUa}"`
  );

  // 6. Aggressive Catalogue Scrapers & Honeypot Trap Hits (~124 requests across 3 scraper nodes)
  for (let i = 0; i < 40; i++) {
    const time = new Date(now.getTime() - (85 - i) * 1400);
    lines.push(
      `104.244.76.13 - - [${formatTime(time)}] "GET /catalogue/page/${i + 1} HTTP/1.1" 200 11520 "-" "python-requests/2.31.0"`
    );
  }
  lines.push(
    `104.244.76.13 - - [${formatTime(new Date(now.getTime() - 18_000))}] "GET /honeypot-trap HTTP/1.1" 403 210 "-" "python-requests/2.31.0"`
  );

  for (let i = 0; i < 40; i++) {
    const time = new Date(now.getTime() - (70 - i) * 2000);
    const path = i === 0 ? "/robots.txt" : `/product/sku-${100 + i}`;
    lines.push(
      `198.51.100.42 - - [${formatTime(time)}] "GET ${path} HTTP/1.1" 200 9400 "-" "Scrapy/2.11.0 (+https://scrapy.org)"`
    );
  }
  for (let i = 0; i < 6; i++) {
    const time = new Date(now.getTime() - (36 - i) * 1700);
    lines.push(
      `198.51.100.42 - - [${formatTime(time)}] "GET /catalogue/page/${41 + i} HTTP/1.1" 200 11520 "-" "python-requests/2.31.0"`
    );
  }

  for (let i = 0; i < 30; i++) {
    const time = new Date(now.getTime() - (48 - i) * 2500);
    lines.push(
      `185.220.101.44 - - [${formatTime(time)}] "GET /shop/page/${i + 1} HTTP/1.1" 200 10800 "-" "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/122.0.0.0"`
    );
  }
  for (let i = 0; i < 6; i++) {
    const time = new Date(now.getTime() - (24 - i) * 1900);
    lines.push(
      `185.220.101.44 - - [${formatTime(time)}] "GET /catalogue/page/${47 + i} HTTP/1.1" 200 11520 "-" "python-requests/2.31.0"`
    );
  }
  lines.push(
    `185.220.101.44 - - [${formatTime(new Date(now.getTime() - 9000))}] "GET /?shield_trap=bot_probe HTTP/1.1" 403 195 "-" "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/122.0.0.0"`
  );

  // 7. Vulnerability & Exploit Scanners (~36 probes across 2 scanner IPs)
  const probePaths = [
    "/.env",
    "/wp-config.php.bak",
    "/.git/HEAD",
    "/phpmyadmin/index.php",
    "/actuator/health",
    "/backup.sql",
    "/../../etc/passwd",
    "/shell.php",
    "/wp-json/wp/v2/users",
    "/?author=1",
    "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php",
    "/?s=router'%20UNION%20SELECT%201,2--",
    "/?q=%3Cscript%3Ealert(1)%3C/script%3E",
    "/.aws/credentials",
    "/solr/admin/info/system",
    "/autodiscover/autodiscover.xml",
    "/admin/login.sql",
    "/wp-config.php~",
  ];
  for (let i = 0; i < probePaths.length; i++) {
    const t1 = new Date(now.getTime() - (22 - i) * 5500);
    const t2 = new Date(now.getTime() - (22 - i) * 6100);
    lines.push(
      `194.26.135.91 - - [${formatTime(t1)}] "GET ${probePaths[i]} HTTP/1.1" 404 162 "-" "curl/8.4.0"`
    );
    lines.push(
      `91.132.147.92 - - [${formatTime(t2)}] "GET ${probePaths[i]} HTTP/1.1" 404 162 "-" "sqlmap/1.8#stable"`
    );
  }

  return lines.join("\n");
}
