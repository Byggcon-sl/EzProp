# Funksjon: Prøve D – bilder

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (prøvemodulen)
- **Status:** klar til bygging (30.10.2026). Gjennomgått av forenkler, test-leder og sikkerhet-personvern; endringene er tatt inn, se «Avgjort ved gjennomgangen» nederst.
- **Branch:** `fase1-prove-d-bilder` (bygger på `main`)
- **Støtter hovedmål:**
  - **Reklamasjoner (hovedsak):** bildet er beviset ved tvist. Originalen kommer fram uendret (samme fingeravtrykk på iPad og server), og iPaden sletter aldri sin kopi før serveren har bekreftet. Bildene står riktig vei (kjent IVIT-feil: bilder ble rotert, `docs/kartlegging/ivit-detaljer.md` linje 29), og visningskopien har ikke GPS-posisjonen eller annen metadata, så den aldri havner i en PDF.
  - **Tid:** takstmannen gjør ingenting med bildene: ingen innstilling for HEIC, ingen rotering for hånd, ingen «last opp»-knapp. Opplastingen går av seg selv mens appen er åpen og fortsetter selv etter brudd.
  - **KI først:** se under.

## Problem

Prøve D i planen for prøvene (`docs/funksjoner/fase1-testskjema.md`, tabellen «Plan for prøvene») krever: ta bilder liggende og stående i HEIC, last opp med appen åpen, bryt nettet midt i og slå det på igjen, og sammenlign fingeravtrykk på iPad og server. Bestått når: riktig rotering, JPEG på serveren, opplastingen fortsetter der den slapp, samme fingeravtrykk.

