import { resolveOriginGeo, type OriginGeoInfo } from "./geo-intel";

export type TrafficCategory =
  | "HUMAN_VISITOR"
  | "VERIFIED_BOT"
  | "SCRAPER"
  | "CREDENTIAL_STUFFER"
  | "VULNERABILITY_SCANNER"
  | "DOS_FLOODER";

export interface ParsedLogEntry {
  ipAddress: string;
  timestamp: Date;
  method: string;
  path: string;
  statusCode: number;
  bytesSent: number;
  referer: string;
  userAgent: string;
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
  loginPostCount: number;
  vulnerabilityProbeCount: number;
  recommendedAction: "BLOCK" | "CHALLENGE_CAPTCHA" | "RATE_LIMIT" | "ALLOW";
}

export interface TrafficCleanReport {
  analyzedLines: number;
  uniqueIpsCount: number;
  trafficBreakdown: {
    humanCount: number;
    humanPercent: number;
    verifiedBotCount: number;
    verifiedBotPercent: number;
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
  firewallRules: {
    nginxBlockRules: string;
    apacheHtaccessRules: string;
    cloudflareWafExpression: string;
  };
  sampleAttackSnippets: string[];
}

const COMMON_LOG_REGEX =
  /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+([^\s"]+)(?:\s+HTTP\/[\d.]+)?\"\s+(\d{3})\s+(\d+|-)\s*(?:"([^"]*)"\s*"([^"]*)")?/;

const KNOWN_GOOD_BOTS = [
  { pattern: /Googlebot/i, name: "Googlebot" },
  { pattern: /bingbot/i, name: "Bingbot" },
  { pattern: /DuckDuckBot/i, name: "DuckDuckBot" },
  { pattern: /Baiduspider/i, name: "Baiduspider" },
  { pattern: /YandexBot/i, name: "YandexBot" },
  { pattern: /Applebot/i, name: "Applebot" },
  { pattern: /facebookexternalhit/i, name: "FacebookBot" },
  { pattern: /Twitterbot/i, name: "Twitterbot" },
  { pattern: /LinkedInBot/i, name: "LinkedInBot" },
];

const KNOWN_SUSPICIOUS_UA_PATTERNS = [
  /python-requests/i,
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
];

const STATIC_ASSET_EXTENSIONS = /\.(css|js|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|ico|map)$/i;

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
      return {
        ipAddress: String(ip),
        timestamp: ts,
        method: String(obj.method || obj.request_method || "GET").toUpperCase(),
        path: String(obj.path || obj.request_uri || obj.uri || "/"),
        statusCode: Number(obj.status || obj.status_code || 200),
        bytesSent: Number(obj.body_bytes_sent || obj.bytes_sent || 0),
        referer: String(obj.http_referer || obj.referer || "-"),
        userAgent: String(obj.http_user_agent || obj.user_agent || "-"),
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
  };
}

/**
 * Analyzes web-server access logs to separate malicious bots, scrapers,
 * and credential-stuffing attempts from real visitors.
 */
export function cleanTrafficLogs(logContent: string): TrafficCleanReport {
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
      firewallRules: {
        nginxBlockRules: "# No high-risk traffic detected.",
        apacheHtaccessRules: "# No high-risk traffic detected.",
        cloudflareWafExpression: "",
      },
      sampleAttackSnippets: [],
    };
  }

  // Group by IP Address
  const ipGroups = new Map<string, ParsedLogEntry[]>();
  for (const e of entries) {
    const list = ipGroups.get(e.ipAddress) || [];
    list.push(e);
    ipGroups.set(e.ipAddress, list);
  }

  const profiles: IpThreatProfile[] = [];
  const sampleAttackSnippets: string[] = [];

  let humanCount = 0;
  let verifiedBotCount = 0;
  let scraperCount = 0;
  let credentialStufferCount = 0;
  let vulnerabilityScannerCount = 0;
  let dosFlooderCount = 0;

