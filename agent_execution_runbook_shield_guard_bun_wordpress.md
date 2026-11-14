# Shield Guard: Coordinated Propaganda & Bot Detection Runbook
**Target Environment:** Single Hostinger VPS (Ubuntu/Debian)  
**Stack:** Bun + Hono + Drizzle ORM + PostgreSQL (`pgvector`) + Redis (BullMQ) + WordPress Plugin  
**AI Models (via Hostinger AI Router):** `jev` (Stage 1 Fast Screener) & `gemini-4-hydrogen` (Stage 2 Heavy Forensic & Live Web Search Grounding)

---

## Master Agent Execution Checklist

### 1. Hostinger VPS & Local Infrastructure
- [ ] **1.1** Provision Docker Compose for PostgreSQL (`pgvector/pgvector:pg16`) & Redis (`redis:7-alpine`) bound strictly to `127.0.0.1:5432` and `127.0.0.1:6379`.
- [ ] **1.2** Initialize Bun workspace at `/opt/shield/backend` and install core packages (`hono`, `drizzle-orm`, `postgres`, `bullmq`, `ioredis`, `zod`).
- [ ] **1.3** Configure `/opt/shield/backend/.env` with local DB/Redis URLs, Hostinger AI Router credentials, and shared HMAC secrets.

### 2. Bun Core API & Database Schema
- [ ] **2.1** Create Drizzle PostgreSQL schema (`src/db/schema.ts`) with `tenants`, `submissions`, `honeypot_vault`, and `entity_banners` tables.
- [ ] **2.2** Push Drizzle migrations (`bunx drizzle-kit push`) and verify table creation.
- [ ] **2.3** Implement synchronous Bot Telemetry Decryptor & Scorer (`src/engines/bot-telemetry.ts`) to inspect `_shield_token` payloads in `<2ms`.

### 3. SemEval Engine & Hostinger AI Router
- [ ] **3.1** Create the static 50-Question SemEval definition map (`src/config/semeval-questions.ts`).
- [ ] **3.2** Implement the deterministic SemEval Scorer (`src/engines/semeval-scorer.ts`) with Tier 1–3 weights, Bucket 1 cap, Multi-Bucket Synergy (`+2`), Double Red-Flag override, and Hard Evidence veto.
- [ ] **3.3** Build Hostinger AI Router client for `jev` (`src/ai/jev-screener.ts`) returning strictly JSON arrays of triggered question IDs (`["Q1", "Q9"]`) with zero prose.
- [ ] **3.4** Build Hostinger AI Router client for `gemini-4-hydrogen` (`src/ai/hydrogen-research.ts`) handling Route 3/4 deep explanations and live web-search grounding for review-bombing spikes.

### 4. Review Bombing & Honeypot Workers
- [ ] **4.1** Implement Hono API routes (`src/routes/api.ts`) on `127.0.0.1:4000` (`POST /v1/ingest`, `POST /v1/analyze`, `PATCH /v1/tenant/mode`).
- [ ] **4.2** Implement BullMQ Evaluation & Velocity Worker (`src/workers/evaluation-worker.ts`) to orchestrate `jev` -> Scorer -> `gemini-4-hydrogen` -> WordPress loopback webhook.
- [ ] **4.3** Configure and enable `/etc/systemd/system/shield-bun.service` for automatic background execution.

### 5. WordPress Plugin & Invisible Telemetry
- [ ] **5.1** Scaffold WordPress plugin at `/var/www/html/wp-content/plugins/shield-guard/shield-guard.php`.
- [ ] **5.2** Build invisible client telemetry script (`assets/collector.js`) capturing keystroke flight variance, mouse events, `navigator.webdriver`, and hidden DOM honeypot inputs into `_shield_token`.
- [ ] **5.3** Implement Dual-Storage Shadowban & Deceptive Author-Only Visibility filter (`includes/class-shield-interceptor.php`) hooking `preprocess_comment` and `comments_clauses`.
- [ ] **5.4** Implement WP REST Webhook Receiver (`includes/class-shield-webhook.php`) at `/wp-json/shield/v1/webhook`.
- [ ] **5.5** Build Frontend ID-to-Badge Renderer (`assets/badge-renderer.js` & `includes/class-shield-renderer.php`) and WP Admin 3-Mode Toggle (`includes/class-shield-admin.php`).

