import { Hono } from "hono";
import { execSync } from "child_process";
import { apiRouter } from "./routes/api";
import { startWorker } from "./workers/evaluation-worker";

const app = new Hono();
const PORT = parseInt(process.env.PORT || "4000", 10);
const START_TIME = new Date();

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

// Mount Truthier V1 API Routes
app.route("/", apiRouter);

// Root Dashboard UI
app.get("/", (c) => {
  const git = getGitInfo();
  const uptimeSec = Math.floor((Date.now() - START_TIME.getTime()) / 1000);
  const uptimeStr = `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Truthier &bull; Bot & Propaganda Defense</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text-main: #f9fafb;
      --text-muted: #9ca3af;
      --accent: #38bdf8;
      --green: #34d399;
      --orange: #fb923c;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      width: 100%;
      max-width: 680px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .badge {
      font-size: 28px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .status-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--green);
      background: rgba(52, 211, 153, 0.1);
      border: 1px solid rgba(52, 211, 153, 0.2);
      padding: 4px 10px;
      border-radius: 9999px;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: var(--green);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--green);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
    }
    .card-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .card-val {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-main);
      font-family: monospace;
    }
    .routes-box {
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 18px;
      margin-bottom: 24px;
    }
    .route-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 13px;
    }
    .route-row:last-child { border-bottom: none; }
    .tag {
      font-size: 11px;
      font-family: monospace;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
    }
    .tag-blue { color: var(--accent); background: rgba(56, 189, 248, 0.1); }
    .tag-green { color: var(--green); background: rgba(52, 211, 153, 0.1); }
    .tag-orange { color: var(--orange); background: rgba(251, 146, 60, 0.1); }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--text-muted);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title-group">
        <span class="badge">🛡️</span>
        <div>
          <h1>Truthier</h1>
          <p style="color: var(--text-muted); font-size: 13px;">Coordinated Propaganda & Bot Defense &bull; v2.0</p>
        </div>
      </div>
      <div class="status-badge">
        <div class="pulse-dot"></div>
        Active
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">Runtime & Engine</div>
        <div class="card-val">Bun v${Bun.version} &bull; Hono</div>
      </div>
      <div class="card">
        <div class="card-label">Fast Screener</div>
        <div class="card-val">${process.env.MODEL_FAST_SCREENER || "jev"}</div>
      </div>
      <div class="card">
        <div class="card-label">Forensic Heavy Model</div>
        <div class="card-val">${process.env.MODEL_HEAVY_RESEARCH || "gemini-4-hydrogen"}</div>
      </div>
      <div class="card">
        <div class="card-label">Git Commit</div>
        <div class="card-val">${git.commit} (${git.branch})</div>
      </div>
    </div>

    <div class="routes-box">
      <h3 style="font-size: 14px; margin-bottom: 12px; text-transform: uppercase; color: var(--text-muted);">Inspection Pipeline</h3>
      <div class="route-row">
        <span>Headless Bot Interceptor</span>
        <span class="tag tag-blue">&lt;2ms Telemetry / Honeypot</span>
      </div>
      <div class="route-row">
        <span>Deterministic 50-Question Scorer</span>
        <span class="tag tag-green">SemEval-50 Bitmask + Synergy</span>
      </div>
      <div class="route-row">
        <span>Route 1 / Route 2</span>
        <span class="tag tag-green">Fast Clear & Shielded Consumer Venting</span>
      </div>
      <div class="route-row">
        <span>Route 3 / Route 4</span>
        <span class="tag tag-orange">gemini-4-hydrogen Forensic & Stance Check</span>
      </div>
      <div class="route-row">
        <span>Review Bombing Defense</span>
        <span class="tag tag-blue">Live Grounding & Transparent Notice</span>
      </div>
    </div>

    <div class="footer">
      <div>Endpoints: <span class="tag">/v1/ingest</span> <span class="tag">/v1/analyze</span></div>
      <div>Uptime: <span class="tag">${uptimeStr}</span></div>
    </div>
  </div>
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

console.log(`🛡️ Truthier Bun API running at http://localhost:${PORT}`);
