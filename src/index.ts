import { serve } from "bun";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";

const PORT = Number(process.env.PORT) || 3000;
const START_TIME = new Date();

function getGitInfo() {
  try {
    if (existsSync(".git/HEAD")) {
      const head = readFileSync(".git/HEAD", "utf8").trim();
      let refPath = head;
      if (head.startsWith("ref: ")) {
        refPath = head.replace("ref: ", "");
        const fullRef = `.git/${refPath}`;
        if (existsSync(fullRef)) {
          return {
            branch: refPath.split("/").pop() || "unknown",
            commit: readFileSync(fullRef, "utf8").trim().slice(0, 7),
          };
        }
      }
      return { branch: "detached", commit: head.slice(0, 7) };
    }
    // Fallback to git command
    const commit = execSync("git rev-parse --short HEAD 2>/dev/null", { encoding: "utf8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf8" }).trim();
    return { commit, branch };
  } catch {
    return { commit: "initial", branch: "main" };
  }
}

const server = serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    // Health check endpoint
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "healthy",
        uptimeSeconds: Math.floor((Date.now() - START_TIME.getTime()) / 1000),
        startTime: START_TIME.toISOString(),
        memoryUsage: process.memoryUsage(),
        bunVersion: Bun.version,
      });
    }

    // Info endpoint
    if (url.pathname === "/api/info") {
      const git = getGitInfo();
      return Response.json({
        service: "bun-background-instance",
        version: "1.0.1",
        autoSyncVerified: true,
        bunVersion: Bun.version,
        git,
        startedAt: START_TIME.toISOString(),
      });
    }

    // GitHub Push Webhook endpoint
    if (url.pathname === "/api/webhook" && req.method === "POST") {
      console.log(`[${new Date().toISOString()}] Received webhook request`);
      try {
        const pullOutput = execSync("git pull origin main 2>&1", { encoding: "utf8" });
        console.log(`[git pull output]:\n${pullOutput}`);

        // If package.json changed, optionally run bun install
        if (pullOutput.includes("package.json")) {
          console.log("package.json changed, installing dependencies...");
          execSync("bun install", { stdio: "inherit" });
        }

        return Response.json({
          status: "updated",
          output: pullOutput,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        console.error("Failed to git pull:", err.message);
        return Response.json(
          { status: "error", error: err.message },
          { status: 500 }
        );
      }
    }

    // Root UI
    const git = getGitInfo();
    const uptimeSec = Math.floor((Date.now() - START_TIME.getTime()) / 1000);
    const uptimeStr = `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bun Background Service</title>
  <style>
    :root {
      --bg: #0a0c10;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --accent: #f472b6;
      --accent-glow: rgba(244, 114, 182, 0.2);
      --green: #3fb950;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
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
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .bun-badge {
      font-size: 28px;
    }
    h1 {
      font-size: 22px;
      font-weight: 600;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(63, 185, 80, 0.15);
      color: var(--green);
      border: 1px solid rgba(63, 185, 80, 0.3);
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 500;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.8); }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .card-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .card-val {
      font-size: 16px;
      font-weight: 600;
      font-family: var(--font-mono);
      color: var(--text);
    }
    .services {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 24px;
    }
    .service-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
    }
    .service-row:not(:last-child) {
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .service-link {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: color 0.15s;
    }
    .service-link:hover {
      text-decoration: underline;
    }
    .footer {
      border-top: 1px solid var(--border);
      padding-top: 16px;
      display: flex;
      justify-content: space-between;
      color: var(--text-muted);
      font-size: 13px;
    }
    .tag {
      font-family: var(--font-mono);
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title-group">
        <span class="bun-badge">🥟</span>
        <div>
          <h1>Bun Background Service</h1>
          <p style="color: var(--text-muted); font-size: 13px;">Hostinger VPS Instance &bull; v1.0.1</p>
        </div>
      </div>
      <div class="status-badge">
        <div class="pulse-dot"></div>
        Running
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">Bun Runtime</div>
        <div class="card-val">v${Bun.version}</div>
      </div>
      <div class="card">
        <div class="card-label">Server Uptime</div>
        <div class="card-val">${uptimeStr}</div>
      </div>
      <div class="card">
        <div class="card-label">Git Branch</div>
        <div class="card-val">${git.branch}</div>
      </div>
      <div class="card">
        <div class="card-label">Commit SHA</div>
        <div class="card-val">${git.commit}</div>
      </div>
    </div>

    <div class="services">
      <div class="service-row">
        <div>
          <strong>WordPress Instance</strong>
          <p style="color: var(--text-muted); font-size: 13px;">Running on port 8080</p>
        </div>
        <a class="service-link" href="http://${url.hostname}:8080" target="_blank">Open WordPress &rarr;</a>
      </div>
      <div class="service-row">
        <div>
          <strong>Auto-Reload Mechanism</strong>
          <p style="color: var(--text-muted); font-size: 13px;">Pushes to GitHub automatically restart this service</p>
        </div>
        <span class="tag">Active</span>
      </div>
    </div>

    <div class="footer">
      <div>Repo: <span class="tag">Team-1five1/1five1-junction-2026</span></div>
      <div>Auto-Sync: <span class="tag">every 15s + webhook</span></div>
    </div>
  </div>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`🥟 Bun background service running at http://localhost:${server.port}`);
