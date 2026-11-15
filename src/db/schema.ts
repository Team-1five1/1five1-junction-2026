import { pgTable, uuid, text, integer, timestamp, jsonb, doublePrecision, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  apiKey: text("api_key").notNull().unique(),
  wpWebhookUrl: text("wp_webhook_url").notNull(),
  webhookSecret: text("webhook_secret"),
  thresholdMode: text("threshold_mode").default("balanced").notNull(), // 'strict' | 'balanced' | 'high_precision'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const submissions = pgTable("submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id"),
  wpCommentId: integer("wp_comment_id").notNull(),
  entityId: text("entity_id").notNull(), // WP post_id or WooCommerce product_id
  authorSessionHash: text("author_session_hash").notNull(),
  rawText: text("raw_text").notNull(),
  rating: integer("rating"), // 1-5 for reviews, null for standard comments
  authorType: text("author_type").notNull(), // 'human' | 'bot'
  visibility: text("visibility").notNull(), // 'pending' | 'public' | 'public_flagged' | 'shadowbanned'
  routingPath: text("routing_path").notNull(),
  modelUsed: text("model_used").notNull(), // Configured model ID, or none for bot-only evaluation
  riskScore: integer("risk_score").default(0).notNull(),
  shieldFlags: integer("shield_flags").default(0).notNull(),
  failedRiskIds: jsonb("failed_risk_ids").$type<string[]>().default([]).notNull(),
  triggeredShieldIds: jsonb("triggered_shield_ids").$type<string[]>().default([]).notNull(),
  deepResearchExplanation: text("deep_research_explanation"), // Generated only by a successfully grounded research model
  researchEvidence: jsonb("research_evidence").$type<Record<string, unknown>>(),
  originCountryCode: text("origin_country_code"),
  originCountry: text("origin_country"),
  originRegion: text("origin_region"),
  originCity: text("origin_city"),
  originLat: doublePrecision("origin_lat"),
  originLng: doublePrecision("origin_lng"),
  originNetwork: text("origin_network"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  authorHandle: text("author_handle"),
  accountCreatedAt: timestamp("account_created_at"),
  replyToCommentId: integer("reply_to_comment_id"),
  sharedUrl: text("shared_url"),
  deviceFingerprint: text("device_fingerprint"),
  telemetrySummary: jsonb("telemetry_summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [uniqueIndex("submissions_tenant_comment_idx").on(table.tenantId, table.wpCommentId)]);

export const trafficLogs = pgTable("traffic_logs", {
  tenantId: text("tenant_id").primaryKey(),
  rawLogs: text("raw_logs").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const socialDatasets = pgTable("social_datasets", {
  tenantId: text("tenant_id").primaryKey(),
  itemsJson: jsonb("items_json").$type<Array<Record<string, unknown>>>().default([]).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  tenantId: text("tenant_id").default("legacy").notNull(),
  entityId: text("entity_id").notNull(),
  anomalyStatus: text("anomaly_status").default("normal").notNull(), // 'normal' | 'legitimate_backlash' | 'coordinated_attack'
  bannerExplanation: text("banner_explanation"),
  sources: jsonb("sources").$type<Array<{title: string; url: string}>>().default([]).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.entityId] })]);

// Durable ingestion outbox. Redis may be unavailable without losing accepted submissions.
export const evaluationJobs = pgTable("evaluation_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  queueName: text("queue_name").default("shield-evaluation-v2").notNull(),
  tenantId: text("tenant_id").notNull(),
  wpCommentId: integer("wp_comment_id").notNull(),
  data: jsonb("data").notNull(),
  result: jsonb("result").$type<Record<string, any>>(),
  deliveredAt: timestamp("delivered_at"),
  contextCompletedAt: timestamp("context_completed_at"),
  failureCount: integer("failure_count").default(0).notNull(),
  nextAttemptAt: timestamp("next_attempt_at"),
  retryPausedAt: timestamp("retry_paused_at"),
  lastError: jsonb("last_error").$type<{ message: string; reason: string; status?: number }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [uniqueIndex("evaluation_jobs_tenant_comment_idx").on(table.tenantId, table.wpCommentId)]);
