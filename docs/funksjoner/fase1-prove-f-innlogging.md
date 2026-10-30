# Funksjon: Prøve F – innlogging som har gått ut

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (prøvemodulen), og innloggingssiden (`src/app/logg-inn`)
- **Status:** utkast til gjennomgang (30.10.2026)
- **Branch:** `fase1-prove-f-innlogging` (bygger på `main`)
- **Støtter hovedmål:**
  - **Reklamasjoner (hovedsak):** ingenting fra befaringen skal gå tapt fordi innloggingen gikk ut mens takstmannen var uten nett. Svarene og bildene ligger på iPaden til han har logget inn igjen, og synkes da uten tap.
  - **Tid:** takstmannen kan fortsette befaringen uten nett i stedet for å stå fast på innloggingssiden. Etter ny innlogging kommer han rett tilbake til skjemaet han jobbet i, uten å lete.
  - **KI først:** se under.

## Problem

Innloggingen varer i 30 dager (`src/core/auth/auth.ts`). Går den ut mens takstmannen er på befaring uten nett, må han fortsatt kunne åpne og fylle ut rapporten (planen for prøvene, `docs/funksjoner/fase1-testskjema.md`, rad F; Spectora gjør dette, `docs/kartlegging/spectora-detaljer.md` linje 74: «dataene dine er trygge»).

Slik er det i dag:

- **Uten nett** åpnes skjemaet fra kopien i service workeren, og svar lagres lokalt. Det ser ut til å virke, men er ikke testet med utløpt innlogging.
- **Når nettet kommer**, svarer serveren 401 på synken. Synkstatusen viser bare «Venter: N endringer …» eller «Fikk ikke sendt. Prøver igjen automatisk.» Takstmannen får ikke vite at han må logge inn, og endringene blir liggende. Lukker han appen og tror alt er sendt, kan svarene mangle på kontoret.
- **Etter innlogging** sendes han til arbeidskøen, ikke tilbake til skjemaet.

## KI først

Ikke i denne oppgaven. Dette er grunnlaget for at KI-forslag og bilder som lages på iPaden uten nett, ikke går tapt når innloggingen går ut. Appen oppdager selv at innloggingen har gått ut, og sier fra. Takstmannen trenger ikke å huske noe.

## Brukerhistorier

- Som **takstmann** vil jeg **kunne åpne og fylle ut skjemaet uten nett selv om innloggingen har gått ut**, slik at **befaringen ikke stopper**.
- Som **takstmann** vil jeg **få en tydelig beskjed om å logge inn på nytt når nettet kommer**, slik at **jeg vet at noe ikke er sendt ennå**.
- Som **takstmann** vil jeg **komme tilbake til skjemaet etter innlogging, og se at alt blir sendt**, slik at **ingenting går tapt**.
- Som **Ståle** vil jeg **ha en resultatmal for prøven på ekte iPad**, slik at **prøve F kan tas med i sammenligningen og ADR-en**.

## Flyt (skjemaet, iPad)

```
Uten nett, innlogging utløpt:  [Uten nett]                         <- som i dag, ingen ny melding
Nettet kommer:                 [Logg inn på nytt for å sende. Alt er lagret på iPaden. [Logg inn]]
Trykk «Logg inn»:              /logg-inn?neste=/prove/testskjema/<id>  -> kode på e-post
Etter innlogging:              tilbake i skjemaet -> «Alt er lagret»
```

Uten nett vises ingen melding om innlogging: appen kan ikke vite om innloggingen har gått ut før den får kontakt, og takstmannen skal ikke forstyrres mens han jobber. Antall trykk når nettet kommer: 1 («Logg inn») + e-post og kode (som i dag) + 0 for å komme tilbake.

## Omfang

**Med:**

