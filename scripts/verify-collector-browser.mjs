import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { strict as assert } from 'node:assert';
import { generateKeyPairSync, privateDecrypt, createDecipheriv } from 'node:crypto';

// Exercise the native browser form algorithm, which synthetic DOM submit tests miss.
const collector = await readFile(new URL('../wp-content/plugins/shield-guard/assets/collector.js', import.meta.url), 'utf8');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const received = [];
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/collector.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(collector);
    return;
  }
  if (request.url === '/submit') {
    let body = '';
    for await (const chunk of request) body += chunk;
    received.push(new URLSearchParams(body));
    response.writeHead(303, { Location: '/submitted' });
    response.end();
    return;
  }
  if (request.url === '/submitted') { response.end('Submitted'); return; }
  const mode = new URL(request.url, 'http://localhost').searchParams.get('mode');
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html><body>
    <form id="commentform" method="post" action="/submit">
      <textarea id="comment" name="comment" required></textarea>
      <input name="comment_post_ID" type="hidden" value="42">
      <input id="submit" name="submit" type="submit" value="Post Comment">
    </form>
    <script>window.shieldMetricsConfig = ${JSON.stringify({ publicKey: mode === 'missing-key' ? '' : spki })};
    ${mode === 'crypto-failure' ? 'crypto.subtle.encrypt = async function() { throw new Error("Simulated crypto failure"); };' : ''}
    </script><script src="/collector.js"></script></body></html>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  for (const mode of ['encrypted', 'missing-key', 'crypto-failure', 'validation-retry']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`);
    const count = received.length;
    if (mode === 'validation-retry') {
      await page.locator('#submit').click();
      assert.equal(received.length, count, 'required fields must still be validated');
    }
    await page.locator('#comment').fill(`Verification ${mode}`);
    await Promise.all([
      page.waitForURL(`${origin}/submitted`, { timeout: 5000 }),
      page.locator('#submit').click(),
    ]);
    assert.equal(received.length, count + 1, 'one click must produce exactly one POST');
    const body = received.at(-1);
    assert.equal(body.get('comment'), `Verification ${mode}`);
    assert.equal(body.get('comment_post_ID'), '42');
    assert.equal(body.get('submit'), 'Post Comment', 'preserve the clicked WordPress submit control');
    assert.deepEqual(errors, []);
    if (mode === 'missing-key' || mode === 'crypto-failure') {
      assert.equal(body.get('_shield_token'), '', 'telemetry failures must allow native submission');
    } else {
      const [version, wrapped, iv, encrypted] = body.get('_shield_token').split('.');
      assert.equal(version, 'v1');
      const aes = privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(wrapped, 'base64'));
      const data = Buffer.from(encrypted, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', aes, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(data.subarray(-16));
      const telemetry = JSON.parse(Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString());
      assert.equal(typeof telemetry.formCompletionTimeMs, 'number');
    }
    console.log(`PASS native comment form: ${mode}`);
    await page.close();
  }
} finally {
  await browser?.close();
  server.close();
  server.closeAllConnections();
}
