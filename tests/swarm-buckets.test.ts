import { describe, expect, it } from "bun:test";
import { runFourBucketBenchmark } from "../scripts/test-bot-swarm";

describe("4-Bucket Bot Swarm & Paraphrased Propaganda Wave Suite", () => {
  it("achieves 100% bot/stealth-bot detection and 0% false positives across Buckets A, B, C, D", async () => {
    // Run scaled-down batch (scale=0.1 -> 20 Bucket A, 10 Bucket B, 10 Bucket C, 10 Bucket D) for fast unit test
    const res = await runFourBucketBenchmark(0.1);

    expect(res.bucketA.caught).toBe(res.bucketA.total);
    expect(res.bucketB.caught).toBe(res.bucketB.total);
    expect(res.bucketB.vectorMatched).toBe(res.bucketB.total);
    expect(res.bucketC.allowed).toBe(res.bucketC.total);
    expect(res.bucketD.allowed).toBe(res.bucketD.total);
    expect(res.metrics.precision).toBe(100);
    expect(res.metrics.recall).toBe(100);
    expect(res.metrics.fpr).toBe(0);
  });
});
