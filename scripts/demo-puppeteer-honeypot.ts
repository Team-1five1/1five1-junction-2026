/**
 * Truthier Puppeteer Honeypot & Bot Swarm Demo
 *
 * Supports BOTH:
 * - Direct Live WordPress (e.g. http://72.61.22.111:8080/2026/11/14/hello-world/)
 * - Truthier Standalone Storefront UI (with live Honeypot Vault side-panel)
 *
 * Features:
 * - Does NOT close the browser windows at the end (keeps them open for manual inspection)
 * - Multi-comment bot swarm simulation (bots can post multiple comments with varied wording)
 * - Side-by-side Dual Browser layout:
 *     Left Half:  Bot Window (sees its comments published via deceptive shadowban cookie)
 *     Right Half: Public Visitor Window (sees clean feed with 0 bot comments)
 */

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { existsSync } from "fs";
import { execSync } from "child_process";
import appObj from "../src/index";

const args = process.argv.slice(2);
const IS_HEADLESS = args.includes("--headless") || process.env.HEADLESS === "true";
const CLOSE_AT_END = args.includes("--close-at-end"); // Default is now to KEEP OPEN!

function getArg(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1]!;
  return fallback;
}

const COMMENTS_COUNT = Math.max(1, parseInt(getArg("--comments", "3"), 10));
const TARGET_URL_ARG = getArg("--url", process.env.DEMO_URL || "");
// Typing and step delay in milliseconds (defaults to 1800ms between actions so it's easy to follow live)
const STEP_DELAY = parseInt(getArg("--delay", "1800"), 10);

function findChromeExecutable(): string {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error("Chrome/Chromium binary not found.");
}

async function ensureBunServerOn4000(): Promise<() => void> {
  try {
    const res = await fetch("http://localhost:4000/api/health", { signal: AbortSignal.timeout(600) });
    if (res.ok) {
      return () => {};
    }
  } catch {}

  try {
    const server = Bun.serve({
      port: 4000,
      hostname: "0.0.0.0",
      fetch: appObj.fetch,
    });
    console.log("⚡ Started Truthier Bun API Server on http://0.0.0.0:4000 (reachable by Docker WordPress)");
    return () => server.stop(true);
  } catch {
    return () => {};
  }
}

