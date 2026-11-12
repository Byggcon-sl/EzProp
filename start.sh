#!/usr/bin/env bash
# Starter EzProp lokalt på Mac, steg for steg.
#
#   ./start.sh            starter løsningen (henter også siste versjon hvis mulig)
#   ./start.sh --nullstill sletter alle lokale testdata og starter på nytt
#
# Vedlikeholdes av Claude: når oppsettet endres, oppdateres dette skriptet i samme PR.
# Skrevet for bash 3.2 (standard på Mac).

set -uo pipefail

cd "$(dirname "$0")" || exit 1

GRONN=$'\033[32m'
GUL=$'\033[33m'
ROD=$'\033[31m'
FET=$'\033[1m'
NORMAL=$'\033[0m'
STEG=0
TOTALT=10

steg() {
  STEG=$((STEG + 1))
  printf '\n%s[%d/%d] %s%s\n' "$FET" "$STEG" "$TOTALT" "$1" "$NORMAL"
}
ok() { printf '      %s✓%s %s\n' "$GRONN" "$NORMAL" "$1"; }
advarsel() { printf '      %s!%s %s\n' "$GUL" "$NORMAL" "$1"; }
stopp() {
  printf '\n%s✗ %s%s\n' "$ROD" "$1" "$NORMAL"
  shift
  for linje in "$@"; do printf '  %s\n' "$linje"; done
  printf '\nKopier gjerne teksten over til Claude, så hjelper han deg videre.\n'
  exit 1
}

NULLSTILL=0
for arg in "$@"; do
  case "$arg" in
    --nullstill | --reset) NULLSTILL=1 ;;
    -h | --help)
      sed -n '2,6p' "$0"
      exit 0
      ;;
    *) stopp "Ukjent valg: $arg" "Bruk ./start.sh eller ./start.sh --nullstill" ;;
  esac
done

printf '%sEzProp – lokal oppstart%s\n' "$FET" "$NORMAL"

# Egne porter på Macen, så EzProp kan kjøre samtidig med Optiplan (som bruker 3000 og 5432).
# Adressen er 127.0.0.1, ikke localhost, så innloggingen i de to løsningene ikke blander seg.
DB_PORT=5433
APP_PORT=3001
APP_URL="http://127.0.0.1:${APP_PORT}"
export EZPROP_DB_PORT=$DB_PORT

# ---------------------------------------------------------------------------
steg "Sjekker Node.js"
if ! command -v node >/dev/null 2>&1; then
  stopp "Node.js er ikke installert." "Last ned «LTS» fra https://nodejs.org og kjør skriptet igjen."
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  stopp "Node.js $(node -v) er for gammel." "Last ned «LTS» fra https://nodejs.org og kjør skriptet igjen."
fi
ok "Node.js $(node -v)"
[ "$NODE_MAJOR" -lt 22 ] && advarsel "Anbefalt er Node.js 22 eller nyere (https://nodejs.org)."

# ---------------------------------------------------------------------------
steg "Sjekker pnpm"
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
  ok "pnpm $(pnpm -v)"
else
  advarsel "pnpm mangler – prøver å slå det på (corepack)."
  if corepack enable >/dev/null 2>&1 || sudo corepack enable; then
    hash -r
  fi
  if command -v pnpm >/dev/null 2>&1; then
    PNPM=(pnpm)
    ok "pnpm $(pnpm -v)"
  else
    PNPM=(npx --yes pnpm@10.28.0)
    advarsel "Bruker pnpm via npx (litt tregere, men virker)."
  fi
fi

# ---------------------------------------------------------------------------
steg "Henter siste versjon"
if ! command -v git >/dev/null 2>&1 || [ ! -d .git ]; then
  advarsel "Fant ikke git. Hent siste versjon i GitHub Desktop (Fetch origin → Pull origin)."
elif [ -n "$(git status --porcelain)" ]; then
  advarsel "Det finnes lokale endringer, så jeg henter ikke ny versjon automatisk."
  advarsel "Bruk GitHub Desktop hvis du vil hente siste versjon."
