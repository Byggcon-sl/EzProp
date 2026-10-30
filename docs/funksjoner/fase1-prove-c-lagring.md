# Funksjon: Prøve C – lagring i Safari

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (prøvemodulen)
- **Status:** klar til bygging (30.10.2026, etter gjennomgang av forenkler, ux-ansvarlig og test-leder)
- **Branch:** `fase1-prove-c-lagring` (bygger på `main`)
- **Støtter hovedmål:**
  - **Reklamasjoner (hovedsak):** ingenting fra befaringen skal gå tapt i stillhet. Feiler lagringen på iPaden, eller er plassen nesten brukt opp, får takstmannen beskjed med en gang, mens han ennå står på stedet og kan ta bildet eller skrive svaret på nytt.
  - **Tid:** takstmannen slipper å gjøre befaringen om igjen (ca. 1–3 timer) fordi data forsvant. Appen ber selv om varig lagring og prøver selv å lagre på nytt, uten ekstra trykk.
  - **KI først:** se under.

## Problem

Befaringen lagres i Safari på iPaden til den er synket. Safari gir hver nettside en begrenset plass, og kan slette data for nettsider som ikke brukes (sidemannskontrollen del 1 T1 og del 2 P22, `docs/kartlegging/sidemannskontroll-kartlegging-2026-10-25.md` linje 152). I dag skrives en feil ved lagring bare til konsollen (`trial-form-page.tsx`, `setAnswer` og `addPhoto`, linje 96 og 119, med hele feilobjektet). Takstmannen ser ingenting, og svaret eller bildet kan være borte når han kommer tilbake til kontoret. Det er en direkte vei til reklamasjoner.

Prøve C (`docs/funksjoner/fase1-testskjema.md`, tabellen «Plan for prøvene») krever: mål hvor mye plass appen får, data overlever omstart og 7 dager uten bruk, og takstmannen får en tydelig melding før noe går tapt når plassen er brukt opp. Det som kan gjøres uten ekte iPad, bygges og testes nå. Kjøringen på ekte iPad gjør Ståle etter resultatmalen når han er tilbake.

## KI først

Ikke i denne oppgaven. Dette er lagringsgrunnlaget som KI-forslag senere bygger på: forslag og bilder som KI skal se på, må ligge trygt på iPaden til de er synket. Appen gjør selv det den kan (måler plassen, ber om varig lagring, prøver å lagre på nytt, varsler), så takstmannen ikke må huske noe av det.

## Brukerhistorier

- Som **takstmann** vil jeg **få beskjed med en gang hvis et svar eller et bilde ikke ble lagret på iPaden**, slik at **jeg kan gjøre det på nytt før jeg forlater stedet**.
- Som **takstmann** vil jeg **få beskjed før plassen på iPaden er brukt opp**, slik at **jeg kan synke før noe feiler**.
- Som **Ståle** vil jeg **se hvor mye plass appen får og om lagringen er varig, og krysse av i en resultatmal**, slik at **prøve C kan tas med i sammenligningen og ADR-en**.

## Flyt (skjemaet, iPad)

```
[Synkstatus | Lite plass (role=status)                          ]  <- fast linje øverst
[Feil: Svaret i «X» ble ikke lagret … [Prøv igjen] [Lukk] (role=alert)]
  felt ... felt X (merket «ikke lagret») ... bildefelt
```

Vanlig befaring: plassen måles og varig lagring bes om automatisk. Null ekstra trykk.

## Omfang

**Med:**