### 6. End-to-End Verification
- [ ] **6.1** Execute automated verification script (`scripts/verify-e2e.ts`) covering Headless Bot Deception, Shielded Consumer Rant, Escalated Disinformation, and Legitimate Review Bombing Backlash.

---

## Detailed Agent Task Specifications

### `AGENT_TASK_01`: VPS Directory Layout & Local Infrastructure
**Objective:** Initialize the directory structure on the Hostinger VPS and launch local PostgreSQL + Redis containers.

1. **Create directories:**
   ```bash
   mkdir -p /opt/shield/backend/src/{config,db,engines,ai,routes,workers}
   mkdir -p /opt/shield/backend/scripts
   mkdir -p /var/www/html/wp-content/plugins/shield-guard/{assets,includes}
   ```

2. **Create `/opt/shield/docker-compose.yml`:**
   ```yaml
   version: "3.9"
   services:
     postgres:
       image: pgvector/pgvector:pg16
       container_name: shield_pg
       restart: always
       environment:
         POSTGRES_USER: shield
         POSTGRES_PASSWORD: shield_local_password
         POSTGRES_DB: shield_db
       ports:
         - "127.0.0.1:5432:5432"
       volumes:
         - pgdata:/var/lib/postgresql/data

     redis:
       image: redis:7-alpine
       container_name: shield_redis
       restart: always
       ports:
         - "127.0.0.1:6379:6379"
       volumes:
         - redisdata:/data

   volumes:
     pgdata:
     redisdata:
   ```

3. **Create `/opt/shield/backend/.env`:**
   ```ini
   PORT=4000
   DATABASE_URL=postgres://shield:shield_local_password@127.0.0.1:5432/shield_db
   REDIS_URL=redis://127.0.0.1:6379
   HOSTINGER_AI_ROUTER_URL=https://ai-router.hostinger.com/v1
   HOSTINGER_AI_API_KEY=replace_with_hostinger_ai_router_key
   MODEL_FAST_SCREENER=jev
   MODEL_HEAVY_RESEARCH=gemini-4-hydrogen
   TELEMETRY_SECRET_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
   WP_WEBHOOK_SECRET=replace_with_shared_wp_hmac_secret
   WP_DEFAULT_WEBHOOK_URL=http://127.0.0.1/wp-json/shield/v1/webhook
   ```

4. **Initialize Bun project:**
   ```bash
   cd /opt/shield/backend
   docker compose -f ../docker-compose.yml up -d
   bun init -y
   bun add hono drizzle-orm postgres bullmq ioredis zod
   bun add -d drizzle-kit @types/bun
   ```

---

### `AGENT_TASK_02`: Drizzle Database Schema (`src/db/schema.ts`)
**Objective:** Define the PostgreSQL schema supporting dual-storage shadowban synchronization, ID-only flag arrays, nullable deep research explanations, and review-bombing banners.

