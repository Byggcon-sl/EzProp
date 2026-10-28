# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 28.10.2026 (PR #7 merget; PR #8 flettet med main, versjon 0.2.1)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #1–#7 er merget 28.10.2026.

Gjeldende fase: **Fase 1 – Prøve uten nett.** Testskjemaet (oppgave 3, PR #6) og testmiljøet i Azure (PR #7) er merget.

## Gjeldende oppgave

**Oppgave 4 – Første kandidat: PowerSync koblet til testskjemaet** er **ferdig bygget og ligger som PR** (branch `fase1-kandidat-powersync` fra `main` etter PR #6, versjon 0.1.3). Oppgavekort `docs/funksjoner/fase1-kandidat-powersync.md` (akseptkriteriene krysset av, unntatt «ingen modellnavn i commit-meldingene», som verktøyet bryter; løses med «Squash and merge»). Protokoll og resultatmal for prøve A og B: `docs/funksjoner/fase1-prove-ab-powersync.md`, med det tekniske avsnittet fylt inn og «det som ikke virket» (1)–(12). Drift: `docs/drift/powersync.md` (Docker på Macen via `start.sh`, Container Apps i Azure beskrevet, ingenting rullet ut). Roller som var med: forenkler, arkitekt, sikkerhet-personvern, test-leder, utvikler, testskriver. Sjekkene (format, lint, typesjekk, test, e2e på pc og ipad) er grønne. Ingen alvorlige funn står igjen; småfunnene står i resultatfilen og i PR-en. **Prøve A og B** kjøres av Ståle på ekte iPad når PR #7 er merget og PowerSync kjører i Azure (en liten egen PR med Bicep for containeren kommer etter #7). Nytt spørsmål nr. 10 til Ståle (PowerSync: selvdrevet eller sky, pris, lisens, databehandleravtale), ikke blokkerende.

**Neste oppgave:** kandidat 2, ElectricSQL, på samme testskjema, samme `TrialSyncStore`-kontrakt og samme protokoll (egen fil `fase1-prove-ab-electricsql.md`). Branch fra `main`; der den trenger tabellene fra oppgave 4, bygger den på `fase1-kandidat-powersync` til den er merget. Merk fra oppgave 4: `getAnswers(formId)` i kontrakten brukes ikke av noen side og kan droppes i kontrakten før kandidat 2.

**Rekkefølge videre i fase 1:** kandidat 2 (ElectricSQL) og kandidat 3 (egenbygd) på samme skjema og samme protokoll → Ståle kjører prøve A og B per kandidat på ekte iPad når PR #7 og PowerSync i Azure er oppe → prøve C–F → sammenligning og ADR. Punktet «Kandidater satt opp …» krysses av først når alle tre er satt opp.

Hovedmål for fase 1: tid og KI først (grunnlaget for befaring på iPad, der KI-forslag senere vises og godkjennes). Oppgave 4 støtter også reklamasjoner (ingenting går tapt mellom befaring og rapport).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| #8 | Første kandidat: PowerSync koblet til testskjemaet (fase 1). Versjon 0.2.1 (main flettet inn 28.10.2026) | Venter på Ståle («Squash and merge»; prøve A og B etterpå) | main (PR #7 er merget) |

Ingen grense for antall PR-er som venter (Ståle 28.10.2026).

## Venter på Ståle

- **PR #8:** les PR-teksten og merge med **«Squash and merge»** (behold bare tittelen i meldingen). Når #7 og PowerSync i Azure er oppe: kjør prøve A og B etter `docs/funksjoner/fase1-prove-ab-powersync.md` og fyll inn tallene.
- **Testmiljøet (PR #7 er merget):** følg `docs/drift/testmiljo-azure.md`: lag ressursgruppen og GitHub-innloggingen i Azure, legg inn secrets og variabler, og svar på spørsmål nr. 6 og nr. 9. Deretter PowerSync-containeren (egen liten PR).
- Spørsmålene i `docs/09-apne-sporsmal.md`: nr. 6 (adresse og e-post for testmiljøet), nr. 8 (GPS-posisjon i bildene, før prøve D), nr. 9 (tilgang til ressursgruppen, i PR #7) og nr. 10 (PowerSync som leverandør, før ADR-en).

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

28.10.2026: hovedløkken kjørte oppgave 4 (første kandidat, PowerSync) fra oppgavekort til PR #8: branch, oppgavekort, protokoll for prøve A og B, spørsmål nr. 10, ordliste, runde 1, arkitekt, testplan, avhengigheter, fire biter til utvikler og testskriver, sikkerhetsgjennomgang, godkjenning fra test-leder, PR. Sesjon: https://claude.ai/code/session_01JqwntzCcVvuiXSedMUVdYg

28.10.2026 kl. 17:34–18:49: PR #6 merget av Ståle (kl. 17:34), deretter oppgaven «Testmiljø i Azure» fra oppgavekort til PR #7 (åpnet kl. 18:49).

28.10.2026 kl. 14:45–16:00: hovedløkken kjørte oppgave 3 fra oppgavekort til PR #6 (arbeidsflyten «oppgave»: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver). Fase 0a krysset av i planen. Læringsløkken kjørt for PR #4 og #5 (`erfaringer.md`). Sesjon: https://claude.ai/code/session_01JqwntzbzRrrZa27xqnubtP

28.10.2026 kl. 13:44: hovedløkken startet, men stoppet uten GitHub-tilgang. Ingen endringer gjort.

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
