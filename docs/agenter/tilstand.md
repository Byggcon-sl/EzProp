# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 28.10.2026 kl. 22:45 (PR #7 merget; PR #8 flettet med `main` og satt til versjon 0.2.1; læringsløkke for PR #7; kandidat 2 startet)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #1–#6 er merget 28.10.2026.

Gjeldende fase: **Fase 1 – Prøve uten nett.** Testskjemaet (oppgave 3, PR #6) og testmiljøet i Azure (PR #7) er merget 28.10.2026. Første kandidat (PowerSync) ligger som PR #8.

## Gjeldende oppgave

**Oppgave 5 – Kandidat 2: ElectricSQL** på samme testskjema, samme `TrialSyncStore`-kontrakt (`src/modules/offline-trial/sync/types.ts`) og samme protokoll for prøve A og B (egen fil `docs/funksjoner/fase1-prove-ab-electricsql.md`). Branch `fase1-kandidat-electricsql` **oppå `fase1-kandidat-powersync`** (trenger tabellene `trial_forms`, `trial_answers`, `trial_photos` og synkrutene fra oppgave 4). PR åpnes mot `fase1-kandidat-powersync` til PR #8 er merget. Merk fra oppgave 4: `getAnswers(formId)` i kontrakten brukes ikke av noen side og kan droppes før kandidat 2.

**Forrige oppgave:** Oppgave 4 – Første kandidat: PowerSync koblet til testskjemaet, **PR #8** (branch `fase1-kandidat-powersync`). Oppgavekort `docs/funksjoner/fase1-kandidat-powersync.md`, protokoll og resultatmal `docs/funksjoner/fase1-prove-ab-powersync.md` (med «det som ikke virket» (1)–(14)), drift `docs/drift/powersync.md`. 28.10.2026 kl. 22:45: `main` (med PR #7) er flettet inn i branchen, versjonen satt til 0.2.1 (0.1.3 i PR-en mot 0.2.0 på `main`). **Prøve A og B** kjøres av Ståle på ekte iPad når PowerSync kjører i Azure-testmiljøet (liten egen PR med Bicep for containeren, se under). Spørsmål nr. 10 til Ståle (PowerSync: selvdrevet eller sky, pris, lisens, databehandleravtale), ikke blokkerende.

**Små oppgaver som venter (fra oppgave 4):** (a) PowerSync-containeren i Azure-testmiljøet (Bicep i `infra/azure`, egen liten PR oppå #8). (b) Småfunnene (6), (8), (9), (10), (13) og (14) i resultatfilen i én liten rettelse. Begge tas etter kandidat 2, eller før hvis Ståle vil kjøre prøve A og B først.

**Rekkefølge videre i fase 1:** kandidat 2 (ElectricSQL) og kandidat 3 (egenbygd) på samme skjema og samme protokoll → Ståle kjører prøve A og B per kandidat på ekte iPad når synktjenesten er oppe i Azure → prøve C–F → sammenligning og ADR. Punktet «Kandidater satt opp …» krysses av først når alle tre er satt opp.

Hovedmål for fase 1: tid og KI først (grunnlaget for befaring på iPad, der KI-forslag senere vises og godkjennes). Oppgave 4 og 5 støtter også reklamasjoner (ingenting går tapt mellom befaring og rapport).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| #8 | Første kandidat: PowerSync koblet til testskjemaet (fase 1). Versjon 0.2.1. https://github.com/Byggcon-sl/EzProp/pull/8 | Venter på Ståle («Squash and merge»; prøve A og B etterpå). `main` flettet inn 28.10.2026 kl. 22:45 | main |
| (kommer) | Læringsløkke for PR #7 og tilstand (bare dokumentasjon) | Åpnes i denne kjøringen | main |
| (kommer) | Kandidat 2: ElectricSQL (fase 1) | Under arbeid i denne kjøringen | #8 (`fase1-kandidat-powersync`) |

Ingen grense for hvor mange PR-er som kan vente på Ståle (Ståle 28.10.2026). Bygger en oppgave på en PR som ikke er merget, står det under «Bygger på».

## Venter på Ståle

- **PR #8:** les PR-teksten og merge med **«Squash and merge»** (behold bare tittelen i meldingen). Når PowerSync kjører i Azure (egen liten PR kommer): kjør prøve A og B etter `docs/funksjoner/fase1-prove-ab-powersync.md` og fyll inn tallene.
- **Testmiljøet (PR #7 er merget):** følg `docs/drift/testmiljo-azure.md`: lag ressursgruppen `rg-ezprop-test` og GitHub-innloggingen i Azure, legg inn secrets og variabler, svar på spørsmål nr. 6 og nr. 9. Første utrulling skjer av seg selv ved neste merge til `main` når nøklene er på plass. Bekreft «ferdig når»: appen åpner på ekte iPad Pro fra hjemskjermen. Ikke legg inn de fire e-post-secretene før Graph-adapteren er bygget (fase 0b).
- Spørsmålene i `docs/09-apne-sporsmal.md`: nr. 6 (adresse og e-post for testmiljøet), nr. 8 (GPS-posisjon i bildene, før prøve D), nr. 9 (tilgang til ressursgruppen) og nr. 10 (PowerSync som leverandør, før ADR-en).

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

28.10.2026 kl. 22:30–: hovedløkken fant PR #7 merget (kl. 20:19) og PR #8 i konflikt med `main`. Flettet `main` inn i `fase1-kandidat-powersync` (versjon 0.2.1, dokumentkonflikter løst), kjørte læringsløkken for PR #7, oppdaterte tilstanden, og startet oppgave 5 (kandidat 2: ElectricSQL) oppå #8. Sesjon: https://claude.ai/code/session_01JqwntyQSN4Un9KLnoTE43Q

28.10.2026: hovedløkken kjørte oppgave 4 (første kandidat, PowerSync) fra oppgavekort til PR #8: branch, oppgavekort, protokoll for prøve A og B, spørsmål nr. 10, ordliste, runde 1, arkitekt, testplan, avhengigheter, fire biter til utvikler og testskriver, sikkerhetsgjennomgang, godkjenning fra test-leder, PR. Sesjon: https://claude.ai/code/session_01JqwntzCcVvuiXSedMUVdYg

28.10.2026 kl. 17:34–18:49: PR #6 merget av Ståle (kl. 17:34), deretter oppgaven «Testmiljø i Azure» fra oppgavekort til PR #7 (åpnet kl. 18:49, merget av Ståle kl. 20:19). Sesjon: https://claude.ai/code/session_01JqwntzCcVvuiXSedMUVdYg

28.10.2026 kl. 14:45–16:00: hovedløkken kjørte oppgave 3 fra oppgavekort til PR #6 (arbeidsflyten «oppgave»: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver). Fase 0a krysset av i planen. Læringsløkken kjørt for PR #4 og #5 (`erfaringer.md`). Sesjon: https://claude.ai/code/session_01JqwntzbzRrrZa27xqnubtP

28.10.2026 kl. 13:44: hovedløkken startet, men stoppet uten GitHub-tilgang. Ingen endringer gjort.

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
