# Funksjon: Prøve D – bilder

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (prøvemodulen)
- **Status:** utkast (30.10.2026, prosjektlederen), til gjennomgang hos forenkler, test-leder og sikkerhet-personvern
- **Branch:** `fase1-prove-d-bilder` (bygger på `main`)
- **Støtter hovedmål:**
  - **Reklamasjoner (hovedsak):** bildet er beviset ved tvist. Originalen kommer fram uendret (samme fingeravtrykk på iPad og server), og iPaden sletter aldri sin kopi før serveren har bekreftet. Bildene står riktig vei (kjent IVIT-feil: bilder ble rotert, `docs/kartlegging/ivit-detaljer.md` linje 29), og visningskopien har ikke GPS-posisjonen, så den aldri havner i en PDF.
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

Ikke i denne oppgaven. Visningskopien er grunnlaget KI senere bruker til å se på bildene (kvalitetssjekk, sortering, forslag til avvik, `docs/kartlegging/ki-funksjoner.md`): en liten, rettvendt JPEG uten stedsdata er det som sendes til KI, ikke originalen. Appen gjør alt selv, så takstmannen ikke må huske noe.

## Brukerhistorier

- Som **takstmann** vil jeg **ta bildet og gå videre**, slik at **bildet kommer riktig vei og trygt fram uten at jeg gjør noe mer**.
- Som **Ståle** vil jeg **se bildet slik serveren har det, og krysse av i en resultatmal**, slik at **prøve D kan tas med i sammenligningen og ADR-en**.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`)

- **A5 – GPS i bildene (spørsmål nr. 8):** originalen lastes opp uendret, med det kameraet la i filen (nødvendig for kontrollen med fingeravtrykk). Visningskopien som lages på iPaden, lagres uten EXIF og uten GPS. Om GPS i originalen skal beholdes i 10 år, avgjøres i fase 2b. Kilde: innspill D14 (`docs/kartlegging/innspill-datamodell-og-plan-2026-10-25.md`), P24 i sidemannskontrollen del 2, domenemodellen 4.8 (`display_file_id`). At Ståle slår av Stedstjenester for Safari på iPadene under prøven, står under «Trenger Ståle når han er tilbake».
- **A6 – Visningskopien:** lengste side 2000 punkter (mindre bilder forstørres ikke), JPEG med kvalitet 0,8, rettet etter retningen kameraet har lagret. Lages i nettleseren med det som finnes der (`createImageBitmap` og `canvas`), ingen ny avhengighet. Kilde: domenemodellen 4.8 (2000 punkter, ca. 0,3–0,6 MB) og P24 («komprimering til fast størrelse lokalt, original beholdes til server»; «EXIF-rotering normaliseres ved lagring»). Endres i konstantene `DISPLAY_MAX_EDGE_PX` og `DISPLAY_JPEG_QUALITY`.
- **A7 – «Fortsetter der den slapp» betyr per bilde:** bekreftede bilder sendes aldri igjen; bildet som ble avbrutt, sendes på nytt i sin helhet. Ingen opplasting i biter. Hvorfor: en visningskopi er under 1 MB og en original 3–4 MB, så et nytt forsøk koster sekunder, og det enkleste som virker holder for prøven. Kan endres i fase 2a hvis prøven på ekte iPad viser at det tar for lang tid på svakt nett.

## Omfang

**Med:**

1. **Visningskopi på iPaden**, ren funksjon i `src/modules/offline-trial/sync/display-copy.ts`:
   - `makeDisplayCopy(original: Blob): Promise<Blob | null>` dekoder med `createImageBitmap(original, { imageOrientation: "from-image" })`, skalerer så lengste side blir høyst `DISPLAY_MAX_EDGE_PX` (2000), tegner på et `canvas` og lager JPEG med `DISPLAY_JPEG_QUALITY` (0,8). Et bilde fra `canvas` har aldri EXIF, så GPS og annen metadata følger ikke med.
   - Klarer nettleseren ikke å dekode filen (for eksempel HEIC i Chromium), gir funksjonen `null` og logger bare feilnavnet. Originalen lastes da opp som vanlig; køen stopper aldri for dette.
   - `displaySize(width, height, maxEdge)` er en egen ren funksjon (Vitest), så skaleringen testes uten nettleser.
2. **Bildekøen lager og sender visningskopien** (`photo-uploader.ts`, `photo-store.ts`), kandidatuavhengig og uten endring i de tre kandidatene eller i skjermen:
   - Før originalen sendes, lages visningskopien fra den lokale originalen og lagres lokalt under nøkkelen `<photoId>:display` i det samme lageret (`photos`). Finnes den fra før, lages den ikke på nytt.
   - Rekkefølge per runde: først originalene (som i dag), så visningskopiene som ligger lokalt. En visningskopi sendes først når serveren har raden (originalen er mottatt); ellers svarer serveren 404 og kopien prøves igjen neste runde.
   - Visningskopien har sin egen kontroll med fingeravtrykk (`shouldReleaseLocalPhoto`) og slettes lokalt bare når serveren har bekreftet. Nytt i `photo-store.ts`: `putLocalDisplayCopy`, `getLocalDisplayCopy`, `listLocalDisplayCopyIds`, `confirmLocalDisplayCopy`. `clearLocalPhotos` tømmer dem også (samme lager).
   - Rekkefølgen tåler at appen lukkes når som helst: er originalen bekreftet før kopien er laget, blir det ingen kopi for det bildet (originalen er sannheten). Det telles i prøven, se resultatmalen.
3. **Serveren tar imot og viser visningskopien**, ny rute `src/app/api/prove/bilder/[id]/visning/route.ts`:
   - `PUT ?organisasjon=<id>`: tilgang med `requireOrganizationAccess(…, "organization.read")` som originalen; spørringen filtrerer på `grant.organizationId`. Raden i `trial_photos` må finnes i organisasjonen, ellers 404 (samme svar for «finnes ikke» og «annen organisasjon»). Bare `image/jpeg`, filen må starte med JPEG-merket (`FF D8`), og **filen avvises (400) hvis den har et EXIF-felt** (`APP1` med `Exif`), så GPS aldri kan lagres i en visningskopi selv om iPaden skulle sende feil fil. Samme største filstørrelse og lesing som originalen (`readTrialPhotoBody`). Lagres som `TRIAL_UPLOAD_DIR/<organizationId>/<photoId>.display.jpg`; et nytt kall skriver over. Svar `{ sha256 }`.
   - `GET ?organisasjon=<id>`: gir visningskopien (`image/jpeg`, `Cache-Control: no-store`), samme tilgang og filter. Finnes den ikke, gir 404 med teksten «Bildet er ikke lastet opp ennå.»
   - Ingen migrering og ingen ny kolonne: om visningskopien finnes, avgjøres av filen. Funksjonene ligger i `server/photo-storage.ts` (`storeTrialDisplayCopy`, `readTrialDisplayCopy`, `hasExifSegment`).
4. **Lenke i bildefeltet** (`trial-form-view.tsx`): ved hvert filnavn i listen står lenken «Vis fra serveren» (åpner `GET`-ruten i ny fane). Ingen forhåndsvisning i skjemaet, ingen status per bilde. Lenken er minst 44 pt høy.
5. **Tester** (testplan skrives av test-leder i `docs/funksjoner/fase1-prove-d-bilder-testplan.md`):
   - Vitest: `displaySize` (liggende, stående, mindre enn grensen, kvadrat), `hasExifSegment` (med og uten EXIF, ikke-JPEG), visningsruten PUT og GET (tilgang, 404 uten rad, 400 med EXIF, 400 for annen type, sha256 i svaret, overskriving), og `expectTenantIsolation` for både PUT og GET. Bildekøen: rekkefølgen original → kopi, kopien slettes bare ved likt fingeravtrykk, 404 på kopien gir nytt forsøk, `makeDisplayCopy` som gir `null` stopper ikke originalen.
   - E2E (Chromium, `pc` og `ipad`, kandidaten egenbygd som ikke trenger synktjenester):
     - **Rotering og EXIF:** fixture `e2e/fixtures/test-photo-rotated.jpg` (liten, oppdiktet, EXIF-retning 6 og oppdiktede GPS-koordinater 0,0) gir på serveren en original med samme fingeravtrykk som filen, og en visningskopi som er JPEG, uten EXIF, med bredde og høyde byttet om.
     - **Brudd midt i:** første opplasting avbrytes (`page.route` som avbryter), så slippes nettet fram: bildet kommer fram én gang, fingeravtrykket er likt, og bekreftede bilder sendes ikke på nytt.
     - **HEIC i Chromium:** fixture `e2e/fixtures/test-photo.heic` (oppdiktet, `image/heic`) som Chromium ikke kan dekode: originalen lastes opp uendret, ingen visningskopi, køen går videre til neste bilde.
     - «Vis fra serveren» gir bildet etter opplasting.
   - Fixturene lages én gang med et lite skript i testmappen (eller som faste små filer) uten ny avhengighet. Ingen ekte bilder og ingen ekte posisjoner.
6. **Resultatmal for ekte iPad:** `docs/funksjoner/fase1-prove-d-bilder-resultat.md`, med avkryssing og felt for tall per kandidat (samme oppbygning som `fase1-prove-c-lagring-resultat.md`):
   - Før: iPad-modell, iPadOS- og Safari-versjon, kamerainnstilling «Høy effektivitet» (HEIC) på, Stedstjenester for Safari av.
   - **D1 Rotering:** 5 bilder liggende og 5 stående (også med iPaden opp ned). Åpne «Vis fra serveren» for hvert: står riktig vei.
   - **D2 HEIC og JPEG:** noter hvilken filtype originalen har på serveren (Safari kan selv gjøre HEIC om til JPEG i filvelgeren) og at visningskopien er JPEG. Noter størrelse på original og kopi for 3 bilder.
   - **D3 Brudd:** ta 20 bilder i flymodus, slå på nettet, slå av nettet igjen etter noen sekunder, så på igjen. Synkstatusen går til «0 bilder»; ingen bilder mangler eller er doble på serveren.
   - **D4 Fingeravtrykk:** synkstatusen viser 0 bilder som venter (iPaden sletter bare ved likt fingeravtrykk). Antall bilder uten visningskopi noteres (bør være 0).
   - **D5 Tid:** omtrent hvor lang tid fra flymodus av til 0 bilder for 20 bilder.
7. **Dokumentasjon:** A5–A7 i `docs/09-apne-sporsmal.md`, spørsmål nr. 8 merkes «avgjort av agentene (A5), del (b) tas i fase 2b»; ordlisten (`docs/05-domenemodell.md` avsnitt 8) får «visningskopi» → `display copy`; planen krysses av; versjon 0.2.22 → 0.2.23.

**Ikke med (bevisst utelatt):**

- Ingen opplasting i biter eller fortsettelse midt i en fil (A7).
- Ingen opplasting i bakgrunnen når appen er lukket (service worker eller Background Sync). Prøven sier «mens appen er åpen».
- Ingen konvertering eller rotering på serveren, og ingen ny avhengighet for bildebehandling (for eksempel `sharp` eller et HEIC-bibliotek). Klarer Safari ikke å lage kopien, er det et funn i prøven, ikke noe vi bygger rundt nå.
- Ingen fjerning av GPS fra originalen (del (b) av spørsmål nr. 8, fase 2b).
- Ingen miniatyr (`thumbnail_file_id`), ingen rotering for hånd, ingen markering, ingen bildetekst, ingen grense på antall bilder (fase 2a).
- Visningskopier telles ikke i «Venter: N bilder» i synkstatusen. Originalen er det som ikke må gå tapt.
- Ingen endring i de tre kandidatene (`custom`, `powersync`, `electricsql`), i tabellene eller i migreringene.
- Ingen endring i prøve F (innlogging som har gått ut). Filene for den jobbes med på branchen `fase1-prove-f-innlogging` og røres ikke: innlogging, økt, `src/core/auth`, mellomvare og service worker.

## Tilgang

| Rolle | Se | Endre |
|---|---|---|
| takstmann | bilder i egen organisasjon | laste opp original og visningskopi |
| kontor | som takstmann (prøvesidene er åpne for alle roller, som i dag) | som takstmann |
| leder | som takstmann | som takstmann |
| admin | som takstmann | som takstmann |

Bare `src/core/access` sjekker tilgang. Annen organisasjon får 404 (test).

## Data

Ingen nye tabeller, kolonner eller migreringer. Ny fil på serveren per bilde: `<photoId>.display.jpg` ved siden av originalen. Lokalt på iPaden: nøkkelen `<photoId>:display` i lageret `photos` i `offline-trial-photos`. Ingen nye faste koder (`key`).

## Skjermer

iPad og PC: testskjemaet som i dag. Eneste endring: «Vis fra serveren» ved hvert bilde. Antall trykk for å ta et bilde er uendret (to). Ingen skisse; lenken følger designprinsippene om trykkflater (44 pt).

## Regler

Ingen regler som data. Skalering (`displaySize`) og EXIF-sjekken (`hasExifSegment`) er rene funksjoner med testsaker.

## Akseptkriterier

- [ ] Visningskopien er JPEG, lengste side høyst 2000 punkter, uten EXIF, og står riktig vei for et bilde med EXIF-retning 6 (e2e, `pc` og `ipad`)
- [ ] Originalen på serveren har samme fingeravtrykk som filen som ble valgt (e2e)
- [ ] Brudd midt i en opplasting: bildet kommer fram én gang, og bekreftede bilder sendes ikke igjen (e2e)
- [ ] En fil nettleseren ikke kan dekode (HEIC i Chromium) lastes opp som original, og køen går videre (e2e)
- [ ] Serveren avviser en visningskopi med EXIF (400) og en visningskopi for et bilde som ikke finnes (404) (Vitest)
- [ ] «Vis fra serveren» viser bildet etter opplasting (e2e)
- [ ] Bruker i annen organisasjon får ikke tilgang til PUT eller GET for visningskopien (`expectTenantIsolation`)
- [ ] Virker på iPad-størrelse (e2e)
- [ ] Resultatmalen for ekte iPad finnes, A5–A7 er ført, ordlisten og planen er oppdatert, versjonen er økt
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne

## Roller

Forenkler, sikkerhet-personvern (GPS, ny rute med filer), test-leder, utvikler, testskriver. Ikke arkitekt (ingen ADR, prøvekode), ikke ux eller ui (én lenke), ikke fagansvarlig (ikke fagstoff), ikke KI.

**Deling i parallell:**
- **Utvikler:** `display-copy.ts`, endringene i `photo-store.ts` og `photo-uploader.ts`, visningsruten og funksjonene i `server/photo-storage.ts`, lenken i `trial-form-view.tsx`, resultatmalen, dokumentasjonen.
- **Testskriver:** fixturene, Vitest for `displaySize`, `hasExifSegment` og visningsruten med tenant-isolasjon, og e2e-filen `e2e/fase-1-prove-d-bilder.spec.ts`. Avtalt grensesnitt: navnene i omfang pkt. 1–4.

## Åpne spørsmål

- Spørsmål nr. 8 (b): skal GPS i originalen beholdes i 10 år? Tas i fase 2b, ikke blokkerende.
