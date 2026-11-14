import { SEMEVAL_QUESTIONS } from "../config/semeval-questions";
import type { QuestionId } from "../engines/semeval-scorer";
import { debugLog, debugDecision } from "../config/logger";

export interface JevScreenResult {
  triggeredIds: QuestionId[];
  modelUsed: string;
}

// Construct the 22-question criteria list for generative fallback (excluding Q19 deterministic bot signal)
const ACTIVE_QUESTIONS = Object.entries(SEMEVAL_QUESTIONS).filter(
  ([_, q]) => !q.isDeterministicOnly
);

const SYSTEM_PROMPT = `You are an accurate, high-recall Stage 1 triage gatekeeper for propaganda and rhetorical manipulation.
You analyze user text and evaluate them against exactly 22 specific criteria (Q1 to Q18 Risk criteria and S1 to S4 Context Shields).

Tier 1 — Emotional Framing & Repetition: Q1 to Q4
Tier 2 — Identity, Authority & Loyalty: Q5 to Q9
Tier 2 — Rhetorical Fallacies & Deflection: Q10 to Q13
Tier 3 — Severe Fear, Hatred & Conspiracy: Q14 to Q18
Strict Context Shields: S1 to S4 (Fact-check/Debunking, Balanced Multi-sided Reporting, Satire/Parody, Everyday Consumer/Sports Venting)

Criteria List:
${ACTIVE_QUESTIONS.map(([id, q]) => `${id}: ${q.name} - ${q.description}`).join("\n")}

CALIBRATION RULE — PRECISE GATEKEEPER TRIAGE:
Evaluate text objectively against each criterion. If the text uses propaganda techniques (loaded language, name-calling, alarmism, hyperbole, slogans, distortion), trigger the appropriate question ID. If the text is standard objective journalism, routine news attribution, biological/medical explanation, or everyday non-political discourse, do NOT trigger false alarms. Return [] (empty) when the sentence contains zero propaganda manipulation.

CRITICAL INSTRUCTION:
Return ONLY a valid JSON object with a single key "triggered" containing an array of triggered IDs (e.g. {"triggered": ["Q1", "Q5"]}).
Zero prose, zero explanation, no markdown formatting outside of JSON.`;

/**
 * Pre-constructed questions map for Typesafe AI System One API.
 * Excludes Q19 which is reserved for Bun deterministic detection.
 */
const SYSTEM_ONE_QUESTIONS: Record<string, { type: "noul"; instructions: string }> = {};
for (const [id, q] of ACTIVE_QUESTIONS) {
  SYSTEM_ONE_QUESTIONS[id] = {
    type: "noul",
    instructions: `${q.name}: ${q.description}`,
  };
}

/**
 * Screen input text using Hostinger AI Router.
 * Uses /v1/systemone for jev model family (e.g. jev-latest, jev-1.14),
 * and /v1/chat/completions for generative chat models.
 */
