/**
 * Truthier Debug Logger
 * Enabled when env variable TRUTHIER_DEBUG=true, SHIELD_DEBUG=true, or DEBUG=*
 */

export function isDebugEnabled(): boolean {
  const envVal = process.env.TRUTHIER_DEBUG || process.env.SHIELD_DEBUG || process.env.DEBUG || "";
  return (
    envVal === "true" ||
    envVal === "1" ||
    envVal.toLowerCase().includes("truthier") ||
    envVal.toLowerCase().includes("shield") ||
    envVal === "*"
  );
}

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

export function debugLog(category: string, message: string, details?: any) {
  if (!isDebugEnabled()) return;

  const timestamp = new Date().toISOString().substring(11, 23);
  const prefix = `${COLORS.cyan}[TRUTHIER DEBUG ${timestamp}]${COLORS.reset} ${COLORS.bright}[${category}]${COLORS.reset}`;

  if (details !== undefined) {
    if (typeof details === "object" && details !== null) {
      console.log(`${prefix} ${message}\n${COLORS.dim}${JSON.stringify(details, null, 2)}${COLORS.reset}`);
    } else {
      console.log(`${prefix} ${message} ${COLORS.yellow}${details}${COLORS.reset}`);
    }
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function debugDecision(area: string, decision: string, context?: Record<string, any>) {
  if (!isDebugEnabled()) return;

  const timestamp = new Date().toISOString().substring(11, 23);
  const prefix = `${COLORS.magenta}[TRUTHIER DECISION ${timestamp}]${COLORS.reset} ${COLORS.bright}[${area}]${COLORS.reset}`;
  console.log(`${prefix} 🎯 ${COLORS.green}${decision}${COLORS.reset}`);

  if (context && Object.keys(context).length > 0) {
    for (const [key, val] of Object.entries(context)) {
      const valStr = typeof val === "object" ? JSON.stringify(val) : String(val);
      console.log(`   ${COLORS.dim}↳ ${key}:${COLORS.reset} ${valStr}`);
    }
  }
}
