# Testplan: Rett T-0070 og T-0071 – utløpt innlogging og nettbrudd under lagring

- **Oppgavekort:** `docs/agenter/oppgaver/rett-t0070-t0071.md`
- **Funn:** `docs/agenter/testlag/funn/T-0070-utlopt-innlogging-sletter-skjema.md`, `docs/agenter/testlag/funn/T-0071-engelsk-feilside-nar-nettet-faller.md`
- **Støtter hovedmål:** de ansatte (det som er skrevet går ikke tapt, innlogging i dialog over skjemaet, norske meldinger), færre reklamasjoner (mindre ny skriving, færre glemte opplysninger). Ingen ny KI; meldingene, feilsidene og adressene bærer ingen persondata.

Testdata er oppdiktet. Alt i e2e kjøres i prosjektene `pc` og `ipad`. Oppdatert 16.11.2026 etter forhåndsvurderingen fra forbedrer, sikkerhet-personvern og test-leder.

## 1. Enhetstester

### 1a. `src/shared/navigation/safe-next-path.test.ts` (flyttet fra `src/app/logg-inn/`, behold de gamle sakene)

Regel: høyst 200 tegn, `^/[a-z0-9-]+(?:/[a-z0-9-]+)*$`, første ledd ikke `logg-inn`, `api`, `_next` eller `dev`, ingen dekoding. Sakene er data i tabeller (`accepted`, `rejected`) som i dag.

**Godtas** (gir verdien tilbake uendret, og `isSafeNextPath` er sann):
- `/arbeidskoe`, `/prove/testskjema`, `/prove/testskjema/<uuid>` (som før)
- `/oppdrag/<uuid>`, `/oppdrag/<uuid>/bygninger`, `/ordre/<uuid>` (bare som verdi; ordrefilene røres ikke), `/firma`, `/statistikk/tid`, `/admin/ansatte/<uuid>`
- Nøyaktig 200 tegn

**Avvises** (gir `DEFAULT_NEXT_PATH`, og `isSafeNextPath` er usann):
- **Tomme verdier og lister:** `undefined`, `""`, `"/"`, en liste (`["/arbeidskoe"]`)
- **Annen nettside:**
  - `//evil.example`, `/\evil.example`, `\\evil.example`, `/\\evil`
  - `http://evil.example`, `https:evil.example`, `javascript:alert(1)`, `data:text/html,x`
  - `/oppdrag@evil.example`
- **Uten innledende skråstrek:** `arbeidskoe`
- **Kodet:**
  - `/%2F%2Fevil.example`, `/%2F/evil`, `/%5Cevil.example`, `%2F%2Fevil.example`
  - dobbelt kodet: `/%252F%252Fevil.example`
- **Kontrolltegn og mellomrom:** `/\t/evil.example`, `/\n/evil.example`, `/oppdrag\n//evil`, `/oppdrag\t`, `/\u0000x`, `/oppdrag /x`
- **Punktum:** `/.`, `/..`, `/oppdrag/../logg-inn`, `/oppdrag/./x`
- **Spørrestreng og `#`:** `/oppdrag/<uuid>?fane=parter`, `/arbeidskoe?q=Oppdiktet`, `/oppdrag#x`
- **Store bokstaver:** `/Arbeidskoe`, `/LOGG-INN`
- **Løkke og interne ruter:**
  - `/logg-inn`, `/logg-inn/`, `/logg-inn?neste=/arbeidskoe`, `/logg-inn/x`, `/%6Cogg-inn`
  - `/api/auth/get-session`, `/api`, `/_next/static/x`, `/dev/epost`
- **Avslutning og doble skråstreker:** `/oppdrag/` og `/oppdrag//x`
- **Lengde:** 201 tegn, og en svært lang verdi (over 2000 tegn)

Sjekk også at lenken fra synkstatusen (`signInHref` i `src/modules/offline-trial/sync-status-text.ts`) fortsatt godtas.

Statisk sjekk: det finnes bare én `safe-next-path.ts` i `src/`. `src/app/logg-inn/page.tsx` og `login-form.tsx` importerer fra `@/shared/navigation/safe-next-path`.

### 1b. `src/shared/forms/login-link.test.ts`
- `loginHref("/oppdrag/<uuid>/bygninger")` gir `/logg-inn?neste=%2Foppdrag%2F<uuid>%2Fbygninger`.
- `loginHref` med en sti som `safeNextPath` avviser (`//evil.example`, `/logg-inn`), gir `/logg-inn` uten `neste`.
- `loginHref("/arbeidskoe?q=Oppdiktet%20Navn")` gir `/logg-inn` uten `neste`. Lenken har aldri `q=` eller navnet.

