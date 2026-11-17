# Testplan: Mine innlogginger (2a-3, fra forbedreren)

- **Oppgavekort:** `docs/funksjoner/fase2a-mine-innlogginger.md`
- **Dato:** 17.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** de ansatte (testene låser at den ansatte ser egne enheter med «Denne enheten» og kan logge ut en ukjent enhet med ett trykk, og at admin kan stenge alle enheter med én handling uten å stenge seg selv ute ved et uhell), færre reklamasjoner (testen for uten nett-køen viser at en iPad som logges ut eksternt aldri mister befaringsdata som ikke er sendt), KI i bunnen (testene viser at ingen øktdata når KI-porten; funksjonen har ingen KI).

Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Tid styres med faste tidspunkt ut fra `TEST_NOW` (03.11.2026 10:00 UTC) eller `vi.setSystemTime`; ingen test avhenger av klokka i dag. Testdata er oppdiktet: e-post på `example.com`, oppdiktede user-agenter (tekstene settes i testfilen, ingen ekte enheter), IP `192.0.2.x` (dokumentasjonsadresser).

Ingen TG-regler. «Regeltestene» er tolkingen av user-agent og tidsteksten, som tabeller med testsaker (`it.each`). e2e kjøres i prosjektene `pc` og `ipad`.

## 0. Viktig for e2e: egne brukere per test

`ADMIN_EMAIL`, `INSPECTOR_EMAIL`, `MANAGER_EMAIL` og `OFFICE_EMAIL` deles av alle e2e-filer som kjører parallelt. **«Logg ut av alle andre enheter», «Logg ut av alle enheter» og deaktivering skal aldri kjøres mot disse brukerne**, ellers logges andre testfiler ut midt i en test (tilfeldig røde tester).

- Ny hjelper i `e2e/helpers.ts`, for eksempel `ensureDedicatedEmployee({ role, prefix })`, som lager en oppdiktet ansatt med unik e-post (`innlogging-<uniqueSuffix()>@example.com`) i Byggcon, og som brukes i alle tester i denne filen som logger ut.
- Admin som logger seg selv ut av alle enheter (E5) bruker en **egen** admin laget slik, aldri seed-admin.
- Den faste admin brukes bare til å lese og til å logge ut en egen testbruker.
- Hjelperen sletter aldri noe; testbrukerne deaktiveres ikke (de blir liggende som oppdiktede rader i e2e-databasen, som `archiveLeftoverE2eOffices` for kontorer).

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, Omfang 1–4. Avvik føres i kortet.

- `src/core/auth/user-agent.ts` (navn fritt i mappen): ren `describeUserAgent(ua: string | null) → { device, browser }`, `USER_AGENT_MAX_LENGTH = 512`, og de faste verdiene som konstanter (`DEVICE_LABELS`, `BROWSER_LABELS`).
- `src/core/auth/sessions-list.ts`: `listOwnSessions(actor)`, `revokeOwnSession(actor, sessionId)`, `revokeOtherOwnSessions(actor) → { count }`, `listEmployeeSessions(actor, organizationId, employeeId)`, `revokeAllEmployeeSessions(actor, organizationId, employeeId, { confirmSelf, reason }, executor?) → { count }`. `executor` (transaksjon) gjør at deaktiveringen kan bruke samme transaksjon.
- `Actor.sessionId` (eller `getCurrentSessionId()`) fra `auth.api.getSession` i `src/core/auth/session.ts`. Kjernefunksjonene tar nåværende økt fra denne, aldri fra et parameter som kommer fra skjemaet.
- Feil: `AccessDeniedError` for manglende rettighet, én felles «finnes ikke»-feil (eller `{ ok: false, reason: "not_found" }`) for annens, ukjent og utløpt økt og for ansatt i annen organisasjon, og en egen feil for manglende `confirmSelf`.
- Tidsteksten som ren funksjon i eller ved `oslo-format.ts`, for eksempel `sessionLastUsedLabel(lastUsed, now, isCurrent)` og `sessionCreatedLabel(createdAt)`.
- `CLOSED_PATHS` eksporteres (eller en `isClosedAuthPath(path)`), slik at vakttesten kan lese den.

## 1. Tolking av user-agent, `src/core/auth/user-agent.test.ts` (ny, ren)