1. **Måling og tekster** i én fil i prøvemodulen, `src/modules/offline-trial/storage-health.ts`. Bare rene funksjoner uten React, så alt kan testes i Vitest (som ikke har jsdom):
   - `readStorageHealth()` leser `navigator.storage.estimate()` (`usage`, `quota`) og `navigator.storage.persisted()`. Mangler `navigator.storage`, mangler `persisted()`, eller kaster `estimate()`, blir svaret `persisted: "unsupported"` og/eller nivå `unknown`. Funksjonen kaster aldri videre.
   - `requestPersistentStorage()` kaller `navigator.storage.persist()` **automatisk** når en prøveside åpnes (ingen knapp, null trykk), og bare hvis `persisted()` er `false`. **«Én gang» betyr én gang per sideinnlasting:** en vakt i modulen gjør at to kall (for eksempel når React kjører effekter to ganger) gir ett `persist()`. Vakten kan nullstilles i testene (eksportert `resetPersistRequestForTests()`). Svaret er `yes`, `no` eller `unsupported`.
   - `storageLevel({ usage, quota })` gir `ok`, `low` eller `unknown`. **`low` når ledig plass (`quota - usage`) er under 500 MB**, `ok` på og over. `unknown` når `usage` eller `quota` mangler, eller `quota` er 0. Grensen står i konstanten `LOW_STORAGE_FREE_BYTES` (500 × 1024 × 1024) med begrunnelse i kommentar.
   - `storageHealthText(health)` gir teksten i boksen på listen (MB-tall, «Varig lagring: ja / nei / ikke støttet»).
   - `isQuotaError(error)` gjenkjenner full plass: `name` er `QuotaExceededError` eller `NS_ERROR_DOM_QUOTA_REACHED`, eller `DOMException` med `code` 22.
   - `storageErrorMessage(failures)` lager den ene feilmeldingen (pkt. 4) ut fra listen over feil (art `answer`/`photo`, feltnavn, feil). Meldingen inneholder aldri svaret eller bildet.
   - `storageErrorLog(error)` gir bare `{ name, message }`. Svar og bildedata kommer ikke med selv om de ligger på feilobjektet. En feil som ikke er en `Error`, gir «ukjent feil».
2. **Visning i prøvesidene:**
   - **Listen** `/prove/testskjema`: en liten boks «Lagring på denne iPaden» under velgeren for synkløsning, med brukt plass og plassen appen får (MB, avrundet) og varig lagring. Måles når siden åpnes. **Ingen knapp «Mål på nytt»:** å laste siden på nytt måler på nytt, og det holder for C1 (før og etter bildene).
   - **Skjemaet** `/prove/testskjema/[id]`: ingen tall. Bare varselet i pkt. 3 og feilmeldingen i pkt. 4.
   - Faste markører for testene: `data-storage-level="ok|low|unknown"` og `data-storage-persisted="yes|no|unsupported"` på boksen og i skjemaet, og `data-field-saved="yes|no"` på hvert felt (også bildefelt). Testene leser markørene, ikke norsk tekst.
3. **Varsel når plassen nesten er brukt opp:** i den faste linjen øverst i skjemaet (ved synkstatusen), med `role="status"`. Tekst: «Lite plass igjen på iPaden. Synk med nett så snart du kan.» Plassen måles når skjemaet åpnes, før hvert bilde lagres, og etter hver feil. Varselet sperrer ingenting.
4. **Melding når lagring feiler** (ingenting går tapt i stillhet):
   - Feiler `setAnswer` eller `addPhoto`, vises **én** melding med `role="alert"` i den faste linjen øverst. Feiler flere ting, samles de i den samme meldingen, så linjen ikke vokser og dekker feltet han skriver i.
     - ett svar: «Svaret i «<feltnavn>» ble ikke lagret på iPaden. Lukk ikke appen. Trykk «Prøv igjen».»
     - flere svar: «<antall> svar ble ikke lagret på iPaden, sist «<feltnavn>». Lukk ikke appen. Trykk «Prøv igjen».»
     - bilde: «Bildet i «<feltnavn>» ble ikke lagret på iPaden. Ta bildet på nytt.» (Ingen «Prøv igjen», fordi bildet ikke finnes lenger.)
     - Er svar og bilder blandet, nevnes begge kort i samme melding.
     - Er feilen full plass (`isQuotaError`), legges til: «Plassen på iPaden er brukt opp.»
   - **Prøv igjen automatisk:** svar som ikke er lagret, forsøkes lagret på nytt neste gang et annet svar lagres uten feil. Lykkes det, forsvinner meldingen uten trykk. Bruker `pending`/`written` som finnes i `trial-form-page.tsx`; ingen ny tilstand.
   - **«Prøv igjen»** (reserve, bare når meldingen gjelder svar) skriver svarene som ikke er lagret, på nytt fra det som står i skjemaet. Verdien blir stående i feltet hele tiden.
   - **Når meldingen forsvinner:** når alle feltene i meldingen er lagret (automatisk eller med «Prøv igjen»), eller når takstmannen trykker «Lukk». At et annet felt lagres, er ikke nok. Feiler bare bilder, blir meldingen stående til den lukkes eller et nytt bilde er lagret i det feltet.
   - **Merket «ikke lagret»:** feltet (også bildefeltet) har `data-field-saved="no"` og et synlig merke «ikke lagret» til svaret eller et nytt bilde er lagret. Merket blir stående selv om meldingen lukkes, så han finner feltet igjen.
   - «Prøv igjen» og «Lukk» er begge minst 44 pt høye med minst 8 pt mellom. Plassering øverst er greit fordi dette er en sjelden statusmelding.
   - Loggen bruker `storageErrorLog` begge steder i `trial-form-page.tsx` (i dag linje 96 og 119), og i `trial-sync-provider.tsx` linje 80 (lagringen kan ikke åpnes). Aldri svaret eller bildet i loggen.
   - Feilen fanges i skjermen (rundt `store.setAnswer` og `store.addPhoto`), ikke i kandidatene, så det virker likt for alle tre.
