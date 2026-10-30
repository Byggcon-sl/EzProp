# Funksjon: Liten oppgave (g) og (h) – småfunn fra prøve F (PR #34) og prøve D (PR #35)

- **Fase:** 1 – Prøve uten nett
- **Modul:** offline-trial (prøve, kastes eller gjøres om etter ADR)
- **Status:** klar
- **Branch:** `fase1-smafunn-prove-d-f` (bygger på `main`, PR #34 og #35 er merget)
- **Versjon:** 0.2.26 → 0.2.27
- **Støtter hovedmål:** Reklamasjoner: en visningskopi som ikke kommer fram, sendes ikke lenger på nytt i stillhet hvert 10. sekund, men får en synlig status ved bildet, og serveren slipper bare gjennom felt som ikke kan bære posisjon eller tekst. Tid: færre doble tester gir raskere CI, og én vei for tegning og adresse gir mindre kode å rette i fase 2b. KI først: ikke direkte (se under).

## Problem
Gjennomgangene av PR #34 (prøve F) og PR #35 (prøve D) fant små ting som ikke stoppet mergen, men som skal rettes før prøvene brukes som grunnlag for synkvalget og ADR-en.

**(g) Prøve F:**
1. `src/modules/offline-trial/sync-status-text.test.ts` har to blokker for `signInRequired` («signInRequired» og «signInRequired i synkstatusen») som delvis sjekker det samme.
2. `src/modules/offline-trial/session-check.test.ts` har tre tester som sjekker det samme som andre tester i filen.
3. `e2e/fase-1-prove-f-innlogging.spec.ts`, trinn 7: meldingen «Logg inn på nytt for å sende» sjekkes tre ganger.
4. `e2e/helpers.ts`: `organizationIdOf` brukes ett sted og kan erstattes av det testen allerede har; `id` i `ServerTrialPhoto` brukes ikke.

**(h) Prøve D:**
5. `src/modules/offline-trial/sync/photo-uploader.ts`: en kopi som får 400 slettes, men lages på nytt i neste runde så lenge originalen venter. En kopi som får 404 (bildet er myk-slettet) blir liggende og sendes hvert 10. sekund. Ingen ser det.
6. `src/modules/offline-trial/server/photo-storage.ts`: `hasMetadataSegment` avviser bare `APP1` og `APP13`, og slipper `COM` og andre `APP`-felt. Teksten «uten metadata» lover mer.
7. `src/modules/offline-trial/sync/display-copy.ts` har to tegneveier (`OffscreenCanvas` og vanlig canvas).
8. `sendPhoto` får et falskt objekt `{ id } as TrialPhotoRow` når adressen er satt.
9. Adressen til visningsruten bygges både i `trial-form-view.tsx` og i `displayCopyUrl()`.
10. Noen e2e-saker i `e2e/fase-1-prove-d-bilder.spec.ts` dobler Vitest (401, 403, logg uten filnavn, PNG til JPEG).

Lar vi være: en kopi som feiler i det stille, en sjekk som lover mer enn den holder, og flere tester og kodeveier å vedlikeholde.

## KI først
Nei. Dette er opprydding i prøvekode og tester. Ingen oppgave her som KI kan forberede for takstmannen. Indirekte: bilder som ikke forsvinner i stillhet, og ærlige prøver, er grunnlaget for synkvalget som KI-forslagene senere bygger på.

## Brukerhistorier
- Som **takstmann** vil jeg se ved bildet når bare originalen er lagret, slik at jeg vet at bildet er sikret selv om visningskopien mangler.
- Som **Byggcon** vil jeg at visningskopien på serveren aldri har felt som kan bære posisjon eller tekst, slik at vi ikke lagrer mer enn nødvendig.
- Som **utvikler** vil jeg ha én vei for hver ting og ingen doble tester, slik at rettinger går raskt.

## Omfang
**Med:**

*(h) Prøve D*
1. **Endelig feilet kopi (beslutning A11).**
   - `uploadDisplayCopies` sender en kopi **bare når originalen er bekreftet lokalt** (`listConfirmedPhotoIds` / `CONFIRMED_STORE`). Kopier til bilder som ikke er bekreftet, blir liggende til en senere runde. Da betyr 404 alltid at bildet er myk-slettet, ikke at originalen mangler.
   - Får kopien 400 eller 404, slettes den lokalt, og det lagres en merknad i `photo-store.ts`. Merknaden lagres som **egen nøkkel i `CONFIRMED_STORE`** (for eksempel `display-failed:<uuid>`), ikke i et nytt lager. Da trengs ingen ny versjon av databasen, og e2e-testen som åpner databasen med versjon 2 virker som før.
   - Merknaden inneholder bare bilde-ID (uuid, i nøkkelen) og en fast kode for grunnen (`"400"` eller `"404"`). Ikke filnavn, ikke svartekst fra serveren, ikke organisasjons-ID.
   - `clearLocalPhotos` tømmer merknaden i samme transaksjon som `PHOTO_STORE` og `CONFIRMED_STORE` (følger av at den ligger i `CONFIRMED_STORE`).
   - `ensureDisplayCopy` lager ikke kopien igjen når merknaden finnes, og `uploadDisplayCopies` sender den aldri igjen.
   - Andre svar (ulikt fingeravtrykk, 5xx, nettfeil, tidsavbrudd, 401, 403) gir nytt forsøk som før. Originalen påvirkes aldri.
   - Ny `console.warn` ved 400 eller 404 har bare fast tekst, uten bilde-ID, filnavn eller svartekst.
2. **Synlig status.** I bildelisten i `trial-form-view.tsx` står «Bare originalen er lagret» i stedet for lenken «Vis fra serveren» for et bilde med merknaden. Teksten er vanlig tekst (ikke lenke), samme størrelse som bildenavnet, uten bilde-ID eller feilkode. Ingen ny skjerm, ingen ny knapp.
3. **Metadatasjekken slipper bare det som trengs (beslutning A12).** `hasMetadataSegment` godtar før `FF DA` bare `APP0`, `APP2`, `APP14`, og de tekniske merkene: `C0`–`CF` (bildeoppsett og tabeller), `DB` (DQT), `DD` (DRI), `TEM` og `RST0`–`RST7`. Alt annet før `FF DA` gir `true` (avvis): `APP1`, `APP3`–`APP13`, `APP15`, `COM` (`FE`), `JPGn` (`F0`–`FD`), `DE` og `DF`. Kommentaren oppdateres og sier ærlig at `APP2` (fargeprofil, ICC) kan ha korte tekstfelt som beskrivelse og opphavsrett, men ikke posisjon eller takstmannens notater, og at Chromium bare skriver en standard sRGB-profil. Én tabell i `photo-storage.test.ts`: avvis `COM`, `APP1` (Exif), `APP3`, `APP13`, `APP15`; godta `APP0`, `APP2`, `APP14`, `C0`–`CF`, `DB`, `DD`, `TEM`, `RST0`–`RST7`; avkortet segment avvises som før. e2e som sender en ekte kopi fra Chromium skal fortsatt bli godtatt.
4. **Én tegnevei i `display-copy.ts`.** Behold vanlig canvas (`document.createElement("canvas")` og `toBlob`), som finnes i alle nettlesere vi støtter. `OffscreenCanvas`-grenen og `hasCanvas` fjernes eller forenkles tilsvarende, og hjelpekoden for `OffscreenCanvas` i `display-copy.test.ts` fjernes. Ny Vitest: `toBlob` kalles med `"image/jpeg"` og `0.8`. «Mangler `createImageBitmap` eller canvas gir null» beholdes.
5. **Ingen falsk rad i `sendPhoto`.** Del i to tydelige kall: `sendPhoto(url, blob, contentType)` (eller tilsvarende) som bare sender, og originalens adresse bygges av kalleren med `originalUrl(...)`. Ingen `as TrialPhotoRow`.
6. **Adressen til visningsruten ett sted.** `trial-form-view.tsx` bruker `displayCopyUrl()`. Ligger funksjonen et sted visningen ikke kan importere fra uten å bryte modulgrensen, flyttes den til en liten fil i `src/modules/offline-trial/` som begge bruker.
7. **e2e i `e2e/fase-1-prove-d-bilder.spec.ts` (liste avgjort av test-leder):**
   - Fjernes: «uinnlogget gir 401» og «annen organisasjon gir 403» på visningsruten (dekket i `visning/route.test.ts`, linje 141, 186 og 288).
   - Fjernes: «PNG blir JPEG», men bare når `toBlob`-testen i punkt 4 finnes.
   - **Beholdes:** «loggen har aldri filnavnet». Ingen Vitest lytter på loggen i `photo-uploader.ts`, og den nye grenen for 400/404 skal også dekkes. (Kan fjernes senere hvis en Vitest som lytter på `console` i begge filene legges til; ikke med i denne oppgaven.)
   - Ny sak: «kopi som får 400 viser Bare originalen er lagret og sendes ikke igjen». `page.route` svarer 400 på `**/visning**`. Teksten vises, og lenken «Vis fra serveren» har antall 0 for bildet. Antall PUT til visningsruten er 1 etter minst to runder («Synk nå»). Etter reload står teksten fortsatt, og det kommer ingen ny PUT.
   - «innlogging i annen organisasjon tømmer» utvides: merknaden er også borte.
   - EXIF-6-saken (ekte kopi fra Chromium godtas) skal være grønn etter innstrammingen i punkt 3.
   - Hvert akseptkriterium i `docs/funksjoner/fase1-prove-d-bilder.md` og prøve F skal fortsatt ha minst én test (Vitest eller e2e).

*(g) Prøve F*

8. `sync-status-text.test.ts`: de to `signInRequired`-blokkene slås sammen til én. Med i den nye blokken (finnes bare i den første i dag): forrang foran «Alt er lagret» (status `true, true, 0, 0`), at alle fem markørene faktisk forekommer, og `signInHref` med `?neste=//evil.example`. «Synk nå er skjult …» og `signInHref`-tabellen i den gamle blokken fjernes, fordi `showSyncNow`- og lenkeblokkene dekker dem.
9. `session-check.test.ts`, disse tre fjernes: «expired gir meldingen, unknown beholder den …» (dekket av tabellen for `nextSignInRequired`), «json() som kaster gir unknown» (dekket av «ugyldig JSON» og «tom kropp»), «nettverksfeil gir unknown og kaster ikke» (dekket av «en sjekk som feilet, slipper låsen»). Synkron feil i `fetch` og tidsavbrudd beholdes.
10. e2e trinn 7 i `fase-1-prove-f-innlogging.spec.ts`: behold `toHaveText` på indikatoren og `role=status`; fjern de to sjekkene med `getByText(SIGN_IN_MESSAGE)`.
11. `e2e/helpers.ts`: `organizationIdOf` fjernes. I trinn 12 hentes forventet organisasjon med `hookValue(form, "organizationId")`, altså organisasjonen enheten har åpnet synken for (fra innloggingen), ikke fra radene på serveren. Da sammenlignes radene med en annen kilde, og sjekken er ikke tom. Ubrukt `id` i `ServerTrialPhoto` fjernes.

12. Versjon 0.2.27 i `package.json`.

**Ikke med (bevisst utelatt):**
- Nye funksjoner. Den eneste synlige endringen er teksten «Bare originalen er lagret» ved et bilde der kopien har feilet endelig.
- Tak på antall forsøk, nedtelling eller ny knapp for å prøve kopien igjen.
- At iPaden fjerner felt fra kopien i stedet for at serveren avviser (står som mulig endring i A10).
- Endret rekkefølge mellom tilgangssjekk og lesing av kroppen i visningsruten, og egen tillatelse for skriving (notert for fase 2a).
- To tidsavbrudd i `session-check.ts` og dobbel sjekk av `neste` i `login-form.tsx` (beholdes bevisst, se PR #34).
- Endringer i synkkandidatene, regelmotoren, prøve C eller prøve E.
- Prøve D og F på ekte iPad (Ståle, når han er tilbake).
- Ny avhengighet, migrering eller endring i databasen.

## Tilgang
Uendret. Ingen nye spørringer, ingen ny tilgangslogikk. Visningsruten og originalruten er som før.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som før | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
Ingen tabeller endres. Bare lokalt på iPaden: en merknad per bilde om at visningskopien har feilet endelig (prøvekode). Ordlisten endres ikke.

## Skjermer
Testskjemaet på iPad og PC: ved et bilde der kopien har feilet endelig, står «Bare originalen er lagret» i stedet for «Vis fra serveren». Ellers ingen endring. Samme antall trykk.

## Regler
Ingen.

## Akseptkriterier
- [ ] Kopi som får 400: `makeDisplayCopy` kalles én gang over tre runder, kopien sendes én gang, merknaden er satt. Dekker også at originalen ikke ble bekreftet i runde 1 (Vitest).
- [ ] Original ikke bekreftet (for eksempel nettfeil): kopien sendes ikke i den runden, og det blir ingen merknad; sendes når originalen er bekreftet (Vitest).
- [ ] Kopi som får 404: merknad, sendes ikke i runde 2 og 3 (Vitest).
- [ ] Ulikt fingeravtrykk, 500, nettfeil, tidsavbrudd, 401 og 403 gir nytt forsøk og ingen merknad (Vitest). I `it.each` på `photo-uploader.test.ts:322` flyttes 404 ut, og 401 og 403 legges til.
- [ ] Merknaden påvirker aldri originalen: originalen sendes og bekreftes som før (Vitest).
- [ ] Merknaden har bare uuid og fast kode (`"400"`/`"404"`); ny logging ved 400/404 har bare fast tekst.
- [ ] `clearLocalPhotos` tømmer merknaden (Vitest).
- [ ] Bildet med endelig feilet kopi viser «Bare originalen er lagret» og ingen lenke (e2e, pc og ipad).
- [ ] Merknaden tømmes når en annen organisasjon logger inn på samme enhet (utvid eksisterende test).
- [ ] `hasMetadataSegment` avviser `COM`, `APP3` og `APP15`, og godtar `APP0`, `APP2` og `APP14`; ekte kopi fra Chromium godtas fortsatt (e2e).
- [ ] `display-copy.ts` har én tegnevei; testene for kopien er grønne.
- [ ] Ingen `as TrialPhotoRow` i `photo-uploader.ts` (grep), og `sendPhoto(url, blob, contentType)` sender til adressen den får (Vitest).
- [ ] Adressen `/api/prove/bilder/<id>/visning` bygges bare ett sted i `src/` (grep, testfiler unntatt), og modulgrensene i `pnpm lint` er grønne.
- [ ] `git diff` har ingen ny SQL i `src/` og ingen endring i `src/core/access`.
- [ ] Ingen doble tester i de nevnte filene; alle akseptkriteriene i prøve D og F har fortsatt minst én test.
- [ ] `organizationIdOf` og ubrukt `id` er borte fra `e2e/helpers.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne (pc og iPad-størrelse).
- [ ] Bruker i annen organisasjon får ikke tilgang: ikke relevant, ingen nye spørringer (eksisterende tester for visningsruten står).
- [ ] Versjon 0.2.27.
- [ ] Planen: underpunkt krysset av under prøve D og under prøve F i `docs/07-utviklingsplan.md`.

## Roller
- **utvikler:** punkt 1–6 og 12 (kode i `photo-uploader.ts`, `photo-store.ts`, `photo-storage.ts`, `display-copy.ts`, `trial-form-view.tsx`), med Vitest for egen kode (punkt 1, 3, 4 og 5, og `it.each` i `photo-uploader.test.ts`).
- **testskriver:** punkt 7–11 (e2e for prøve D og F, `sync-status-text.test.ts`, `session-check.test.ts`, `e2e/helpers.ts`). Henger ikke sammen med utviklerens bit og går i parallell; den nye e2e-saken for «Bare originalen er lagret» skrives mot teksten i dette kortet.
- **test-leder:** avgjør hvilke tester som er doble, og godkjenner at prøve D og F fortsatt er dekket.
- **sikkerhet-personvern:** kort gjennomgang av punkt 3 (hvilke felt som slippes gjennom).

## Beslutninger (autonom modus)
- **A11:** kopi med 400 eller 404 er endelig feilet, med teksten «Bare originalen er lagret».
- **A12:** metadatasjekken er en liste over det som er lov (`APP0`, `APP2`, `APP14` og tekniske merker).

Begge står i `docs/09-apne-sporsmal.md`.

## Avgjort etter forhåndsvurdering (runde 1)
- **Når kopien sendes (sikkerhet-personvern, funn 1, alvorlig):** valgt «send bare når originalen er bekreftet lokalt», ikke «404 er endelig bare når originalen er bekreftet». Grunn: én regel på ett sted, færre forgreninger, og ingen kopi sendes før originalen er sikret. 404 betyr da alltid myk sletting.
- **Hvor merknaden lagres (test-leder 3, sikkerhet-personvern 2 og 3):** egen nøkkel i `CONFIRMED_STORE`. Enklest: ingen ny databaseversjon, tømmes automatisk av `clearLocalPhotos` i samme transaksjon, og e2e-testen med fast versjon 2 kan stå.
- **`organizationIdOf` (test-leder 2):** fjernes og erstattes av `hookValue(form, "organizationId")`. Det er en annen kilde enn radene på serveren (enheten, fra innloggingen), så sjekken i trinn 12 er ikke tom.
- **«loggen har aldri filnavnet»:** beholdes som e2e (test-leder), fordi Vitest ikke dekker loggen i `photo-uploader.ts`.

## Åpne spørsmål
- Ingen nye til Ståle.