### 1.1 Fasit (`it.each`, alle radene i kortets Omfang 2)

1. **Macintosh + Version/… Safari** → `iPad eller Mac` / `Safari`.
2. **Macintosh + Chrome** → `Mac` / `Chrome`.
3. **Macintosh + Firefox** → `Mac` / `Firefox`.
4. **iPad + Safari** → `iPad` / `Safari`.
5. **iPad + CriOS** → `iPad` / `Chrome`.
6. **iPad + FxiOS** → `iPad` / `Firefox`.
7. **iPad + EdgiOS** → `iPad` / `Edge`.
8. **iPhone + Safari** → `iPhone` / `Safari`.
9. **Windows + Edg/ (inneholder også Chrome/ og Safari/)** → `Windows-PC` / `Edge`.
10. **Windows + Chrome** → `Windows-PC` / `Chrome`.
11. **Windows + Firefox** → `Windows-PC` / `Firefox`.
12. **Android + Chrome** → `Android` / `Chrome`.
13. **Android + EdgA** → `Android` / `Edge`.
14. **`null`, `""`, `"   "`, søppel (`"x"`, `"<script>"`)** → `Ukjent enhet` / `Ukjent nettleser`.

### 1.2 Rekkefølge og sikkerhet

1. **Edge før Firefox før Chrome før Safari:** en tekst med både `Edg/` og `Firefox/` gir `Edge`; `Firefox/` og `Chrome/` gir `Firefox`; `Chrome/` og `Safari/` gir `Chrome`.
2. **Svaret er alltid en fast verdi:** for alle sakene i 1.1 og 20 tilfeldige tekster (fast frø) er `device` i `DEVICE_LABELS` og `browser` i `BROWSER_LABELS`. Ingen tekst fra inndata slipper gjennom (user-agent med `Macintosh<img src=x>` gir `Mac` eller `iPad eller Mac`, aldri `<img`).
3. **Kuttes til 512 tegn:** `iPad` plassert etter tegn 512 (512 × `a` + `iPad`) gir `Ukjent enhet`; samme ord før tegn 512 gir `iPad`.
4. **10 000 tegn ferdig på under 50 ms** (`performance.now()`), både med vanlige tegn og med mønster som er kjent for å trigge ReDoS (`"(" .repeat(5000)`, `"a ".repeat(5000)`, `"Chrome/".repeat(1500)`).
5. **Ingen ny avhengighet:** `package.json` får ingen ny pakke for user-agent (statisk sjekk av `dependencies` mot `main`, eller lint-regel som stopper import av kjente user-agent-pakker; testskriver velger den enkleste).
6. **Ingen `os`-felt:** `Object.keys(describeUserAgent(...))` er nøyaktig `["device", "browser"]`.

## 2. Tidsteksten, `src/app/(ansatt)/oslo-format.test.ts` (ny, ren, fast klokke)

1. **`isCurrent` gir alltid «Aktiv nå»**, også med `lastUsed` 20 dager tilbake.
2. **«Aktiv i dag»:** `lastUsed` 00:00:30 Oslo-tid, `now` 23:59 samme dag.
3. **«Aktiv i går»:** `lastUsed` 23:59:30 Oslo-tid, `now` 00:00:30 dagen etter (midnatt i Oslo, ikke UTC: `lastUsed = 2026-11-16T22:59:30Z`, `now = 2026-11-16T23:00:30Z`).
4. **UTC-felle:** `lastUsed = 2026-11-16T23:30Z` (17.11 i Oslo), `now = 2026-11-17T08:00Z` → «Aktiv i dag» (ikke «i går»).
5. **Dato ellers:** to dager eller mer → «Aktiv 12. nov.» (norsk kort måned, uten årstall i samme år; avtales og låses).
6. **Sommertid:** `now` 29.03.2026 (overgang til sommertid) og 25.10.2026 (overgang fra): «i dag» og «i går» stemmer for tidspunkt like før og etter midnatt.
7. **Aldri klokkeslett:** for alle sakene over matcher teksten ikke `/\d{1,2}[:.]\d{2}/` (klokkeslett), bortsett fra datoformatet `\d{1,2}\. [a-zæøå]+\.` som ikke inneholder tid.
8. **«logget inn 3. nov.»** fra `createdAt`, også her uten klokkeslett.
9. **Årsskifte:** `lastUsed` 28.12.2025, `now` 03.01.2026 → dato med år eller uten, men avtalt og låst (økter lever høyst 30 dager).

