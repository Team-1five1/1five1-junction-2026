import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { screenWithJev } from "../src/ai/jev-screener";
import { verifyStanceOrForensic, investigateReviewBombing } from "../src/ai/grounded-research";
import { groundedGenerate } from "../src/ai/web-grounding";
import { analyzeText } from "../src/workers/evaluation-worker";
import { resetProviderRequestBudgets } from "../src/ai/provider-errors";

const realFetch = globalThis.fetch, original = { ...process.env };
const url = "https://example.org/original-transcript";
const source = { title: "Original transcript", url };
let requests: Array<{ url: string; body: any; headers: any }>;
let replies: unknown[], searchResults: any[], extracted: any[], searchError: Response | null;
const answers = (ids: string[], needsWebSearch = false) => ({ answers: { ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`Q${i + 1}`, { noul: ids.includes(`Q${i + 1}`) ? 0.95 : 0.05 }])), needsFactCheck: { noul: 0.05 }, needsWebSearch: { noul: needsWebSearch ? 0.95 : 0.05 } } });
const verdict = (overrides = {}) => ({ endorsed: false, explanation: null, sufficientEvidence: true, claimChecks: [], quoteChecks: [], sourceUrls: [url], ...overrides });
const chat = (value: unknown) => ({ model: "gpt-5-nano", choices: [{ message: { content: JSON.stringify(value) } }] });
const modelRequests = () => requests.filter(r => r.url.endsWith("/chat/completions"));
beforeEach(() => {
  resetProviderRequestBudgets(); requests = []; replies = []; searchError = null;
  searchResults = [{ ...source, content: "Search excerpt describing the original statement." }];
  extracted = [{ url, raw_content: "Complete original passage: the speaker rejects the assertion that All people are parasites. Context and qualifications follow." }];
  process.env.HOSTINGER_AI_API_KEY = "test-router-key";
  process.env.HOSTINGER_AI_ROUTER_URL = "https://router.hostinger.com/v1";
  process.env.CONTEXT_DEV_API_KEY = "test-search-key";
  process.env.MODEL_FAST_SCREENER = "jev-latest";
  process.env.MODEL_HEAVY_RESEARCH = "gpt-5-nano";
  globalThis.fetch = (async (input: any, init: any) => {
    requests.push({ url: String(input), body: JSON.parse(init.body), headers: init.headers });
    if (String(input) === "https://api.context.dev/v1/web/search") return searchError || Response.json({ results: searchResults.map(r => ({ ...r, description: r.content, markdown: { code: "SUCCESS", markdown: extracted.find(page => page.url === r.url)?.raw_content ?? "", finalDOMState: "loaded" } })) });
    if (String(input) === "https://api.context.dev/v1/news/search") return Response.json({ data: [] });
    if (String(input) === "https://api.context.dev/v1/web/scrape") {
      const page = extracted.find(r => r.url === JSON.parse(init.body).url);
      return Response.json({ markdown: { success: !!page, data: page?.raw_content ?? null } });
    }
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : Response.json(next);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; process.env = { ...original }; resetProviderRequestBudgets(); });

describe("Screener", () => {
  it("evaluates all fifty criteria through Hostinger System One", async () => {
    replies.push(answers(["Q1", "Q50"]));
    expect((await screenWithJev("complaint")).triggeredIds).toEqual(["Q1", "Q50"]);
    expect(Object.keys(requests[0]!.body.questions)).toHaveLength(52);
    expect(requests[0]!.url).toBe("https://router.hostinger.com/v1/systemone");
  });
  it("rejects missing answers instead of clearing content", async () => {
    replies.push({ answers: { Q1: { noul: 0.9 } } });
    await expect(screenWithJev("text")).rejects.toThrow("invalid answer");
  });
});

describe("Context.dev + Hostinger research", () => {
  it("searches Context.dev before sending supplied evidence to Hostinger", async () => {
    replies.push(chat(verdict()));
    const result = await verifyStanceOrForensic("Reporting a claim", "ROUTE_3_STANCE_VERIFICATION", ["Q8"], [], { searchRequested: true });
    expect(requests[0]!.url).toBe("https://api.context.dev/v1/web/search");
    expect(requests[0]!.headers.Authorization).toBe("Bearer test-search-key");
    expect(modelRequests()[0]!.url).toBe("https://router.hostinger.com/v1/chat/completions");
    expect(modelRequests()[0]!.headers.Authorization).toBe("Bearer test-router-key");
    expect(modelRequests()[0]!.body.model).toBe("gpt-5-nano");
    expect(JSON.parse(modelRequests()[0]!.body.messages[1].content).sources[0].content).toContain("original statement");
    expect(modelRequests()[0]!.body.tools).toBeUndefined();
    expect(result.sources).toEqual([source]);
    expect(result.researchStatus).toBe("verified");
  });
  it("requires Context.dev configuration instead of pretending to browse", async () => {
    delete process.env.CONTEXT_DEV_API_KEY;
    await expect(groundedGenerate("Research", {})).rejects.toThrow("CONTEXT_DEV_API_KEY");
    expect(requests).toHaveLength(0);
  });
  it("does not manufacture research after a model network error", async () => {
    replies.push(new Error("offline"));
    await expect(verifyStanceOrForensic("text", "ROUTE_4_FORENSIC_THREAT", ["Q8"], [], { searchRequested: true })).rejects.toThrow("offline");
  });
  it("rejects model-invented citations", async () => {
    replies.push(chat(verdict({ sourceUrls: ["https://invented.org/claim"] })));
    await expect(verifyStanceOrForensic("text", "ROUTE_3_STANCE_VERIFICATION", ["Q8"], [], { searchRequested: true })).rejects.toThrow("without provider grounding");
  });
  it("requires an explanation for confirmed manipulation", async () => {
    replies.push(chat(verdict({ endorsed: true })));
    await expect(verifyStanceOrForensic("text", "ROUTE_4_FORENSIC_THREAT", ["Q8"], [], { searchRequested: true })).rejects.toThrow("lacks an explanation");
  });
  it("clears benign material on route four after research", async () => {
    replies.push(answers(["Q8", "Q17", "Q41"], true), chat(verdict()));
    const result = await analyzeText("A neutral report", "balanced");
    expect(result.route).toBe("ROUTE_4_FORENSIC_THREAT");
    expect(result.visibility).toBe("public");
    expect(result.deepResearchExplanation).toBeNull();
  });
  it("keeps shielded reviews on the fast screener without web research", async () => {
    replies.push(answers(["Q1", "Q2", "Q4", "Q7", "Q9", "Q50"]));
    const result = await analyzeText("angry customer review", "balanced");
    expect(result.route).toBe("ROUTE_2_SHIELDED_CLEAR");
    expect(result.researchEvidence).toBeNull();
    expect(requests).toHaveLength(1);
  });
  it("passes shield IDs to the research model", async () => {
    replies.push(answers(["Q8", "Q17", "Q18", "Q27", "Q46", "Q47"], true), chat(verdict()));
    const result = await analyzeText("Debunking a claim", "balanced");
    expect(result.route).toBe("ROUTE_3_STANCE_VERIFICATION");
    expect(JSON.parse(modelRequests()[0]!.body.messages[1].content).input.triggeredShieldIds).toEqual(["Q46", "Q47"]);
    expect(result.visibility).toBe("public");
  });
  it("rejects unexecuted tool calls from the research model", async () => {
    replies.push({ choices: [{ message: { tool_calls: [{ function: { name: "search", arguments: "{}" } }] } }] });
    await expect(groundedGenerate("Research", {})).rejects.toThrow("unexecuted tool calls");
  });
  it("propagates Context.dev rate limits with their retry hint", async () => {
    searchError = Response.json({ detail: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": "60" } });
    await expect(groundedGenerate("Research", {})).rejects.toMatchObject({ status: 429, retryAfterMs: 60000 });
    expect(modelRequests()).toHaveLength(0);
  });
});

describe("Original quote context", () => {
  const text = 'A speaker said "All people are parasites" yesterday.';
  const check = { quote: "All people are parasites", status: "out_of_context", sourceUrls: [url], context: "The original source rejects this statement in the following sentence." };
  it("extracts original pages before confirming an out-of-context quotation", async () => {
    const value = verdict({ endorsed: true, explanation: "The excerpt omits the speaker's rejection of the claim.", quoteChecks: [check] });
    replies.push(chat(value), chat(value));
    const result = await verifyStanceOrForensic(text, "ROUTE_3_STANCE_VERIFICATION", ["Q8"], [], { searchRequested: true });
    expect(requests.filter(r => r.url.endsWith("/web/search"))).toHaveLength(1);
    expect(requests.filter(r => r.url.endsWith("/web/scrape"))).toHaveLength(0);
    expect(modelRequests()).toHaveLength(1);
    expect(JSON.parse(modelRequests()[0]!.body.messages[1].content).sources[0].rawContent).toContain("Complete original passage");
    expect(result.endorsed).toBe(true);
    expect(result.quoteChecks[0]!.status).toBe("out_of_context");
  });
  it("does not verify context from search snippets when extraction fails", async () => {
    const value = verdict({ endorsed: true, explanation: "Misleading excerpt", quoteChecks: [check] });
    replies.push(chat(value), chat(verdict({ ...value, sourceUrls: [], quoteChecks: [{ ...check, sourceUrls: [] }] })));
    extracted = [];
    const result = await verifyStanceOrForensic(text, "ROUTE_3_STANCE_VERIFICATION", ["Q8"], [], { searchRequested: true });
    expect(result.flagged).toBe(true);
    expect(result.deepResearchExplanation).toContain("unsubstantiated");
    expect(result.quoteChecks[0]!.status).toBe("unverified");
  });
  it("cannot silently skip a quotation in the submitted text", async () => {
    replies.push(chat(verdict()), chat(verdict()));
    const result = await verifyStanceOrForensic(text, "ROUTE_3_STANCE_VERIFICATION", ["Q8"], [], { searchRequested: true });
    expect(result.quoteChecks[0]!.quote).toBe("All people are parasites");
    expect(result.researchStatus).toBe("unverified");
  });
  it("keeps accurate quotation and counterspeech public", async () => {
    const value = verdict({ quoteChecks: [{ ...check, status: "in_context", context: "The complete source supports the author's debunking." }] });
    replies.push(chat(value), chat(value));
    const result = await verifyStanceOrForensic(text, "ROUTE_3_STANCE_VERIFICATION", ["Q8"], [], { searchRequested: true });
    expect(result.endorsed).toBe(false);
    expect(result.deepResearchExplanation).toBeNull();
  });
  it("also checks single-quoted statements", async () => {
    replies.push(chat(verdict()), chat(verdict()));
    const result = await verifyStanceOrForensic("A speaker said 'All people are parasites' yesterday.", "ROUTE_3_STANCE_VERIFICATION", ["Q8"], [], { searchRequested: true });
    expect(result.quoteChecks[0]!.quote).toBe("All people are parasites");
    expect(result.researchStatus).toBe("unverified");
  });
});

describe("Review context", () => {
  it("uses Context.dev evidence and the Hostinger model for review context", async () => {
    replies.push(chat({ anomalyStatus: "legitimate_backlash", bannerExplanation: "Reviews follow a patch.", sourceUrls: [url] }));
    const result = await investigateReviewBombing("1", "Game", []);
    expect(result.sources).toEqual([source]);
    expect(result.anomalyStatus).toBe("legitimate_backlash");
    expect(requests[0]!.body.freshness).toBe("last_week");
  });
  it("missing news is not evidence of coordination", async () => {
    searchResults = [];
    replies.push(chat({ anomalyStatus: "normal", bannerExplanation: null, sourceUrls: [] }));
    expect((await investigateReviewBombing("1", "Game", [])).anomalyStatus).toBe("normal");
  });
  it("rejects a review banner using invented sources", async () => {
    replies.push(chat({ anomalyStatus: "coordinated_attack", bannerExplanation: "A raid", sourceUrls: ["https://invented.org/raid"] }));
    await expect(investigateReviewBombing("1", "Game", [])).rejects.toThrow("without provider grounding");
  });
});
