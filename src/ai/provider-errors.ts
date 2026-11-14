export class ProviderError extends Error {}

export class ProviderHttpError extends ProviderError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs: number,
    public readonly retryable: boolean,
    public readonly reason: "rate_limit" | "quota_exhausted" | "provider_error",
  ) { super(message); }
}

export async function providerHttpError(response: Response, secret: string, provider: string): Promise<ProviderHttpError> {
  const data = await response.json().catch(() => ({})) as any;
  const error = data.error || data;
  const detail = error.message || error.detail || (typeof error === "string" ? error : error.status) || error.error_code || "Provider request failed";
  const metadata = [error.error_code, data.request_id].filter(value => typeof value === "string").join("; ");
  const message = `${String(detail)}${metadata ? ` [${metadata}]` : ""}`.replaceAll(secret, "[redacted]").slice(0, 800);
  const quota = /quota|billing|credits?|budget/i.test(message) || [402, 432, 433].includes(response.status);
  const header = response.headers.get("retry-after");
  const headerMs = header ? (/^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 0;
  const retryAfterMs = Number.isFinite(headerMs) && headerMs > 0 ? Math.max(1000, headerMs) : quota ? 15 * 60000 : response.status === 429 ? 60000 : 5000;
  const retryable = response.status === 429 || response.status === 408 || response.status >= 500;
  return new ProviderHttpError(`${provider} HTTP ${response.status}: ${message}`, response.status, retryAfterMs, retryable,
    quota ? "quota_exhausted" : response.status === 429 ? "rate_limit" : "provider_error");
}

const budgets = new Map<string, { tail: Promise<void>; cooldown: { until: number; error: ProviderHttpError } | null }>();

/** Keep each provider's cooldown separate: a search quota must not block the model provider. */
export async function withProviderRequestBudget<T>(provider: string, request: () => Promise<T>): Promise<T> {
  let budget = budgets.get(provider);
  if (!budget) { budget = { tail: Promise.resolve(), cooldown: null }; budgets.set(provider, budget); }
  const previous = budget.tail;
  let release!: () => void;
  budget.tail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    if (budget.cooldown && budget.cooldown.until > Date.now()) {
      const error = budget.cooldown.error;
      throw new ProviderHttpError(error.message, error.status, budget.cooldown.until - Date.now(), error.retryable, error.reason);
    }
    try { return await request(); }
    catch (error) {
      if (error instanceof ProviderHttpError && error.status === 429) budget.cooldown = { until: Date.now() + error.retryAfterMs, error };
      throw error;
    }
  } finally { release(); }
}

export function resetProviderRequestBudgets() { budgets.clear(); }