1. **Oppdage at innloggingen har gått ut** (i skjermlaget, likt for alle tre kandidatene):
   - En ren funksjon i prøvemodulen, `src/modules/offline-trial/session-check.ts`, spør serveren om innloggingen gjelder (`GET /api/auth/get-session` fra Better Auth, som finnes; svaret `null` betyr «ikke innlogget»). Svar: `valid`, `expired` eller `unknown` (nettverksfeil, 5xx, ugyldig svar). Funksjonen kaster aldri, og leser bare om det finnes en økt, aldri e-post eller navn.
   - Sjekken kjøres når skjemaet eller listen åpnes **med nett**, når nettleseren melder `online`, og etter en synkrunde som feiler (også «Synk nå»). Ikke på tidsur. Høyst én sjekk om gangen.
   - `unknown` endrer ingenting (statusen blir som i dag). Bare `expired` gir meldingen.
   - **Ingen endringer i de tre kandidatene** (`sync/powersync`, `sync/electricsql`, `sync/custom`, `sync/local`). De fortsetter å prøve og feile som i dag; køen og bildene blir liggende urørt til innloggingen er tilbake.
2. **Melding om å logge inn på nytt:**
   - Ny femte tilstand i synkstatusen: `signInRequired`, med tekst i `sync-status-text.ts`: «Logg inn på nytt for å sende. Alt er lagret på iPaden.» Den har forrang foran «Venter …» og «Venter på kontakt med serveren», men **ikke** foran «Uten nett».
   - Knappen «Logg inn» (minst 44 pt høy) i den faste linjen øverst går til `/logg-inn?neste=<sti til siden takstmannen står på>`. «Synk nå» skjules mens meldingen vises.
   - Vises på listen `/prove/testskjema` og i skjemaet. Ingen melding om innlogging uten nett.
   - Markør for testene: ny `data-sync-state="offline|allSaved|pending|awaitingServer|signInRequired"` på `data-testid="sync-status"` (verdien er `SyncStatusKind`). Testene leser markøren, ikke norsk tekst.
