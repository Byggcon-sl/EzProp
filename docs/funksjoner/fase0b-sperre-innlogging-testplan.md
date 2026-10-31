# Testplan: Sperre etter mange feil ved innlogging

- **Oppgavekort:** `docs/funksjoner/fase0b-sperre-innlogging.md`
- **Dato:** 31.10.2026
- **Støtter hovedmål:** reklamasjoner (indirekte: ingen kan gjette seg inn og endre eller publisere rapporter i en takstmanns navn). Tid: testene viser at den som skriver riktig kode, ikke merker noe, og at riktig kode nullstiller. KI først: ingen KI i oppgaven. Sperren er en fast regel uten skjønn.

Alle Vitest-tester som bruker databasen, går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: adresser på `eksempel.no` (for eksempel `ola@eksempel.no`, `kari@eksempel.no`, `ukjent.<suffix>@eksempel.no`). Aldri ekte adresser. Bare utviklings-postkassen brukes (`DEV_MAILBOX=1` i `tests/setup-env.ts` og i Playwright).

Fast tid i regeltestene: `T0 = new Date("2026-10-31T13:20:00Z")` (14:20 i Oslo, vintertid). 5. feil ved `T0` gir sperre til 14:35.

Ingen del av oppgaven virker uten nett (innlogging krever nett), så det trengs ingen e2e uten nett.

## Avtale om signaturer (utvikler og testskriver)

Alt i `src/core/auth/login-throttle.ts`. Ren del (ingen database) og databasedel i samme fil er greit, men den rene delen skal kunne testes uten database.

- Konstanter: `MAX_FAILED_CODES = 5`, `MAX_CODE_REQUESTS = 5`, `THROTTLE_WINDOW_MS = 15 * 60 * 1000`.
- `type LoginAttemptKind = "code_requested" | "code_failed" | "login_succeeded"`.
- `normalizeEmail(email: string): string` (`trim()`, så `toLowerCase()`).
- `hashEmail(email: string, secret: string): string` (normaliserer selv; HMAC-SHA256 med nøkkel avledet fra `login-throttle:` + hemmeligheten; hex).
- `decideThrottle(attempts: { kind: LoginAttemptKind; createdAt: Date }[], action: "request_code" | "sign_in", now: Date): { blocked: false } | { blocked: true; reason: "failed_codes" | "code_requests"; retryAt: Date }`. Tar rader i vilkårlig rekkefølge.
- `throttleMessage(reason, retryAt: Date): string` gir de to tekstene fra kortet, med klokkeslett i `Europe/Oslo` på formen `HH:MM`.
- Databasedel: `checkAndRecordAttempt(email: string, action, now = new Date())` → samme resultat som `decideThrottle`; `recordLoginSucceeded(email: string, now = new Date())`.
- **Presisering 1 (rekkefølge):** gjelder både feilsperre og bestillingsgrense ved bestilling, vises feilsperren («For mange feil koder …») med dens tidspunkt.
- **Presisering 2 (lik tid):** en `code_failed` med samme `createdAt` som siste `login_succeeded` telles ikke (det er samme forsøk). Bare rader med `createdAt` strengt etter, eller satt inn etter, siste `login_succeeded` telles. Utvikler velger måten (for eksempel sammenligning på `id` i tillegg), men regeltest 9 under skal være grønn.
- **Presisering 3 (5. feil):** selve 5. feilen slipper gjennom til Better Auth og får Better Auths vanlige svar («Koden stemmer ikke …»). Det er det 6. forsøket som får 429. Det gjelder e2e-testen også.
- `resetDatabase` tømmer `login_attempts`.

## 1. Regeltester (ren funksjon), `src/core/auth/login-throttle.test.ts` (ny)

En tabell `cases` med `{ name, attempts, action, now, blocked, reason?, retryAt? }`, kjørt med `it.each`. Tidene skrives som minutter fra `T0`.

