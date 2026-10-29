# Funksjon: Prøve E – regler uten nett

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (prøvemodulen)
- **Status:** klar for bygging (rettet etter gjennomgang 29.10.2026)
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

1. **To regler som data** i `src/modules/offline-trial/rules/` (ren TypeScript, ingen database, ingen migrering). Formen likner `rules` og `rule_conditions`, men har bare feltene prøven bruker: `key`, `field`, `kind`, `limit`, `source_ref` og meldingene. Betingelsestypen er en enkel union av to typer. Ingen register, ingen operatorliste, ingen annen retning enn «over», og ingen felles kobling mellom regler og skjema.
   - `trial_water_heater_age`, type `age_vs_lifespan`: leser `water_heater_age` (alder i år) og sammenligner med prøvelevetiden **7 år**.
   - `trial_moisture_floor_limit`, type `number_vs_limit`: leser `moisture_floor` (%) og sammenligner med prøvegrensen **42 %**.
   - Tallene er **oppdiktede prøveverdier**. De står i én konstant med navn som `TRIAL_ONLY_…` og kommentaren «Oppdiktet prøveverdi, ikke fag». Hver regel har `source_ref: "oppdiktet prøveverdi"`. Tallene er valgt slik at de ikke likner ekte levetider eller fuktgrenser.
   - **«Over» betyr strengt større enn, for begge reglene.** Verdi lik grensen slår ikke til. Dette gjelder bare prøven. Hvordan de ekte reglene skal behandle grensen, avgjøres i fase 2a (spørsmål nr. 13 c).
   - **Tomt felt, ugyldig tekst og negativt tall gir «ikke vurdert».** En negativ alder eller fuktmåling betyr ingenting, så den gir ikke «slår ikke til».
   - Svaret fra en regel er bare én av tre tilstander: `triggered` (slår til), `not_triggered` (slår ikke til) eller `not_evaluated` (ikke vurdert), pluss en melding. **Ingen TG-forslag, ingen utfall, ingen avvikstekst.**
   - **Meldingene** er egne og korte, alltid merket «Prøveregel», uten gjetteord («antas», «trolig») og uten ord som kan leses som vurdering eller tilstandsgrad («avvik», «TG», «bør skiftes»). Ingen målemetode, materiale eller skala. Bare disse:
     - «Prøveregel: over prøvegrensen (7 år)» / «Prøveregel: ikke over prøvegrensen (7 år)»
     - «Prøveregel: over prøvegrensen (42 %)» / «Prøveregel: ikke over prøvegrensen (42 %)»
     - «Prøveregel: ikke vurdert»
2. **Testsaker som data** ved siden av reglene (form som `rule_test_cases`: `name`, `input`, `expect_state`). `input` er **teksten slik den skrives inn** i skjemaet (for eksempel «7,5»), ikke et tall. Kjeden er alltid: tekst → `parseTrialNumber` → `evaluateTrialRules`. Vitest, Playwright og resultatmalen bruker de samme testsakene. `expect_state` har tre verdier i stedet for `expect_triggered` (ja/nei), fordi «ikke vurdert» må kunne testes.

   | Regel | Testsak | Inndata | Forventet |
   |---|---|---|---|
   | `trial_water_heater_age` | tomt felt | «» | `not_evaluated` |
   | | null | «0» | `not_triggered` |
   | | under | «6» | `not_triggered` |
   | | lik grensen | «7» | `not_triggered` |
   | | rett over (komma) | «7,5» | `triggered` |
   | | negativt tall | «-1» | `not_evaluated` |
   | | ugyldig tekst | «12,» | `not_evaluated` |
   | `trial_moisture_floor_limit` | tomt felt | «» | `not_evaluated` |
   | | null | «0» | `not_triggered` |
   | | under (komma) | «41,9» | `not_triggered` |
   | | lik grensen | «42» | `not_triggered` |
   | | rett over (punktum) | «42.01» | `triggered` |
   | | negativt tall | «-1» | `not_evaluated` |
   | | ugyldig tekst | «1e3» | `not_evaluated` |

