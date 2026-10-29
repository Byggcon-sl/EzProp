#!/usr/bin/env bash
# Sjekker secrets for synktjenestene (PowerSync og Electric) før Bicep valideres.
# Brukes av .github/workflows/deploy-azure.yml. Se docs/drift/testmiljo-azure.md.
#
# Bryteren ENABLE_SYNC_TRIAL er på bare når verdien er nøyaktig «true».
# Av: ingen secrets trengs, exit 0.
# På: alle fire secrets må finnes, POWERSYNC_JWT_SECRET og ELECTRIC_SECRET må ha
# minst 32 tegn, og DB-passordene må være bare bokstaver og tall og minst 24 tegn
# (de brukes i databaseadresser). Ellers exit 1.
#
# Skriptet skriver bare navn, aldri verdier. Virker med bash 3.2.

set -eu

# Fast tegnsett, så a-z og A-Z bare betyr de engelske bokstavene.
LC_ALL=C
export LC_ALL

if [ "${ENABLE_SYNC_TRIAL:-}" != "true" ]; then
  echo "Synktjenestene er av (ENABLE_SYNC_TRIAL er ikke true). Ingen secrets for synk trengs."
  exit 0
fi

FEIL=0

for NAVN in POWERSYNC_JWT_SECRET POWERSYNC_DB_PASSWORD ELECTRIC_SECRET ELECTRIC_DB_PASSWORD; do
  # Indirekte oppslag som virker i bash 3.2. Verdien skrives aldri ut.
  eval "VERDI=\${$NAVN:-}"
  if [ -z "$VERDI" ]; then
    echo "Secreten $NAVN mangler i GitHub (Settings → Secrets). Den trengs når ENABLE_SYNC_TRIAL er true." >&2
    FEIL=1
  fi
done

# De delte nøklene må ha minst 32 tegn. Alle tegn er lov. Tomme er meldt over.
for NAVN in POWERSYNC_JWT_SECRET ELECTRIC_SECRET; do
  eval "VERDI=\${$NAVN:-}"
  if [ -z "$VERDI" ]; then
    continue
  fi
  if [ "${#VERDI}" -lt 32 ]; then
    echo "Secreten $NAVN er for kort. Den må ha minst 32 tegn." >&2
    FEIL=1
  fi
done

for NAVN in POWERSYNC_DB_PASSWORD ELECTRIC_DB_PASSWORD; do
  eval "VERDI=\${$NAVN:-}"
  if [ -z "$VERDI" ]; then
    continue
  fi
  case "$VERDI" in
    *[!A-Za-z0-9]*)
      echo "Secreten $NAVN kan bare ha bokstaver (a-z, A-Z) og tall (0-9)." >&2
      FEIL=1
      continue
      ;;
  esac
  if [ "${#VERDI}" -lt 24 ]; then
    echo "Secreten $NAVN er for kort. Den må ha minst 24 tegn." >&2
    FEIL=1
  fi
done

VERDI=""

if [ "$FEIL" != 0 ]; then
  echo "Utrullingen stopper. Se docs/drift/testmiljo-azure.md, avsnittet om å slå på synktjenestene." >&2
  exit 1
fi

echo "Secrets for synktjenestene er på plass."