### 1c. `src/shared/forms/guarded-form-action.test.ts`
Med en falsk handling og `navigator.onLine` styrt i testen:
- **Uten nett før sending:** handlingen kalles ikke. Svaret har `OFFLINE_MESSAGE` og verdiene fra `readValues`, og `attempt` øker med 1.
- **`TypeError` under sending:** samme svar som over.
- **`online`-hendelse mens meldingen om manglende nett vises:** meldingen blir «Nettet er tilbake. Trykk Lagre.» (`aria-live="polite"`), og handlingen kalles ikke av seg selv.
- **`online` uten at meldingen vises:** ingen endring.
- **Svar med `signedOut: true`:**
  - meldingen er `SIGNED_OUT_MESSAGE`, og verdiene står;
  - `link.href` er `loginHref(<sti>)`, og `link.text` er «Logg inn».
- **Annen feil** (for eksempel videresending etter lagring, `Error`): kastes videre uendret.
- **Vellykket svar:** gis tilbake uendret.
- **Statisk test av kildefilene** i `src/shared/forms/`: ingen `localStorage`, `sessionStorage`, `indexedDB` eller `console.`. Ingen import fra `@/core` eller `@/app`, noe lint også sjekker.

### 1d. Serverhandlingene (utvid eksisterende `actions.test.ts`-filer)
Gjelder `savePropertyAction`, `addRoomsAction` og bygningshandlingene (`saveBuildingAction`, `saveFloorAction`, `saveRoomAction`, `saveFloorAreaAction`, og de andre som `buildings-editor.tsx` bruker). **Ikke** `updateOrderAction`, fordi ordrefilene ikke røres.

- **Logget ut** (mock av `getEmployeeContextForAction` med `{ status: "signed_out" }`):
  - svaret har `signedOut: true`, `message = SIGNED_OUT_MESSAGE` og bare feltene skjemaet sendte;
  - ingen videresending, og ingenting lagret;
  - kjernen og validering kalles ikke (spion på kjernefunksjonen: 0 kall), også når skjemaet er ugyldig eller id-en ikke finnes;
  - svaret er det samme for en id som finnes og en som ikke finnes.
- **Innlogget uten aktiv ansattrad** (myk slettet ansatt): `NO_ACCESS`, ikke `signedOut`.
- **Tenant:**
  - En bruker i organisasjon A sender skjema med `organizationId` eller id-er fra organisasjon B. Det gir `NO_ACCESS`, og radene i B er uendret (samme verdier, samme `updated_at`).
  - Etter «ny innlogging» som en bruker fra organisasjon B i samme test gir Lagre på A sitt oppdrag `NO_ACCESS`.
- **Roller:** admin, leder, kontor og takstmann får lagret i hver handling. Admin stenges ikke ute.
- **Logging:** ingen skjemaverdier i loggen (spion på loggeren, sjekk at oppdiktede verdier som «Oppdiktet gate 1» ikke finnes i noe kall).
- **Gamle tester:** de eksisterende `expectTenantIsolation`-testene er grønne. Lager handlingene nye spørringer, får de et eget `expectTenantIsolation`-kall.

### 1d-2. `src/app/(ansatt)/employee-context.test.ts`
- `getEmployeeContextForAction`:
  - uten økt: `{ status: "signed_out" }`;
  - innlogget uten ansattrad, eller med myk slettet rad: `{ status: "no_access" }`;
  - ansatt: `{ status: "ok", context }` med `context.organizationId === grant.organizationId`. Organisasjonen hentes aldri fra adressen eller skjemaet.
  - Den videresender aldri (ingen `redirect`).
- `getEmployeeContext` oppfører seg som før: videresending uten økt og `null` uten ansattrad. Ordrefilene bruker den.

### 1e. `src/core/auth/session.test.ts` og `src/proxy.test.ts`
- **`requireActor` uten innlogging:**
  - med `x-request-path: /oppdrag/<uuid>` sender den til `/logg-inn?neste=%2Foppdrag%2F<uuid>`;
  - uten hode, eller med en sti `isSafeNextPath` avviser (`//evil.example`, `/logg-inn`, `/api/x`), sender den til `/logg-inn` uten `neste`.
