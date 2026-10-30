# Testplan: Prøve F – innlogging som har gått ut

- **Oppgavekort:** `docs/funksjoner/fase1-prove-f-innlogging.md`
- **Dato:** 30.10.2026
- **Støtter hovedmål:** reklamasjoner (ingenting går tapt) og tid (rett tilbake til skjemaet).

## 1. Vitest

### `src/modules/offline-trial/session-check.test.ts`

- 200 med en økt gir `valid`.
- 200 med `null` gir `expired`.
- `unknown` for: 200 med `{}`, 200 uten `session`, 401, 403, 5xx, nettverksfeil, ugyldig JSON, tidsavbrudd.
- Funksjonen kaster aldri.
- Resultatet er alltid nøyaktig en av `valid`, `expired`, `unknown`. Det gir aldri tilbake e-post, navn eller andre felt fra svaret (svaret i testen har oppdiktet e-post og navn, og testen sjekker at de ikke finnes i resultatet).
- Reglene for når sjekken kjøres (ren funksjon):
  - `online`, overgang fra «Uten nett» til nett, `visibilitychange` til synlig og feilet synkrunde gir sjekk;
  - ingen sjekk når appen er uten nett, uansett hva som utløser;
  - ingen sjekk ved vanlig statuslesing uten overgang.
- Høyst én sjekk om gangen: to utløsere samtidig (`online` og feilet synkrunde) gir ett kall til `fetch`; en ny sjekk etter at den første er ferdig, gir et nytt kall.

### `src/modules/offline-trial/sync-status-text.test.ts`

- `signInRequired` har forrang foran «Venter …» og «Venter på kontakt med serveren», men ikke foran «Uten nett».
- Teksten er «Logg inn på nytt for å sende. Alt er lagret på iPaden.».
- Markøren (`SyncStatusKind`) er alltid en av de fem verdiene for alle kombinasjoner av status og innlogging.
- «Synk nå» er skjult ved `signInRequired` (funksjonen som avgjør knappen, eller komponenttesten).

### `src/app/logg-inn/safe-next-path.test.ts`

Godtas uendret: `/arbeidskoe`, `/prove/testskjema`, `/prove/testskjema/<uuid>`.

Gir `/arbeidskoe`:

- mangler (`undefined`), tom, liste (`["a", "b"]`);
- `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:alert(1)`;
- grensen etter prefikset: `/prove/testskjemaX`, `/prove/testskjema-evil`, `/prove/testskjema/ikke-en-uuid`;
- tab eller linjeskift i stien: `/\t/evil.example`, `/\n/evil.example`;
- mellomrom eller andre tegn før skråstreken: ` /arbeidskoe`, `x/arbeidskoe`;
- kodede tegn: `/%2F%2Fevil.example`, `/%5Cevil.example`;
- `..`: `/prove/testskjema/../../api/x`;
- spørrestreng og `#`: `/prove/testskjema?x=1`, `/prove/testskjema#a` (valget: ikke lov);
- `/api/...`, `/logg-inn`, svært lang streng.

## 2. Playwright, `e2e/fase-1-prove-f-innlogging.spec.ts`

Chromium, standardkandidaten PowerSync. `pnpm build` og e2e kjøres etter hverandre, ikke samtidig.

### 2.1 Hovedflyt som takstmann (pc og ipad)

Én test. Vent på markøren, aldri på en fast pause.