## 3. Vakttester for auth-oppsettet, `src/core/auth/auth-sessions-guard.test.ts` (ny, ren)

1. **De fire stiene er stengt:** `/list-sessions`, `/revoke-session`, `/revoke-sessions` og `/revoke-other-sessions` står i `CLOSED_PATHS` (eller gir `true` i `isClosedAuthPath`).
2. **Ingen økt-cache:** `auth.options.session.cookieCache?.enabled` er ikke `true`, og `auth.options.secondaryStorage` er `undefined`. Feilmeldingen sier at en tilbakekalt økt da ville levd videre.
3. **`updateAge` er uendret 24 timer** og `expiresIn` 30 dager (kortet: ingen endring).
4. **Ingen KI:** `src/core/auth/sessions-list.ts`, `user-agent.ts` og sidene under `profil` importerer ikke `@/core/ai` (kildetekst-sjekk som i eksisterende importtester).

## 4. Kjernen, egne økter, `src/core/auth/sessions-list.integration.test.ts` (ny, mot databasen)

Oppsett: organisasjon A med takstmann T (to økter: nåværende `s1` og `s2`), kontor K, leder L og admin AD; organisasjon B med takstmann TB. Økter lages direkte i `sessions` med oppdiktet `user_agent` og `ip_address = 192.0.2.10`, og `Actor.sessionId` settes til `s1`.

### 4.1 `listOwnSessions`

1. **Bare egne økter:** T ser `s1` og `s2`, ikke Ks, ADs eller TBs økter.
2. **Utløpte vises ikke:** økt med `expires_at = now - 1 s` er borte; `expires_at = now + 1 s` vises.
3. **Sortering:** «denne enheten» først, så etter `updated_at` synkende (tre økter med ulik `updated_at`).
4. **`isCurrent` bare på `s1`.**
5. **Hvitliste:** hver rad har nøyaktig nøklene `id`, `device`, `browser`, `lastUsed`, `createdAt`, `isCurrent` (sortert likhet). Ingen `token`, `ipAddress`, `userAgent`, `userId`, `expiresAt`.
6. **JSON-serialisert svar inneholder ikke** token-verdien, `192.0.2.10` eller noen del av den rå user-agenten (et unikt merke som `Oppdiktet/9.9` legges i user-agenten og søkes etter).
7. **Merket kan ikke flyttes:** funksjonen tar ingen økt-id inn; et kall der `Actor.sessionId` er `s1` gir `isCurrent` på `s1` uansett. (Typesjekk: signaturen har ingen parameter for økt-id.)
8. **Bruker uten økter** gir tom liste, ikke feil.

### 4.2 `revokeOwnSession`

1. **Egen annen økt:** `s2` slettes, `s1` står; svaret er ok.
2. **Annens økt-id** (Ks økt, TBs økt): samme «finnes ikke»-svar, og raden står.
3. **Ukjent id** og **utløpt egen økt:** samme «finnes ikke»-svar (ingen forskjell i svar eller feiltype mellom 2 og 3).
4. **Allerede utlogget** (kall to ganger): andre kall gir «finnes ikke», ingen krasj.
5. **Validering:** `""`, 1 000 tegn, `null`, tall og objekt avvises av Zod før spørringen (ingen databasekall; spion på `db` eller telling av spørringer).
6. **SQL-tekst som id** (`"' or 1=1 --"`) gir «finnes ikke», ingen rader slettes.
7. **Egen nåværende økt (`s1`):** avtales i kortet; kortet sier «Logg ut her» går via `logOutAndClear`. Testen låser at kjernen enten avviser `s1` (og siden bruker vanlig utlogging) eller sletter den; begge er greit, men oppførselen låses.

### 4.3 `revokeOtherOwnSessions`

1. **Alle andre slettes, nåværende står:** T med `s1`, `s2`, `s3` → `count = 2`, bare `s1` igjen.
2. **Ingen andre:** `count = 0`, ingen feil.
3. **Andres økter står:** Ks og TBs økter er urørt.
4. **Utløpte egne økter telles ikke** (de er ikke «aktive»); avtales: enten slettes de uten å telles, eller de står til ryddingen. Låses.

