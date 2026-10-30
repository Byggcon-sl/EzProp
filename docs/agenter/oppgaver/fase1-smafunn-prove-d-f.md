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
1. **Endelig feilet kopi (beslutning A11).** Får kopien 400 eller 404, slettes den lokalt, og det lagres en merknad i `photo-store.ts` (for eksempel i et eget lager eller som egen nøkkel, utvikleren velger det enkleste; tømmes av `clearLocalPhotos`). `ensureDisplayCopy` lager ikke kopien igjen når merknaden finnes, og `uploadDisplayCopies` sender den aldri igjen. Andre svar (nettfeil, 5xx, 401, 403) gir nytt forsøk som før. Originalen påvirkes aldri.
2. **Synlig status.** I bildelisten i `trial-form-view.tsx` står «Bare originalen er lagret» i stedet for lenken «Vis fra serveren» for et bilde med merknaden. Teksten er vanlig tekst (ikke lenke), samme størrelse som bildenavnet. Ingen ny skjerm, ingen ny knapp.
3. **Metadatasjekken slipper bare det som trengs (beslutning A12).** `hasMetadataSegment` godtar før `FF DA` bare `APP0`, `APP2`, `APP14`, og de tekniske merkene: `C0`–`CF` (bildeoppsett og tabeller), `DB` (DQT), `DD` (DRI), `TEM` og `RST0`–`RST7`. `COM` og alle andre `APP`-felt gir `true` (avvis). Kommentaren oppdateres. Testsaker for `COM`, `APP3` og `APP15` (avvis) og `APP14` (lov) i `photo-storage.test.ts`. e2e som sender en ekte kopi fra Chromium skal fortsatt bli godtatt.
4. **Én tegnevei i `display-copy.ts`.** Behold vanlig canvas (`document.createElement("canvas")` og `toBlob`), som finnes i alle nettlesere vi støtter. `OffscreenCanvas`-grenen og `hasCanvas` fjernes eller forenkles tilsvarende.
5. **Ingen falsk rad i `sendPhoto`.** Del i to tydelige kall: `sendPhoto(url, blob, contentType)` (eller tilsvarende) som bare sender, og originalens adresse bygges av kalleren med `originalUrl(...)`. Ingen `as TrialPhotoRow`.
6. **Adressen til visningsruten ett sted.** `trial-form-view.tsx` bruker `displayCopyUrl()`. Ligger funksjonen et sted visningen ikke kan importere fra uten å bryte modulgrensen, flyttes den til en liten fil i `src/modules/offline-trial/` som begge bruker.
7. **e2e som dobler Vitest fjernes** i `e2e/fase-1-prove-d-bilder.spec.ts`: 401 og 403 på visningsruten (dekket i `visning/route.test.ts`), «loggen har aldri filnavnet» hvis Vitest dekker loggen i `display-copy.ts` og `photo-uploader.ts`, og «PNG blir JPEG i kopien» hvis Vitest dekker typen. Test-leder avgjør endelig liste. Hvert akseptkriterium i `docs/funksjoner/fase1-prove-d-bilder.md` skal fortsatt ha minst én test (Vitest eller e2e). Én ny e2e-sak (eller utvidelse av en eksisterende): kopi som får 400 viser «Bare originalen er lagret» og sendes ikke igjen.

*(g) Prøve F*

8. `sync-status-text.test.ts`: de to `signInRequired`-blokkene slås sammen til én, uten doble saker.
9. `session-check.test.ts`: de tre doble testene fjernes (test-leder bekrefter hvilke).
10. e2e trinn 7 i `fase-1-prove-f-innlogging.spec.ts`: meldingen sjekkes én gang.
11. `e2e/helpers.ts`: `organizationIdOf` fjernes (testen bruker organisasjonen den allerede har, for eksempel fra raden i `serverTrialData`), og ubrukt `id` i `ServerTrialPhoto` fjernes.

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
- [ ] Kopi som får 400 lages ikke på nytt og sendes ikke igjen i neste runde (Vitest).
- [ ] Kopi som får 404 sendes ikke igjen i neste runde (Vitest).
- [ ] Nettfeil, 5xx, 401 og 403 gir fortsatt nytt forsøk (Vitest, eksisterende tester holder).
- [ ] Bildet med endelig feilet kopi viser «Bare originalen er lagret» og ingen lenke (e2e, pc og ipad).
- [ ] Merknaden tømmes når en annen organisasjon logger inn på samme enhet (utvid eksisterende test).
- [ ] `hasMetadataSegment` avviser `COM`, `APP3` og `APP15`, og godtar `APP0`, `APP2` og `APP14`; ekte kopi fra Chromium godtas fortsatt (e2e).
- [ ] `display-copy.ts` har én tegnevei; testene for kopien er grønne.
- [ ] Ingen `as TrialPhotoRow` i `photo-uploader.ts`.
- [ ] Adressen `/api/prove/bilder/<id>/visning` bygges bare ett sted i `src/`.
- [ ] Ingen doble tester i de nevnte filene; alle akseptkriteriene i prøve D og F har fortsatt minst én test.
- [ ] `organizationIdOf` og ubrukt `id` er borte fra `e2e/helpers.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne (pc og iPad-størrelse).
- [ ] Bruker i annen organisasjon får ikke tilgang: ikke relevant, ingen nye spørringer (eksisterende tester for visningsruten står).
- [ ] Versjon 0.2.27.
- [ ] Planen: underpunkt krysset av under prøve D og under prøve F i `docs/07-utviklingsplan.md`.

## Roller
- **utvikler:** punkt 1–6 og 12 (kode i `photo-uploader.ts`, `photo-store.ts`, `photo-storage.ts`, `display-copy.ts`, `trial-form-view.tsx`), med Vitest for egen kode (punkt 1, 3 og 5).
- **testskriver:** punkt 7–11 (e2e for prøve D og F, `sync-status-text.test.ts`, `session-check.test.ts`, `e2e/helpers.ts`). Henger ikke sammen med utviklerens bit og går i parallell; den nye e2e-saken for «Bare originalen er lagret» skrives mot teksten i dette kortet.
- **test-leder:** avgjør hvilke tester som er doble, og godkjenner at prøve D og F fortsatt er dekket.
- **sikkerhet-personvern:** kort gjennomgang av punkt 3 (hvilke felt som slippes gjennom).

## Beslutninger (autonom modus)
- **A11:** kopi med 400 eller 404 er endelig feilet, med teksten «Bare originalen er lagret».
- **A12:** metadatasjekken er en liste over det som er lov (`APP0`, `APP2`, `APP14` og tekniske merker).

Begge står i `docs/09-apne-sporsmal.md`.

## Åpne spørsmål
- Ingen nye til Ståle.
