import { seedDemoData, clearDemoData } from "../src/routes/dashboard-api";

const action = process.argv[2] || "seed";
const clearAll = process.argv.includes("--all");
const apiPort = process.env.PORT || "4000";
const apiUrl = `http://127.0.0.1:${apiPort}`;

async function main() {
  // 1. Try hitting the live running server first so both DB and in-memory state update immediately
  try {
    if (action === "clear" || action === "delete") {
      const res = await fetch(`${apiUrl}/api/dashboard/seed${clearAll ? "?all=true" : ""}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`Cleared test data via running server (${apiUrl}):`, data);
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
  if (action === "clear" || action === "delete") {
    const res = await clearDemoData(clearAll);
    console.log("Cleared test data directly:", res);
  } else {
    const res = await seedDemoData(true);
    console.log("Seeded test data directly:", res);
  }
  process.exit(0);
}

main();
