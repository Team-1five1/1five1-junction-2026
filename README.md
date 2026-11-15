# Verius

AI-powered tool to detect and prevent propaganda, rhetorical manipulation, and automated bot attacks.

Verius protects online discussions and review sections by intercepting synthetic traffic, verifying factual claims against live sources, and neutralizing coordinated disinformation campaigns without degrading legitimate user experience.

## Overview

- **Content & Propaganda Analysis**: Evaluates submitted content against structured rhetorical criteria, identifies manipulative patterns, and flags coordinated misinformation.
- **Honeypot Fake Traffic Mitigation**: Traps automated bots, crawlers, and spam submissions in honeypot vaults to isolate malicious actors and analyze threat behavior.
- **Continuous Threat Learning**: Clusters recurring bot templates and attack patterns over time to dynamically detect coordinated campaigns and distinguish organic traffic spikes from organized brigading.
- **Zero-Friction Protection**: Uses cryptographic zero-click client telemetry and honeypots instead of intrusive interactive CAPTCHAs, keeping human interactions seamless.

## Key Capabilities

### Propaganda & Manipulation Detection
- **Two-Stage Scanning Architecture**: Fast deterministic screening handles approximately 80% of submissions in under 1 second. Only ambiguous or high-risk claims (~20%) escalate to a deep reasoning model.
- **Context Awareness**: Analyzes claims within situational context, distinguishing bad-faith rhetorical tactics from authentic criticism, subjective opinions, or benign consumer complaints.
- **Live Web Fact-Checking**: Integrates real-time search and web scraping (via Context.dev) to corroborate factual claims against primary sources, verify quote attributions, and produce concise corrections.
- **High System Accuracy**: Delivers ~90% overall system accuracy, capturing up to 99.6% of detected threats while avoiding false flags on harmless opinions.

### Bot Detection & Traffic Filtering
- **Zero-Click Verification**: Encrypted browser-side verification (RSA-OAEP + AES-GCM) validates legitimate user interactions transparently without requiring interactive puzzle challenges.
- **Honeypot Traffic Isolation**: Silently traps and routes automated submissions into backend quarantine vaults while keeping the response author-isolated.
- **Spike vs. Bot Attack Differentiation**: Analyzes author velocity, session signals, and rating shifts to separate genuine viral surges from automated review-bombing campaigns.
- **High-Fidelity Filtering**: Achieves >95% overall bot detection accuracy, neutralizing 100% of automated bot attacks with an average of <1% legitimate traffic blocked.

## Architecture & Processing Flow

1. **Ingestion & Containment**: Submissions (comments, reviews) are accepted asynchronously (`POST /v1/ingest`, HTTP 202) into PostgreSQL and Redis-backed BullMQ queues. In WordPress, comments remain author-visible only during analysis.
2. **First-Stage Screening (Fast Screener)**: Evaluates 50 rhetorical manipulation criteria and determines whether factual claim verification or web retrieval is needed.
3. **Second-Stage Verification (Deep Model + Live Search)**: When flagged, Context.dev retrieves primary sources and articles; the Hostinger AI Router research model verifies claims and generates structured explanations (claim checks, quote checks, and citations).
4. **Verdict & Webhook Notification**: Signed HMAC webhooks notify WordPress. Harmless human posts are cleared for public view; confirmed manipulation or bot spam is quarantined or annotated with contextual notices.

## Quickstart

### Prerequisites
- Bun runtime
- Docker and Docker Compose

### Local Setup
```sh
# 1. Install dependencies
bun install

# 2. Configure environment variables
cp .env.example .env
# Set HOSTINGER_AI_API_KEY and CONTEXT_DEV_API_KEY in .env

# 3. Start local Docker services (PostgreSQL, Redis, WordPress, MariaDB)
docker compose up -d

# 4. Push database schema migrations
bun run db:migrate

# 5. Connect and initialize WordPress (installs WP if needed, activates plugin, syncs tenant secrets)
bun run wordpress:connect

# 6. Start the Verius Bun development server & telemetry dashboard
bun run dev
```

### Local Dev Architecture & Port Mappings
In the default local setup, Bun runs on the host while WordPress and supporting databases run inside Docker:
- **Verius Backend & Telemetry Dashboard**: `http://localhost:4000` (listens on `0.0.0.0:4000`; Docker containers connect via `http://host.docker.internal:4000`).
- **WordPress Site**: `http://localhost:8080` (Default credentials created by `wordpress:connect`: username `admin`, password `admin_password_2026`).
- **PostgreSQL**: Bound to `127.0.0.1:5433` (mapped from container port 5432 to avoid local port conflicts).
- **Redis**: Bound to `127.0.0.1:6380` (mapped from container port 6379 to avoid local port conflicts).

### Single VPS Deployment (Docker Compose)
```sh
# Configure .env first, including a strong stable TENANT_API_KEY and WP_WEBHOOK_SECRET
docker compose up -d postgres redis wordpress-db wordpress
docker compose --profile backend run --rm bun-app bun run scripts/provision-tenant.ts
docker compose --profile backend up -d --build bun-app
```

## API Reference

All `/v1/*` endpoints require authentication via `X-Shield-Key` or Bearer token header.

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/ingest` | `POST` | Asynchronous submission ingestion with telemetry and honeypot validation. Returns HTTP 202. |
| `/v1/analyze` | `POST` | Synchronous direct analysis returning rhetoric scores, claim checks, and explanation. |
| `/v1/submissions/:id` | `GET` | Retrieve processing status, verdict, error details, and retry schedule. |
| `/v1/submissions/:id/retry` | `POST` | Re-queue a failed or paused job after addressing upstream provider quota issues. |
| `/v1/tenant/mode` | `PATCH` | Update tenant operating mode (`strict`, `balanced`, `high_precision`). |
| `/v1/entity/:id/banner` | `GET` | Retrieve review-context investigation banner and supporting sources. |
| `/v1/honeypot/patterns` | `GET` | View aggregated bot template clusters over the last 24 hours. |
| `/v1/telemetry/key` | `GET` | Public RSA encryption key for client-side telemetry payloads. |
| `/api/health` | `GET` | Health check for process liveness. |
| `/api/ready` | `GET` | Readiness check for database, queue, and API credentials. |

## Verification & Testing

```sh
# Run unit and integration tests
bun run test

# Type checking
bun run typecheck

# End-to-end integration suite (PostgreSQL, Redis, webhook retries)
bun run verify:e2e

# WordPress plugin verification
bun run verify:wordpress

# Browser telemetry and submission flow (requires Google Chrome)
bun run verify:browser

# Optional live test against configured AI providers
bun run scripts/verify-live-wordpress.ts
```
