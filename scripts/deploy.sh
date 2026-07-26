#!/usr/bin/env bash
# Production deploy for the DigitalOcean droplet.
#
# Usage (on the droplet):
#   cd /opt/boostfarm && bash scripts/deploy.sh
#
# What it does: pulls main, rebuilds both images (web = nginx with the
# game/admin/partner SPAs baked in, api = Express backend) and restarts
# the containers. DB migrations are NOT run automatically — apply new
# files from supabase/migrations/ manually via psql when a release
# includes them (the commit message will say so).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Pulling latest main"
git pull origin main

echo "==> Rebuilding and restarting containers"
docker compose up -d --build

echo "==> Status"
docker compose ps

echo "==> Last API log lines (Ctrl+C to exit)"
docker compose logs api --tail 20
