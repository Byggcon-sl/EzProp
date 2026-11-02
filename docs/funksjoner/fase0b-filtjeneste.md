# Funksjon: Felles filtjeneste for bilder og dokumenter

- **Fase:** 0b (Grunnmur)
- **Modul:** kjerne (`src/core/files`)
- **Status:** utkast
- **Branch:** `fase0b-filtjeneste` fra `main`. Versjon **0.2.50** (PR #60 med sperre ved innlogging har 0.2.49 og merges før; står `main` på en annen versjon når PR-en åpnes, brukes neste ledige patch).
- **Støtter hovedmål:**
  - **Reklamasjoner:** bilder og dokumenter ligger trygt i 10 år med fingeravtrykk og myk sletting. Ved en reklamasjon kan vi vise nøyaktig hvilket bilde som var med, og at det ikke er endret.
  - **Tid:** én felles tjeneste som alle senere funksjoner (bilder, PDF, logo, signatur, vedlegg) bruker, i stedet for egen lagring per funksjon. Takstmannen merker ingenting, men alt senere går fortere å bygge.
  - **KI først:** KI-tjenestene (bildebeskrivelse, utkast til avvik) henter bildene fra samme sted med samme tilgangssjekk. Se under.

## Problem

I dag lagres bildene fra prøve D direkte i en mappe på serveren (`src/modules/offline-trial/server/photo-storage.ts`). Det går ikke i drift: filene må ligge i fillagring i EU/EØS, de skal beholdes i 10 år, og Ståle vil kunne flytte dem til et lokalt arkiv hos Byggcon senere (27.10.2026, spørsmål 10). Lar vi være, bygger hver funksjon i fase 2 sin egen lagring, og en flytting blir en ombygging.

## KI først

KI kan ikke gjøre lagringen, men tjenesten forbereder KI: alle filer har type, størrelse og fingeravtrykk i metadata, og leses gjennom én funksjon med tilgangssjekk. Når KI senere skal beskrive bilder eller foreslå avvik (fase 2b og 3), henter den bildet herfra, og bare for organisasjonen den jobber for. Ingenting KI-spesifikt bygges nå.

## Brukerhistorier

- Som **utvikler av senere funksjoner** vil jeg **lagre og hente filer gjennom én port** slik at bildene, PDF-ene og logoene havner samme sted, med samme tilgang og oppbevaring.
- Som **Ståle (admin)** vil jeg **at filene kan flyttes til et lokalt arkiv** uten ombygging, og at **oppbevaringstidene er innstillinger** jeg kan endre.
- Som **leder ved en reklamasjon** vil jeg **at et bilde aldri forsvinner** før oppbevaringstiden er ute.

## Omfang

**Med:**

1. **Porten** `FileStorage` i `src/core/files` med tre operasjoner på selve filinnholdet: `put(storageKey, bytes, mimeType)`, `get(storageKey)` og `exists(storageKey)`. Porten har ingen slette-operasjon (regel 3).
2. **Adapter for lokal mappe** (utvikling og test). Mappen settes med `FILE_STORAGE_DIR` (standard `var/files`). Nøkkelen kan ikke gå ut av mappen (`..`, absolutt sti, tomme deler avvises).
3. **Adapter for Azure Blob Storage, bare kode.** Slås på med `FILE_STORAGE_DRIVER=azure` og `FILE_STORAGE_AZURE_CONNECTION_STRING` + `FILE_STORAGE_AZURE_CONTAINER`. Standard er `local`. Ingen ressurser i Azure, ingen endring i `infra/` eller utrullingen. Testes med en falsk klient, aldri mot nett. Mangler innstillingene når `azure` er valgt, stopper oppstarten med en tydelig feilmelding (uten verdiene i meldingen).
4. **Tabellen `files`** (metadata, ny migrering) etter domenemodellen: `organization_id`, `storage_key`, `kind`, `mime_type`, `size_bytes`, `sha256`, `retain_until` (kan være tom), felles kolonner med `deleted_at`. Unik på `(organization_id, storage_key)`.
5. **Tjenesten** i `src/core/files` (det modulene kaller):
   - `saveFile(actor, organizationId, { kind, mimeType, bytes })`: tilgangssjekk, regner SHA-256, lager `storage_key` = `<organizationId>/<kind>/<fileId>` (aldri filnavn fra brukeren), skriver filen via porten og så raden. Gir tilbake id, sha256 og størrelse.
   - `readFile(actor, organizationId, fileId)`: tilgangssjekk, finner raden med `grant.organizationId`, henter innholdet og kontrollerer fingeravtrykket. Slettet rad gir «ikke funnet».
   - `markFileDeleted(actor, organizationId, fileId)`: setter `deleted_at`/`deleted_by`. Filen i lagringen røres ikke. Avvises hvis `retain_until` er i fremtiden. Skriver til revisjonsloggen.
   - Største filstørrelse: konstant 25 MB ett sted (samme som prøve D).
6. **Oppbevaringstider som innstillinger** i `organizations.settings`, lest med én funksjon (`readFileRetention`) med standardverdier og advarsel i loggen ved ugyldig verdi, samme mønster som `access.inspectors_edit_all`:
   - `photo.retention.deviation_original_years` = 10
   - `photo.retention.other_original_years` = 2
   - `photo.retention.display_years` = 10
   - `file.retention.default_years` = 10 (PDF, dokumenter, logo, signatur, vedlegg)
   Pluss en ren funksjon `retainUntil(from, years)`. Selve utregningen ved utgivelse kommer i fase 2 (ingen utgivelser finnes ennå).
7. **Gjenbruk fra prøve D:** fingeravtrykk (SHA-256) og grensen på 25 MB følger samme mønster. Prøvekandidatene og `photo-storage.ts` **røres ikke**; de flyttes til tjenesten når synkløsningen er godkjent (ADR 0004).
8. Tester (se akseptkriterier), `.env.example`, `docs/05-domenemodell.md` (files og innstillingene), ordlisten, `docs/06-arkitektur.md` (porten), og `start.sh` bare hvis den nye mappen må lages der.

**Ikke med (bevisst utelatt):**

- Skjermer, opplastingsrute eller API-rute. Ingen bruker filene ennå; første bruker er bilder i fase 2.
- Flytting av prøve D-bildene eller endring av prøvekandidatene.
- Tabellen `photos`, visningskopi, miniatyrer, rotering og HEIC (fase 2b).
- Utregning av `retain_until` ved utgivelse, og opprydding når oppbevaringstiden er ute (ingen sletting av filinnhold i det hele tatt nå).
- Adapter for lokalt arkiv hos Byggcon (porten gjør det mulig; selve adapteren lages når Ståle ber om det).
- `integration_connections` og tilkoblingslaget (eget punkt i fase 0b). Valg av adapter skjer med miljøvariabel inntil da.
- Lagringskonto, container eller nøkler i Azure, endring i Bicep eller utrulling, Key Vault (eget punkt). Alt som koster penger.
- Innstillinger på selskap- og personnivå, og skjerm for å endre innstillingene.
- Virusskanning, kryptering utover det lagringen gir, deling med lenke.

## Tilgang

All sjekk i `src/core/access` via `requireOrganizationAccess`. Spørringer filtrerer på `grant.organizationId`.

| Rolle | Se (hente fil) | Lagre fil | Merke som slettet |
|---|---|---|---|
| takstmann | ja (`organization.read`) | ja | nei |
| kontor | ja | ja | nei |
| leder | ja | ja | nei |
| admin | ja | ja | ja (`organization.manage`) |

Lagre krever `organization.read` (alle ansatte laster opp bilder og dokumenter; den som kaller fra en modul gjør sin egen fagsjekk, for eksempel `report.edit`). Merke som slettet krever `organization.manage`, og aldri før `retain_until` er passert. Admin stenges ikke ute.

## Data

- Ny tabell **`files`** (se Omfang 4) med migrering. `kind` er en fast liste: `photo`, `report_pdf`, `document`, `logo`, `signature`, `attachment` (faste koder, regel 6).
- Nye innstillingsnøkler i `organizations.settings` (Omfang 6). Ingen migrering av eksisterende rader; standardverdiene gjelder når nøkkelen mangler.
- Oppdater `docs/05-domenemodell.md` (`files`, innstillingene) og ordlisten (`file storage`, `storage key`, `retain until`).

## Skjermer

Ingen.

## Regler

Ingen fagregler. Tekniske regler med tester: nøkkelen kan ikke gå ut av mappen; fingeravtrykket må stemme ved henting; `retain_until` i fremtiden hindrer myk sletting.

## Akseptkriterier

- [ ] `saveFile` + `readFile` gir samme innhold og samme SHA-256, med lokal mappe (Vitest mot testdatabasen og en midlertidig mappe).
- [ ] Endret fil i lagringen gir feil ved henting (fingeravtrykket stemmer ikke).
- [ ] Nøkkel med `..`, absolutt sti eller tomme deler avvises av den lokale adapteren.
- [ ] Fil over 25 MB avvises før noe skrives.
- [ ] `markFileDeleted` setter `deleted_at`, filen ligger fortsatt i mappen, og `readFile` gir «ikke funnet» etterpå. Revisjonsloggen har en rad.
- [ ] `markFileDeleted` avvises når `retain_until` er i fremtiden, også for admin.
- [ ] Takstmann, kontor og leder kan ikke merke som slettet; admin kan.
- [ ] Azure-adapteren lagrer og henter mot en falsk klient (ingen nett). `FILE_STORAGE_DRIVER=azure` uten innstillinger gir tydelig feil uten hemmeligheter i meldingen.
- [ ] `readFileRetention` gir 10/2/10/10 uten innstillinger, leser egne verdier, og faller tilbake til standard (med advarsel) ved ugyldig verdi (negativ, ikke heltall, tekst).
- [ ] Bruker i annen organisasjon får verken lese, lagre i eller merke filer i Byggcon (`expectTenantIsolation` for hver spørring i tjenesten).
- [ ] Lint (inkludert modulgrensene), typesjekk og alle tester grønne. Prøvekandidatene er uendret.
- [ ] Ny avhengighet (`@azure/storage-blob`) er begrunnet i PR-en.
- [ ] Virker på iPad-størrelse: ikke relevant (ingen skjerm); eksisterende e2e skal fortsatt være grønn.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)

