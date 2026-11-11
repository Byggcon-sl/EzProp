# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger. Filen holdes kort: bare det som gjelder nå. Historikken til og med 10.11.2026 står i `docs/agenter/arkiv/tilstand-til-2026-11-10.md` (der står også små funn fra tidligere leveranser, «liten oppgave (v)–(ad)»).

**Autonom modus: på** (Ståle 04.11.2026, til han sier fra: «Jeg synes det fungerte så bra at du kan kjøre videre på autonom utvikling igjen»). Ingen varsler, ingen spørsmål, ingen «Venter på Ståle». Agentene avgjør selv ut fra researchen og fører beslutningene i `docs/09-apne-sporsmal.md` («Avgjort av agentene mens Ståle var borte», neste nummer etter det høyeste A-nummeret, nå A168; A169–A175 er satt av til «Vask før KI»). Det bare Ståle kan gjøre, samles under «Trenger Ståle når han er tilbake». Se «Autonom modus» i `CLAUDE.md`.

**Hovedmål (Ståle 10.11.2026):** best mulig system for de ansatte, KI først og KI i bunnen, og færre reklamasjoner. 50 % mindre tid er ikke lenger hovedmål. Se `CLAUDE.md`.

**Ståle 10.11.2026 (i chat):**
- S1, S2 og S3 er gjort: testmiljøet i Azure virker, prøvene på ekte iPad er kjørt, ADR 0004 (egenbygd synk) er godkjent, og fagråd runde 1 er godkjent. De tre fagspørsmålene er besvart (spørsmål 59 i `docs/09-apne-sporsmal.md`, ført inn i PR #128).
- KI-leverandør er Anthropic, og Ståle har API-nøkkel. Anthropic-adapteren bygges bak KI-porten (ADR 0006) og kobles til secret `ANTHROPIC_API_KEY` via `readSecret`. Beslutningsnotatet (siste punkt i 2a-1) må si om behandlingen kan skje i EU/EØS.

## Gjeldende fase

**Fase 2a – Rapporten på PC**, i rekkefølgen **2a-1 KI-grunnmuren → 2a-2 Smal vei (ett våtrom fra kontrollpunkt til PDF) → 2a-3 Bredden.** Fase 0a og 1 er ferdige. Fase 0b er ferdig unntatt felles innlogging med Optiplan (venter på S6). «Minimum før ekte data» kan nå bygges i testmiljøet (S1 gjort). Levert arbeid står i `docs/plan/levert.md`.

## Gjeldende oppgave

- **Levert: KI-modulen og loggen** (2a-1, PR #127, versjon 0.5.0, migrering `0025_ki_logg`, A158–A165). Sikkerhet-personvern godkjent. Små funn som står (tas med «Forslagsmønsteret» eller «Vask før KI»): `ensureSampleAi` sjekker ikke selv `sampleData`; `recordDecision` leser raden før rettigheten sjekkes; mål-id-en kontrolleres mot organisasjonen når `answers` bygges. Fra liten oppgave (ad) står ad-1, ad-3, ad-4 og ad-7 (vask), ad-6 (publiseringssperren), ad-8 og ad-9.
- **Levert: Fjerne PowerSync og ElectricSQL** (ADR 0004, Ståle 10.11.2026; PR #129, merget 10.11.2026, versjon 0.5.1, migrering `0026_fjern-synkpublikasjoner`). `wal_level=logical` og unntakene for `public/@powersync/` står igjen til migreringen har kjørt på Macene; kan fjernes i en senere rydde-PR.
- **Levert: Forslagsmønsteret** (2a-1, PR #131 merget 10.11.2026 kl. 23:59 UTC, branch `fase2a-forslagsmonster` fra `main`, oppgavekort `docs/funksjoner/fase2a-forslagsmonster.md`, A166–A168, versjon 0.5.3, PR #131). Prøvesiden `/prove/ki` med `language_polish` mot falsk leverandør, forslagskortet, KI-merket, statusoppslaget og publiseringssperren som tjeneste (`checkAiTextApproved`). Tar med ad-6 og småfunnene om `recordDecision` og `ensureSampleAi`. Roller: forenkler, ux, ki-ansvarlig, sikkerhet-personvern, test-leder, ui-designer, utvikler, testskriver. Små funn som står (tas med «Vask før KI» eller 2a-2): dobbelt sett med tester (`X.test.ts` og `X-testplan.test.ts`, rundt 3000 linjer, bør slås sammen); `getSuggestionStatus` leser raden før rettigheten sjekkes; sperren godtar rader med `ai_trial` (må stenges når listen kommer fra serveren i 2a-2); null-element i listen til sperren gir unntak (feiler lukket); vakten for `ai_trial` sammenligner leverandørobjektet direkte; `readTrialStatus` brukes ikke av siden; triks med `Object.keys(kiVariant)` i knappen; valgfri `source` i overskriften på forslagskortet.
- **I arbeid: Vask før KI** (2a-1, 11.11.2026; branch `fase2a-vask-for-ki` fra `main`, oppgavekort `docs/funksjoner/fase2a-vask-for-ki.md`, A169–A175, migrering `0027`, versjon 0.5.5). Tar med ad-1, ad-3, ad-4, ad-7 og småfunnene om mål-id-en og `getSuggestionStatus`. Roller: ki-ansvarlig, sikkerhet-personvern, utvikler, testskriver. Steg: oppgavekort og testplan klare (`docs/funksjoner/fase2a-vask-for-ki-testplan.md`). Bygging fortsetter etter omstart fra `origin/wip-vask-13` (mønstrene og loggeren) og `origin/wip-vask-14` (migrering `0027_ki-vask`, `redacted_count`, `blocked`, `getSuggestionStatus`); kontrolleres mot kortet og fullføres.
- **Neste i 2a-1:** «Vask før KI», «Evalueringssett», «KI-kø» og «Beslutningsnotat om KI-leverandør» (med Anthropic-adapteren).

## Åpne PR-er

Se GitHub. Ingen PR venter på Ståle.

## Trenger Ståle når han er tilbake

Kortlisten står i `docs/07-utviklingsplan.md` under «Venter på Ståle» (S4–S8). I tillegg:

- **Anthropic-nøkkelen (S8):** legg den inn som secret `ANTHROPIC_API_KEY` i GitHub (aldri i chat eller repo) når adapteren er merget. Agentene sier fra her når det er klart.
- **Synkprøven i Azure kan ryddes** (etter at PR-en som fjerner PowerSync og ElectricSQL er merget): de fire GitHub-secrets for synktjenestene og variabelen `ENABLE_SYNC_TRIAL` kan slettes (`docs/drift/testmiljo-azure.md`). Synkbryteren var aldri på, så ingenting må slettes i Azure.
- **Nøkkelboksen for hemmeligheter (ADR 0005):** sett GitHub-variabelen `ENABLE_KEY_VAULT` til `true`, kjør utrullingen og sjekk hakemerkene i App Service (`docs/drift/testmiljo-azure.md`, «Nøkkelboks for hemmeligheter»).
- **E-post via Microsoft 365 i testmiljøet (PR #64, A44):** de fire secretene `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` og `MAIL_FROM`, og én ekte innlogging i testmiljøet (`docs/drift/testmiljo-azure.md`).
- **Fillagring i Azure (PR #62):** lagringskonto i Sweden Central (koster penger), privat container, og bekreft at databehandleravtalen for Azure dekker den.
- **Tidsmåling (A121, A123):** legg inn tallene fra målingen i IVIT på `/statistikk/tid`, og drøft målingen med de ansatte først (arbeidsmiljøloven kapittel 9).
- **Personvernspørsmålene om KI** (54–58 i `docs/09-apne-sporsmal.md`) før ekte KI brukes med ekte data.

## Oppgaver fra testlaget

Funnene ligger som én fil per funn i `docs/agenter/testlag/funn/`. Rapporten til Ståle: `docs/agenter/testlag/rapport.md`. Siste kjøring: 11.11.2026 på main 0b8e3b9 (første kjøring).

- Åpne alvorlige feil: 1 (T-0001). Rettes før neste nye punkt i planen.
- Åpne funn i alt: 35 (1 alvorlig, 16 middels, 18 små). Middels og små tas med neste oppgave i samme område. T-0004 og T-0005 (KI-kortet sletter tekst) og T-0003 (svar 59a) må tas før 2a-2.
- **Til «Trenger Ståle» (prosjektlederen fører inn):** Spectora Advanced slås av før ca. 23.11.2026 (koster penger), og passordene til IVIT, Spectora og SmartTakst byttes. Se `docs/agenter/testlag/funn/T-0002-venter-pa-stale-mangler-spectora-og-passord.md`.

## Oppgaver fra nattløkken

**Nattløkken 11.11.2026** (main 0b8e3b9, versjon 0.5.4). Lint, typecheck og test grønne (6861 tester), e2e grønn når den kjøres alene (516 besto, 56 hoppet over). Erstatter listen fra 06.11.2026 (arkivet); alvorlig 1 og 2 derfra står fortsatt åpne og er tatt med under.

Alvorlige:
1. **Sårbar esbuild 0.18.20** (moderat, GHSA-67mh-4wv8-2f99) via drizzle-kit 0.31.11 > @esbuild-kit. Bare utviklerverktøy. Ingen nyere drizzle-kit: prøv `pnpm.overrides` esbuild >=0.25.0 under @esbuild-kit/core-utils, og prøv `pnpm db:generate` og `pnpm db:migrate`. Åpen siden 06.11.
2. **Sårbar minimatch** (moderat, GHSA-g3hv-75wg-m249) via eslint-config-next > eslint-plugin-import > @typescript-eslint/typescript-estree. Bare lint. Patch-oppdateringen i rydde-PR-en 11.11 fjernet den ikke. Neste: `pnpm.overrides` minimatch >=11.0.1 og prøv `pnpm lint`. Åpen siden 06.11.

Lite:
3. **Sårbar fast-xml-parser 5.11.2** (lav, GHSA-474x-hrwr-fgx4) via @azure/storage-blob > @azure/core-xml. Produksjonsavhengighet (fillagring), lav risiko. Prøv `pnpm update fast-xml-parser --depth 3`, ellers override >=5.12.0, og kjør testene for fillagring.
4. **Testsuiten tar 16 minutter** (943 s), over grensen på 10 minutter per kommando. Tiden går mest til `truncate` mellom testene. Agentløkkene kjører `pnpm test` i bakgrunnen eller med lengre tidsgrense. Senere: se på raskere opprydding mellom tester.
5. **Nattløkkens oppsett:** bruk `git pull --ff-only` (eller `git fetch && git reset --hard origin/main`), rydd port 3100 før e2e eller kjør med `CI=1` (hengende server ga 16 falske røde), og kjør aldri `pnpm build` samtidig med e2e i samme mappe.
6. **UU-sjekken trenger skall-tilgang og axe:** `@axe-core/playwright` er ikke installert (ny avhengighet, må begrunnes). Sjekken for hånd fant ingen alvorlige feil.
7. **Hopplenke «Hopp til hovedinnhold»** i `src/app/(ansatt)/layout.tsx` (forbedring, tas med neste oppgave i rammen).
8. **@playwright/test 1.64.1 → 1.65.0:** kan kreve nyere Chromium enn `/opt/pw-browsers/chromium`. Kjør `pnpm test:e2e` i skyen før merge.
9. **Nye hovedversjoner, ikke nå:** @types/node 26 (skal følge Node som kjører), eslint 10, postgres 4 (databasedriveren, egen oppgave), typescript 7.
10. **Indeks `orders (organization_id, assignment_id)`**: arbeidskøen, `getAssignment` og `properties.ts` leser alle ordrer i organisasjonen per oppdrag. Først å merkes. Krever migrering.
11. **Indeks for arbeidskøen:** `assignments (organization_id, status) where deleted_at is null`, og `assignment_team_members (organization_id, employee_id) where to_at and deleted_at is null` for «Mine».
12. **Indekser på `firm_id`:** `contacts`, `assignment_parties` og `orders.ordered_by_firm_id` (organization_id, firm_id).
13. **Indekser for senere:** `audit_log (organization_id, entity_type, entity_id, occurred_at)` når historikk per oppdrag kommer; `ai_usage_log` per oppdrag og per ansatt; fremmednøkler uten indeks (38 stk, de fleste uviktige ved myk sletting); `employee_permissions`, `employee_roles` og `template_element_options` uten indeks som starter med organization_id.
14. **Lister uten grense:** `listOrders`, `listAgreements`, `listClaimsForAssignment`. Grense eller sidevisning før ekte data.
15. **Tilgangssjekken gjentas per kall** (4 spørringer hver gang). Mulig cache per forespørsel; må vurderes av sikkerhet-personvern.
16. **Skriving i løkke:** `apply-changes.ts` i prøvemodulen kjører én operasjon om gangen. Mønsteret skal ikke kopieres til den ekte synken i fase 2.
17. Notert, ingen tiltak: to lenker i løpende tekst under 44 px (lovlig etter WCAG 2.5.8); prøvesidene `/prove/testskjema*` er dobbelt så store som resten (75,8 kB, under grensen på 100 kB).

Ryddet i PR «Rydding fra nattløkken 2026-11-11» (versjon 0.5.5): patch-oppdatering av next og eslint-config-next 16.4.6, better-auth 1.7.20, jose 6.2.17, tailwindcss og @tailwindcss/postcss 4.3.5, dotenv 18.0.10, typescript-eslint 8.72.2.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

10.11.2026 kl. 10:40–21:10 UTC (hovedløkken, sesjon 2psdm9): merget PR #119 (malmotoren), PR #123/#124 (ADR 0006) og PR #125 (læringsløkken for malmotoren). Arbeidsflyten for «KI-modulen og loggen» ble kjørt samtidig med en annen kjøring som merget samme punkt som PR #127; denne kjøringens utgave ligger uten PR på `arkiv-ki-modul-logg-parallell` og skal ikke merges. Lærdom i `erfaringer.md`. «Forslagsmønsteret» er i arbeid hos en annen kjøring (`fase2a-forslagsmonster`), så denne kjøringen startet ikke noe nytt. Sesjon: https://claude.ai/code/session_01JqwntzyKpHhA8USjreExSS

10.11.2026 kl. 15:50 – 11.11.2026 kl. 00:05 UTC (hovedløkken, sesjon 01JqwntyrsbsRQRsaXLpJ9hm): ingen åpne PR-er ved start. PR #127 (KI-modulen), #128 (fagsvar), #129 (PowerSync og ElectricSQL fjernet) og #131 (forslagsmønsteret, sammen med en annen kjøring som hadde åpnet PR-en) er merget. Lærdom: CI for `pull_request` venter på godkjenning når siste commit er fra github-actions[bot] (automatisk fletting); en ny, ekte commit fra agenten starter vanlig CI. PR #126 (Ståles svar) var merget. «KI-modulen og loggen» var satt sammen av en kjøring som stanset (siste push 14:59 UTC, ingen PR). Denne kjøringen flettet inn `main`, rettet fire røde tester og tre småfunn fra sikkerhet-personvern, og åpnet PR #127. Ståles fagsvar ført inn i PR #128 (merget). PowerSync og ElectricSQL fjernet av utvikler på egen branch. Tilstandsfilen ryddet (historikken til arkivet).
