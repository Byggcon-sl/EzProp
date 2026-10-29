# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 29.10.2026 kl. 12:30 (PR #9 merget; PR #10 flettet med `main`; oppgave 6 ferdig som PR #11)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #1–#6 er merget 28.10.2026.

Gjeldende fase: **Fase 1 – Prøve uten nett.** Testskjemaet (PR #6), testmiljøet i Azure (PR #7) og kandidat 1 PowerSync (PR #8, merget 29.10.2026 kl. 08:30) er merget. Kandidat 2 ElectricSQL ligger som PR #10.

## Gjeldende oppgave

**Neste: liten oppgave (a) – PowerSync- og Electric-containerne i Azure-testmiljøet** (Bicep i `infra/azure`, egen liten PR oppå PR #11), så Ståle kan kjøre prøve A og B på ekte iPad. Deretter (b) småfunnene i PowerSync-resultatfilen.

**Forrige oppgave:** Oppgave 6 – Kandidat 3, egenbygd (lokal database og endringskø), **PR #11** (branch `fase1-kandidat-egenbygd`, versjon 0.2.3, oppå PR #10). Oppgavekort `docs/funksjoner/fase1-kandidat-egenbygd.md` (med «Avgjørelser etter gjennomgangen»), testplan `docs/funksjoner/fase1-kandidat-egenbygd-testplan.md`, resultatmal `docs/funksjoner/fase1-prove-ab-egenbygd.md`. Ingen ny avhengighet, ingen migrering, ingen ny tjeneste. Sikkerhet-personvern: godkjent (ett lite funn rettet). Forenkler: doble testfiler slått sammen. Test-leder: avviste først for små funn (alle rettet), e2e-feil i to tester rettet av feilrettingslederen (feil i testene, ikke i koden). Punktet «Kandidater satt opp …» er krysset av.

**Før det:** Oppgave 5 – Kandidat 2: ElectricSQL, **PR #10** (branch `fase1-kandidat-electricsql`, versjon 0.2.2). Oppgavekort `docs/funksjoner/fase1-kandidat-electricsql.md`, testplan `docs/funksjoner/fase1-kandidat-electricsql-testplan.md`, resultatmal `docs/funksjoner/fase1-prove-ab-electricsql.md`, drift `docs/drift/electricsql.md`. Sikkerhet-personvern: godkjent, tre små funn; (2) og (3) rettet, (1) (Electrics 400-kropp videresendes uendret) tas i ADR-en. Test-leder: godkjent (lint, typesjekk, format, 333 Vitest, e2e 105 bestått). Spørsmål nr. 11 (ElectricSQL som leverandør), ikke blokkerende.

**Små oppgaver som venter:** (a) se «Neste». (b) Småfunnene (6), (8), (9), (10), (13) og (14) i PowerSync-resultatfilen i én liten rettelse.

**Rekkefølge videre i fase 1:** alle tre kandidatene er satt opp → synktjenestene i Azure (a) → Ståle kjører prøve A og B per kandidat på ekte iPad → prøve C–F → sammenligning og ADR.

Hovedmål for fase 1: tid og KI først (grunnlaget for befaring på iPad, der KI-forslag senere vises og godkjennes), og reklamasjoner (ingenting går tapt mellom befaring og rapport).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| #10 | Kandidat 2: ElectricSQL (fase 1), versjon 0.2.2, med læringsløkke for PR #8 og #9 | Venter på Ståle | main |
| #11 | Kandidat 3: egenbygd synk (fase 1), versjon 0.2.3 | Venter på Ståle | #10 (`fase1-kandidat-electricsql`) |

Ingen grense for hvor mange PR-er som kan vente på Ståle (Ståle 28.10.2026). Bygger en oppgave på en PR som ikke er merget, står det under «Bygger på».

## Venter på Ståle

- **PR #10, deretter PR #11:** les PR-tekstene og merge (#10 først; #11 bygger på den). Når PowerSync og ElectricSQL kjører i Azure (egen liten PR kommer): kjør prøve A og B etter `docs/funksjoner/fase1-prove-ab-powersync.md` og `docs/funksjoner/fase1-prove-ab-electricsql.md`.
- **Testmiljøet (PR #7 er merget):** følg `docs/drift/testmiljo-azure.md`: lag ressursgruppen `rg-ezprop-test` og GitHub-innloggingen i Azure, legg inn secrets og variabler, svar på spørsmål nr. 6 og nr. 9. Bekreft «ferdig når»: appen åpner på ekte iPad Pro fra hjemskjermen. Ikke legg inn de fire e-post-secretene før Graph-adapteren er bygget (fase 0b).
- Spørsmålene i `docs/09-apne-sporsmal.md`: nr. 6, nr. 8 (GPS i bildene, før prøve D), nr. 9, nr. 10 (PowerSync som leverandør) og nr. 11 (ElectricSQL som leverandør), de to siste før ADR-en.

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

29.10.2026 kl. 10:45: hovedløkken fant PR #9 merget (kl. 11:27 norsk tid). Flettet `main` inn i `fase1-kandidat-electricsql` (én konflikt i `erfaringer.md`, begge avsnitt beholdt), kjørte læringsløkken for PR #9, fullførte oppgave 6: rettet tre feilende Vitest-tester (hodekommentar, henting «med en gang» uten tidtaker), gjennomgang hos sikkerhet-personvern, forenkler og test-leder, slo sammen doble testfiler, rettet to e2e-tester, kjørte alle sjekker (grønne) og åpnet PR #11 mot `fase1-kandidat-electricsql`. Sesjon: https://claude.ai/code/session_01Jqwntz9WUQ9tyG2mcL52jZ

29.10.2026 kl. 10:00–10:15: prosjektleder laget branchen `fase1-kandidat-egenbygd` oppå `fase1-kandidat-electricsql`, oppgavekortet for oppgave 6 (kandidat 3, egenbygd), resultatmalen for prøve A og B og to ordlisterader. Roller: arkitekt, sikkerhet-personvern, test-leder, utvikler, testskriver. Sesjon: https://claude.ai/code/session_01Jqwnu1u7LijJH79yxkGBBS

29.10.2026 kl. 10:40: prosjektleder oppdaterte oppgavekortet etter runde 1 (arkitekt og test-leder ba om endring). Avgjort: arkitektens forarbeid tas inn som det står; myk sletting dekkes av `applyIncoming` pluss én ny test for hente-leseren; markøren tømmes ved organisasjonsbytte. Ordlisten: ny rad «lokal kjerne». Ingen nye spørsmål til Ståle.

29.10.2026 kl. 09:30–10:00: hovedløkken fant PR #8 merget (kl. 08:30). Flettet `main` inn i `fase1-kandidat-electricsql` (ingen konflikter), kjørte læringsløkken for PR #8, sikkerhet-personvern og test-leder (begge godkjent, to små funn rettet), lint, typesjekk, format, Vitest og e2e (grønne), og åpnet PR #10 mot `main`. Lederrollene måtte startes med modellen satt i kallet fordi kvoten for den faste modellen var brukt opp (PR #9). Sesjon: https://claude.ai/code/session_01Jqwnu1u7LijJH79yxkGBBS

29.10.2026 kl. 00:30–00:45: prosjektleder flettet de tre bitene for oppgave 5 (utvikler bit 1 og 2, testskriver) sammen på `fase1-kandidat-electricsql` (worktrees 14–17), løste konflikter i testfilene til versjonen som er avstemt mot koden, kjørte lint, typesjekk og tester (grønne) og fjernet worktrees. Sesjon: https://claude.ai/code/session_01JqwntyQSN4Un9KLnoTE43Q

29.10.2026 kl. 00:15–00:30: prosjektleder leste forarbeid og testplan for oppgave 5, avgjorde ni punkter der testplan og signaturer sa ulikt (kortet, «Avgjørelser før bygging»), og delte byggingen i tre biter (utvikler bit 1 og 2, testskriver). Sesjon: https://claude.ai/code/session_01JqwntyQSN4Un9KLnoTE43Q

28.10.2026 kl. 23:30–23:45: prosjektleder avgjorde runde 1 for oppgave 5 (forenkler, arkitekt, sikkerhet-personvern, test-leder) og skrev avgjørelsene A–G inn i oppgavekortet; ordlisten fikk `shape_state`. Sesjon: https://claude.ai/code/session_01JqwntyQSN4Un9KLnoTE43Q

28.10.2026 kl. 23:00–23:15: prosjektleder laget oppgavekortet for oppgave 5 (kandidat 2, ElectricSQL), resultatmalen for prøve A og B, spørsmål nr. 11 og ordlisterader, på branchen `fase1-kandidat-electricsql`. Sesjon: https://claude.ai/code/session_01JqwntyQSN4Un9KLnoTE43Q

28.10.2026 kl. 22:30–: hovedløkken fant PR #7 merget (kl. 20:19) og PR #8 i konflikt med `main`. Flettet `main` inn i `fase1-kandidat-powersync` (versjon 0.2.1, dokumentkonflikter løst), kjørte læringsløkken for PR #7, oppdaterte tilstanden, og startet oppgave 5 (kandidat 2: ElectricSQL) oppå #8. Sesjon: https://claude.ai/code/session_01JqwntyQSN4Un9KLnoTE43Q

28.10.2026: hovedløkken kjørte oppgave 4 (første kandidat, PowerSync) fra oppgavekort til PR #8: branch, oppgavekort, protokoll for prøve A og B, spørsmål nr. 10, ordliste, runde 1, arkitekt, testplan, avhengigheter, fire biter til utvikler og testskriver, sikkerhetsgjennomgang, godkjenning fra test-leder, PR. Sesjon: https://claude.ai/code/session_01JqwntzCcVvuiXSedMUVdYg

28.10.2026 kl. 17:34–18:49: PR #6 merget av Ståle (kl. 17:34), deretter oppgaven «Testmiljø i Azure» fra oppgavekort til PR #7 (åpnet kl. 18:49, merget av Ståle kl. 20:19). Sesjon: https://claude.ai/code/session_01JqwntzCcVvuiXSedMUVdYg

28.10.2026 kl. 14:45–16:00: hovedløkken kjørte oppgave 3 fra oppgavekort til PR #6 (arbeidsflyten «oppgave»: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver). Fase 0a krysset av i planen. Læringsløkken kjørt for PR #4 og #5 (`erfaringer.md`). Sesjon: https://claude.ai/code/session_01JqwntzbzRrrZa27xqnubtP

28.10.2026 kl. 13:44: hovedløkken startet, men stoppet uten GitHub-tilgang. Ingen endringer gjort.

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