### 4.4 Tilbakekalling virker med en gang (gjennom Better Auth)

1. **`getSession` etter `revokeOwnSession`:** logg inn T to ganger via `auth.handler` (kode fra utviklings-postkassen, som i `login-throttle.integration.test.ts`), ta cookien fra innlogging 2, slett den økten fra innlogging 1 med `revokeOwnSession`, og `auth.api.getSession({ headers: { cookie } })` gir `null`.
2. **Samme etter `revokeOtherOwnSessions`** og etter `revokeAllEmployeeSessions`.
3. **Nåværende økt lever** etter `revokeOtherOwnSessions` (`getSession` med cookien fra innlogging 1 gir T).

### 4.5 Driftsloggen for egen utlogging

1. **Én linje per handling** (`revokeOwnSession`, `revokeOtherOwnSessions`) med handling og antall.
2. **Uten persondata:** loggen (spion på loggeren) inneholder ikke bruker-id, e-post, økt-id, token, IP eller user-agent.
3. **Ingen revisjonsrad** for egen utlogging (`auditRows` uendret).

## 5. Kjernen, admin, `src/core/auth/sessions-admin.integration.test.ts` (ny, mot databasen)

Samme oppsett som 4, pluss admin ADB i organisasjon B.

### 5.1 Tilgang per rolle

1. **Admin får lov:** AD lister T og logger ut alle Ts økter.
2. **Takstmann, kontor og leder** i A får `AccessDeniedError` på både `listEmployeeSessions` og `revokeAllEmployeeSessions`, også mot egen ansatt-id. Ingen rader slettes.
3. **Bruker uten ansattforhold** og **deaktivert admin** får `AccessDeniedError`.
4. **Leder er bevisst utelatt** (A423): egen sak som feiler hvis leder får `organization.manage`-rettigheten til økter. Feilmeldingen peker på A423.

### 5.2 Tenant-isolasjon

1. **`expectTenantIsolation` for `listEmployeeSessions`** (A og B, rad i begge).
2. **`expectTenantIsolation` for `revokeAllEmployeeSessions`.**
3. **AD med TBs ansatt-id:** «finnes ikke» på liste og utlogging; TBs økter står.
4. **AD med `organizationId` B og egen ansatt-id:** `AccessDeniedError` (filteret er `grant.organizationId`, ikke id-en fra adressen).
5. **ADB ser ikke Ts økter** og ikke revisjonsraden fra 5.5 (`listAuditEvents(ADB, B)` er tom).
6. **Kjent begrensning (A426):** bruker U ansatt i både A og B med to økter; AD i A logger ut alle → begge øktene er borte. Testnavnet sier «kjent begrensning A426», så den blir rød (og må vurderes) den dagen økter får organisasjon.

### 5.3 Ansatte som har sluttet og ansatte uten bruker

1. **Deaktivert ansatt** (`deactivated_at` satt) med økter kan listes og logges ut av AD.
2. **Myk slettet ansatt** (`deleted_at` satt) gir «finnes ikke» (regel 3: raden finnes, men er slettet).
3. **`user_id = null`:** tom liste og `count = 0`, ingen feil, revisjonsrad med `sessionCount: 0`.
4. **Hvitliste for admin-listen:** hver rad har nøyaktig `device` og `browser`; svaret har i tillegg antallet. Ingen `id`, `lastUsed`, `createdAt`, `isCurrent`, token, IP eller user-agent. JSON-søk etter merket `Oppdiktet/9.9`, `192.0.2.10` og token gir ingen treff.

### 5.4 Admin stenges aldri ute (regel 11)

1. **AD velger seg selv uten `confirmSelf`:** avvist med egen feil, ingen økter slettet, ingen revisjonsrad.
2. **`confirmSelf: false`** og **`confirmSelf: "true"`** (tekst) avvises likt (Zod, bare `true` godtas).
3. **AD velger seg selv med `confirmSelf: true`:** alle ADs økter slettes, revisjonsrad skrives.
4. **Etterpå kan AD fortsatt logge inn:** ny innlogging via `auth.handler` lykkes, og `requireOrganizationAccess(AD, A, "organization.manage")` gir grant (ansattraden og rollene er urørt).
5. **`confirmSelf` mot en annen ansatt** trengs ikke og endrer ingenting.
6. **Ingen rader i `employees`, `employee_roles`, `users` eller `accounts` endres** av noen utlogging (sammenlign før og etter).

