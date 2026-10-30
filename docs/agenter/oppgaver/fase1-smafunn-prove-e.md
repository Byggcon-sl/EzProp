# Funksjon: Småfunn fra prøve E og rest fra PR #26 (liten oppgave e)

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (prøvekoden, ingen produktmodul)
- **Status:** godkjent (prosjektleder, autonom modus)
- **Branch:** `fase1-smafunn-prove-e` fra `main`. Bygger på: ingenting (alt er merget).
- **Støtter hovedmål:** Reklamasjoner: synken som skal hindre at noe går tapt mellom befaring og rapport får en egen test for rettingen som forkaster gamle øyeblikksbilder, og reglene får grensetallet bare ett sted, så melding og regel aldri sier forskjellige ting. Tid: færre doble tester gir raskere og ryddigere testkjøring for agentene. KI først: indirekte (se under).

## Problem
Gjennomgangen av prøve E (PR #23) og PR #26 fant små ting som ikke stoppet mergen, men som bør rettes før prøvekoden blir grunnlaget for ekte regler og ekte synk:

1. `localWriteGeneration` i `src/modules/offline-trial/sync/local/trial-store.ts` (felles lagring for alle tre kandidatene) har ingen egen enhetstest. Rettingen er bare dekket av e2e.
2. `src/modules/offline-trial/rules/index.ts` eksporterer testsakene (`trial-rule-cases.ts`), så de havner i appens pakke uten å trenges der.
3. Grensetallene (7 år og 42 %) står både i `TRIAL_ONLY_LIMITS` og som fast tekst i meldingene i `trial-rules.ts`.
4. Noen tester for prøve E overlapper (e2e for 401/403 som også er i `route.test.ts`, ekstra 400-saker, importsjekken i motortesten). E2e-testen «403 for annen organisasjon» bruker en organisasjon som ikke finnes; den ekte sjekken ligger i `route.test.ts`.
5. `sync/custom/reader.ts` (ca. linje 275) og `sync/electricsql/store.ts` (ca. linje 197) logger hele feilobjektet. Loggen skal bare vise feilmeldingen (samme mønster som PR #26), så rader fra serveren aldri kan havne i loggen.

Lar vi være: en feil i synkrettingen kan komme tilbake uten at en rask test fanger den, og regeltallene kan gli fra meldingene når reglene blir ekte.

## KI først
Ikke direkte. Dette er rydding i prøvekoden. Reglene som data med ett sted for tallene er likevel grunnlaget for at KI senere kan foreslå tekst og TG ut fra de samme dataene som takstmannen kontrollerer.

## Brukerhistorier
- Som **utvikler/agent** vil jeg **ha en rask enhetstest for synkrettingen** slik at **en feil oppdages før e2e**.
- Som **fagansvarlig** vil jeg **at grensetallet bare står ett sted** slik at **regel og melding alltid sier det samme**.

## Omfang
**Med:**
- Ny enhetstest for `localWriteGeneration`: et øyeblikksbilde som ble lest før en nyere lokal skriving, blir forkastet; et bilde uten nyere skriving blir brukt. Testen går mot `trial-store.ts` uten nettleser (bruk det som allerede finnes av testoppsett for lagringen).
- `rules/index.ts` eksporterer ikke lenger `trial-rule-cases`. Testene (`route.test.ts`, `trial-rule-cases.test.ts`, e2e) importerer testsakene direkte fra `trial-rule-cases.ts`.
- Meldingene i `trial-rules.ts` bygges fra `TRIAL_ONLY_LIMITS` (eller regelens egne data), så tallet bare står ett sted. Teksten til takstmannen blir lik som før. Testen som i dag sammenligner tall og tekst, beholdes eller forenkles.
- Rydd overlappende tester for prøve E: fjern e2e-testene for 401/403 som er dekket i `route.test.ts` (også «403 for annen organisasjon» med organisasjon som ikke finnes), slå sammen ekstra 400-saker, fjern importsjekken i motortesten hvis lint eller annen test dekker den. Behold minst én e2e som viser regelsvaret under feltet uten nett, og `expectTenantIsolation` i `route.test.ts`.
- `reader.ts` og `electricsql/store.ts`: logg `error instanceof Error ? error.message : String(error)` (samme mønster som PR #26), med test eller oppdatert eksisterende test som viser at bare meldingen logges.
- Versjon i `package.json`: 0.2.17 → 0.2.18.

**Ikke med (bevisst utelatt):**
- Nye funksjoner, nye regler, nye felt eller endrede grensetall (spørsmål nr. 13 om ekte tall står åpent).
- Endret tekst til takstmannen utover at tallet hentes fra dataene.
- Navnekollisjonen `TrialRuleResult` (komponent og type), VoiceOver-spørsmålet i resultatmalen og andre småfunn fra PR #23 som ikke står over. Kan tas i en senere liten oppgave.
- Endringer i synklogikken utover testen og loggen.
- Ny avhengighet, migrering, endring i tilgang eller i Azure.

## Tilgang
Uendret. Ruten `/api/prove/regler` bruker fortsatt `requireOrganizationAccess`; testen for annen organisasjon i `route.test.ts` beholdes.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | uendret | uendret |
| kontor | uendret | uendret |
| leder | uendret | uendret |
| admin | uendret | uendret |

## Data
Ingen nye tabeller eller felt. Ingen nye faste koder. Ordlisten trenger ikke endres.

## Skjermer
Ingen endring. Regelsvaret under feltene ser likt ut.

## Regler
De to prøvereglene er uendret. Alle 14 testsaker skal fortsatt passere.

## Akseptkriterier
- [x] Egen Vitest-test for `localWriteGeneration` som feiler hvis rettingen fjernes.
- [x] `rules/index.ts` eksporterer ikke testsakene, og ingen fil under `src/` utenom tester importerer `trial-rule-cases`.
- [x] Tallene 7 og 42 står bare i regeldataene i `trial-rules.ts`, ikke i meldingsteksten; meldingene som vises er like som før.
- [x] Overlappende tester for prøve E er fjernet eller slått sammen; dekningen av 401, 403 og annen organisasjon finnes fortsatt i `route.test.ts`.
- [x] `reader.ts` og `electricsql/store.ts` logger bare feilmeldingen (test).
- [x] Bruker i annen organisasjon får ikke tilgang (eksisterende `expectTenantIsolation` i `route.test.ts` står igjen og passerer).
- [x] Virker på iPad-størrelse (eksisterende e2e for prøve E passerer på PC og iPad).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjon 0.2.18.

## Roller
- **utvikler** og **testskriver** i parallell. Bitene henger ikke sammen: (a) testskriver: enhetstest for `localWriteGeneration` og logg-testene; (b) utvikler: testsakene ut av `index.ts`, tallet ett sted, loggendringen, ryddingen i overlappende tester.
- **test-leder**: kort gjennomgang til slutt (at dekningen ikke forsvinner i ryddingen).
- Ikke med: arkitekt, ux, ui, KI, fag (ingen fagendring), sikkerhet (loggendringen følger mønsteret fra PR #26 som allerede er godkjent).

## Åpne spørsmål
- Ingen nye. Nr. 13 (ekte grensetall) står fortsatt åpent og påvirkes ikke.

## Levert (30.10.2026)
- Meldingene i `trial-rules.ts` bygges av `limitMessages()` fra `TRIAL_ONLY_LIMITS`; teksten er ordrett som før (testen med fast tekst er uendret).
- `rules/index.ts` eksporterer bare regler og motor. Testene og e2e henter testsakene fra `trial-rule-cases.ts`.
- E2e «ruten krever innlogging» og «ruten gir 403 for annen organisasjon» er fjernet (dekket i `route.test.ts`). Tre doble 400-saker er fjernet (fukt-variant av tekst, `organizationId` som tall, `answers` er null).
- Importsjekken i motortesten (D4) er **beholdt**: lint for modulgrenser stopper bare import mellom moduler, ikke fra en annen mappe i samme modul.
- `custom/reader.ts` og `electricsql/store.ts` logger bare feilmeldingen.
- Kontroll: uten vakten i `sendSnapshot` blir W1 og W3 røde; med hele feilobjektet i loggen blir L1–L3 røde.
- Versjon 0.2.18. Vitest: 702 bestått (3 hoppet over, som før).
