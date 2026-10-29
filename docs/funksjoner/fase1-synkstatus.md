# Funksjon: Synkstatus som alltid vises

- **Fase:** 1 – Prøve uten nett (punktet «Synkstatus som alltid vises: antall endringer og bilder som venter, «lagret kl.», og «Synk nå»»)
- **Modul:** `offline-trial` (prøven, kastes eller gjøres om etter ADR-en)
- **Status:** klar til bygging (rettet etter ux-ansvarlig og test-leder 29.10.2026)
- **Branch:** `fase1-synkstatus` (bygger på `main`)
- **Dato:** 29.10.2026
- **Støtter hovedmål:**
  - **Reklamasjoner:** takstmannen ser hele tiden om noe ennå bare ligger på iPaden. Han forlater ikke befaringen i tro på at alt er lagret når det ikke er det, og ingenting går tapt mellom befaring og rapport.
  - **Tid:** ett trykk på «Synk nå» i stedet for å vente på neste automatiske forsøk (opptil 60 sekunder) når han kommer ut av kjelleren. I prøve A måles «tid til alt er lagret» med samme visning.
  - **KI først:** se under.

## Problem
Testskjemaet har i dag bare en liten måleindikator (`src/modules/offline-trial/sync-indicator.tsx`) med én tekstlinje. Den sier ikke når alt sist var lagret på serveren, og takstmannen kan ikke be om synk med en gang. Kommer han ut av en kjeller og vil vite at alt er trygt før han kjører, må han vente på neste automatiske forsøk. Lar vi være, mangler prøve A og demoen i kjelleren det takstmannen faktisk skal stole på, og vi kan ikke vurdere kandidatene på dette punktet.

## KI først
Nei, ikke i denne oppgaven. Synkstatusen er en tilstand som skal vises nøyaktig, ikke noe KI kan foreslå. Den er likevel en forutsetning for KI først: KI-forslag som lages på serveren senere, kan bare vises på iPaden når takstmannen vet at endringene hans er kommet fram.

## Brukerhistorier
- Som **takstmann** vil jeg **alltid se hvor mange endringer og bilder som venter, og når alt sist var lagret på serveren**, slik at **jeg vet om befaringen er trygg før jeg drar**.
- Som **takstmann** vil jeg **trykke «Synk nå»** slik at **det som venter sendes med en gang nettet er tilbake**.
- Som **takstmann uten nett** vil jeg **se tydelig «Uten nett»** og få beskjed om at synk skjer når nettet kommer, slik at **jeg ikke tror noe er feil**.

## Omfang
**Med:**
1. **Synkstatus øverst på testskjemaet**, i den faste linjen som allerede står øverst (`trial-form-page.tsx`), for alle tre kandidatene (PowerSync, ElectricSQL, egenbygd). Den erstatter måleindikatoren. Den vises også på listen «Testskjema» (`trial-form-list.tsx`), der indikatoren står i dag.
2. **Innhold**, i denne rekkefølgen:
   - Tilstand: «Uten nett», «Venter: 3 endringer, 2 bilder» eller «Alt er lagret». Entall og flertall som i dag («1 endring», «1 bilde»).
   - «Lagret kl. 14:32»: klokkeslett (24 timer, enhetens tidssone) for siste gang **serveren bekreftet** at ingenting ventet (se «Regler»). Er det en annen dag, vises dato også («Lagret 28.10. kl. 14:32»). Har det aldri skjedd på enheten: «Ikke lagret på serveren ennå».
   - Knappen **«Synk nå»**, minst 56 pt høy (designprinsipp 6: hovedknapper 56–72 pt), alltid synlig.