else
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet origin "$BRANCH" >/dev/null 2>&1; then
    ok "Oppdatert ($BRANCH, $(git log -1 --format='%h %cd' --date=format:'%d.%m.%Y %H:%M'))"
  else
    advarsel "Fikk ikke hentet automatisk. Bruk GitHub Desktop: Fetch origin → Pull origin."
    advarsel "Fortsetter med versjonen du har."
  fi
fi

# ---------------------------------------------------------------------------
steg "Starter databasen (Docker)"
if [ "${EZPROP_SKIP_DOCKER:-0}" = "1" ]; then
  advarsel "Hopper over Docker (EZPROP_SKIP_DOCKER=1)."
else
  if ! command -v docker >/dev/null 2>&1; then
    stopp "Docker er ikke installert." "Installer Docker Desktop fra https://www.docker.com/products/docker-desktop/"
  fi
  if ! docker info >/dev/null 2>&1; then
    advarsel "Docker Desktop kjører ikke – starter det."
    open -a Docker >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do
      docker info >/dev/null 2>&1 && break
      sleep 2
    done
    docker info >/dev/null 2>&1 || stopp "Docker Desktop startet ikke." "Start Docker Desktop selv, vent til hvalen står stille, og kjør skriptet igjen."
  fi
  ok "Docker kjører"

  if [ "$NULLSTILL" = "1" ]; then
    advarsel "Sletter alle lokale testdata (--nullstill)."
    docker compose down -v >/dev/null 2>&1 || true
  fi
  # --remove-orphans stopper og fjerner containerne fra synkprøven (PowerSync og ElectricSQL,
  # fjernet 10.11.2026), så migreringen kan rydde replikeringsplassene deres.
  if ! docker compose up -d --remove-orphans db >/tmp/ezprop-docker.log 2>&1; then
    if grep -qi "port is already allocated\|address already in use" /tmp/ezprop-docker.log; then
      stopp "Port ${DB_PORT} er opptatt av en annen database på Macen." \
        "Stopp den andre databasen (f.eks. Postgres.app), eller spør Claude om hjelp."
    fi
    stopp "Klarte ikke å starte databasen." "$(tail -5 /tmp/ezprop-docker.log)"
  fi
  for _ in $(seq 1 30); do
    docker compose exec -T db pg_isready -U ezprop >/dev/null 2>&1 && break
    sleep 1
  done
  docker compose exec -T db pg_isready -U ezprop >/dev/null 2>&1 || stopp "Databasen svarer ikke." "Prøv ./start.sh --nullstill"
  ok "Databasen er klar"
fi

# ---------------------------------------------------------------------------
steg "Gjør klar innstillinger"
if [ ! -f .env ]; then
  cp .env.example .env
  ok "Laget .env fra .env.example"
else
  ok ".env finnes"
fi
# Flytt databasen til egen port og appen til egen adresse (også i en eldre .env).
sed -i '' \
  -e "s#@localhost:5432/ezprop#@localhost:${DB_PORT}/ezprop#g" \
  -e "s#^BETTER_AUTH_URL=http://localhost:3000\$#BETTER_AUTH_URL=${APP_URL}#" \
  .env
ok "Database på port ${DB_PORT}, EzProp på ${APP_URL} (Optiplan kan kjøre samtidig)"
# Nye innstillinger legges til tomme i en eldre .env, så det er lett å se hva som finnes.
# Tomme verdier betyr «ikke i bruk»: lokalt vises e-post på /dev/epost, og innlogging skjer med kode.
LAGT_TIL=""
for navn in MS_GRAPH_TENANT_ID MS_GRAPH_CLIENT_ID MS_GRAPH_CLIENT_SECRET MAIL_FROM MS_LOGIN_TENANT_ID MS_LOGIN_CLIENT_ID MS_LOGIN_CLIENT_SECRET; do
  if ! grep -q "^${navn}=" .env; then
    if [ -z "$LAGT_TIL" ]; then
      printf '\n# Lagt til av start.sh. Tomme verdier = ikke i bruk. Forklaring i .env.example.\n' >>.env
    fi
    printf '%s=\n' "$navn" >>.env
    LAGT_TIL="$LAGT_TIL $navn"
  fi
