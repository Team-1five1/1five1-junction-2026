/** Provision the local Docker WordPress installation, ensuring it is installed, active, and synced to Postgres. */
import { db, sql } from "../src/db";
import { tenants } from "../src/db/schema";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const php = `require '/var/www/html/wp-load.php';
if (!is_blog_installed()) {
  require_once '/var/www/html/wp-admin/includes/upgrade.php';
  wp_install('Verius Dev Site', 'admin', 'admin@example.org', true, '', 'admin_password_2026');
}
require_once '/var/www/html/wp-admin/includes/plugin.php';
if (!is_plugin_active('shield-guard/shield-guard.php')) {
  activate_plugin('shield-guard/shield-guard.php');
}
$options = get_option('shield_guard_settings', array());
if (empty($options['api_url']) || $options['api_url'] === 'http://127.0.0.1:4000' || $options['api_url'] === 'http://localhost:4000') {
  $options['api_url'] = 'http://host.docker.internal:4000';
}
if (empty($options['api_key']) || $options['api_key'] === 'default_tenant') {
  $options['api_key'] = 'tenant_' . wp_generate_password(40, false);
}
if (empty($options['webhook_secret']) || in_array($options['webhook_secret'], array('shield_shared_secret', 'replace_with_shared_wp_hmac_secret'), true)) {
  $options['webhook_secret'] = wp_generate_password(48, false);
}
update_option('shield_guard_settings', $options);
delete_transient('shield_telemetry_public_key');
echo wp_json_encode(array(
  'apiKey' => $options['api_key'],
  'webhookSecret' => $options['webhook_secret'],
  'wpWebhookUrl' => rest_url('shield/v1/webhook'),
  'thresholdMode' => $options['threshold_mode'] ?? 'balanced',
  'apiUrl' => $options['api_url']
));`;

let text = "";
let retries = 10;
while (retries > 0) {
  try {
    const proc = Bun.spawn(["docker", "compose", "exec", "-T", "wordpress", "php", "-r", php], { stdout: "pipe", stderr: "pipe" });
    text = await new Response(proc.stdout).text();
    if ((await proc.exited) === 0 && text.trim().startsWith("{")) break;
  } catch {}
  retries--;
  if (retries > 0) {
    console.log("Waiting for WordPress container to become ready...");
    await Bun.sleep(3000);
  }
}

if (!text.trim().startsWith("{")) {
  throw new Error(`Could not read WordPress configuration. Container output: ${text}`);
}

const tenantData = JSON.parse(text);
const tenant = {
  apiKey: tenantData.apiKey,
  webhookSecret: tenantData.webhookSecret,
  wpWebhookUrl: tenantData.wpWebhookUrl,
  thresholdMode: tenantData.thresholdMode,
};

await db.insert(tenants).values(tenant).onConflictDoUpdate({ target: tenants.apiKey, set: tenant });

const path = process.env.TELEMETRY_PRIVATE_KEY_PATH || "./keys/telemetry-private.pem";
if (!existsSync(path)) {
  mkdirSync(path.slice(0, path.lastIndexOf("/")) || ".", { recursive: true });
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
}

console.log(`✓ Local WordPress connected and provisioned:
  - Site URL:        http://localhost:8080 (admin / admin_password_2026)
  - Backend URL:     ${tenantData.apiUrl}
  - Tenant API Key:  ${tenant.apiKey}
  - Webhook URL:     ${tenant.wpWebhookUrl}
  - Postgres Tenant: Synchronized in 'tenants' table
  - Telemetry RSA:   ${path}`);

await sql.end();
