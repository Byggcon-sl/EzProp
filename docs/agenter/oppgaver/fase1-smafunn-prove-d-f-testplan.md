# Testplan: Småfunn fra prøve D (PR #35) og prøve F (PR #34)

- **Oppgavekort:** `docs/agenter/oppgaver/fase1-smafunn-prove-d-f.md`
- **Fase:** 1 – Prøve uten nett
- **Branch:** `fase1-smafunn-prove-d-f` (bygger på `main`)
- **Laget av:** test-leder, 30.10.2026 (før koding)
- **Støtter hovedmål:** Reklamasjoner: en visningskopi som ikke kommer fram, sendes ikke på nytt i stillhet, og takstmannen ser «Bare originalen er lagret». Serveren slipper bare gjennom felt som ikke kan bære posisjon eller tekst. Tid: færre doble tester og én vei for tegning og adresse. KI først: indirekte (synken er grunnlaget for KI-forslag på iPaden).

## Hva som skal vises

1. En kopi som får 400 eller 404 er endelig feilet: den lages ikke igjen, sendes ikke igjen, og har en merknad med bare uuid og fast kode.
2. En kopi sendes bare når originalen er bekreftet lokalt. Andre feil gir nytt forsøk som før. Originalen påvirkes aldri.
3. Merknaden ligger i `CONFIRMED_STORE`, men blir **aldri** lest som et bekreftet bilde (telles ikke, vises ikke som bekreftet).
4. Metadatasjekken er en liste over det som er lov.
5. Ryddingen (én tegnevei, ingen falsk rad, én adresse, færre doble tester) endrer ingen oppførsel, og prøve D og F er fortsatt dekket.

## Tilgang, tenant-isolasjon, admin, myk sletting

- **Ingen nye spørringer og ingen ny tilgangslogikk.** Kontroll ved gjennomgang: `git diff main -- src/core/access` er tom, og `git diff main -- src` har ingen ny SQL eller Drizzle-spørring. Derfor trengs ikke nytt `expectTenantIsolation`-kall.
- **Eksisterende tester skal stå uendret og grønne:** `src/app/api/prove/bilder/[id]/visning/route.test.ts` (401 linje 141, 403/annen organisasjon linje 186, tenant-isolasjon linje 288), tenant- og rolletestene i `photo-storage.test.ts` («bilde-id i en annen organisasjon gir 404-feil», «fremmed organisasjon gir AccessDeniedError», «alle fire roller kan laste opp, deaktivert ansatt nektes»). Det er disse som gjør det trygt å fjerne e2e-sakene for 401 og 403.
- **Admin:** ingen ny regel som kan stenge noen ute; dekket av rolletesten over.
- **Myk sletting:** 404 på kopien betyr myk-slettet rad. Eksisterende «404 når raden ikke finnes, er slettet, mangler sha256 eller uploaded_at» står. Ny klient-test U3 viser at 404 gir endelig feilet.
- **Lokal tenant-isolasjon:** merknaden tømmes når en annen organisasjon logger inn på samme enhet (U8 og E3).

## Regeltester

Ingen. Oppgaven rører ikke regler eller TG-logikk.

## 1. Enhetstester: `src/modules/offline-trial/sync/photo-uploader.test.ts` (utvikler)

Oppsett som i dag (`photoState`, `queue.replies`, `fakeStore`). Ingen ekte venting.