* **File:** `/opt/shield/backend/src/db/schema.ts`
```typescript
import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  apiKey: text("api_key").notNull().unique(),
  wpWebhookUrl: text("wp_webhook_url").notNull(),
  thresholdMode: text("threshold_mode").default("balanced").notNull(), // 'strict' | 'balanced' | 'high_precision'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const submissions = pgTable("submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  wpCommentId: integer("wp_comment_id").notNull(),
  entityId: text("entity_id").notNull(), // WP post_id or WooCommerce product_id
  authorSessionHash: text("author_session_hash").notNull(),
  rawText: text("raw_text").notNull(),
  rating: integer("rating"), // 1-5 for reviews, null for standard comments
  authorType: text("author_type").notNull(), // 'human' | 'bot'
  visibility: text("visibility").notNull(), // 'pending' | 'public' | 'public_flagged' | 'shadowbanned'
  routingPath: text("routing_path").notNull(),
  modelUsed: text("model_used").notNull(), // 'none' | 'jev' | 'gemini-4-hydrogen'
  riskScore: integer("risk_score").default(0).notNull(),
  shieldFlags: integer("shield_flags").default(0).notNull(),
  failedRiskIds: jsonb("failed_risk_ids").$type<string[]>().default([]).notNull(),
  triggeredShieldIds: jsonb("triggered_shield_ids").$type<string[]>().default([]).notNull(),
  deepResearchExplanation: text("deep_research_explanation"), // null unless gemini-4-hydrogen is triggered
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const honeypotVault = pgTable("honeypot_vault", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id").references(() => submissions.id).notNull(),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent").notNull(),
  telemetryJson: jsonb("telemetry_json").notNull(),
  patternClusterId: text("pattern_cluster_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const entityBanners = pgTable("entity_banners", {
  entityId: text("entity_id").primaryKey(),
  anomalyStatus: text("anomaly_status").default("normal").notNull(), // 'normal' | 'legitimate_backlash' | 'coordinated_attack'
  bannerExplanation: text("banner_explanation"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

---

### `AGENT_TASK_03`: Bot Telemetry & Deterministic 50-Question Scorer
**Objective:** Implement the synchronous bot detector and the deterministic SemEval scoring engine.

#### 1. The 50 SemEval Questions Reference (`src/config/semeval-questions.ts`)
* **Bucket 1: Manipulative Wording & Emotional Framing (Max 10 pts | Cap at 3 pts if single active bucket)**
  * `Q1` (1 pt): Loaded Words
  * `Q2` (1 pt): Exaggeration
  * `Q3` (1 pt): Minimization
  * `Q4` (1 pt): Alarmist Formatting
  * `Q5` (1 pt): Intentional Vagueness
  * `Q6` (1 pt): Bait-and-Switch Framing
  * `Q7` (1 pt): Unbacked Absolutes
  * `Q8` (3 pts): Dehumanizing Metaphors
* **Bucket 2: Stereotyping, Labeling & Reputation Attacks (Max 21 pts)**
  * `Q9` (2 pts): Name-Calling
  * `Q10` (3 pts): Sweeping Stereotypes
  * `Q11` (2 pts): Guilt by Association
  * `Q12` (2 pts): Extreme Historical Comparisons
  * `Q13` (2 pts): Assumed Malice
  * `Q14` (2 pts): Manufactured Doubt
  * `Q15` (2 pts): Hypocrisy Deflection
  * `Q16` (3 pts): Out-Group Villainization
  * `Q17` (3 pts): Shadowy Cabal Framing
* **Bucket 3: Fear, Prejudice & Group Identity Appeals (Max 19 pts)**
  * `Q18` (3 pts): Existential Fear Appeal
  * `Q19` (3 pts): Prejudice Activation
  * `Q20` (2 pts): Flag-Waving / Loyalty Test
  * `Q21` (2 pts): In-Group Flattery
  * `Q22` (2 pts): Bandwagon Pressure
  * `Q23` (2 pts): False Authority
  * `Q24` (2 pts): Weaponized Values
  * `Q25` (3 pts): Grievance Amplification
* **Bucket 4: Oversimplification & Logical Traps (Max 16 pts)**
  * `Q26` (3 pts): Black-and-White Fallacy
  * `Q27` (3 pts): Single-Cause Scapegoating
  * `Q28` (2 pts): Magic-Bullet / Total-Ruin Claim
  * `Q29` (2 pts): Slippery Slope
  * `Q30` (2 pts): Cherry-Picked Anecdote
  * `Q31` (2 pts): Coincidence as Conspiracy
  * `Q32` (2 pts): No-Choice Framing
* **Bucket 5: Distraction, Deflection & Disinformation Tactics (Max 14 pts)**
  * `Q33` (2 pts): Whataboutism
  * `Q34` (2 pts): Strawman Distortion
  * `Q35` (2 pts): Red Herring
  * `Q36` (2 pts): Unverifiable Sourcing
  * `Q37` (3 pts): Disguised Partisanship
  * `Q38` (3 pts): Contradictory Flooding
* **Bucket 6: Bot Amplification, Urgency & Thought-Killers (Max 10 pts)**
  * `Q39` (1 pt): Thought-Terminating Cliché
  * `Q40` (1 pt): Slogan Repetition
  * `Q41` (3 pts): Artificial Urgency
  * `Q42` (1 pt): Engagement Bait
  * `Q43` (1 pt): Keyword/Hashtag Stuffing
  * `Q44` (3 pts): Template Phrasing
* **Bucket 7: False-Positive Shields / Benign Context Checks (Max 9 Shield Flags)**
  * `Q45` (1 Flag): Satire or Parody
  * `Q46` (2 Flags): Neutral Reporting/Quoting
  * `Q47` (2 Flags): Counterspeech/Debunking
  * `Q48` (1 Flag): Balanced Perspective
  * `Q49` (2 Flags): Verifiable Receipts
  * `Q50` (1 Flag): Everyday Personal Venting

#### 2. Deterministic Scorer Implementation (`src/engines/semeval-scorer.ts`)
```typescript
export type ThresholdMode = "strict" | "balanced" | "high_precision";
export type QuestionId = `Q${number}`;

