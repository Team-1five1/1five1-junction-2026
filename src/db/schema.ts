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