1. **4 feil på 15 min slipper gjennom** (regel 1), både `sign_in` og `request_code`.
2. **5 feil på 15 min sperrer** til 5. feil + 15 min (regel 2), for `sign_in`.
3. **5 feil sperrer også bestilling** (`request_code`), samme `retryAt`, `reason: "failed_codes"`.
4. **grense 14:59 sperret, 15:00 slipper** (regel 3): `now = siste feil + 14:59` og `+ 15:00`.
5. **5 feil med nøyaktig 15:00 mellom eldste og nyeste sperrer**; **15:01 mellom sperrer ikke** (vinduet).
6. **bare de siste 5 feilene teller:** 8 feil spredt over 2 timer, der de siste 5 er innen 15 min, sperrer; der de siste 5 er spredt over 20 min, sperrer ikke.
7. **riktig kode nullstiller feil** (regel 5): 5 feil, så `login_succeeded` → ikke sperret.
8. **riktig kode nullstiller bestillinger** (regel 5): 5 bestillinger, så `login_succeeded` → ny bestilling slipper.
9. **lik tid som suksessen teller ikke** (presisering 2): `code_failed` og `login_succeeded` med samme `createdAt`, pluss 4 nye feil → ikke sperret.
10. **5 bestillinger: den 6. avvises** (regel 6), `reason: "code_requests"`, `retryAt` = eldste i vinduet + 15 min.
11. **bestillingsvinduet glir:** eldste bestilling nøyaktig 15:00 før `now` telles ikke → slipper; 14:59 før → avvises.
12. **bestillingsgrensen stopper ikke innlogging:** 5 bestillinger, `action: "sign_in"` → ikke sperret.
13. **begge grenser nådd:** `request_code` gir `reason: "failed_codes"` (presisering 1).
14. **rekkefølgen på radene spiller ingen rolle:** samme rader stokket gir samme svar.
15. **tom liste** → ikke sperret.

Enkeltstående i samme fil:

16. **`normalizeEmail`**: `" Ola@Eksempel.no "` → `"ola@eksempel.no"` (regel 7).
17. **`hashEmail` er lik for `Ola@Eksempel.no ` og `ola@eksempel.no`**, ulik for `kari@eksempel.no`, ulik med annen hemmelighet, og ulik HMAC med den rå hemmeligheten som nøkkel (nøkkelen er avledet). Svaret inneholder ikke adressen.
18. **klokkeslett vintertid:** `throttleMessage("failed_codes", new Date("2026-10-26T13:35:00Z"))` = «For mange feil koder. Du kan prøve igjen kl. 14:35.»
19. **klokkeslett sommertid:** `throttleMessage("code_requests", new Date("2026-10-24T12:35:00Z"))` = «For mange koder bestilt. Du kan be om ny kode kl. 14:35.»
20. **natten klokken stilles:** `new Date("2026-10-25T01:05:00Z")` gir `kl. 02:05`; `new Date("2026-10-25T00:05:00Z")` gir `kl. 02:05` også (sommertid). Viser at Oslo-tid brukes, ikke serverens tid. Testen setter ikke `TZ`.
21. **konstantene:** `MAX_FAILED_CODES`, `MAX_CODE_REQUESTS` er 5 og `THROTTLE_WINDOW_MS` er 15 min; og regeltest 2 bygges med `MAX_FAILED_CODES` (endres konstanten, følger testen).
22. **ingen gjetteord og ingen «Vent ett minutt»** i meldingene.

## 2. Integrasjonstester gjennom Better Auth, `src/core/auth/login-throttle.integration.test.ts` (ny)

Gjennom `auth.handler(new Request(...))` mot `/api/auth/...`, så det er vist at krokene er koblet inn. Koden hentes fra `readDevMailbox()`. Tid flyttes ved å tilbakedatere `created_at` i `login_attempts` (og `expires_at` i `verifications` om nødvendig), ikke ved å vente. Kjente adresser lages med `createUser` + `createEmployee`.