export interface SemEvalInput {
  triggeredIds: QuestionId[];
  mode: ThresholdMode;
}

export interface SemEvalResult {
  riskScore: number;
  shieldFlags: number;
  activeRiskBuckets: number;
  synergyBonusApplied: boolean;
  bucket1CapApplied: boolean;
  overrideTriggered: "DOUBLE_RED_FLAG" | "HARD_EVIDENCE_VETO" | null;
  failedRiskIds: QuestionId[];
  triggeredShieldIds: QuestionId[];
  route:
    | "ROUTE_1_FAST_CLEAR"
    | "ROUTE_2_SHIELDED_CLEAR"
    | "ROUTE_3_STANCE_VERIFICATION"
    | "ROUTE_4_FORENSIC_THREAT";
  escalateToHydrogen: boolean;
}

const BUCKET_MAP: Record<number, number[]> = {
  1: [1, 2, 3, 4, 5, 6, 7, 8],
  2: [9, 10, 11, 12, 13, 14, 15, 16, 17],
  3: [18, 19, 20, 21, 22, 23, 24, 25],
  4: [26, 27, 28, 29, 30, 31, 32],
  5: [33, 34, 35, 36, 37, 38],
  6: [39, 40, 41, 42, 43, 44],
};

const TIER_3_QUESTIONS = new Set([8, 10, 16, 17, 18, 19, 25, 26, 27, 37, 38, 41, 44]);
const TIER_1_QUESTIONS = new Set([1, 2, 3, 4, 5, 6, 7, 39, 40, 42, 43]);
const DOUBLE_WEIGHT_SHIELDS = new Set([46, 47, 49]);

const MODE_THRESHOLDS: Record<ThresholdMode, { base: number; shielded: number }> = {
  strict: { base: 5, shielded: 7 },
  balanced: { base: 7, shielded: 10 },
  high_precision: { base: 10, shielded: 13 },
};

