# Verius

Text-only bot and rhetorical manipulation detection for WordPress and WooCommerce, running on Bun, PostgreSQL and Redis. Jev evaluates the 50 criteria; the deterministic scorer selects a route; the configurable research model verifies endorsement and generates explanations only when needed.

Comments are stored in WordPress immediately and remain author-only while processing. The API acknowledges durable PostgreSQL ingestion with HTTP 202. BullMQ workers persist the verdict and send a signed callback. Bots remain author-only and are also stored in the backend honeypot. Human posts remain public; confirmed manipulation gets question IDs and a heavy-model explanation. Fast clears and shielded consumer complaints receive no generated prose.

## Local setup

Requires Bun and Docker Compose.

```sh
bun install
cp .env.example .env
# Configure HOSTINGER_AI_API_KEY, CONTEXT_DEV_API_KEY, and non-placeholder tenant/webhook secrets.
docker compose up -d
bun run db:migrate
bun run tenant:provision
bun run dev
```

Configure **Settings → Verius** in WordPress:

- Backend URL: `http://host.docker.internal:4000` when WordPress runs in Docker and Bun runs on the host. Set `HOST=0.0.0.0` in local `.env` for this arrangement.
- Tenant API key and webhook secret: exactly the values used for provisioning.
- WordPress callback: set `WP_DEFAULT_WEBHOOK_URL` before provisioning to the URL reachable **from Bun**, usually `http://127.0.0.1:8080/wp-json/shield/v1/webhook`.
- Choose strict, balanced, or high precision. Saving settings synchronizes the mode to the backend.

For an already configured local Docker WordPress installation, `bun run wordpress:connect` provisions its existing credentials in PostgreSQL and generates the persistent telemetry key without printing secrets.

Serve the public WordPress site over HTTPS (localhost also works) so Web Crypto can encrypt telemetry. The plugin fetches only the backend public key; the RSA private key stays in ignored `keys/`. The browser uses a fresh AES-GCM key and nonce for each token, wrapped with RSA-OAEP. Missing telemetry alone does not classify someone as a bot. Exclude protected comment/review pages from any reverse-proxy page cache; the plugin sets WordPress no-cache headers and partitions comment query caches by session.

## Single VPS deployment

A Docker backend profile is included:

```sh
# Configure .env first, including a strong stable TENANT_API_KEY and WP_WEBHOOK_SECRET.
docker compose up -d postgres redis wordpress-db wordpress
docker compose --profile backend run --rm bun-app bun run scripts/provision-tenant.ts
docker compose --profile backend up -d --build bun-app
```

In this arrangement set WordPress's Backend URL to `http://bun-app:4000`; the provision command registers `http://wordpress/wp-json/shield/v1/webhook` as its callback. These Docker service names work on the VPS's internal Compose network. Backend port 4000 and database/Redis ports bind to loopback. Put HTTPS in front of WordPress. Keep the `keys/` directory and database volumes backed up. Existing host Bun processes on port 4000 must be stopped before using the Docker backend profile.

The migration is additive and preserves existing submissions/vault records. Old records without a tenant remain unassigned and are not exposed through tenant APIs. Register additional tenants with distinct API keys, webhook URLs and secrets using `tenant:provision`. Webhook destinations are registered on the server; callers cannot override them in ingestion payloads.

## API

All `/v1/*` endpoints require a server-side `X-Shield-Key` or Bearer API key. Never put the tenant key in browser code.