1. `logInAsInspector`, lag skjema, åpne listen og skjemaet med nett (kopiene lages). Sjekk at `data-sync-state` ikke er `signInRequired`.
2. Start telling av kall til `/api/auth/get-session` (`countRequests`).
3. Sett `expires_at` til passert tid **bare på egen økt**: token fra informasjonskapselen i `context.cookies()` (delen før punktum), `assertLocalOrTestDatabase` først.
4. `context.setOffline(true)`, last siden på nytt. Skjemaet åpnes fra kopien. `data-sync-state="offline"`, ingen melding om innlogging.
5. Fyll ut svar og ett bilde. Åpne ny side i samme kontekst uten nett: alt står der. Åpne listen i en tredje side uten nett (fra kopien), slik at den er åpen når nettet kommer.
6. Sjekk: ingen kall til `get-session` mens nettet var av.
7. `context.setOffline(false)`. `data-sync-state="signInRequired"`, meldingen og «Logg inn» vises, «Synk nå» er skjult. Svarene står i feltene.
8. Testdatabasen: svarene og bildet finnes ikke på serveren; `pendingChanges` er over 0.
9. Bare ipad: «Logg inn» er minst 44 px høy i skjemaet og på listen (siden fra trinn 5 viser også `signInRequired`).
10. Trykk «Logg inn». `expect(page).toHaveURL` viser `/logg-inn?neste=/prove/testskjema/<id>`. Kode fra utviklingspostkassen.
11. `expect(page).toHaveURL` viser `/prove/testskjema/<id>`. Vent på `data-sync-state="allSaved"`.
12. Testdatabasen: alle svar og bildet finnes. Køen er 0.

### 2.2 Admin, «Synk nå» og ingen sjekk uten grunn (pc)

1. Logg inn som admin, åpne skjemaet med nett. Tell kall til `get-session` i 15 sekunder uten å gjøre noe: 0 kall.
2. Fyll ut ett svar uten nett, slik at køen har noe.
3. `context.clearCookies()`. Forklaring i testen: det er det samme som «Logg ut» på ekte iPad (A6), og hovedflyten dekker kapsel som har gått ut.
4. Slå på nettet uten å vente på `online`-sjekken: trykk «Synk nå». `data-sync-state="signInRequired"`, «Synk nå» skjult.
5. «Logg inn», kode, `toHaveURL` viser skjemaet. Admin stenges ikke ute. Vent på `allSaved`.

Merk: `online` og «Synk nå» kan begge utløse sjekken her. Testen viser at meldingen kommer når «Synk nå» feiler; at `online` ikke trengs, er dekket i Vitest.

### 2.3 Kopien av skjemaet blir ikke ødelagt (pc)

1. Logg inn, åpne skjemaet med nett (kopi lages).
2. Sett egen økt som utløpt. Åpne skjemaet med nett: serveren sender til `/logg-inn`.
3. Slå av nettet, åpne skjemaet igjen: skjemaet vises fra kopien, ikke innloggingssiden (`isCacheable` stopper omdirigeringer).

### 2.4 `neste` på begge veier (pc)

Les adressen med `expect(page).toHaveURL`.

- Allerede innlogget, åpner `/logg-inn?neste=/prove/testskjema/<id>`: havner i skjemaet.
- Allerede innlogget, `neste=//evil.example`: havner på `/arbeidskoe`.
- Ikke innlogget, `neste=/prove/testskjema/<id>`, skriver koden: havner i skjemaet.
- Ikke innlogget, `neste=//evil.example`, skriver koden: havner på `/arbeidskoe`.

## 3. Tilgang og tenant-isolasjon

- Hovedflyten kjøres som takstmann. Admin dekkes i 2.2.
- Kontor og leder: dekket av de eksisterende rolletestene for `/prove`. Testrapporten sier det.
- Testrapporten viser at denne er tom:
  `git diff main --stat -- src/db src/app/api src/modules/offline-trial/server src/modules/offline-trial/sync/powersync src/modules/offline-trial/sync/electricsql src/modules/offline-trial/sync/custom src/modules/offline-trial/sync/local`
  Er noe endret, gjelder kravet om `expectTenantIsolation` som vanlig.

## 4. Ikke testet her

- Safari/WebKit i Playwright (som prøve C). Dekkes av resultatmalen på ekte iPad.
- Egenbygd og ElectricSQL i e2e. Sjekken er lik for alle kandidatene; resultatmalen dekker alle.
- Ekte utløp etter 30 dager.
