#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting auto-sync watcher in $REPO_DIR..."

while true; do
  # Fetch latest changes without modifying working tree
  git fetch origin main --quiet 2>/dev/null || true

  LOCAL_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")
  REMOTE_COMMIT=$(git rev-parse origin/main 2>/dev/null || echo "")

  if [ -n "$LOCAL_COMMIT" ] && [ -n "$REMOTE_COMMIT" ] && [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Detected new commits on origin/main: $LOCAL_COMMIT -> $REMOTE_COMMIT"
    
    # Check if package.json will change
    PKG_CHANGED=$(git diff --name-only "$LOCAL_COMMIT" "$REMOTE_COMMIT" | grep -E '^package\.json$' || true)

    # Pull changes
    git pull origin main

    if [ -n "$PKG_CHANGED" ]; then
      echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] package.json changed, installing dependencies..."
      if command -v bun >/dev/null 2>&1; then
        bun install
      fi
    fi

    # Trigger restart if running under systemd or docker
    if systemctl is-active --quiet bun-app 2>/dev/null; then
      echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Restarting bun-app systemd service..."
      systemctl restart bun-app
    elif command -v docker >/dev/null 2>&1 && docker compose ps bun-app >/dev/null 2>&1; then
      echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Restarting bun-app container..."
      docker compose restart bun-app
    fi

    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Bun instance updated successfully to $REMOTE_COMMIT"
  fi

  sleep 15
done
