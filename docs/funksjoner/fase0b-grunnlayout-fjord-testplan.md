# Testplan: Grunnlayout i design A «Fjord» med tom arbeidskø som startside

- **Oppgavekort:** `docs/funksjoner/fase0b-grunnlayout-fjord.md`
- **Branch:** `fase0b-grunnlayout-fjord` (fra `main`)
- **Dato:** 31.10.2026
- **Støtter hovedmål:** tid (arbeidskøen først, testskjemaet ett trykk unna på PC og iPad), reklamasjoner (målt kontrast og store trykkflater gir færre feiltrykk og feillesing), KI først (fast plass for «venter på deg» der KI-forslag skal stå senere).

Mørk visning står i oppgaveteksten, men er tatt ut av kortet (avgjørelse 1, fase 3). Kortet gjelder. Det testes derfor bare at det ikke finnes en halvferdig mørk visning (se 3.8).

Testdata er oppdiktet: «Testfirma takst», «Annen org AS», e-poster på `example.com`. Elementer finnes på rolle og navn, ikke `data-testid`.

## Avtale om grensesnitt (utvikler og testskriver)

- `organizationLabel(organizations: { name: string }[]): string | null` i `src/app/(ansatt)/organization-label.ts`. Ren funksjon, ingen databasekall.
- Navn i grensesnittet: navigasjon med lenkene «Arbeidskø» og «Testskjema uten nett» (gruppe «Prøver»), knappen «Logg ut», overskriften «Arbeidskø», teksten «Ingenting venter på deg», teksten «Du jobber for …».
- Lenken på arbeidskøsiden «Prøve uten nett: testskjema» forsvinner. Den eksisterende testen i `e2e/fase-1-testskjema.spec.ts` (linje 59) bytter til menylenken «Testskjema uten nett». Det er den eneste selektorendringen vi venter.

## 1. Enhetstester

### `src/app/(ansatt)/organization-label.test.ts` (ren del)
- **tom liste gir `null`** (linjen «Du jobber for» skal ikke vises).
- **én organisasjon gir navnet uendret.**
- **to organisasjoner gir navnene slått sammen med komma og mellomrom** i rekkefølgen de kommer inn (`listOrganizationsForActor` sorterer allerede).

### `src/app/(ansatt)/contrast.test.ts`
- Leser fargevariablene i `@theme` fra `src/app/globals.css` (tekstfil, ingen ny avhengighet) og regner WCAG-kontrast med en liten hjelper i testfilen.
- **`it.each` over hvert tekst/bakgrunn-par rammen bruker** (listen kommer fra ui-designerens spesifikasjon og står som data i testen): minst 4,5:1. Med minst: brødtekst og overskrift mot `canvas` og hvitt kort, menytekst mot menyflaten, aktivt menypunkt mot sin bakgrunn, `brand-700` (og `brand-600` hvis brukt som tekst) mot `canvas` og hvitt, initialer mot den runde flaten.
- **hjelperen selv er riktig:** svart mot hvitt gir 21:1, hvitt mot hvitt gir 1:1 (så en feil i utregningen ikke gir falsk grønt).
- **testen feiler hvis en variabel i listen ikke finnes i `globals.css`** (ellers kan et omdøpt navn gi en tom test).
- Kantlinjer og fokusring som ikke er tekst: minst 3:1 (WCAG 1.4.11), samme mønster.

## 2. Integrasjonstest mot testdatabasen

### `src/app/(ansatt)/organization-label.test.ts` (database-del, `resetDatabase` i `beforeEach`)
Kaller `organizationLabel(await listOrganizationsForActor(user))`, slik layouten gjør.
- **egen organisasjon vises, ikke den andre:** to organisasjoner i databasen, brukeren er ansatt i den ene; svaret er eget navn og inneholder ikke «Annen org AS».
- **bruker uten ansattrad gir `null`.**
- **sluttet ansatt (`deactivated_at`) gir `null`.**
- **myk-slettet ansatt (`deleted_at`) gir `null`.**
- **ansatt i to organisasjoner gir begge navnene med komma.**
- **tilgang per rolle:** `it.each` over `inspector`, `office`, `manager`, `admin` gir eget navn (rammen er lik for alle roller, admin stenges ikke ute). Bruker bare rollene som finnes på `main`; ingen avhengighet til roller-branchen.

**Tenant-isolasjon:** ingen ny spørring, så ingen ny `expectTenantIsolation`. Isolasjonen dekkes av testen for `listOrganizationsForActor` i `src/core/access/guards.test.ts` (uendret) og av første punkt over. Gjennomgangen sjekker at layouten og siden ikke gjør andre databasekall enn `requireActor` og `listOrganizationsForActor`, og at ingen id tas fra adressen.

## 3. e2e i `e2e/fase-0b-grunnlayout.spec.ts`

Kjører i prosjektene `pc` (1280x720) og `ipad` (1194x834, liggende). iPad stående i egen `test.describe` med `test.use({ viewport: { width: 834, height: 1194 }, hasTouch: true })`. Innlogging med `logIn` fra `e2e/helpers.ts`.