- **A39:** Porten har ingen slette-operasjon. «Slette» er bare `deleted_at` på raden; filinnholdet blir liggende. Opprydding etter oppbevaringstiden lages senere og må godkjennes. Kilde: regel 3, Ståles svar 25.10.2026 nr. 9 (minst 10 år), domenemodellen 4.12 («Ingenting med `retain_until` i fremtiden kan slettes, heller ikke av admin»).
- **A40:** Adapteren velges med miljøvariabel (`FILE_STORAGE_DRIVER`, standard `local`) til tilkoblingslaget med `integration_connections` kommer. Azure-adapteren er bare kode; Ståle slår den på når lagringskontoen finnes. Kilde: Ståles svar 27.10.2026 nr. 10 (eget lag, mulig lokalt arkiv), autonom modus (ingenting som koster penger).
- **A41:** Én ny avhengighet, `@azure/storage-blob` (Microsofts offisielle klient), i stedet for egen signering mot REST-grensesnittet. Enklere og sikrere. Kan byttes uten at resten av koden endres, fordi den bare brukes i adapteren.
- **A42:** Oppbevaringstidene ligger i `organizations.settings` med standard 10 år for avviksoriginaler, 2 år for andre originaler, 10 år for visningskopier og 10 år for andre filer. Den fjerde nøkkelen (`file.retention.default_years`) er lagt til fordi PDF og dokumenter også skal beholdes i 10 år. Kilde: Ståles svar 25.10.2026 nr. 9 og 27.10.2026 nr. 10, domenemodellen 4.8. Endres ved å skrive ny verdi i innstillingene.
- **A43:** Alle ansatte kan lagre og hente filer; bare admin kan merke en fil som slettet. Kilde: Ståles svar 27.10.2026 (alle takstmenn ser alt), regel 3. Kan strammes inn i `src/core/access`.

## Roller

- **utvikler** (bit 1: port, adaptere, skjema, migrering, tjeneste, innstillinger, dokumenter)
- **testskriver** (bit 2, i parallell: tester etter akseptkriteriene, fabrikk for `files`, tenant-isolasjon)
- **sikkerhet-personvern** (sti utenfor mappen, hemmeligheter i miljøvariabler og feilmeldinger, tilgang, ingen sletting)
- **test-leder** (testplan og gjennomgang)

Ikke med: ux, ui (ingen skjerm), fagansvarlig (ingen fagtekst), arkitekt (porten står allerede i domenemodellen og arkitekturen; ingen ADR trengs), KI.

## Åpne spørsmål

- Ingen som stopper PR-en. Når Ståle er tilbake: lagringskonto i Azure (koster penger) og hvor nøkkelen skal ligge (Key Vault, eget punkt) føres under «Trenger Ståle når han er tilbake».