export function evaluateSemEvalBitmask(input: SemEvalInput): SemEvalResult {
  const activeNums = new Set(
    input.triggeredIds.map((id) => parseInt(id.replace("Q", ""), 10))
  );

  const failedRiskIds: QuestionId[] = [];
  const triggeredShieldIds: QuestionId[] = [];

  const bucketPoints: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let tier3Count = 0;
  let shieldFlags = 0;

  for (const qNum of activeNums) {
    if (qNum >= 1 && qNum <= 44) {
      failedRiskIds.push(`Q${qNum}`);
      const pts = TIER_3_QUESTIONS.has(qNum) ? 3 : TIER_1_QUESTIONS.has(qNum) ? 1 : 2;
      if (pts === 3) tier3Count++;

      for (const [bId, qList] of Object.entries(BUCKET_MAP)) {
        if (qList.includes(qNum)) {
          bucketPoints[Number(bId)] += pts;
          break;
        }
      }
    } else if (qNum >= 45 && qNum <= 50) {
      triggeredShieldIds.push(`Q${qNum}`);
      shieldFlags += DOUBLE_WEIGHT_SHIELDS.has(qNum) ? 2 : 1;
    }
  }

  const activeBuckets = Object.entries(bucketPoints).filter(([_, pts]) => pts > 0);
  const activeRiskBuckets = activeBuckets.length;

  let bucket1CapApplied = false;
  if (activeRiskBuckets === 1 && bucketPoints[1] > 3) {
    bucketPoints[1] = 3;
    bucket1CapApplied = true;
  }

  let riskScore = Object.values(bucketPoints).reduce((sum, val) => sum + val, 0);

  const synergyBonusApplied = activeRiskBuckets >= 3;
  if (synergyBonusApplied) {
    riskScore += 2;
  }

  let { base: baseThreshold, shielded: shieldedThreshold } = MODE_THRESHOLDS[input.mode];
  let overrideTriggered: SemEvalResult["overrideTriggered"] = null;

  if (activeNums.has(48) && activeNums.has(49)) {
    overrideTriggered = "HARD_EVIDENCE_VETO";
    baseThreshold = Math.max(baseThreshold, 12);
    shieldedThreshold = Math.max(shieldedThreshold, 12);
  }

  const doubleRedFlag = tier3Count >= 2 && shieldFlags === 0 && riskScore >= 6;
  if (doubleRedFlag) {
    overrideTriggered = "DOUBLE_RED_FLAG";
  }

  if (doubleRedFlag) {
    return {
      riskScore,
      shieldFlags,
      activeRiskBuckets,
      synergyBonusApplied,
      bucket1CapApplied,
      overrideTriggered,
      failedRiskIds,
      triggeredShieldIds,
      route: "ROUTE_4_FORENSIC_THREAT",
      escalateToHydrogen: true,
    };
  }

  if (riskScore >= shieldedThreshold && shieldFlags >= 2) {
    return {
      riskScore,
      shieldFlags,
      activeRiskBuckets,
      synergyBonusApplied,
      bucket1CapApplied,
      overrideTriggered,
      failedRiskIds,
      triggeredShieldIds,
      route: "ROUTE_3_STANCE_VERIFICATION",
      escalateToHydrogen: true,
    };
  }

  if (
    (riskScore >= baseThreshold && shieldFlags === 0) ||
    (riskScore >= shieldedThreshold && shieldFlags <= 1)
  ) {
    return {
      riskScore,
      shieldFlags,
      activeRiskBuckets,
      synergyBonusApplied,
      bucket1CapApplied,
      overrideTriggered,
      failedRiskIds,
      triggeredShieldIds,
      route: "ROUTE_4_FORENSIC_THREAT",
      escalateToHydrogen: true,
    };
  }

  if (riskScore >= 5 && shieldFlags >= 1) {
    return {
      riskScore,
      shieldFlags,
      activeRiskBuckets,
      synergyBonusApplied,
      bucket1CapApplied,
      overrideTriggered,
      failedRiskIds,
      triggeredShieldIds,
      route: "ROUTE_2_SHIELDED_CLEAR",
      escalateToHydrogen: false,
    };
  }

  return {
    riskScore,
    shieldFlags,
    activeRiskBuckets,
    synergyBonusApplied,
    bucket1CapApplied,
    overrideTriggered,
    failedRiskIds,
    triggeredShieldIds,
    route: "ROUTE_1_FAST_CLEAR",
    escalateToHydrogen: false,
  };
}
```

---

### `AGENT_TASK_04`: Hostinger AI Router Clients (`jev` & `gemini-4-hydrogen`)
**Objective:** Build the two external model wrappers talking to `HOSTINGER_AI_ROUTER_URL`.

1. **Stage 1 Fast Screener (`src/ai/jev-screener.ts`):**
   * Calls `model: process.env.MODEL_FAST_SCREENER` (`jev`).
   * Passes the 50 binary questions in the system prompt and requests a strict JSON response: `{"triggered": ["Q1", "Q9", "Q50"]}`.
   * Zero prose or explanation is generated at this stage.

2. **Stage 2 Heavy Escalation & Grounding (`src/ai/hydrogen-research.ts`):**
   * Calls `model: process.env.MODEL_HEAVY_RESEARCH` (`gemini-4-hydrogen`).
   * **Method A (`verifyStanceOrForensic`):**
     * If `route === 'ROUTE_3_STANCE_VERIFICATION'`, prompts `gemini-4-hydrogen` to verify whether the author is quoting/reporting/debunking (`endorsed: false`) or pushing manipulation (`endorsed: true`). If `endorsed: false`, returns `deepResearchExplanation: null` and clears the post.
     * If `route === 'ROUTE_4_FORENSIC_THREAT'` (or `endorsed: true`), returns a concise, neutral `deepResearchExplanation` string summarizing why the triggered IDs (`failedRiskIds`) represent manipulative framing and cross-checking any factual claims.
   * **Method B (`investigateReviewBombing`):**
     * Invoked when human 1-star review velocity spikes on a product/post.
     * Uses `gemini-4-hydrogen` with live web search enabled to check news, patch notes, outages, or controversies for `entity_title` over the past 72 hours.
     * If a real-world catalyst exists, sets `anomalyStatus = 'legitimate_backlash'`, keeps human reviews open, and outputs `bannerExplanation` so other users see clear context on why negative reviews are spiking.

---

### `AGENT_TASK_05`: Bun Hono API Server & BullMQ Worker
**Objective:** Wire up the local HTTP ingestion endpoints and background worker.

1. **`src/routes/api.ts`:**
   * `POST /v1/ingest`: Validates payload from WordPress, runs synchronous `evaluateBotTelemetry()`, enqueues job to `shield-evaluation` BullMQ queue, and immediately responds `202 Accepted`.
   * `POST /v1/analyze`: Direct text propaganda detection endpoint returning `{ failed_risk_ids, triggered_shield_ids, deep_research_explanation }`.
   * `PATCH /v1/tenant/mode`: Updates the threshold mode (`strict`, `balanced`, `high_precision`).

2. **`src/workers/evaluation-worker.ts`:**
   * Processes queued jobs:
     * **Bot Path:** Inserts record into `honeypot_vault`, sets `visibility = 'shadowbanned'`, and sends webhook to WordPress so WordPress also marks the comment `_shield_visibility = 'shadowbanned'`.
     * **Human Path:** Runs `jev` -> `evaluateSemEvalBitmask()` -> optionally `gemini-4-hydrogen` -> sends webhook to WordPress with `failed_risk_ids`, `triggered_shield_ids`, and `deep_research_explanation` (`null` unless `gemini-4-hydrogen` ran).
     * **Review Bombing Path:** Tracks rolling 1-hour and 6-hour human review ratings in Redis. If 1-star volume spikes `>= 3x` baseline with high rating divergence, runs `investigateReviewBombing()` via `gemini-4-hydrogen` and pushes `entity_banner` in the WordPress webhook.

---

### `AGENT_TASK_06`: WordPress Plugin (`wp-content/plugins/shield-guard`)
**Objective:** Integrate WordPress & WooCommerce comments/reviews with zero client leakage.

1. **`assets/collector.js`:**
   * Injects hidden honeypot field and `_shield_token` into `#commentform` and `#review_form`.
   * Passively records keystroke interval variance, mouse events, form completion time, and `navigator.webdriver`.