- **`requireActor` med innlogging:** gir aktøren, uten videresending (som før).
- **`getActorForAction`:** gir `null` uten økt og videresender aldri.
- **Proxyen:**
  - hodet er nøyaktig `pathname`, og `/arbeidskoe?q=Oppdiktet` gir `/arbeidskoe`;
  - en forespørsel der klienten selv har satt `x-request-path: //evil.example`, får proxyens verdi;
  - proxyen gjør ingen innloggingssjekk eller videresending og logger ingenting (spion på loggeren og `console`);
  - `matcher` tar ikke med `/api/…`, `/_next/…`, `/logg-inn` og filer med endelse.

### 1f. Feilsidene: `src/app/error.test.ts` og `src/app/global-error.test.ts`
Bruk `renderToStaticMarkup` som i `src/shared/ui/notice.test.ts`, og en egen render med klikk for knappen. Feilen har `message: "hemmelig-detalj"`, `stack` og `digest: "abc123"`.
- **Innhold:** norsk overskrift og setning, knappen «Prøv igjen» og lenke til `/arbeidskoe`.
- **Ingen detaljer:** verken `hemmelig-detalj`, `abc123`, `Error` eller `stack` finnes i HTML.
- **Ingen engelske standardtekster** («Application error», «Something went wrong»).
- **«Prøv igjen»:** ett klikk kaller `router.refresh` (mock av `next/navigation`) og `reset`, hver én gang.
- **Uten nett** (`navigator.onLine` usann): `error.tsx` viser «Du er uten nett. Siden kan ikke hentes nå.».
- **Statisk sjekk:**
  - begge filene starter med `"use client"`;
  - ingen `console.`, `fetch(` eller `sendBeacon`, og ingen adresse som starter med `http`;
  - `global-error.tsx` importerer `globals.css` og har `<html lang="nb">`.
- **Størrelse:** knapp og lenke har klassen som gir minst 44 px høyde (`min-h-11` eller tilsvarende).

### 1g. `src/app/logg-inn/login-form.test.ts` (utvid) og `sign-in-dialog.test.ts`
- `LoginForm` med `initialEmail` viser e-posten utfylt.
- Med `onSignedIn` kalles den etter vellykket kode, og `router.replace` og `router.refresh` kalles ikke.
- Uten de nye egenskapene: oppførsel som før (eksisterende tester grønne).
- Dialogen viser ikke «Logg inn med Microsoft».

## 2. E2e: `e2e/fase-2a-rett-t0070-t0071.spec.ts`

**Oppsett:**
- Logg inn som takstmann (`logInAsInspector`), og lag eget oppdrag med `uniqueSuffix()` som i `e2e/fase-2a-rett-t0050-valg-etter-feil.spec.ts`.
- «Utløpt innlogging» lages med `page.context().clearCookies()` etter at skjemaet er fylt ut.
- «Uten nett» lages med `page.context().setOffline(true)`.

**Hjelpere** i `e2e/helpers.ts`:
- `logInInDialog(page)` henter koden fra `/dev/epost` i en egen side og fyller den inn i dialogen.
- `logInFromCurrentPage(page, email)` fyller ut kodeskjemaet på innloggingssiden man står på, uten `goto("/logg-inn")` og uten å vente på `/arbeidskoe`.

**«Ikke lastet på nytt»** sjekkes slik: sett `window.__marker = 1` før Lagre, og sjekk at den finnes etterpå.

**«Ingenting lagret»** sjekkes i databasen (som i de andre e2e-testene): samme antall rader og samme verdier, og ingen nye rader med `deleted_at` lik null.