  for (const [ip, logs] of ipGroups.entries()) {
    logs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const firstSeen = logs[0]!.timestamp;
    const lastSeen = logs[logs.length - 1]!.timestamp;
    const timeDeltaMinutes = Math.max(0.1, (lastSeen.getTime() - firstSeen.getTime()) / 60000);
    const reqPerMinute = Number((logs.length / timeDeltaMinutes).toFixed(1));

    // Resolve IP Geo & ASN
    const geo = resolveOriginGeo({ ipAddress: ip });

    // Path analysis & status codes
    const pathCounts = new Map<string, number>();
    let s2xx = 0;
    let s3xx = 0;
    let s4xx = 0;
    let s5xx = 0;
    let assetCount = 0;
    let loginPosts = 0;
    let vulnProbes = 0;
    const userAgents = new Set<string>();

    for (const l of logs) {
      pathCounts.set(l.path, (pathCounts.get(l.path) || 0) + 1);
      if (l.statusCode >= 200 && l.statusCode < 300) s2xx++;
      else if (l.statusCode >= 300 && l.statusCode < 400) s3xx++;
      else if (l.statusCode >= 400 && l.statusCode < 500) s4xx++;
      else if (l.statusCode >= 500) s5xx++;

      if (STATIC_ASSET_EXTENSIONS.test(l.path)) assetCount++;
      userAgents.add(l.userAgent);

      // Credential stuffing checks
      if (
        l.method === "POST" &&
        AUTH_LOGIN_PATHS.some((p) => l.path.toLowerCase().startsWith(p))
      ) {
        loginPosts++;
        if (sampleAttackSnippets.length < 8) {
          sampleAttackSnippets.push(`[Credential Stuffing] ${ip} - POST ${l.path} (${l.statusCode})`);
        }
      }

      // Vulnerability probe checks
      if (VULNERABILITY_PROBE_PATTERNS.some((p) => p.test(l.path))) {
        vulnProbes++;
        if (sampleAttackSnippets.length < 8) {
          sampleAttackSnippets.push(`[Vulnerability Probe] ${ip} - ${l.method} ${l.path} (${l.statusCode})`);
        }
      }
    }

    const assetRatio = Number((assetCount / logs.length).toFixed(2));
    const representativeUa = logs[0]!.userAgent;

    // Check for Verified Search Engines
    const isGoodBot = KNOWN_GOOD_BOTS.some((b) => b.pattern.test(representativeUa));

    // Check for suspicious / headless tool user-agents
    const isSuspiciousUa = KNOWN_SUSPICIOUS_UA_PATTERNS.some((p) => p.test(representativeUa));

    // Categorization logic
    let category: TrafficCategory = "HUMAN_VISITOR";
    let riskScore = 0;
    let threatReason = "Normal visitor traffic patterns";
    let recommendedAction: IpThreatProfile["recommendedAction"] = "ALLOW";

    if (isGoodBot && vulnProbes === 0 && loginPosts === 0) {
      category = "VERIFIED_BOT";
      riskScore = 5;
      threatReason = "Verified search engine or indexing crawler";
      recommendedAction = "ALLOW";
      verifiedBotCount += logs.length;
    } else if (vulnProbes >= 2 || (vulnProbes >= 1 && s4xx >= 2)) {
      category = "VULNERABILITY_SCANNER";
      riskScore = 95;
      threatReason = `Probed ${vulnProbes} sensitive paths (.env, wp-config, git, or exploit paths)`;
      recommendedAction = "BLOCK";
      vulnerabilityScannerCount += logs.length;
    } else if (loginPosts >= 3 || (loginPosts >= 1 && (s4xx / logs.length) > 0.6)) {
      category = "CREDENTIAL_STUFFER";
      riskScore = 90;
      threatReason = `Repeated authentication POST requests (${loginPosts} attempts, ${s4xx} failed auth responses)`;
      recommendedAction = "BLOCK";
      credentialStufferCount += logs.length;
    } else if (reqPerMinute > 60 || logs.length > 200) {
      category = "DOS_FLOODER";
      riskScore = 85;
      threatReason = `Abnormally high request velocity (${reqPerMinute} req/min, ${logs.length} total hits)`;
      recommendedAction = "RATE_LIMIT";
      dosFlooderCount += logs.length;
    } else if (isSuspiciousUa || (assetRatio < 0.05 && logs.length >= 8 && s4xx <= 2)) {
      category = "SCRAPER";
      riskScore = 75;
      threatReason = isSuspiciousUa
        ? `Headless or automated client UA (${representativeUa.slice(0, 30)})`
        : `Deep content harvesting with zero static assets (asset ratio: ${Math.round(assetRatio * 100)}%)`;
      recommendedAction = "CHALLENGE_CAPTCHA";
      scraperCount += logs.length;
    } else {
      category = "HUMAN_VISITOR";
      riskScore = Math.min(25, Math.round((s4xx / logs.length) * 30));
      threatReason = "Real visitor with natural asset requests and humane browse pace";
      recommendedAction = "ALLOW";
      humanCount += logs.length;
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
      loginPostCount: loginPosts,
      vulnerabilityProbeCount: vulnProbes,
      recommendedAction,
    });
  }

  // Sort profiles by riskScore descending, then totalRequests descending
  profiles.sort((a, b) => b.riskScore - a.riskScore || b.totalRequests - a.totalRequests);

  const totalLines = entries.length;
  const maliciousCount = scraperCount + credentialStufferCount + vulnerabilityScannerCount + dosFlooderCount;
  const cleanCount = humanCount + verifiedBotCount;

  const cleanPercent = totalLines > 0 ? Number(((cleanCount / totalLines) * 100).toFixed(1)) : 100;
  const maliciousPercent = totalLines > 0 ? Number(((maliciousCount / totalLines) * 100).toFixed(1)) : 0;

  // Generate copyable firewall rules for site owners
  const blockIps = profiles
    .filter((p) => p.recommendedAction === "BLOCK")
    .map((p) => p.ipAddress);

  const rateLimitIps = profiles
    .filter((p) => p.recommendedAction === "RATE_LIMIT" || p.recommendedAction === "CHALLENGE_CAPTCHA")
    .map((p) => p.ipAddress);

  const nginxBlockRules = [
    "# ==========================================================================",
    "# Truthier WAF: Automated Nginx Defense Configuration",
    `# Generated at: ${new Date().toISOString()}`,
    "# ==========================================================================",
    "",
    "# 1. Block malicious credential stuffers & vulnerability scanners",
    ...blockIps.map((ip) => `deny ${ip};`),
    "",
    "# 2. Rate-limit aggressive content scrapers (5 req/sec burst=10)",
    "limit_req_zone $binary_remote_addr zone=truthier_scraper_limit:10m rate=5r/s;",
    "location / {",
    "    limit_req zone=truthier_scraper_limit burst=10 nodelay;",
    "}",
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

  return {
    analyzedLines: totalLines,
    uniqueIpsCount: ipGroups.size,
    trafficBreakdown: {
      humanCount,
      humanPercent: totalLines > 0 ? Number(((humanCount / totalLines) * 100).toFixed(1)) : 0,
      verifiedBotCount,
      verifiedBotPercent: totalLines > 0 ? Number(((verifiedBotCount / totalLines) * 100).toFixed(1)) : 0,
      scraperCount,
      scraperPercent: totalLines > 0 ? Number(((scraperCount / totalLines) * 100).toFixed(1)) : 0,
      credentialStufferCount,
      credentialStufferPercent: totalLines > 0 ? Number(((credentialStufferCount / totalLines) * 100).toFixed(1)) : 0,
      vulnerabilityScannerCount,
      vulnerabilityScannerPercent: totalLines > 0 ? Number(((vulnerabilityScannerCount / totalLines) * 100).toFixed(1)) : 0,
      dosFlooderCount,
      dosFlooderPercent: totalLines > 0 ? Number(((dosFlooderCount / totalLines) * 100).toFixed(1)) : 0,
    },
    cleanVsMaliciousPercent: {
      cleanPercent,
      maliciousPercent,
    },
    topThreatIps: profiles.slice(0, 50),
    firewallRules: {
      nginxBlockRules,
      apacheHtaccessRules,
      cloudflareWafExpression,
    },
    sampleAttackSnippets,
  };
}