- **a) 5 feil gir 429 med norsk melding, på innlogging og bestilling.** Kjent adresse. Bestill kode, 3 feil, bestill ny kode, 2 feil (Better Auth gir 3 forsøk per kode). 6. innlogging → 429 og «For mange feil koder. Du kan prøve igjen kl. HH:MM.» (regex). Ny bestilling → 429, samme melding.
- **b) riktig kode under sperren gir 429 og ingen innlogging:** antall rader i `sessions` er uendret, ingen `Set-Cookie` med session.
- **c) 6. bestilling gir 429:** «For mange koder bestilt. Du kan be om ny kode kl. HH:MM.»; antall rader i `verifications` og antall e-poster i `readDevMailbox()` er uendret etter den 6.
- **d) admin sperres og kommer inn igjen av seg selv (regel 11):** ansatt med rollen `admin`. 5 feil → 429. Tilbakedater alle rader 15 min. Bestill ny kode og logg inn → 200, ny rad i `sessions`. Kommentar i testen: skal aldri fjernes.
- **e) riktig kode nullstiller uten sletting:** 4 feil og 4 bestillinger, så riktig kode. Deretter 4 nye feil og 4 nye bestillinger slipper gjennom (ingen 429). Antall rader i `login_attempts` har bare økt (ingen slettet), og det finnes én `login_succeeded`.
- **f) kjent og ukjent adresse gir likt 429-svar:** samme status, samme melding (med samme klokkeslett når tiden er lik) og samme JSON-nøkler, både for feilsperre og bestillingsgrense. Ukjent adresse får også rader i `login_attempts`. Skiller Better Auths svar under grensen seg, noteres det i PR-en.
- **g) ingen adresse i klartekst:** kolonnene i `login_attempts` er nøyaktig `id`, `email_hash`, `kind`, `created_at` (fra `information_schema`); ingen kolonne `organization_id`, `email` eller `ip`. Ingen celle i tabellen inneholder adressen. Bestilling med `Ola@Eksempel.no ` og med `ola@eksempel.no` gir samme `email_hash` og teller sammen (3 + 3 bestillinger → den 6. avvises).
- **h) sperren virker med `rateLimit` av:** sjekk at `auth.options.rateLimit?.enabled` er `false` i testmiljøet (ellers er testen ugyldig). Test a–e kjører altså uten Better Auths fartsgrense. Grep-test: `login-throttle.ts` og krokene i `auth.ts` leser ikke `DEV_MAILBOX` eller `NODE_ENV` (ingen bryter som slår sperren av).
- **i) forsøk under sperren forlenger ikke:** 5 feil, så 3 forsøk til (alle 429). Antall `code_failed` er fortsatt 5. Tilbakedater de 5 radene 15 min → neste forsøk slipper gjennom.
- **j) samtidige forsøk:** 10 feil innlogginger med `Promise.all` mot samme adresse. Nøyaktig 5 får ikke-429 (gikk til Better Auth) og 5 får 429; nøyaktig 5 `code_failed` i tabellen. Samme for 10 samtidige bestillinger (5 ok, 5 × 429, høyst 5 e-poster).
- **k) stengte stier gir 404** (`it.each`): `/email-otp/check-verification-otp`, `/email-otp/verify-email`, `/email-otp/reset-password`, `/email-otp/request-password-reset`, `/forget-password/email-otp`, og en oppdiktet `/email-otp/finnes-ikke`. Med gyldig kode i kroppen: koden er fortsatt brukbar etterpå på `/sign-in/email-otp`. Motprøve: `/email-otp/send-verification-otp`, `/sign-in/email-otp`, `/get-session` og `/sign-out` gir ikke 404.
- **l) isolasjon mellom adresser og organisasjoner (erstatter `expectTenantIsolation`):** adresse A er ansatt i organisasjon 1, adresse B i organisasjon 2. A sperres (feil og bestillinger). B kan bestille og logge inn (200, ny session). Omvendt: sperre på B rører ikke A. A og B i samme organisasjon: samme resultat.
- **m) logging uten adresse og hash:** `vi.spyOn(logger, "warn")` (eller nivået utvikler velger). Når sperren slår inn: én logglinje med rute og tidspunkt. `JSON.stringify` av alle kall inneholder verken adressen (store og små bokstaver) eller `email_hash`. Ingen logglinje når forsøket slipper gjennom.
- **n) e-post til ekte mottakere sendes aldri:** `emailTransport()` er `devMailbox` i testene (vakt i toppen av filen).

Tillegg i `tests/factories.test.ts`:

- **o) `resetDatabase` tømmer `login_attempts`.**

## 3. Tilgang og tenant-isolasjon

