# 10 – Utviklingsmiljø

Sist oppdatert: 28.10.2026

## Hvor utviklingen skjer

Utviklingen skjer i skyen (Claude Code), av agentlaget beskrevet i `docs/11-agentlaget.md`. Hver oppgave jobber på egen branch i `Byggcon-sl/EzProp` og leveres som pull request. Ståle godkjenner og merger. Ingenting må installeres på Macen for dette.

## Skymiljøet

Skymiljøet har Node.js 22, pnpm og PostgreSQL 16. `scripts/session-start.sh` kjøres ved start av hver økt (via `.claude/settings.json`): starter PostgreSQL, lager databasene `ezprop` og `ezprop_test`, lager `.env` fra `.env.example`, installerer pakker, migrerer, seeder og legger inn de fire testoppdragene (`pnpm db:seed:testoppdrag`). `scripts/cloud-setup.sh` kan i tillegg legges inn som setup script i miljøet (valgfritt, raskere oppstart).

Etter dette virker `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` (med `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`).

## Evalueringssettet for KI

```bash
pnpm ai:eval [funksjon]  # kjør evalueringssettet mot den falske KI-leverandøren
```

Kjører eksemplene i `src/core/ai/evals/<funksjon>.cases.json` (uten argument: alle filene) gjennom samme ledetekst og vask som ekte bruk, og viser antall eksempler, treff, treffprosent, grense og `mustPass` per funksjon, med id og grunn for hvert bom. Trenger verken database eller innlogging, og sender ingenting ut av maskinen. Avslutningskode 1 ved ugyldig fil, duplisert id, ukjent funksjon, krasj eller persondata i teksten til leverandøren, ikke ved lav treffprosent (A183). Ekte leverandør kobles til med Anthropic-adapteren (ADR 0006 del 9).

## Lokal kopi på Mac (valgfritt)

Hent repoet med GitHub Desktop. Dobbeltklikk `Start EzProp.command`, eller kjør `./start.sh`. Skriptet sjekker Node og pnpm, henter siste versjon, starter databasen i Docker, lager `.env`, installerer pakker, migrerer, seeder og åpner nettleseren. `./start.sh --nullstill` gir en tom database.

Logg inn som `admin@byggcon.no`. Koden står på http://127.0.0.1:3001/dev/epost.

**Side om side med Optiplan (04.11.2026):** På Macen kjører EzProp på http://127.0.0.1:3001 med databasen på port 5433, så Optiplan (localhost:3000, database 5432) kan kjøre samtidig. Adressen 127.0.0.1 i stedet for localhost gjør at innloggingen i de to løsningene ikke blander seg. `start.sh` retter også en eldre `.env`. I skyen og i CI brukes fortsatt localhost:3000 og 5432.

## E-post og hemmeligheter

- Lokalt og i skyen vises e-post på `/dev/epost` (`DEV_MAILBOX=1`). Ingen e-post sendes på ekte.
- E-post via Microsoft 365 (samme oppsett som Optiplan) kobles til i fase 0b. Da trengs `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` og `MAIL_FROM` i serverens miljøinnstillinger. Aldri i chat, kode eller git.
- I drift (testmiljøet i Azure) finnes ikke `/dev/epost`. Før Microsoft 365 er koblet til, skrives engangskoden for første admin i serverloggen. Når alle fire variablene over er satt, brukes Microsoft 365 i stedet.
- Ingen hemmeligheter trengs lokalt i fase 0a. I testmiljøet ligger de i GitHub som secrets.

## Testmiljø i Azure

Testmiljøet kjører på Azure App Service og PostgreSQL Flexible Server i Sweden Central (EU). Arbeidsflyten «Utrulling til Azure» ruller ut ved merge til `main`, men hopper over til secrets er lagt inn. Bare oppdiktede data. Hva Ståle må gjøre selv, steg for steg, med kostnad: `docs/drift/testmiljo-azure.md`.

## Helsesjekk

`GET /api/helse` svarer `{"status":"ok","versjon":"…","database":"ok"}`. Versjonen kommer fra `package.json` (økes i hver PR), pluss commit når `APP_VERSION` er satt. I testmiljøet setter utrullingen `APP_VERSION` til kort commit-id.
