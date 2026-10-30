# Funksjon: Liten oppgave (f) – småfunn fra prøve C (PR #32)

- **Fase:** 1 – Prøve uten nett
- **Modul:** offline-trial (prøve, kastes eller gjøres om etter ADR)
- **Status:** klar (etter forenkler)
- **Branch:** `fase1-smafunn-prove-c` (bygger på `main`, PR #32 er merget)
- **Versjon:** 0.2.21 → 0.2.22
- **Støtter hovedmål:** Reklamasjoner: loggen kan ikke lekke svarverdier, og testen for åpning uten nett blir rød når data ikke overlever, i stedet for å bli grønn via en omvei. Tid: færre doble tester gir raskere CI og raskere leveranser. KI først: ikke direkte (se under).

## Problem
Gjennomgangen av PR #32 fant fem små ting som ikke stoppet mergen, men som skal rettes før prøve C brukes som grunnlag for synkvalget:
1. `storageErrorLog` i `src/modules/offline-trial/storage-health.ts` gir hele `message` fra lagringen. Meldingen fra IndexedDB/OPFS kan i noen nettlesere inneholde verdier.
2. Testen «svar og bilde lagret uten nett står der etter at siden er lukket og åpnet uten nett» i `e2e/fase-1-prove-c-lagring.spec.ts` har en reservevei (nett på, `/api/prove/**` stoppet) som gjør testen grønn selv om åpning uten nett feilet.
3. Flere e2e-tester i samme fil sjekker det samme som andre tester. Tekstblokken «tekstene (storage-health.ts)» i `storage-health.test.ts` leser kildefilen med regex og er tung og dobbelt med testene for hver tekst. Vakttesten «loggen ved lagringsfeil bruker storageErrorLog» i `candidate-boundaries.test.ts` er dobbelt med e2e «loggen har aldri svaret».
4. Skjemaet (`[id]/trial-form-page.tsx`, `measureStorage` med `useRef`) og listen (`trial-form-list.tsx`, lokal `measure` med `latest`/`active`) måler plassen med to ulike mønstre.
5. `instanceof DOMException`-sjekkene i `isQuotaError` og `storageErrorLog` gjør ingenting: `DOMException` arver fra `Error` i alle nettlesere vi støtter, og `name === "QuotaExceededError"` fanger kode 22.

Lar vi være: en logg som kan vise verdier, og en test som kan skjule at data ikke overlever uten nett. Det siste er nettopp det prøve C skal avdekke.

## KI først
Nei. Dette er opprydding i prøvekode og tester. Ingen oppgave her som KI kan forberede for takstmannen. Indirekte: sikker logg og ærlige prøver er grunnlaget for synkvalget som KI-forslagene senere bygger på.

## Brukerhistorier
- Som **utvikler** vil jeg at en rød test betyr at data ikke overlevde uten nett, slik at synkvalget bygger på riktige resultater.
- Som **Byggcon** vil jeg at loggen aldri kan inneholde det takstmannen skrev, slik at vi ikke lagrer kundeopplysninger i logger.

## Omfang
**Med:**
1. `storageErrorLog` returnerer bare `{ name }` (navnet, eller «ukjent feil»). Returtypen er `{ name: string }`, uten tomt `message`-felt for å passe med gamle kall. Kallene i `trial-sync-provider.tsx` og `trial-form-page.tsx` beholdes, de logger da bare navnet. Testene for `storageErrorLog` oppdateres.
2. Reserveveien i testen for åpning uten nett fjernes. Feiler åpning uten nett, feiler testen. Fjern `offlineWorked`, `try/catch` og annotasjonene «vei». (Blir testen rød i Chromium av en grunn utenfor appen, merkes den `test.fixme` med begrunnelsen på én linje i testen, ikke med omvei. Ingen egen doc. Avgjøres av test-leder.)
3. Doble e2e-tester i `e2e/fase-1-prove-c-lagring.spec.ts` slås sammen eller fjernes. Kandidater: «boksen viser ok med 2 GB ledig» / «nok plass gir ikke varsel», «takstmann ser boksen» / «boksen viser plass … med ekte tall», «lite plass oppdaget ved bilde» / «lite plass oppdaget etter feil». Test-leder avgjør endelig liste, og hvert akseptkriterium i `docs/funksjoner/fase1-prove-c-lagring.md` skal fortsatt ha minst én test. Test-leder sjekker dette direkte mot den filen; det lages ingen ny tabell eller doc.
4. Tekstblokken «tekstene (storage-health.ts)» i `storage-health.test.ts` fjernes (regex over kildefilen). Gjetteord-sjekken beholdes som én test som går gjennom en liste med de faktiske tekstene fra funksjonene, uten å lese kildefilen og uten hjelpefunksjon. Vakttesten «loggen ved lagringsfeil bruker storageErrorLog» i `candidate-boundaries.test.ts` fjernes hvis e2e «loggen har aldri svaret» dekker det samme.
5. Ett mønster for målingen: én liten hook i `src/app/(ansatt)/prove/testskjema/` (ikke i `src/shared`) som både skjemaet og listen bruker. Den samler bare det som finnes i dag: måler ved åpning, måler igjen etter `requestPersistentStorage()`, siste svar vinner, ingen oppdatering etter at siden er lukket. Den gir `{ health, measure }`; skjemaet kaller `measure()` før bilde og etter feil. Ingen nye valg og ingen egne enhetstester: e2e-testene for boksen og varselet dekker den.
6. Fjern `instanceof DOMException`-delene i `isQuotaError` og `storageErrorLog`. Testen «DOMException med code 22» slettes. Testene som sjekker `name` viser allerede at navnet avgjør.
7. Versjon 0.2.22 i `package.json`.

**Ikke med (bevisst utelatt):**
- Nye funksjoner, nye tekster eller endret oppførsel for takstmannen. Boksen, varselet og feilmeldingen ser like ut.
- Endret grense for lite plass (A1) eller andre beslutninger A1–A4.
- Endringer i synkkandidatene, regelmotoren eller andre prøver.
- Prøve C på ekte iPad (Ståle, når han er tilbake).
- Ny avhengighet, migrering eller endring i databasen.
- Annen opprydding i `candidate-boundaries.test.ts` enn den ene vakttesten.

## Tilgang
Uendret. Ingen nye spørringer, ingen ny tilgangslogikk.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som før | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
Ingen. Ordlisten endres ikke: hooken er prøvekode, ikke et domeneord.

## Skjermer
Ingen synlige endringer på iPad eller PC. Samme antall trykk.

## Regler
Ingen.

## Akseptkriterier
- [ ] `storageErrorLog` returnerer bare navnet; test viser at en feil med svarverdien i `message` ikke gir verdien ut.
- [ ] Testen for åpning uten nett har ingen reservevei og feiler hvis innholdet ikke vises uten nett.
- [ ] Ingen e2e-tester i prøve C-filen sjekker det samme; alle akseptkriteriene i prøve C har fortsatt minst én test.
- [ ] `storage-health.test.ts` leser ikke kildefilen; gjetteord-sjekken står igjen som én enkel test.
- [ ] Skjemaet og listen måler plassen med samme hook.
- [ ] Ingen `instanceof DOMException` i `storage-health.ts`; `isQuotaError` gir samme svar for alle eksisterende testsaker utenom kode 22 uten navn.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne (pc og iPad-størrelse).
- [ ] Bruker i annen organisasjon får ikke tilgang: ikke relevant, ingen nye spørringer.
- [ ] Versjon 0.2.22.

## Roller
- **utvikler:** punkt 1, 5, 6, 7 (kode i `storage-health.ts`, ny hook, skjema og liste, og sletting av testen «DOMException med code 22»).
- **testskriver:** punkt 2, 3, 4 (e2e-filen, `storage-health.test.ts`, `candidate-boundaries.test.ts`). Bitene henger ikke sammen og kan gå i parallell; testene for `storageErrorLog` og `isQuotaError` tar utvikleren sammen med koden.
- **test-leder:** avgjør hvilke e2e-tester som er doble, og godkjenner at prøve C fortsatt er dekket.
- **sikkerhet-personvern:** kort gjennomgang av punkt 1 (loggen).

Ikke med: arkitekt, ux, ui, KI, fag. Ingen fagstoff, ingen nye skjermer.

## Avgjørelser (prosjektleder 30.10.2026)
Forenkleren foreslo tre endringer og fire presiseringer. Alle er godtatt:
- Ordlisten endres ikke. Hooken er prøvekode som kastes eller gjøres om etter ADR, og hører ikke hjemme blant domeneordene.
- Hooken får ingen egne enhetstester og ingen nye valg, og ligger ved siden av skjemaet og listen. Den flytter bare logikk som allerede er testet gjennom e2e for boksen og varselet. Mindre kode og færre tester støtter målet om tid.
- Testen «DOMException med code 22» slettes i stedet for å skrives om. Testene for `name` dekker allerede akseptkriteriet.
- Presiseringene (returtype `{ name: string }`, `test.fixme` med én linje, ingen ny dekningstabell, gjetteord-test uten hjelpefunksjon) strammer bare inn det som allerede sto i kortet. Ingen punkter er kuttet.

## Åpne spørsmål
- Ingen. Ingen beslutninger for «Avgjort av agentene mens Ståle var borte».
