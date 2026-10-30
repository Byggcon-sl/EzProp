# Funksjon: Prøve F – innlogging som har gått ut

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (prøvemodulen), og innloggingssiden (`src/app/logg-inn`)
- **Status:** godkjent etter gjennomgang (30.10.2026). Se «Avgjørelser etter gjennomgangen».
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
   - Svar fra serveren: 200 med en økt gir `valid`. 200 med `null` gir `expired`. Alt annet gir `unknown`: 200 med `{}` eller uten `session`, 401, 403, 5xx, nettverksfeil, ugyldig JSON og tidsavbrudd. 401 og 403 gir bevisst `unknown`, fordi `get-session` svarer 200 med `null` når ingen er innlogget; et annet svar er en feil vi ikke skal vise som «logg inn».
   - **Når sjekken kjøres** (bare med nett, aldri når `navigator.onLine` er usann):
     1. nettleseren melder `online`;
     2. synkstatusen (som allerede leser status hvert 2. sekund) ser at appen går fra «Uten nett» til nett. Safari på iPad sender ikke alltid `online`;
     3. appen kommer fram på skjermen igjen (`visibilitychange` til synlig);
     4. en synkrunde feiler (også etter «Synk nå»).
   - Ingen sjekk når siden åpnes. Sidene kaller allerede `requireActor()` på serveren, så med nett og utløpt økt sendes takstmannen til innlogging før sjekken rekker å kjøre.
   - Ikke noe nytt tidsur. Høyst én sjekk om gangen (en sjekk som pågår, gjenbrukes). Reglene for når sjekken kjøres, skilles ut som en ren funksjon med Vitest.
   - `unknown` endrer ingenting (statusen blir som i dag). Bare `expired` gir meldingen. Gir en senere sjekk `valid`, forsvinner meldingen.
   - **Ingen endringer i de tre kandidatene** (`sync/powersync`, `sync/electricsql`, `sync/custom`, `sync/local`). De fortsetter å prøve og feile som i dag; køen og bildene blir liggende urørt til innloggingen er tilbake.
2. **Melding om å logge inn på nytt:**
   - Ny femte tilstand i synkstatusen: `signInRequired`, med tekst i `sync-status-text.ts`: «Logg inn på nytt for å sende. Alt er lagret på iPaden.» Den har forrang foran «Venter …» og «Venter på kontakt med serveren», men **ikke** foran «Uten nett».
   - Knappen «Logg inn» står **på samme plass som «Synk nå»**, med samme størrelse (`size="lg"`, minst 44 pt, hele bredden på smal skjerm), så linjen ikke hopper. Den går til `/logg-inn?neste=<location.pathname>` (bare stien, uten spørrestreng og `#`). «Synk nå» skjules mens meldingen vises.
   - Meldingen leses opp (`role="status"`). Farge og utseende bestemmer ui-designer (advarsel, ikke feil).
   - Vises på listen `/prove/testskjema` og i skjemaet. Ingen melding om innlogging uten nett.
   - Markør for testene: ny `data-sync-state="offline|allSaved|pending|awaitingServer|signInRequired"` på `data-testid="sync-status"` (verdien er `SyncStatusKind`). Testene leser markøren, ikke norsk tekst.
