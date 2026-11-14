import { ProviderError, providerHttpError } from "./provider-errors";
export { ProviderError } from "./provider-errors";

export async function routerRequest(path: string, body?: unknown): Promise<any> {
  const key = process.env.HOSTINGER_AI_API_KEY;
  if (!key || key.startsWith("replace_")) throw new ProviderError("AI router credentials are not configured");
  const url = (process.env.HOSTINGER_AI_ROUTER_URL || "https://router.hostinger.com/v1").replace(/\/$/, "");
  const response = await fetch(`${url}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 45000)),
  });
  if (!response.ok) throw await providerHttpError(response, key, "Hostinger AI Router");
  return response.json();
}

export function parseModelJson(data: any): unknown {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new ProviderError("AI router returned no text output");
  try { return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); }
  catch { throw new ProviderError("AI router returned invalid JSON"); }
}
