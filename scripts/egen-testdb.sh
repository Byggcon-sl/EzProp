#!/usr/bin/env bash
# Egen testdatabase per branch, så agenter som kjører tester samtidig (worktrees) ikke
# tømmer hverandres data. Skriver ut TEST_DATABASE_URL. Bruk:
#   export TEST_DATABASE_URL="$(bash scripts/egen-testdb.sh)" && pnpm test
set -euo pipefail
BRANCH=$(git rev-parse --abbrev-ref HEAD | tr -c 'a-z0-9\n' '_' | cut -c1-40)
DB="ezprop_test_${BRANCH}"
BASE=$(grep ^TEST_DATABASE_URL .env 2>/dev/null | cut -d= -f2- || true)
BASE=${BASE:-postgres://ezprop:ezprop@localhost:5432/ezprop_test}
URL="${BASE%/*}/${DB}"
PGPASSWORD=ezprop psql -h localhost -U ezprop -d postgres -tc "select 1 from pg_database where datname='${DB}'" | grep -q 1 ||
  PGPASSWORD=ezprop createdb -h localhost -U ezprop "${DB}"
echo "${URL}"