3. **Tilbake til skjemaet etter innlogging:**
   - Innloggingssiden tar imot `neste`. Begge veiene bruker **samme funksjon** `safeNextPath`: `page.tsx` (allerede innlogget, sender videre på serveren; i dag alltid til `/arbeidskoe`) og `login-form.tsx` (`router.replace` etter riktig kode).
   - **Bare trygge stier:** én ren funksjon `safeNextPath(value: string | string[] | undefined)` i `src/app/logg-inn/safe-next-path.ts`. Den godtar bare en **hel** sti fra en fast liste, uten å dekode noe: nøyaktig `/arbeidskoe`, nøyaktig `/prove/testskjema`, eller `/prove/testskjema/<uuid>` (små bokstaver, tall og bindestrek, 36 tegn). Spørrestreng og `#` er ikke lov. Alt annet gir `/arbeidskoe`: liste, tom, mangler, `//`, `\`, protokoll, kontrolltegn, mellomrom, kodede tegn (`%2F`, `%5C`), `..`, og stier som bare begynner likt (`/prove/testskjemaX`). En fast liste i stedet for «begynner med» gjør at alle skjeve tilfeller faller bort av seg selv. Testsaker i Vitest.
   - `requireActor()` endres ikke. Åpner takstmannen en side **med nett** og utløpt innlogging, sendes han til innlogging som i dag (uten `neste`); det er greit fordi han da har nett og kan logge inn.
4. **Synk etter innlogging:** når siden lastes på nytt etter innlogging, starter synken som før, og køen sendes. Ingen ny kode i kandidatene. Den lokale lagringen tømmes ikke (samme organisasjon, `TRIAL_LAST_ORGANIZATION_KEY`).
5. **Testkrok for e2e:** ingen ny krok i produksjonskoden. To måter, som dekker de to tilfellene serveren kan se:
   - **Hovedflyten (takstmann):** setter `expires_at` til et passert tidspunkt **bare på sin egen økt**. Økten finnes ved å slå opp `sessions.token` fra informasjonskapselen i `context.cookies()` (formen «token.signatur»). Vakten `assertLocalOrTestDatabase` brukes. Aldri admin-økter, fordi andre tester kjører samtidig som admin. Dette er ekte utløp: nettleseren sender kapselen, men serveren har ingen gyldig økt.
   - **Admin-flyten:** `context.clearCookies()`, med en forklaring i testen. Det er det samme som «Logg ut» på ekte iPad (A6): nettleseren sender ingen kapsel.
   - Nettet slås av og på med `context.setOffline()`.
6. **Tester:** se «Testplan».
7. **Resultatmal for prøven på ekte iPad:** `docs/funksjoner/fase1-prove-f-innlogging-resultat.md`. Trinn for Ståle, med avkryssing:
   - iPad-modell, iPadOS- og Safari-versjon, appen lagt på hjemskjermen, kandidat.
   - **Slik settes innloggingen som utløpt på ekte iPad:** åpne skjemaet med nett (så kopien ligger i appen), gå til arbeidskøen og trykk «Logg ut» (med nett), slå på flymodus, åpne appen fra hjemskjermen og deretter skjemaet. Serveren ser det samme som når innloggingen har gått ut: ingen gyldig økt. Ingen egen kort levetid i testmiljøet (se A6).
   - **F1 Åpne uten nett:** skjemaet åpnes, alt som var der står der.
   - **F2 Fylle ut uten nett:** alle felt og 10 bilder; lukk appen helt og åpne igjen; alt står der.
   - **Under A6 står hva Ståle må passe på:** han må ha åpnet både skjemaet og listen med nett før han logger ut.
   - **F3 Nettet kommer:** flymodus av; meldingen «Logg inn på nytt for å sende» kommer innen ca. 10 sekunder (eller etter «Synk nå»). **Tid fra flymodus av til meldingen, i sekunder.**
   - **F4 Logg inn og synk:** «Logg inn», kode på e-post, tilbake i skjemaet, «Alt er lagret». Sjekk på PC at alle svar og alle 10 bilder er der. **Tid fra «Logg inn» til «Alt er lagret», i sekunder.** Eget punkt: «Gikk til Mail og tilbake: sto siden fortsatt på kodefeltet? ja/nei». Svarer prøven nei, føres det i `docs/09-apne-sporsmal.md` (forslag: husk steget i `sessionStorage`). Vi bygger ikke noe for det nå.
   - Hver del per kandidat, med bestått / delvis / ikke bestått. Det står i malen at ekte utløp etter 30 dager ikke kan testes direkte, og at PowerSync-tokenet kan gjelde i opptil én time etter at økten er borte (bare henting av data, ikke sending).
8. Versjon i `package.json` økes (patch). Ordlisten oppdateres (se «Data»). Beslutningene A5 og A6 står i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**

- Endringer i de tre kandidatene (synk, kø, bildeopplasting, PowerSync-token). PowerSync-tokenet kan gjelde opptil én time etter at økten er borte (`SYNC_TOKEN_TTL_SECONDS`); det endres ikke i prøven, men tas med i ADR-en. Opplasting går alltid gjennom våre ruter, som sjekker økten.
- Innlogging uten nett, lokal PIN, Face ID eller å forlenge økten automatisk uten nett.
- Kortere eller lengre levetid for innloggingen, og egen levetid i testmiljøet.
- Varsel før innloggingen går ut («utløper om 3 dager»). Kan foreslås senere.
- Melding om innlogging mens appen er uten nett.
- Tilbake til skjemaet når siden åpnes med nett og innloggingen har gått ut (`requireActor` med `neste`). Kan tas i fase 0b sammen med felles innlogging.
- Sjekk av innloggingen når siden åpnes (se punkt 1).
- At innloggingssiden husker e-posten eller at koden er sendt hvis iPadOS laster appen på nytt (prøves i F4).
- Fylle inn e-posten selv på innloggingssiden (sparer ca. 10 s). Kan foreslås senere.
- At en annen ansatt logger inn på samme iPad og overtar køen. Samme organisasjon i dag; hører til fase 0b og 2b (spørsmål nr. 14 i `docs/09-apne-sporsmal.md`).
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

Ingen ny rute og ingen ny spørring som tar `organizationId`, så `expectTenantIsolation` trengs ikke. Det godtas bare hvis testrapporten viser at `git diff main --stat -- src/db src/app/api src/modules/offline-trial/server src/modules/offline-trial/sync/powersync src/modules/offline-trial/sync/electricsql src/modules/offline-trial/sync/custom src/modules/offline-trial/sync/local` er tom. Er noe der endret, gjelder kravet om `expectTenantIsolation` som vanlig.

Hovedflyten i e2e kjøres som **takstmann** (`logInAsInspector`). En egen e2e viser at **admin** med «Logg inn» og `neste` havner i skjemaet (admin stenges ikke ute). Kontor og leder dekkes av de eksisterende rolletestene for `/prove`; det står i testrapporten. All synk går fortsatt gjennom rutene som sjekker tilgang i `src/core/access`; de endres ikke. Ingen tilgangsregel endres, så admin stenges ikke ute. Myk sletting gjelder ikke (ingen nye data).

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

Hele testplanen står i `docs/funksjoner/fase1-prove-f-innlogging-testplan.md`. Kort:

- **Vitest:** `session-check.test.ts` (alle svar fra serveren, aldri kast, aldri e-post eller navn ut, når sjekken kjøres, høyst én om gangen), `sync-status-text.test.ts` (`signInRequired`, forrang, markøren er alltid en av fem verdier), `safe-next-path.test.ts` (alle tilfellene fra punkt 3), og at «Synk nå» er skjult ved `signInRequired`.
- **Playwright** `e2e/fase-1-prove-f-innlogging.spec.ts`, Chromium, standardkandidaten PowerSync:
  1. **Hovedflyt som takstmann (pc og ipad):** én test med hele løpet, fra utløpt økt og uten nett til «Alt er lagret» og sjekk i testdatabasen.
  2. **Admin, «Synk nå» og ingen sjekk uten grunn (pc):** utløst av «Synk nå», ikke `online`.
  3. **Kopien av skjemaet ødelegges ikke (pc):** omdirigering til innlogging lagres ikke som kopi.
  4. **`neste` på begge veier (pc):** allerede innlogget og etter kode, med trygg sti og med `//evil.example`.