2. **`includes/class-shield-interceptor.php`:**
   * Sets an `author_session_hash` cookie (with IP+UA SHA-256 fallback for cookieless bots).
   * Hooks `wp_insert_comment` to save `_shield_visibility = 'pending'` and `_shield_author_hash = $hash`, then fires an async non-blocking POST to `http://127.0.0.1:4000/v1/ingest`.
   * Hooks `comments_clauses` so public visitors only query comments where `_shield_visibility IN ('public', 'public_flagged')`, **OR** where `_shield_author_hash === $current_viewer_hash`. Bots always see their own shadowbanned posts and never realize they are in the honeypot.
3. **`includes/class-shield-webhook.php`:**
   * Exposes `POST /wp-json/shield/v1/webhook`.
   * Updates `_shield_visibility`, `_shield_failed_ids` (array of IDs like `["Q10", "Q27"]`), `_shield_explanation` (nullable text), and post meta `_shield_review_banner`.
4. **`assets/badge-renderer.js` & `includes/class-shield-renderer.php`:**
   * Renders compact UI badges from the returned Question IDs (`Q1`–`Q44`) using a static client-side label dictionary.
   * Only renders the expandable Deep Research Explanation card when `_shield_explanation` is non-null.
   * Renders the Public Review Volume Notice banner above reviews when `_shield_review_banner` is populated.