### 5.5 Revisjonsloggen

1. **Rad `employee.sessions_revoked_all`** med `entityType: "employee"`, `entityId` = ansatt-id, `changes` nøyaktig `{ sessionCount, reason }` (sortert nøkkellikhet), `reason: "manual"`.
2. **Også ved 0 økter.**
3. **Samme transaksjon:** feiler skrivingen av revisjonsraden (spion som kaster), står øktene fortsatt.
4. **Ingen persondata:** raden (JSON) inneholder ikke IP, user-agent, token, økt-id eller e-post.
5. **`reason` er en fast kode:** bare `manual` og `deactivated` godtas; annen tekst avvises før spørringen (regel 6: kodene låses i en konstant med test).

## 6. Deaktivering, `src/app/(ansatt)/admin/ansatte/actions.integration.test.ts` (ny eller utvidet, mot databasen)

1. **`deactivateEmployeeAction` logger ut alle økter:** T med to økter deaktiveres → 0 økter igjen, revisjonsrad `employee.sessions_revoked_all` med `reason: "deactivated"` og riktig antall, i tillegg til den vanlige deaktiveringsraden.
2. **Samme transaksjon:** feiler utloggingen, er T ikke deaktivert (eller omvendt, slik kortet avtaler; låses).
3. **Admin kan ikke deaktivere seg selv** (eksisterende sperre står; testen låser at øktene da også står).
4. **Siste aktive admin kan ikke deaktiveres** (eksisterende test kjøres fortsatt grønt).
5. **Deaktivert ansatt får ikke ny tilgang** etter ny innlogging (`requireOrganizationAccess` avviser), men kan logge inn i appen som før (uendret oppførsel).
6. **Ansatt uten `user_id`** kan deaktiveres; revisjonsrad med `sessionCount: 0`.
7. **Tekst i bekreftelsen:** komponenttest av bekreftelsen viser «Hen blir også logget ut av alle enheter (N).» med riktig N.

## 7. Serverhandlinger og HTTP

### 7.1 `src/app/(ansatt)/profil/actions.test.ts` og `admin/ansatte/[id]/session-actions.test.ts` (nye, med falske kjernekall, som `admin/actions.test.ts`)

1. **Ikke innlogget:** hver handling gir «logget ut»-svaret, kjernen kalles ikke.
2. **Økt-id fra skjemaet** sendes til `revokeOwnSession` som den er; nåværende økt tas aldri fra skjemaet (et skjemafelt `currentSessionId` eller `isCurrent` ignoreres).
3. **Ansatt-id fra adressen** valideres (UUID); `../x` og tom tekst avvises uten kjernekall.
4. **`confirmSelf`** sendes bare når skjemaet har det avkryssede bekreftelsesfeltet.
5. **Feil fra kjernen** blir tydelige norske meldinger: «finnes ikke» → «Enheten er allerede logget ut.»; `AccessDeniedError` → ingen tilgang; ukjent feil → generell melding, ingen detaljer i svaret.
6. **Bare POST:** handlingene er serverhandlinger; ingen GET-rute eller lenke logger ut (grep i `src/app` etter `revoke` i `route.ts` med `GET`).

### 7.2 Better Auths stier over HTTP, `src/core/auth/auth-sessions-closed.integration.test.ts` (ny)

1. **De fire stiene gir 404** gjennom `auth.handler` med gyldig, signert cookie fra ekte innlogging (ikke bare uten cookie): `GET /list-sessions`, `POST /revoke-session` med token, `POST /revoke-sessions`, `POST /revoke-other-sessions`.
2. **Økter står** etter alle fire kall.
3. **Svaret inneholder ikke** token, IP eller user-agent.
4. **`/get-session` og `/sign-out` virker fortsatt** (kontroll av at stengingen ikke traff for bredt).

## 8. Profilside og admin-del, komponenttester (rene)