| # | Testnavn | Hva den viser |
|---|---|---|
| U1 | «kopi som får 400 lages og sendes én gang over tre runder, og får merknad» | Tre runder `uploadPendingPhotos`. `makeDisplayCopy` kalt 1 gang, `sentFor("display", id).length === 1`, merknaden `"400"` satt, kopien slettet lokalt. Originalen bekreftet. Erstatter dagens «400 på kopien sletter den lokalt uten nytt forsøk». |
| U2 | «kopien sendes ikke før originalen er bekreftet» | Runde 1: originalen får nettfeil. Ingen PUT til visningsruten, ingen merknad, kopien ligger. Runde 2: originalen får 200 med likt fingeravtrykk; kopien sendes etter originalen (`invocationCallOrder`). |
| U3 | «kopi som får 404 får merknad og sendes ikke i runde 2 og 3» | Merknad `"404"`, én PUT til visningsruten over tre runder, kopien slettet lokalt. |
| U4 | `it.each` «ulikt fingeravtrykk, 500, nettfeil, tidsavbrudd, 401 og 403 gir nytt forsøk neste runde og ingen merknad (%s)» | Endring av `it.each` på linje 322: 404 flyttes ut (til U3), 401 og 403 legges til. Etter runde 1: kopien ligger, ingen merknad. Runde 2: ny PUT. |
| U5 | «merknaden påvirker aldri originalen» | Med merknad satt for bilde A: et nytt bilde B i køen sendes og bekreftes som før; originalen til A er bekreftet og sendes ikke igjen. |
| U6 | «loggen ved 400 og 404 har bare fast tekst» | `vi.spyOn(console, "warn")`. Ingen argumenter inneholder uuid, filnavn, organisasjons-ID eller svartekst fra serveren (serveren svarer med en kropp som inneholder `"hemmelig-svar"`). Bare strenger. |
| U7 | «sendPhoto sender til adressen den får» | `sendPhoto(url, blob, contentType)` med en oppdiktet adresse: `fetch` kalt med nøyaktig den adressen, metode PUT, riktig `Content-Type`. Dagens «sendPhoto til visningsruten sender JPEG og samme tidsavbrudd» tilpasses ny signatur og beholdes. |

## 2. Enhetstester: merknaden i `photo-store.ts` (utvikler)

Fil: utvid den testfilen som i dag dekker `photo-store.ts` (eller `photo-uploader.test.ts` hvis lageret bare er falsket der). Ingen ny avhengighet.

| # | Testnavn | Hva den viser |
|---|---|---|
| U8 | «clearLocalPhotos tømmer merknaden» | Merknad satt, `clearLocalPhotos()`, merknaden er borte. |
| U9 | «merknaden er aldri et bekreftet bilde» | Med merknad `display-failed:<uuid>` i `CONFIRMED_STORE`: `listConfirmedPhotoIds()` inneholder ikke nøkkelen og ikke uuid-en (hvis originalen ikke er bekreftet). Telleren «Venter» endres ikke av merknaden. **Alvorlig hvis den mangler:** ellers kan en merknad få et bilde til å se bekreftet ut, og originalen sendes aldri. |
| U10 | «merknaden har bare uuid i nøkkelen og fast kode som verdi» | Verdien er nøyaktig `"400"` eller `"404"` (ingen objekter, ingen filnavn, ingen organisasjons-ID). |
| U11 | «ensureDisplayCopy lager ikke kopien når merknaden finnes» | `makeDisplayCopy` ikke kalt. |

## 3. Enhetstester: `src/modules/offline-trial/server/photo-storage.test.ts` (utvikler)

| # | Testnavn | Hva den viser |
|---|---|---|
| U12 | `it.each` «hasMetadataSegment avviser %s» | Avviser `COM` (`FE`), `APP1` (Exif), `APP3`, `APP13`, `APP15`. Gjerne også én `JPGn` (`F0`) og `DE`. |
| U13 | `it.each` «hasMetadataSegment godtar %s» | Godtar `APP0`, `APP2`, `APP14`, et utvalg av `C0`–`CF` (minst `C0`, `C4`, `CF`), `DB`, `DD`, `TEM`, `RST0` og `RST7`. |
| U14 | «avkortet segment avvises» | Som før. «ser ikke etter bildedataene» og «henger aldri» står. |

U12 og U13 skal være én tabell (eller to `it.each` side om side i samme `describe`). Dagens enkelttester som dekker det samme, fjernes.

## 4. Enhetstester: `src/modules/offline-trial/sync/display-copy.test.ts` (utvikler)