---

### `AGENT_TASK_07`: End-to-End Verification Script (`scripts/verify-e2e.ts`)
**Objective:** Run automated assertions against the live stack.

- **Test Case 1 (Headless Bot):** Submit comment with `webdriver: true` in telemetry token -> Expect `200 OK` response, comment stored in both WordPress (`shadowbanned`) and `honeypot_vault`, visible to the bot's session hash, hidden from public view.
- **Test Case 2 (Angry Consumer Rant - Route 2):** Submit review triggering `Q1, Q2, Q4, Q7, Q9` + `Q50` -> Expect `jev` only (`gemini-4-hydrogen` not called), status `public`, `deep_research_explanation: null`.
- **Test Case 3 (Coordinated Disinformation - Route 4):** Submit comment triggering `Q10, Q17, Q27, Q41` (14 pts, 0 shields) -> Expect escalation to `gemini-4-hydrogen`, status `public_flagged`, `failed_risk_ids: ["Q10","Q17","Q27","Q41"]`, and populated `deep_research_explanation`.
- **Test Case 4 (Legitimate Review Bombing):** Submit burst of human 1-star reviews -> Expect `gemini-4-hydrogen` live web search check, human reviews remain open, and public explanation banner attached to the product page.

# Questions one by one

1. Manipulative Wording & Emotional Framing (Questions 1–8)

1. Loaded Words: Does the text use intense emotional words (e.g., "destroy," "betray," "catastrophic") where neutral words would fit? 
2. Exaggeration: Does it blow the scale, severity, or impact of an event wildly out of proportion? 
3. Minimization: Does it downplay or brush off documented harm, casualties, or wrongdoing as trivial? 
4. Alarmist Formatting: Does it use ALL CAPS, excessive exclamation marks, or siren emojis to force an emotional reaction? 
5. Intentional Vagueness: Does it use confusing jargon or murky phrasing to hide a weak or unproven claim? 
6. Bait-and-Switch Framing: Does the opening line promise a shocking revelation that the rest of the text fails to support? 
7. Unbacked Absolutes: Does it rely on absolute terms like "always," "never," "everyone," or "100% undeniable" without data? 
8. Dehumanizing Metaphors: Does it compare people or groups to pests, diseases, floods, or parasites? 
2. Stereotyping, Labeling & Reputation Attacks (Questions 9–17) 9. Name-Calling: Does it attach an insulting label or nickname to a person or group instead of addressing their actions? 10. Sweeping Stereotypes: Does it assign a single negative trait, motive, or behavior to an entire demographic, nationality, or social group? 11. Guilt by Association: Does it discredit an idea or person solely by linking them to a hated or extremist group? 12. Extreme Historical Comparisons: Does it compare an opponent or policy to Nazis, Hitler, or totalitarian regimes to shut down debate? 13. Assumed Malice: Does it claim an opponent acts out of pure evil, greed, or treason rather than a difference of opinion? 14. Manufactured Doubt: Does it undermine trust in a person or institution solely through unverified insinuations ("just asking questions")? 15. Hypocrisy Deflection: Does it dismiss an argument solely by accusing the speaker of past hypocrisy rather than disproving the claim? 16. Out-Group Villainization: Does it portray an opposing group as inherently corrupt, dangerous, or beyond redemption? 17. Shadowy Cabal Framing: Does it blame a secret, unnamed elite (e.g., "puppet masters," "the regime," "they") for complex events?

