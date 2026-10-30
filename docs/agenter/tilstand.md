# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

**Autonom modus: på** (Ståle 29.10.2026). Ståle er hjemme tirsdag kveld 03.11.2026 og tilgjengelig fra onsdag morgen 04.11.2026. Da slås modusen av, og han får en samlet oversikt. Ståle er borte noen dager: ingen varsler, ingen spørsmål, ingen «Venter på Ståle». Agentene avgjør selv ut fra researchen og fører beslutningene i `docs/09-apne-sporsmal.md` («Avgjort av agentene mens Ståle var borte»). Se «Autonom modus» i `CLAUDE.md`.

**Slik går fase 1 videre uten Ståle:** Prøve A og B på ekte iPad, og synktjenestene i Azure (koster penger), venter til han er tilbake. Prøve C–F forberedes og kjøres så langt det går i nettleser og e2e. Deretter velger agentene synkløsning ut fra resultatene fra de automatiske prøvene og researchen, og skriver ADR-en (selvdrevet, ingen konto og ingen kostnad). Valget merkes «foreløpig, bekreftes etter prøve A og B på ekte iPad». Så går løkken videre til fase 0b og de neste fasene i planen.

Sist oppdatert: 30.10.2026 (liten oppgave (e), småfunn fra prøve E, PR åpnet)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #1–#6 er merget 28.10.2026.

