import { describe, expect, it } from "bun:test";
import app from "../src/index";

const fetchApp = (path: string, options?: RequestInit) => {
  return app.fetch(new Request(`http://localhost:4000${path}`, options));
};

describe("API boundary", () => {
  it("serves liveness without starting a worker on import", async () => {
    const response = await app.fetch(new Request("http://localhost/api/health"));
    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.status).toBe("healthy");
  });
  for (const [path, method] of [["/v1/ingest", "POST"], ["/v1/analyze", "POST"], ["/v1/entity/1/banner", "GET"], ["/v1/tenant/mode", "PATCH"], ["/v1/telemetry/key", "GET"]]) {
    it(`requires credentials for ${method} ${path}`, async () => {
      const response = await app.fetch(new Request(`http://localhost${path}`, { method }));
      expect(response.status).toBe(401);
    });
  }
  it("does not expose an unauthenticated git execution webhook", async () => {
    const response = await app.fetch(new Request("http://localhost/api/webhook", { method: "POST" }));
    expect(response.status).toBe(404);
  });
});

describe("Dashboard Endpoints", () => {

  it("GET / and /assets/dashboard.js serve the shadcn/ui React dashboard", async () => {
    const htmlRes = await fetchApp("/");
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain("/assets/dashboard.js");
    expect(html).toContain("/assets/dashboard.css");

    const jsRes = await fetchApp("/assets/dashboard.js");
    expect(jsRes.status).toBe(200);
    const js = await jsRes.text();
    expect(js).toContain("Truthier Command Center");
    expect(js).toContain("Bot Honeypot Vault");
    expect(js).toContain("Global Propaganda & Bot Origin Map");
  });

  it("GET /api/dashboard/overview returns KPIs, time-series buckets, top SemEval flags, and geography", async () => {
    await fetchApp("/api/dashboard/seed", { method: "POST" });

    const res = await fetchApp("/api/dashboard/overview?range=7d");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.kpis.totalSubmissions).toBeGreaterThan(0);
    expect(data.kpis.botsDetected).toBeGreaterThan(0);
    expect(Array.isArray(data.series)).toBe(true);
    expect(data.series.length).toBe(7);
    expect(Array.isArray(data.routingBreakdown)).toBe(true);
    expect(Array.isArray(data.topFlags)).toBe(true);
    expect(data.geography).toBeDefined();
    expect(data.geography.activeRegionsCount).toBeGreaterThanOrEqual(4);
    expect(data.geography.activeCountriesCount).toBeGreaterThanOrEqual(6);
    expect(Array.isArray(data.geography.hotspots)).toBe(true);
  });

  it("GET /api/dashboard/regions returns regional scanning summary and country filtering", async () => {
    const res = await fetchApp("/api/dashboard/regions?region=region_eastern_europe");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.selectedRegion).toBe("region_eastern_europe");
    expect(data.activeRegion).not.toBeNull();
    expect(data.activeRegion.regionName).toBe("Eastern Europe");
    expect(Array.isArray(data.summary.regions)).toBe(true);
    expect(data.summary.regions.length).toBe(6);
    expect(Array.isArray(data.recentRegionItems)).toBe(true);
    expect(data.recentRegionItems.length).toBeGreaterThan(0);
    for (const item of data.recentRegionItems) {
      expect(item.origin.regionCode).toBe("region_eastern_europe");
    }

    const countryRes = await fetchApp("/api/dashboard/regions?country=IR");
    expect(countryRes.status).toBe(200);
    const countryData = (await countryRes.json()) as any;
    expect(countryData.recentRegionItems.length).toBeGreaterThan(0);
    expect(countryData.recentRegionItems[0].origin.countryCode).toBe("IR");
  });

  it("GET /api/dashboard/bots returns collected bot comments and honeypot telemetry", async () => {
    const res = await fetchApp("/api/dashboard/bots");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.totalBots).toBeGreaterThan(0);
    expect(Array.isArray(data.bots)).toBe(true);
    expect(data.bots[0].authorType).toBe("bot");
    expect(data.bots[0].honeypot).not.toBeNull();
  });

  it("GET /api/dashboard/submissions supports vector semantic search and tag/geo filtering", async () => {
    // 1. Tag filtering
    const tagRes = await fetchApp("/api/dashboard/submissions?tags=Q17");
    expect(tagRes.status).toBe(200);
    const tagData = (await tagRes.json()) as any;
    expect(tagData.items.length).toBeGreaterThan(0);
    for (const item of tagData.items) {
      expect(item.failedRiskIds).toContain("Q17");
    }

    // 2. Country & region tag filtering
    const geoRes = await fetchApp("/api/dashboard/submissions?tags=country_IR");
    expect(geoRes.status).toBe(200);
    const geoData = (await geoRes.json()) as any;
    expect(geoData.items.length).toBeGreaterThan(0);
    for (const item of geoData.items) {
      expect(item.origin.countryCode).toBe("IR");
    }

    const regFilterRes = await fetchApp("/api/dashboard/submissions?region=region_east_asia");
    expect(regFilterRes.status).toBe(200);
    const regFilterData = (await regFilterRes.json()) as any;
    expect(regFilterData.items.length).toBeGreaterThan(0);
    for (const item of regFilterData.items) {
      expect(item.origin.regionCode).toBe("region_east_asia");
    }

    // 3. Vector semantic search
    const vecRes = await fetchApp(
      "/api/dashboard/submissions?q=crypto+USDT+airdrop+reward&searchMode=hybrid"
    );
    expect(vecRes.status).toBe(200);
    const vecData = (await vecRes.json()) as any;
    expect(vecData.searchActive).toBe(true);
    expect(vecData.items.length).toBeGreaterThan(0);
    expect(vecData.items[0].similarityScore).toBeGreaterThan(0.3);
    expect(vecData.items[0].rawText.toLowerCase()).toContain("usdt");
  });

  it("DELETE /api/dashboard/seed removes only seeded test data", async () => {
    await fetchApp("/api/dashboard/seed", { method: "POST" });

    const clearRes = await fetchApp("/api/dashboard/seed", { method: "DELETE" });
    expect(clearRes.status).toBe(200);
    const clearData = (await clearRes.json()) as any;
    expect(clearData.status).toBe("cleared");
    expect(clearData.deletedCount).toBeGreaterThan(0);

    const ovRes = await fetchApp("/api/dashboard/overview?range=7d");
    const ovData = (await ovRes.json()) as any;
    expect(ovData.kpis.testDataCount).toBe(0);
  });
});
