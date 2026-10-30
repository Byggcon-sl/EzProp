# Testplan: Småfunn fra prøve C (liten oppgave f)

- **Oppgavekort:** `docs/agenter/oppgaver/fase1-smafunn-prove-c.md`
- **Fase:** 1 – Prøve uten nett
- **Branch:** `fase1-smafunn-prove-c` (bygger på `main`)
- **Laget av:** test-leder, 30.10.2026 (før koding)
- **Støtter hovedmål:** Reklamasjoner: loggen kan ikke vise det takstmannen skrev, og testen for åpning uten nett blir rød når data ikke overlever. Tid: færre doble tester gir kortere testkjøring. KI først: indirekte (ærlige prøver er grunnlaget for synkvalget).

## Tilgang, tenant-isolasjon, admin, myk sletting

- **Ingen nye spørringer, ingen ny tilgangslogikk.** Ingen ny `expectTenantIsolation` trengs. Akseptkriteriet «annen organisasjon» er ikke relevant.
- **Tilgang per rolle beholdes i e2e:** takstmann ser boksen (E1 under, flettet sammen med testen med ekte tall). Admin brukes i resten av filen, så admin er fortsatt dekket.
- **Myk sletting:** ikke berørt.

## Regeltester

Ingen. Ingen regler eller TG-logikk endres.

## 1. Enhetstester: `src/modules/offline-trial/storage-health.test.ts` (utvikler, punkt 1 og 6)

| # | Testnavn | Hva den viser |
|---|---|---|
| U1 | «storageErrorLog gir bare navnet» | `storageErrorLog(new DOMException("x", "QuotaExceededError"))` er `toStrictEqual({ name: "QuotaExceededError" })`. Ingen `message`-nøkkel. |
| U2 | «storageErrorLog tar ikke med svarverdien fra meldingen» (obligatorisk) | `new Error(SECRET_ANSWER)` med `value`, `file`, `blob` og `cause` som har svaret: resultatet er `{ name: "Error" }`, og `JSON.stringify` av det har verken `SECRET_ANSWER` eller `SECRET_PHOTO`. Erstatter dagens test «tar ikke med svar eller bildedata». |
| U3 | «storageErrorLog for noe som ikke er Error: %s» | Samme tre saker som i dag; resultatet er `{ name: "ukjent feil" }`. |
| U4 | «isQuotaError gjenkjenner full plass: %s» | Saken «DOMException med code 22» og konstanten `code22` slettes. De to andre sakene står igjen. |
| U5 | «isQuotaError avviser andre feil: %s» | Uendret. Alle saker gir samme svar som før. |

**Kontroll (test-leder, lokalt):** legg `message` tilbake i `storageErrorLog`. U1 og U2 skal bli røde.

## 2. Tekster: `storage-health.test.ts` (testskriver, punkt 4)

Blokken «tekstene (storage-health.ts)» med `allTexts()`, `readFileSync` og regex slettes, også testen «ingen tekst sier at synk frigjør plass».

| # | Testnavn | Hva den viser |
|---|---|---|
| T1 | «ingen gjetteord i tekstene» | Én test, ingen hjelpefunksjon, leser ikke kildefilen. En liste med de faktiske tekstene: `LOW_STORAGE_WARNING_TEXT`, `storageHealthText` for varig lagring ja, nei og uten API, og `storageErrorMessage` for ett svar, to svar, ett bilde og svar + bilde, med vanlig feil og med full plass. Ingen tekst inneholder «antas», «trolig», «sannsynligvis», «frigjør» eller «rydd» (de to siste tas med i samme ordliste, så sjekken fra den slettede testen ikke går tapt). |

`readFileSync`/`path` fjernes fra importen hvis de ikke brukes ellers.

## 3. Vakttesten i `candidate-boundaries.test.ts` (testskriver, punkt 4)

**Avgjørelse: vakttesten «loggen ved lagringsfeil bruker storageErrorLog» blir stående.** E2e «loggen har aldri svaret» utløser bare loggen for svar i `trial-form-page.tsx`. Loggen for bilde (samme fil) og for åpning av lagringen (`trial-sync-provider.tsx`) nås ikke av e2e. Vakttesten er derfor ikke dobbel. Ingen endring i filen.

## 4. E2e: `e2e/fase-1-prove-c-lagring.spec.ts` (testskriver, punkt 2 og 3)

Kjøres i `pc` og `ipad` som i dag. Ingen nye hjelpere.

### 4.1 Åpning uten nett (punkt 2)

| # | Testnavn | Endring |
|---|---|---|
| E0 | «svar og bilde lagret uten nett står der etter at siden er lukket og åpnet uten nett» (obligatorisk) | Fjern `offlineWorked`, den indre `try/catch`, annotasjonene «vei», `context.route("**/api/prove/**", …)` og andre `goto`. `reopened.goto(...)` og `expectFormContent(reopened, text)` kjøres uten nett, og feil gir rød test. Ytre `try/finally` med `setOffline(false)` beholdes. `testInfo` fjernes fra parameterlisten hvis den ikke brukes. |