3. **Tilbake til skjemaet etter innlogging:**
   - Innloggingssiden tar imot `neste`. Etter riktig kode går den dit i stedet for `/arbeidskoe`. Er takstmannen allerede innlogget når siden åpnes, går den også dit.
   - **Bare trygge stier:** én ren funksjon `safeNextPath(value)` i `src/app/logg-inn/` (eller `src/core/auth`): godtar bare stier som begynner med `/prove/testskjema` eller er `/arbeidskoe`, ikke `//`, ikke `\`, ingen protokoll, ingen kontrolltegn. Alt annet gir `/arbeidskoe`. Testsaker i Vitest.
   - `requireActor()` endres ikke. Åpner takstmannen en side **med nett** og utløpt innlogging, sendes han til innlogging som i dag (uten `neste`); det er greit fordi han da har nett og kan logge inn.
4. **Synk etter innlogging:** når siden lastes på nytt etter innlogging, starter synken som før, og køen sendes. Ingen ny kode i kandidatene. Den lokale lagringen tømmes ikke (samme organisasjon, `TRIAL_LAST_ORGANIZATION_KEY`).
5. **Testkrok for e2e:** ingen ny krok i produksjonskoden. E2e simulerer utløpt innlogging ved å sette `expires_at` på økten i testdatabasen til et tidspunkt som er passert (vakten i `e2e/database-guard.ts` brukes). Går ikke det, slettes informasjonskapselen med `context.clearCookies()`. Nettet slås av og på med `context.setOffline()`.
6. **Tester:** se «Testplan».
7. **Resultatmal for prøven på ekte iPad:** `docs/funksjoner/fase1-prove-f-innlogging-resultat.md`. Trinn for Ståle, med avkryssing:
   - iPad-modell, iPadOS- og Safari-versjon, appen lagt på hjemskjermen, kandidat.
   - **Slik settes innloggingen som utløpt på ekte iPad:** åpne skjemaet med nett (så kopien ligger i appen), gå til arbeidskøen og trykk «Logg ut» (med nett), slå på flymodus, åpne appen fra hjemskjermen og deretter skjemaet. Serveren ser det samme som når innloggingen har gått ut: ingen gyldig økt. Ingen egen kort levetid i testmiljøet (se A6).
   - **F1 Åpne uten nett:** skjemaet åpnes, alt som var der står der.
   - **F2 Fylle ut uten nett:** alle felt og 10 bilder; lukk appen helt og åpne igjen; alt står der.
   - **F3 Nettet kommer:** flymodus av; meldingen «Logg inn på nytt for å sende» kommer innen ca. 10 sekunder (eller etter «Synk nå»).
   - **F4 Logg inn og synk:** «Logg inn», kode på e-post, tilbake i skjemaet, «Alt er lagret». Sjekk på PC at alle svar og alle 10 bilder er der.
   - Hver del per kandidat, med bestått / delvis / ikke bestått. Det står i malen at ekte utløp etter 30 dager ikke kan testes direkte.
8. Versjon i `package.json` økes (patch). Ordlisten oppdateres (se «Data»). Beslutningene A5 og A6 står i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**

- Endringer i de tre kandidatene (synk, kø, bildeopplasting, PowerSync-token). PowerSync-tokenet kan gjelde opptil én time etter at økten er borte (`SYNC_TOKEN_TTL_SECONDS`); det endres ikke i prøven, men tas med i ADR-en. Opplasting går alltid gjennom våre ruter, som sjekker økten.
- Innlogging uten nett, lokal PIN, Face ID eller å forlenge økten automatisk uten nett.
- Kortere eller lengre levetid for innloggingen, og egen levetid i testmiljøet.
- Varsel før innloggingen går ut («utløper om 3 dager»). Kan foreslås senere.
- Melding om innlogging mens appen er uten nett.
- Tilbake til skjemaet når siden åpnes med nett og innloggingen har gått ut (`requireActor` med `neste`). Kan tas i fase 0b sammen med felles innlogging.
- At en annen ansatt logger inn på samme iPad og overtar køen. Samme organisasjon i dag; hører til fase 0b og 2b.
- Logg ut som tømmer iPaden. Logg ut endres ikke.
- Nye ruter, nye tabeller, migreringer, nye avhengigheter.
- Safari/WebKit i Playwright (som prøve C).

## Tilgang

| Rolle | Se meldingen og «Logg inn» | Endre |
|---|---|---|
| takstmann | ja (i prøvesidene) | – |
| kontor | ja | – |
| leder | ja | – |
| admin | ja | – |

Ingen ny rute og ingen ny spørring som tar `organizationId`, så `expectTenantIsolation` trengs ikke. Det godtas bare hvis `git diff` viser at ingenting i `src/db`, `src/app/api` eller `src/modules/offline-trial/server` er endret. All synk går fortsatt gjennom rutene som sjekker tilgang i `src/core/access`; de endres ikke. Ingen tilgangsregel endres, så admin stenges ikke ute. Myk sletting gjelder ikke (ingen nye data).

**Sikkerhet:** `neste` er den eneste nye inngangen fra adressefeltet. Den må aldri kunne sende til en annen nettside (åpen videresending). Sjekken av økten skal aldri logge eller vise e-post, navn eller svar.

## Data

Ingen nye tabeller eller felter. Ingen faste koder i datamodellen. Markørverdien er bare for testene.

Ordlisten i `docs/05-domenemodell.md` avsnitt 8 får:

- **innlogging som har gått ut** → `expired session` (serveren har ingen gyldig økt for enheten)
- **logg inn på nytt** → `sign-in required` (tilstanden i synkstatusen)
- **neste side** → `next path` (`neste` i adressen til innloggingssiden)

## Skjermer

- **Listen** og **skjemaet** (iPad og PC): ny tilstand i den faste linjen øverst, med knappen «Logg inn». Null ekstra trykk i vanlig flyt.
- **Innloggingssiden**: uendret utseende. Går til `neste` etter riktig kode.
- Følger designprinsippene («Fjord»). Tilstanden bruker samme farge som «Venter …» (advarsel), ikke feil: ingenting er tapt.

## Regler

Ingen fagregler. `safeNextPath` er en teknisk regel med testsaker i Vitest.

## Testplan

**Vitest:**

- `session-check.test.ts`: økt gir `valid`, `null` gir `expired`, 5xx, nettverksfeil og ugyldig JSON gir `unknown`, aldri kast.
- `sync-status-text.test.ts`: `signInRequired` har forrang foran «Venter …» og «Venter på kontakt med serveren», men ikke foran «Uten nett».
- `safeNextPath`: `/prove/testskjema`, `/prove/testskjema/<uuid>` og `/arbeidskoe` godtas; `//evil.example`, `/\evil.example`, `https://…`, `javascript:…`, tom, `/api/…`, `/logg-inn`, kontrolltegn og lange strenger gir `/arbeidskoe`.