- `pnpm build` og e2e kjøres etter hverandre, ikke samtidig.

## Akseptkriterier

- [ ] Skjemaet kan åpnes og fylles ut uten nett når innloggingen har gått ut (e2e, pc og ipad).
- [ ] Endringene ligger lokalt etter lukking og ny åpning (e2e).
- [ ] Når nettet kommer, vises «Logg inn på nytt for å sende. Alt er lagret på iPaden.» med knappen «Logg inn» (e2e).
- [ ] Etter innlogging kommer takstmannen tilbake til samme skjema, og alt synkes uten tap (e2e, sjekket i testdatabasen).
- [ ] Meldingen kommer også etter «Synk nå», ikke bare etter `online`, og «Synk nå» er skjult mens «Logg inn» vises (e2e).
- [ ] Ingen sjekk av innloggingen uten nett, og ingen sjekk uten noe som utløser den (e2e og Vitest). Høyst én om gangen (Vitest).
- [ ] Serveren får ingenting før innlogging; etter innlogging finnes alle svar og bildet, og køen er 0 (e2e, testdatabasen).
- [ ] Den lagrede kopien av skjemaet blir ikke erstattet av innloggingssiden (e2e).
- [ ] `neste` sender aldri til en annen nettside, på begge veier (Vitest og e2e på pc).
- [ ] Admin med `neste` havner i skjemaet (e2e).
- [ ] Ingen endringer i de tre kandidatene, i `src/db`, `src/app/api` eller `src/modules/offline-trial/server` (`git diff` i testrapporten).
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen ny spørring; eksisterende tester for rutene gjelder.
- [ ] Virker på iPad-størrelse, og «Logg inn» er minst 44 px høy på listen og i skjemaet (e2e, ipad).
- [ ] Resultatmalen `docs/funksjoner/fase1-prove-f-innlogging-resultat.md` finnes.
- [ ] Ingen nye avhengigheter. Versjon økt. Ordlisten oppdatert.

