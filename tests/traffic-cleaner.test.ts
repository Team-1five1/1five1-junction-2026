import { describe, expect, it } from "bun:test";
import {
  parseLogLine,
  cleanTrafficLogs,
  generateRealisticTrafficLogs,
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
});
