import { describe, expect, it } from "bun:test";
import {
  detectCoordinatedSwarms,
  parseSocialDataset,
  generateSampleSocialDatasetCsv,
  type RawSubmissionInput,
} from "../src/engines/coordination-detector";
import { cleanTrafficLogs } from "../src/engines/traffic-cleaner";
import app from "../src/index";

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

  it("identifies amplification chains with ORIGINATOR vs AMPLIFIER roles and shared promo/URL tokens", () => {
    const baseTime = Date.now() - 600_000;
    const ampSubmissions: RawSubmissionInput[] = [
      {
        wpCommentId: 4001,
        entityId: "launch-thread",
        authorSessionHash: "amp-origin",
        authorHandle: "deal_hunter_01",
        rawText: "Drop everything and check https://fast-airdrop-promo.xyz using code BOOST99 right now!",
        rating: 5,
        createdAt: new Date(baseTime).toISOString(),
        ipAddress: "104.244.76.10",
        telemetry: { keystrokeFlightVariance: 1.0, formCompletionTimeMs: 300 },
      },
      {
        wpCommentId: 4002,
        entityId: "launch-thread",
        replyToCommentId: 4001,
        authorSessionHash: "amp-boost-1",
        authorHandle: "deal_hunter_02",
        rawText: "Confirmed! Used code BOOST99 at https://fast-airdrop-promo.xyz and it worked instantly!",
        rating: 5,
        createdAt: new Date(baseTime + 25_000).toISOString(),
        ipAddress: "104.244.76.11",
        telemetry: { keystrokeFlightVariance: 1.1, formCompletionTimeMs: 310 },
      },
      {
        wpCommentId: 4003,
        entityId: "launch-thread",
        replyToCommentId: 4001,
        authorSessionHash: "amp-boost-2",
        authorHandle: "deal_hunter_03",
        rawText: "Huge vouch for https://fast-airdrop-promo.xyz — grab code BOOST99 before it expires!",
        rating: 5,
        createdAt: new Date(baseTime + 45_000).toISOString(),
        ipAddress: "104.244.76.12",
        telemetry: { keystrokeFlightVariance: 0.9, formCompletionTimeMs: 290 },
      },
    ];

    const report = detectCoordinatedSwarms(ampSubmissions);
    expect(report.activeSwarmCount).toBe(1);
    const cluster = report.swarms[0]!;
    expect(cluster.campaignType).toBe("SCRAPER_AMPLIFICATION");
    expect(cluster.amplificationMetrics.originatorSession).toBe("amp-origin");
    expect(cluster.amplificationMetrics.amplifierCount).toBe(2);
    expect(cluster.amplificationMetrics.replyChainCount).toBe(2);
    expect(cluster.amplificationMetrics.sharedUrlsOrCodes).toContain("https://fast-airdrop-promo.xyz");
    expect(cluster.amplificationMetrics.sharedUrlsOrCodes).toContain("code:BOOST99");
    expect(cluster.members.find((m) => m.sessionHash === "amp-origin")?.role).toBe("ORIGINATOR");
    expect(cluster.members.find((m) => m.sessionHash === "amp-boost-1")?.role).toBe("AMPLIFIER");
  });

  it("detects rotating-proxy bot swarms via handle similarity, synchronized account creation, and device fingerprints", () => {
    const baseTime = Date.now() - 900_000;
    const acctCreated = new Date(baseTime - 3600_000).toISOString();
    const rotatingIps = ["45.155.205.11", "194.26.135.22", "185.220.101.33", "91.132.147.44"];

    const subs: RawSubmissionInput[] = rotatingIps.map((ip, i) => ({
      wpCommentId: 5000 + i,
      entityId: "product-alpha",
      authorSessionHash: `rot-sess-${i}`,
      authorHandle: `promo_wave_10${i}`,
      accountCreatedAt: acctCreated,
      deviceFingerprint: "fp_headless_win11_9981",
      rawText: `Amazing platform upgrade experience, everyone switch to platform-x now!`,
      rating: 5,
      createdAt: new Date(baseTime + i * 20_000).toISOString(),
      ipAddress: ip,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
      telemetry: { keystrokeFlightVariance: 0.2, formCompletionTimeMs: 280 },
    }));

    const report = detectCoordinatedSwarms(subs);
    expect(report.activeSwarmCount).toBe(1);
    const cluster = report.swarms[0]!;
    expect(cluster.networkFootprint.uniqueSubnets).toBe(4);
    expect(cluster.accountSimilarityMetrics.crossSubnetRotationDetected).toBe(true);
    expect(cluster.accountSimilarityMetrics.avgHandleSimilarity).toBeGreaterThanOrEqual(0.7);
    expect(cluster.accountSimilarityMetrics.synchronizedNewAccountsCount).toBe(4);
  });

  it("protects organic human users behind a shared NAT from false-positive swarm grouping", () => {
    const baseTime = Date.now() - 3600_000;
    const campusNatSubs: RawSubmissionInput[] = [
      {
        wpCommentId: 6001,
        entityId: "campus-cafeteria-post",
        authorSessionHash: "student-a",
        rawText: "The espresso machine was broken this morning, hope maintenance fixes it soon.",
        rating: 2,
        createdAt: new Date(baseTime).toISOString(),
        ipAddress: "128.32.10.5",
        telemetry: { keystrokeFlightVariance: 38, formCompletionTimeMs: 12000 },
      },
      {
        wpCommentId: 6002,
        entityId: "campus-cafeteria-post",
        authorSessionHash: "student-b",
        rawText: "Honestly I really liked the new sandwich menu today and the staff was super helpful!",
        rating: 5,
        createdAt: new Date(baseTime + 120_000).toISOString(),
        ipAddress: "128.32.10.9",
        telemetry: { keystrokeFlightVariance: 44, formCompletionTimeMs: 16500 },
      },
    ];

    const report = detectCoordinatedSwarms(campusNatSubs);
    expect(report.activeSwarmCount).toBe(0);
  });

  it("correlates swarm members with malicious IPs/subnets flagged by Clean the Traffic", () => {
    const logContent = [
      '185.220.101.5 - - [14/Nov/2026:14:00:00 +0000] "POST /wp-login.php HTTP/1.1" 401 1200 "-" "curl/8.4.0"',
      '185.220.101.5 - - [14/Nov/2026:14:00:02 +0000] "POST /wp-login.php HTTP/1.1" 401 1200 "-" "curl/8.4.0"',
      '185.220.101.5 - - [14/Nov/2026:14:00:04 +0000] "POST /wp-login.php HTTP/1.1" 401 1200 "-" "curl/8.4.0"',
      '185.220.101.5 - - [14/Nov/2026:14:00:06 +0000] "POST /wp-login.php HTTP/1.1" 401 1200 "-" "curl/8.4.0"',
    ].join("\n");
    const trafficReport = cleanTrafficLogs(logContent);

    const baseTime = Date.now() - 300_000;
    const subs: RawSubmissionInput[] = [
      {
        wpCommentId: 7001,
        entityId: "product-router",
        authorSessionHash: "bridge-bot-1",
        rawText: "Claim free tokens now at http://claim-fast-bonus.xyz !",
        rating: 5,
        createdAt: new Date(baseTime).toISOString(),
        ipAddress: "185.220.101.5",
        telemetry: { keystrokeFlightVariance: 0, formCompletionTimeMs: 150, webdriver: true },
      },
      {
        wpCommentId: 7002,
        entityId: "product-router",
        authorSessionHash: "bridge-bot-2",
        rawText: "Claim free tokens now at http://claim-fast-bonus.xyz !",
        rating: 5,
        createdAt: new Date(baseTime + 15_000).toISOString(),
        ipAddress: "185.220.101.22",
        telemetry: { keystrokeFlightVariance: 0, formCompletionTimeMs: 180, webdriver: true },
      },
    ];

    const report = detectCoordinatedSwarms(subs, { trafficReport });
    expect(report.activeSwarmCount).toBe(1);
    const cluster = report.swarms[0]!;
    expect(cluster.correlatedTrafficThreats.length).toBeGreaterThanOrEqual(2);
    expect(cluster.members.every((m) => m.trafficThreatCorrelated)).toBe(true);
  });

  it("prunes weak single-link bridges so two distinct swarms are not chained together", () => {
    const baseTime = Date.now() - 3600_000;
    const subs: RawSubmissionInput[] = [
      // Cluster A (3 accounts on subnet A targeting entity-a)
      {
        wpCommentId: 8001,
        entityId: "entity-a",
        authorSessionHash: "clust-a-1",
        rawText: "Alpha software release completely broke my production cluster!",
        rating: 1,
        createdAt: new Date(baseTime).toISOString(),
        ipAddress: "198.51.100.11",
        telemetry: { keystrokeFlightVariance: 0.5, formCompletionTimeMs: 250, webdriver: true },
      },
      {
        wpCommentId: 8002,
        entityId: "entity-a",
        authorSessionHash: "clust-a-2",
        rawText: "Alpha software release completely broke my production cluster!",
        rating: 1,
        createdAt: new Date(baseTime + 5_000).toISOString(),
        ipAddress: "198.51.100.12",
        telemetry: { keystrokeFlightVariance: 0.5, formCompletionTimeMs: 250, webdriver: true },
      },
      {
        wpCommentId: 8003,
        entityId: "entity-a",
        authorSessionHash: "clust-a-3",
        rawText: "Alpha software release completely broke my production cluster!",
        rating: 1,
        createdAt: new Date(baseTime + 10_000).toISOString(),
        ipAddress: "198.51.100.13",
        telemetry: { keystrokeFlightVariance: 0.5, formCompletionTimeMs: 250, webdriver: true },
      },
      // Cluster B (3 accounts on subnet B targeting entity-b, 40 mins later)
      {
        wpCommentId: 8004,
        entityId: "entity-b",
        authorSessionHash: "clust-b-1",
        rawText: "Discount pharmacy express shipping instant checkout online!",
        rating: 5,
        createdAt: new Date(baseTime + 2400_000).toISOString(),
        ipAddress: "203.0.113.21",
        telemetry: { keystrokeFlightVariance: 22, formCompletionTimeMs: 4500 },
      },
      {
        wpCommentId: 8005,
        entityId: "entity-b",
        authorSessionHash: "clust-b-2",
        rawText: "Discount pharmacy express shipping instant checkout online!",
        rating: 5,
        createdAt: new Date(baseTime + 2405_000).toISOString(),
        ipAddress: "203.0.113.22",
        telemetry: { keystrokeFlightVariance: 24, formCompletionTimeMs: 4600 },
      },
      {
        wpCommentId: 8006,
        entityId: "entity-b",
        authorSessionHash: "clust-b-3",
        rawText: "Discount pharmacy express shipping instant checkout online!",
        rating: 5,
        createdAt: new Date(baseTime + 2410_000).toISOString(),
        ipAddress: "203.0.113.23",
        telemetry: { keystrokeFlightVariance: 25, formCompletionTimeMs: 4700 },
      },
      // Single weak accidental co-target + moderate paraphrase overlap between clust-a-3 and clust-b-1 only
      {
        wpCommentId: 8007,
        entityId: "entity-bridge",
        authorSessionHash: "clust-a-3",
        rawText: "Checking the server reliability metrics on this vendor dashboard",
        rating: 3,
        createdAt: new Date(baseTime + 30_000).toISOString(),
        ipAddress: "198.51.100.13",
        telemetry: { keystrokeFlightVariance: 0.5, formCompletionTimeMs: 250, webdriver: true },
      },
      {
        wpCommentId: 8008,
        entityId: "entity-bridge",
        authorSessionHash: "clust-b-1",
        rawText: "Checking vendor reliability metrics for our team",
        rating: 3,
        createdAt: new Date(baseTime + 2420_000).toISOString(),
        ipAddress: "203.0.113.21",
        telemetry: { keystrokeFlightVariance: 22, formCompletionTimeMs: 4500 },
      },
    ];

    const report = detectCoordinatedSwarms(subs);
    expect(report.activeSwarmCount).toBe(2);
    expect(report.swarms.map((s) => s.memberCount).sort()).toEqual([3, 3]);
  });

  it("scales cleanly with LSH bucketing (>120 members) and serves POST /v1/swarms/detect", async () => {
    const baseTime = Date.now() - 1800_000;
    const manySubs: RawSubmissionInput[] = [];
    // 130 accounts: 6 coordinated bots + 124 distinct organic humans across diverse IPs/entities
    for (let i = 0; i < 6; i++) {
      manySubs.push({
        wpCommentId: 9000 + i,
        entityId: "target-lsh-entity",
        authorSessionHash: `lsh-bot-${i}`,
        rawText: "Must buy this token airdrop right now before it closes!",
        rating: 5,
        createdAt: new Date(baseTime + i * 10_000).toISOString(),
        ipAddress: `198.51.100.${10 + i}`,
        telemetry: { keystrokeFlightVariance: 0.1, formCompletionTimeMs: 200, botdDetected: true },
      });
    }
    const subjects = [
      "Alice", "Bob", "Carlos", "Diana", "Elena", "Frank", "Grace", "Hiro",
      "Iris", "Jonas", "Klara", "Liam", "Maya", "Noah", "Olga", "Priya", "Quinn",
    ];
    const verbs = [
      "enjoyed", "bought", "repaired", "sketched", "packed", "tuned", "painted",
      "measured", "planted", "cooked", "borrowed", "donated", "cleaned",
      "sorted", "framed", "recorded", "trimmed", "folded", "assembled",
    ];
    const adjectives = [
      "wooden", "ceramic", "brass", "canvas", "granite", "copper", "velvet",
      "bamboo", "silver", "linen", "oak", "glass", "slate", "cotton",
      "walnut", "pewter", "marble", "wool", "cedar", "bronze", "steel", "cork", "pine",
    ];
    const items = [
      "espresso-grinder", "hiking-boots", "ukulele", "telescope", "teapot",
      "bicycle-pump", "paintbrush", "compass", "kayak-paddle", "lantern",
      "thermometer", "chessboard", "sketchbook", "watering-can", "metronome",
      "thermistor", "tripod", "cast-iron-pan", "backpack", "typewriter",
      "harmonica", "sunscreen", "birdhouse", "barometer", "sextant",
      "sourdough-crock", "violin-bow", "binoculars", "fountain-pen",
    ];
    const places = [
      "Helsinki", "Tampere", "Oulu", "Turku", "Porvoo", "Vaasa", "Kuopio",
      "Lahti", "Rovaniemi", "Jyvaskyla", "Kotka", "Rauma", "Joensuu",
      "Lappeenranta", "Hameenlinna", "Kokkola", "Seinajoki", "Kajaani",
      "Mikkeli", "Salo", "Hyvinkaa", "Jarvenpaa", "Lohja", "Kouvola",
      "Varkaus", "Raahe", "Tornio", "Savonlinna", "Imatra", "Kemi", "Nokia",
    ];
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December", "Autumntide",
    ];
    const ipOctets = [73, 76, 80, 86, 90, 98, 116, 118, 177];
    for (let i = 0; i < 124; i++) {
      const s = subjects[i % subjects.length];
      const v = verbs[(i * 7) % verbs.length];
      const adj = adjectives[(i * 5) % adjectives.length];
      const it = items[(i * 11) % items.length];
      const pl = places[(i * 13) % places.length];
      const mo = months[(i * 3) % months.length];
      const tag = `k${(i + 17).toString(36)}x${((i * 29) + 101).toString(36)}`;
      const firstOctet = ipOctets[i % ipOctets.length];
      manySubs.push({
        wpCommentId: 9100 + i,
        entityId: `organic-entity-${i}`,
        authorSessionHash: `lsh-human-${i}`,
        rawText: `${s} ${v} ${adj} ${it} near ${pl} during ${mo} (${tag}).`,
        rating: (i % 5) + 1,
        createdAt: new Date(baseTime - (i + 1) * 1800_000).toISOString(),
        ipAddress: `${firstOctet}.${((i * 19) % 200) + 1}.${((i * 37) % 200) + 1}.15`,
        telemetry: { keystrokeFlightVariance: 35, formCompletionTimeMs: 14000 },
      });
    }

    const res = await app.fetch(
      new Request("http://localhost/v1/swarms/detect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shield-Key": "default_tenant",
        },
        body: JSON.stringify({
          submissions: manySubs,
          logs: '198.51.100.10 - - [14/Nov/2026:14:00:00 +0000] "POST /wp-login.php HTTP/1.1" 401 500 "-" "curl/8.4.0"\n198.51.100.10 - - [14/Nov/2026:14:00:02 +0000] "POST /wp-login.php HTTP/1.1" 401 500 "-" "curl/8.4.0"\n198.51.100.10 - - [14/Nov/2026:14:00:04 +0000] "POST /wp-login.php HTTP/1.1" 401 500 "-" "curl/8.4.0"',
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.activeSwarmCount).toBe(1);
    expect(body.swarms[0].memberCount).toBe(6);
    expect(body.swarms[0].correlatedTrafficThreats.length).toBeGreaterThanOrEqual(1);
  });

  it("uses semantic embedding similarity to link zero-lexical-overlap paraphrases across distinct IPs", () => {
    const baseTime = Date.now() - 1800_000;
    const sharedEmbedding = Array.from({ length: 64 }, (_, i) => (i < 4 ? 0.5 : 0));
    const distinctTexts = [
      "Zephyr gateway packet jitter broke staging telemetry pipelines immediately.",
      "Unreliable firmware routing corrupts enterprise cloud uptime unexpectedly.",
      "Defective hardware transceiver triggers constant timeout failures everywhere.",
    ];
    const ips = ["86.142.10.5", "195.148.20.9", "104.244.76.19"];

    const paraphrasedWithEmbeddings: RawSubmissionInput[] = distinctTexts.map((rawText, i) => ({
      wpCommentId: 9600 + i,
      entityId: "product-router-z",
      authorSessionHash: `sem-bot-${i}`,
      rawText,
      rating: 1,
      authorType: "human",
      visibility: "public",
      createdAt: new Date(baseTime + i * 120_000).toISOString(),
      ipAddress: ips[i]!,
      embedding: sharedEmbedding,
      telemetry: {
        keystrokeFlightVariance: 25 + i * 10,
        formCompletionTimeMs: 12000 + i * 2000,
        botdDetected: false,
      },
    }));

    const withoutEmbeddings = detectCoordinatedSwarms(
      paraphrasedWithEmbeddings.map(({ embedding: _e, ...rest }) => rest)
    );
    expect(withoutEmbeddings.activeSwarmCount).toBe(0);

    const result = detectCoordinatedSwarms(paraphrasedWithEmbeddings);
    expect(result.activeSwarmCount).toBe(1);
    expect(result.swarms[0]!.memberCount).toBe(3);
    expect(result.swarms[0]!.textReuseMetrics.avgPairwiseSimilarity).toBeGreaterThanOrEqual(0.45);
    expect(result.swarms[0]!.textReuseMetrics.paraphrasedVariantsDetected).toBe(true);
  });

  it("tracks multi-window temporal co-activity and burst timeline buckets", () => {
    const baseTime = Date.now() - 4 * 3600_000;
    const subs: RawSubmissionInput[] = [];
    // Same 3 accounts burst together in window 1 (t0) and window 2 (t0 + 2h)
    for (let i = 0; i < 3; i++) {
      subs.push({
        wpCommentId: 9700 + i,
        entityId: "thread-alpha",
        authorSessionHash: `coact-acc-${i}`,
        rawText: "Urgent miracle crypto yield claim now before window closes tonight!",
        createdAt: new Date(baseTime + i * 20_000).toISOString(),
        ipAddress: `185.220.101.${10 + i}`,
      });
      subs.push({
        wpCommentId: 9750 + i,
        entityId: "thread-beta",
        authorSessionHash: `coact-acc-${i}`,
        rawText: "Urgent miracle crypto yield claim now before window closes forever!",
        createdAt: new Date(baseTime + 2 * 3600_000 + i * 20_000).toISOString(),
        ipAddress: `185.220.101.${10 + i}`,
      });
    }

    const report = detectCoordinatedSwarms(subs);
    expect(report.activeSwarmCount).toBe(1);
    const swarm = report.swarms[0]!;
    expect(swarm.cadenceMetrics.coActivityWindows).toBeGreaterThanOrEqual(2);
    expect(swarm.timelineBuckets && swarm.timelineBuckets.length).toBeGreaterThanOrEqual(2);
  });

  it("parses CSV/JSON social datasets and serves /api/dashboard/swarms/import + /v1/swarms/detect CSV mode", async () => {
    const sampleCsv = generateSampleSocialDatasetCsv();
    const parsedCsv = parseSocialDataset(sampleCsv);
    expect(parsedCsv.length).toBeGreaterThanOrEqual(8);
    expect(parsedCsv.some((p) => Boolean(p.authorHandle))).toBe(true);
    expect(parsedCsv.some((p) => Boolean(p.sharedUrl))).toBe(true);
    expect(parsedCsv.some((p) => Boolean(p.deviceFingerprint))).toBe(true);

    const parsedJson = parseSocialDataset(
      JSON.stringify([
        {
          id: "p1",
          author_handle: "net_shill_01",
          text: "Switch to QuantumCoin immediately 10x gains guaranteed!",
          target_id: "x_thread_1",
          created_at: new Date().toISOString(),
          ip_address: "45.155.205.5",
        },
      ])
    );
    expect(parsedJson.length).toBe(1);
    expect(parsedJson[0]!.authorHandle).toBe("net_shill_01");

    const importRes = await app.fetch(
      new Request("http://localhost/api/dashboard/swarms/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loadSample: true, mode: "replace", onlyImported: true }),
      })
    );
    expect(importRes.status).toBe(200);
    const imported = (await importRes.json()) as any;
    expect(imported.status).toBe("imported");
    expect(imported.importedCount).toBeGreaterThanOrEqual(8);
    expect(imported.activeSwarmCount).toBeGreaterThanOrEqual(1);

    const apiCsvRes = await app.fetch(
      new Request("http://localhost/v1/swarms/detect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shield-Key": "default_tenant",
        },
        body: JSON.stringify({ csv: sampleCsv }),
      })
    );
    expect(apiCsvRes.status).toBe(200);
    const apiBody = (await apiCsvRes.json()) as any;
    expect(apiBody.activeSwarmCount).toBeGreaterThanOrEqual(1);
  });
});