## Beslutninger (autonom modus)

- **A5:** Meldingen om å logge inn vises bare når appen har nett og serveren sier at økten er borte. Uten nett: ingen melding. Kilde: Spectora (`spectora-detaljer.md` linje 74) og målet om få avbrudd.
- **A6:** På ekte iPad simuleres utløpt innlogging med «Logg ut» før flymodus, ikke med kort levetid i testmiljøet. Serveren ser det samme (ingen gyldig økt), det krever ingen endring i testmiljøet og ingen ekstra kode. Kan endres ved å legge inn kort levetid i testmiljøet senere.

## Avgjørelser etter gjennomgangen (prosjektlederen, 30.10.2026)

Rollene var uenige på noen punkter. Slik er det avgjort:

1. **Sjekk når siden åpnes: kuttet** (forenkler). `requireActor()` sender allerede til innlogging når takstmannen har nett. **I stedet** kommer to utløsere fra ux-ansvarlig: overgangen fra «Uten nett» til nett som synkstatusen allerede ser, og `visibilitychange`. Grunn: Safari på iPad sender ikke alltid `online`, og uten dem kan F3 feile. Det er ikke noe nytt tidsur.
2. **Hvordan økten går ut i e2e: begge måter, i hver sin test** (test-leder foran forenkler). Hovedflyten setter `expires_at` på sin egen økt; det er det som skjer ved ekte utløp (kapselen sendes, men gjelder ikke). Admin-testen bruker `clearCookies()`, som er det samme som «Logg ut» i A6. Vakten finnes allerede, så det blir lite ny kode, og vi dekker begge tilfellene uten flere tester. Bare egen økt, aldri admin-økter, fordi testene kjører samtidig.
3. **Én hovedflyt per prosjekt** (forenkler), men med alle sjekkene test-leder og ux-ansvarlig ba om inne i flyten: lukking og ny side, ingenting på serveren før innlogging, 44 px på listen og i skjemaet (bare ipad), «Alt er lagret» uten fast pause. Ingen egen test for «gyldig innlogging gir ingen melding»; det sjekkes i starten av flyten og i Vitest.
4. **`neste` i e2e: beholdt, men bare på pc** (test-leder foran forenkler). Test-leder godkjenner ikke koden uten at begge veiene er dekket. Fire korte saker uten nettbrudd, så det koster lite tid.
5. **Innloggingssiden bruker `neste` også når man allerede er innlogget: beholdt** (test-leder foran forenkler). Siden sender allerede videre i dag (til `/arbeidskoe`); det er én linje å bruke `safeNextPath` der også, og da oppfører de to veiene seg likt. Det hjelper også når takstmannen har logget inn i en annen fane og så trykker «Logg inn».
6. **Egenbygd kandidat i e2e: kuttet** (forenkler). Sjekken ligger i skjermlaget og er lik for alle; kandidatene endres ikke. Resultatmalen for ekte iPad dekker alle kandidatene.
7. **«Høyst én sjekk om gangen» testes i Vitest, ikke e2e.** E2e kan ikke måle sikkert om to kall overlapper. E2e teller at det ikke kommer kall uten nett og ikke på 15 sekunder uten noe som utløser.
8. **`safeNextPath` bruker en fast liste over hele stier**, ikke «begynner med». Spørrestreng og `#` er ikke lov. Da er alle skjeve tilfeller fra test-leder avvist uten egne regler.
9. **401 og 403 fra `get-session` gir `unknown`**, ikke `expired`. Heller ingen melding enn feil melding.

Ingen av disse er fag, pris, personvern eller nye funksjoner, så ingen nye punkter i `docs/09-apne-sporsmal.md`.

## Åpne spørsmål

- Ingen som stopper oppgaven.
