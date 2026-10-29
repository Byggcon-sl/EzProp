# Funksjon: Prøve E – regler uten nett

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (prøvemodulen)
- **Status:** utkast
- **Branch:** `fase1-prove-e-regler` (bygger på `main`)
- **Støtter hovedmål:**
  - **Tid:** takstmannen får svaret fra regelen der han står, også i kjelleren uten dekning, og slipper å slå opp levetider og grenser selv.
  - **Reklamasjoner:** samme regel gir samme svar på iPaden og på serveren. Da kan ikke rapporten si noe annet enn det takstmannen så på stedet.
  - **KI først:** regelmotoren er grunnlaget for forslag som takstmannen bare kontrollerer og godkjenner. Senere KI-forslag skal kjøre ved siden av de faste reglene, og takstmannen har alltid siste ord.

## Problem

Planen sier at regler og TG-logikk er data med testsaker og skal kjøre både på iPaden og på serveren (CLAUDE.md regel 5, domenemodellen avsnitt «Regler og validering på iPaden»). Før vi velger løsning for drift uten nett, må vi vite at det virker i Safari uten nett, og at iPaden og serveren aldri gir ulikt svar. Lar vi være, kan vi oppdage for sent at forslag på iPaden og kontrollen ved publisering sier forskjellig.

## KI først

Ikke i denne oppgaven. Prøven gjelder faste regler (alder mot levetid og en målegrense). Regelmotoren er stedet der KI-forslag senere kobles inn på samme måte: forslag vises, takstmannen godkjenner. KI publiserer aldri selv.

## Brukerhistorier

- Som **takstmann** vil jeg **se svaret fra regelen rett under feltet når jeg skriver alder eller fuktmåling, også uten nett**, slik at **jeg ikke må slå opp tallene selv**.
- Som **Ståle** vil jeg **prøve dette på ekte iPad i flymodus og krysse av i en resultatmal**, slik at **prøve E kan tas med i sammenligningen og ADR-en**.

## Omfang

**Med:**

1. **To regler som data** i `src/modules/offline-trial/rules/` (ren TypeScript, ingen database, ingen migrering), med samme form som `rules` og `rule_conditions` i domenemodellen, så langt prøven trenger:
   - `trial_water_heater_age` – betingelsestype `age_vs_lifespan`, forenklet: leser `water_heater_age` (alder i år) og sammenligner med en levetid.
   - `trial_moisture_floor_limit` – betingelsestype `number_vs_limit`: leser `moisture_floor` (%) mot en grense med retning (over).
   - Tallene er **oppdiktede prøveverdier** (for eksempel levetid 20 år og grense 15 %). De står i én konstant med navn som `TRIAL_ONLY_…` og kommentaren «Oppdiktet prøveverdi, ikke fag», og ved hver regel står `source_ref: "oppdiktet prøveverdi"`.
   - Svaret fra en regel er bare: **slår til / slår ikke til / ikke vurdert** (feltet er tomt), pluss en kort, egen melding på norsk. **Ingen TG-forslag, ingen utfall, ingen avvikstekst.**
2. **Testsaker som data** ved siden av reglene (samme form som `rule_test_cases`: `name`, `input`, `expect_triggered`). Minst disse for hver regel: tomt felt (ikke vurdert), 0, under, **lik grensen**, rett over, desimaltall med komma, negativt tall. Hva som skjer på grensen («over» betyr strengt større enn), står i kortet og i testsaken.
3. **Én liten regelmotor** `evaluateTrialRules(rules, answers)` – én ren funksjon uten nettleser- eller server-API-er (ingen `window`, `fetch`, `fs`, database). Samme fil importeres av skjemaet i nettleseren og av serverruten. Tallene leses fra `TrialAnswers` (allerede tall, lest med `parseTrialNumber`).
4. **Serverruten** `POST /api/prove/regler` tar `{ organizationId, answers }` med bare de to feltene, validerer med Zod, sjekker tilgang med `requireOrganizationAccess(actor, organizationId, "organization.read")` og returnerer svaret fra samme `evaluateTrialRules`. Ingen spørring mot databasen, ingenting lagres, kroppen logges aldri. Feilsvar som de andre prøverutene (`error-response.ts`).
5. **Visning i testskjemaet:** én linje under `water_heater_age` og under `moisture_floor` med regelsvaret (for eksempel «Prøveregel: over prøvelevetiden (20 år)»), med `aria-live="polite"`. Regnes ut lokalt på iPaden ved hver endring, uten nett. Merket «Prøveregel» så ingen tror det er fag.
6. **Sammenligning nettleser mot server:**
   - Vitest kjører alle testsakene mot `evaluateTrialRules` i Node (samme kjøremiljø som serveren) og mot ruten (`POST /api/prove/regler`).
   - Playwright (PC- og iPad-størrelse) skrur av nettet (`context.setOffline(true)`), fyller inn hver testsak i skjemaet og leser svaret i visningen; slår nettet på igjen og sender de samme testsakene til ruten. Testen feiler hvis ett eneste svar er ulikt, eller ulikt `expect_triggered`.
7. **Resultatmal for prøven på ekte iPad:** `docs/funksjoner/fase1-prove-e-regler-resultat.md` – trinn for Ståle (flymodus, skriv inn verdiene fra testsakene, sammenlign med tabellen, slå på nett, trykk «Sjekk mot server» om den finnes – se under), med avkryssing per testsak og en rad for iPad-modell, iPadOS- og Safari-versjon.
   - En knapp «Sjekk mot server» i skjemaet er **med bare hvis den er liten** (én knapp som sender de to verdiene til ruten og viser «Samme svar» eller «Ulikt svar»). Ellers sammenligner Ståle mot tabellen i resultatmalen.