/**
 * Generates realistic web server access log samples for demonstrations,
 * automated benchmarks, and site-owner test runs.
 */
export function generateRealisticTrafficLogs(): string {
  const now = new Date();
  const formatTime = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${pad(d.getDate())}/${months[d.getMonth()]}/${d.getFullYear()}:${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} +0000`;
  };

  const lines: string[] = [];

  // 1. Real Human Shoppers (Organic traffic with CSS, JS, Product pages)
  for (let i = 0; i < 40; i++) {
    const time = new Date(now.getTime() - (40 - i) * 12000);
    const ip = `86.142.81.${10 + (i % 5)}`; // UK BT Residential
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    lines.push(`${ip} - - [${formatTime(time)}] "GET /product/laptop-pro-15 HTTP/1.1" 200 4820 "https://google.com" "${ua}"`);
    lines.push(`${ip} - - [${formatTime(new Date(time.getTime() + 150))}] "GET /assets/style.css HTTP/1.1" 200 12400 "https://example.com/product/laptop-pro-15" "${ua}"`);
    lines.push(`${ip} - - [${formatTime(new Date(time.getTime() + 250))}] "GET /assets/bundle.js HTTP/1.1" 200 84200 "https://example.com/product/laptop-pro-15" "${ua}"`);
    lines.push(`${ip} - - [${formatTime(new Date(time.getTime() + 400))}] "GET /images/laptop-front.webp HTTP/1.1" 200 45200 "https://example.com/product/laptop-pro-15" "${ua}"`);
  }

  // 2. Verified Good Bot (Googlebot indexing products at polite rate)
  for (let i = 0; i < 15; i++) {
    const time = new Date(now.getTime() - (20 - i) * 25000);
    const ip = `66.249.66.${1 + i}`; // Google LLC IP
    const ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    lines.push(`${ip} - - [${formatTime(time)}] "GET /product/item-${i + 1} HTTP/1.1" 200 4120 "-" "${ua}"`);
  }

  // 3. Credential-Stuffing Botnet (Bursts of POSTs to /wp-login.php with failed 401s)
  const stufferIps = ["185.220.101.5", "185.220.101.19", "45.155.205.14", "91.132.147.88"];
  for (let i = 0; i < 60; i++) {
    const time = new Date(now.getTime() - (60 - i) * 1500);
    const ip = stufferIps[i % stufferIps.length]!;
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    lines.push(`${ip} - - [${formatTime(time)}] "POST /wp-login.php HTTP/1.1" 401 1420 "https://example.com/wp-login.php" "${ua}"`);
  }

  // 4. Aggressive Scraper (Scrapy / python-requests walking all catalogue pages without assets)
  for (let i = 0; i < 50; i++) {
    const time = new Date(now.getTime() - (50 - i) * 600);
    const ip = "104.244.76.13"; // Datacenter proxy
    const ua = "python-requests/2.31.0";
    lines.push(`${ip} - - [${formatTime(time)}] "GET /catalogue/page/${i + 1} HTTP/1.1" 200 9520 "-" "${ua}"`);
  }

  // 5. Vulnerability Scanner (Probing for .env, wp-config, git, and path traversal)
  const scannerIp = "194.26.135.91";
  const probePaths = [
    "/.env",
    "/wp-config.php.bak",
    "/.git/HEAD",
    "/phpmyadmin/index.php",
    "/actuator/health",
    "/backup.sql",
    "/../../etc/passwd",
    "/shell.php",
  ];
  for (let i = 0; i < probePaths.length; i++) {
    const time = new Date(now.getTime() - (10 - i) * 4000);
    lines.push(`${scannerIp} - - [${formatTime(time)}] "GET ${probePaths[i]} HTTP/1.1" 404 162 "-" "curl/8.4.0"`);
  }

  return lines.join("\n");
}
