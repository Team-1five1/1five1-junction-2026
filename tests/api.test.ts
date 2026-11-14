import { describe, expect, it } from "bun:test";
import app from "../src/index";

describe("API boundary", () => {
  it("serves liveness without starting a worker on import", async () => {
    const response = await app.fetch(new Request("http://localhost/api/health"));
    expect(response.status).toBe(200);
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
