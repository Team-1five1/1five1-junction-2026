# 1five1-junction-2026

Production VPS deployment with **WordPress** and **Bun** running in the background with continuous auto-sync on Git pushes.

---

## 🌐 Live Services on Hostinger VPS

| Service | Port | Direct URL | Description |
| :--- | :--- | :--- | :--- |
| **Bun Background Service** | `3000` | [http://72.61.22.111:3000](http://72.61.22.111:3000) | Fast TypeScript/Bun runtime with auto-reload |
| **WordPress Instance** | `8080` | [http://72.61.22.111:8080](http://72.61.22.111:8080) | WordPress powered by MariaDB |
| **MariaDB** | `3306` | *Internal network* | Database for WordPress |

---

## 🚀 Auto-Deploy on Git Push

Whenever changes are pushed to `origin/main` on GitHub:
1. The background **`auto-sync`** service automatically detects new commits on `origin/main` (polling every 15s).
2. It pulls the updated files (`git pull origin main`).
3. If `package.json` changed, dependencies are installed (`bun install`).
4. **Bun** runs with `--watch`, detecting the file changes on disk and hot-reloading the running service instantly with zero downtime.

### Optional: Instant Webhook
You can also configure GitHub Webhooks in your repository settings:
- **Payload URL**: `http://72.61.22.111:3000/api/webhook`
- **Content type**: `application/json`
- **Events**: Just the `push` event.

---

## 🛠 Local Development

```bash
# Install dependencies
bun install

# Run the Bun server in watch mode
bun run dev

# Or with Docker Compose (includes WordPress & MariaDB)
docker compose up -d
```

---

## 🔒 SSH Access to VPS

The server is configured with your SSH key:
```bash
ssh root@72.61.22.111
# or using the configured alias:
ssh hostinger-vps
```

### Inspecting services on the server:
```bash
# View running containers
docker compose ps

# View Bun application logs
docker compose logs -f bun-app

# View Git sync logs
docker compose logs -f auto-sync

# View WordPress logs
docker compose logs -f wordpress
```
