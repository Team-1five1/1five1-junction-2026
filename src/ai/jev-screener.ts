import { SEMEVAL_QUESTIONS } from "../config/semeval-questions";
import type { QuestionId } from "../engines/semeval-scorer";
import { debugLog, debugDecision } from "../config/logger";

export interface JevScreenResult {
  triggeredIds: QuestionId[];
  modelUsed: string;
}

const SYSTEM_PROMPT = `You are a high-speed propagandistic and bot manipulation screener.
You analyze user comments/reviews and evaluate them against exactly 50 specific criteria (Q1 to Q50).
Q1-Q8: Manipulative Wording & Emotional Framing
Q9-Q17: Stereotyping, Labeling & Reputation Attacks
Q18-Q25: Fear, Prejudice & Group Identity Appeals
Q26-Q32: Oversimplification & Logical Traps
Q33-Q38: Distraction, Deflection & Disinformation Tactics
Q39-Q44: Bot Amplification, Urgency & Thought-Killers
Q45-Q50: False-Positive Shields / Benign Context Checks (Satire, Neutral Quoting, Debunking, Balanced View, Receipts, Everyday Venting)

Criteria List:
${Object.entries(SEMEVAL_QUESTIONS)
  .map(([id, q]) => `${id}: ${q.name} - ${q.description}`)
  .join("\n")}

CRITICAL INSTRUCTION:
Return ONLY a valid JSON object with a single key "triggered" containing an array of triggered IDs (e.g. {"triggered": ["Q1", "Q9"]}).
Zero prose, zero explanation, no markdown formatting outside of JSON.`;

/**
 * Pre-constructed questions map for Typesafe AI System One API.
 */
const SYSTEM_ONE_QUESTIONS: Record<string, { type: "noul"; instructions: string }> = {};
for (const [id, q] of Object.entries(SEMEVAL_QUESTIONS)) {
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
          // noul probability >= 0.5 indicates affirmative classification
          if (ansObj && typeof ansObj.noul === "number" && ansObj.noul >= 0.5) {
            if (id in SEMEVAL_QUESTIONS) {
              triggered.push(id as QuestionId);
            }
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
      ? (parsed.triggered.filter((id: string) => id in SEMEVAL_QUESTIONS) as QuestionId[])
      : [];

    debugDecision("JevScreener", `Identified ${triggered.length} triggered criteria`, {
      model,
      triggeredIds: triggered,
    });

    return {
      triggeredIds: triggered,
      modelUsed: model,
    };
  } catch (err: any) {
    console.warn(`Jev screener error (${err.message}), falling back to heuristic.`);
    return fallbackRuleScreener(text, model);
  }
}

/**
 * Intelligent heuristic fallback for testing & when offline/unkeyed.
 */
function fallbackRuleScreener(text: string, model: string): JevScreenResult {
  const triggered = new Set<QuestionId>();
  const lower = text.toLowerCase();

  // Bucket 1: Manipulative wording & emotional framing
  if (/destroy|catastroph|betray|disaster|horrible|scam|fraud/i.test(text)) triggered.add("Q1");
  if (/worst ever|literally impossible|world-ending|ruined everything/i.test(text)) triggered.add("Q2");
  if (/[A-Z]{4,}/.test(text) || /!{2,}/.test(text) || /🚨|💥|⚠️/.test(text)) triggered.add("Q4");
  if (/always|never|everyone knows|100%|guaranteed/i.test(text)) triggered.add("Q7");
  if (/parasite|pest|vermin|infestation|cancer on society/i.test(text)) triggered.add("Q8");

  // Bucket 2: Stereotyping & Cabal
  if (/idiot|clown|scumbag|crook|shill/i.test(text)) triggered.add("Q9");
  if (/all of them are|these people always|typical of that group/i.test(text)) triggered.add("Q10");
  if (/puppet master|shadowy|the regime|globalist cabal|they don't want you to know|deep state/i.test(text)) {
    triggered.add("Q17");
  }

  // Bucket 3: Fear & Identity
  if (/threat to our existence|destroy our way of life|be afraid/i.test(text)) triggered.add("Q18");
  if (/wake up|sheeple|stand with us or you're a traitor/i.test(text)) triggered.add("Q20");

  // Bucket 4: Oversimplification & Scapegoating
  if (/only one to blame|it's entirely the fault of|scapegoat/i.test(text)) triggered.add("Q27");
  if (/with us or against us|either you love .* or you hate/i.test(text)) triggered.add("Q26");

  // Bucket 6: Urgency & Bots
  if (/share before it gets deleted|act now before censorship|spread this immediately/i.test(text)) {
    triggered.add("Q41");
  }

  // Bucket 7: Shields
  if (/i'm just annoyed that|had a rough experience with my order|personally felt/i.test(text) ||
      (/hate|annoyed|bad/i.test(text) && /ordered|shipping|package|delay|refund/i.test(lower))) {
    triggered.add("Q50");
  }
  if (/according to the report|receipts:|source: http|page 4 of the filing/i.test(text)) {
    triggered.add("Q49");
  }
  if (/on one hand .* but on the other|to be fair|valid points on both sides/i.test(text)) {
    triggered.add("Q48");
  }
  if (/they claimed that ".*"|the statement said ".*"|quoting/i.test(text)) {
    triggered.add("Q46");
  }

  const triggeredArray = Array.from(triggered);
  debugDecision("JevScreener", `Identified ${triggeredArray.length} triggered criteria (Heuristic)`, {
    model,
    triggeredIds: triggeredArray,
  });

  return {
    triggeredIds: triggeredArray,
    modelUsed: model,
  };
}
