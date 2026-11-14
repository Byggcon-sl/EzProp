# Testplan: Rett T-0070 og T-0071 – utløpt innlogging og nettbrudd under lagring

- **Oppgavekort:** `docs/agenter/oppgaver/rett-t0070-t0071.md`
- **Funn:** `docs/agenter/testlag/funn/T-0070-utlopt-innlogging-sletter-skjema.md`, `docs/agenter/testlag/funn/T-0071-engelsk-feilside-nar-nettet-faller.md`
- **Støtter hovedmål:** de ansatte (det som er skrevet går ikke tapt, norsk melding, tilbake til samme side), færre reklamasjoner (mindre ny skriving, færre glemte opplysninger). Ingen ny KI; meldingene og feilsidene bærer ingen persondata.

Testdata er oppdiktet. Alt kjøres i prosjektene `pc` og `ipad`.

## 1. Enhetstester

### 1a. `src/app/logg-inn/safe-next-path.test.ts` (utvid, behold de gamle sakene)

Godtas (gir verdien tilbake uendret):
- `/arbeidskoe`, `/prove/testskjema/<uuid>` (som før)
- `/oppdrag/<uuid>`, `/oppdrag/<uuid>/bygninger`, `/ordre/<uuid>`, `/firma`, `/statistikk/tid`
- `/oppdrag/<uuid>?fane=parter` (spørrestreng på intern side)

Avvises (gir `DEFAULT_NEXT_PATH`):
- `undefined`, `""`, en liste (`["/arbeidskoe"]`)
- `//evil.example`, `/\evil.example`, `\\evil.example`, `/\\evil`
- `http://evil.example`, `https:evil.example`, `javascript:alert(1)`, `data:text/html,x`
- `arbeidskoe` (uten innledende `/`)
- Kodede varianter: `/%2F%2Fevil.example`, `/%5Cevil.example`, `%2F%2Fevil.example`
- Kontrolltegn: `/oppdrag\n//evil`, `/oppdrag\t`, `/\u0000x`
- `/logg-inn`, `/logg-inn?neste=/arbeidskoe`, `/logg-inn/` (ingen løkke)
- `/oppdrag#x` hvis `#` ikke er tillatt (velg én oppførsel og test den)
- Svært lang verdi (over 2000 tegn)

Sjekk at lenken fra synkstatusen (`src/modules/offline-trial/sync-status-text.ts`) fortsatt godtas.

### 1b. `src/shared/forms/login-link.test.ts`
- `loginHref("/oppdrag/<uuid>/bygninger")` gir `/logg-inn?neste=%2Foppdrag%2F<uuid>%2Fbygninger`.
- `loginHref` med en sti som `safeNextPath` avviser, gir `/logg-inn` uten `neste`.
- Spørrestreng tas aldri med (ingen `q=` i lenken), selv om den sendes inn.

### 1c. `src/shared/forms/guarded-form-action.test.ts`
Med en falsk handling og `navigator.onLine` styrt i testen:
- Uten nett før sending: handlingen kalles ikke, svaret har `OFFLINE_MESSAGE`, verdiene fra `readValues`, `attempt` + 1.
- `TypeError` under sending: samme svar som over.
- Svar med `signedOut: true`: meldingen er `SIGNED_OUT_MESSAGE`, `link` er `{ href: loginHref(<sti>), text: "Logg inn" }`, verdiene står.
- Annen feil (for eksempel videresending etter lagring, `Error`): kastes videre uendret.
- Vellykket svar: gis tilbake uendret.

### 1d. Serverhandlingene (utvid eksisterende `actions.test.ts`-filer)
Med mock av `getEmployeeContextForAction` som gir «logget ut»:
- `savePropertyAction`, `addRoomsAction`, `saveBuildingAction`, `saveFloorAction`, `saveRoomAction`, `saveFloorAreaAction`, `updateOrderAction`: svaret har `signedOut: true`, `message = SIGNED_OUT_MESSAGE`, verdiene fra skjemaet, ingen videresending, ingenting lagret.
- Med innlogget bruker i annen organisasjon: fortsatt `NO_ACCESS` (eksisterende tenant-tester grønne).

### 1e. `src/core/auth/session.test.ts` (eller tilsvarende)
- `requireActor` uten innlogging og med stihode `/oppdrag/<uuid>` sender til `/logg-inn?neste=%2Foppdrag%2F<uuid>`.
- Uten stihode, eller med en sti `safeNextPath` avviser: til `/logg-inn`.
- Stihodet bærer aldri spørrestreng (proxyen setter bare `pathname`).

### 1f. Feilsidene: `src/app/error.test.ts` og `src/app/global-error.test.ts`
`renderToStaticMarkup` som i `src/shared/ui/notice.test.ts`, med en feil som har `message: "hemmelig-detalj"`, `stack` og `digest: "abc123"`:
- Norsk overskrift og setning, knappen «Prøv igjen», lenke til `/arbeidskoe`.
- Ingen av `hemmelig-detalj`, `abc123`, `Error`, `stack` i HTML.
- `global-error` har `<html lang="nb">`.
- Ingen engelske standardtekster («Application error», «Something went wrong»).

