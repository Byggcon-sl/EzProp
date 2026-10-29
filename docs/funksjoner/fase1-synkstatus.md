# Funksjon: Synkstatus som alltid vises

- **Fase:** 1 – Prøve uten nett (punktet «Synkstatus som alltid vises: antall endringer og bilder som venter, «lagret kl.», og «Synk nå»»)
- **Modul:** `offline-trial` (prøven, kastes eller gjøres om etter ADR-en)
- **Status:** utkast
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
   - «Lagret kl. 14:32»: klokkeslett (24 timer, norsk tid på enheten) for siste gang det var nett og ingenting ventet. Er det en annen dag, vises dato også («Lagret 28.10. kl. 14:32»). Har det aldri skjedd på enheten: «Ikke lagret på serveren ennå».
   - Knappen **«Synk nå»**, minst 56 pt høy (designprinsipp 6: hovedknapper 56–72 pt), alltid synlig.
3. **«Synk nå» med nett:** sender det som ligger i endringskøen, starter bildeopplastingen og henter fra serveren med en gang, og hopper over ventetiden etter en feil. Knappen viser «Synker …» og kan ikke trykkes igjen før runden er ferdig. Trykk to ganger rett etter hverandre gir én runde.
4. **«Synk nå» uten nett:** starter ikke noe, og viser beskjeden «Du er uten nett. Alt er lagret på iPaden og sendes når nettet kommer.» Beskjeden leses opp av skjermleser (`aria-live`).
5. **«Lagret kl.» overlever** at appen lukkes og iPaden startes på nytt (prøve A). Tidspunktet lagres lokalt per kandidat og tømmes sammen med resten ved bytte av organisasjon.
6. **Kontrakten** (`sync/types.ts`): `TrialSyncStore` får én ny metode `syncNow(): Promise<void>`, implementert i alle tre kandidatene. «Lagret kl.» regnes ut ett sted, likt for alle kandidater (når `status()` viser nett og 0 som venter), ikke i hver kandidat. Bildeopplastingen startes via det varselet den allerede lytter på (`onStatusChange`), ikke via en ny vei.
7. Rene funksjoner for teksten (tilstand, «Lagret kl.», beskjed uten nett) med enhetstester, og e2e for iPad- og PC-størrelse.
8. Versjon i `package.json` økes (patch). Ordlisten oppdateres.

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
- Uten nett → «Uten nett», uansett hva som venter.
- Nett og 0 som venter → «Alt er lagret», og «Lagret kl.» settes til nå.
- Nett og noe venter → «Venter: N endringer, M bilder», «Lagret kl.» endres ikke.
- Samme dag → «Lagret kl. HH:MM»; annen dag → «Lagret DD.MM. kl. HH:MM»; aldri → «Ikke lagret på serveren ennå».

## Akseptkriterier
- [ ] Synkstatusen vises på testskjemaet og listen for alle tre kandidatene, også når siden er rullet ned.
- [ ] Antall endringer og bilder som venter stemmer med `store.status()` for hver kandidat (e2e med testkroken).
- [ ] «Lagret kl.» vises etter at alt er sendt, og står der fortsatt etter at siden lastes på nytt uten nett.
- [ ] «Synk nå» med nett sender køen med en gang, også når kandidaten venter på neste forsøk etter en feil (test per kandidat).
- [ ] «Synk nå» uten nett gir beskjeden og sender ingenting.
- [ ] To raske trykk gir én runde.
- [ ] Knappen er minst 56 pt høy på iPad-størrelse (e2e).
- [ ] Bytte av organisasjon tømmer «Lagret kl.».
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen nye spørringer; eksisterende tester for synkrutene består uendret.
- [ ] Virker på iPad-størrelse og PC (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Åpne spørsmål
- Ingen til Ståle nå. Ordlyden kan justeres etter demoen.
