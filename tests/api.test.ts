import { describe, expect, it } from "bun:test";
import appObj from "../src/index";

const fetchApp = (path: string, options?: RequestInit) => {
  return appObj.fetch(new Request(`http://localhost:4000${path}`, options));
};

describe("Truthier API Endpoints", () => {
  it("GET /api/health returns healthy", async () => {
    const res = await fetchApp("/api/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe("healthy");
  });

  it("POST /v1/analyze correctly flags high risk disinformation", async () => {
    const res = await fetchApp("/v1/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "The shadowy puppet master cabal is entirely the fault of these corrupt globalists! Destroy our way of life! Share before it gets deleted!",
        mode: "balanced",
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.risk_score).toBeGreaterThanOrEqual(7);
    expect(data.route).toBe("ROUTE_4_FORENSIC_THREAT");
    const expectedModel = process.env.MODEL_HEAVY_RESEARCH || "gemini-4-hydrogen";
    expect(data.model_used).toBe(expectedModel);
    expect(data.deep_research_explanation).not.toBeNull();
  }, 20000);

  it("POST /v1/ingest synchronously catches headless bots", async () => {
    const res = await fetchApp("/v1/ingest?sync=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wpCommentId: 101,
        entityId: "post_42",
        authorSessionHash: "hash_bot_xyz",
        rawText: "Cheap pills http://spam.xyz",
        telemetryToken: { webdriver: true },
        honeypotValue: null,
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.authorType).toBe("bot");
    expect(data.visibility).toBe("shadowbanned");
  });
});