## 2. E2e: `e2e/fase-2a-rett-t0070-t0071.spec.ts`

Oppsett: logg inn som takstmann (`logInAsInspector`), lag eget oppdrag med `uniqueSuffix()` som i `e2e/fase-2a-rett-t0050-valg-etter-feil.spec.ts`. For ordren: lag en ordre som i `e2e/fase-2a-rette-ordre.spec.ts`. «Utløpt innlogging» lages med `page.context().clearCookies()` etter at skjemaet er fylt ut. «Uten nett» lages med `page.context().setOffline(true)`.

Innlogging tilbake: lag en hjelper (for eksempel `logInFromCurrentPage(page, email)` i `e2e/helpers.ts`) som fyller ut kodeskjemaet på siden man står på, uten `goto("/logg-inn")` og uten å vente på `/arbeidskoe`.

| Nr | Sak | Steg | Forventet |
|---|---|---|---|
| E1 | «Endre ordren», utløpt (funnet steg 1–4) | Åpne ordren, «Endre ordren», skriv i «Borettslag eller sameie», kryss av «Egenerklæring mottatt», slett informasjonskapslene, Lagre | Skjemaet står med teksten og avkrysningen. Meldingen «Du er logget ut. Logg inn igjen.» vises (`role="alert"`). Lenken «Logg inn» har `href` `/logg-inn?neste=%2Fordre%2F<id>`. Ordren er ikke endret |
| E2 | Tilbake etter innlogging | Fortsettelse av E1: trykk «Logg inn», logg inn med kode | Man havner på `/ordre/<id>`, ikke arbeidskøen |
| E3 | «Legg til flere rom», utløpt | Bygninger: legg til bygning og etasje, åpne «Legg til flere rom», sett tellere og valg, slett informasjonskapslene, Lagre | Dialogen er åpen, tellere og valg står, meldingen og lenken (`neste` = `/oppdrag/<id>/bygninger`) vises. Ingen rom er lagt til |
| E4 | «Lagre eiendom», utløpt | Fyll ut eiendomsskjemaet, slett informasjonskapslene, Lagre | Verdiene står, meldingen og lenken (`neste` = `/oppdrag/<id>`) vises. Etter innlogging via lenken: tilbake på `/oppdrag/<id>` |
| E5 | «Lagre eiendom», uten nett | Fyll ut, `setOffline(true)`, Lagre | «Du er uten nett. Endringen er ikke lagret.» vises, verdiene står, ingen engelsk feilside. Slå på nett, Lagre: lagres |
| E6 | «Legg til flere rom», uten nett | Som E3 med `setOffline(true)` | Samme melding, dialog, tellere og valg står. Slå på nett, Lagre: rommene lagres |
| E7 | Bygninger, uten nett | Legg til bygning (eller etasje), `setOffline(true)`, Lagre | Samme melding, skjemaet står |
| E8 | Side uten innlogging | Slett informasjonskapslene, gå til `/oppdrag/<id>/bygninger` | Sendt til `/logg-inn?neste=%2Foppdrag%2F<id>%2Fbygninger`. Etter innlogging: tilbake på bygningssiden |
| E9 | Ingen persondata i `neste` | Slett informasjonskapslene, gå til `/arbeidskoe?q=Oppdiktet%20Navn` | Adressen til innloggingen inneholder ikke `q=` eller navnet |
| E10 | Åpen videresending | Gå til `/logg-inn?neste=//evil.example` og `/logg-inn?neste=/%5Cevil.example`, logg inn | Havner i `/arbeidskoe` |
| E11 | Tastatur og skjermleser | Etter E1: Tab til «Logg inn»-lenken | Lenken nås med tastatur, meldingen har `role="alert"` eller `aria-live`, fokus står i skjemaet |

Sjekk at testen var rød: kjør E1, E3, E5 og E6 mot `main` før rettingen og skriv resultatet i PR-en.

## 3. Regresjon
- `e2e/fase-2a-rette-ordre.spec.ts` (inkludert uten nett i «Endre ordren»), `e2e/fase-2a-flere-rom.spec.ts`, `e2e/fase-2a-bygninger-areal-rom.spec.ts`, `e2e/fase-2a-eiendom-matrikkel.spec.ts`, `e2e/fase-1-prove-f-innlogging.spec.ts`, `e2e/fase-1-synkstatus.spec.ts` grønne.
- `pnpm lint` (modulgrenser: `src/shared` importerer ikke fra `src/core` eller `src/app`), `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.

## 4. Tilgang og tenant
Ingen nye spørringer og ingen nye tabeller. `getEmployeeContextForAction` bruker samme `findEmployeeGrant` som før; organisasjonen kommer fortsatt fra `grant.organizationId`. Eksisterende `expectTenantIsolation`-tester for handlingene skal være grønne.