**Playwright, `e2e/fase-1-prove-f-innlogging.spec.ts`** (pc og ipad, Chromium, standardkandidaten PowerSync; én test med egenbygd hvis det ikke dobler tiden):

- **Åpne og fylle ut uten nett med utløpt innlogging:** logg inn, åpne skjemaet (kopien lages), sett økten som utløpt, slå av nettet, last siden på nytt. Skjemaet åpnes, svar og ett bilde lagres, ingen melding om innlogging, statusen er «Uten nett».
- **Data overlever lukking:** ny side i samme kontekst uten nett, alt står der.
- **Nettet kommer:** slå på nettet. `data-sync-state="signInRequired"`, meldingen og «Logg inn» vises; svarene står fortsatt i feltene; serveren har ikke fått dem (sjekk i testdatabasen).
- **Logg inn og synk:** «Logg inn», koden fra utviklingspostkassen, tilbake på samme skjema (`neste`), statusen blir «Alt er lagret», og svarene og bildet finnes i testdatabasen. Ingenting mangler.
- **Gyldig innlogging gir ingen melding:** med nett og gyldig økt vises aldri `signInRequired`.
- **`neste` til en annen nettside** (`/logg-inn?neste=//evil.example`): etter innlogging havner man på `/arbeidskoe`.
- «Logg inn» er minst 44 px høy på ipad.

## Akseptkriterier

- [ ] Skjemaet kan åpnes og fylles ut uten nett når innloggingen har gått ut (e2e, pc og ipad).
- [ ] Endringene ligger lokalt etter lukking og ny åpning (e2e).
- [ ] Når nettet kommer, vises «Logg inn på nytt for å sende. Alt er lagret på iPaden.» med knappen «Logg inn» (e2e).
- [ ] Etter innlogging kommer takstmannen tilbake til samme skjema, og alt synkes uten tap (e2e, sjekket i testdatabasen).
- [ ] `neste` sender aldri til en annen nettside (Vitest og e2e).
- [ ] Ingen endringer i de tre kandidatene, i `src/db` eller i `src/app/api` (`git diff`).
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen ny spørring; eksisterende tester for rutene gjelder.
- [ ] Virker på iPad-størrelse (e2e).
- [ ] Resultatmalen `docs/funksjoner/fase1-prove-f-innlogging-resultat.md` finnes.
- [ ] Ingen nye avhengigheter. Versjon økt. Ordlisten oppdatert.

## Beslutninger (autonom modus)

- **A5:** Meldingen om å logge inn vises bare når appen har nett og serveren sier at økten er borte. Uten nett: ingen melding. Kilde: Spectora (`spectora-detaljer.md` linje 74) og målet om få avbrudd.
- **A6:** På ekte iPad simuleres utløpt innlogging med «Logg ut» før flymodus, ikke med kort levetid i testmiljøet. Serveren ser det samme (ingen gyldig økt), det krever ingen endring i testmiljøet og ingen ekstra kode. Kan endres ved å legge inn kort levetid i testmiljøet senere.

## Åpne spørsmål

- Ingen som stopper oppgaven.
