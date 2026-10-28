#!/usr/bin/env bash
# Kjøres ved oppstart av hver Claude-økt i skyen (se .claude/settings.json).
# Gjør at lint, typesjekk og tester virker med en gang. Tåler å kjøres flere ganger.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"

bash scripts/cloud-setup.sh
[ -f .env ] || cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:migrate "$(grep ^TEST_DATABASE_URL .env | cut -d= -f2-)"
pnpm db:seed
