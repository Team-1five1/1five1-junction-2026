import { Hono } from "hono";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { apiRouter } from "./routes/api";
import { dashboardApiRouter } from "./routes/dashboard-api";
import { startWorker } from "./workers/evaluation-worker";

const app = new Hono();
const PORT = parseInt(process.env.PORT || "4000", 10);
const START_TIME = new Date();

let cachedBundleJs: string | null = null;

async function getDashboardBundle(): Promise<string> {
  if (cachedBundleJs && process.env.NODE_ENV === "production") {
    return cachedBundleJs;
  }
  const buildResult = await Bun.build({
    entrypoints: [join(import.meta.dir, "dashboard/client.tsx")],
    target: "browser",
    minify: false,
  });
  if (!buildResult.success || buildResult.outputs.length === 0) {
    const logs = buildResult.logs.map((l) => l.message).join("\n");
    throw new Error(`Dashboard bundle build failed:\n${logs}`);
  }
  cachedBundleJs = await buildResult.outputs[0].text();
  return cachedBundleJs;
}

function getGitInfo() {
  try {
    const commit = execSync("git rev-parse --short HEAD 2>/dev/null", { encoding: "utf8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf8" }).trim();
    const commitMsg = execSync("git log -1 --pretty=%B 2>/dev/null", { encoding: "utf8" }).trim();
    const commitDate = execSync("git log -1 --pretty=%cd --date=iso 2>/dev/null", { encoding: "utf8" }).trim();
    return { commit, branch, commitMsg, commitDate };
  } catch {
    return { commit: "unknown", branch: "unknown", commitMsg: "unknown", commitDate: "unknown" };
  }
}

// Health check endpoint
app.get("/api/health", (c) => {
  const uptimeSeconds = Math.floor((Date.now() - START_TIME.getTime()) / 1000);
  const memoryUsage = process.memoryUsage();
  return c.json({
    status: "healthy",
    uptimeSeconds,
    startTime: START_TIME.toISOString(),
    memoryUsage: {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers,
    },
    bunVersion: Bun.version,
  });
});

app.get("/api/version", (c) => {
  const git = getGitInfo();
  return c.json({
    version: "2.0.0",
    commit: git.commit,
    branch: git.branch,
    commitDate: git.commitDate,
    bunVersion: Bun.version,
  });
});

app.get("/api/info", (c) => {
  const git = getGitInfo();
  return c.json({
    service: "truthier-api",
    version: "2.0.0",
    engine: "SemEval-50 + Hostinger AI Router (jev & gemini-4-hydrogen)",
    bunVersion: Bun.version,
    git,
    startedAt: START_TIME.toISOString(),
  });
});

// GitHub Push Webhook endpoint for auto-sync
app.post("/api/webhook", (c) => {
  console.log(`[${new Date().toISOString()}] Received webhook request`);
  try {
    const pullOutput = execSync("git pull origin main 2>&1", { encoding: "utf8" });
    if (pullOutput.includes("package.json")) {
      execSync("bun install", { stdio: "inherit" });
    }
    return c.json({ status: "updated", output: pullOutput });
  } catch (err: any) {
    return c.json({ status: "error", error: err.message }, 500);
  }
});

// Mount Truthier V1 API Routes & Dashboard Analytics Routes
app.route("/", apiRouter);
app.route("/", dashboardApiRouter);

// Serve compiled shadcn/ui + Tailwind v4 CSS
app.get("/assets/dashboard.css", (c) => {
  const cssPath = join(import.meta.dir, "dashboard/compiled.css");
  const css = readFileSync(cssPath, "utf8");
  return new Response(css, {
    headers: { "Content-Type": "text/css; charset=utf-8" },
  });
});

// Serve bundled React + shadcn/ui Dashboard client
app.get("/assets/dashboard.js", async (c) => {
  const js = await getDashboardBundle();
  return new Response(js, {
    headers: { "Content-Type": "application/javascript; charset=utf-8" },
  });
});

// Root shadcn/ui Dashboard UI
app.get("/", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Truthier &bull; Bot &amp; Propaganda Telemetry Dashboard</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="/assets/dashboard.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
</head>
<body class="min-h-screen bg-background text-foreground antialiased">
  <div id="root"></div>
  <script type="module" src="/assets/dashboard.js"></script>
</body>
</html>`;

  return c.html(html);
});

// Start BullMQ background worker if Redis is reachable
startWorker();

export default {
  port: PORT,
  fetch: app.fetch,
};

console.log(`🛡️ Truthier Bun API & Dashboard running at http://localhost:${PORT}`);