| # | Testnavn | Hva den viser |
|---|---|---|
| U15 | «toBlob kalles med image/jpeg og 0,8» | Vanlig canvas er falsket; `toBlob` kalt med `"image/jpeg"` og `0.8`. Forutsetning for å fjerne e2e «PNG blir JPEG». |
| U16 | «makeDisplayCopy gir null når nettleseren mangler createImageBitmap eller canvas» | Beholdes, tilpasset uten `OffscreenCanvas`. |
| – | Hjelpekoden for `OffscreenCanvas` | Fjernes. Grep: ingen `OffscreenCanvas` i `display-copy.ts` eller `display-copy.test.ts`. |

## 5. Rydding i Vitest for prøve F (testskriver)

| # | Fil | Endring | Hva som må stå igjen |
|---|---|---|---|
| R1 | `sync-status-text.test.ts` | De to `signInRequired`-blokkene (linje 223 og 345) blir én. | I den nye blokken: teksten ordrett, knappen heter Logg inn, uten nett vises aldri meldingen, forrang foran «Alt er lagret» med status `true, true, 0, 0`, at alle fem markørene faktisk forekommer, `signInHref` med `?neste=//evil.example`, ingen gjetteord, «uten signInRequired er alt som før». Fjernes: «Synk nå er skjult …» og `signInHref`-tabellen i den gamle blokken (dekket av blokkene for `showSyncNow` og `signInHref`). |
| R2 | `session-check.test.ts` | Fjern «expired gir meldingen, unknown beholder den …», «json() som kaster gir unknown», «nettverksfeil gir unknown og kaster ikke». | Tabellen for `nextSignInRequired`, «ugyldig JSON», «tom kropp», «synkron feil i fetch», «tidsavbrudd», «en sjekk som feilet, slipper låsen». |

Kontroll ved gjennomgang: antall testtilfeller i de to filene går ned, og hvert akseptkriterium i `docs/funksjoner/fase1-prove-f-innlogging.md` har fortsatt minst én test.

## 6. E2e (testskriver), prosjektene `pc` og `ipad`

`e2e/fase-1-prove-d-bilder.spec.ts`:

| # | Testnavn | Hva den viser |
|---|---|---|
| E1 | «kopi som får 400 viser Bare originalen er lagret og sendes ikke igjen» (ny) | `page.route("**/visning**")` svarer 400 på PUT og teller dem. Teksten «Bare originalen er lagret» vises ved bildet; `getByRole("link", { name: "Vis fra serveren" })` har antall 0. Minst to runder med «Synk nå»: antall PUT er 1. Etter reload: teksten står, ingen ny PUT (vent én runde). Teksten er ikke en lenke og inneholder ikke uuid eller «400». |
| E2 | «visningskopien telles ikke i Venter og havner aldri i confirmed» (finnes) | Står. Filteret på `":display"` dekker ikke `display-failed:`; testskriver legger til at `localConfirmedKeys` ikke har nøkler som begynner på `display-failed:` i denne saken (der kopien ikke feiler endelig). |
| E3 | «innlogging i annen organisasjon tømmer også visningskopiene» (utvides) | Legger også inn en merknad `display-failed:<uuid>` i `confirmed`. Etter innlogging i annen organisasjon er merknaden borte. Databasen åpnes fortsatt med versjon 2. |
| E4 | «visningskopien står riktig vei og har ingen metadata (EXIF-retning 6)» (finnes) | Grønn etter innstrammingen i punkt 3: en ekte kopi fra Chromium godtas. |
| E5 | «loggen har aldri filnavnet» (finnes) | Beholdes. Bør også gå gjennom grenen for 400 (enklest: kjør E1-oppsettet med samme lytter, eller legg 400 inn i denne saken). |
| – | «uinnlogget gir 401 på visningsruten», «annen organisasjon i adressen gir 403 på visningsruten» | Fjernes (dekket i `visning/route.test.ts`). |
| – | «PNG blir JPEG i kopien» | Fjernes bare hvis U15 finnes. |

