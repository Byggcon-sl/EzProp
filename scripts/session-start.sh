#!/usr/bin/env bash
# Kjøres ved oppstart av hver Claude-økt i skyen (se .claude/settings.json).
# Gjør at lint, typesjekk og tester virker med en gang. Tåler å kjøres flere ganger.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"

bash scripts/cloud-setup.sh
[ -f .env ] || cp .env.example .env
# Produksjonsvakten (A302) for testoppdrag og testdata godtar bare development og test.
# Legges til i en eldre .env; en verdi som står der fra før, endres ikke.
grep -q "^APP_ENVIRONMENT=" .env || printf '\nAPP_ENVIRONMENT=development\n' >>.env
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:migrate "$(grep ^TEST_DATABASE_URL .env | cut -d= -f2-)"
pnpm db:seed
pnpm db:seed:testoppdrag