async function resolveTargetUrl(customUrl?: string): Promise<{
  storefrontUrl: string;
  isWordPress: boolean;
  stopServer: () => void;
}> {
  const stopServer = await ensureBunServerOn4000();

  // If explicitly passed, use it
  if (customUrl) {
    const isWp = customUrl.includes(":8080") || customUrl.includes("wp-") || customUrl.includes("?p=");
    return { storefrontUrl: customUrl, isWordPress: isWp, stopServer };
  }

  // 1. Check if local WordPress is running on localhost:8080 (PRIMARY DEFAULT)
  try {
    const localWpCheck = await fetch("http://localhost:8080/?p=1", {
      signal: AbortSignal.timeout(1000),
    });
    if (localWpCheck.ok) {
      console.log("🌐 Detected local WordPress running at http://localhost:8080/?p=1");
      return {
        storefrontUrl: "http://localhost:8080/?p=1",
        isWordPress: true,
        stopServer,
      };
    }
  } catch {}

  // 2. Check if VPS WordPress is reachable
  try {
    const wpCheck = await fetch("http://72.61.22.111:8080/?p=1", {
      signal: AbortSignal.timeout(1200),
    });
    if (wpCheck.ok) {
      console.log("🌐 Detected VPS WordPress at http://72.61.22.111:8080/?p=1");
      return {
        storefrontUrl: "http://72.61.22.111:8080/?p=1",
        isWordPress: true,
        stopServer,
      };
    }
  } catch {
    // fallback to local
  }

  return {
    storefrontUrl: "http://localhost:4000/demo/storefront",
    isWordPress: false,
    stopServer,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BOT_PROPAGANDA_WAVE = [
  "The shadowy globalist cabal and corrupt puppet masters are secretly destroying our economy! Share immediately before deletion!",
  "Wake up sheeple! Corrupt regime oligarchs orchestrated this manufactured hoax to bankrupt citizens! Repost now before censorship!",
  "These puppet masters and establishment elites are solely to blame for ruining our nation and hiding the truth! Spread urgently!",
  "Secret controllers in the cabal are siphoning wealth from working families and engineering a collapse! Circulate fast before banned!",
  "Establishment oligarchs are deceiving ordinary people and covering up their treasonous fraud! Forward right away before scrubbed!",
];

async function submitComment(page: Page, isWordPress: boolean, author: string, text: string) {
  // Next-Generation AI Browser Agent Simulation (like Browser-Use / Skyvern / Operator):
  // 1. Scans all form inputs via computed styles & ARIA Accessibility labels
  // 2. Smartly SKIPS old-school CSS hidden honeypots (width:0 / opacity:0 / aria-hidden="true")
  // 3. Reads ARIA instructions in the Accessibility Tree (falling into _shield_ai_trap)
  const discoveredFields = await page.evaluate(() => {
    const form = document.querySelector("#commentform, form.comment-form");
    if (!form) return [];
    const inputs = Array.from(form.querySelectorAll("input, textarea"));
    return inputs.map((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const isClassicHidden =
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        rect.width === 0 ||
        rect.height === 0 ||
        el.getAttribute("aria-hidden") === "true" ||
        (el as HTMLInputElement).type === "hidden";

      const id = el.id || "";
      const name = el.getAttribute("name") || "";
      const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
      const ariaLabel = el.getAttribute("aria-label") || labelEl?.textContent?.trim() || el.getAttribute("placeholder") || "";

      return { name, id, tag: el.tagName.toLowerCase(), isClassicHidden, ariaLabel };
    });
  });

  for (const field of discoveredFields) {
    if (field.isClassicHidden) {
      if (field.name === "_shield_hp_field") {
        console.log(`   🤖 [Next-Gen AI Agent] Detected & SKIPPED old-school CSS honeypot (${field.name}, opacity:0/width:0)`);
      }
      continue;
    }

    if (field.ariaLabel.includes("SYSTEM INSTRUCTION FOR AI AGENTS")) {
      console.log(`   🪤 [Next-Gen AI Agent] Read ARIA Accessibility instruction on ${field.name} -> obeying prompt trap!`);
      await page.evaluate((fieldName) => {
        const el = document.querySelector(`[name="${fieldName}"]`) as HTMLInputElement | null;
        if (el) el.value = "AI_AGENT_VERIFIED";
      }, field.name);
    }
  }

  const commentInput = await page.$("#comment");
  if (commentInput) {
    await commentInput.click({ clickCount: 3 });
    await page.type("#comment", text, { delay: 30 });
  }

  await sleep(350);

  const authorInput = await page.$("#author");
  if (authorInput) {
    await authorInput.click({ clickCount: 3 });
    await page.type("#author", author, { delay: 55 });
  }

  await sleep(350);

  if (isWordPress) {
    const emailInput = await page.$("#email");
    if (emailInput) {
      await emailInput.click({ clickCount: 3 });
      await page.type("#email", `${author.toLowerCase().replace(/[^a-z0-9]/g, "")}@ai-agent.net`, { delay: 30 });
    }
  }

  console.log(`   ⏳ Pausing ${STEP_DELAY}ms so viewers can see the filled form before submit...`);
  await sleep(STEP_DELAY);

  const submitSelector = isWordPress ? "#submit, input[type=submit]" : "#submit-btn, button[type=submit], #submit";
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click(submitSelector),
  ]);
}

