import { describe, expect, it } from "bun:test";
import {
  parseLogLine,
  cleanTrafficLogs,
  generateRealisticTrafficLogs,
  verifyGoodBotFcrDns,
} from "../src/engines/traffic-cleaner";
import app from "../src/index";

describe("Traffic Cleaner (Clean the Traffic)", () => {
  it("parses Combined and Common log formats accurately", () => {
    const rawLine =
      '198.51.100.22 - - [14/Nov/2026:14:22:10 +0000] "GET /products/shoes HTTP/1.1" 200 4521 "https://google.com" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"';
    const parsed = parseLogLine(rawLine);

    expect(parsed).not.toBeNull();
    expect(parsed?.ipAddress).toBe("198.51.100.22");
    expect(parsed?.method).toBe("GET");
    expect(parsed?.path).toBe("/products/shoes");
    expect(parsed?.statusCode).toBe(200);
    expect(parsed?.referer).toBe("https://google.com");
    expect(parsed?.userAgent).toContain("Windows NT");
  });

  it("classifies verified crawlers like Googlebot as VERIFIED_BOT", () => {
    const lines = [
      '66.249.66.1 - - [14/Nov/2026:14:00:00 +0000] "GET /robots.txt HTTP/1.1" 200 340 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
      '66.249.66.1 - - [14/Nov/2026:14:00:05 +0000] "GET /sitemap.xml HTTP/1.1" 200 12040 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
    ];

    const report = cleanTrafficLogs(lines.join("\n"));
    expect(report.trafficBreakdown.verifiedBotCount).toBe(2);
    expect(report.topThreatIps[0]?.category).toBe("VERIFIED_BOT");
    expect(report.topThreatIps[0]?.recommendedAction).toBe("ALLOW");
    expect(report.topThreatIps[0]?.riskScore).toBeLessThanOrEqual(15);
  });

  it("detects credential-stuffing attacks with high failure rates on login endpoints", () => {
    const attackLines: string[] = [];
    const attackerIp = "185.220.101.5"; // e.g. Tor exit / bulletproof host

    for (let i = 0; i < 25; i++) {
      attackLines.push(
        `${attackerIp} - - [14/Nov/2026:14:0${Math.floor(i / 10)}:${(i % 10) * 5} +0000] "POST /wp-login.php HTTP/1.1" 401 1234 "-" "Python-urllib/3.9"`
      );
    }

    const report = cleanTrafficLogs(attackLines.join("\n"));
    expect(report.trafficBreakdown.credentialStufferCount).toBe(25);
    expect(report.topThreatIps.some((t) => t.ipAddress === attackerIp)).toBe(true);

    const threat = report.topThreatIps.find((t) => t.ipAddress === attackerIp);
    expect(threat?.category).toBe("CREDENTIAL_STUFFER");
    expect(threat?.recommendedAction).toBe("BLOCK");
  });

  it("detects vulnerability scanners probing for env/config files", () => {
    const scannerIp = "194.26.29.111";
    const scanPaths = ["/.env", "/wp-config.php.bak", "/.git/config", "/phpmyadmin/index.php", "/api/v1/debug"];
    const scanLines = scanPaths.map(
      (path) => `${scannerIp} - - [14/Nov/2026:14:10:00 +0000] "GET ${path} HTTP/1.1" 404 150 "-" "Go-http-client/1.1"`
    );

    const report = cleanTrafficLogs(scanLines.join("\n"));
    expect(report.trafficBreakdown.vulnerabilityScannerCount).toBe(scanPaths.length);

    const threat = report.topThreatIps.find((t) => t.ipAddress === scannerIp);
    expect(threat?.category).toBe("VULNERABILITY_SCANNER");
  });

  it("generates actionable Nginx, Apache, and Cloudflare WAF export rules", () => {
    const attackLines = [
      '185.220.101.5 - - [14/Nov/2026:14:00:00 +0000] "POST /wp-login.php HTTP/1.1" 401 500 "-" "Hydra/9.2"',
      '185.220.101.5 - - [14/Nov/2026:14:00:01 +0000] "POST /wp-login.php HTTP/1.1" 401 500 "-" "Hydra/9.2"',
      '185.220.101.5 - - [14/Nov/2026:14:00:02 +0000] "POST /wp-login.php HTTP/1.1" 401 500 "-" "Hydra/9.2"',
      '185.220.101.5 - - [14/Nov/2026:14:00:03 +0000] "POST /wp-login.php HTTP/1.1" 401 500 "-" "Hydra/9.2"',
      '185.220.101.5 - - [14/Nov/2026:14:00:04 +0000] "POST /wp-login.php HTTP/1.1" 401 500 "-" "Hydra/9.2"',
      '185.220.101.5 - - [14/Nov/2026:14:00:05 +0000] "POST /wp-login.php HTTP/1.1" 401 500 "-" "Hydra/9.2"',
    ];

    const report = cleanTrafficLogs(attackLines.join("\n"));
    expect(report.firewallRules.nginxBlockRules).toContain("deny 185.220.101.5;");
    expect(report.firewallRules.apacheHtaccessRules).toContain("Require not ip 185.220.101.5");
    expect(report.firewallRules.cloudflareWafExpression).toContain("185.220.101.5");
  });

  it("serves POST /v1/traffic/clean API endpoint with structured analysis and defense rules", async () => {
    const rawLogs = generateRealisticTrafficLogs();
    const res = await app.fetch(
      new Request("http://localhost/v1/traffic/clean", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shield-Key": "default_tenant",
        },
        body: JSON.stringify({
          logs: rawLogs,
          options: { sensitivity: "medium" },
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.analyzedLines).toBeGreaterThan(0);
    expect(body.trafficBreakdown).toBeDefined();
    expect(body.firewallRules).toBeDefined();
    expect(typeof body.firewallRules.nginxBlockRules).toBe("string");
  });

  it("distinguishes authentic Googlebot from spoofed Googlebot User-Agent claims", () => {
    const lines = [
      '66.249.66.10 - - [14/Nov/2026:14:00:00 +0000] "GET /robots.txt HTTP/1.1" 200 340 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
      '66.249.66.10 - - [14/Nov/2026:14:00:10 +0000] "GET /sitemap.xml HTTP/1.1" 200 4120 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
      '185.220.101.99 - - [14/Nov/2026:14:01:00 +0000] "GET /pricing HTTP/1.1" 200 18400 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
      '185.220.101.99 - - [14/Nov/2026:14:01:02 +0000] "GET /enterprise HTTP/1.1" 200 19200 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
    ];

    const report = cleanTrafficLogs(lines.join("\n"));
    const realBot = report.topThreatIps.find((t) => t.ipAddress === "66.249.66.10");
    const spoofedBot = report.topThreatIps.find((t) => t.ipAddress === "185.220.101.99");

    expect(realBot?.category).toBe("VERIFIED_BOT");
    expect(realBot?.recommendedAction).toBe("ALLOW");
    expect(spoofedBot?.category).toBe("SPOOFED_BOT");
    expect(spoofedBot?.spoofedBotDetected).toBe(true);
    expect(spoofedBot?.recommendedAction).toBe("BLOCK");
    expect(report.trafficBreakdown.spoofedBotCount).toBe(2);
    expect(report.firewallRules.nginxBlockRules).toContain("deny 185.220.101.99;");
  });

  it("detects distributed low-and-slow credential stuffing across multiple rotating IPs", () => {
    const ips = ["185.220.101.10", "45.155.205.20", "91.132.147.30", "194.26.135.40", "104.244.76.50"];
    const lines: string[] = [];
    ips.forEach((ip, idx) => {
      lines.push(
        `${ip} - - [14/Nov/2026:14:0${idx}:00 +0000] "POST /wp-login.php HTTP/1.1" 401 1200 "-" "Mozilla/5.0"`
      );
      lines.push(
        `${ip} - - [14/Nov/2026:14:0${idx}:20 +0000] "POST /wp-login.php HTTP/1.1" 401 1200 "-" "Mozilla/5.0"`
      );
    });

    const report = cleanTrafficLogs(lines.join("\n"));
    expect(report.distributedCampaigns.length).toBeGreaterThanOrEqual(1);
    const camp = report.distributedCampaigns.find((c) => c.type === "DISTRIBUTED_CREDENTIAL_STUFFING");
    expect(camp).toBeDefined();
    expect(camp?.participatingIps.length).toBe(5);
    expect(report.trafficBreakdown.credentialStufferCount).toBe(10);
    for (const ip of ips) {
      const profile = report.topThreatIps.find((p) => p.ipAddress === ip);
      expect(profile?.category).toBe("CREDENTIAL_STUFFER");
      expect(profile?.distributedCampaignMember).toBe(true);
    }
  });

  it("raises an Account Takeover (ATO) alert when failed logins are followed by a successful login", () => {
    const attackerIp = "45.155.205.77";
    const lines = [
      `${attackerIp} - - [14/Nov/2026:15:00:00 +0000] "POST /wp-login.php HTTP/1.1" 401 1400 "-" "Mozilla/5.0"`,
      `${attackerIp} - - [14/Nov/2026:15:00:05 +0000] "POST /wp-login.php HTTP/1.1" 401 1400 "-" "Mozilla/5.0"`,
      `${attackerIp} - - [14/Nov/2026:15:00:10 +0000] "POST /wp-login.php HTTP/1.1" 401 1400 "-" "Mozilla/5.0"`,
      `${attackerIp} - - [14/Nov/2026:15:00:15 +0000] "POST /wp-login.php HTTP/1.1" 302 800 "-" "Mozilla/5.0"`,
    ];

    const report = cleanTrafficLogs(lines.join("\n"));
    const profile = report.topThreatIps.find((p) => p.ipAddress === attackerIp);
    expect(profile?.accountTakeoverSuspected).toBe(true);
    expect(profile?.riskScore).toBeGreaterThanOrEqual(95);
    expect(report.ownerSummary.accountTakeoverAlerts).toBe(1);
    expect(report.ownerSummary.prioritizedActions[0]?.priority).toBe("IMMEDIATE");
  });

  it("detects SQLi, XSS, and WordPress user-enumeration probes and builds site-owner action summary", () => {
    const lines = [
      '194.26.135.55 - - [14/Nov/2026:16:00:00 +0000] "GET /search?q=1%27%20or%201=1 HTTP/1.1" 403 520 "-" "Mozilla/5.0"',
      '194.26.135.55 - - [14/Nov/2026:16:00:03 +0000] "GET /?author=1 HTTP/1.1" 200 4100 "-" "Mozilla/5.0"',
      '194.26.135.55 - - [14/Nov/2026:16:00:06 +0000] "GET /post?name=<script>alert(1)</script> HTTP/1.1" 400 420 "-" "Mozilla/5.0"',
      '86.142.81.10 - - [14/Nov/2026:16:00:10 +0000] "GET /product/shoes HTTP/1.1" 200 4800 "-" "Mozilla/5.0"',
      '86.142.81.10 - - [14/Nov/2026:16:00:11 +0000] "GET /assets/style.css HTTP/1.1" 200 12000 "-" "Mozilla/5.0"',
    ];

    const report = cleanTrafficLogs(lines.join("\n"));
    const scanner = report.topThreatIps.find((p) => p.ipAddress === "194.26.135.55");
    expect(scanner?.category).toBe("VULNERABILITY_SCANNER");
    expect(scanner?.vulnerabilityProbeCount).toBe(3);
    expect(report.ownerSummary.wastedBandwidthBytes).toBeGreaterThan(0);
    expect(report.ownerSummary.prioritizedActions.length).toBeGreaterThan(0);
    expect(report.ownerSummary.estimatedCleanAfterRulesPercent).toBe(100);
  });

  it("classifies AI crawlers (GPTBot, ClaudeBot), respects aiCrawlerPolicy, and exports robots.txt + scoped Nginx WAF", async () => {
    const lines = [
      '20.171.207.15 - - [14/Nov/2026:17:00:00 +0000] "GET /docs/guide-1 HTTP/1.1" 200 4100 "-" "Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.2; +https://openai.com/gptbot"',
      '160.79.104.22 - - [14/Nov/2026:17:00:10 +0000] "GET /docs/guide-2 HTTP/1.1" 200 3900 "-" "ClaudeBot/1.0; +claudebot@anthropic.com"',
      '86.142.81.10 - - [14/Nov/2026:17:00:20 +0000] "GET /product/a HTTP/1.1" 200 3200 "-" "Mozilla/5.0"',
      '86.142.81.10 - - [14/Nov/2026:17:00:21 +0000] "GET /assets/app.css HTTP/1.1" 200 9000 "-" "Mozilla/5.0"',
    ];

    const blockedReport = cleanTrafficLogs(lines.join("\n"));
    expect(blockedReport.trafficBreakdown.aiCrawlerCount).toBe(2);
    const gpt = blockedReport.topThreatIps.find((p) => p.ipAddress === "20.171.207.15");
    expect(gpt?.category).toBe("AI_CRAWLER");
    expect(gpt?.recommendedAction).toBe("BLOCK");
    expect(blockedReport.firewallRules.robotsTxtRules).toContain("User-agent: GPTBot");
    expect(blockedReport.firewallRules.robotsTxtRules).toContain("User-agent: ClaudeBot");
    expect(blockedReport.firewallRules.nginxBlockRules).toContain("location ~* ^/(wp-login");
    expect(blockedReport.firewallRules.nginxBlockRules).not.toContain("\nlocation / {");

    const allowedReport = cleanTrafficLogs(lines.join("\n"), { aiCrawlerPolicy: "allow" });
    const gptAllowed = allowedReport.topThreatIps.find((p) => p.ipAddress === "20.171.207.15");
    expect(gptAllowed?.recommendedAction).toBe("ALLOW");
    expect(allowedReport.cleanVsMaliciousPercent.cleanPercent).toBe(100);

    const robotsRes = await app.fetch(
      new Request("http://localhost/api/dashboard/traffic/export-rules?format=robots")
    );
    expect(robotsRes.status).toBe(200);
    const robotsTxt = await robotsRes.text();
    expect(robotsTxt).toContain("User-agent: GPTBot");
    expect(robotsTxt).toContain("Disallow: /");
  });

  it("differentiates CREDENTIAL_STUFFING across users vs single-target BRUTE_FORCE", () => {
    const stufferIp = "45.155.205.91";
    const bruteIp = "91.132.147.92";
    const lines = [
      `${stufferIp} - - [14/Nov/2026:18:00:00 +0000] "POST /wp-login.php?user=alice HTTP/1.1" 401 1200 "-" "Mozilla/5.0"`,
      `${stufferIp} - - [14/Nov/2026:18:00:05 +0000] "POST /wp-login.php?user=bob HTTP/1.1" 401 1200 "-" "Mozilla/5.0"`,
      `${stufferIp} - - [14/Nov/2026:18:00:10 +0000] "POST /wp-login.php?user=carol HTTP/1.1" 401 1200 "-" "Mozilla/5.0"`,
      `${bruteIp} - - [14/Nov/2026:18:01:00 +0000] "POST /wp-login.php?user=admin HTTP/1.1" 401 1200 "-" "Mozilla/5.0"`,
      `${bruteIp} - - [14/Nov/2026:18:01:04 +0000] "POST /wp-login.php?user=admin HTTP/1.1" 401 1200 "-" "Mozilla/5.0"`,
      `${bruteIp} - - [14/Nov/2026:18:01:08 +0000] "POST /wp-login.php?user=admin HTTP/1.1" 401 1200 "-" "Mozilla/5.0"`,
    ];

    const report = cleanTrafficLogs(lines.join("\n"));
    const stuffer = report.topThreatIps.find((p) => p.ipAddress === stufferIp);
    const brute = report.topThreatIps.find((p) => p.ipAddress === bruteIp);

    expect(stuffer?.authAttackType).toBe("CREDENTIAL_STUFFING");
    expect(stuffer?.distinctTargetedUsers).toBe(3);
    expect(brute?.authAttackType).toBe("BRUTE_FORCE");
    expect(brute?.distinctTargetedUsers).toBe(1);
  });

  it("extracts behavioral scraper signals, time-series buckets, and anomaly spike alerts", async () => {
    const scraperIp = "104.244.76.88";
    const browserUa = "Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0.0.0";
    const lines: string[] = [
      // Quiet baseline traffic across earlier minutes
      '86.142.81.11 - - [14/Nov/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 4000 "-" "Mozilla/5.0"',
      '86.142.81.11 - - [14/Nov/2026:10:00:01 +0000] "GET /assets/style.css HTTP/1.1" 200 12000 "-" "Mozilla/5.0"',
      '86.142.81.11 - - [14/Nov/2026:10:05:00 +0000] "GET /about HTTP/1.1" 200 3500 "-" "Mozilla/5.0"',
      '86.142.81.11 - - [14/Nov/2026:10:05:01 +0000] "GET /assets/app.js HTTP/1.1" 200 15000 "-" "Mozilla/5.0"',
      // Behavioral scraper: robots.txt + honeypot trap + strict 5s sequential pagination
      `${scraperIp} - - [14/Nov/2026:10:15:00 +0000] "GET /robots.txt HTTP/1.1" 200 120 "-" "${browserUa}"`,
      `${scraperIp} - - [14/Nov/2026:10:15:05 +0000] "GET /honeypot-trap HTTP/1.1" 200 90 "-" "${browserUa}"`,
    ];
    for (let p = 1; p <= 8; p++) {
      const sec = String((p + 1) * 5).padStart(2, "0");
      lines.push(
        `${scraperIp} - - [14/Nov/2026:10:15:${sec} +0000] "GET /catalogue/page/${p} HTTP/1.1" 200 5000 "-" "${browserUa}"`
      );
    }

    const report = cleanTrafficLogs(lines.join("\n"));
    const scraper = report.topThreatIps.find((p) => p.ipAddress === scraperIp);
    expect(scraper?.category).toBe("SCRAPER");
    expect(scraper?.robotsTxtFetched).toBe(true);
    expect(scraper?.honeypotTrapHits).toBe(1);
    expect(scraper?.sequentialCrawlDetected).toBe(true);
    expect(scraper?.requestRegularityScore).toBeGreaterThanOrEqual(80);
    expect(report.timeSeries.length).toBeGreaterThanOrEqual(2);
    expect(report.recentSpikeAlerts.length).toBeGreaterThanOrEqual(1);

    const fcrFallback = await verifyGoodBotFcrDns("66.249.66.1", "Googlebot", "Google LLC");
    expect(fcrFallback.verified).toBe(true);
  });

  it("ingests live failed-login events via POST /v1/traffic/event into tenant traffic logs", async () => {
    const users = ["alice", "bob", "carol"];
    for (const user of users) {
      const res = await app.fetch(
        new Request("http://localhost/v1/traffic/event", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shield-Key": "default_tenant",
          },
          body: JSON.stringify({
            ipAddress: "45.155.205.222",
            method: "POST",
            path: "/wp-login.php",
            statusCode: 401,
            userAgent: "Mozilla/5.0",
            username: user,
          }),
        })
      );
      expect(res.status).toBe(201);
    }

    const overviewRes = await app.fetch(
      new Request("http://localhost/api/dashboard/traffic/overview?tenantId=00000000-0000-0000-0000-000000000001")
    );
    expect(overviewRes.status).toBe(200);
    const report = (await overviewRes.json()) as any;
    expect(report.analyzedLines).toBeGreaterThanOrEqual(3);
    expect(report.trafficBreakdown.credentialStufferCount).toBeGreaterThanOrEqual(3);
    const threat = report.topThreatIps.find((p: any) => p.ipAddress === "45.155.205.222");
    expect(threat?.authAttackType).toBe("CREDENTIAL_STUFFING");
    expect(threat?.distinctTargetedUsers).toBe(3);
  });
});
