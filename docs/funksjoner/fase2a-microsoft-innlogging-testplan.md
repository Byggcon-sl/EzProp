# Testplan: Logg inn med Microsoft 365

- **Oppgavekort:** `docs/funksjoner/fase2a-microsoft-innlogging.md`
- **Dato:** 12.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** De ansatte (testene viser at Microsoft-knappen er hovedvalget og at koden alltid er reserven, så ingen stenges ute, heller ikke uten nett på iPaden). KI i bunnen: ingen KI her; testene låser at ingenting fra Microsoft lagres eller logges med personopplysninger. Reklamasjoner: indirekte (sikrere hvem som signerer).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. All testdata er oppdiktet: domenet `byggcon.example`, tenant-id `11111111-1111-4111-8111-111111111111` (egen) og `22222222-2222-4222-8222-222222222222` (fremmed), klient-id `33333333-3333-4333-8333-333333333333`, hemmelighet `test-ms-login-secret`. Ingen ekte tenant-id, klient-id eller adresser.

Numrene (M1.1 osv.) står først i testnavnet, så rapporten kan krysse av. Ingen nye `*-testplan.test.ts`; testene legges i filene for området, og nye filer bare der området er nytt.

Ingen fagregler og ingen TG-logikk. «Regeltestene» er sikkerhetsreglene (tenant, gjest, e-post, ansattforhold) som `it.each`-tabeller med testsaker.

## Avtale om signaturer (utvikler og testskriver)

Navn kan endres av utvikleren; avvik føres i kortet.

- `src/core/auth/microsoft-login.ts`:
  - `readMicrosoftLoginConfig(env?) → { tenantId, clientId, clientSecret } | null` (ren nok til å testes med `vi.stubEnv`).
  - `microsoftProfileCheck(claims, tenantId) → { ok: true, email, oid } | { ok: false, reason }` (ren; `reason` er en kort kode som `wrong_tenant`, `guest`, `no_email`, `no_oid`, `bad_token`).
  - `MICROSOFT_LOGIN_ERROR_TEXT` (den ene norske meldingen) eksporteres fra innloggingssiden eller `src/shared/config`, så e2e og enhetstest bruker samme konstant.
- `src/core/access`: `hasActiveEmployment(userId: string): Promise<boolean>`.
- `src/core/integrations/connections.ts`: reservert-listen (f.eks. `RESERVED_SECRET_REFS`) eksporteres.
- Falsk Microsoft i tester: `tests/fake-microsoft.ts` (ny) som bygger på `tests/fake-fetch.ts`. Den lager nøkkelpar med `jose` (finnes alt), svarer på token-adressen og på `…/discovery/v2.0/keys` (falsk JWKS), og har `idToken(claims, { key?, aud?, exp?, iss? })`. Ingen nettverk (`tests/no-network.test.ts` skal fortsatt være grønn).

**Merk før bygging (funn, middels):** i omdirigeringsflyten dekoder Better Auth 1.7.21 bare ID-tokenet (`decodeJwt` i `getUserInfo`); signatur, `aud`, `iss` og `exp` sjekkes bare i `idToken`-flyten, som vi stenger. Akseptkriteriet «ugyldig signatur, feil `aud` og utløpt ID-token avvises» (M3.10–M3.13) krever derfor at vi selv verifiserer i `getUserInfo` (med `jose` mot JWKS for egen tenant, `aud` = klient-id, `iss` = `https://login.microsoftonline.com/<tenant>/v2.0`, `exp`). Velger utvikleren å stole på TLS mot token-adressen i stedet, må det stå i ADR 0008 og kortet, og M3.10–M3.13 skrives om til en test som viser at tokenet bare kommer fra token-adressen for egen tenant. Uten et av de to godkjennes ikke leveransen.

## 1. Oppsett, `src/core/auth/microsoft-login.test.ts` (ny, ren) og `src/shared/config/env.test.ts` (utvides)