3. **Én liten regelmotor** `evaluateTrialRules(rules, answers)`: én ren funksjon uten nettleser- eller server-API-er (ingen `window`, `document`, `fetch`, `fs`, `process`, `@/db`), uten tilstand. Den importerer bare fra egen mappe og `answers.ts`. Samme fil importeres av skjemaet i nettleseren og av serverruten. Tallene leses fra `TrialAnswers` (allerede tall eller `null`).
4. **Serverruten** `POST /api/prove/regler` tar `{ organizationId, answers: { water_heater_age, moisture_floor } }`, validerer med Zod, sjekker tilgang med `requireOrganizationAccess(actor, organizationId, "organization.read")` og returnerer svaret fra samme `evaluateTrialRules`. Ingen spørring mot databasen, ingenting lagres, kroppen logges aldri (heller ikke ved 400). Feilsvar som de andre prøverutene (`error-response.ts`).
   - **Zod (strict):** hvert felt er et JSON-tall, `null` eller mangler. `null` eller manglende felt gir «ikke vurdert». Negativt tall gir «ikke vurdert» (samme som på iPaden), ikke 400.
   - **400:** tekst i stedet for tall, ekstra felt i `answers` eller i kroppen, manglende eller ugyldig `organizationId`.
5. **Visning i testskjemaet:** én linje under `water_heater_age` og under `moisture_floor` med meldingen fra pkt. 1, med `aria-live="polite"`. Regnes ut lokalt på iPaden ved hver endring, uten nett. Linjen har faste markører for testene: `data-rule-key="<regelkode>"` og `data-rule-state="triggered|not_triggered|not_evaluated"`. Testene leser markørene, ikke den norske teksten. Egen liten komponent, så endringen i `trial-form-view.tsx` blir liten.
6. **Sammenligning nettleser mot server:**
   - Vitest kjører alle testsakene (tekst → `parseTrialNumber` → `evaluateTrialRules`) i Node, som er samme kjøremiljø som serveren. Vitest sender også alle testsakene gjennom ruten og sjekker at svaret er likt motorens (én løkke, billig, og fanger avvik uten å vente på Playwright).
   - Playwright: med nettet av (`context.setOffline(true)`) fylles hver testsak inn i skjemaet, og `data-rule-state` leses. Kjøres i både PC- og iPad-størrelse. Sammenligningen med ruten (nettet på igjen, samme testsaker til `/api/prove/regler`) kjøres **bare i ett prosjekt (pc)**, fordi ruten svarer likt uansett skjermstørrelse. Testen feiler hvis ett eneste svar er ulikt, eller ulikt `expect_state`.
   - Omlasting uten nett testes bare hvis testskjemaet allerede kan lastes på nytt uten nett. Ellers står det i PR-en at det ikke er dekket.
7. **Resultatmal for prøven på ekte iPad:** `docs/funksjoner/fase1-prove-e-regler-resultat.md`. Trinn for Ståle: flymodus, skriv inn verdiene fra tabellen i pkt. 2, sammenlign svaret med kolonnen «Forventet» (på norsk: over / ikke over prøvegrensen / ikke vurdert). Tabellen har samme navn og forventet svar som testsakene, med avkryssing per sak, og en rad for iPad-modell, iPadOS- og Safari-versjon.
8. **`parseTrialNumber`:** er allerede streng (rettet i oppgave 4, se `fase1-testskjema.md`). Funksjonen endres ikke. Bare nye testsaker for verdiene reglene bruker: «42» → 42, «42,0» → 42, «42.01» → 42,01, «7,5» → 7,5, «-1» → -1, «12,» → null, «1e3» → null. Feiler en av dem, stopper utvikleren og melder fra i stedet for å endre funksjonen i det stille.
9. Versjon i `package.json` økes (patch). Ordlisten oppdateres (`trial rule`, `evaluateTrialRules`, `rule state`).

**Ikke med (bevisst utelatt):**