- **Tilgang per rolle:** sperren skjer før innlogging og leser aldri roller (kortet, «Avgjort ved uenighet»). Ingen rolletest per rolle. Test d (admin) dekker regel 11. Test-leder kontrollerer i gjennomgangen at `login-throttle.ts` ikke importerer fra `@/core/access` eller leser `employee_roles`.
- **Tenant-isolasjon:** `login_attempts` har ingen organisasjons-ID og leses bare av sperresjekken, så `expectTenantIsolation` passer ikke. Test g (ingen `organization_id`) og test l erstatter. Begrunnelsen skal stå i PR-en. Ingen nye spørringer som tar `organizationId`.
- **Admin stenges aldri ute:** test d, og regeltest 4 (sperren går ut ved 15:00).
- **Myk sletting:** ingen rader slettes (test e og i teller rader). Ingen `delete` i `login-throttle.ts` (sjekkes i gjennomgangen).

## 4. E2e, `e2e/fase-0b-sperre-innlogging.spec.ts` (ny)

Én test, kjører i både `pc` og `ipad` (1194 × 834, berøring).

1. **«sperre etter 5 feil koder viser når man kan prøve igjen»:** adresse `sperre.${uniqueSuffix()}@eksempel.no` (ukjent, unik per prosjekt og kjøring, aldri `ADMIN_EMAIL`). Gå til `/logg-inn`, be om kode. Skriv `000000` fem ganger; hver gang vises Better Auths vanlige melding (ikke 429). 6. forsøk: `getByRole("alert")` viser «For mange feil koder. Du kan prøve igjen kl. » etterfulgt av `\d{2}:\d{2}`. «Vent ett minutt» finnes ikke på siden. Meldingen er synlig uten rulling (`toBeInViewport`) i begge prosjekter.

Hele e2e-pakken skal være grønn etterpå. Det viser at riktig kode nullstiller, slik at `logIn()` med admin virker i alle de andre testene.

**Endring i en eksisterende e2e (må gjøres i samme PR):** `e2e/fase-0a.spec.ts` «ukjent e-post får ingen kode …» bruker den faste adressen `ukjent@example.com`. Den bestiller én kode per prosjekt og kjøring, og e2e-databasen tømmes ikke. Kjøres pakken tre ganger på 15 minutter lokalt (eller med omkjøring i CI), blir den 6. bestillingen avvist og testen rød. Bytt til `ukjent.${uniqueSuffix()}@eksempel.no`. Testens påstander endres ikke.

## 5. Det test-leder sjekker ved godkjenning

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- Alle punktene over finnes og tester det de sier (ikke bare at funksjonen kalles).
- Ingen miljøbryter for sperren. Ingen ny avhengighet. Versjon 0.2.49 i `package.json`.
- Teksten «Vent ett minutt» er borte fra `src/`.
- Migrering for `login_attempts` finnes, og ordlisten i `docs/05-domenemodell.md` har `login_attempts`, `email_hash`, `code_requested`, `code_failed`, `login_succeeded`.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| 5 feil gir 429 på bestilling og innlogging, norsk melding med klokkeslett | 1.2, 1.3, 1.18–20, 2a |
| Høyst 5 bestillinger per 15 min | 1.10, 1.11, 2c |
| Går ut av seg selv; admin kommer inn igjen | 1.4, 2d |
| Riktig kode nullstiller uten sletting; hele e2e grønn | 1.7–9, 2e, 4.1 + hele pakken |
| Forsøk under sperren forlenger ikke | 2i |
| Samtidige forsøk kommer ikke forbi | 2j |
| Andre kode-endepunkter stengt | 2k |
| Virker med `rateLimit` av; ingen bryter | 2h, 4.1 (`DEV_MAILBOX=1`) |
| Ingen klartekst-adresse; loggen uten adresse og hash | 1.17, 2g, 2m |
| Samme 429-svar for kjent og ukjent adresse | 2f |
| Ingen e-post til ekte mottakere | 2n, 4.1 (bare utviklings-postkassen) |
| Ingen ny avhengighet, versjon 0.2.49 | gjennomgang (avsnitt 5) |
| Isolasjon begrunnet, test l erstatter | 2g, 2l |
| Virker på iPad-størrelse | 4.1 i `ipad` |