**Avgjørelse om `test.fixme`:** testskriver kjører E0 med `--repeat-each=3` i begge prosjektene.
- Grønn: ingen `fixme`.
- Rød fordi selve navigasjonen uten nett ikke kommer fram i Chromium (f.eks. `net::ERR_INTERNET_DISCONNECTED` før service workeren svarer, kjent begrensning i Playwright med `setOffline` og ny side): `test.fixme(true, "<én linje med grunnen>")` øverst i testen. Ingen omvei, ingen egen doc.
- Rød fordi siden åpner, men svar, tall eller bilde mangler: **feil i appen**. Ingen `fixme`; meldes som alvorlig funn til utvikleren.

Test-leder ser på sporet (trace) før en `fixme` godtas.

### 4.2 Doble tester (punkt 3) – endelig liste

| # | Tiltak | Grunn |
|---|---|---|
| E1 | «takstmann ser boksen» flettes inn i «boksen viser plass og varig lagring med ekte tall». Ny test: **«takstmann ser boksen med plass og varig lagring (ekte tall)»**, logger inn med `logInAsInspector`, ingen overstyring, ellers samme sjekker som i dag (markører, MB, «Varig lagring:», under velgeren, nivå lik `storageLevel(estimate)`). | Samme side og samme boks. Rolletesten beholdes i den sammenslåtte testen. |
| E2 | «boksen har ingen knapp» flettes inn i «boksen viser ok med 2 GB ledig» (siste linjer: ingen `button` i boksen). Override endres fra `PLENTY` til `TWO_GB_FREE`; uten betydning for knappen. | Samme oppsett (admin, liste, nok plass). |
| E3 | «nok plass gir ikke varsel» slettes. | Første sjekk i «lite plass oppdaget ved bilde uten ny innlasting» er nøyaktig den samme (`TWO_GB_FREE`, `storageWarning` har 0). |
| E4 | «svar står der etter ny innlasting med lite plass-varsel» flettes inn i «lite plass ved åpning gir varsel som ikke sperrer»: på slutten `page.reload()`, svaret står der og varselet vises igjen. | Samme oppsett (`LOW_FREE`, skriv svar, lagret). |
| E5 | «flere svar som feiler samles i én melding» flettes inn i «Prøv igjen lagrer de feilede svarene og fjerner meldingen»: etter `failTwoAnswers` sjekkes én melding, «2 svar», `TEXT_B` og begge merket «no» før «Prøv igjen». | Samme oppsett (`failTwoAnswers`). |

**Blir stående (ikke doble):**
- «lite plass oppdaget ved bilde uten ny innlasting» og «lite plass oppdaget etter feil»: to ulike kall til `measure()` i den nye hooken (før bilde, etter feil). Hooken har ingen enhetstester, så disse to er eneste dekning for hvert kall.
- «boksen viser lite plass med 100 MB ledig»: eneste sjekk av `low` på listen.
- «skjemaet viser ingen tall om plass», begge persist()-testene, «uten navigator.storage …», alle feilmeldingstestene, de to iPad-testene for knapper og høyde, «loggen har aldri svaret», «uten testkrok …».

Fra 27 til 22 tester i filen.

### 4.3 Hooken (punkt 5)

Ingen egne tester (kortet). Dekkes av: E1, E2, «boksen viser lite plass …», begge persist()-testene (måler igjen etter `requestPersistentStorage()`), «uten navigator.storage …», «lite plass ved åpning …» (E4), «lite plass oppdaget ved bilde …», «lite plass oppdaget etter feil». Klientnavigasjon fra liste til skjema i persist()-testen viser at listen ikke oppdaterer etter at den er lukket uten feil i konsollen.

## 5. Dekning av akseptkriteriene i prøve C (`docs/funksjoner/fase1-prove-c-lagring.md`)

Test-leder sjekker ved godkjenning at hvert kriterium fortsatt har minst én test:
- Liste med plass og varig lagring (PC og iPad): E1, E2.
- Data overlever lukking uten nett: E0 (eller `fixme` med grunn; da står kriteriet som «bare ekte iPad», og det sies i testrapporten).
- Lite plass ved åpning og ved bilde: E4, «lite plass oppdaget ved bilde …».
- Én melding, flere samles: «svar som feiler gir én melding …», E5.
- Meldingen forsvinner / blir stående / Lukk: uendrede tester.
- Bilde som feiler, full plass, 44/8: uendrede tester.
- Loggen: U1–U3 og «loggen har aldri svaret» (kriteriet endres i praksis fra «navn og melding» til «bare navn», som er strengere).

## 6. Kjøring før godkjenning

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` (pc og ipad). I tillegg: `grep -n "instanceof DOMException" src/modules/offline-trial/storage-health.ts` gir ingenting, `grep -n "readFileSync" src/modules/offline-trial/storage-health.test.ts` gir ingenting, skjemaet og listen importerer samme hook, og `package.json` har 0.2.22.

**Avvises hvis:** reserveveien finnes i en eller annen form, rolletesten for takstmann er borte, eller `storageErrorLog` gir mer enn `name`.
