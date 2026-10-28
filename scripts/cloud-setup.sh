#!/usr/bin/env bash
# Setup script for skymiljøet (Project settings → Environment).
# Starter PostgreSQL, lager databaser og installerer avhengigheter. Trygt å kjøre flere ganger.
set -euo pipefail

# PostgreSQL er forhåndsinstallert i skymiljøet
service postgresql start
until pg_isready -q; do sleep 1; done

su postgres -c "psql -tc \"select 1 from pg_roles where rolname='ezprop'\"" | grep -q 1 ||
  su postgres -c "psql -c \"create role ezprop login password 'ezprop' createdb\""
for db in ezprop ezprop_test; do
  su postgres -c "psql -tc \"select 1 from pg_database where datname='$db'\"" | grep -q 1 ||
    su postgres -c "createdb -O ezprop $db"
done

corepack enable