`e2e/fase-1-prove-f-innlogging.spec.ts` og `e2e/helpers.ts`:

| # | Endring | Hva den viser |
|---|---|---|
| E6 | Trinn 7: behold `toHaveText` på indikatoren og sjekken av `role=status`; fjern de to `getByText(SIGN_IN_MESSAGE)`. | Meldingen sjekkes én gang, i riktig element. |
| E7 | Trinn 12: forventet organisasjon hentes med `hookValue(form, "organizationId")`. | Radene på serveren sammenlignes med organisasjonen enheten åpnet synken for. Sjekken er ikke tom (den må bli rød hvis radene har en annen organisasjon). |
| E8 | `organizationIdOf` og `id` i `ServerTrialPhoto` fjernes fra `e2e/helpers.ts`. | Grep: ingen treff. Typesjekken er grønn. |

iPad-størrelse: E1 kjøres i begge prosjekter. Teksten «Bare originalen er lagret» skal være synlig uten å rulle sidelengs. Den er ikke et trykkmål, så kravet om 44 punkter gjelder ikke.

Uten nett: dekket av eksisterende saker (bilder valgt uten nett, «kopiene sendes ikke uten nett» i Vitest). Ingen ny sak.

## 7. Kontroller med grep (ved gjennomgang)

- `grep -n "as TrialPhotoRow" src/modules/offline-trial/sync/photo-uploader.ts` gir ingen treff.
- `grep -rn "/visning" src --include=*.ts --include=*.tsx | grep -v test` gir bare stedet der `displayCopyUrl` bygger adressen (og ruten selv).
- `grep -rn "OffscreenCanvas" src/modules/offline-trial` gir ingen treff.
- `grep -rn "organizationIdOf" e2e` gir ingen treff.
- `pnpm lint` er grønn (modulgrensene, hvis `displayCopyUrl` flyttes).
- `package.json` har versjon 0.2.27.

## 8. Dekning av akseptkriteriene

| Akseptkriterium | Test |
|---|---|
| 400: én kopi, én sending over tre runder, merknad | U1 |
| Original ikke bekreftet: ingen sending, ingen merknad | U2 |
| 404: merknad, ingen ny sending | U3 |
| Andre svar gir nytt forsøk (it.each uten 404, med 401 og 403) | U4 |
| Merknaden påvirker aldri originalen | U5, U9 |
| Merknaden har bare uuid og fast kode; logging fast tekst | U6, U10 |
| `clearLocalPhotos` tømmer merknaden | U8 |
| «Bare originalen er lagret», ingen lenke (pc og ipad) | E1 |
| Merknaden tømmes ved annen organisasjon | E3 |
| Metadatasjekken; ekte Chromium-kopi godtas | U12–U14, E4 |
| Én tegnevei | U15, U16, grep |
| Ingen `as TrialPhotoRow`; `sendPhoto` sender til gitt adresse | U7, grep |
| Adressen ett sted, lint grønn | grep, `pnpm lint` |
| Ingen ny SQL, ingen endring i `src/core/access` | `git diff` |
| Ingen doble tester; prøve D og F fortsatt dekket | R1, R2, E1–E8, gjennomlesing |
| `organizationIdOf` og `id` borte | E8 |
| Alle fire kommandoer grønne | rapport |
| Annen organisasjon: ikke relevant | eksisterende `route.test.ts` og `photo-storage.test.ts` |
| Versjon 0.2.27 | `package.json` |
| Planen krysset av | `docs/07-utviklingsplan.md` |

## Avvises hvis

- U9 mangler (merknaden kan leses som bekreftet bilde).
- U1, U3 eller E1 mangler.
- e2e for 401/403 fjernes og `visning/route.test.ts` ikke dekker det.
- «PNG blir JPEG» fjernes uten U15.
- En eksisterende test for tilgang eller tenant-isolasjon er fjernet eller svekket.
