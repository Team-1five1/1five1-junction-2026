import { describe, expect, it } from "bun:test";
import {
  detectCoordinatedSwarms,
  type RawSubmissionInput,
} from "../src/engines/coordination-detector";

describe("Coordination Detector (Spot the Swarm)", () => {
  it("detects a robotic bot swarm with identical cadence, shared subnet, and high text similarity", () => {
    const baseTime = Date.now() - 3600_000;
    const swarmSubmissions: RawSubmissionInput[] = [];

    // Create 8 accounts posting at strictly regular 60-second intervals from the same /24 subnet
    for (let i = 0; i < 8; i++) {
      swarmSubmissions.push({
        wpCommentId: 1000 + i,
        entityId: "target-product-101",
        authorSessionHash: `session-${i}`,
        rawText: `Unbelievable deal on this product! Must buy right now discount code SAVE50 #${i}`,
        rating: 5,
        authorType: "bot",
        visibility: "shadowbanned",
        createdAt: new Date(baseTime + i * 60_000).toISOString(),
        ipAddress: `198.51.100.${10 + i}`, // Same 198.51.100.0/24 subnet
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
        telemetry: { keystrokeFlightVariance: 0.1, formCompletionTimeMs: 250, botdDetected: true },
      });
    }

    const report = detectCoordinatedSwarms(swarmSubmissions);

    expect(report.activeSwarmCount).toBeGreaterThanOrEqual(1);
    expect(report.totalSwarmMembers).toBeGreaterThanOrEqual(5);

    const cluster = report.swarms[0]!;
    expect(cluster).toBeDefined();
    expect(cluster.networkFootprint.uniqueSubnets).toBe(1);
    expect(cluster.confidenceScore).toBeGreaterThanOrEqual(70);
    expect(cluster.recommendedAction.toLowerCase()).toContain("shadowban");
  });

  it("detects multi-account review brigading targeting a single entity with uniform negative ratings", () => {
    const baseTime = Date.now() - 1800_000;
    const brigadingSubmissions: RawSubmissionInput[] = [];

    // 6 distinct accounts slamming the same restaurant entity with 1-star reviews in 10 minutes
    const complaints = [
      "Horrible service, food was cold and staff was rude! boycott them!",
      "Worst experience ever, cold food and terrible service, boycott!",
      "Avoid this place at all costs! Rude staff and cold food, boycott now!",
      "Completely unacceptable service, food was freezing cold and staff yelled!",
      "Disgusting dining experience, rude waiters and cold dishes! Boycott!",
      "Save your money and do not go here! Rude staff, terrible cold food!",
    ];

    complaints.forEach((text, i) => {
      brigadingSubmissions.push({
        wpCommentId: 2000 + i,
        entityId: "restaurant-xyz",
        authorSessionHash: `brigade-hash-${i}`,
        rawText: text,
        rating: 1,
        authorType: "human",
        visibility: "public",
        createdAt: new Date(baseTime + i * 90_000).toISOString(), // tightly clustered (90s apart)
        ipAddress: `203.0.113.${50 + i}`,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        telemetry: { keystrokeFlightVariance: 1.2, formCompletionTimeMs: 400 },
      });
    });

    const report = detectCoordinatedSwarms(brigadingSubmissions);

    expect(report.activeSwarmCount).toBeGreaterThanOrEqual(1);
    const brigadeCluster = report.swarms.find(
      (c) => c.campaignType === "COORDINATED_REVIEW_BOMB" || c.targetEntities.some((t) => t.entityId === "restaurant-xyz")
    );
    expect(brigadeCluster).toBeDefined();
    expect(brigadeCluster?.targetEntities.some((t) => t.entityId === "restaurant-xyz")).toBe(true);
  });

  it("does not falsely flag organic human discussions with diverse cadences and entities", () => {
    const baseTime = Date.now() - 86400_000;
    const organicSubmissions: RawSubmissionInput[] = [];

    const organicReviews = [
      { entity: "hotel-a", rating: 5, text: "Loved the pool and the breakfast was magnificent." },
      { entity: "gym-b", rating: 3, text: "Decent equipment, but locker rooms need better cleaning." },
      { entity: "cafe-c", rating: 4, text: "Good espresso and pleasant atmosphere to get work done." },
      { entity: "bookstore-d", rating: 5, text: "Wide selection of rare books and very friendly staff." },
      { entity: "hotel-a", rating: 2, text: "Too noisy at night because of construction nearby." },
    ];

    organicReviews.forEach((rev, i) => {
      organicSubmissions.push({
        wpCommentId: 3000 + i,
        entityId: rev.entity,
        authorSessionHash: `organic-user-${i}`,
        rawText: rev.text,
        rating: rev.rating,
        authorType: "human",
        visibility: "public",
        createdAt: new Date(baseTime + i * 7200_000).toISOString(), // spaced out by 2 hours
        ipAddress: `82.165.${10 + i}.${20 + i * 5}`,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        telemetry: { keystrokeFlightVariance: 45.0, formCompletionTimeMs: 15000 },
      });
    });

    const report = detectCoordinatedSwarms(organicSubmissions);
    expect(report.swarms.length).toBe(0);
    expect(report.activeSwarmCount).toBe(0);
  });
});