3. **«Synk nå» med nett:** sender det som ligger i endringskøen, starter bildeopplastingen og henter fra serveren med en gang, og hopper over ventetiden etter en feil. Knappen viser «Synker …» og kan ikke trykkes igjen før runden er ferdig. Trykk to ganger rett etter hverandre gir én runde (ett kall til `store.syncNow`).
4. **«Synk nå» uten nett:** starter ikke noe, sender ingenting til `/api/prove/`, og viser beskjeden «Du er uten nett. Alt er lagret på iPaden og sendes når nettet kommer.» Beskjeden leses opp av skjermleser (`aria-live`).
5. **«Synk nå» som feiler med nett** (serveren svarer med feil, tidsavbrudd etter 15 sekunder, eller nett uten tilgang): knappen går tilbake fra «Synker …» til «Synk nå», «Lagret kl.» endres ikke, og samme `aria-live`-felt viser «Fikk ikke sendt. Prøver igjen automatisk.» Den automatiske synken fortsetter som før.
6. **«Synk nå» når alt allerede er lagret:** en kort runde mot serveren, så «Alt er lagret» med nytt klokkeslett. Det er riktig: serveren har nettopp bekreftet det.
7. **«Lagret kl.» overlever** at appen lukkes og iPaden startes på nytt (prøve A). Tidspunktet lagres i `localStorage` per kandidat (`trial_saved_at_powersync`, `trial_saved_at_electricsql`, `trial_saved_at_custom`). Alle tre nøklene tømmes i `clearIfOtherOrganization` (`select-store.ts`) ved bytte av organisasjon, uansett hvilken kandidat som er valgt.
8. **Kontrakten** (`sync/types.ts`):
   - `TrialSyncStatus` får feltet `serverConfirmed: boolean`: siste runde mot serveren (sending og henting) lyktes, og ingenting har feilet etter den. Settes til `false` ved feil, tidsavbrudd og når nettet forsvinner. Hver kandidat setter det ut fra sine egne svar fra serveren, ikke ut fra `navigator.onLine`.
   - `TrialSyncStore` får metoden `syncNow(): Promise<TrialSyncRoundResult>`, der `TrialSyncRoundResult = "ok" | "offline" | "failed"`. Den kaster aldri. Uten nett returnerer den `"offline"` straks uten fetch. Med nett sender den køen og henter med en gang, hopper over ventetiden etter en feil, varsler `onStatusChange` (slik at bildekøen starter via det varselet den allerede lytter på), og returnerer `"failed"` ved feil eller etter 15 sekunder.
   - «Lagret kl.» regnes ut ett sted, likt for alle kandidater, med den rene funksjonen `nextSavedAt(status, previous, now)`: nytt tidspunkt bare når `online`, `serverConfirmed` og 0 endringer og 0 bilder venter; ellers `previous` uendret.
9. Rene funksjoner (`syncStatusText`, `savedAtText`, `nextSavedAt`, beskjedene) med enhetstester, og e2e for iPad- og PC-størrelse.
10. Versjon i `package.json` økes (patch). Ordlisten oppdateres.

**Ikke med (bevisst utelatt):**
- Synktjenestene i Azure (egen oppgave på branchen `fase1-synk-i-azure`). Den branchen røres ikke.
- Liste over hva som venter (hvilke felt og bilder), feilmeldinger per bunt eller per bilde, og knapp for å prøve ett bilde på nytt.
- Fremdriftslinje for bildeopplasting, tid igjen eller hastighet.
- Varsel når appen har stått lenge uten synk, eller lyd og vibrasjon.
- Synk når appen er lukket (Safari tillater det ikke).
- Endringer i server, database eller rutene under `/api/prove/`. Ingen migrering, ingen ny avhengighet.
- Synkstatus i resten av appen (arbeidskøen o.l.). Den ekte synkstatusen bygges etter ADR-en.

## Tilgang
Ingen ny tilgang. Synkstatusen viser bare tall fra enheten selv. «Synk nå» bruker de samme rutene og den samme tilgangssjekken som den automatiske synken (`src/core/access`).

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja | «Synk nå» |
| kontor | ja (som testskjemaet i dag) | «Synk nå» |
| leder | ja | «Synk nå» |
| admin | ja | «Synk nå» |