| Nr | Sak | Steg | Forventet |
|---|---|---|---|
| E1 | «Lagre eiendom», utløpt (funnet steg 1–4, på eiendom i stedet for ordre) | Fyll ut eiendomsskjemaet, slett informasjonskapslene, Lagre | Skjemaet står med verdiene. «Du er logget ut. Logg inn igjen.» vises (`role="alert"`) med knappen «Logg inn» (`href` `/logg-inn?neste=%2Foppdrag%2F<id>`). Eiendommen er ikke endret i databasen |
| E2 | Innlogging i dialogen | Fortsettelse av E1: trykk «Logg inn», e-posten er fylt ut, skriv koden | Dialogen lukkes, verdiene står, fokus er på Lagre, og «Du er logget inn igjen. Trykk Lagre.» vises. Trykk Lagre: eiendommen er lagret i databasen, og siden er ikke lastet på nytt |
| E3 | «Legg til flere rom», utløpt | Bygninger: legg til bygning og etasje, åpne «Legg til flere rom», sett tellere og valg, slett informasjonskapslene, Lagre | Dialogen er åpen, tellere og valg står, og meldingen og knappen vises. Ingen rom er lagt til i databasen. Logg inn i dialogen og trykk Lagre: rommene er lagt til |
| E4 | Bygninger, utløpt | Legg til bygning (eller etasje), slett informasjonskapslene, Lagre | Verdiene står, og meldingen og knappen vises. Logg inn i dialogen og trykk Lagre: lagret, uten ny lasting |
| E5 | «Lagre eiendom», uten nett | Fyll ut, `setOffline(true)`, Lagre | «Du er uten nett. Endringen er ikke lagret.» vises, verdiene står, og det kommer ingen engelsk feilside. Databasen er uendret. Slå på nett: «Nettet er tilbake. Trykk Lagre.» vises, og ingenting lagres før Lagre. Lagre: lagret |
| E6 | «Legg til flere rom», uten nett | Som E3 med `setOffline(true)` | Samme melding, og dialog, tellere og valg står. Ingen rom i databasen. Slå på nett, Lagre: rommene lagres |
| E7 | Bygninger, uten nett | Legg til bygning (eller etasje), `setOffline(true)`, Lagre | Samme melding, skjemaet står, og databasen er uendret |
| E8 | Side uten innlogging | Slett informasjonskapslene, gå til `/oppdrag/<id>/bygninger` | Sendt til `/logg-inn?neste=%2Foppdrag%2F<id>%2Fbygninger`. Etter innlogging (`logInFromCurrentPage`): tilbake på bygningssiden |
| E9 | Ingen persondata i `neste` | Slett informasjonskapslene, gå til `/arbeidskoe?q=Oppdiktet%20Navn` | Adressen til innloggingen inneholder ikke `q=` eller navnet |
| E10 | Åpen videresending | Gå til `/logg-inn?neste=//evil.example`, `/logg-inn?neste=/%5Cevil.example` og `/logg-inn?neste=/api/auth/get-session`, og logg inn | Havner i `/arbeidskoe` |
| E11 | Tastatur og skjermleser | Etter E1: Tab til «Logg inn», Enter, fyll ut koden med tastatur, Esc i en ny runde | Knappen nås med tastatur, og meldingen har `role="alert"`. Dialogen får fokus ved åpning, Esc lukker den, og fokus går tilbake til Lagre |
| E12 | Utlogget ved fokus | Åpne eiendomsskjemaet, slett informasjonskapslene, send `visibilitychange` (sett `document.visibilityState` til `hidden` og så `visible`) | «Du er logget ut. Logg inn før du lagrer.» vises med knappen «Logg inn». Skjemaet er urørt |
| E13 | Feilside | Gå til en side som kaster feil i test (bruk en eksisterende testrute, eller `page.route` som gir 500 på RSC-forespørselen) | Norsk feilside med «Prøv igjen» og lenke til arbeidskøen, uten «Application error» |

«Endre ordren» er tatt ut 16.11.2026: ordrefilene røres ikke mens «Tilbud i stedet for ordre» bygges. Testen for ordreskjemaet følger med tilbudet.

Sjekk at testen var rød: kjør E1, E3, E5 og E6 mot `main` før rettingen, og skriv resultatet i PR-en.

## 3. Regresjon
- Disse e2e-testene skal være grønne:
  - `e2e/fase-2a-rette-ordre.spec.ts` (også uten nett i «Endre ordren»). Den bruker `getEmployeeContext`, som ikke endres.
  - `e2e/fase-2a-flere-rom.spec.ts`
  - `e2e/fase-2a-bygninger-areal-rom.spec.ts`
  - `e2e/fase-2a-eiendom-matrikkel.spec.ts`
  - `e2e/fase-1-prove-f-innlogging.spec.ts`
  - `e2e/fase-1-synkstatus.spec.ts`
- `pnpm lint` er grønn. Modulgrensene sier at `src/shared` ikke importerer fra `src/core` eller `src/app`.
- `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## 4. Omfang
`git diff --stat main` viser ingen endring i disse:
- `src/app/(ansatt)/ordre/` (også `actions.ts` og `order-edit-form.tsx`);
- badmalen og filene for «Badet på PC».

`employee-context.ts` har bare den nye funksjonen og typen. `getEmployeeContext` er uendret, noe 1d-2 sjekker.

## 5. Tilgang og tenant
Ingen nye tabeller. `getEmployeeContextForAction` bruker samme `findEmployeeGrant` som før, og organisasjonen kommer fortsatt fra `grant.organizationId`. 1d og 1d-2 viser dette. Eksisterende `expectTenantIsolation`-tester for handlingene skal være grønne, og nye spørringer får egne. Myk sletting berøres ikke.
