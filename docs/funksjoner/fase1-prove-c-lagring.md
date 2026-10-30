# Funksjon: Prøve C – lagring i Safari

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (prøvemodulen)
- **Status:** utkast (30.10.2026)
- **Branch:** `fase1-prove-c-lagring` (bygger på `main`)
- **Støtter hovedmål:**
  - **Reklamasjoner (hovedsak):** ingenting fra befaringen skal gå tapt i stillhet. Feiler lagringen på iPaden, eller er plassen nesten brukt opp, får takstmannen beskjed med en gang, mens han ennå står på stedet og kan ta bildet eller skrive svaret på nytt.
  - **Tid:** takstmannen slipper å gjøre befaringen om igjen fordi data forsvant, og appen ber selv om varig lagring uten ekstra trykk.
  - **KI først:** se under.

## Problem

Befaringen lagres i Safari på iPaden til den er synket. Safari gir hver nettside en begrenset plass, og kan slette data for nettsider som ikke brukes (sidemannskontrollen del 1 T1 og del 2 P22, `docs/kartlegging/sidemannskontroll-kartlegging-2026-10-25.md` linje 152). I dag skrives en feil ved lagring bare til konsollen (`trial-form-page.tsx`, `setAnswer` og `addPhoto`). Takstmannen ser ingenting, og svaret eller bildet kan være borte når han kommer tilbake til kontoret. Det er en direkte vei til reklamasjoner.

Prøve C (`docs/funksjoner/fase1-testskjema.md`, tabellen «Plan for prøvene») krever: mål hvor mye plass appen får, data overlever omstart og 7 dager uten bruk, og takstmannen får en tydelig melding før noe går tapt når plassen er brukt opp. Det som kan gjøres uten ekte iPad, bygges og testes nå. Kjøringen på ekte iPad gjør Ståle etter resultatmalen når han er tilbake.

## KI først

Ikke i denne oppgaven. Dette er lagringsgrunnlaget som KI-forslag senere bygger på: forslag og bilder som KI skal se på, må ligge trygt på iPaden til de er synket. Appen gjør selv det den kan (måler plassen, ber om varig lagring, varsler), så takstmannen ikke må huske noe av det.

## Brukerhistorier

- Som **takstmann** vil jeg **få beskjed med en gang hvis et svar eller et bilde ikke ble lagret på iPaden**, slik at **jeg kan gjøre det på nytt før jeg forlater stedet**.
- Som **takstmann** vil jeg **få beskjed før plassen på iPaden er brukt opp**, slik at **jeg kan synke eller rydde før noe feiler**.
- Som **Ståle** vil jeg **se hvor mye plass appen får og om lagringen er varig, og krysse av i en resultatmal**, slik at **prøve C kan tas med i sammenligningen og ADR-en**.

## Omfang

**Med:**

1. **Måling av lagring** i én liten fil i prøvemodulen (`src/modules/offline-trial/storage-health.ts`, ren logikk uten React):
   - `readStorageHealth()` leser `navigator.storage.estimate()` (`usage`, `quota`) og `navigator.storage.persisted()`. Mangler API-et, blir svaret «ikke støttet», aldri en feil som stopper siden.
   - `requestPersistentStorage()` kaller `navigator.storage.persist()` **automatisk én gang** når en prøveside åpnes (ingen knapp, null trykk), og bare hvis `persisted()` er `false`. Svaret (ja / nei / ikke støttet) vises.
   - En ren funksjon `storageLevel({ usage, quota })` gir `ok`, `low` (nesten full) eller `unknown`. **`low` når ledig plass (`quota - usage`) er under 500 MB.** Grensen står i én konstant (`LOW_STORAGE_FREE_BYTES`) med begrunnelse i kommentar. `unknown` når tallene mangler.