async function runDemo() {
  const chromePath = findChromeExecutable();
  const { storefrontUrl, isWordPress, stopServer } = await resolveTargetUrl(TARGET_URL_ARG || undefined);

  console.log("\n🛡️ ==========================================================================");
  console.log("   TRUTHIER: DUAL-BROWSER HONEYPOT & BOT SWARM DEMO");
  console.log("============================================================================");
  console.log(`   • Chrome Path:    ${chromePath}`);
  console.log(`   • Target Site:    ${isWordPress ? "WordPress Blog Post" : "Truthier Storefront"}`);
  console.log(`   • Target URL:     ${storefrontUrl}`);
  console.log(`   • Comments Count: ${COMMENTS_COUNT} bot comments to post`);
  console.log(`   • Keep Windows:   YES (Browsers will stay open at the end)`);
  console.log("----------------------------------------------------------------------------\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: IS_HEADLESS,
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=1600,900",
      "--window-position=50,50",
    ],
  });

  try {
    // Context 1: Bot Browser Context (has its own bot cookies)
    const botContext = await browser.createBrowserContext();
    // Context 2: Public Visitor Context (completely clean/isolated visitor session)
    const publicContext = await browser.createBrowserContext();

    const botPage = await botContext.newPage();
    const publicPage = await publicContext.newPage();

    // Make the Right Window (publicPage) behave like a normal un-automated user browser
    // so YOU (as a real human) can manually type and submit comments in it during the live demo!
    await publicPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // Split screen: bot on the left, public on the right
    await botPage.setViewport({ width: 780, height: 860 });
    await publicPage.setViewport({ width: 780, height: 860 });

    const botNavUrl = isWordPress ? storefrontUrl : `${storefrontUrl}?role=bot`;
    const publicNavUrl = isWordPress ? storefrontUrl : `${storefrontUrl}?role=public`;

    console.log("🌐 Opening Bot Browser (Left) and Real Human Visitor Browser (Right)...");
  if (isWordPress && storefrontUrl.includes("localhost:8080") && !args.includes("--keep-comments")) {
    try {
      execSync(
        `docker exec -i wordpress-db mariadb -u wordpress -pwp_user_password_2026 wordpress -e "DELETE FROM wp_commentmeta WHERE comment_id > 1; DELETE FROM wp_comments WHERE comment_ID > 1; DELETE FROM wp_postmeta WHERE post_id = 1 AND meta_key = '_shield_review_banner'; UPDATE wp_posts SET comment_count = 1 WHERE ID = 1;" 2>/dev/null`
      );
      console.log("   🧹 Reset local WordPress post #1 to clean initial state (1 default comment).");
    } catch {}
  }
    await botPage.goto(botNavUrl, { waitUntil: "networkidle2" });
    await publicPage.goto(publicNavUrl, { waitUntil: "networkidle2" });

    // Verify collector.js + @fingerprintjs/botd + AI-Agent ARIA trap injection
    const hasHp = await botPage.$('input[name="_shield_hp_field"]');
    const hasAiTrap = await botPage.$('input[name="_shield_ai_trap"]');
    const hasBotD = await botPage.evaluate(() => typeof (window as any).ShieldBotD === "object");
    console.log(
      `   ✅ [Shield Guard v2.0] @fingerprintjs/botd loaded: ${hasBotD} | AI-Agent ARIA Trap (_shield_ai_trap): ${!!hasAiTrap} | Scraper Honeypot: ${!!hasHp}`
    );

    // Post multiple bot comments with different wording!
    console.log(`\n🤖 Starting Bot Wave: Submitting ${COMMENTS_COUNT} comments with varied wording...`);
    for (let i = 1; i <= COMMENTS_COUNT; i++) {
      const author = `BotSwarm_Agent_${i}`;
      const text = `${BOT_PROPAGANDA_WAVE[(i - 1) % BOT_PROPAGANDA_WAVE.length]!} [msg #${i}-${Date.now().toString().slice(-4)}]`;

      console.log(`   [Bot ${i}/${COMMENTS_COUNT}] Typing & submitting: "${text.slice(0, 55)}..."`);
      await submitComment(botPage, isWordPress, author, text);
      console.log(`   ✓ Bot ${i} submitted comment (Caught by @fingerprintjs/botd + AI-Agent ARIA Trap).`);

      console.log(`   ⏳ Pausing ${STEP_DELAY}ms before next bot action...`);
      await sleep(STEP_DELAY);
    }

    // Inspect Bot View
    const botContent = await botPage.evaluate(() => document.body.innerText);
    const botSeesAll = BOT_PROPAGANDA_WAVE.slice(0, COMMENTS_COUNT).every((t) => botContent.includes(t.slice(0, 25)));

    console.log(`\n🤖 [Bot Window View] Does the Bot see ALL its submitted comments?`);
    console.log(`   👉 ${botSeesAll ? "YES! Bot sees every comment published (Deceptive Shadowban active!)" : "Partially/Check DOM"}`);

    // Verify Public Visitor visibility in the background WITHOUT reloading publicPage
    // so if you are already typing in the Right Window, your input is NEVER wiped!
    console.log(`\n👤 [Public View Verification] Checking public HTML (without refreshing your Right Window)...`);
    const bgPublicRes = await fetch(publicNavUrl);
    const publicContent = await bgPublicRes.text();

    const publicSeesAnyBot = BOT_PROPAGANDA_WAVE.slice(0, COMMENTS_COUNT).some((t) => publicContent.includes(t.slice(0, 25)));

    console.log(`   👉 Does the Public Visitor see ANY of the ${COMMENTS_COUNT} bot comments?`);
    if (!publicSeesAnyBot) {
      console.log(`   🎉 NO! 100% of bot comments are HIDDEN from the public! Shadowban working perfectly!`);
    } else {
      console.log(`   ❌ Warning: Public saw bot comment.`);
    }

    console.log("\n============================================================================");
    console.log("✨ BOT WAVE COMPLETED! THE RIGHT WINDOW IS NOW READY FOR YOU (REAL HUMAN):");
    console.log("   • Left Window (Bot):     Shows the bot's shadowbanned comments.");
    console.log("   • Right Window (Human):  Untouched! You can manually type & post a comment");
    console.log("                            right now in the Right Window, then refresh the");
    console.log("                            Left Window to see your comment appear for the bot!");
    console.log("   • Press Ctrl+C in this terminal when you are done.");
    console.log("============================================================================\n");

    if (!CLOSE_AT_END && !IS_HEADLESS) {
      // Keep running indefinitely until user kills process with Ctrl+C
      await new Promise(() => {});
    }
  } catch (err: any) {
    console.error("Demo run error:", err.message);
  } finally {
    if (CLOSE_AT_END) {
      await browser.close();
      stopServer();
    }
  }
}

runDemo().catch((err) => {
  console.error("Fatal demo error:", err);
  process.exit(1);
});