1. **M1.1** `it.each` over 0, 1 og 2 av de tre verdiene satt (alle kombinasjoner, 7 saker): `readMicrosoftLoginConfig` gir `null`, nøyaktig én advarsel, og advarselen inneholder bare navnene (`MS_LOGIN_TENANT_ID` osv.), aldri verdiene.
2. **M1.2** alle tre gyldige gir objektet med de tre verdiene, og ingen advarsel.
3. **M1.3** `it.each` ugyldig tenant-id: `common`, `organizations`, `consumers`, `byggcon.example`, tom streng, GUID med mellomrom inni → `null` og advarsel. GUID med store bokstaver eller mellomrom foran/bak: avgjøres av utvikler, men testen låser valget.
4. **M1.4** uløst nøkkelboks-referanse (`@Microsoft.KeyVault(...)`) i `MS_LOGIN_CLIENT_SECRET` → `null` og advarsel (via `readSecret`). Appen starter (import av `auth.ts` kaster ikke).
5. **M1.5** `env.ts` kaster aldri på grunn av `MS_LOGIN_*` (ugyldig tenant-id gir `undefined`/advarsel, ikke stopp). Eksisterende `env.test.ts` er grønn.
6. **M1.6** leverandøren i `auth.options.socialProviders.microsoft` med oppsett (modulen lastes på nytt med `vi.resetModules` og `vi.stubEnv`): `tenantId` er lik oppdiktet tenant-id, `disableSignUp === true`, `disableImplicitSignUp` ikke satt, `disableDefaultScope === true`, `scope` er nøyaktig `["openid","profile","email"]`, `disableProfilePhoto === true`, ingen `prompt`, ingen `authority`.
7. **M1.7** uten oppsett: `socialProviders.microsoft` finnes ikke (eller `socialProviders` er tom). Kodeinnloggingen (`emailOTP`) er med i begge tilfeller.
8. **M1.8** `account.accountLinking`: `trustedProviders` er nøyaktig `["microsoft"]`, `requireLocalEmailVerified === false`, `allowDifferentEmails` ikke satt, `updateUserInfoOnLink` og `overrideUserInfoOnSignIn` ikke `true`.

## 2. Profilsjekken som regeltabell, `src/core/auth/microsoft-login.test.ts`

`microsoftProfileCheck` med `it.each` (testsaker som data):

1. **M2.1** riktig `tid`, `email` satt → `ok`, e-post med små bokstaver, `oid` fra `oid` (ikke `sub`).
2. **M2.2** `email` `"  Ola.Testesen@Byggcon.Example  "` → `ola.testesen@byggcon.example`.
3. **M2.3** `email` mangler, `preferred_username` satt → den brukes, trimmet og med små bokstaver.
4. **M2.4** både `email` og `preferred_username` tomme, mangler eller bare mellomrom → `no_email`, kaster ikke.
5. **M2.5** `tid` fremmed, mangler, eller ikke streng → `wrong_tenant`.
6. **M2.6** gjest: `idp` satt og ulik egen tenant (f.eks. `https://sts.windows.net/<fremmed>/`, `live.com`) → `guest`; `preferred_username` eller `upn` med `#EXT#` → `guest`.
7. **M2.7** `idp` lik egen tenant (begge formene Microsoft bruker) eller fraværende → ikke gjest.
8. **M2.8** `oid` mangler eller er tom → avvist (`no_oid`).
9. **M2.9** årsakskoden inneholder aldri e-post, `oid` eller tenant-id (sjekk at `reason` er i en fast liste).

## 3. Innlogging gjennom Better Auth, `src/core/auth/microsoft-login.integration.test.ts` (ny, mot testdatabasen)

Kjøres gjennom `auth.handler` som `login-throttle.integration.test.ts`: `POST /api/auth/sign-in/social` (`provider: "microsoft"`, `callbackURL`) gir adressen og `state`-informasjonskapselen; så `GET /api/auth/callback/microsoft?code=…&state=…` med falsk `fetch` for token-adressen. Ansatte lages med `createUser`, `createOrganization`, `createEmployee`, `grantPermission`.

