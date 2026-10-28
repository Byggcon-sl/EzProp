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
TOTALT=9

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
  if ! docker compose up -d db >/tmp/ezprop-docker.log 2>&1; then
    if grep -qi "port is already allocated\|address already in use" /tmp/ezprop-docker.log; then
      stopp "Port 5432 er opptatt av en annen database på Macen." \
        "Stopp den andre databasen (f.eks. Postgres.app), eller spør Claude om hjelp."
    fi
    stopp "Klarte ikke å starte databasen." "$(tail -5 /tmp/ezprop-docker.log)"
  fi
  for _ in $(seq 1 30); do
    docker compose exec -T db pg_isready -U ezprop >/dev/null 2>&1 && break
    sleep 1
  done
  docker compose exec -T db pg_isready -U ezprop >/dev/null 2>&1 || stopp "Databasen svarer ikke." "Prøv ./start.sh --nullstill"
  # Synktjenesten lagrer sin tilstand i en egen database. Eldre Docker-databaser mangler den.
  if ! docker compose exec -T db psql -U ezprop -d postgres -tAc \
    "select 1 from pg_database where datname = 'powersync_storage'" 2>/dev/null | grep -q 1; then
    docker compose exec -T db createdb -U ezprop powersync_storage >/dev/null 2>&1 ||
      stopp "Klarte ikke å lage databasen for synktjenesten." "Prøv ./start.sh --nullstill"
    ok "Laget databasen for synktjenesten"
  fi
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
# Nye innstillinger legges til tomme i en eldre .env, så det er lett å se hva som finnes.
# Tomme verdier betyr «ikke i bruk»: lokalt vises e-post på /dev/epost.
LAGT_TIL=""
for navn in MS_GRAPH_TENANT_ID MS_GRAPH_CLIENT_ID MS_GRAPH_CLIENT_SECRET MAIL_FROM; do
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
# Synktjenesten (prøve fase 1) trenger verdier; tomme verdier stopper innloggingen mot den.
# Utviklingsverdiene er de samme som i .env.example og virker bare på Macen (localhost).
LAGT_TIL=""
for par in \
  "POWERSYNC_URL=http://localhost:8080" \
  "POWERSYNC_JWT_SECRET=utvikling-ikke-hemmelig-synknokkel-bare-for-mac-0123456789" \
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
  ok "La til innstillinger for synktjenesten i .env:$LAGT_TIL"
fi

# ---------------------------------------------------------------------------
steg "Installerer pakker"
"${PNPM[@]}" install --frozen-lockfile --reporter=silent || stopp "Installasjonen feilet." "Se feilmeldingen over."
ok "Pakkene er på plass"

# ---------------------------------------------------------------------------
steg "Oppdaterer databasen"
"${PNPM[@]}" --silent db:migrate || stopp "Oppdatering av databasen feilet." "Se feilmeldingen over."
"${PNPM[@]}" --silent db:seed || stopp "Innlegging av grunndata feilet." "Se feilmeldingen over."
ok "Databasen er oppdatert, med organisasjonen Byggcon og admin"

# ---------------------------------------------------------------------------
steg "Starter synktjenesten (PowerSync)"
if [ "${EZPROP_SKIP_DOCKER:-0}" = "1" ]; then
  advarsel "Hopper over synktjenesten (EZPROP_SKIP_DOCKER=1)."
else
  # Synktjenesten vil ha nøkkelen fra .env kodet som base64url
  HEMMELIGHET=$(grep '^POWERSYNC_JWT_SECRET=' .env | head -1 | cut -d= -f2-)
  PS_JWT_SECRET_BASE64=$(node -e 'process.stdout.write(Buffer.from(process.argv[1], "utf8").toString("base64url"))' "$HEMMELIGHET")
  export PS_JWT_SECRET_BASE64
  if ! docker compose up -d --force-recreate powersync >/tmp/ezprop-powersync.log 2>&1; then
    if grep -qi "port is already allocated\|address already in use" /tmp/ezprop-powersync.log; then
      stopp "Port 8080 er opptatt av et annet program på Macen." \
        "Lukk programmet som bruker port 8080, eller spør Claude om hjelp."
    fi
    stopp "Klarte ikke å starte synktjenesten." "$(tail -5 /tmp/ezprop-powersync.log)"
  fi
  PS_KLAR=0
  for _ in $(seq 1 60); do
    if curl -s -f -o /dev/null http://localhost:8080/probes/liveness; then
      PS_KLAR=1
      break
    fi
    sleep 1
  done
  if [ "$PS_KLAR" = "1" ]; then
    ok "Synktjenesten svarer på http://localhost:8080"
  else
    advarsel "Synktjenesten svarer ikke ennå. Appen virker, men synk til serveren venter."
    advarsel "Se hva som skjer med: docker compose logs powersync"
  fi
fi

# ---------------------------------------------------------------------------
steg "Starter EzProp"
# Kjører EzProp fra før (f.eks. et Terminal-vindu som ikke ble lukket), stoppes den gamle,
# så den nye versjonen og databaseendringene over blir tatt i bruk.
GAMMEL=$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$GAMMEL" ]; then
  if ps -p "$GAMMEL" -o command= 2>/dev/null | grep -qi "next\|node"; then
    advarsel "EzProp kjørte allerede (prosess $GAMMEL) – stopper den og starter på nytt."
    kill "$GAMMEL" 2>/dev/null || true
    for _ in $(seq 1 10); do
      lsof -ti tcp:3000 -sTCP:LISTEN >/dev/null 2>&1 || break
      sleep 1
    done
    if lsof -ti tcp:3000 -sTCP:LISTEN >/dev/null 2>&1; then
      kill -9 "$GAMMEL" 2>/dev/null || true
      sleep 1
    fi
    # Next.js lar en låsfil ligge igjen når den stoppes brått
    rm -f .next/dev/lock 2>/dev/null || true
  else
    stopp "Port 3000 er opptatt av et annet program." \
      "Lukk programmet som bruker port 3000, eller spør Claude om hjelp." \
      "(Det er prosess $GAMMEL: $(ps -p "$GAMMEL" -o command= 2>/dev/null))"
  fi
fi

cat <<EOF

      Åpner ${FET}http://localhost:3000${NORMAL} i nettleseren når den er klar.

      Logg inn som:   ${FET}admin@byggcon.no${NORMAL}   (admin)
      Koden finner du: ${FET}http://localhost:3000/dev/epost${NORMAL}
      PowerSync:       ${FET}http://localhost:8080${NORMAL}   (synktjenesten, prøve uten nett)

      Stopp med ${FET}Ctrl + C${NORMAL}.

EOF

if [ "${EZPROP_NO_BROWSER:-0}" != "1" ]; then
  (
    for _ in $(seq 1 90); do
      if curl -s -o /dev/null http://localhost:3000/logg-inn; then
        open "http://localhost:3000/dev/epost" >/dev/null 2>&1 || true
        open "http://localhost:3000/logg-inn" >/dev/null 2>&1 || true
        exit 0
      fi
      sleep 1
    done
  ) &
fi

exec "${PNPM[@]}" dev
