import { db, sql } from "../src/db";
import { tenants } from "../src/db/schema";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const webhookUrl = process.env.WP_DEFAULT_WEBHOOK_URL;
if (!webhookUrl || !/^https?:\/\//.test(webhookUrl)) throw new Error("Set WP_DEFAULT_WEBHOOK_URL to the WordPress callback URL");
const apiKey = process.env.TENANT_API_KEY || `tenant_${randomBytes(24).toString("hex")}`;
if (apiKey.startsWith("replace_")) throw new Error("Set a random TENANT_API_KEY before provisioning");
const webhookSecret = process.env.WP_WEBHOOK_SECRET;
if (!webhookSecret || webhookSecret.startsWith("replace_") || webhookSecret === "shield_shared_secret") throw new Error("Set a strong WP_WEBHOOK_SECRET before provisioning");
await db.insert(tenants).values({ apiKey, webhookSecret, wpWebhookUrl: webhookUrl }).onConflictDoUpdate({
  target: tenants.apiKey, set: { webhookSecret, wpWebhookUrl: webhookUrl },
});
const path = process.env.TELEMETRY_PRIVATE_KEY_PATH || "./keys/telemetry-private.pem";
if (!existsSync(path)) {
  mkdirSync(path.slice(0, path.lastIndexOf("/")) || ".", { recursive: true });
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
}
console.log("Tenant provisioned. Configure this key in WordPress (keep it private):", apiKey);
await sql.end();