5. **Testkrok for e2e** (bare med `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1`, som i dag), i skjermlaget, ikke i kandidatene:
   - **Overstyrt `estimate`** leses fra en global verdi som kan settes med `page.addInitScript` før siden lastes (gjelder fra første måling), og kan endres etter at siden er åpnet (neste måling, for eksempel før et bilde, bruker den nye verdien).
   - **Feil ved lagring slås på og av:** «feil til den slås av», ikke bare neste lagring. Feilen er en `DOMException` med navnet `QuotaExceededError`, og gjelder svar, bilder eller begge.
   - **Avtalt grensesnitt:** et eget globalt objekt `window.__offlineTrialStorage = { estimate?: { usage: number; quota: number }; fail?: "answer" | "photo" | "both" | null }`. Det er eget fordi dagens `window.__offlineTrial` først settes når lagringen er åpnet, for sent for `addInitScript`. Skjermlaget leser objektet ved hver måling og hver lagring, bare når miljøvariabelen er satt.
   - Ingen ny tilstand i produksjonskoden utenom kroken.
6. **Tester:** se «Testplan» under.
7. **Resultatmal for prøven på ekte iPad:** `docs/funksjoner/fase1-prove-c-lagring-resultat.md`. Trinn for Ståle, med avkryssing og felt for tall:
   - iPad-modell, iPadOS- og Safari-versjon, ledig plass på iPaden (Innstillinger), appen lagt på hjemskjermen.
   - **C1 Plass:** les tallene i boksen på listen (brukt, plassen appen får, varig lagring) før og etter de 200 bildene i prøve A. Ingen egen runde med bilder.
   - **C2 Omstart:** fyll ut og ta 20 bilder i flymodus, lukk appen helt, start iPaden på nytt, åpne. Alt står der.
   - **C3 7 dager:** fyll ut i alle tre kandidatene samme dag, la iPaden ligge 7 dager uten å åpne appen (nettet kan være på), åpne i flymodus og sjekk alle tre. Ikke tre runder etter hverandre. Går ikke det, holder det med standardkandidaten (PowerSync). Prøven i vanlig Safari (uten hjemskjerm) er **valgfri**; planen sier allerede at appen må ligge på hjemskjermen.
   - **C4 Full:** ta bilder uten nett til varselet «Lite plass igjen» kommer, og videre til lagringen feiler. Noter antall bilder ved varsel og ved feil, at meldingen kom, og at alt som ble lagret før feilen, synkes når nettet kommer. Ingenting skal mangle uten at det kom en melding. Merk: synk frigjør ikke plass på iPaden i prøven; lokal rydding kommer i fase 2b.
   - Hver del per kandidat, med bestått / delvis / ikke bestått.
   - Det står i malen at ekte omstart og 7 dager ikke kan testes automatisk.
