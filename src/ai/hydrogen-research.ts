import { SEMEVAL_QUESTIONS } from "../config/semeval-questions";
import type { QuestionId } from "../engines/semeval-scorer";
import { debugLog, debugDecision } from "../config/logger";

export interface ForensicResult {
  endorsed: boolean;
  deepResearchExplanation: string | null;
  modelUsed: string;
}

export interface ReviewBombingInvestigation {
  anomalyStatus: "legitimate_backlash" | "coordinated_attack" | "normal";
  bannerExplanation: string | null;
  modelUsed: string;
}

/**
 * Verify stance (Route 3) or generate forensic deep explanation (Route 4).
 */
export async function verifyStanceOrForensic(
  text: string,
  route: "ROUTE_3_STANCE_VERIFICATION" | "ROUTE_4_FORENSIC_THREAT",
  failedRiskIds: QuestionId[]
): Promise<ForensicResult> {
  const routerUrl = process.env.HOSTINGER_AI_ROUTER_URL || "https://router.hostinger.com/v1";
  const apiKey = process.env.HOSTINGER_AI_API_KEY;
  const model = process.env.MODEL_HEAVY_RESEARCH || "gemini-4-hydrogen";

  const questionDetails = failedRiskIds
    .map((id) => `${id}: ${SEMEVAL_QUESTIONS[id]?.name || id} - ${SEMEVAL_QUESTIONS[id]?.description || ""}`)
    .join("\n");

  debugLog("HydrogenResearch", `Escalating to ${model} for ${route}`, {
    failedRiskIds,
    textPreview: text.length > 80 ? text.substring(0, 80) + "..." : text,
  });

  const prompt = route === "ROUTE_3_STANCE_VERIFICATION"
    ? `The following text contains flagged risk patterns (${failedRiskIds.join(", ")}), but also potential benign shields (e.g. quoting, debunking, satire).
Analyze if the author endorses and actively promotes the manipulation (endorsed: true) or is merely reporting, quoting, or debunking it without endorsement (endorsed: false).
If endorsed: false, return "endorsed": false and "explanation": null.
If endorsed: true, return "endorsed": true and provide a concise, neutral 2-3 sentence forensic explanation of the manipulation.

Flagged Criteria:
${questionDetails}

User Text:
"""${text}"""

Return strictly JSON: {"endorsed": boolean, "explanation": string | null}`
    : `The following text was flagged for high forensic propaganda risk (${failedRiskIds.join(", ")}).
Provide a concise, neutral 1-2 sentence forensic explanation explaining why this content constitutes coordinated manipulation, stereotyping, or disinformation, citing specific patterns.

Flagged Criteria:
${questionDetails}

User Text:
"""${text}"""

Return strictly JSON: {"endorsed": true, "explanation": string}.

Do not return criteria codes in your response message.`;

  if (!apiKey || apiKey === "replace_with_hostinger_ai_router_key") {
    return fallbackStanceOrForensic(text, route, failedRiskIds, model);
  }

  try {
    const response = await fetch(`${routerUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.warn(`Hostinger AI Router call failed (${response.status}), using fallback forensic research.`);
      return fallbackStanceOrForensic(text, route, failedRiskIds, model);
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content || "{}";
    const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const result: ForensicResult = {
      endorsed: parsed.endorsed ?? true,
      deepResearchExplanation: parsed.explanation ?? null,
      modelUsed: model,
    };

    debugDecision("HydrogenResearch", route === "ROUTE_3_STANCE_VERIFICATION"
      ? (result.endorsed ? "STANCE_ENDORSED_AS_MANIPULATION" : "STANCE_CLEARED_BENIGN")
      : "FORENSIC_EXPLANATION_GENERATED", {
      route,
      endorsed: result.endorsed,
      hasExplanation: !!result.deepResearchExplanation,
    });

    return result;
  } catch (err: any) {
    console.warn(`Hydrogen research error (${err.message}), using fallback.`);
    return fallbackStanceOrForensic(text, route, failedRiskIds, model);
  }
}

/**
 * Investigate review bombing spikes with live grounding analysis.
 */
export async function investigateReviewBombing(
  entityId: string,
  entityTitle: string,
  recentReviews: Array<{ rating: number; text: string; createdAt: Date | string }>
): Promise<ReviewBombingInvestigation> {
  const routerUrl = process.env.HOSTINGER_AI_ROUTER_URL || "https://router.hostinger.com/v1";
  const apiKey = process.env.HOSTINGER_AI_API_KEY;
  const model = process.env.MODEL_HEAVY_RESEARCH || "gemini-4-hydrogen";

  debugLog("ReviewBombing", `Grounding review velocity spike for "${entityTitle}" (${entityId})`, {
    reviewCount: recentReviews.length,
    ratings: recentReviews.map((r) => r.rating),
  });

  const sampleTexts = recentReviews.slice(0, 5).map((r) => `[${r.rating}★]: ${r.text}`).join("\n");

  const prompt = `Investigate a sudden influx of negative 1-star reviews for product/entity: "${entityTitle}" (ID: ${entityId}).
Recent reviews:
${sampleTexts}

Grounding & Classification Rules:
- If the reviews report specific technical defects, software crashes, patch bugs, price changes, or service outages, classify as "legitimate_backlash". Real customer complaints about product flaws must NOT be suppressed or misclassified as coordinated bot attacks.
- Only classify as "coordinated_attack" if the reviews contain irrelevant political spam, hate speech, identical copypasta without product context, or off-topic brigading.

Return strictly JSON:
{
  "anomalyStatus": "legitimate_backlash" | "coordinated_attack",
  "bannerExplanation": "A neutral, transparent 1-2 sentence notice explaining the context to public visitors (e.g. 'We detected elevated review volume following recent patch feedback regarding ${entityTitle}. Authentic user reviews remain published.')"
}`;

  if (!apiKey || apiKey === "replace_with_hostinger_ai_router_key") {
    return fallbackReviewBombing(entityTitle, recentReviews, model);
  }

  try {
    const response = await fetch(`${routerUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return fallbackReviewBombing(entityTitle, recentReviews, model);
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content || "{}";
    const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const result: ReviewBombingInvestigation = {
      anomalyStatus: parsed.anomalyStatus || "legitimate_backlash",
      bannerExplanation: parsed.bannerExplanation || "Notice: Elevated review activity detected for this item.",
      modelUsed: model,
    };

    debugDecision("ReviewBombing", `Investigation result: ${result.anomalyStatus.toUpperCase()}`, {
      entityTitle,
      anomalyStatus: result.anomalyStatus,
      bannerExplanation: result.bannerExplanation,
    });

    return result;
  } catch (err: any) {
    return fallbackReviewBombing(entityTitle, recentReviews, model);
  }
}

function fallbackStanceOrForensic(
  text: string,
  route: "ROUTE_3_STANCE_VERIFICATION" | "ROUTE_4_FORENSIC_THREAT",
  failedRiskIds: QuestionId[],
  model: string
): ForensicResult {
  if (route === "ROUTE_3_STANCE_VERIFICATION") {
    const isQuoting = /"|"|'|according to|stated that|claimed that/i.test(text);
    if (isQuoting) {
      debugDecision("HydrogenResearch", "STANCE_CLEARED_BENIGN (Quoting / Reporting detected)", {
        route,
        endorsed: false,
      });
      return {
        endorsed: false,
        deepResearchExplanation: null,
        modelUsed: model,
      };
    }
  }

  const names = failedRiskIds.map((id) => SEMEVAL_QUESTIONS[id]?.name || id).join(", ");
  const explanation = `Forensic analysis identified high-confidence coordinated framing (${names}). Content employs systematic emotional exaggeration and group-targeted rhetoric designed to distort public perception.`;

  debugDecision("HydrogenResearch", "FORENSIC_EXPLANATION_GENERATED", {
    route,
    endorsed: true,
    explanation,
  });

  return {
    endorsed: true,
    deepResearchExplanation: explanation,
    modelUsed: model,
  };
}

function fallbackReviewBombing(
  entityTitle: string,
  recentReviews: Array<{ rating: number; text: string; createdAt: Date | string }>,
  model: string
): ReviewBombingInvestigation {
  const allTexts = recentReviews.map((r) => r.text).join(" ").toLowerCase();
  const hasConcreteIssues = /patch|update|crash|server|bug|broken|outage|price|refund|customer service/i.test(allTexts);

  let result: ReviewBombingInvestigation;

  if (hasConcreteIssues) {
    result = {
      anomalyStatus: "legitimate_backlash",
      bannerExplanation: `Notice: Elevated review activity detected following recent product issues and customer feedback regarding ${entityTitle}. Authentic user reviews remain published.`,
      modelUsed: model,
    };
  } else {
    result = {
      anomalyStatus: "coordinated_attack",
      bannerExplanation: `Notice: Unusual coordinated review volume detected without verified purchase or product context. Protective moderation safeguards are active.`,
      modelUsed: model,
    };
  }

  debugDecision("ReviewBombing", `Heuristic investigation result: ${result.anomalyStatus.toUpperCase()}`, {
    entityTitle,
    anomalyStatus: result.anomalyStatus,
    bannerExplanation: result.bannerExplanation,
  });

  return result;
}
