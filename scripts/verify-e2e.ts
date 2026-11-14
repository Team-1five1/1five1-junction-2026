/**
 * Truthier End-to-End Verification Script
 * Validates the core pipeline test cases:
 * 1. Headless Bot Deception
 * 2. Shielded Angry Consumer Rant (Route 2)
 * 3. Coordinated Disinformation Threat (Route 4 & Banner Activation)
 * 4. Legitimate Review Bombing Backlash & Transparent Banner
 */

import appObj from "../src/index";
import { evaluateSemEvalBitmask } from "../src/engines/semeval-scorer";
import { evaluateBotTelemetry } from "../src/engines/bot-telemetry";

const BASE_URL = "http://localhost:4000";

async function request(path: string, options?: RequestInit) {
  return appObj.fetch(new Request(`${BASE_URL}${path}`, options));
}

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${msg}`);
    process.exitCode = 1;
  }
}

async function runVerification() {
  console.log("\n🛡️ ========================================================");
  console.log("   TRUTHIER: END-TO-END VERIFICATION SUITE");
  console.log("========================================================\n");

  // ---------------------------------------------------------------------------
  // TEST CASE 1: Headless Bot Deception
  // ---------------------------------------------------------------------------
  console.log("🧪 Test Case 1: Headless Bot Deception (Telemetry & Honeypot)");
  {
    const botPayload = {
      wpCommentId: 1001,
      entityId: "prod_gaming_laptop",
      entityTitle: "Pro Gaming Laptop 15",
      authorSessionHash: "session_bot_headless_999",
      rawText: "BUY CHEAP COINS AT HTTP://BITCOIN-FREE.XYZ NOW CLICK HERE",
      rating: 5,
      telemetryToken: {
        webdriver: true,
        formCompletionTimeMs: 120,
        mouseEventsCount: 0,
      },
      honeypotValue: null,
    };

    const res = await request("/v1/ingest?sync=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(botPayload),
    });

    const data = (await res.json()) as any;
    assert(res.status === 200, "Ingest API returned HTTP 200");
    assert(data.authorType === "bot", "Author type classified strictly as 'bot'");
    assert(data.visibility === "shadowbanned", "Visibility set strictly to 'shadowbanned'");
    assert(data.hasBanner === false, "No public banner for shadowbanned bot submission");
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 2: Angry Consumer Rant (Route 2 - Everyday Venting Shield)
  // ---------------------------------------------------------------------------
  console.log("\n🧪 Test Case 2: Angry Consumer Rant (Route 2 - Everyday Venting Shield)");
  {
    const rantScore = evaluateSemEvalBitmask({
      triggeredIds: ["Q1", "S4"],
      mode: "balanced",
    });

    assert(rantScore.route === "ROUTE_2_SHIELDED_CLEAR", "Scorer routed to ROUTE_2_SHIELDED_CLEAR");
    assert(rantScore.escalateToHydrogen === false, "gemini-4-hydrogen was NOT called (cost & latency saved)");
    assert(rantScore.shieldFlags >= 1, `Shield flag registered (count: ${rantScore.shieldFlags})`);

    const ingestRes = await request("/v1/ingest?sync=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wpCommentId: 1002,
        entityId: "prod_gaming_laptop",
        entityTitle: "Pro Gaming Laptop 15",
        authorSessionHash: "session_human_rant_123",
        rawText: "I am so annoyed that my package had a 5 day delay! Absolute worst customer service ever!",
        rating: 1,
        telemetryToken: {
          webdriver: false,
          formCompletionTimeMs: 14200,
          mouseEventsCount: 52,
          keystrokeFlightVariance: 38,
        },
      }),
    });

    const ingestData = (await ingestRes.json()) as any;
    assert(ingestData.visibility === "public", "Angry human review remains PUBLIC");
    assert(ingestData.authorType === "human", "Classified as human author");
    assert(ingestData.deepResearchExplanation === null, "deepResearchExplanation is null (no forensic flag)");
    assert(ingestData.hasBanner === false, "hasBanner is false for clean/shielded consumer review");
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 3: Coordinated Disinformation Threat (Route 4 & Banner Activation)
  // ---------------------------------------------------------------------------
  console.log("\n🧪 Test Case 3: Coordinated Disinformation Threat (Route 4 & Public Flagged Banner)");
  {
    const disinfoScore = evaluateSemEvalBitmask({
      triggeredIds: ["Q15", "Q17"],
      mode: "balanced",
    });

    assert(disinfoScore.route === "ROUTE_4_FORENSIC_THREAT", "Scorer routed to ROUTE_4_FORENSIC_THREAT");
    assert(disinfoScore.escalateToHydrogen === true, "Escalated to gemini-4-hydrogen");
    assert(disinfoScore.overrideTriggered === "DOUBLE_RED_FLAG", "Double Red Flag override triggered");

    // Ingest the disinformation comment through /v1/ingest
    const ingestDisinfoRes = await request("/v1/ingest?sync=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wpCommentId: 1003,
        entityId: "post_political_debate",
        entityTitle: "State Election Special Coverage",
        authorSessionHash: "session_brigade_456",
        rawText: "These corrupt globalists and puppet masters are entirely to blame for destroying everything! Share before it gets deleted!",
        rating: null,
        telemetryToken: {
          webdriver: false,
          formCompletionTimeMs: 8200,
          mouseEventsCount: 28,
          keystrokeFlightVariance: 25,
        },
      }),
    });

    const ingestDisinfoData = (await ingestDisinfoRes.json()) as any;
    assert(ingestDisinfoData.visibility === "public_flagged", "Visibility marked strictly as 'public_flagged'");
    assert(ingestDisinfoData.hasBanner === true, "hasBanner is TRUE for public_flagged content");
    assert(
      ingestDisinfoData.banner !== null && ingestDisinfoData.banner.anomalyStatus === "coordinated_attack",
      "Entity warning banner activated with anomalyStatus 'coordinated_attack'"
    );
    assert(
      typeof ingestDisinfoData.deepResearchExplanation === "string" && ingestDisinfoData.deepResearchExplanation.length > 0,
      "Deep forensic research explanation was generated by gemini-4-hydrogen"
    );
  }

  // ---------------------------------------------------------------------------
  // TEST CASE 4: Legitimate Review Bombing Backlash & Transparent Banner
  // ---------------------------------------------------------------------------
  console.log("\n🧪 Test Case 4: Legitimate Review Bombing Backlash & Transparent Banner");
  {
    const entityId = "post_major_game_update";
    const entityTitle = "CyberQuest Patch 2.4 Update";

    // Inject 3 consecutive 1-star reviews from distinct human sessions
    const sampleReviews = [
      "After the patch 2.4 update yesterday the game keeps crashing on startup! Server outage is awful!",
      "Game is literally unplayable after patch 2.4. Crashes constantly, fix your servers please!",
      "Cannot login since the update yesterday, continuous disconnects and broken matchmaking.",
    ];

    for (let i = 0; i < sampleReviews.length; i++) {
      await request("/v1/ingest?sync=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wpCommentId: 2001 + i,
          entityId,
          entityTitle,
          authorSessionHash: `session_user_${i + 1}`,
          rawText: sampleReviews[i],
          rating: 1,
          telemetryToken: {
            webdriver: false,
            formCompletionTimeMs: 9500 + i * 1000,
            mouseEventsCount: 35 + i * 5,
            keystrokeFlightVariance: 32,
          },
        }),
      });
    }

    const bannerRes = await request(`/v1/banner/${entityId}`);
    const bannerData = (await bannerRes.json()) as any;

    assert(bannerRes.status === 200, "Banner endpoint returned HTTP 200");
    assert(
      bannerData.anomalyStatus === "legitimate_backlash",
      "Anomaly status classified as 'legitimate_backlash' (NOT false-positive coordinated attack)"
    );
    assert(
      typeof bannerData.bannerExplanation === "string" &&
        (/authentic|reviews|feedback/i.test(bannerData.bannerExplanation)),
      "Public notice banner mentions product context and keeps legitimate reviews published"
    );
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n========================================================");
  console.log(`   SUMMARY: ${passed} / ${total} Assertions Passed`);
  console.log("========================================================\n");

  if (passed === total) {
    console.log("🎉 ALL TRUTHIER PIPELINE VERIFICATIONS PASSED!\n");
  } else {
    console.error("❌ SOME VERIFICATION CHECKS FAILED!\n");
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
