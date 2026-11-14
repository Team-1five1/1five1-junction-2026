import { afterEach, expect, it } from "bun:test";
import { providerHttpError, ProviderHttpError, withProviderRequestBudget, resetProviderRequestBudgets } from "../src/ai/provider-errors";
import { retryDelay, MAX_JOB_FAILURES } from "../src/workers/retry-policy";

afterEach(resetProviderRequestBudgets);

it("honors Retry-After instead of a five-second retry loop", async () => {
  const error = await providerHttpError(Response.json({ error: { status: "RESOURCE_EXHAUSTED", message: "Too many requests" } }, { status: 429, headers: { "Retry-After": "60" } }), "secret", "Hostinger AI Router");
  expect(error.retryAfterMs).toBe(60000);
  expect(error.reason).toBe("rate_limit");
  expect(retryDelay(error, 1)).toBe(60000);
});
it("does not replace a one-second provider delay with the default", async () => {
  const error = await providerHttpError(Response.json({}, { status: 429, headers: { "Retry-After": "1" } }), "secret", "Hostinger AI Router");
  expect(error.retryAfterMs).toBe(1000);
});
it("does not repeatedly retry depleted provider credits", async () => {
  const error = await providerHttpError(Response.json({ error: { message: "Insufficient credits" } }, { status: 402 }), "secret", "Hostinger AI Router");
  expect(error.retryable).toBe(false);
  expect(error.reason).toBe("quota_exhausted");
  expect(retryDelay(error, 1)).toBe(-1);
});
it("preserves the useful provider reason and redacts the key", async () => {
  const error = await providerHttpError(Response.json({ error: { message: "Quota exceeded for secret-key; check billing" } }, { status: 429 }), "secret-key", "Hostinger AI Router");
  expect(error.message).toContain("check billing");
  expect(error.message).not.toContain("secret-key");
  expect(error.retryAfterMs).toBe(15 * 60000);
});
it("does not retry invalid credentials or malformed requests", async () => {
  const error = await providerHttpError(Response.json({ error: { message: "Invalid API key" } }, { status: 403 }), "secret", "Hostinger AI Router");
  expect(error.retryable).toBe(false);
  expect(retryDelay(error, 1)).toBe(-1);
  expect(MAX_JOB_FAILURES).toBe(5);
});
it("shares the cooldown with other research calls without making another request", async () => {
  let calls = 0;
  const limited = new ProviderHttpError("Rate limited", 429, 60000, true, "rate_limit");
  await expect(withProviderRequestBudget("test-provider", async () => { calls++; throw limited; })).rejects.toThrow("Rate limited");
  await expect(withProviderRequestBudget("test-provider", async () => { calls++; return "should not run"; })).rejects.toThrow("Rate limited");
  expect(calls).toBe(1);
});
it("serializes in-flight research calls to avoid a concurrency burst", async () => {
  let active = 0, maximum = 0;
  const request = () => withProviderRequestBudget("test-provider", async () => {
    active++; maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--; return "ok";
  });
  expect(await Promise.all([request(), request(), request()])).toEqual(["ok", "ok", "ok"]);
  expect(maximum).toBe(1);
});