1. **M3.1 godkjent:** aktiv takstmann med riktig `tid` → 302 til `neste`, én ny rad i `sessions`, én rad i `accounts` med `provider_id = 'microsoft'` og `account_id = oid` (ikke `sub`), `lastLoginAt` oppdatert. `users.name`, `users.email` og `users.image` er uendret selv om tokenet har annet navn og bilde.
2. **M3.2 andre innlogging** med samme `oid`: ingen ny rad i `accounts`, ny økt.
3. **M3.3 e-post-varianter** (`it.each` fra M2.2–M2.3): samme `users`-rad, ingen ny rad i `users`.
4. **M3.4 tom e-post:** omdirigering til `/logg-inn?error=…`, ingen 500, ingen rader.
5. **M3.5 ukjent adresse:** ingen ny rad i `users`, `accounts` eller `sessions`; omdirigering til `/logg-inn?error=…`. Antall rader i `users` før og etter er likt.
6. **M3.6 feil `tid`** med e-post som matcher en aktiv ansatt → avvist, ingen rad i `accounts`, ingen økt.
7. **M3.7 feil `tid` for en konto som alt er koblet** (samme `oid`) → avvist, ingen økt.
8. **M3.8 gjestekonto** (`#EXT#` og fremmed `idp`) med e-post som matcher en ansatt → avvist, ikke koblet.
9. **M3.9 identitet følger `oid`:** koblet konto; admin endrer `users.email`; ny innlogging med samme `oid` og gammel e-post i tokenet → samme bruker. Ny `oid` med e-posten til en annen ansatt kobler ikke til feil bruker (ny rad bare for brukeren e-posten tilhører).
10. **M3.10 ugyldig signatur** (token signert med en nøkkel som ikke står i falsk JWKS) → avvist, ingen økt. Se «Merk før bygging».
11. **M3.11 feil `aud`** → avvist.
12. **M3.12 utløpt** (`exp` i fortiden, `TEST_NOW` brukes) → avvist.
13. **M3.13 feil `iss`** (fremmed tenant i `iss` selv om `tid` er riktig) → avvist.
14. **M3.14 deaktivert ansatt** (`deactivated_at` satt) før kobling → avvist, ingen økt; etter kobling → avvist, ingen ny økt, raden i `accounts` står (ikke slettet).
15. **M3.15 myk-slettet ansatt** (`deleted_at`) og ansatt i myk-slettet organisasjon: som M3.14.
16. **M3.16 bruker uten `employees`-rad** (finnes i `users`, f.eks. fra en gammel kode-innlogging) → avvist.
17. **M3.17 tokens lagres ikke:** etter M3.1 og M3.2 er `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at` tomme (`null`) i `accounts`.
18. **M3.18 `neste` og feiladresse** (`it.each`): `callbackURL`, `errorCallbackURL` og `neste` lik `https://evil.example`, `//evil.example`, `/\evil.example`, `javascript:` → Better Auth avviser, eller omdirigering går til en sti på samme nettsted. `Location` starter aldri med `//` eller et fremmed vertsnavn. Gyldig `/oppdrag/…` følges.
19. **M3.19 uten oppsett:** `POST /sign-in/social` med `microsoft` gir feil (ikke 500), ingen omdirigering til Microsoft.
20. **M3.20 ingen nettverk:** falsk `fetch` registrerer bare token-adressen (og JWKS hvis vi verifiserer) for egen tenant; aldri `common`, `organizations`, `graph.microsoft.com` eller bilde-adressen.

## 4. Ansattforhold og tilgang, `src/core/access/guards.test.ts` (utvides) og M3-filen