done
if [ -n "$LAGT_TIL" ]; then
  ok "La til nye, tomme innstillinger i .env:$LAGT_TIL"
fi
# Prøven uten nett (fase 1) trenger mappen for bildefilene. Verdien er den samme som i .env.example.
LAGT_TIL=""
for par in \
  "TRIAL_UPLOAD_DIR=var/uploads/trial"; do
  navn=${par%%=*}
  if ! grep -q "^${navn}=" .env; then
    if [ -z "$LAGT_TIL" ]; then
      printf '\n# Lagt til av start.sh for prøven uten nett. Forklaring i .env.example.\n' >>.env
    fi
    printf '%s\n' "$par" >>.env
    LAGT_TIL="$LAGT_TIL $navn"
  fi
done
if [ -n "$LAGT_TIL" ]; then
  ok "La til innstillinger for prøven uten nett i .env:$LAGT_TIL"
fi

# ---------------------------------------------------------------------------
steg "Installerer pakker"
# Rester fra PowerSync-prøven (fjernet 10.11.2026): worker og wasm som next.config.ts kopierte hit.
rm -rf public/@powersync
"${PNPM[@]}" install --frozen-lockfile --reporter=silent || stopp "Installasjonen feilet." "Se feilmeldingen over."
ok "Pakkene er på plass"

# ---------------------------------------------------------------------------
steg "Oppdaterer databasen"
"${PNPM[@]}" --silent db:migrate || stopp "Oppdatering av databasen feilet." "Se feilmeldingen over."
"${PNPM[@]}" --silent db:seed || stopp "Innlegging av grunndata feilet." "Se feilmeldingen over."
"${PNPM[@]}" --silent db:seed:testoppdrag || stopp "Innlegging av testoppdrag feilet." "Se feilmeldingen over."
ok "Databasen er oppdatert, med organisasjonen Byggcon, admin og testoppdragene"

# ---------------------------------------------------------------------------
steg "Starter EzProp"
# Kjører EzProp fra før (f.eks. et Terminal-vindu som ikke ble lukket), stoppes den gamle,
# så den nye versjonen og databaseendringene over blir tatt i bruk.
GAMMEL=$(lsof -ti tcp:${APP_PORT} -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$GAMMEL" ]; then
  if ps -p "$GAMMEL" -o command= 2>/dev/null | grep -qi "next\|node"; then
    advarsel "EzProp kjørte allerede (prosess $GAMMEL) – stopper den og starter på nytt."
    kill "$GAMMEL" 2>/dev/null || true
    for _ in $(seq 1 10); do
      lsof -ti tcp:${APP_PORT} -sTCP:LISTEN >/dev/null 2>&1 || break
      sleep 1
    done
    if lsof -ti tcp:${APP_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
      kill -9 "$GAMMEL" 2>/dev/null || true
      sleep 1
    fi
    # Next.js lar en låsfil ligge igjen når den stoppes brått
    rm -f .next/dev/lock 2>/dev/null || true
  else
    stopp "Port ${APP_PORT} er opptatt av et annet program." \
      "Lukk programmet som bruker port ${APP_PORT}, eller spør Claude om hjelp." \
      "(Det er prosess $GAMMEL: $(ps -p "$GAMMEL" -o command= 2>/dev/null))"
  fi
fi

cat <<EOF

      Åpner ${FET}${APP_URL}${NORMAL} i nettleseren når den er klar.

      Logg inn som:   ${FET}admin@byggcon.no${NORMAL}   (admin)
      Koden finner du: ${FET}${APP_URL}/dev/epost${NORMAL}

      Stopp med ${FET}Ctrl + C${NORMAL}.

EOF

if [ "${EZPROP_NO_BROWSER:-0}" != "1" ]; then
  (
    for _ in $(seq 1 90); do
      if curl -s -o /dev/null ${APP_URL}/logg-inn; then
        open "${APP_URL}/dev/epost" >/dev/null 2>&1 || true
        open "${APP_URL}/logg-inn" >/dev/null 2>&1 || true
        exit 0
      fi
      sleep 1
    done
  ) &
fi

exec "${PNPM[@]}" dev --port "$APP_PORT" --hostname 127.0.0.1