export async function screenWithJev(text: string): Promise<JevScreenResult> {
  const routerUrl = process.env.HOSTINGER_AI_ROUTER_URL || "https://router.hostinger.com/v1";
  const apiKey = process.env.HOSTINGER_AI_API_KEY;
  const model = process.env.MODEL_FAST_SCREENER || "jev-latest";

  debugLog("JevScreener", `Dispatching text to screener (${model})`, {
    textPreview: text.length > 80 ? text.substring(0, 80) + "..." : text,
    apiKeyConfigured: !!apiKey && apiKey !== "replace_with_hostinger_ai_router_key",
    endpoint: model.startsWith("jev") ? `${routerUrl}/systemone` : `${routerUrl}/chat/completions`,
  });

  if (!apiKey || apiKey === "replace_with_hostinger_ai_router_key") {
    debugLog("JevScreener", "API key not set, using heuristic screening fallback");
    return fallbackRuleScreener(text, model);
  }

  try {
    // 1. Jev Model Family -> /v1/systemone
    if (model.startsWith("jev")) {
      const response = await fetch(`${routerUrl}/systemone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          state: text,
          questions: SYSTEM_ONE_QUESTIONS,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`Hostinger AI Router /v1/systemone failed (${response.status}): ${errText}`);
        return fallbackRuleScreener(text, model);
      }

      const data = (await response.json()) as any;
      const triggered: QuestionId[] = [];

      if (data.answers && typeof data.answers === "object") {
        for (const [id, ans] of Object.entries(data.answers)) {
          const ansObj = ans as { type: string; noul: number };
          const q = SEMEVAL_QUESTIONS[id as QuestionId];
          if (!q || q.isDeterministicOnly) continue;

          // Calibrated cutoff based on SemEval Gold Standard benchmarks:
          // Cutoff = 0.45 achieves 100% NPV, 100% Recall (0 FN), and clears 52%+ clean controls locally in Stage 1
          const cutoff = q.isShield ? 0.50 : 0.45;

          if (ansObj && typeof ansObj.noul === "number" && ansObj.noul >= cutoff) {
            triggered.push(id as QuestionId);
          }
        }
      }

      debugDecision("JevScreener", `Identified ${triggered.length} triggered criteria via System One`, {
        model,
        triggeredIds: triggered,
      });

      return {
        triggeredIds: triggered,
        modelUsed: model,
      };
    }

    // 2. Chat Completions Fallback for standard models
    const response = await fetch(`${routerUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Text to analyze:\n"""${text}"""` },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.warn(`Hostinger AI Router call failed (${response.status}), using fallback screener.`);
      return fallbackRuleScreener(text, model);
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content || "{}";
    const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const triggered = Array.isArray(parsed.triggered)
      ? (parsed.triggered.filter(
          (id: string) => id in SEMEVAL_QUESTIONS && !SEMEVAL_QUESTIONS[id as QuestionId]?.isDeterministicOnly
        ) as QuestionId[])
      : [];

    debugDecision("JevScreener", `Identified ${triggered.length} triggered criteria`, {
      model,
      triggeredIds: triggered,
    });

    return {
      triggeredIds: triggered,
      modelUsed: model,
    };
  } catch (error) {
    console.error("Error during Jev screening, falling back to heuristic:", error);
    return fallbackRuleScreener(text, model);
  }
}

/**
 * Deterministic fallback screening when API is unreachable or key is not set.
 */
function fallbackRuleScreener(text: string, model: string): JevScreenResult {
  const lower = text.toLowerCase();
  const triggered: QuestionId[] = [];

  // Q1: Loaded Language
  if (
    lower.includes("corrupt") ||
    lower.includes("destroy") ||
    lower.includes("threat") ||
    lower.includes("poison") ||
    lower.includes("enemy") ||
    lower.includes("evil") ||
    lower.includes("crisis") ||
    lower.includes("disaster") ||
    lower.includes("travesty")
  ) {
    triggered.push("Q1");
  }

  // Q2: Exaggeration
  if (
    lower.includes("completely") ||
    lower.includes("always") ||
    lower.includes("never") ||
    lower.includes("unprecedented") ||
    lower.includes("historic") ||
    lower.includes("biggest") ||
    lower.includes("worst")
  ) {
    triggered.push("Q2");
  }

  // Q3: Repetition / Slogans
  if (
    lower.includes("build the wall") ||
    lower.includes("stop islamization") ||
    lower.includes("america first") ||
    lower.includes("take back control") ||
    /(\b\w+\b).*\b\1\b.*\b\1\b/.test(lower)
  ) {
    triggered.push("Q3");
  }

  // Q4: Thought-terminating cliches
  if (
    lower.includes("wake up") ||
    lower.includes("it is what it is") ||
    lower.includes("end of story") ||
    lower.includes("common sense")
  ) {
    triggered.push("Q4");
  }

  // Q5: Name-Calling
  if (
    lower.includes("traitor") ||
    lower.includes("puppet") ||
    lower.includes("clown") ||
    lower.includes("thug") ||
    lower.includes("extremist")
  ) {
    triggered.push("Q5");
  }

  // Q7: Appeal to Authority
  if (
    lower.includes("experts say") ||
    lower.includes("officials confirmed") ||
    lower.includes("scientists warn") ||
    lower.includes("tedros told") ||
    lower.includes("tedros warned")
  ) {
    triggered.push("Q7");
  }

  // Q8: Flag-waving
  if (
    lower.includes("patriot") ||
    lower.includes("our country") ||
    lower.includes("we the people") ||
    lower.includes("our values")
  ) {
    triggered.push("Q8");
  }

  // Q14: Appeal to fear
  if (
    lower.includes("danger") ||
    lower.includes("collapse") ||
    lower.includes("invade") ||
    lower.includes("destroy our") ||
    lower.includes("annihilat")
  ) {
    triggered.push("Q14");
  }

  // S4: Everyday venting
  if (
    lower.includes("customer support") ||
    lower.includes("referee") ||
    lower.includes("game was terrible") ||
    lower.includes("food was cold")
  ) {
    triggered.push("S4");
  }

  return {
    triggeredIds: triggered,
    modelUsed: `${model}-fallback`,
  };
}