- Knappen «Sjekk mot server». Playwright og Vitest sammenligner allerede med ruten, og på ekte iPad sammenligner Ståle med tabellen i resultatmalen.
- Et generelt regelrammeverk (register, operatorliste, flere retninger, kobling mellom regler og skjema). Den ekte motoren avgjøres i fase 2a.
- Ekte levetider, grenser eller materialkoder. Ingen tall fra NS 3600 eller levetidstabellen i `docs/kartlegging/`, og ingen tekst fra NS 3600, IVIT eller SmartTakst. Spørsmål om ekte tall og grensebehandling går til Ståle (nr. 13).
- TG-forslag, utfall, avvik, `suggest_tgiu`, `suggest_outcome`, `show`, `validate` eller publiseringskontroller. TG-logikk hører bare til systemmalen for tilstandsrapport (fase 2a).
- Tabellene `rules`, `rule_conditions`, `rule_test_cases`, `lifespan_tables` og `threshold_tables` i databasen. Ingen migrering.
- Alder regnet fra årstall eller byggeår, dokumentasjon, materialkode og trinn i levetidstabellen. Prøven leser alderen direkte i år.
- Malbygger eller skjema for å lage regler.
- Lagring av regelsvaret eller synk av det. Svaret regnes ut på nytt fra svarene hver gang.
- Endringer i de tre synkkandidatene. Regelen leser bare svarene som skjemaet allerede har.
- Endringer i synkstatusen (`sync-indicator.tsx`, egen branch `fase1-synkstatus`).
- Endringer i `answers.ts` (bortsett fra eventuelle nye testsaker i testfilen).

## Tilgang

| Rolle | Se regelsvaret | Bruke serverruten |
|---|---|---|
| takstmann | ja (i testskjemaet) | ja, egen organisasjon |
| kontor | ja | ja, egen organisasjon |
| leder | ja | ja, egen organisasjon |
| admin | ja | ja, egen organisasjon |

Ruten krever innlogging (401 ellers) og tilgang til organisasjonen (403 for annen organisasjon og for en ansatt som er mykt slettet). Alle fire rollene testes med 200 i egen organisasjon, ikke admin alene. Ingen databasespørring, så `expectTenantIsolation` trengs ikke; legger utvikleren likevel til en spørring, kreves den.

## Data

Ingen nye tabeller eller felter. Faste koder som tas i bruk (CLAUDE.md regel 6, endres aldri):

- regel `trial_water_heater_age`
- regel `trial_moisture_floor_limit`
- regeltilstandene `triggered`, `not_triggered`, `not_evaluated`
- felt `water_heater_age` og `moisture_floor` (finnes fra før i testskjemaet)

Ordlisten i `docs/05-domenemodell.md` avsnitt 8 får `trial rule` (prøveregel), `evaluateTrialRules` (regelmotoren i prøven) og `rule state` (slår til / slår ikke til / ikke vurdert).

## Skjermer

- iPad og PC: testskjemaet `/prove/testskjema/[id]`. Ingen ny skjerm. En tekstlinje under to felt. Null ekstra trykk for å se regelsvaret.

## Regler

To regler som data, med testsaker som data (se omfang pkt. 1–2). Testsakene kjøres automatisk i Vitest og Playwright.

## Akseptkriterier

- [ ] De to reglene og testsakene ligger som data, med oppdiktede prøveverdier (7 år, 42 %) i `TRIAL_ONLY_`-konstanten, `source_ref: "oppdiktet prøveverdi"`, og uten fagtekst eller TG.
- [ ] Meldingene inneholder «Prøveregel» og ingen av ordene «antas», «trolig», «avvik», «TG», «bør» (test).
- [ ] `evaluateTrialRules` er én ren funksjon uten tilstand som importeres både av skjemaet og av ruten. En test leser kildefilen og viser at den bare importerer fra egen mappe og `answers.ts`, og ikke bruker nettleser- eller server-API-er.
- [ ] Alle testsakene i tabellen i pkt. 2 gir forventet `expect_state` i Vitest (tekst → `parseTrialNumber` → motor), også «lik grensen» og «negativt tall» for begge reglene.
- [ ] Alle testsakene sendt gjennom ruten i Vitest gir samme svar som motoren.
- [ ] Playwright: med nettet av viser `data-rule-state` riktig svar for alle testsakene (PC og iPad-størrelse). I pc-prosjektet er svaret likt rutens svar for de samme testsakene.
- [ ] Ruten gir 401 uten innlogging, 403 for annen organisasjon og for mykt slettet ansatt, 400 for hvert ugyldig innhold i pkt. 4, og logger aldri kroppen (spion på console og logger, også ved 400).
- [ ] Takstmann, kontor, leder og admin får alle 200 i egen organisasjon (admin stenges ikke ute).
- [ ] `parseTrialNumber` har testsakene i pkt. 8 og er uendret.
- [ ] Resultatmalen for ekte iPad finnes, og tabellen har samme testsaker og forventet svar som i pkt. 2.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjonen er økt.
- [ ] Planpunktet «Prøve E» krysses av når PR-en er åpnet; selve kjøringen på ekte iPad føres i resultatmalen av Ståle.