1. **admin åpner `/` og havner på `/arbeidskoe` i rammen:** banner (topplinje) med produktnavn, navigasjon, overskrift «Arbeidskø» og «Ingenting venter på deg» vises. Admin stenges ikke ute.
2. **takstmann ser det samme** med `logInAsInspector`. Kjøres bare hvis takstmannen kommer inn på `main` i dag; ellers `test.skip` med grunn «roller-branchen ikke merget», og det står i PR-en.
3. **initialene og «Du jobber for»:** topplinjen viser initialene til admin; «Du jobber for» inneholder navnet på organisasjonen fra seed.
4. **aktivt menypunkt:** «Arbeidskø» har `aria-current="page"`; «Testskjema uten nett» har det ikke. Etter klikk på «Testskjema uten nett» er URL `/prove/testskjema`, og «Arbeidskø» har ikke lenger `aria-current="page"`.
5. **PC og iPad liggende:** navigasjonen er synlig uten trykk og står til venstre for hovedinnholdet (`boundingBox` x for nav + bredde ≤ x for `main`). Ingen knapp «Meny» (`toHaveCount(0)`).
6. **iPad stående:** «Arbeidskø» og «Testskjema uten nett» er synlige uten trykk og står under topplinjen og over overskriften «Arbeidskø» (y-posisjon). Ingen knapp «Meny». Ett trykk på «Testskjema uten nett» åpner `/prove/testskjema`. Ingen vannrett rulling (`scrollWidth <= clientWidth` på `document.documentElement`).
7. **trykkflater, alle tre størrelsene:** hver lenke og knapp i banner og navigasjon er minst 44x44 px (`boundingBox`).
8. **ingen halvferdig mørk visning:** med `test.use({ colorScheme: "dark" })` er bakgrunnen bak innholdet den samme lyse som uten (lest med `getComputedStyle`). Viser at det ikke finnes `dark:`-klasser som slår inn av seg selv før fase 3.
9. **tastatur:** Tab fra toppen når «Arbeidskø», «Testskjema uten nett» og «Logg ut»; hver av dem har synlig fokus (`outline-style` ikke `none`, eller `box-shadow` ikke `none`). Enter på «Testskjema uten nett» åpner skjemalisten.
10. **logg ut:** «Logg ut» i topplinjen fører til `/logg-inn`; å åpne `/arbeidskoe` etterpå sender til `/logg-inn`.
11. **uinnlogget:** `/arbeidskoe` sender til `/logg-inn` (dekkes allerede av `fase-0a.spec.ts`, ikke dupliser).
12. **uten ramme:** `/logg-inn` og `/dev/epost` har ingen lenke «Arbeidskø» og ingen knapp «Logg ut».
13. **testskjemaet i rammen, iPad stående:** åpne `/prove/testskjema`, lag nytt skjema, fokuser et felt langt ned med Tab; feltet er ikke dekket av topplinjen eller den faste statuslinjen (feltets øvre kant er under statuslinjens nedre kant). Viser at rammen ikke bryter `scroll-padding` (WCAG 2.4.11).

«Uten organisasjon», sluttet og slettet ansatt testes i avsnitt 2, ikke i e2e (avgjørelse 4).

## 4. Regeltester

Ingen. Oppgaven har ingen regler eller TG-logikk.

## 5. Uten nett

Rammen er ny rundt `/prove/testskjema`, som skal virke uten nett. Ingen nye e2e for dette, men disse skal være grønne uendret og er en del av godkjenningen:
- `e2e/fase-1-prove-c-lagring.spec.ts`, `fase-1-prove-e-regler.spec.ts`, `fase-1-prove-f-innlogging.spec.ts` (åpne skjemaet på nytt uten nett, `neste` tilbake til skjemaet etter innlogging), `fase-1-synkstatus.spec.ts`, `fase-1-testskjema.spec.ts`.
- Rammen skal ikke hente data i nettleseren (ingen `fetch` fra layouten); gjennomgangen sjekker at layouten er en serverkomponent.

## 6. Regresjon og grenser

- `e2e/fase-0a.spec.ts` grønn uendret (topplinjens «Logg ut» er fortsatt en knapp med navnet «Logg ut»).
- `e2e/fase-1-testskjema.spec.ts` linje 59: eneste endring er lenkenavnet, forklart i PR-en.
- `git diff main -- src/core/access src/db drizzle` er tom. `src/core/access/guards.test.ts` uendret.
- `pnpm lint` (produktnavn bare fra `brand.ts`, modulgrenser), `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- Versjonen i `package.json` er økt (patch, fra 0.2.37).
- Ingen ny avhengighet i `package.json`.

## 7. Godkjenning

Avvises hvis: tilgangstesten per rolle i avsnitt 2 mangler, testen «egen organisasjon vises, ikke den andre» mangler, admin-testen (3.1) mangler, iPad stående (3.6) mangler, eller noen eksisterende e2e for prøven uten nett er rød.
