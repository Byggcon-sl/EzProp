# Funksjon: Første kandidat for drift uten nett – PowerSync koblet til testskjemaet

- **Fase:** 1 – Prøve uten nett
- **Modul:** `src/modules/offline-trial` (fra oppgave 3) og `src/db/schema` (tre nye tabeller bare for prøven)
- **Status:** utkast (oppgavekort 28.10.2026)
- **Branch:** `fase1-kandidat-powersync` (bygger på `main` etter PR #6)
- **Dato:** 28.10.2026
- **Plan:** `docs/07-utviklingsplan.md` fase 1, punktet «Kandidater satt opp mot samme testskjema: PowerSync, ElectricSQL og eventuelt andre … Tekstfletting med Yjs eller tilsvarende». Dette kortet dekker **første kandidat, PowerSync**. ElectricSQL og egenbygd kommer som egne oppgaver på samme skjema. Punktet krysses av først når alle kandidatene er satt opp.
- **Testplan:** `docs/funksjoner/fase1-kandidat-powersync-testplan.md` (skrives av test-leder før koding; navnene der er bindende for testskriver). Dette kortet gjentar ikke testplanen (lærdom fra oppgave 3).
- **Protokoll og resultat for prøve A og B:** `docs/funksjoner/fase1-prove-ab-powersync.md` (ligger klar; utvikler fyller inn det tekniske, Ståle fyller inn tallene).
- **Støtter hovedmål:** Tid: befaring uten nett på iPad er den største tidsbesparelsen mot IVIT; her prøves den første ekte løsningen for at alt som skrives på stedet, blir lagret og kommer fram. / Reklamasjoner: ingenting skal gå tapt mellom befaring og rapport (svar og bilder bekreftes av serveren før iPaden gir slipp på dem). / KI først: ikke KI i denne oppgaven (se under), men synklaget som velges, er der KI-forslag senere skal vises og godkjennes på iPaden, også uten nett.

## Problem
Testskjemaet fra oppgave 3 lagrer ingenting: svarene forsvinner når siden lastes på nytt. Fase 1 skal avgjøre om befaring uten nett i Safari på iPad holder, og det kan bare avgjøres med en ekte synkløsning koblet til skjemaet, prøvd på ekte iPad (prøve A og B). PowerSync er første kandidat fordi den bygger rett på PostgreSQL, har en åpen web-SDK med lokal SQLite i nettleseren og kan driftes selv i Docker. Uten denne oppgaven kan ikke prøvene kjøres, og valget i ADR-en blir synsing.

Oppgaven er **en prøve, ikke en produktfunksjon**: det som bygges, kan kastes når ADR-en er skrevet. Derfor egne tabeller med prefiks `trial_`, egne ruter under `/api/prove/`, og ingen kobling til oppdrag, rapporter eller malmotoren.

## KI først
Nei. Dette er teknisk grunnarbeid (lokal lagring, synk, fletting). KI kommer ikke inn før grunnmuren står (beslutning 25.10.2026). Oppgaven forbereder likevel «KI først»: svar per felt med versjon og enhet er den formen KI-forslag senere lagres i (`suggestion_status` i domenemodellen), og tekstfletting gjør at et KI-utkast og takstmannens egne ord kan leve i samme felt uten at det ene overskriver det andre.

## Brukerhistorier
- Som **takstmann** vil jeg **fylle ut testskjemaet og ta bilder i flymodus, lukke appen og starte iPaden på nytt** slik at **alt ligger på serveren når nettet kommer, uten at jeg gjør noe**.
- Som **takstmann** vil jeg **se hvor mye som venter på å bli sendt** slik at **jeg vet når alt er trygt**.
- Som **to takstmenn i samme skjema** vil vi **skrive i samme tekstfelt samtidig** slik at **begge bidrag blir med**, og **når én endrer TG, valg eller tall, ser den andre at verdien ble endret av en annen**.
- Som **Ståle** vil jeg **starte PowerSync på Macen med `./start.sh`** og **vite hvordan den kjøres i Azure-testmiljøet** slik at **prøvene kan kjøres på ekte iPad**.
- Som **prosjektleder** vil jeg **ha en protokoll med plass til tall og skjermopptak** slik at **resultatet for PowerSync kan sammenlignes med de andre kandidatene**.

## Omfang

Arbeidet deles i **fire biter** som ikke henger sammen i kode. Kontrakten mellom dem (tabeller, ruter, nyttelast) står i avsnittet «Data» og er bindende; da kan bitene bygges i parallell.

**Med:**

### Bit 1 – Lokal database og synk i nettleseren (PowerSync web-SDK)
1. **Nye avhengigheter:** `@powersync/web` (Apache-2.0), `@powersync/react` (Apache-2.0, `useQuery`/`useStatus`), `@journeyapps/wa-sqlite` (PowerSyncs utgave, krav fra SDK-en) og `yjs` (MIT, bit 3). Lisensene er sjekket 28.10.2026 mot npm. Begrunnelsen gjentas i PR-en. Ingen andre nye pakker uten begrunnelse; service worker skrives for hånd (bit 4).
2. `src/modules/offline-trial/sync/schema.ts`: PowerSync-klientskjema med tabellene `trial_forms`, `trial_answers`, `trial_photos` (samme kolonnenavn som i PostgreSQL, se «Data»).
3. `src/modules/offline-trial/sync/database.ts`: åpner `PowerSyncDatabase` (filnavn `offline-trial.sqlite`) én gang i nettleseren og kobler til tjenesten når nettet finnes. Utvikler skriver i resultatfilen **hvilken lagring SDK-en faktisk bruker i Safari på iPad** (OPFS eller IndexedDB) og om flere faner er støttet. Det er en del av svaret på prøve C senere.
4. `src/modules/offline-trial/sync/connector.ts`: `fetchCredentials()` henter `GET /api/prove/synk/token`; `uploadData()` sender neste endringsbunt til `POST /api/prove/synk/endringer` og fullfører den bare når serveren svarer 200. Feiler sendingen, blir bunten liggende og prøves igjen (det er SDK-ens standard).
5. `src/modules/offline-trial/sync/device.ts`: `getTrialDeviceId()` gir en fast id per nettleser-installasjon (uuidv7 i `localStorage`, nøkkel `trial_device_id`). Brukes bare til varselet i prøve B. Ikke tabellen `devices` (fase 2b).
6. `src/modules/offline-trial/sync/answer-rows.ts` (rene funksjoner, enhetstestet): `answerToRow(formId, fieldKey, value, deviceId)` og `rowsToAnswers(answerRows, photoRows): TrialAnswers`. Bildefelt bygges av `trial_photos`-rader, aldri av `trial_answers.value`, så to iPader som tar bilder i samme felt ikke overskriver hverandres liste.
7. **Sidene.** `/prove/testskjema` blir en kort liste over organisasjonens testskjemaer (navn, laget når, antall utfylt) med knappen **«Nytt testskjema»** øverst. Et nytt skjema får id på enheten (uuidv7) og navnet «Testskjema N». `/prove/testskjema/[id]` viser skjemaet med `TrialFormView` som i dag; `onChange` skriver én `trial_answers`-rad per felt (upsert på `(trial_form_id, field_key)`), og visningen leser med `useQuery`. Telleren «N av 40 felt utfylt» står uendret. Listen trengs for at to iPader skal kunne åpne samme skjema (prøve B) og for at prøve A kan kjøres flere ganger på to iPader samtidig.
8. **Måleindikator** (minste mulige, trengs for å måle «tid til synk ferdig» i protokollen): én linje over telleren: «Uten nett» når nettleseren er uten nett, ellers «Venter: N endringer, M bilder» eller «Alt er lagret på serveren». Tallene kommer fra SDK-ens kø (`N`) og fra `trial_photos`-rader uten `uploaded_at` på denne enheten (`M`). Punktet «Synkstatus som alltid vises» i planen (med «lagret kl.» og «Synk nå») er **ikke** denne oppgaven; indikatoren byttes ut da.

### Bit 2 – Server: tabeller, ruter, PowerSync-tjenesten og drift
9. `src/db/schema/offline-trial.ts`: tabellene `trial_forms`, `trial_answers`, `trial_photos` med `baseColumns` (se «Data»), eksportert fra `src/db/schema/index.ts`, migrering med `pnpm db:generate`. Migreringen lager også publikasjonen `powersync` for de tre tabellene (`CREATE PUBLICATION … FOR TABLE …`), som PowerSync-tjenesten leser fra. Publikasjonen krever ikke `wal_level=logical`, så migreringen går også i testdatabasen og i Azure før parameteren er satt.
10. `src/modules/offline-trial/server/`: fire funksjoner, alle med tilgangssjekk først og `grant.organizationId` i alle spørringer:
    - `issueSyncToken(actor, organizationId)`: `requireOrganizationAccess` → JWT (HS256 med `POWERSYNC_JWT_SECRET`, eller RS256 med nøkkelpar og JWKS-rute hvis tjenesten krever det; arkitekt avgjør og skriver det i PR-en) med `sub` = bruker-id, `organization_id` = **`grant.organizationId`**, `aud` = `powersync`, levetid 1 time. Returnerer `{ token, endpoint }` der `endpoint` er `POWERSYNC_URL`.
    - `applyTrialChanges(actor, organizationId, operations)`: `requireOrganizationAccess` → hver operasjon (`PUT`, `PATCH`, `DELETE`) skrives med `organization_id = grant.organizationId`, **aldri** fra nyttelasten. `DELETE` er myk sletting (`deleted_at`). For tekstfelt med `text_state` flettes innkommende tilstand med lagret tilstand (bit 3) før `value` skrives. Ukjent tabell eller ukjent `field_key` gir 400 og ingen skriving.
    - `listTrialForms(actor, organizationId)` og `listTrialAnswers(actor, organizationId, trialFormId)`: brukes av server-siden til listen (første visning før synk) og av testene. Begge får `expectTenantIsolation`.
    - `storeTrialPhoto(actor, organizationId, photoId, bytes)`: `requireOrganizationAccess` → sjekker at `trial_photos`-raden finnes i `grant.organizationId` (ellers 404), skriver filen til `TRIAL_UPLOAD_DIR/<organizationId>/<photoId>` (standard `var/uploads/trial`, i `.gitignore`), regner SHA-256, setter `sha256`, `storage_path`, `uploaded_at`, og svarer `{ sha256 }`. Ingen felles filtjeneste ennå (fase 0b).
11. Tynne ruter i `src/app/api/prove/synk/token/route.ts`, `src/app/api/prove/synk/endringer/route.ts` og `src/app/api/prove/bilder/[id]/route.ts`: leser innlogget bruker (`getCurrentActor`, 401 uten), kaller funksjonen i modulen, oversetter `AccessDeniedError` til 403. Ingen tilgangslogikk i rutene.
12. **PowerSync-tjenesten lokalt (Docker, selvdrevet utgave):** `docker-compose.yml` får tjenesten `powersync` (offisielt bilde, **fast versjon**, ikke `latest`) med `powersync/config.yaml` og `powersync/sync-rules.yaml`. Postgres i compose startes med `wal_level=logical`. Lagring for tjenesten: PostgreSQL-lagring i en egen database `powersync_storage` på samme Postgres (lages i `scripts/docker-init.sql`), ikke MongoDB. Synkreglene: én bøtte per organisasjon, parameter fra `request.jwt() ->> 'organization_id'`, og `SELECT * FROM <tabell> WHERE organization_id = bucket.organization_id` for hver av de tre tabellene. Ingen konto hos PowerSync Cloud eller andre leverandører opprettes.
13. **`start.sh`** (bash 3.2): venter på at PowerSync svarer på helsesjekken etter databasen, legger de nye `.env`-nøklene til i løkken for eldre `.env`, og skriver adressen til tjenesten i oppsummeringen. `.env.example` får `POWERSYNC_URL=http://localhost:8080`, `POWERSYNC_JWT_SECRET=<utviklingsverdi, ikke hemmelig>` og `TRIAL_UPLOAD_DIR=var/uploads/trial` med forklaring. Verdien i `.env.example` er bare for Macen; i Azure er den en hemmelighet i appinnstillingene.
14. **Azure beskrives, ikke rulles ut:** `docs/drift/powersync.md` med to deler: (a) Mac: hva `start.sh` gjør og hvordan Ståle ser at tjenesten kjører; (b) Azure-testmiljøet fra PR #7: PowerSync som egen container (Container Apps, eller App Service for containere hvis det ligner Optiplan mer), samme bilde og samme to konfigurasjonsfiler, `wal_level = LOGICAL` som serverparameter på PostgreSQL Flexible Server (krever omstart), egen database for lagring, miljøvariablene appen trenger, og anslått kostnad per måned. Ingen Bicep i denne PR-en (PR #7 er ikke merget; Bicep for PowerSync kommer i en liten egen PR oppå #7 når Ståle har merget).
15. **Skyen har ikke Docker.** Enhetstester og integrasjonstester kjører mot PostgreSQL og SDK-ens lokale database uten tjenesten. Kobling mot selve PowerSync-tjenesten prøves av Ståle på Macen (`./start.sh`) og i Azure. Det står i PR-en under «Slik ser og tester du det».

### Bit 3 – Tekstfletting, «siste endring vinner» med varsel, og de kjente svakhetene fra oppgave 3
16. `src/modules/offline-trial/text-merge.ts` (rene funksjoner på Yjs, enhetstestet, ingen React og ingen database): `createTextState(text)`, `applyTextEdit(state, newText)` (regner ut innsetting og sletting fra forrige tekst og legger dem på `Y.Text`), `mergeTextStates(a, b)` og `textOf(state)`. Tilstanden er en base64-streng (Yjs-oppdatering), så den kan ligge i en tekstkolonne både i SQLite og PostgreSQL. Testsaker: to som skriver i hver sin ende samtidig gir en tekst med begge bidrag; samme tilstand flettet to ganger gir samme resultat (idempotent); tom tilstand flettet med tekst gir teksten.
17. Tekstfeltene (de 7 med `type: "text"`) skriver både `value` (teksten) og `text_state`. Når en rad fra en annen enhet kommer inn via synk, flettes `text_state` lokalt og visningen får den flettede teksten. Serveren fletter på samme måte i `applyTrialChanges` (pkt. 10), så begge sider ender likt.
    **Grense for arbeidet:** får ikke utvikler denne koblingen gjennom PowerSync til å virke innen én arbeidsdag etter at bit 1 og 2 står, leveres `text-merge.ts` med tester likevel, tekstfeltene følger «siste endring vinner» som de andre, og det står tydelig i resultatfilen og i PR-en. Prøve B kjøres da uten tekstfletting for denne kandidaten, og det er et resultat («det som ikke virket»), ikke en mangel ved PR-en.
18. **«Siste endring vinner» med minste mulige varsel** for TG, valg og tall: rekkefølgen på serveren avgjør (den som kommer sist, vinner). `src/modules/offline-trial/foreign-change.ts` (ren funksjon, enhetstestet): `detectForeignChanges(previousRows, nextRows, deviceId): Set<fieldKey>` gir feltene der verdien ble endret av en annen enhet etter at denne enheten sist satte dem. Visningen viser teksten **«Endret av en annen»** (`role="status"`) rett under feltet, og fjerner den når brukeren trykker eller skriver i feltet igjen. Ingen dialog, ingen farge alene, ingen lyd. Tabellfeltet følger også siste endring vinner (hele tabellen), uten varsel; prøve B tester ikke tabellen.
19. **Kjente svakheter fra oppgave 3** (nederst i `docs/funksjoner/fase1-testskjema.md`):
    - `NumberInput` leser verdien fra `answers` når den endres utenfra (en annen enhet eller synk), men beholder råteksten mens brukeren skriver («12,» forsvinner ikke). Samme for tallceller i tabellen.
    - `parseTrialNumber` godtar bare strengt desimaltall: regex `^-?\d+([.,]\d+)?$` etter trimming. «12,5» → 12.5, «0» → 0, «-3» → -3, «1e3» → null, «Infinity» → null, «0x10» → null, «1 000» → null. Testsakene legges til i `answers.test.ts`.
    - `viewport`-eksporten i `layout.tsx` og `description` i manifestet: fjernes **bare** hvis bit 4 likevel rører filene; ellers lar vi dem stå.

### Bit 4 – App som åpner uten nett (service worker) og bildekø
20. `public/sw.js` skrevet for hånd (ingen ny avhengighet): ved `fetch` lagres `/_next/static/*` i hurtiglager (hurtiglager først), og sidene under `/prove/testskjema*`, `/arbeidskoe` og RSC-oppslagene til dem (`?_rsc=`) hentes fra nettet først med hurtiglageret som reserve. Alt annet (API, innlogging, `/dev/epost`) går rett til nettet. Registreres fra en liten klientkomponent i `src/app/layout.tsx`. Målet er bare at **appen på hjemskjermen åpner testskjemaet i flymodus etter at den er lukket og iPaden er startet på nytt** (prøve A). Hvis en håndskrevet service worker ikke holder i Next 16, kan utvikler foreslå `@serwist/next` med begrunnelse i PR-en.
21. **Bildekø, ingenting går tapt:** når takstmannen tar et bilde, lagres filen (`Blob`) i IndexedDB (`offline-trial-photos`, rå API, ingen avhengighet) under `photo.id`, og raden i `trial_photos` skrives lokalt (synkes av PowerSync). En enkel opplaster i nettleseren går gjennom bilder uten `uploaded_at` mens appen er åpen og nettet finnes, sender filen med `PUT /api/prove/bilder/[id]`, regner SHA-256 lokalt (`crypto.subtle.digest`) og sletter den lokale filen **bare** når serverens `sha256` er lik. Ulik eller feil: prøves igjen senere, filen blir liggende. Rekkefølgen er ett bilde om gangen. Komprimering, rotering og HEIC er prøve D, ikke her.
22. **Protokoll og resultatmal for prøve A og B:** `docs/funksjoner/fase1-prove-ab-powersync.md` ligger klar fra prosjektleder. Utvikler fyller inn avsnittet «Teknisk som utvikleren fyller inn» (lagringstype i Safari, service worker, tekstfletting virket/ikke, det som ikke virket i byggingen). Tallene fra iPadene fylles inn av Ståle.
23. **Spørsmål til Ståle** om pris, EU/EØS-drift, lisens og databehandleravtale for PowerSync er lagt i `docs/09-apne-sporsmal.md` som nr. 10 (gjort i dette kortet). Ikke blokkerende for PR-en: alt kjører selvdrevet.
24. Versjon `0.1.2 → 0.1.3` i `package.json` (PR #7 har 0.2.0; konflikten løses av prosjektleder etter at Ståle har merget). Ordlisten i `docs/05-domenemodell.md` avsnitt 8 er oppdatert i dette kortet (synk, endringskø, tekstfletting, siste endring vinner, `trial_*`).

**Ikke med (bevisst utelatt):**
- **ElectricSQL og egenbygd løsning.** Egne oppgaver på samme skjema. Ingen sammenligning eller ADR her; det er egne punkter i fase 1.
- **Selve prøvene A og B** på ekte iPad. De kjøres av Ståle når testmiljøet (PR #7) og PowerSync i Azure er oppe. Denne PR-en gjør klart og lager protokollen.
- **Prøve C, D, E og F.** Ingen måling av lagringsplass, ingen komprimering, rotering eller HEIC-til-JPEG, ingen regler, ingen håndtering av utløpt innlogging uten nett (token og sesjon følger dagens levetid).
- **Fullt synkstatus-punkt** («lagret kl.», «Synk nå»): eget punkt i planen. Bare måleindikatoren i pkt. 8.
- **Ingen Bicep eller utrulling** til Azure fra denne PR-en. Bare beskrivelse (pkt. 14). Ingenting rulles ut fra skyen.
- **Ingen konto hos PowerSync Cloud, MongoDB Atlas eller andre.** Bare selvdrevet, gratis utgave i Docker.
- **Ingen kobling til oppdrag, rapporter, kontrollpunkter, malmotoren eller `devices`-tabellen.** `trial_*`-tabellene og `trial_device_id` er bare for prøven og kan kastes.
- **Ingen felles filtjeneste** (fase 0b). Bildene ligger i en lokal mappe på serveren (`TRIAL_UPLOAD_DIR`). I Azure App Service er `/home` varig lagring; det holder for prøven og står i driftsdokumentet.
- **Ingen sletting av testskjemaer i skjermbildet**, ingen omdøping, ingen søk. Listen viser bare skjemaene og «Nytt testskjema».
- **Ingen konfliktlogg i databasen** (`sync_conflicts` i domenemodellen er fase 2b). Varselet lever bare i visningen.
- **Ingen fletting for tabell, TG, valg og tall.** De følger siste endring vinner, som planen sier.
- **Ingen ny tilgangslogikk eller nye rettigheter.** Alle ansatte i organisasjonen ser og endrer alle testskjemaer (`organization.read`, 27.10.2026: alle ser alt).
- **Ingen Safari-kjøring i e2e** (Chromium i iPad-størrelse). Safari testes på ekte iPad av Ståle.
- **Ingen Playwright-test mot PowerSync-tjenesten** (skyen har ikke Docker). E2e viser lokal lagring og uten-nett i Chromium uten tjeneste; koblingen mot tjenesten prøves av Ståle.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | alle testskjemaer i egen organisasjon | ja |
| kontor | ja | ja |
| leder | ja | ja |
| admin | ja (stenges aldri ute) | ja |

Alle fire serverfunksjonene kaller `requireOrganizationAccess(actor, organizationId, "organization.read")` først og bruker `grant.organizationId` i spørringene. Organisasjons-id-en kommer i prøven fra `listOrganizationsForActor` (i dag alltid én: Byggcon) og sendes med av klienten; serveren stoler aldri på den, bare på `grant`. `issueSyncToken` legger `grant.organizationId` i JWT-en, og synkreglene i PowerSync filtrerer på den, så iPaden bare får sin egen organisasjons rader. `expectTenantIsolation` kjøres for `listTrialForms` og `listTrialAnswers`; `issueSyncToken` og `applyTrialChanges` får egne tester for at fremmed organisasjon gir `AccessDeniedError`, og at `organization_id` i nyttelasten aldri brukes.

## Data
Tre nye tabeller, alle med `baseColumns` (id laget på enheten, `organization_id`, laget/endret, myk sletting, `row_version`). De er **bare for prøven** og slettes eller gjøres om i fase 2b. Domenemodellen får en kort merknad om det i avsnitt 8 (ordlisten), ikke en ny tabellbeskrivelse.

| Tabell | Kolonner utover `baseColumns` | Merknad |
|---|---|---|
| `trial_forms` | `name` text | Ett testskjema (én «rapport» i prøven). Lages på enheten. |
| `trial_answers` | `trial_form_id` uuid (FK), `field_key` text, `value` jsonb (`TrialValue` som JSON; for tekst selve teksten; for bilde alltid tom), `text_state` text null (base64 Yjs-tilstand, bare tekstfelt), `device_id` text | Unik på `(trial_form_id, field_key)`. Én rad per felt, endringer per felt. |
| `trial_photos` | `trial_form_id` uuid (FK), `field_key` text, `name` text, `size_bytes` integer, `sha256` text null, `storage_path` text null, `uploaded_at` timestamptz null, `device_id` text | `id` er `TrialPhoto.id` fra enheten. `uploaded_at` settes bare av serveren. |

**Ruter (kontrakt mellom bit 1 og 2):**

| Rute | Inn | Ut |
|---|---|---|
| `GET /api/prove/synk/token?organisasjon=<id>` | innlogget | `200 { token, endpoint }`, `401` uinnlogget, `403` fremmed organisasjon |
| `POST /api/prove/synk/endringer` | `{ organizationId, operations: [{ op: "PUT" \| "PATCH" \| "DELETE", table, id, data }] }` | `200 { applied }`, `400` ukjent tabell/felt, `401`, `403` |
| `PUT /api/prove/bilder/[id]?organisasjon=<id>` | filen som kropp (`Content-Type: image/*`) | `200 { sha256 }`, `404` ukjent bilde i organisasjonen, `401`, `403` |

**Miljøvariabler:** `POWERSYNC_URL`, `POWERSYNC_JWT_SECRET`, `TRIAL_UPLOAD_DIR`. Alle med forklaring i `.env.example`.

**Faste koder:** feltnøklene fra oppgave 3 (40 stk.) brukes uendret som `field_key`. Ingen nye koder.

## Skjermer
iPad (liggende, 1194 × 834) og PC. To skjermer:
- **Liste** (`/prove/testskjema`): overskrift «Testskjema», knappen «Nytt testskjema» (minst 44 pt), og en liste med navn og «N av 40 felt utfylt» per skjema. Ett trykk åpner skjemaet.
- **Skjemaet** (`/prove/testskjema/[id]`): som i oppgave 3, pluss måleindikatoren over telleren og teksten «Endret av en annen» under et felt når det gjelder. Ingen lagre-knapp: alt lagres idet det skrives.

Ingen skisse fra ui-designer eller ux-ansvarlig: prøveverktøy, tekstene står her, og designprinsippene (store trykkflater, knapper framfor nedtrekk, aldri bare farge) er dekket.

## Regler
Ingen regler eller TG-logikk (prøve E). Flettereglene er kode med testsaker (pkt. 16 og 18), ikke regler i malen.

## Akseptkriterier
- [ ] Et nytt testskjema kan lages fra listen, åpnes, og alle 40 felt kan fylles ut i e2e i både `pc` og `ipad`; telleren viser «40 av 40 felt utfylt» (dagens e2e tilpasset listen).
- [ ] Svarene overlever at siden lastes på nytt i e2e (lokal database), uten at noen server svarte på synk.
- [ ] Med nettleseren uten nett i e2e (`context.setOffline(true)`) åpner skjemaet likevel fra hurtiglageret etter at det er besøkt én gang, nye svar kan skrives, og indikatoren viser «Uten nett». Når nettet kommer tilbake, viser indikatoren «Alt er lagret på serveren» eller tallet som venter (avhengig av om tjenesten finnes i miljøet; testen godtar begge, men ikke feil).
- [ ] Bildefil valgt i e2e blir liggende lokalt til serveren har bekreftet SHA-256; etter bekreftelse viser indikatoren 0 bilder som venter. Feil SHA-256 fra serveren (simulert) gjør at filen ikke slettes.
- [ ] `parseTrialNumber` følger den strenge regelen med testsakene i pkt. 19. `NumberInput` viser en verdi som settes i `answers` utenfra.
- [ ] `text-merge.ts`: testsakene i pkt. 16 er grønne.
- [ ] `detectForeignChanges`: endring fra en annen enhet gir feltnøkkelen, egen endring gir ikke, og e2e viser «Endret av en annen» når en rad endres utenfra (testskriver kan skrive raden direkte i den lokale databasen).
- [ ] `applyTrialChanges` skriver aldri `organization_id` fra nyttelasten (test: fremmed id i `data` gir rad i `grant.organizationId`); fremmed organisasjon gir `AccessDeniedError`; `DELETE` setter `deleted_at` og sletter ikke raden.
- [ ] `issueSyncToken`: `organization_id` i JWT-en er lik `grant.organizationId`; fremmed organisasjon gir `AccessDeniedError`; uinnlogget rute gir 401.
- [ ] `storeTrialPhoto`: lagrer filen under `TRIAL_UPLOAD_DIR/<organizationId>/<id>`, svarer riktig SHA-256, og 404 for bilde-id i en annen organisasjon.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): `expectTenantIsolation` for `listTrialForms` og `listTrialAnswers`.
- [ ] Migreringen kjører i CI og lager de tre tabellene og publikasjonen `powersync`.
- [ ] `docker compose config` er gyldig; `powersync/config.yaml` og `sync-rules.yaml` finnes; `start.sh` er gyldig bash 3.2 (`bash -n`) og kjører uten feil med `EZPROP_SKIP_DOCKER=1`.
- [ ] `docs/drift/powersync.md` og det tekniske avsnittet i `docs/funksjoner/fase1-prove-ab-powersync.md` er fylt inn, også det som ikke virket.
- [ ] `pnpm format:check`, `pnpm lint` (modulgrense og produktnavn), `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne, og `ipad`-prosjektet har kjørt alle e2e-testene.
- [ ] Virker på iPad-størrelse (e2e): dekket av `ipad`-prosjektet.
- [ ] Ingen modellnavn i commit-meldingene (`git log origin/main..HEAD`).

## Roller
- **arkitekt**: avgjør JWT-oppsettet (HS256 eller RS256), formen på synkreglene og compose-oppsettet (pkt. 10, 12), og at tabellene og kontrakten over holder for ElectricSQL og egenbygd senere (samme tabeller skal brukes om igjen). Skriver sin del i PR-en; ingen ADR nå (ADR-en kommer når alle kandidatene er prøvd).
- **sikkerhet-personvern**: gjennomgår token-ruten, opplastingsruten (filsti, størrelse, innholdstype), at `organization_id` aldri hentes fra nyttelasten, at hemmeligheten ikke havner i repoet utover utviklingsverdien i `.env.example`, og at ingen kundeopplysninger kan havne i prøven (bare oppdiktede data, slått fast i protokollen).
- **test-leder**: skriver `fase1-kandidat-powersync-testplan.md` før koding og godkjenner til slutt.
- **utvikler**: fire biter, kan kjøres i parallell: bit 3 (rene funksjoner og de kjente svakhetene) er uavhengig; bit 2 (server) og bit 1 (klient) møtes i kontrakten i «Data»; bit 4 (service worker og bildekø) henger på bit 1 og bygges etterpå eller av samme utvikler.
- **testskriver**: etter testplanen, i parallell med utvikler, med navnene i dette kortet.
- **prosjektleder**: oppgavekort, protokoll, spørsmål nr. 10, ordliste, tilstand, PR.

Ikke med: ux-ansvarlig og ui-designer (prøveverktøy; tekstene og kravene står i «Skjermer»), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagtekst). Forenkler vurderer kortet som vanlig i arbeidsflyten.

## Åpne spørsmål
- **Nr. 10 (nytt, ikke blokkerende):** PowerSync som leverandør: selvdrevet mot skytjeneste, pris, EU/EØS, lisens (tjenesten er FSL-1.1-ALv2, SDK-ene Apache-2.0) og databehandleravtale. Ståle svarer før ADR-en, ikke før denne PR-en.
- **Nr. 6:** adresse og e-post for Azure-testmiljøet (PR #7). Prøvene A og B trenger at PR #7 er merget og PowerSync er satt opp i Azure etter `docs/drift/powersync.md`.
- **Nr. 8:** Stedstjenester av på iPadene før prøvene (står i protokollen).
- Risiko som ikke er et spørsmål til Ståle: PowerSync web-SDK og wa-sqlite må kjøre i Next 16. Lar det seg ikke gjøre innen rimelig tid, er det et resultat som skrives ned («det som ikke virket») og veier inn på kriteriene «Arbeid» og «Modenhet». PR-en leveres uansett med bit 2 og 3, og det som virket av bit 1 og 4.