## Åpne spørsmål

- **Nr. 13 i `docs/09-apne-sporsmal.md` (ikke blokkerende):** hvilke ekte levetider og målegrenser skal brukes, og hvem i fagrådet bekrefter dem før de tas i bruk, og (c) skal en verdi lik grensen (for eksempel alder lik levetid) regnes som over eller ikke (fase 2a)? Prøven bruker oppdiktede tall og «strengt større enn» til da.

## Roller

- **utvikler** (bit 1): regler, testsaker, regelmotor, ruten og visningen.
- **testskriver** (bit 2, parallelt): testplan-testene (Vitest for motor og rute, Playwright med nettet av), resultatmalen og testsakene for `parseTrialNumber`. Starter med testsakene i pkt. 2 som felles fasit; utvikleren legger dem i `rules/` og testskriveren leser dem derfra.
- **sikkerhet-personvern:** ny API-rute (tilgang, logging, validering).
- **fagansvarlig:** kort sjekk av at ingen tekst eller tall kan forveksles med fag, og at det ikke er TG-logikk.
- **test-leder:** testplan og godkjenning.

Ikke med: arkitekt (motoren ligger i prøvemodulen; plasseringen av den ekte regelmotoren avgjøres i fase 2a), UX og UI (én tekstlinje i eksisterende skjema etter designprinsippene), KI-ansvarlig.

**Merk:** `trial-form-view.tsx` kan også endres på `fase1-synkstatus`. Utvikleren holder endringen i skjemaet liten (egen komponent for regelsvaret) for å unngå konflikt.

## Avgjørelser etter gjennomgang (29.10.2026)

- **Prøvetallene byttet fra 20 år og 15 % til 7 år og 42 %** (fagansvarlig). 20 år er det ekte tallet for bereder i kartleggingen, og 15 % ligner ekte fuktgrenser. Et ekte tall merket «oppdiktet» kan bli kopiert inn i fase 2a uten godkjenning.
- **Negativt tall gir «ikke vurdert»** (fagansvarlig og test-leder). Det betyr ingenting som måling, og iPaden og serveren må si det samme. Derfor ligger «negativt tall» i regel-testsakene, ikke bare hos `parseTrialNumber` (forenkler pkt. 5 delvis avvist).
- **«Over» er strengt større enn for begge reglene**, bare for prøven. Grensebehandlingen for ekte regler er lagt til som nr. 13 c.
- **Testsakene er tekst, ikke tall** (test-leder), så komma og ugyldig tekst går gjennom samme kjede i Vitest, Playwright og på ekte iPad. Én sak med komma per regel holder (forenkler pkt. 5 delvis tatt inn).
- **Tre tilstander (`expect_state`) i stedet for `expect_triggered`**, fordi «ikke vurdert» må kunne testes.
- **Knappen «Sjekk mot server» er tatt ut** (forenkler). Den støtter ingen akseptkriterier.
- **Ingen generell regelmotor**, bare en union av to typer (forenkler).
- **Alle testsakene går gjennom ruten i Vitest** (test-leder), mot forenklerens forslag om å la Playwright dekke det alene. Det er én løkke, kjører i hver `pnpm test`, og fanger avvik uten nettleser. Til gjengjeld kjøres rute-sammenligningen i Playwright bare i pc-prosjektet (forenkler pkt. 4).
- **`parseTrialNumber` endres ikke** (forenkler pkt. 6). Oppgaveteksten sier «bytt», men funksjonen er allerede streng fra oppgave 4. Bare nye testsaker.
- **Faste markører `data-rule-key` og `data-rule-state`** i visningen, så testene ikke avhenger av norsk tekst (test-leder).
