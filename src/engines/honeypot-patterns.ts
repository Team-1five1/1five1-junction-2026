import { createHash } from "node:crypto";

/** Exact template clustering only. A match is evidence to inspect, never a human shadowban rule. */
export function honeypotPatternId(text: string): string {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/https?:\/\/\S+/g, "<url>").replace(/\s+/g, " ").trim();
  return `template_${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
}