8. Versjon i `package.json` økes (patch). Ordlisten oppdateres (se «Data»).

**Ikke med (bevisst utelatt):**

- Rydding av gamle oppdrag på iPaden («fjernes lokalt N dager etter levering», P22). Det hører til befaringen i fase 2b.
- Regel om hvor mange oppdrag som kan ligge lokalt samtidig (P22). Fase 2b.
- Sperre mot å ta bilder når plassen er lav. Bare varsel; takstmannen bestemmer.
- Sperre i Safari uten hjemskjerm. Planen sier at appen må ligge på hjemskjermen (risikotabellen i `docs/07-utviklingsplan.md`); hvordan det håndheves, hører til «Oppsett av iPadene» i fase 2b.
- Knappen «Mål på nytt» (ny innlasting måler på nytt).
- Komprimering, rotering og HEIC (prøve D).
- Endringer i de tre kandidatene sin lagring, synk eller bildekø. Feilene fanges i skjermen.
- Varsel til kontoret eller serveren om lav plass. Ingen ny rute, ingen migrering, ingen ny tabell.
- Egen side for lagring, eller tall i skjemaet.
- Ekte omstart og 7 dager i automatiske tester (går ikke i nettleser). Dekkes av resultatmalen.
- Safari/WebKit i Playwright. Prosjektene kjører Chromium i dag; en ny nettlesermotor er ny avhengighet i CI og tas ikke med.
- Nye avhengigheter (heller ikke jsdom).

## Tilgang

| Rolle | Se lagringsboksen og varslene | Endre |
|---|---|---|
| takstmann | ja (i prøvesidene) | – |
| kontor | ja | – |
| leder | ja | – |
| admin | ja | – |

Bare nettleser-API-er på egen enhet. Ingen ny rute og ingen spørring, så `expectTenantIsolation` trengs ikke. Det godtas bare hvis `git diff` viser at ingenting i `src/db`, `src/app/api` eller `server/` er endret. Prøvesidene har tilgangssjekken de har i dag; den endres ikke. Myk sletting gjelder ikke (ingen nye data).

## Data

Ingen nye tabeller eller felter. Ingen faste koder i datamodellen. Markørverdiene er bare for testene.

Ordlisten i `docs/05-domenemodell.md` avsnitt 8 får:

- **lagringsstatus** → `storage health` (plass brukt, plass appen får, varig lagring)
- **varig lagring** → `persistent storage` (`navigator.storage.persist()`: nettleseren lover å ikke slette dataene av seg selv)
- **lite plass** → `low storage` (ledig plass under grensen)

## Skjermer

- **Listen** `/prove/testskjema` (iPad og PC): ny liten boks under velgeren for synkløsning. Null trykk.
- **Skjemaet** `/prove/testskjema/[id]`: varselet og feilmeldingen i den faste linjen øverst. Null ekstra trykk i vanlig flyt. Svar som feiler: 0 trykk hvis neste lagring lykkes, ellers 1 trykk («Prøv igjen», ca. 5 sekunder). Bilde som feiler: lukke, finne feltet med merket, ta bildet (ca. 3–4 trykk, 20 sekunder). I dag oppdages tapet først på kontoret.
- Følger designprinsippene («Fjord»). Ingen nye farger utover dagens advarsel og feil.

## Regler

Ingen fagregler. Grensen for «lite plass» er en teknisk innstilling (konstant med testsaker i Vitest), ikke fag.

## Testplan

**Vitest, `src/modules/offline-trial/storage-health.test.ts`** (falsk `navigator.storage` via `globalThis`):

- `storageLevel`: 499,99 MB ledig gir `low`, nøyaktig 500 MB gir `ok`, 2 GB gir `ok`, `usage` eller `quota` mangler gir `unknown`, `quota` 0 gir `unknown`.
- `readStorageHealth`: fullt API, API uten `persisted()`, uten `navigator.storage`, og `estimate()` som kaster. Ingen kaster videre.
- `storageHealthText`: «ikke støttet» uten API.
- `requestPersistentStorage`: kalles når `persisted()` er `false`, ikke når `true`, bare én gang ved to kall, `unsupported` uten API, `persist()` = `false` gir `no`.
- `isQuotaError`: `QuotaExceededError`, `code` 22 og `NS_ERROR_DOM_QUOTA_REACHED` gir ja; andre feil nei.
- `storageErrorMessage`: riktig feltnavn for svar og bilde, samlet melding med antall og siste feltnavn, «Plassen på iPaden er brukt opp.» bare ved full plass, aldri verdien.
- `storageErrorLog`: bare navn og melding; svar og bildedata på feilobjektet kommer ikke med; ikke-`Error` gir «ukjent feil».