1. **`/profil` viser navn og e-post bare som tekst** (ingen skjemafelt for dem).
2. **Rad:** «iPad · Safari · Aktiv nå · logget inn 3. nov.» og merket «Denne enheten» som tekst (ikke bare farge).
3. **Knappen heter «Logg ut her» på denne enheten** og «Logg ut» på andre; tilgjengelig navn sier hvilken enhet (for eksempel «Logg ut Windows-PC, Edge»), slik at skjermleser skiller radene.
4. **«Logg ut av alle andre enheter»** vises bare når det finnes andre økter.
5. **Klientvisning (F3):** «denne enheten» + Macintosh + `maxTouchPoints = 5` → «iPad»; `maxTouchPoints = 0` → «iPad eller Mac» står. `display-mode: standalone` → appnavn fra `brand.ts` + «-appen» i stedet for nettleser. Andre rader endres aldri av dette. Ingenting sendes (ingen `fetch` i komponenten).
6. **Produktnavnet** kommer fra `brand.ts` (lint-regelen dekker resten).
7. **Admin-delen:** enhet, nettleser og antall, ingen «Aktiv …»-tekst og ingen dato. Knappen skjult når listen er tom.
8. **Bekreftelsesdialogen** har teksten fra kortet med navnet; for admin selv i tillegg «Du blir også logget ut her», og et avkryssings- eller bekreftelsessteg som må gjøres.
9. **«Logg ut her»** kaller `logOutAndClear` (spion), ikke kjernens `revokeOwnSession` direkte.

## 9. E2e, `e2e/fase-2a-mine-innlogginger.spec.ts` (ny, prosjektene `pc` og `ipad`)

Alle tester som logger ut bruker egne brukere fra avsnitt 0. To nettleserkontekster som samme bruker brukes for «annen enhet». Den andre konteksten får en oppdiktet user-agent (for eksempel Windows + Edge) via `browser.newContext({ userAgent })`, slik at radene kan skilles.

1. **E1 To enheter, én «Denne enheten»:** bruker X logger inn i kontekst 1 og 2. Initialene øverst → `/profil` (to trykk). To rader; «Denne enheten» og «Aktiv nå» på riktig rad, «Windows-PC · Edge» på den andre. Ingen klokkeslett i radene.
2. **E2 Logg ut en annen enhet:** «Logg ut» på raden for kontekst 2 → kvitteringen «Enheten er logget ut.» i `role=status` har fokus; raden er borte. Kontekst 2 går til `/arbeidskoe` og havner på `/logg-inn`.
3. **E3 Logg ut av alle andre enheter:** X i tre kontekster → knappen → «2 enheter er logget ut.»; knappen forsvinner; begge de andre havner på innloggingssiden ved neste side.
4. **E4 Logg ut her:** fører til `/logg-inn`; neste besøk på `/profil` krever innlogging.
5. **E5 Admin logger ut alle for en takstmann:** fast admin åpner ansattsiden til takstmann Y (egen bruker, egen kontekst innlogget). Delen «Innlogginger» viser enhet og nettleser og antall, ingen «Aktiv»-tekst. «Logg ut av alle enheter» → dialog med Ys navn → bekreft → «1 enheter er logget ut. Data som ligger på enhetene, er ikke slettet.» (tallet og bøyningen låses som kortet avtaler). Ys kontekst havner på innloggingssiden. Avbryt i dialogen (egen sak) endrer ingenting.
6. **E6 Admin logger ut seg selv:** egen admin Z (avsnitt 0) åpner egen ansattside. Dialogen sier «Du blir også logget ut her»; uten bekreftelsessteget går det ikke. Etter bekreftelse havner Z på `/logg-inn`, logger inn igjen med kode og når `/admin`.
7. **E7 Rollene:** takstmann, kontor og leder ser ikke delen «Innlogginger» eller knappen på `/admin/ansatte/[id]` (siden gir ingen tilgang som før), men ser «Mine innlogginger» på `/profil`.
8. **E8 Deaktivering:** fast admin deaktiverer egen bruker W (innlogget i egen kontekst). Bekreftelsen viser «Hen blir også logget ut av alle enheter (1).»; Ws kontekst havner på innloggingssiden.
9. **E9 Uten nett:** på `/profil` med `context.setOffline(true)` gir «Logg ut» meldingen «Du er uten nett. Prøv igjen når du har dekning.» i `role=alert` eller `role=status`; raden står; ingen stille feil. Samme for «Logg ut av alle andre enheter».
10. **E10 Uten nett-køen tømmes ikke (F5):** bruker V (egen bruker) lager et testskjema og gjør en endring uten nett (`createTrialForm`, `setOffline(true)`, `pendingChanges` > 0). Fra kontekst 2 logges kontekst 1 ut. Kontekst 1 går på nett, møter innlogging, logger inn igjen som V; endringen kommer fram på serveren (`serverTrialData`) og `pendingChanges` blir 0. Kjøres i `ipad`-prosjektet; i `pc` holder det at testen kjører uten feil.
11. **E11 Ingen persondata i svaret:** HTML og RSC-svar (`page.on("response")` for dokument og `?_rsc`) på `/profil` og `/admin/ansatte/[id]` inneholder verken token (fra cookien), `192.0.2`/`127.0.0.1`/`::1` eller den rå user-agenten (merket `Oppdiktet/9.9` i kontekst 2s user-agent).
12. **E12 UU:** axe uten feil på `/profil` og på ansattsiden med delen åpen og med dialogen åpen; alle knapper i delene minst 44 × 44 px; hele flyten E2 med bare tastatur (Tab, Enter) og fokus på kvitteringen.
13. **E13 iPad-størrelse:** i `ipad`-prosjektet passer listen uten vannrett rulling (`scrollWidth <= clientWidth`), og knappene ligger innenfor skjermen i stående og liggende retning.