3. Fear, Prejudice & Group Identity Appeals (Questions 18–25) 18. Existential Fear Appeal: Does it claim that failing to agree will destroy the reader's safety, family, or way of life? 19. Prejudice Activation: Does it tap into preexisting racial, religious, class, or cultural resentments to provoke anger? 20. Flag-Waving / Loyalty Test: Does it claim that supporting its viewpoint is the only way to be a "true patriot" or loyal group member? 21. In-Group Flattery: Does it praise the reader's group as uniquely virtuous, hardworking, or enlightened compared to outsiders? 22. Bandwagon Pressure: Does it argue that "everyone is waking up" or "millions already agree" to pressure the reader into conforming? 23. False Authority: Does it cite an unqualified celebrity, anonymous "insider," or vague "experts" to validate a controversial claim? 24. Weaponized Values: Does it invoke religion, children's safety, or moral purity to make questioning the argument seem immoral? 25. Grievance Amplification: Does it tell the audience they are being systematically humiliated, replaced, or cheated by an out-group?

4. Oversimplification & Logical Traps (Questions 26–32) 26. Black-and-White Fallacy: Does it present only two extreme choices ("with us or against us") while ignoring middle ground? 27. Single-Cause Scapegoating: Does it blame a complex economic, social, or political problem entirely on one person or group? 28. Magic-Bullet / Total-Ruin Claim: Does it claim a single policy or action will automatically fix everything or cause total collapse? 29. Slippery Slope: Does it assert without evidence that a minor step will inevitably trigger a chain reaction ending in disaster? 30. Cherry-Picked Anecdote: Does it use one isolated, extreme incident as proof of a massive, nationwide trend? 31. Coincidence as Conspiracy: Does it treat two unrelated events happening at the same time as proof of a coordinated plot? 32. No-Choice Framing: Does it state an aggressive or controversial action as the "only possible option" left?

5. Distraction, Deflection & Disinformation Tactics (Questions 33–38) 33. Whataboutism: Does it deflect a specific criticism by pointing to a completely different wrongdoing by someone else? 34. Strawman Distortion: Does it exaggerate or twist an opponent's actual position into something absurd just to attack it? 35. Red Herring: Does it introduce an emotionally charged, irrelevant side topic to distract from the main issue? 36. Unverifiable Sourcing: Does it rely on phrases like "sources say" or "what they don't want you to know" with zero checkable citations? 37. Disguised Partisanship: Does it mimic the style of an objective breaking-news alert while presenting only one-sided propaganda? 38. Contradictory Flooding: Does it throw out multiple conflicting explanations at once just to muddy the waters?

6. Bot Amplification, Urgency & Thought-Killers (Questions 39–44) 39. Thought-Terminating Cliché: Does it use a canned phrase ("It is what it is," "Follow the money," "Wake up") to stop critical thinking? 40. Slogan Repetition: Does it repeat the exact same catchphrase or talking point multiple times within a short text? 41. Artificial Urgency: Does it pressure the reader to act or share immediately before "it gets censored/deleted"? 42. Engagement Bait: Does it end with a manipulative hook designed purely to farm algorithm replies ("Bet you won't repost this")? 43. Keyword/Hashtag Stuffing: Does it pack unrelated trending hashtags, @mentions, or keywords to hijack search feeds? 44. Template Phrasing: Does the sentence structure feel like a rigid, copy-pasted script commonly used in coordinated comment swarms?

7. False-Positive Shields / Benign Context Checks (Questions 45–50) 45. Satire or Parody: Does the text show clear signs of comedy, irony, absurd exaggeration, or meme humor? 46. Neutral Reporting/Quoting: Is the author only quoting or describing extreme language in order to report on it neutrally? 47. Counterspeech/Debunking: Is the text mentioning a stereotype, fallacy, or conspiracy specifically to criticize or disprove it? 48. Balanced Perspective: Does the author acknowledge counterarguments, nuance, or limitations in their own position? 49. Verifiable Receipts: Does the text back up its strong claims with specific, checkable data, dates, or named primary sources? 50. Everyday Personal Venting: Is the emotional language just a normal person complaining about a product, service, sports game, or bad day?   