1. **M4.1 `hasActiveEmployment`** (`it.each`): aktiv → `true`; `deactivated_at` → `false`; `deleted_at` → `false`; organisasjon myk-slettet → `false`; ingen rad → `false`; én aktiv av flere → `true`; ukjent `userId` → `false` uten feil.
2. **M4.2 samme vilkår som `findGrant`:** for hver sak i M4.1 er `hasActiveEmployment` `true` hvis og bare hvis `findGrant` gir en grant i minst én organisasjon (felles tabell, kjøres mot begge).
3. **M4.3 tilgang per rolle** (`it.each` takstmann, kontor, leder, admin): etter Microsoft-innlogging gir `requireOrganizationAccess` for sesjonens bruker nøyaktig samme `EmployeeGrant` (organisasjon, roller, rettigheter) som etter kodeinnlogging av samme bruker.
4. **M4.4 tenant-isolasjon:** bruker som bare er aktiv ansatt i organisasjon B kommer inn med Microsoft, men `requireOrganizationAccess(actor, A.id, …)` avvises for alle rettigheter, og en kjent lesefunksjon (f.eks. oppdragslisten) gir 0 rader fra A. Bruker som er deaktivert i A og aktiv i B: samme.
5. **M4.5 hver innlogging:** sjekken ligger i `databaseHooks.session.create.before` og gjelder bare Microsoft-økter; kildesjekk + test at en ansatt deaktivert mellom første og andre innlogging avvises på den andre.
6. **M4.6 ingen ny spørring med `organizationId`:** `hasActiveEmployment` tar ikke `organizationId`. Kommer det likevel en, kreves `expectTenantIsolation` i filen. `tests/tenant-tables.ts` er uendret og `tenant-isolation-all-tables.test.ts` grønn.

## 5. Admin stenges aldri ute (regel 11), `src/core/auth/login-throttle.integration.test.ts` (utvides) og M3-filen

1. **M5.1** med Microsoft satt opp: admin logger inn med kode (`/email-otp/send-verification-otp` + `/sign-in/email-otp`) og får økt, som før.
2. **M5.2** med Microsoft satt opp: sperren for kode virker uendret (eksisterende tester grønne med `MS_LOGIN_*` satt).
3. **M5.3** med delvis eller ødelagt Microsoft-oppsett (M1.1, M1.4): appen svarer på `/api/helse`, og admin logger inn med kode.
4. **M5.4** en admin som har koblet Microsoft og så avvises der (f.eks. feil `tid`), kan fortsatt logge inn med kode.
5. **M5.5** koden får ingen ny sjekk: kildesjekk at `hasActiveEmployment` bare kalles for `microsoft`-økter.

## 6. Stengte endepunkter og hemmeligheter

I `src/core/auth/microsoft-login.integration.test.ts` og `src/core/integrations/connections.test.ts`:

1. **M6.1** `it.each` `/link-social`, `/unlink-account`, `/refresh-token`, `/get-access-token`, `/account-info` → 404 (eller avvisning), også med gyldig økt. Ingen rad i `accounts` endres eller slettes.
2. **M6.2** `POST /sign-in/social` med `idToken` i kroppen → avvist; uten `idToken` → omdirigeringsadressen.
3. **M6.3** `MS_LOGIN_CLIENT_SECRET` som `secret_ref` avvises for alle leverandører (`it.each` over leverandørlisten) ved lagring og ved oppslag (rad satt inn direkte med `createIntegrationConnection`).
4. **M6.4** eksisterende tester for `FIXED_SECRET_REFS` og `MS_GRAPH_*` er grønne.

## 7. Logg og personvern

1. **M7.1** spion på loggeren under M3.1, M3.5, M3.6, M3.8, M3.10: ingen logglinje inneholder e-posten, `oid`, `tid`, klient-id, hemmeligheten eller noen del av token-strengene. Avviste har årsakskode, godkjent har bruker-id.
2. **M7.2** Better Auth sin logger går via `src/shared/lib/logger.ts` (kildesjekk av `auth.ts`).
3. **M7.3 statisk** (`src/core/integrations/static-checks.test.ts` eller ny i `src/core/auth`): ingen `fetch` mot `login.microsoftonline.com` eller `graph.microsoft.com` i `src/core/auth`; `MS_LOGIN_CLIENT_SECRET` leses bare via `readSecret` (samme linje som for `MS_GRAPH_CLIENT_SECRET`); `microsoft-login.ts` importerer `@/core/integrations/secrets`, ikke indeksen.
4. **M7.4** ingen import fra `src/core/ai` i `src/core/auth` (kildesjekk), og ingenting fra Microsoft skrives til `ai_usage_log`.