## 10. Det som ikke testes her, og hvorfor

- **Tømming av data på iPaden** og sperring av mistet iPad: eget punkt («Sperring av iPader»).
- **«Ny innlogging, var det deg?»:** eget planpunkt.
- **Ekte nettlesere med ekte user-agent:** user-agentene er oppdiktede tekster; tolkingen testes som ren funksjon.
- **Ytelse:** listen har høyst noen titalls økter per bruker (30 dager, én per innlogging); ingen egen ytelsestest utover at spørringene bruker indeksen `sessions_user_id_idx` (finnes; testskriver sjekker med `EXPLAIN` at det ikke blir sekvensiell skanning på en tabell med 10 000 oppdiktede rader).

## 11. Kobling til akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Profilsiden viser økter, tidstekst, «Denne enheten» | 2, 4.1, 8.1–8.3, E1 |
| «Logg ut» på annen enhet avslutter økten | 4.2.1, 4.4, E2 |
| «Logg ut av alle andre enheter» | 4.3, E3 |
| Ingen ser eller logger ut en annens økt | 4.1.1, 4.2.2–4.2.6, 5.1, 5.2 |
| Better Auths fire stier gir 404 | 3.1, 7.2 |
| Admin ser enhet og nettleser, logger ut etter bekreftelse, revisjonsrad | 5.3.4, 5.5, 8.7–8.8, E5 |
| Admin kan logge ut en som har sluttet; tom `user_id` | 5.3.1, 5.3.3 |
| Admin i A med ansatt-id fra B får «finnes ikke» | 5.2.3 |
| Admin logger ut seg selv: beskjed, server krever bekreftelse, kan logge inn igjen | 5.4, E6 |
| Deaktivering logger ut alle, `reason: "deactivated"` | 6, E8 |
| Uten nett-køen går ikke tapt | E10 |
| Takstmann, kontor og leder får ikke admin-funksjonene | 5.1.2, 5.1.4, E7 |
| `expectTenantIsolation` | 5.2.1, 5.2.2 |
| Token, IP og rå user-agent sendes aldri til klienten | 4.1.5–4.1.6, 5.3.4, 7.2.3, E11 |
| Tilbakekalt økt ugyldig med en gang; vakttest cache | 3.2, 4.4 |
| Personvernerklæringen oppdatert | gjennomgang i testrapporten (ingen automatisk test) |
| PC og iPad-størrelse, axe | E12, E13 |
| Ingen ny avhengighet, ingen migrering, alt grønt | 1.2.5, ingen fil i `src/db/migrations/` i diffen, `pnpm lint`, `typecheck`, `test`, `test:e2e` |
| Ingen KI | 3.4 |
