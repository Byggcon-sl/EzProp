# 10 – Utviklingsmiljø

Sist oppdatert: 28.10.2026

## Hvor utviklingen skjer

Utviklingen skjer i skyen (Claude Code), av agentlaget beskrevet i `docs/11-agentlaget.md`. Hver oppgave jobber på egen branch i `Byggcon-sl/EzProp` og leveres som pull request. Ståle godkjenner og merger. Ingenting må installeres på Macen for dette.

## Skymiljøet

Skymiljøet har Node.js 22, pnpm og PostgreSQL 16. `scripts/session-start.sh` kjøres ved start av hver økt (via `.claude/settings.json`): starter PostgreSQL, lager databasene `ezprop` og `ezprop_test`, lager `.env` fra `.env.example`, installerer pakker, migrerer og seeder. `scripts/cloud-setup.sh` kan i tillegg legges inn som setup script i miljøet (valgfritt, raskere oppstart).

Etter dette virker `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` (med `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`).

## Lokal kopi på Mac (valgfritt)

Hent repoet med GitHub Desktop. Dobbeltklikk `Start EzProp.command`, eller kjør `./start.sh`. Skriptet sjekker Node og pnpm, henter siste versjon, starter databasen i Docker, lager `.env`, installerer pakker, migrerer, seeder og åpner nettleseren. `./start.sh --nullstill` gir en tom database.

Logg inn som `admin@byggcon.no`. Koden står på http://localhost:3000/dev/epost.

## E-post og hemmeligheter

- Lokalt og i skyen vises e-post på `/dev/epost` (`DEV_MAILBOX=1`). Ingen e-post sendes på ekte.
- E-post via Microsoft 365 (samme oppsett som Optiplan) kobles til i fase 0b. Da trengs `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` og `MAIL_FROM` i serverens miljøinnstillinger. Aldri i chat, kode eller git.
- Ingen hemmeligheter trengs i fase 0a.

## Helsesjekk

`GET /api/helse` svarer `{"status":"ok","versjon":"…","database":"ok"}`. Versjonen kommer fra `package.json` (økes i hver PR), pluss commit når `APP_VERSION` er satt.