## Data
Ingen nye tabeller eller kolonner på serveren. Lokalt i nettleseren: ett tidspunkt for «Lagret kl.» per kandidat (ISO-tekst). Ingen faste koder (`key`) tas i bruk.

## Skjermer
- **iPad (stående og liggende):** linjen øverst viser tilstand og «Lagret kl.» til venstre og «Synk nå» til høyre. Linjen blir stående når man ruller. Ett trykk for synk (før: ingen mulighet, bare vente).
- **PC:** samme linje, samme plassering.
- Farger og stil etter `docs/08-designprinsipper.md` (A «Fjord»). «Uten nett» skal skille seg tydelig fra «Alt er lagret», ikke bare med farge (tekst også).

## Regler
Ingen fagregler. Teksten følger disse faste reglene (testsaker i Vitest):
- **«Nett» betyr at siste runde mot serveren lyktes** (`online` og `serverConfirmed`). At nettleseren mener den har nett (`navigator.onLine`) og at telleren lokalt står på 0, er ikke nok.
- Uten nett (`online` er `false`) → «Uten nett», uansett hva som venter.
- `online`, `serverConfirmed` og 0 som venter → «Alt er lagret», og «Lagret kl.» settes til nå.
- Noe venter → «Venter: N endringer, M bilder», «Lagret kl.» endres ikke.
- `online`, 0 som venter, men ikke `serverConfirmed` (ny enhet før første runde, eller Wi-Fi uten internett) → «Venter på kontakt med serveren». «Lagret kl.» endres ikke. En helt ny enhet viser altså «Ikke lagret på serveren ennå» til første vellykkede runde, så «Lagret kl.».
- Samme dag → «Lagret kl. HH:MM»; annen dag → «Lagret DD.MM. kl. HH:MM»; aldri → «Ikke lagret på serveren ennå».
- `savedAtText(savedAt, now, timeZone)` tar tidspunkt og tidssone inn. Appen sender enhetens tidssone; testene sender alltid et fast tidspunkt og `Europe/Oslo`.

## Testplan
**Enhetstester (Vitest, rene funksjoner):**
- `syncStatusText`: uten nett ved 0 og ved noe som venter; «Alt er lagret»; «Venter på kontakt med serveren»; entall og flertall (1 endring / 2 endringer / 1 bilde / 0 bilder).
- `savedAtText`: samme dag, annen dag («28.10. kl. 14:32»), aldri, og grensen rundt midnatt (fast tidspunkt, `Europe/Oslo`).
- `nextSavedAt`: settes bare ved `online`, `serverConfirmed` og 0 som venter; endres ikke når noe venter, uten nett eller uten `serverConfirmed`.
- Beskjeden uten nett og beskjeden ved feil, ordrett.
- Bare én runde om gangen: to kall rett etter hverandre gir ett kall til `store.syncNow`.
- `syncNow` per kandidat (PowerSync, Electric, egenbygd): med nett starter sending og henting med en gang og hopper over ventetiden etter en feil; uten nett ingen fetch og `"offline"`; feil gir `"failed"` uten å kaste; varselet `onStatusChange` sendes.

**Integrasjon og tenant:** ingen nye spørringer eller ruter. Ingen endring under `src/app/api/prove/`, `src/db` eller `src/core/access` (testleder sjekker diffen). Eksisterende tester for tenant-isolasjon og tilgang til synkrutene består uendret. Myk sletting: ikke relevant, ingenting slettes på serveren.