8. **`parseTrialNumber`:** er allerede byttet til strengt desimaltall med testsaker (rettet i oppgave 4, se `fase1-testskjema.md`). Her bare kontroll: legg til testsaker for verdiene reglene bruker («15», «15,0», «15.01», «-1»), ingen endring i funksjonen hvis de består.
9. Versjon i `package.json` økes (patch). Ordlisten oppdateres (`trial rule`, `evaluateTrialRules`).

**Ikke med (bevisst utelatt):**

- Ekte levetider, grenser eller materialkoder. Ingen tall fra NS 3600, og ingen tekst fra NS 3600, IVIT eller SmartTakst. Spørsmål om ekte tall går til Ståle (nr. 13).
- TG-forslag, utfall, avvik, `suggest_tgiu`, `suggest_outcome`, `show`, `validate` eller publiseringskontroller. TG-logikk hører bare til systemmalen for tilstandsrapport (fase 2a).
- Tabellene `rules`, `rule_conditions`, `rule_test_cases`, `lifespan_tables` og `threshold_tables` i databasen. Ingen migrering.
- Alder regnet fra årstall eller byggeår, dokumentasjon, materialkode og trinn i levetidstabellen. Prøven leser alderen direkte i år.
- Malbygger eller skjema for å lage regler.
- Lagring av regelsvaret eller synk av det. Svaret regnes ut på nytt fra svarene hver gang.
- Endringer i de tre synkkandidatene. Regelen leser bare svarene som skjemaet allerede har.
- Endringer i synkstatusen (`sync-indicator.tsx`, egen branch `fase1-synkstatus`).

## Tilgang

| Rolle | Se regelsvaret | Bruke serverruten |
|---|---|---|
| takstmann | ja (i testskjemaet) | ja, egen organisasjon |
| kontor | ja | ja, egen organisasjon |
| leder | ja | ja, egen organisasjon |
| admin | ja | ja, egen organisasjon |

Ruten krever innlogging (401 ellers) og tilgang til organisasjonen (403 for annen organisasjon). Ingen databasespørring, så `expectTenantIsolation` trengs ikke; i stedet en test som viser 403 for en ansatt i en annen organisasjon og 401 uten innlogging.

## Data

Ingen nye tabeller eller felter. Faste koder som tas i bruk (CLAUDE.md regel 6, endres aldri):

- regel `trial_water_heater_age`
- regel `trial_moisture_floor_limit`
- felt `water_heater_age` og `moisture_floor` (finnes fra før i testskjemaet)

Ordlisten i `docs/05-domenemodell.md` avsnitt 8 får `trial rule` (prøveregel) og `evaluateTrialRules` (regelmotoren i prøven).

## Skjermer

- iPad og PC: testskjemaet `/prove/testskjema/[id]`. Ingen ny skjerm. En tekstlinje under to felt, og eventuelt knappen «Sjekk mot server». Null ekstra trykk for å se regelsvaret.

## Regler

To regler som data, med testsaker som data (se omfang pkt. 1–2). Testsakene kjøres automatisk i Vitest og Playwright.

## Akseptkriterier

- [ ] De to reglene og testsakene ligger som data, med oppdiktede prøveverdier tydelig merket, og uten fagtekst eller TG.
- [ ] `evaluateTrialRules` er én ren funksjon som importeres både av skjemaet og av ruten (lint stopper ikke, ingen nettleser- eller server-API-er i filen).
- [ ] Alle testsakene gir forventet svar i Vitest (Node) og gjennom ruten.
- [ ] Playwright: med nettet av viser skjemaet riktig svar for alle testsakene, og svaret er likt rutens svar for de samme testsakene (PC og iPad-størrelse).
- [ ] Svaret på grensen er likt på iPaden og serveren (egen testsak «lik grensen»).
- [ ] Ruten gir 401 uten innlogging, 403 for annen organisasjon (test), 400 for ugyldig innhold, og logger aldri kroppen.
- [ ] Admin får svar fra ruten (admin stenges ikke ute).
- [ ] `parseTrialNumber` har testsakene i pkt. 8 og er uendret hvis de består.
- [ ] Resultatmalen for ekte iPad finnes og viser til testsakene.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjonen er økt.
- [ ] Planpunktet «Prøve E» krysses av når PR-en er åpnet; selve kjøringen på ekte iPad føres i resultatmalen av Ståle.

## Åpne spørsmål

- **Nr. 13 i `docs/09-apne-sporsmal.md` (ikke blokkerende):** hvilke ekte levetider og målegrenser skal brukes, og hvem i fagrådet bekrefter dem før de tas i bruk (fase 2a)? Prøven bruker oppdiktede tall til da.

## Roller

- **utvikler** (bit 1): regler, testsaker, regelmotor, ruten og visningen.
- **testskriver** (bit 2, parallelt): testplan-testene (Vitest for motor og rute, Playwright med nettet av), resultatmalen og testsakene for `parseTrialNumber`.
- **sikkerhet-personvern:** ny API-rute (tilgang, logging, validering).
- **fagansvarlig:** kort sjekk av at ingen tekst eller tall kan forveksles med fag, og at det ikke er TG-logikk.
- **test-leder:** testplan og godkjenning.

Ikke med: arkitekt (motoren ligger i prøvemodulen; plasseringen av den ekte regelmotoren avgjøres i fase 2a), UX og UI (én tekstlinje i eksisterende skjema etter designprinsippene), KI-ansvarlig.

**Merk:** `trial-form-view.tsx` kan også endres på `fase1-synkstatus`. Utvikleren holder endringen i skjemaet liten (egen komponent for regelsvaret) for å unngå konflikt.