## 8. Myk sletting

1. **M8.1** telling av rader i `users`, `accounts`, `sessions`, `employees` før og etter alle M3-sakene: bare økning, aldri nedgang (utover sesjoner Better Auth selv rydder ved utløp, som før).
2. **M8.2** kildesjekk: ingen `.delete(` på `accounts` eller `users` i `src/core/auth`.

## 9. Innloggingssiden

**Enhetstest** `src/app/logg-inn/login-form.test.tsx` (ny, eller i eksisterende sidetest; Testing Library hvis det finnes, ellers server-render med `renderToString`):

1. **M9.1** `microsoftEnabled = false`: ingen Microsoft-knapp, kodeskjemaet vises som i dag. (E2e kjører med oppsett, så «uten oppsett» prøves her og i M9.2.)
2. **M9.2** `page.tsx` sender bare en boolsk verdi til klientkomponenten (kildesjekk: ingen `MS_LOGIN_` eller tenant-id i props).
3. **M9.3** `?error=` med hver kode (`signup_disabled`, `account_not_linked`, `unable_to_link_account`, `wrong_tenant`, ukjent tekst) gir samme `MICROSOFT_LOGIN_ERROR_TEXT`; koden står ikke i teksten.

**E2e** `e2e/fase-2a-microsoft-innlogging.spec.ts` (ny), prosjektene `pc` og `ipad`. `playwright.config.ts` får oppdiktede `MS_LOGIN_*` i `webServer.env`. All trafikk til `login.microsoftonline.com` stoppes med `page.route` og `route.abort()` etter at adressen er lest; ingen nettverk.

1. **M9.4 hovedvalg:** «Logg inn med Microsoft» er synlig, full bredde, høyde ≥ 56 px; «Logg inn med kode i stedet» er en knapp med høyde ≥ 44 px. Kodeskjemaet er skjult til den trykkes.
2. **M9.5 koden virker:** «Logg inn med kode i stedet» → e-post → kode fra `/dev/epost` → inn som admin (`logIn` i `e2e/helpers.ts` oppdateres til å trykke knappen først, og alle eksisterende e2e-tester er grønne).
3. **M9.6 adressen:** trykk på Microsoft-knappen → nettleseren går til `https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/oauth2/v2.0/authorize` med `client_id` lik oppdiktet klient-id, `redirect_uri` lik `<baseURL>/api/auth/callback/microsoft`, `state` satt, `scope` med bare `openid profile email`; aldri `common`, `organizations`, `prompt=` eller `offline_access`. Samme vindu (ingen ny side åpnes).
4. **M9.7 sperret etter trykk:** knappen viser «Åpner Microsoft …» og er `disabled`; to raske trykk gir én forespørsel til `/api/auth/sign-in/social` (`countRequests`).
5. **M9.8 avvist:** `/logg-inn?error=account_not_linked` (og `signup_disabled`) viser den like norske meldingen, ingen feilkode i teksten, og kodeskjemaet er åpent rett under.
6. **M9.9 uten nett** (`context.setOffline(true)` etter at siden er lastet): begge knappene er sperret, teksten «Du er uten nett. Innlogging trenger nett. …» vises; med nett igjen er de aktive.
7. **M9.10 ingenting går tapt (iPad, også PC):** logget inn med kode, en endring i prøveskjemaet uten nett ligger i synkkøen (`pendingChanges` > 0); økten fjernes (informasjonskapselen slettes); nett tilbake; innlogging med kode igjen; endringen synkes (`pendingChanges` 0) og står på serveren.
8. **M9.11 `neste`:** `/logg-inn?neste=https://evil.example` og `?neste=//evil.example` → Microsoft-adressen har en `callbackURL` på samme nettsted (eller ingen ekstern adresse i `state`-forespørselen); etter kodeinnlogging havner man på `/`, ikke eksternt.
9. **M9.12 tilgjengelighet:** knappene kan nås med tastatur i riktig rekkefølge (Microsoft først), og feilmeldingen har `role="alert"`.