Gjeldende fase: **Fase 1 – Prøve uten nett.** Testskjemaet (PR #6), testmiljøet i Azure (PR #7), kandidat 1 PowerSync (PR #8) og kandidat 2 ElectricSQL (PR #10) er merget til `main`. Kandidat 3 egenbygd er merget til `main` i PR #13 (PR #12: agentene merger selv).

## Gjeldende oppgave

**Levert: Prøve E – regler uten nett**, **PR #23** (merget 29.10.2026; branch `fase1-prove-e-regler` fra `main`, versjon 0.2.13). Oppgavekort `docs/funksjoner/fase1-prove-e-regler.md`, testplan `docs/funksjoner/fase1-prove-e-regler-testplan.md`, resultatmal for ekte iPad `docs/funksjoner/fase1-prove-e-regler-resultat.md`. To prøveregler som data (oppdiktede tall 7 år og 42 %), én regelmotor for nettleser og server, regelsvar under feltene, ruten `/api/prove/regler`, 14 testsaker. Roller: forenkler, fagansvarlig, sikkerhet-personvern, test-leder, utvikler, testskriver. Ingen alvorlige funn; små funn står i PR-en. Punktet er krysset av i planen. Spørsmål nr. 13 (ekte tall), ikke blokkerende. Støtter tid og reklamasjoner.

**Levert: Synkstatus som alltid vises**, **PR #21** (merget 29.10.2026 kl. 19:44; branch `fase1-synkstatus`, bygger på `main`, versjon 0.2.11). Oppgavekort `docs/funksjoner/fase1-synkstatus.md`, skisse `docs/funksjoner/fase1-synkstatus-skisse.md`, testplan `docs/funksjoner/fase1-synkstatus-testplan.md`. Måleindikatoren er erstattet av `sync-status.tsx` for alle tre kandidatene. Roller: forenkler, ux-ansvarlig, test-leder, ui-designer, sikkerhet-personvern, utvikler, testskriver. Ingen alvorlige funn; små funn står i PR-en. Punktet er krysset av i planen. Støtter reklamasjoner og tid.

**Levert: liten oppgave (d)**, småfunnene fra PR #21, **PR #26** (merget 29.10.2026; branch `fase1-smafunn-synkstatus` fra `main`, versjon 0.2.16). Oppgavekort `docs/agenter/oppgaver/fase1-smafunn-synkstatus.md`. Test for «Synk nå», vakt mot andre databaser enn lokal/test i e2e, `ensureInspector` bruker ikke slettede ansatte, loggen viser bare feilmeldingen. Roller: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver. Ingen alvorlige funn. Punktet er krysset av i planen. Støtter reklamasjoner og tid.

**Levert: liten oppgave (e)**, småfunnene fra PR #23 (prøve E) og det som sto igjen fra PR #26 (30.10.2026; branch `fase1-smafunn-prove-e` fra `main`, versjon 0.2.18). Oppgavekort `docs/agenter/oppgaver/fase1-smafunn-prove-e.md`, testplan `docs/agenter/oppgaver/fase1-smafunn-prove-e-testplan.md`. Test for `localWriteGeneration`, testsakene ut av `rules/index.ts`, grensetallet ett sted, færre doble tester, loggen i `custom/reader.ts` og `electricsql/store.ts` viser bare feilmeldingen («ukjent feil» når feilen ikke er en Error). Roller: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver. Ingen alvorlige funn; små funn rettet av prosjektlederen før PR. Punktet er krysset av i planen. Støtter reklamasjoner og tid.

**Neste:** prøve A og B per kandidat (Ståle, når synktjenestene er slått på, spørsmål nr. 12). Til da: prøve C, D og F som kan forberedes uten Ståle.

**Forrige oppgave:** liten oppgave (a) – synktjenestene i Azure-testmiljøet, **PR #17** (merget 29.10.2026 kl. 16:58, versjon 0.2.7). PowerSync- og Electric-containerne i Bicep, **av som standard** (`enableSyncTrial = false`, GitHub-variabelen `ENABLE_SYNC_TRIAL`), så mergen lager ingen nye ressurser. ADR 0003, oppgavekort `docs/funksjoner/fase1-synk-i-azure.md`. Kostnad når de er på: ca. 700–850 kr per måned. Spørsmål nr. 12.

**Før det:** Oppgave 6 – Kandidat 3, egenbygd (lokal database og endringskø), **PR #11** (branch `fase1-kandidat-egenbygd`, versjon 0.2.3, oppå PR #10). Oppgavekort `docs/funksjoner/fase1-kandidat-egenbygd.md` (med «Avgjørelser etter gjennomgangen»), testplan `docs/funksjoner/fase1-kandidat-egenbygd-testplan.md`, resultatmal `docs/funksjoner/fase1-prove-ab-egenbygd.md`. Ingen ny avhengighet, ingen migrering, ingen ny tjeneste. Sikkerhet-personvern: godkjent (ett lite funn rettet). Forenkler: doble testfiler slått sammen. Test-leder: avviste først for små funn (alle rettet), e2e-feil i to tester rettet av feilrettingslederen (feil i testene, ikke i koden). Punktet «Kandidater satt opp …» er krysset av.

**Enda før:** Oppgave 5 – Kandidat 2: ElectricSQL, **PR #10** (branch `fase1-kandidat-electricsql`, versjon 0.2.2). Oppgavekort `docs/funksjoner/fase1-kandidat-electricsql.md`, testplan `docs/funksjoner/fase1-kandidat-electricsql-testplan.md`, resultatmal `docs/funksjoner/fase1-prove-ab-electricsql.md`, drift `docs/drift/electricsql.md`. Sikkerhet-personvern: godkjent, tre små funn; (2) og (3) rettet, (1) (Electrics 400-kropp videresendes uendret) tas i ADR-en. Test-leder: godkjent (lint, typesjekk, format, 333 Vitest, e2e 105 bestått). Spørsmål nr. 11 (ElectricSQL som leverandør), ikke blokkerende.

**Små oppgaver som venter:** ingen. (e) Småfunn fra prøve E er levert (se over). (d) Småfunnene fra PR #21 er levert i **PR #26**. (c) Småfunn fra synktjenestene i Azure er merget i **PR #19** (branch `fase1-smafunn-synk-azure` (versjon 0.2.9, oppgavekort `docs/agenter/oppgaver/fase1-smafunn-synk-azure.md`). (b) Småfunnene i PowerSync-resultatfilen er rettet i **PR #14** (merget 29.10.2026), sammen med tidsavbrudd på bildeopplasting (bildekøen kunne stå fast; rettingen kom ikke med i PR #13).

**Rekkefølge videre i fase 1:** alle tre kandidatene er satt opp → synktjenestene i Azure (a, merget) → Ståle slår dem på (spørsmål nr. 12) og kjører prøve A og B per kandidat på ekte iPad → prøve C–F → sammenligning og ADR.

Hovedmål for fase 1: tid og KI først (grunnlaget for befaring på iPad, der KI-forslag senere vises og godkjennes), og reklamasjoner (ingenting går tapt mellom befaring og rapport).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| #28 | Liten oppgave (e): småfunn fra prøve E | åpnet 30.10.2026, merges med skriptet når CI er grønn | `main` |

PR #16–#26 er merget 29.10.2026 (#23: prøve E, #25: autonom modus, #26: småfunn fra synkstatus). Ingen åpne PR-er.

Ingen grense for hvor mange PR-er som kan vente på Ståle (Ståle 28.10.2026). Bygger en oppgave på en PR som ikke er merget, står det under «Bygger på».

## Trenger Ståle når han er tilbake

I autonom modus samles alt her. Ingen varsler.


- Spørsmål nr. 12: slå på synktjenestene i testmiljøet (`docs/drift/testmiljo-azure.md`, «Slå på»). Når de kjører: kjør prøve A og B etter `docs/funksjoner/fase1-prove-ab-powersync.md`, `…-electricsql.md` og `…-egenbygd.md`.
- **Testmiljøet (PR #7 er merget):** følg `docs/drift/testmiljo-azure.md`: lag ressursgruppen `rg-ezprop-test` og GitHub-innloggingen i Azure, legg inn secrets og variabler, svar på spørsmål nr. 6 og nr. 9. Bekreft «ferdig når»: appen åpner på ekte iPad Pro fra hjemskjermen. Ikke legg inn de fire e-post-secretene før Graph-adapteren er bygget (fase 0b).
- Spørsmålene i `docs/09-apne-sporsmal.md`: nr. 6, nr. 8 (GPS i bildene, før prøve D), nr. 9, nr. 10 (PowerSync som leverandør) og nr. 11 (ElectricSQL som leverandør), de to siste før ADR-en, og nr. 12 (slå på synktjenestene i testmiljøet, kostnad).

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

30.10.2026 kl. 01:05–02:00: hovedløkken trodde kjøringen med liten oppgave (e) hadde stoppet (45 min uten push) og fullførte den selv (PR #29). Den andre kjøringen var i live og merget PR #28 kl. 01:25 med samme innhold. PR #29 er lukket uten tap. Lærdom og ny regel (3 timer) i `erfaringer.md`. Startet ingen ny oppgave, fordi den andre kjøringen kan holde på med neste. Sesjon: https://claude.ai/code/session_01Jqwnu1z3G1tg8SDiRvvu7V

29.10.2026: hovedløkken fant ingen åpne PR-er, kjørte liten oppgave (d) med arbeidsflyten «oppgave» (24 agenter, ca. 2 t 25 min) til PR #26, merget med skriptet (CI grønn, ingen alvorlige funn, to små funn står under «Neste»). Første merge-forsøk stoppet fordi den automatiske flettingen fra `main` ga en CI-kjøring som ventet på godkjenning; en ny commit startet CI. Sesjon: https://claude.ai/code/session_01JqwntzupjW6jbbFTYtkeBA

29.10.2026: prosjektleder fullførte liten oppgave (d), småfunnene fra PR #21: flettet `main` inn (versjon 0.2.16), fjernet to doble testfiler, strammet testene for `ensureInspector`, krysset av i planen og åpnet PR #26 mot `main`. Sesjon: https://claude.ai/code/session_01JqwntzupjW6jbbFTYtkeBA

29.10.2026 kl. 18:40–22:30: hovedløkken ventet på CI og merget PR #21 (synkstatus) med skriptet, og kjørte prøve E med arbeidsflyten «oppgave» til PR #23 (merget med skriptet, CI grønn, ingen alvorlige funn, 11 små funn i PR-en). Neste: liten oppgave med småfunnene fra PR #21 og #23 (se «Neste»), deretter prøve C, D (etter svar på nr. 8) og F. Sesjon: https://claude.ai/code/session_01Jqwnu3Rs4hsNXmsS1zrwe5

29.10.2026: prosjektleder laget branchen `fase1-prove-e-regler`, oppgavekortet for prøve E og spørsmål nr. 13. `parseTrialNumber` var allerede streng (oppgave 4); kortet ber bare om flere testsaker. Sesjon: https://claude.ai/code/session_01Jqwnu3Rs4hsNXmsS1zrwe5
29.10.2026: prosjektleder rettet oppgavekortet for prøve E etter forenkler, fagansvarlig og test-leder, og la til nr. 13 c (verdi lik grensen).
29.10.2026 kl. 15:55–19:50: hovedløkken merget PR #15 og #16 (læringsløkke for #14 og #15, beslutningen om PR-er som venter ført inn i `main`) og kjørte «Synkstatus som alltid vises» med arbeidsflyten «oppgave» (29 agenter, ca. 3 t 45 min) til PR #21, merget med skriptet (CI grønn, 11 små funn). En annen sesjon leverte synktjenestene i Azure (PR #17–#20) samtidig. Sesjon: https://claude.ai/code/session_01JqwntywRSPWcBmrv2nPUoo

29.10.2026: prosjektleder fullførte synkstatus: flettet `main` inn (versjonskonflikt løst, 0.2.11), krysset av i planen, oppdaterte tilstanden og åpnet PR #21 mot `main`. Sesjon: https://claude.ai/code/session_01JqwntywRSPWcBmrv2nPUoo

29.10.2026 kl. 17:10–18:00: hovedløkken merget PR #18 (tilstand) og kjørte liten oppgave (c) med arbeidsflyten «oppgave» til PR #19, merget med skriptet (CI grønn, to små funn står i PR-en). Neste: synkstatus (annen sesjon), deretter prøve A og B når Ståle har slått på synktjenestene. Sesjon: https://claude.ai/code/session_01Jqwnu11Jdv4FLbyF9rNKnW

29.10.2026: prosjektleder fullførte liten oppgave (c), småfunnene fra PR #17 (forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver; alle sjekker grønne), krysset av i planen og åpnet PR mot `main`. Sesjon: https://claude.ai/code/session_01Jqwnu11Jdv4FLbyF9rNKnW

29.10.2026 kl. 13:57–17:00: hovedløkken merget PR #14 (CI grønn), sjekket at ingen gamle brancher har innhold som mangler på `main` (forskjellene er bare eldre versjoner som `main` har erstattet), og kjørte oppgave (a) med arbeidsflyten «oppgave» til PR #17, som ble merget med skriptet. Ryddet tilstandsfilen etter to kjøringer samtidig. Sesjon: https://claude.ai/code/session_01Jqwnu11Jdv4FLbyF9rNKnW

29.10.2026 ca. kl. 15–16: prosjektleder fullførte synktjenestene i Azure: flettet `main` inn, versjon 0.2.7, planen krysset av, PR #17 åpnet mot `main`. CI grønn, men den automatiske flettingen fra `main` (bot) ga en CI-kjøring som venter på godkjenning, så GitHub meldte «unstable»; ny commit fra agenten for å starte CI på nytt. Sesjon: https://claude.ai/code/session_01Jqwnu11Jdv4FLbyF9rNKnW

29.10.2026 kl. 15:55–: hovedløkken fant PR #14 merget og merget PR #15 (CI grønn). Læringsløkke for #14 og #15, beslutningen «ingen grense for PR-er som venter» ført inn i `LES-MEG-kartlegging.md` og planen (lå bare på en gammel branch). Startet oppgaven «Synkstatus som alltid vises». Sesjon: https://claude.ai/code/session_01JqwntywRSPWcBmrv2nPUoo

29.10.2026 kl. 10:45–13:50 (parallelt med kjøringen under): løste konflikten i PR #10, fullførte oppgave 6 (PR #11), fant og rettet en feil der bildekøen kunne stå fast, rettet småfunnene fra PowerSync-prøven og gjorde bildetestene stabile (PR #14, først mot `fase1-kandidat-egenbygd`, så flyttet til `main`). To sesjoner jobbet samtidig uten å vite om hverandre. Sesjon: https://claude.ai/code/session_01Jqwntz9WUQ9tyG2mcL52jZ

29.10.2026 kl. 12:45–13:00: hovedløkken fant PR #10 og #11 merget, og at kandidat 3 manglet på `main`. Laget `fase1-kandidat-egenbygd-til-main` fra den gamle branchen med `main` flettet inn, læringsløkke for #10 og #11, og PR #12. Sesjon: https://claude.ai/code/session_01Jqwnu1u7LijJH79yxkGBBS

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