2. **Visning i prøvesidene:**
   - **Listen** `/prove/testskjema`: en liten boks «Lagring på denne iPaden» med brukt plass og plassen appen får (i MB, avrundet), og «Varig lagring: ja / nei / ikke støttet». Oppdateres når siden åpnes og når man trykker «Mål på nytt» (eneste knapp, for prøven på ekte iPad).
   - **Skjemaet** `/prove/testskjema/[id]`: ingen tall. Bare varselet i pkt. 3 når plassen er nesten brukt opp.
   - Faste markører for testene: `data-storage-level="ok|low|unknown"` og `data-storage-persisted="yes|no|unsupported"`. Testene leser markørene, ikke norsk tekst.
3. **Varsel når plassen nesten er brukt opp:** i den faste linjen øverst i skjemaet (ved synkstatusen), med `role="status"`. Tekst (egen, kort): «Lite plass igjen på iPaden. Synk med nett så snart du kan, før du tar flere bilder.» Plassen måles når skjemaet åpnes, før hvert bilde lagres, og etter hver feil. Varselet sperrer ingenting.
4. **Melding når lagring feiler** (ingenting går tapt i stillhet):
   - Feiler `setAnswer` eller `addPhoto`, vises en melding med `role="alert"` i den faste linjen øverst, som blir stående til takstmannen lukker den eller lagringen lykkes. Den sier hva som ikke ble lagret, med feltets navn fra testskjemaet:
     - svar: «Svaret i «<feltnavn>» ble ikke lagret på iPaden. Lukk ikke appen. Trykk «Prøv igjen».»
     - bilde: «Bildet i «<feltnavn>» ble ikke lagret på iPaden. Ta bildet på nytt når det er plass.»
     - Er feilen `QuotaExceededError` (eller tilsvarende navn), legges til: «Plassen på iPaden er brukt opp.»
   - **«Prøv igjen»** gjelder bare svar: skriver de svarene som ikke er lagret, på nytt fra det som står i skjemaet. Verdien blir stående i feltet hele tiden.
   - Feltet beholder markeringen «ikke lagret» til skrivingen lykkes (bruker `pending`/`written` som finnes i `trial-form-page.tsx`).
   - Loggen viser bare feilnavn og feilmelding, aldri svaret eller bildet (som i PR #26 og #28).
   - Gjelder alle tre kandidatene, fordi feilen fanges i skjermen og ikke i kandidatene.
5. **Testkrok for e2e** (bare med `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1`, som i dag): mulighet til å overstyre svaret fra `estimate()` (for å få `low`) og til å la neste lagring feile med `QuotaExceededError`. Ingen ny tilstand i produksjonskoden utenom kroken.
6. **Tester:**
   - **Vitest:** `storageLevel` (under, på og over grensen, tomme tall), `readStorageHealth` og `requestPersistentStorage` med og uten API (falsk `navigator.storage`), at meldingene ikke inneholder svar eller bildedata, og at loggen bare viser navn og melding.
   - **Playwright (PC og iPad-størrelse), Chromium:**
     - Boksen på listen viser tall og `data-storage-persisted` (Chromium støtter API-ene).
     - Data overlever lukking: fyll ut svar og ett bilde uten nett, lukk siden, åpne ny side i samme nettleserkontekst uten nett, alt står der. (Ekte omstart og 7 dager kan ikke testes i nettleser; det står i resultatmalen.)
     - Overstyrt `estimate` gir varselet i pkt. 3 i skjemaet.
     - Lagring som feiler med `QuotaExceededError` gir meldingen i pkt. 4 med riktig feltnavn, verdien står i feltet, «Prøv igjen» lagrer når feilen er borte, og meldingen forsvinner. Én test for bilde.
     - Kjøres for standardkandidaten (PowerSync). Én test per kandidat for feilmeldingen ved svar, bare i pc-prosjektet, siden feilen fanges utenfor kandidatene.
7. **Resultatmal for prøven på ekte iPad:** `docs/funksjoner/fase1-prove-c-lagring-resultat.md`. Trinn for Ståle, med avkryssing og felt for tall:
   - iPad-modell, iPadOS- og Safari-versjon, ledig plass på iPaden (Innstillinger), appen lagt på hjemskjermen.
   - **C1 Plass:** les tallene i boksen (brukt, plassen appen får, varig lagring), før og etter 200 bilder.
   - **C2 Omstart:** fyll ut og ta 20 bilder i flymodus, lukk appen helt, start iPaden på nytt, åpne. Alt står der.
   - **C3 7 dager:** la iPaden ligge 7 dager uten å åpne appen (nettet kan være på), åpne i flymodus. Alt står der. Samme prøve med appen åpnet i Safari, ikke fra hjemskjermen, for å se forskjellen.
   - **C4 Full:** ta bilder uten nett til varselet «Lite plass igjen» kommer, og videre til lagringen feiler. Noter antall bilder ved varsel og ved feil, at meldingen kom, og at alt som ble lagret før feilen, synkes når nettet kommer. Ingenting skal mangle uten at det kom en melding.
   - Hver del kjøres per kandidat (samme som prøve A og B), med bestått / delvis / ikke bestått.
8. Versjon i `package.json` økes (patch). Ordlisten oppdateres (se «Data»).

**Ikke med (bevisst utelatt):**

- Rydding av gamle oppdrag på iPaden («fjernes lokalt N dager etter levering», P22). Det hører til befaringen i fase 2b.
- Regel om hvor mange oppdrag som kan ligge lokalt samtidig (P22). Fase 2b.
- Sperre mot å ta bilder når plassen er lav. Bare varsel; takstmannen bestemmer.
- Krav om hjemskjerm (sperre i Safari uten hjemskjerm). Prøve C måler forskjellen først; kravet avgjøres i ADR-en.
- Komprimering, rotering og HEIC (prøve D).
- Endringer i de tre kandidatene sin lagring, synk eller bildekø. Feilene fanges i skjermen.
- Varsel til kontoret eller serveren om lav plass. Ingen ny rute, ingen migrering, ingen ny tabell.
- Egen side for lagring, eller tall i skjemaet. Bare boksen på listen og varselet i skjemaet.
- Ekte omstart og 7 dager i automatiske tester (går ikke i nettleser). Dekkes av resultatmalen.
- Safari/WebKit i Playwright. Prosjektene kjører Chromium i dag; en ny nettlesermotor er ny avhengighet i CI og tas ikke med.
- Nye avhengigheter.

## Tilgang

| Rolle | Se lagringsboksen og varslene | Endre |
|---|---|---|
| takstmann | ja (i prøvesidene) | – |
| kontor | ja | – |
| leder | ja | – |
| admin | ja | – |

Bare nettleser-API-er på egen enhet. Ingen ny rute og ingen spørring, så `expectTenantIsolation` trengs ikke. Prøvesidene har tilgangssjekken de har i dag; den endres ikke.

## Data

Ingen nye tabeller eller felter. Ingen faste koder i datamodellen. Markørverdiene `ok`, `low`, `unknown` og `yes`, `no`, `unsupported` er bare for testene.

Ordlisten i `docs/05-domenemodell.md` avsnitt 8 får:

- **lagringsstatus** → `storage health` (plass brukt, plass appen får, varig lagring)
- **varig lagring** → `persistent storage` (`navigator.storage.persist()`: nettleseren lover å ikke slette dataene av seg selv)
- **lite plass** → `low storage` (ledig plass under grensen)

## Skjermer

- **Listen** `/prove/testskjema` (iPad og PC): ny liten boks under velgeren for synkløsning. Null ekstra trykk for å se tallene; ett trykk for «Mål på nytt».
- **Skjemaet** `/prove/testskjema/[id]`: varselet og feilmeldingen i den faste linjen øverst. Null ekstra trykk. «Prøv igjen» er ett trykk, minst 44 px.
- Følger designprinsippene («Fjord»). Ingen nye farger utover dagens advarsel og feil.

## Regler

Ingen fagregler. Grensen for «lite plass» er en teknisk innstilling (konstant med testsaker i Vitest), ikke fag.

## Akseptkriterier

- [ ] `storageLevel` gir `low` når ledig plass er under 500 MB, `ok` på og over, `unknown` uten tall (Vitest).
- [ ] Uten `navigator.storage` viser boksen «ikke støttet», og siden virker som før (Vitest).
- [ ] `persist()` kalles automatisk én gang når en prøveside åpnes, bare hvis `persisted()` er `false` (Vitest).
- [ ] Listen viser brukt plass, plassen appen får og varig lagring, med markørene (Playwright, PC og iPad).
- [ ] Svar og bilde lagret uten nett finnes etter at siden er lukket og åpnet på nytt uten nett (Playwright).
- [ ] Overstyrt `estimate` med lite ledig plass gir varselet i skjemaet, og ingenting sperres (Playwright).
- [ ] Lagring som feiler gir melding med feltnavn og `role="alert"`, verdien står i feltet, «Prøv igjen» lagrer og fjerner meldingen (Playwright). Bilde som feiler gir egen melding.
- [ ] Ved `QuotaExceededError` sier meldingen at plassen er brukt opp.
- [ ] Feilmeldingen ved svar virker for alle tre kandidatene (Playwright, pc).
- [ ] Loggen ved feil viser bare feilnavn og melding, aldri svar eller bildedata (Vitest).
- [ ] Ingen nye avhengigheter, ingen ny rute, ingen migrering.
- [ ] Resultatmalen `docs/funksjoner/fase1-prove-c-lagring-resultat.md` finnes med C1–C4 per kandidat.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjonen er økt.
- [ ] Planpunktet «Prøve C» krysses av når PR-en er åpnet, med merknad om at prøven på ekte iPad gjenstår.

## Avgjort av agentene (autonom modus, ført i `docs/09-apne-sporsmal.md`)

- **Grensen for «lite plass» er 500 MB ledig.** Researchen sier 100–300 bilder per befaring (sidemannskontrollen del 1 T1). Med ca. 1,5–2 MB per bilde etter komprimering er 300 bilder ca. 450–600 MB, så 500 MB gir varsel mens det ennå er plass til en befaring. Endres i én konstant.
- **Appen ber om varig lagring automatisk**, uten knapp. Færre trykk (tid), og takstmannen skal ikke måtte forstå hva det betyr.
- **Bare varsel, ingen sperre, ved lite plass.** Samme prinsipp som sidemannskontrollen (advarsel, aldri sperre, Ståle 27.10.2026). Takstmannen bestemmer.
- **7 dager uten bruk** i resultatmalen, som i planen for prøvene (`fase1-testskjema.md`). Safari kan slette data for nettsider som ikke er brukt på 7 dager; derfor prøves både hjemskjerm og vanlig Safari.

## Åpne spørsmål

- Ingen som stopper oppgaven. Om EzProp skal **kreve** hjemskjerm, avgjøres i ADR-en etter prøve C på ekte iPad.

## Roller

- **utvikler** (bit 1): `storage-health.ts`, boksen på listen, varselet og feilmeldingen i skjemaet, testkroken.
- **testskriver** (bit 2, parallelt): Vitest for `storage-health.ts` og loggen, Playwright-testene i pkt. 6, og resultatmalen. Avtalt grensesnitt: funksjonsnavnene i pkt. 1, markørene i pkt. 2 og testkroken i pkt. 5.
- **ux-ansvarlig:** kort sjekk av tekstene i varselet og feilmeldingen, og plasseringen i den faste linjen (takstmannen står med iPaden i én hånd).
- **test-leder:** testplan og godkjenning.

Ikke med: arkitekt (ingen ny modul, rute eller tabell), UI-designer (bruker dagens advarsel- og feilstil), fagansvarlig (ingen fagtekst), KI-ansvarlig, sikkerhet-personvern (ingen ny rute og ingen nye data; loggregelen dekkes av test-leder).