| Endpoint | Behavior |
| --- | --- |
| `POST /v1/ingest` | Accepts `wpCommentId`, `entityId`, `authorSessionHash`, `rawText`, optional entity title/rating/telemetry/honeypot. Returns opaque durable acceptance. Repeated tenant/comment IDs reuse the original job. |
| `POST /v1/analyze` | Synchronous `{text, mode?}` analysis, with IDs, scores, route, actual model and nullable heavy explanation. Provider failures return 503. |
| `GET /v1/submissions/:id` | Tenant-only job status, stored verdict, last provider error, failure count and next retry time. |
| `POST /v1/submissions/:id/retry` | Resume a saved job after fixing provider quota/configuration; requires the owning tenant key. |
| `PATCH /v1/tenant/mode` | `{mode: "strict" | "balanced" | "high_precision"}` for the authenticated tenant. |
| `GET /v1/entity/:id/banner` | Tenant-specific review context with supporting source links. |
| `GET /v1/honeypot/patterns` | Repeated bot template clusters over 24 hours; no automatic human bans. |
| `GET /v1/telemetry/key` | Public encryption key for the server integration to embed. |
| `GET /api/health` | Process liveness. |
| `GET /api/ready` | Database, queue and credential configuration readiness. Does not promise live provider availability. |

WordPress retries failed acceptance through WP-Cron. Configure a real recurring WP-Cron trigger on a low-traffic VPS. PostgreSQL retains accepted jobs through Redis outages. Workers retry failed callbacks using the stored verdict without repeating AI analysis. Failed review-context research is independent of comment publication. Research-model calls are serialized and share a cooldown after a 429. Provider `Retry-After` delays are honored; a quota error without a retry hint defaults to 15 minutes. Retry times and errors persist in PostgreSQL. Jobs pause after five failures (immediately for non-retryable HTTP errors), and the outbox does not silently re-create exhausted jobs. Status becomes `needs_attention` for an unevaluated paused job. After restoring quota, use the tenant-authenticated retry endpoint; retries reuse the existing saved comment. A provider cooldown still applies to manually resumed work.

## Review context

The research model is selected by `MODEL_HEAVY_RESEARCH`, defaulting to the low-cost `gpt-5-nano`. Both the fast Jev screener and the research model run through **Hostinger AI Router** with `HOSTINGER_AI_API_KEY`. Model selection stays configurable; no provider-specific model brand is built into routing or UI labels.

Jev evaluates the 50 rhetoric criteria plus two independent decisions: `needsFactCheck` for potentially false or misleading factual assertions, and `needsWebSearch` for current information, specific allegations, obscure events or original quote context. Either decision can escalate a calmly worded claim even below the rhetoric threshold (`ROUTE_5_FACT_CHECK`). Higher-tier analysis can also be triggered by the existing rhetoric score. Only `needsWebSearch` enables Context.dev requests for comment analysis; otherwise the higher-tier model uses established knowledge and reasoning without fetching even submitted URLs. Opinions, preferences, personal experiences and harmless stable facts do not automatically need a search.

Set `CONTEXT_DEV_API_KEY` in the server's `.env`, then restart the backend. Context.dev supplies all web evidence; both the fast screener and the configurable research model continue to run through Hostinger AI Router. The key stays server-side. `/api/ready` reports missing research credentials, and the app does not fall back to the previous search provider.

The integration follows Context.dev's documented REST API at `https://api.context.dev/v1` with Bearer authentication:

- [Web search](https://docs.context.dev/api-reference/web-scraping/search.md): `POST /web/search` retrieves primary sources and quote origins, with inline Markdown enabled. Only `markdown.code === "SUCCESS"` and non-loading page content count as retrieved originals. Descriptions remain search excerpts.
- [News search](https://docs.context.dev/api-reference/news/search.md): `POST /news/search` uses natural-language queries. Review investigations restrict publication dates to the last 72 hours and preserve publisher/date information for the research model.
- [Original-page scraping](https://docs.context.dev/scrape/markdown.md): `POST /web/scrape` retrieves article text using `formats.markdown` and `sharedParams.mainContentOnly`. The adapter checks output-level `markdown.success`, rejects partial/empty outputs, and reads `markdown.data`; HTTP 200 alone is not proof of a successful scrape.

The higher-tier model returns claim-by-claim verdicts (`correct`, `incorrect`, `misleading`, `unsubstantiated`, or `opinion`), explanations, accurate corrections for incorrect/misleading facts, and supporting source URLs. Flagged explanations identify each assessed statement and its verdict, including correct statements alongside corrections. Unsubstantiated claims receive no invented correction. Trust is assessed from primary evidence, expertise, relevance, date, conflicts of interest and independent corroboration; repetition alone does not establish truth. Opinions and personal experiences are not deemed false for lacking web evidence. Rhetorical manipulation is assessed separately from factual accuracy.

Public context explanations are capped at five sentences, prioritizing factual corrections and reserving room for uncertainty and any no-search disclosure. Full claim assessments remain in `claimChecks`, and source links stay separate from the short notice. Review context banners use the same sentence cap.

In web mode, supporting citations must match retrieved sources, and each substantiated factual verdict/correction needs original-page evidence. Headlines and search excerpts are insufficient. Missing support remains `unverified` and produces an unsubstantiated-claims warning, distinct from a sourced finding that facts are incorrect. In knowledge-only mode, `researchStatus` is `not_requested` and the explanation explicitly states no web search was used; the intentional absence of web sources does not itself cause a flag. The API returns `research_evidence` with `claimChecks`, `quoteChecks`, `sources` and `searchPerformed`. WordPress renders explanations and source links.

Search requests return at most five web pages and five news articles. Web results lacking inline Markdown and up to three news articles are candidates for automatic scraping; each scrape phase is capped at five original pages and 16,000 characters per page. Quote checks reuse original pages already retrieved. Cached page content is restricted to one hour. API deadlines are shorter than client timeouts; partial search results are used only when their individual content status succeeds. Source material outside retrieved content remains unverified.

Quote-origin queries run only for quotations detected in the submitted text when Jev requests web research. Ordinary claims use a general search; model-generated quote checks cannot trigger additional retrieval. Empty comment searches still complete through the higher-tier model so it can identify the specific unsubstantiated claims; they do not fail the request or fabricate corrective facts. Empty review-spike research returns `normal` without a banner; missing news alone does not establish a coordinated attack. Provider outages, invalid credentials, and quota failures remain operational errors and do not become misleading-content verdicts.

Review investigations require at least five distinct negative reviewers in the last hour and use velocity/rating-distribution changes against available history. Bots are excluded. The Hostinger model interprets Context.dev evidence; review context banners expire after six hours.

Jev uses the provider's [System One endpoint](https://routerone.ai/api-reference/models/systemone). Model configuration is explicit; there is no heuristic masquerading as a successful AI response.

## Verification

```sh
bun run test
bun run typecheck
bun run verify:e2e
bun run verify:wordpress
# Native comment Submit button, encryption failures and browser validation (Chrome required).
bun run verify:browser
# Optional: consumes a few real model calls against the running local backend.
bun run scripts/verify-live-wordpress.ts
```

Unit tests cover routing, shields, encryption/tampering, provider failures, citation validation and review windows. The end-to-end suite uses real PostgreSQL/Redis and HTTP callbacks with deterministic provider fixtures, including callback failure/retry, tenant isolation and duplicate ingestion. WordPress checks author/public visibility, cache separation, REST reads, counts, HMAC callbacks and rendered context. Verification scripts remove their own fixtures.

Current honeypot pattern recognition groups normalized repeated templates. Semantic embedding clustering and learned campaign classifiers are not implemented. There is no claim that linguistic flags alone establish a coordinated campaign.

## Provider quota errors

Hostinger model credits and Context.dev credits are separate. Context.dev HTTP 402 (`USAGE_EXCEEDED`) requires restoring credits; 401/403 require correcting credentials or access rather than repeated retries. See the [Context.dev error guide](https://docs.context.dev/optimization/troubleshooting.md). The app preserves the provider's error reason and retry hints, keeps provider cooldowns separate, and never treats quota errors as content verdicts. Check the named provider's account/credit limits, then resume saved jobs with the tenant-authenticated retry endpoint. Direct-provider errors from the removed research integration no longer apply to the new pipeline.