**Det som allerede virker** (bildekøen fra kandidat 3 og PR #14):

| Krav | Status i dag | Hvor |
|---|---|---|
| Opplasting mens appen er åpen | virker: hvert 10. sekund, ved `online` og ved statusvarsel, ett bilde om gangen | `sync/photo-uploader.ts` |
| Fortsettelse etter brudd | virker per bilde: bekreftede bilder sendes ikke igjen, bildet som ble avbrutt sendes på nytt i sin helhet; tidsavbrudd per bilde | `photo-uploader.ts`, `photo-upload.ts` |
| Kontroll med fingeravtrykk | virker: SHA-256 regnes på iPaden, serveren svarer med sin, filen slettes lokalt bare når de er like | `photo-upload.ts`, `server/photo-storage.ts`, `photo-store.ts` |
| Komprimering på iPaden | **mangler** | |
| Riktig rotering | **mangler** (originalen lagres uendret, ingen kopi rettes) | |
| HEIC til JPEG | **mangler** (serveren tar imot alle `image/*`, ingen JPEG lages) | |
| Bildet kan ses fra serveren | **mangler** (Ståle kan ikke sjekke rotering på ekte iPad) | |
| E2E for brudd midt i og fingeravtrykk | delvis: egenbygd-e2e sjekker at bildet blir liggende til sha256 er bekreftet; brudd midt i en opplasting er ikke testet | `e2e/fase-1-egenbygd.spec.ts` |

Lar vi være, vet vi ikke før ADR-en om Safari på iPad klarer å lage visningskopier selv, og fase 2a må bygge bilder uten å vite det.

## KI først

Ikke i denne oppgaven, og KI får ikke tilgang til bildene her. Visningskopien er en liten, rettvendt JPEG uten GPS, men den kan fortsatt ha personopplysninger i selve bildet (for eksempel personer). Om og hvordan bilder kan sendes til KI (kvalitetssjekk, sortering, forslag til avvik, `docs/kartlegging/ki-funksjoner.md`), avgjøres når KI-funksjonen spesifiseres, etter regelen om at KI ikke får personopplysninger. Appen gjør alt med bildene selv, så takstmannen ikke må huske noe.

## Brukerhistorier

- Som **takstmann** vil jeg **ta bildet og gå videre**, slik at **bildet kommer riktig vei og trygt fram uten at jeg gjør noe mer**.
- Som **Ståle** vil jeg **se bildet slik serveren har det, og krysse av i en resultatmal**, slik at **prøve D kan tas med i sammenligningen og ADR-en**.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`)

- **A7 – GPS i bildene (spørsmål nr. 8):** originalen lastes opp uendret, med det kameraet la i filen (nødvendig for kontrollen med fingeravtrykk). Visningskopien som lages på iPaden, lagres uten EXIF og uten GPS, og serveren avviser en visningskopi med metadatafelt (APP1 og APP13). Om GPS i originalen skal beholdes i 10 år, avgjøres i fase 2b. Kilde: innspill D14 (`docs/kartlegging/innspill-datamodell-og-plan-2026-10-25.md`), P24 i sidemannskontrollen del 2, domenemodellen 4.8 (`display_file_id`). At Ståle slår av Stedstjenester for Safari på iPadene under prøven, står under «Trenger Ståle når han er tilbake».
- **A8 – Visningskopien:** lengste side 2000 punkter (mindre bilder forstørres ikke), JPEG med kvalitet 0,8, rettet etter retningen kameraet har lagret. Lages i nettleseren med det som finnes der (`createImageBitmap` og `canvas`), ingen ny avhengighet. Kilde: domenemodellen 4.8 (2000 punkter, ca. 0,3–0,6 MB) og P24 («komprimering til fast størrelse lokalt, original beholdes til server»; «EXIF-rotering normaliseres ved lagring»). Endres i konstantene `DISPLAY_MAX_EDGE_PX` og `DISPLAY_JPEG_QUALITY`.
- **A9 – «Fortsetter der den slapp» betyr per bilde:** bekreftede bilder sendes aldri igjen; bildet som ble avbrutt, sendes på nytt i sin helhet. Ingen opplasting i biter. Hvorfor: en visningskopi er under 1 MB og en original 3–4 MB, så et nytt forsøk koster sekunder, og det enkleste som virker holder for prøven. Kan endres i fase 2a hvis prøven på ekte iPad viser at det tar for lang tid på svakt nett.

## Omfang

**Med:**

1. **Visningskopi på iPaden**, ren funksjon i `src/modules/offline-trial/sync/display-copy.ts`:
   - `makeDisplayCopy(original: Blob): Promise<Blob | null>` dekoder med `createImageBitmap(original, { imageOrientation: "from-image" })`, skalerer så lengste side blir høyst `DISPLAY_MAX_EDGE_PX` (2000), tegner på et `canvas` og lager JPEG med `DISPLAY_JPEG_QUALITY` (0,8). Et bilde fra `canvas` har aldri EXIF, så GPS og annen metadata følger ikke med.
   - Klarer nettleseren ikke å dekode filen (for eksempel HEIC i Chromium), gir funksjonen `null` og logger bare feilnavnet (`error.name`), aldri filnavn eller noe fra filen. Originalen lastes da opp som vanlig; køen stopper aldri for dette.
   - `displaySize(width, height, maxEdge)` er en egen ren funksjon (Vitest), så skaleringen testes uten nettleser. Den runder av, gir aldri 0, og gir `null` for ugyldige mål (0, negativ, `NaN`).
2. **Bildekøen lager og sender visningskopien** (`photo-uploader.ts`, `photo-store.ts`), kandidatuavhengig og uten endring i de tre kandidatene eller i skjermen:
   - Før originalen sendes, lages visningskopien fra den lokale originalen og lagres med `putLocalPhoto` under nøkkelen `<photoId>:display` i det samme lageret (`photos`). Finnes den fra før (`getLocalPhoto`), lages den ikke på nytt. Finnes ikke originalen lokalt (allerede bekreftet), lages ingen kopi.
   - **Nøklene holdes fra hverandre slik:** originalene finnes alltid fra radene i synklageret (`store.listPendingPhotos()` og `isPhotoWaiting`), aldri ved å liste nøklene i lageret. En nøkkel med `:display` er aldri en rad, så den telles aldri i «Venter: N bilder». Visningskopien skrives aldri til lageret `confirmed`, så den kommer aldri i `listConfirmedPhotoIds`. Nytt i `photo-store.ts` er bare `deleteLocalPhoto(key)` og `listLocalDisplayCopyIds()` (gir photo-id-ene for nøklene som slutter på `:display`). `clearLocalPhotos` tømmer kopiene også, siden de ligger i samme lager.
   - Rekkefølge per runde: først originalene (som i dag), så visningskopiene som ligger lokalt. Kopien sendes med `sendPhoto` som i dag (tidsavbrudd, `undefined` ved nettfeil), med adressen for visningsruten som eneste forskjell. Ingen ny sendefunksjon.
   - Svar på kopien:
     - **Likt fingeravtrykk** (`shouldReleaseLocalPhoto`): kopien slettes lokalt med `deleteLocalPhoto`. Det er alt.
     - **Ulikt fingeravtrykk, 404, nettfeil eller tidsavbrudd:** kopien blir liggende og prøves igjen neste runde. 404 betyr at serveren ikke har mottatt originalen ennå.
     - **400 (serveren avviser kopien):** kopien slettes lokalt uten nytt forsøk, og originalen er sannheten. Slik prøves ikke en kopi fra Safari med metadata på nytt hvert 10. sekund for alltid. Bildet får da ingen visningskopi på serveren, og det telles i resultatmalen (D4). Er tallet over 0 på ekte iPad, er det et funn for ADR-en, ikke noe vi bygger rundt nå.
   - Rekkefølgen tåler at appen lukkes når som helst: er originalen bekreftet før kopien er laget, blir det ingen kopi for det bildet. Det telles også i resultatmalen.
3. **Serveren tar imot og viser visningskopien**, ny rute `src/app/api/prove/bilder/[id]/visning/route.ts`:
   - `PUT ?organisasjon=<id>`: tilgang med `requireOrganizationAccess(…, "organization.read")` som originalruten (passer for prøven; i fase 2a skal opplasting ha en egen skrivetillatelse). Id-en sjekkes med `isUuid` før noen sti bygges. Spørringen filtrerer på `grant.organizationId`, og raden i `trial_photos` må finnes i organisasjonen, ha `sha256` og `uploaded_at` (originalen er mottatt) og ikke være slettet (`deleted_at` er tom). Ellers 404, med samme svar for «finnes ikke», «annen organisasjon», «slettet» og «originalen ikke mottatt».
   - Bare `image/jpeg`. Filen må starte med JPEG-merket (`FF D8`) og ha **ingen metadatafelt**: `hasMetadataSegment(bytes)` går gjennom JPEG-merkene fram til bildedataene (`FF DA`) og avviser alle `APP1` (EXIF og XMP, der GPS kan ligge) og `APP13` (IPTC). `APP0` (JFIF) og `APP2` (fargeprofil) er lov. Funksjonen tolker ikke innholdet (ingen lesing av retning eller GPS). En ødelagt eller avkuttet fil regnes som avvist, gir 400 (aldri 500) og kan ikke få løkken til å henge. Alt dette gir 400, så GPS aldri kan lagres i en visningskopi selv om iPaden skulle sende feil fil.
   - Samme største filstørrelse og lesing som originalen (`readTrialPhotoBody`, 413 når den er for stor). Lagres som `TRIAL_UPLOAD_DIR/<organizationId>/<photoId>.display.jpg`; et nytt kall skriver over. Det er greit i prøven, fordi kopien er avledet og originalen aldri skrives av denne ruten. I fase 2a skal det lages en ny fil i stedet for å skrive over (myk sletting og 10 års oppbevaring). Svar `{ sha256 }`.
   - `GET ?organisasjon=<id>`: samme tilgang og filter, raden må ikke være slettet. Gir visningskopien med `Content-Type: image/jpeg`, `Cache-Control: private, no-store`, `Content-Disposition: inline` og `X-Content-Type-Options: nosniff` (kommer fra `src/shared/config/security-headers.ts`, som gjelder alle adresser også `/api`; e2e sjekker hodet). Finnes ikke filen, gir 404 med teksten «Bildet er ikke lastet opp ennå.»
   - Feil går gjennom `trialErrorResponse` som i dag, så kroppen logges aldri.
   - **Retting i originalruten (samme PR):** `storeTrialPhoto` krever også at raden ikke er slettet; et slettet bilde gir 404. Det er trygt for køen, fordi `isPhotoWaiting` allerede hopper over slettede rader.
   - Ingen migrering og ingen ny kolonne: om visningskopien finnes, avgjøres av filen. Funksjonene ligger i `server/photo-storage.ts` (`storeTrialDisplayCopy`, `readTrialDisplayCopy`, `hasMetadataSegment`).
4. **Lenke i bildefeltet** (`trial-form-view.tsx`): ved hvert filnavn i listen står lenken «Vis fra serveren» (åpner `GET`-ruten i ny fane). Ingen forhåndsvisning i skjemaet, ingen status per bilde. Lenken er minst 44 pt høy.
5. **Tester** (testplan skrives av test-leder i `docs/funksjoner/fase1-prove-d-bilder-testplan.md`):
   - **Vitest, rene funksjoner:**
     - `displaySize`: liggende, stående, kvadrat, mindre enn grensen (ikke forstørret), nøyaktig 2000, avrunding (aldri 0), ugyldige mål (0, `NaN`) gir `null`. Som én tabell med saker.
     - `hasMetadataSegment`: JPEG med bare `APP0` (lov), `APP0` + `APP2` (lov), `APP1` Exif etter `APP0` (avvist), `APP1` med XMP (avvist), `APP13` (avvist), avkuttet fil og fil med feil lengde i et felt (avvist uten å henge).
     - `makeDisplayCopy` som feiler logger bare feilnavnet.
   - **Vitest, ruten og funksjonene på serveren:**
     - PUT: 400 for annen type enn `image/jpeg`, 400 uten `FF D8`, 400 med metadata, 413 for stor fil, 404 for ugyldig id (ingen fil skrevet), 404 når raden ikke finnes, er slettet eller mangler `sha256`/`uploaded_at`, og `sha256` i svaret. Filen ligger alltid under `TRIAL_UPLOAD_DIR/<organizationId>`.
     - GET: 404 med «Bildet er ikke lastet opp ennå.» før opplasting, 404 for slettet rad, `no-store` på svaret.
     - `storeTrialPhoto`: slettet rad gir 404 (ny sak).
     - Tilgang: de fire rollene (takstmann, kontor, leder, admin) får PUT og GET; deaktivert ansatt og bruker som ikke er logget inn nektes. Som én tabell med saker.
     - Tenant-isolasjon: ett kall til `expectTenantIsolation` for `storeTrialDisplayCopy` og ett for `readTrialDisplayCopy`. Funksjonene tar én id, så de pakkes inn slik at hver id prøves og de som finnes, returneres. I tillegg: bruker A med egen organisasjons-id og bilde-id fra B får samme 404 som «finnes ikke», og ingen fil skrives eller leses.
   - **Vitest, bildekøen:** originalen sendes før kopien; kopien slettes lokalt bare ved likt fingeravtrykk; ulikt fingeravtrykk eller 404 gir nytt forsøk neste runde; 400 sletter kopien uten nytt forsøk; `makeDisplayCopy` som gir `null` eller kaster, stopper ikke originalen eller neste bilde; kopien lages ikke på nytt når den finnes; bekreftet original uten kopi gir ingen ny kopi; nøkler med `:display` er ikke med i `listConfirmedPhotoIds` eller i «Venter»; `clearLocalPhotos` tømmer kopiene.
   - **E2E** (Chromium, `pc` og `ipad`, kandidaten egenbygd som ikke trenger synktjenester), ny fil `e2e/fase-1-prove-d-bilder.spec.ts`:
     - **Uten nett:** bildene velges med `context.setOffline(true)` og lastes opp når nettet kommer tilbake.
     - **Rotering og metadata:** fixture `e2e/fixtures/test-photo-rotated.jpg` med EXIF-retning 6, oppdiktet GPS 0,0 og et rødt felt oppe til venstre i de lagrede pikslene. Originalen på serveren har samme fingeravtrykk som regnet i testen fra fixture-bytene. Visningskopien er JPEG, har bredde og høyde byttet om, har det røde feltet i hjørnet der retning 6 skal legge det (oppe til høyre), og `hasMetadataSegment` gir nei for bytene.
     - **Størrelse:** et bilde på 3000x1000 lages i testen selv (canvas til buffer, `setInputFiles` med buffer, ingen fil). Kopien blir 2000x667. Et lite bilde blir ikke forstørret.
     - **Brudd:** minst to bilder. Det første er bekreftet før bruddet; opplastingen av det andre avbrytes med `page.route(…).abort()`, så slippes nettet fram. Testen teller PUT per bilde-id: etter bekreftelse sendes det ingen nye for det bildet. På serveren er det én rad og én fil per bilde, med likt fingeravtrykk. `abort()` bryter før kroppen er sendt; det godtas for prøven (A9), og det ekte bruddet midt i en fil prøves på ekte iPad (D3).
     - **HEIC i Chromium:** to filer, `e2e/fixtures/test-photo.heic` (`image/heic`, kan ikke dekodes av Chromium) og et JPEG. Originalen lastes opp uendret med `image/heic`, uten visningskopi, og det andre bildet går gjennom.
     - **«Vis fra serveren»:** åpner en ny fane med 200, `image/jpeg` og `X-Content-Type-Options: nosniff`. Lenken er minst 44 pt høy på `ipad`.
   - **Fixturene** er faste, små filer (noen få kB) som sjekkes inn. Testplanen sier hvordan de ble laget og at de er oppdiktet (GPS 0,0, ingen ekte bilder). HEIC-fixturen trenger bare å være en liten fil med HEIC-hode som Chromium ikke kan dekode. Ingen skript i repoet og ingen ny avhengighet.
   - Overskriving av kopien får ingen egen testsak (det er ikke et akseptkriterium). Visningsruten testes ikke på nytt i e2e utover akseptkriteriene.
6. **Resultatmal for ekte iPad:** `docs/funksjoner/fase1-prove-d-bilder-resultat.md`, med avkryssing og felt for tall per kandidat (samme oppbygning som `fase1-prove-c-lagring-resultat.md`):
   - Før (med avkryssing): iPad-modell, iPadOS- og Safari-versjon, kamerainnstilling «Høy effektivitet» (HEIC) på, [ ] Stedstjenester for Safari av, og teksten «Ta bare bilder av nøytrale ting, ingen personer, ingen kunders boliger, ingen dokumenter eller skjermer med navn.»
   - **D1 Rotering:** 5 bilder liggende og 5 stående (også med iPaden opp ned). Åpne «Vis fra serveren» for hvert: står riktig vei.
   - **D2 HEIC og JPEG:** noter hvilken filtype originalen har på serveren (Safari kan selv gjøre HEIC om til JPEG i filvelgeren) og at visningskopien er JPEG. Noter størrelse på original og kopi for 3 bilder.
   - **D3 Brudd:** ta 20 bilder i flymodus, slå på nettet, slå av nettet igjen etter noen sekunder, så på igjen. Synkstatusen går til «0 bilder»; ingen bilder mangler eller er doble på serveren.
   - **D4 Fingeravtrykk:** synkstatusen viser 0 bilder som venter (iPaden sletter bare ved likt fingeravtrykk). Per kandidat noteres antall bilder der «Vis fra serveren» svarer «Bildet er ikke lastet opp ennå.» etter at alt er lastet opp (bilder uten visningskopi, også de serveren har avvist). Bør være 0; over 0 er et funn for ADR-en.
   - **D5 Tid:** omtrent hvor lang tid fra flymodus av til 0 bilder for 20 bilder.
   - Etter: testbildene ryddes på testserveren (står under «Trenger Ståle når han er tilbake»).
7. **Dokumentasjon:** A7–A10 i `docs/09-apne-sporsmal.md`, spørsmål nr. 8 merkes «avgjort av agentene (A7), del (b) tas i fase 2b»; ordlisten (`docs/05-domenemodell.md` avsnitt 8) får «visningskopi» → `display copy`; planen krysses av; versjon 0.2.22 → 0.2.23.

**Ikke med (bevisst utelatt):**

- Ingen opplasting i biter eller fortsettelse midt i en fil (A9).
- Ingen opplasting i bakgrunnen når appen er lukket (service worker eller Background Sync). Prøven sier «mens appen er åpen».
- Ingen konvertering eller rotering på serveren, og ingen ny avhengighet for bildebehandling (for eksempel `sharp` eller et HEIC-bibliotek). Klarer Safari ikke å lage kopien, er det et funn i prøven, ikke noe vi bygger rundt nå.
- Ingen fjerning av GPS fra originalen (del (b) av spørsmål nr. 8, fase 2b).
- Ingen miniatyr (`thumbnail_file_id`), ingen rotering for hånd, ingen markering, ingen bildetekst, ingen grense på antall bilder (fase 2a).
- Visningskopier telles ikke i «Venter: N bilder» i synkstatusen, og det er ingen egen teller i appen for avviste kopier (de telles i resultatmalen fra «Vis fra serveren»). Originalen er det som ikke må gå tapt.
- Ingen tolking av EXIF på serveren (retning, GPS); den finner bare metadatafeltene.
- Ingen egen skrivetillatelse for opplasting (fase 2a).
- Ingen endring i de tre kandidatene (`custom`, `powersync`, `electricsql`), i tabellene eller i migreringene.
- Ingen endring i prøve F (innlogging som har gått ut). Filene for den jobbes med på branchen `fase1-prove-f-innlogging` og røres ikke: innlogging, økt, `src/core/auth`, mellomvare og service worker.

## Tilgang

| Rolle | Se | Endre |
|---|---|---|
| takstmann | bilder i egen organisasjon | laste opp original og visningskopi |
| kontor | som takstmann (prøvesidene er åpne for alle roller, som i dag) | som takstmann |
| leder | som takstmann | som takstmann |
| admin | som takstmann | som takstmann |

Bare `src/core/access` sjekker tilgang, med `organization.read` for både PUT og GET som originalruten (egen skrivetillatelse i fase 2a). Deaktivert ansatt og bruker som ikke er logget inn nektes. Admin stenges aldri ute. Annen organisasjon får samme 404 som «finnes ikke» (test).

## Data

Ingen nye tabeller, kolonner eller migreringer. Ny fil på serveren per bilde: `<photoId>.display.jpg` ved siden av originalen. Lokalt på iPaden: nøkkelen `<photoId>:display` i lageret `photos` i `offline-trial-photos`, aldri i lageret `confirmed`. Ingen nye faste koder (`key`). Ingenting slettes på serveren; den lokale kopien på iPaden slettes når serveren har bekreftet den eller avvist den (400).

## Skjermer

iPad og PC: testskjemaet som i dag. Eneste endring: «Vis fra serveren» ved hvert bilde. Antall trykk for å ta et bilde er uendret (to). Ingen skisse; lenken følger designprinsippene om trykkflater (44 pt).

## Regler

Ingen regler som data. Skalering (`displaySize`) og metadatasjekken (`hasMetadataSegment`) er rene funksjoner med testsaker.

## Akseptkriterier

- [ ] Visningskopien er JPEG og uten metadata (sjekket på bytene), og står riktig vei for et bilde med EXIF-retning 6: bredde og høyde er byttet, og det kjente fargefeltet ligger i riktig hjørne (e2e, `pc` og `ipad`)
- [ ] Lengste side på visningskopien er høyst 2000 punkter (3000x1000 blir 2000x667), og et lite bilde forstørres ikke (e2e)
- [ ] Originalen på serveren har samme fingeravtrykk som filen som ble valgt, også når bildet ble tatt uten nett (e2e)
- [ ] Brudd i en opplasting med to bilder: hvert bilde kommer fram én gang med likt fingeravtrykk, og et bekreftet bilde sendes ikke igjen (e2e, teller PUT per bilde)
- [ ] En fil nettleseren ikke kan dekode (HEIC i Chromium) lastes opp som original med `image/heic`, og neste bilde går gjennom (e2e)
- [ ] Serveren avviser en visningskopi med `APP1` eller `APP13` og en ødelagt fil (400), og gir 404 når raden ikke finnes, er slettet eller originalen ikke er mottatt (Vitest)
- [ ] En visningskopi serveren avviser (400), slettes lokalt og prøves ikke igjen (Vitest)
- [ ] Et slettet bilde gir 404 både for originalen og visningskopien (Vitest)
- [ ] «Vis fra serveren» åpner bildet i ny fane med `image/jpeg`, og lenken er minst 44 pt høy på `ipad` (e2e)
- [ ] Bruker i annen organisasjon får ikke tilgang til PUT eller GET for visningskopien (`expectTenantIsolation` og egen test med bilde-id fra B)
- [ ] De fire rollene får PUT og GET; deaktivert og ikke innlogget nektes (Vitest)
- [ ] Ingen endring i `src/core/auth`, mellomvare, økt eller service worker (sjekkes med `git diff` ved godkjenningen)
- [ ] Resultatmalen for ekte iPad finnes, A7–A10 er ført, ordlisten og planen er oppdatert, versjonen er økt
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne

## Roller

Forenkler, sikkerhet-personvern (GPS, ny rute med filer), test-leder, utvikler, testskriver. Ikke arkitekt (ingen ADR, prøvekode), ikke ux eller ui (én lenke), ikke fagansvarlig (ikke fagstoff), ikke KI.

**Deling i parallell:**
- **Utvikler:** `display-copy.ts`, endringene i `photo-store.ts` og `photo-uploader.ts`, visningsruten, funksjonene og rettingen av `storeTrialPhoto` i `server/photo-storage.ts`, lenken i `trial-form-view.tsx`, resultatmalen, dokumentasjonen.
- **Testskriver:** fixturene, Vitest for `displaySize`, `hasMetadataSegment`, visningsruten med tilgang og tenant-isolasjon, og bildekøen, og e2e-filen `e2e/fase-1-prove-d-bilder.spec.ts`. Avtalt grensesnitt: navnene i omfang pkt. 1–4.

## Åpne spørsmål

- Spørsmål nr. 8 (b): skal GPS i originalen beholdes i 10 år? Tas i fase 2b, ikke blokkerende.

## Avgjort ved gjennomgangen (prosjektlederen, 30.10.2026)

- **Metadatasjekken avviser alle `APP1` og `APP13`**, ikke bare «APP1 med Exif» som forenkleren foreslo. Sikkerhet-personvern og test-leder viste at GPS også kan ligge i XMP (`APP1`) og IPTC (`APP13`). Det er like enkelt: funksjonen ser bare på merket, ikke innholdet, og en kopi fra `canvas` har aldri slike felt. Navnet blir derfor `hasMetadataSegment`. Ført som A10.
- **Avvist kopi (400) slettes lokalt uten nytt forsøk** (sikkerhet-personvern). Ellers kan en Safari som legger et lite Exif-felt i kopien, gi evige nye forsøk. Ingen egen teller i appen: bildet mangler da visningskopi på serveren, og det telles i D4 med «Vis fra serveren». To årsaker (ingen kopi laget, kopi avvist) er samme funn for ADR-en. Ført som A10.
- **Ingen `confirmLocalDisplayCopy` og ingen merknad i `confirmed` for kopier** (forenkler). Det løser også test-leders krav om at kopiene ikke kommer i `listConfirmedPhotoIds`.
- **Krav før kopien godtas:** raden må ha `sha256` og `uploaded_at` og ikke være slettet (test-leder og sikkerhet-personvern). Rettingen av `storeTrialPhoto` for slettede rader tas med, fordi den er én linje og samme mangel.
- **Overskriving får ingen egen testsak** (forenkler mot test-leder). Det er ikke et akseptkriterium, og det er vanlig filskriving. At det er greit i prøven og endres i fase 2a, står i omfang pkt. 3.
- **Faste fixturer i repoet**, ikke skript (forenkler; test-leder godtar begge). Unntak: bildet på 3000x1000 lages i e2e selv, fordi en fast fil i den størrelsen blir stor.
- **Fargefelt i hjørnet** (test-leder): byttet bredde og høyde skiller ikke retning 6 fra 8, så fixturen har et kjent rødt felt.
- **GET-ruten og «Vis fra serveren» beholdes** (forenkler): uten dem kan ikke D1 sjekkes på ekte iPad.