**Playwright, `e2e/fase-1-prove-c-lagring.spec.ts`** (pc og ipad, Chromium, standardkandidaten PowerSync):

- Boksen på listen viser MB-tall og `data-storage-level="ok"`. `data-storage-persisted` er `yes` eller `no` (Chromium uten skjerm svarer ofte `no`).
- Uten `navigator.storage` (`addInitScript`): boksen har `data-storage-persisted="unsupported"` og `data-storage-level="unknown"`, og skjemaet kan fortsatt fylles ut.
- Data overlever lukking: svar og ett bilde lagres uten nett, siden lukkes, ny side i samme kontekst uten nett, alt står der.
- Overstyrt `estimate` (100 MB ledig, via `addInitScript`) gir varselet med `role="status"`. Svar og bilde kan fortsatt lagres.
- Lite plass oppdaget ved bilde: overstyringen endres etter at skjemaet er åpnet; varselet kommer når man tar et bilde, uten ny innlasting.
- Svar som feiler: `role="alert"`, riktig feltnavn, teksten om full plass, verdien står i feltet, `data-field-saved="no"`. Feil i et felt til, så samles det i én melding med antall. Feilen slås av, «Prøv igjen», meldingen forsvinner, `data-field-saved="yes"`, og svarene står der etter ny innlasting. «Prøv igjen» og «Lukk» er minst 44 px på ipad.
- Prøv igjen automatisk: feilen slås av, et annet felt lagres, meldingen forsvinner uten trykk og det feilede feltet er lagret.
- «Lukk» fjerner meldingen, men `data-field-saved="no"` blir stående til feltet er lagret.
- Bilde som feiler: egen melding med feltnavn, ingen «Prøv igjen», bildefeltet har `data-field-saved="no"` til et nytt bilde er lagret.
- Tilgang: dagens test «uinnlogget sendes til innlogging» dekker prøvesidene. I tillegg én test der en takstmann (ikke admin) ser boksen. Admin brukes i resten.

## Akseptkriterier

- [ ] `storageLevel` gir `low` under 500 MB ledig, `ok` på og over, `unknown` uten tall eller med `quota` 0 (Vitest).
- [ ] Uten `navigator.storage` gir `readStorageHealth` `unsupported`/`unknown` og `storageHealthText` «ikke støttet» (Vitest); boksen har markørene og skjemaet virker (Playwright).
- [ ] `persist()` kalles én gang per sideinnlasting, bare hvis `persisted()` er `false` (Vitest).
- [ ] Listen viser brukt plass, plassen appen får og varig lagring, med markørene (Playwright, PC og iPad).
- [ ] Svar og bilde lagret uten nett finnes etter at siden er lukket og åpnet på nytt uten nett (Playwright).
- [ ] Lite ledig plass gir varselet i skjemaet ved åpning og ved bilde, og ingenting sperres (Playwright).
- [ ] Lagring som feiler gir **én** melding med feltnavn og `role="alert"`; flere feil samles i den samme meldingen. Verdien står i feltet, feltet har `data-field-saved="no"` (Playwright).
- [ ] Meldingen forsvinner når de feilede feltene er lagret (automatisk ved neste vellykkede lagring, eller med «Prøv igjen»), eller når den lukkes; ikke når et annet felt lagres og det feilede fortsatt mangler (Playwright).
- [ ] Bilde som feiler gir egen melding uten «Prøv igjen», og bildefeltet er merket «ikke lagret» (Playwright).
- [ ] Ved full plass sier meldingen at plassen er brukt opp (Vitest og Playwright).
- [ ] «Prøv igjen» og «Lukk» er minst 44 pt med minst 8 pt mellom.
- [ ] Loggen ved feil (to steder i `trial-form-page.tsx` og ett i `trial-sync-provider.tsx`) viser bare feilnavnet, aldri meldingen fra lagringen (Vitest for `storageErrorLog`).
- [ ] Ingen nye avhengigheter, ingen ny rute, ingen migrering; ingenting endret i `src/db`, `src/app/api` eller `server/`.
- [ ] Resultatmalen finnes med C1–C4 per kandidat, bestått / delvis / ikke bestått, og sier at ekte omstart og 7 dager ikke kan testes automatisk.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjonen er økt.
- [ ] Planpunktet «Prøve C» krysses av når PR-en er åpnet, med merknad om at prøven på ekte iPad gjenstår.

