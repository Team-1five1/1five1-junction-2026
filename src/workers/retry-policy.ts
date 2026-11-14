import { ProviderHttpError } from "../ai/provider-errors";

export const MAX_JOB_FAILURES = 5;
export function retryDelay(error: unknown, attempt: number) {
  if (error instanceof ProviderHttpError) return error.retryable ? error.retryAfterMs : -1;
  return Math.min(60000, 5000 * 2 ** Math.max(0, attempt - 1));
}
