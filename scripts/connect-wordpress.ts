/** Provision the existing local Docker WordPress installation without printing its secrets. */
import { db, sql } from "../src/db";
import { tenants } from "../src/db/schema";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const php = `require '/var/www/html/wp-load.php';
$options = get_option('shield_guard_settings', array());
if (empty($options['api_key']) || $options['api_key'] === 'default_tenant') $options['api_key'] = 'tenant_' . wp_generate_password(40, false);
if (empty($options['webhook_secret']) || in_array($options['webhook_secret'], array('shield_shared_secret', 'replace_with_shared_wp_hmac_secret'), true)) $options['webhook_secret'] = wp_generate_password(48, false);
update_option('shield_guard_settings', $options);
delete_transient('shield_telemetry_public_key');
echo wp_json_encode(array('apiKey' => $options['api_key'], 'webhookSecret' => $options['webhook_secret'], 'wpWebhookUrl' => rest_url('shield/v1/webhook'), 'thresholdMode' => $options['threshold_mode'] ?? 'balanced'));`;
const proc = Bun.spawn(["docker", "compose", "exec", "-T", "wordpress", "php", "-r", php], { stdout: "pipe", stderr: "pipe" });
const text = await new Response(proc.stdout).text();
if (await proc.exited !== 0) throw new Error("Could not read WordPress configuration");
const tenant = JSON.parse(text);
await db.insert(tenants).values(tenant).onConflictDoUpdate({ target: tenants.apiKey, set: tenant });
const path = process.env.TELEMETRY_PRIVATE_KEY_PATH || "./keys/telemetry-private.pem";
if (!existsSync(path)) {
  mkdirSync(path.slice(0, path.lastIndexOf("/")) || ".", { recursive: true });
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
}
console.log("Local WordPress tenant and telemetry encryption configured; credentials kept private.");
await sql.end();