## Avgjort av agentene (autonom modus, ført i `docs/09-apne-sporsmal.md`)

- **Grensen for «lite plass» er 500 MB ledig** (A1). 100–300 bilder per befaring (sidemannskontrollen del 1 T1), ca. 1,5–2 MB per bilde. Endres i én konstant.
- **Appen ber om varig lagring automatisk**, uten knapp (A2).
- **Bare varsel, ingen sperre, ved lite plass.** Advarsel, aldri sperre, som for sidemannskontrollen (Ståle 27.10.2026).
- **7 dager uten bruk med appen på hjemskjermen** (A3, rettet). Planen sier at appen må ligge på hjemskjermen; prøven i vanlig Safari er valgfri.
- **Svar som ikke er lagret, prøves på nytt automatisk** ved neste vellykkede lagring (A4). Mindre tid, og ingenting blir liggende ulagret fordi takstmannen ikke så meldingen.

## Avgjørelser ved gjennomgangen (prosjektlederen, 30.10.2026)

- **«Mål på nytt» fjernes** (forenkler 1). Ny innlasting måler på nytt. Test-lederens test av knappen utgår.
- **Én Playwright-test for feilmeldingen, ikke én per kandidat** (forenkler 2 mot test-leder). Feilen settes inn i skjermlaget og fanges der, så tre tester ville prøve den samme koden. Kandidatenes egen lagring prøves allerede i prøve A og B.
- **C1 bruker bildene fra prøve A, C3 kjører kandidatene samtidig, vanlig Safari er valgfritt** (forenkler 3–5). Halvparten av arbeidet på iPaden; planen avgjør allerede hjemskjermkravet.
- **Tekstene og samlet melding** som ux-ansvarlig foreslo (1–4, 6). Synk frigjør ikke plass før fase 2b, så teksten lover ikke det.
- **Prøv igjen automatisk** (ux 5), sammen med test-lederens krav om at meldingen bare forsvinner når de feilede feltene faktisk er lagret.
- **Lagringen som ikke åpnes** (ux 7): `trial-sync-provider.tsx` viser allerede en melding med `role="alert"` (linje 97). Bare loggen endres til `storageErrorLog`. Teksten beholdes.
- **Test-lederens punkter 1–6** tas inn: rene funksjoner for tekst og logg, testkrok via `addInitScript` og på/av, «én gang per sideinnlasting» med nullstilling, `data-field-saved`, og hvilken lagring som fjerner meldingen.

## Åpne spørsmål

- Ingen som stopper oppgaven.

## Roller

- **utvikler** (bit 1): `storage-health.ts`, boksen på listen, varselet, feilmeldingen og merket i skjemaet, automatisk ny lagring, loggen, testkroken.
- **testskriver** (bit 2, parallelt): Vitest og Playwright etter testplanen, og resultatmalen. Avtalt grensesnitt: funksjonsnavnene i pkt. 1, markørene i pkt. 2 og testkroken i pkt. 5.
- **test-leder:** godkjenning etter testplanen.

Ikke med: arkitekt (ingen ny modul, rute eller tabell), UI-designer (bruker dagens advarsel- og feilstil), fagansvarlig (ingen fagtekst), KI-ansvarlig, sikkerhet-personvern (ingen ny rute og ingen nye data; loggregelen dekkes av test-leder).