**E2e (PC og iPad, for hver av de tre kandidatene).** Alle tester med klokkeslett bruker `page.clock` og `timezoneId: "Europe/Oslo"`.
- Synkstatusen vises på listen og testskjemaet, og står i synsfeltet etter rulling til bunnen.
- Antallene stemmer med `store.status()` via testkroken.
- «Lagret kl.» vises; siden lastes på nytt uten nett, og samme tidspunkt står der.
- Tvunget feil: `page.route` gir 500 på sending én gang, så normalt svar. Et trykk på «Synk nå» gir ny forespørsel innen 3 sekunder (godt under ventetiden), og `pendingChanges` går til 0.
- Feil ved trykk: `page.route` gir 500; knappen går tilbake til «Synk nå», feilbeskjeden står i `aria-live`, «Lagret kl.» er uendret.
- Uten nett: «Uten nett» vises, beskjeden står i `aria-live`, og ingen forespørsler går til `/api/prove/`.
- Trykk når alt er lagret: «Alt er lagret» med nytt klokkeslett.
- To raske trykk gir én forespørsel om sending.
- Knappen er minst 56 høy (`boundingBox`) på iPad-størrelse.
- `simulateOrganizationChange` og ny lasting tømmer «Lagret kl.».
- Minst én test som takstmann (ikke admin) bruker «Synk nå», i tillegg til admin.

## Akseptkriterier
- [ ] Synkstatusen vises på testskjemaet og listen for alle tre kandidatene, også når siden er rullet ned.
- [ ] Antall endringer og bilder som venter stemmer med `store.status()` for hver kandidat (e2e med testkroken).
- [ ] «Lagret kl.» vises etter at alt er sendt, og står der fortsatt etter at siden lastes på nytt uten nett.
- [ ] «Synk nå» med nett sender køen med en gang, også når kandidaten venter på neste forsøk etter en feil (test per kandidat).
- [ ] «Synk nå» uten nett gir beskjeden og sender ingenting til `/api/prove/`, og kaster ikke.
- [ ] «Synk nå» som feiler med nett: knappen går tilbake til «Synk nå», beskjeden «Fikk ikke sendt. Prøver igjen automatisk.» vises, og «Lagret kl.» endres ikke (test per kandidat).
- [ ] «Lagret kl.» settes bare når serveren har bekreftet at ingenting venter; Wi-Fi uten internett eller en ny enhet før første runde gir aldri «Alt er lagret».
- [ ] Trykk når alt er lagret gir «Alt er lagret» med nytt klokkeslett.
- [ ] To raske trykk gir én runde.
- [ ] Knappen er minst 56 pt høy på iPad-størrelse (e2e).
- [ ] Bytte av organisasjon tømmer «Lagret kl.» for alle tre kandidatene.
- [ ] «Synk nå» virker for takstmann, ikke bare admin (e2e).
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen nye spørringer; eksisterende tester for synkrutene består uendret.
- [ ] Virker på iPad-størrelse og PC (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Avgjørelser før bygging (prosjektleder 29.10.2026)
1. **«Nett» = siste runde mot serveren lyktes** (ux-ansvarlig 2, test-leder 1). Nytt felt `serverConfirmed` i stedet for å endre betydningen av `online`, fordi bildekøen og dagens tester bruker `online` som i dag. Tilstanden «Venter på kontakt med serveren» trengs for at «Alt er lagret» aldri skal vises feil; den er en del av samme statuslinje og ikke en ny funksjon.
2. **Feil ved «Synk nå» gir beskjed** (ux-ansvarlig 1, test-leder 2). `syncNow` returnerer `"ok" | "offline" | "failed"` i stedet for `void`, slik at skjermen kan vise riktig beskjed uten å lese kandidatens indre tilstand. Tidsavbrudd 15 sekunder, så knappen aldri blir hengende på «Synker …».
3. **`syncNow` kaster aldri og sender ingenting uten nett** (test-leder 3).
4. **Faste tider i testene** (test-leder 4): tidssone sendes inn, `page.clock` og `Europe/Oslo` i e2e.
5. **Tvunget feil i e2e** (test-leder 5): `page.route` med 500 én gang.
6. **Nøklene for «Lagret kl.»** tømmes for alle tre kandidatene i `select-store.ts` (test-leder 6).
7. **Trykk når alt er lagret** gir ny runde og nytt klokkeslett (ux-ansvarlig 3).

## Åpne spørsmål
- Ingen til Ståle nå. Ordlyden kan justeres etter demoen.
