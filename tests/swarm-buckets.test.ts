import { describe, expect, it } from "bun:test";
import { runFourBucketBenchmark } from "../scripts/test-bot-swarm";

describe("4-Bucket Bot Swarm & Paraphrased Propaganda Wave Suite", () => {
  it("achieves 100% bot/stealth-bot detection and 0% false positives across Buckets A, B, C, D", async () => {
    // Run small batch for fast CI/test execution without exhausting API rate limits
    const res = await runFourBucketBenchmark(0.02);

    expect(res.bucketA.caught).toBe(res.bucketA.total);
    expect(res.bucketB.caught).toBe(res.bucketB.total);
    expect(res.bucketB.vectorMatched).toBe(res.bucketB.total);
    expect(res.bucketC.allowed).toBe(res.bucketC.total);
    expect(res.bucketD.allowed).toBe(res.bucketD.total);
    expect(res.metrics.precision).toBe(100);
    expect(res.metrics.recall).toBe(100);
    expect(res.metrics.fpr).toBe(0);
  }, 60000);
});
