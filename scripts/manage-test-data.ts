import { seedDemoData, clearDemoData, type ClearMode } from "../src/routes/dashboard-api";

const action = process.argv[2] || "seed";
const isAll =
  process.argv.includes("--all") ||
  action === "all" ||
  action === "clear:all" ||
  action === "clear-all";
const isNonSeed =
  process.argv.includes("--non-seed") ||
  process.argv.includes("--keep-seed") ||
  action === "non-seed" ||
  action === "clear:non-seed" ||
  action === "clear-non-seed";

const clearMode: ClearMode = isAll ? "all" : isNonSeed ? "non-seed" : "seed";
const apiPort = process.env.PORT || "4000";
const apiUrl = `http://127.0.0.1:${apiPort}`;

async function main() {
  const isClearAction = action.startsWith("clear") || action === "delete" || action === "all" || action === "non-seed";

  // 1. Try hitting the live running server first so both DB and in-memory state update immediately
  try {
    if (isClearAction) {
      const res = await fetch(`${apiUrl}/api/dashboard/seed?mode=${clearMode}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`Cleared data (mode: ${clearMode}) via running server (${apiUrl}):`, data);
        process.exit(0);
      }
    } else {
      const res = await fetch(`${apiUrl}/api/dashboard/seed`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`Seeded test data via running server (${apiUrl}):`, data);
        process.exit(0);
      }
    }
  } catch {
    // Server not running locally on port, run directly against DB
  }

  // 2. Fallback: run directly against PostgreSQL
  if (isClearAction) {
    const res = await clearDemoData(clearMode);
    console.log(`Cleared data directly (mode: ${clearMode}):`, res);
  } else {
    const res = await seedDemoData(true);
    console.log("Seeded test data directly:", res);
  }
  process.exit(0);
}

main();