## 10. Drift og dokumenter

1. **M10.1** `tests/start-script.test.ts`: de tre `MS_LOGIN_*` står i løkken for valgfrie verdier i `start.sh`; skriptet virker med bash 3.2 (eksisterende sjekk).
2. **M10.2** `tests/deploy-workflow.test.ts`: de tre verdiene sendes til appen; `MS_LOGIN_CLIENT_SECRET` går via nøkkelboksen (som `MS_GRAPH_CLIENT_SECRET`), aldri som klartekst i app-innstillingene; hemmelighetsnavnet er i lista mot klartekst (linje 268).
3. **M10.3** `.env.example` har de tre navnene uten verdier.
4. **M10.4** ingen ekte tenant-id, klient-id eller hemmelighet i repoet: søk etter GUID-er i endrede filer gir bare de oppdiktede.
5. **M10.5** `tests/no-model-names.test.ts` grønn. Versjon 0.7.0 i `package.json` og i `/api/helse`.
6. **M10.6** dokumenter (sjekkes ved lesing, ikke test): ADR 0008, oppskrift i `docs/drift/testmiljo-azure.md` med tilbakeadressen, punkt under «Trenger Ståle når han er tilbake», domenemodell, ordliste, A214–A222 i `docs/09-apne-sporsmal.md`.

## Dekning av akseptkriteriene

| Akseptkriterium i kortet | Tester |
|---|---|
| 0–3 verdier, GUID | M1.1–M1.3, M1.5 |
| Uløst nøkkelboks, `readSecret` | M1.4, M7.3 |
| Oppsett av leverandøren, `oid` | M1.6–M1.8, M2.1, M3.1 |
| Reservert hemmelighetsnavn | M6.3 |
| Ingen `fetch` mot Microsoft/Graph | M7.3, M3.20 |
| Ansatt kommer inn | M3.1, M3.2 |
| E-post-varianter, tom e-post | M2.2–M2.4, M3.3, M3.4 |
| Ukjent adresse | M3.5, M9.8 |
| Feil `tid`, koblet konto, gjest | M2.5–M2.7, M3.6–M3.8 |
| Deaktivert og myk-slettet | M3.14–M3.16, M4.1, M4.5 |
| Signatur, `aud`, utløp | M3.10–M3.13 (se «Merk før bygging») |
| Tokens tomme | M3.17 |
| Stengte endepunkter | M6.1, M6.2 |
| Ekstern `neste` | M3.18, M9.11 |
| Samme grant per rolle | M4.3 |
| Annen organisasjon | M4.4 |
| Koden virker for admin | M5.1–M5.5, M9.5 |
| Logg uten personopplysninger | M7.1, M7.2 |
| Ingen permanent sletting | M8.1, M8.2, M6.1 |
| E2e: hovedvalg, uten oppsett, adresse, avvist, uten nett, ingenting tapt | M9.1, M9.4–M9.10 |
| Drift og dokumenter | M10.1–M10.6 |
| KI ikke aktuelt | M7.4 |

## Godkjenning

Avvises hvis noe i M3.5–M3.8, M3.14–M3.16 (ukjent, tenant, gjest, deaktivert), M4.3–M4.4 (rolle og annen organisasjon) eller M5.1–M5.4 (admin stenges ikke ute) mangler eller er rødt, eller hvis M3.10–M3.13 verken er grønne eller erstattet med begrunnelse i ADR 0008. `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` (PC og iPad) må være grønne, og versjonen 0.7.0.
