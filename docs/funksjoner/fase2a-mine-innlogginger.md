# Funksjon: Mine innlogginger

- **Fase:** 2a-3, «Fra forbedreren» (forbedreren 17.11.2026, fra «Rydding av innloggingsdata»)
- **Modul:** kjerne (`src/core/auth` for øktene, `src/core/access` for tilgang, `src/core/audit` for revisjonsloggen), sider i `src/app/(ansatt)/profil` og `src/app/(ansatt)/admin/ansatte/[id]`
- **Status:** klar for bygging (forhåndsvurdering runde 1 tatt inn 17.11.2026: forbedrer, sikkerhet-personvern, test-leder)
- **Branch:** `mine-innlogginger` (bygger på `main`)
- **Støtter hovedmål:** De ansatte: den ansatte ser selv hvor hen er logget inn og kan stenge en ukjent enhet med ett trykk; admin kan stenge alle enheter med én handling når noen slutter eller mister iPaden, og deaktivering gjør det automatisk. Tryggere arbeidsdag, mindre risiko for at rapporter og kundedata blir sett av feil person. Færre reklamasjoner: en iPad som logges ut eksternt, mister aldri befaringsdata som ikke er sendt (Omfang 9). KI i bunnen: ikke berørt (se under).

## Problem
I dag kan ingen se hvilke enheter en ansatt er logget inn på, og ingen kan logge ut en annen enhet enn den de sitter med. Mister en takstmann iPaden, eller slutter en ansatt, står øktene åpne til de går ut av seg selv. Den ansatte har heller ingen måte å oppdage en innlogging hen ikke kjenner igjen. Lar vi være, må admin be drift slette rader i databasen.

## KI i bunnen
KI har ingen oppgave her, og det er bevisst: øktene har IP-adresse og nettleser, som er persondata og aldri sendes til KI (regel 14). Ingenting går gjennom `src/core/ai`, og ingen data lagres for KI. Revisjonsloggen for «Logg ut av alle enheter» er strukturert (hvem, hvem sin, når, antall økter, årsak) og kan senere leses av driftsrapporter uten persondata.

## Brukerhistorier
- Som **ansatt** vil jeg se enhetene jeg er logget inn på, med «denne enheten» merket, slik at jeg oppdager en innlogging jeg ikke kjenner igjen.
- Som **ansatt** vil jeg logge ut en enhet med ett trykk, eller alle andre enheter med ett trykk, slik at en glemt PC eller mistet iPad ikke lenger er logget inn.
- Som **admin** vil jeg logge en ansatt ut av alle enhetene hens, slik at en som slutter eller mister iPaden er stengt ute fra øktene med en gang, og deaktivering skal gjøre det samme uten et ekstra steg.
- Som **takstmann** vil jeg ikke miste endringer som ikke er sendt, selv om iPaden blir logget ut mens den er uten nett.

## Omfang
**Med:**

1. **Kjernen** i `src/core/auth/sessions-list.ts` (eller tilsvarende, eksportert via `src/core/auth`):
   - `listOwnSessions(actor)` gir aktive økter (`expires_at` > nå) for den innloggede, sortert på `updated_at` synkende, med «denne enheten» først. Felt i svaret, nøyaktig: `id`, `device`, `browser`, `lastUsed`, `createdAt`, `isCurrent` (test med hvitliste).
   - `revokeOwnSession(actor, sessionId)` logger ut én egen økt. Slettingen har vilkår på både `id` og `user_id = actor.id`. En annens økt-id, en id som ikke finnes, og en utløpt eller allerede utlogget økt gir samme svar («finnes ikke»), uten krasj. Økt-id valideres som tekst med lengdegrense (Zod) før spørringen.
   - `revokeOtherOwnSessions(actor)` logger ut alle egne økter unntatt den nåværende og gir antallet (forbedreren, F2).
   - `listEmployeeSessions(actor, organizationId, employeeId)` og `revokeAllEmployeeSessions(actor, organizationId, employeeId, { confirmSelf, reason })` krever `requireOrganizationAccess(actor, organizationId, "organization.manage")`. Ansatten slås opp på `employees.id` og `grant.organizationId` med `deleted_at is null`, **men uten krav om `deactivated_at is null`**: en som har sluttet, kan fortsatt listes og logges ut. Har ansattraden `user_id = null`, gis tom liste og 0 utlogget, ikke feil. Ansatt-id fra en annen organisasjon gir «finnes ikke» både for liste og utlogging.
   - Admin-listen har bare `device`, `browser` og antallet. **Ingen «sist brukt», ingen opprettet-tid og ingen økt-id** i admin-visningen før Ståle har svart på spørsmål 89 (sikkerhet-personvern, punkt 2).
   - **Nåværende økt-id** kommer fra `auth.api.getSession` på serveren: utvid lesingen i `src/core/auth/session.ts` (for eksempel `Actor.sessionId` eller en egen `getCurrentSessionId()`). Den tas aldri inn fra skjema eller adresse. Test at en innsendt id ikke kan flytte merket.
   - **Utlogging er direkte sletting i `sessions`** fra kjernen (Drizzle, vilkår på `id`/`user_id`), ikke via Better Auths HTTP-endepunkter. `sessions` er Better Auths tekniske tabell; sletting er dekket av ADR 0014 (A419), regel 3 gjelder ikke. Sletting og revisjonsrad skjer i samme transaksjon.
   - **Lukk Better Auths egne økt-endepunkter:** legg `/list-sessions`, `/revoke-session`, `/revoke-sessions` og `/revoke-other-sessions` i `CLOSED_PATHS` i `src/core/auth/auth.ts`. Test at alle fire gir 404 over HTTP med gyldig økt (ellers får klienten token, IP og rå user-agent, og utlogging går utenom kjernen og loggen). Utvikleren sjekker om `hooks.before` også stopper serverkall til `auth.api.*`; kjernen bruker uansett ikke disse.
   - **Vakttest for auth-oppsettet:** feiler hvis `session.cookieCache` slås på eller `secondaryStorage` legges til. Da ville en tilbakekalt økt levd videre. Integrasjonstest: etter tilbakekalling gir `getSession` med samme cookie ingen økt.
2. **Lesing av user-agent på serveren** i én ren funksjon `describeUserAgent(ua: string | null)` → `{ device, browser }`. Inndata kuttes til 512 tegn før tolking, bare enkle mønstre uten nestet gjentakelse (ingen ReDoS), og resultatet er alltid en av de faste verdiene, aldri tekst fra user-agenten. Egen tolking uten ny avhengighet. Fasit (testsaker):

   | User-agent (oppdiktet) | device | browser |
   |---|---|---|
   | Macintosh + Version/… Safari (uten Chrome) | `iPad eller Mac` | `Safari` |
   | Macintosh + Chrome | `Mac` | `Chrome` |
   | Macintosh + Firefox | `Mac` | `Firefox` |
   | iPad + Safari | `iPad` | `Safari` |
   | iPad + CriOS | `iPad` | `Chrome` |
   | iPad + FxiOS | `iPad` | `Firefox` |
   | iPad + EdgiOS | `iPad` | `Edge` |
   | iPhone + Safari | `iPhone` | `Safari` |
   | Windows + Edg/ (inneholder også Chrome og Safari) | `Windows-PC` | `Edge` |
   | Windows + Chrome | `Windows-PC` | `Chrome` |
   | Windows + Firefox | `Windows-PC` | `Firefox` |
   | Android + Chrome | `Android` | `Chrome` |
   | `null`, tom tekst, søppel | `Ukjent enhet` | `Ukjent nettleser` |
   | 10 000 tegn | fast verdi, ferdig på under 50 ms | fast verdi |

   Rekkefølge for nettleser: Edge (`Edg/`, `EdgiOS`, `EdgA`) før Firefox (`Firefox/`, `FxiOS`) før Chrome (`Chrome/`, `CriOS`) før Safari. Ingen `os`-felt: enheten sier nok (avgjort, se under).
3. **Visning på klienten for «denne enheten»** (forbedreren, F3): er raden «denne enheten», og nettleseren melder Macintosh med `navigator.maxTouchPoints > 1`, vises «iPad». Kjører appen fra hjemskjermen (`display-mode: standalone`), vises appnavnet fra `src/shared/config/brand.ts` + «-appen» i stedet for nettleseren. Bare visning, ingenting lagres eller sendes.
4. **Tidsvisning (Oslo-tid, `oslo-format.ts`), aldri klokkeslett ved «sist brukt»** (forbedreren F1, sikkerhet-personvern 8, test-leder 1): `updated_at` fornyes høyst én gang i døgnet (`updateAge` 24 timer), så klokkeslett ville lovet mer enn dataene holder. Tekster:
   - «denne enheten»: «Aktiv nå».
   - andre: «Aktiv i dag», «Aktiv i går», ellers «Aktiv 12. nov.» (dato, uten klokkeslett).
   - i tillegg «logget inn 3. nov.» fra `created_at`.
   - Ingen endring av `updateAge`, ingen ny kolonne. Enhetstest med fast klokke rundt midnatt og ved overgang til og fra sommertid, og en test som viser at teksten for «sist brukt» aldri inneholder klokkeslett.
5. **Profilsiden** `/profil` (finnes ikke i dag): lenke fra initialene/navnet i toppen. Viser navn og e-post (bare lesing) og delen «Mine innlogginger»: én rad per økt, for eksempel «iPad · Safari · Aktiv nå · logget inn 3. nov.», merket «Denne enheten» på den nåværende.
   - «Logg ut» per rad på andre enheter: ett trykk, ingen bekreftelse, kvittering «Enheten er logget ut.» i `role=status` som får fokus.
   - På «denne enheten» heter knappen «Logg ut her» og går gjennom `logOutAndClear` (`src/app/(ansatt)/log-out.ts`), slik at KI-køen på enheten tømmes som ved vanlig utlogging, og den ansatte havner på innloggingssiden.
   - **«Logg ut av alle andre enheter»** under listen (forbedreren, F2): ett trykk, ingen bekreftelse, kvittering med antall («2 enheter er logget ut.»). Vises bare når det finnes andre økter.
   - Uten nett: tydelig feilmelding («Du er uten nett. Prøv igjen når du har dekning.»), ingen stille feil.
6. **Admin-visning** på `/admin/ansatte/[id]`: delen «Innlogginger» med enhet og nettleser per rad og antall aktive innlogginger (ingen «sist brukt», se Omfang 1), og knappen «Logg ut av alle enheter».
   - Bekreftelsesdialog: «Logg ut <navn> fra alle enheter? Hen må logge inn på nytt med kode eller Microsoft. Data som ligger lagret på iPaden slettes ikke. Har hen sluttet, sett også hen til «Har sluttet», ellers kan hen logge inn igjen.» Er det admin selv, står det i tillegg «Du blir også logget ut her».
   - **Serveren krever et eksplisitt bekreftelsesfelt** (`confirmSelf`) når admin velger seg selv, og avviser uten det (test). Admin som logger seg selv ut går gjennom `logOutAndClear` og havner på innloggingssiden; admin kan logge inn igjen med kode og nå `/admin` (e2e).
   - Kvittering med antall: «3 enheter er logget ut. Data som ligger på enhetene, er ikke slettet.» Er `user_id` tom: listen er tom og knappen er skjult.
7. **Deaktivering logger ut alle enheter** (forbedreren, F4): `deactivateEmployeeAction` (`src/app/(ansatt)/admin/ansatte/actions.ts`) kaller samme kjernefunksjon som «Logg ut av alle enheter» med `reason: "deactivated"`, i samme transaksjon som deaktiveringen hvis mulig. Bekreftelsen for deaktivering får linjen «Hen blir også logget ut av alle enheter (N).» Admin kan fortsatt ikke deaktivere seg selv (test som låser det), så regel 11 er uendret.
8. **Revisjonslogg og driftslogg:** raden `employee.sessions_revoked_all` skrives via `src/core/audit` i samme transaksjon som slettingen, også når antallet er 0. `entityType` `employee`, `entityId` den ansattes id, `changes` bare `{ sessionCount, reason }` der `reason` er `manual` eller `deactivated`. Test at verken IP, user-agent, token, økt-id eller e-post står i raden, og at raden ikke vises for admin i en annen organisasjon. Egen utlogging av én eller alle andre enheter skrives bare i driftsloggen, uten bruker-id, økt-id og user-agent.
9. **Uten nett-køen tømmes ikke ved ekstern utlogging** (forbedreren, F5): blir en iPad logget ut fra en annen enhet mens den har endringer i køen i `offline-trial`, blir køen liggende og sendes når samme bruker logger inn igjen. Den tømmes aldri av en ekstern utlogging (bare `logOutAndClear` på enheten selv tømmer KI-køen, og den rører ikke synkkøen). Test (e2e eller integrasjon): lag en endring uten nett, logg ut økten fra den andre konteksten, logg inn igjen som samme bruker, og endringen kommer fram.
10. **Personvernerklæringen** (`docs/personvern/intern-personvernerklaering.md`) oppdateres i samme PR: raden `sessions` («Hvem ser»: den ansatte selv; admin ser enhet og nettleser), avsnittet om tapt iPad (det finnes nå en knapp; dataene på iPaden blir fortsatt liggende), og den utdaterte setningen om synknøkkel på 1 time fjernes (`SYNC_TOKEN_TTL_SECONDS` finnes ikke lenger).
11. **Tester** (testplan under), versjon til 0.16.0 (ny skjerm), ordlisten (`session`, `revoke`), domenemodellen (at `sessions` vises og tilbakekalles, ingen nye felt).

**Ikke med (bevisst utelatt):**
- Tømme data på iPaden eller sperre en mistet iPad (hører til «Sperring av iPader» under «Klar for drift»).
- Visning av IP-adresse eller sted (land/by). IP er persondata og gir lite for den ansatte; heller ingen oppslag mot tjenester utenfor.
- «Sist brukt» i admin-visningen (venter på spørsmål 89).
- Varsel på e-post om ny innlogging. Meldingen «Ny innlogging, var det deg?» i appen er eget punkt i planen under «Fra forbedreren» (forbedreren 17.11.2026) og bygges ikke her.
- Kobling av Microsoft-kontoer (admin-visning for koblede kontoer er et eget lite funn fra PR #166).
- Ny tabell, nye kolonner, migrering eller kortere `updateAge`. Ingen navngiving av enheter.
- Leder ser ikke andres innlogginger (bare admin), og takstmann ser bare sine egne.
- KI.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | egne innlogginger | logge ut egne enheter |
| kontor | egne innlogginger | logge ut egne enheter |
| leder | egne innlogginger | logge ut egne enheter |
| admin | egne; for ansatte i egen organisasjon: enhet, nettleser og antall | egne enheter; «Logg ut av alle enheter» for en ansatt i egen organisasjon (også en som har sluttet); deaktivering logger ut alle |

All tilgang sjekkes i `src/core/access`. Admin stenges aldri ute: admin kan logge seg selv ut av alle enheter bare med bekreftelse (sjekket på serveren), og kan alltid logge inn igjen med kode. Admin kan ikke deaktivere seg selv. Ingen side kan logge ut en bruker som ikke er ansatt i organisasjonen til den som spør. Utlogging skjer bare i serverhandlinger (POST), aldri via GET eller lenke.

**Kjent begrensning:** `sessions` har ingen organisasjons-ID, og en bruker kan i prinsippet være ansatt i flere organisasjoner. «Logg ut av alle enheter» fra admin i A logger da også ut økter som brukes mot B. Ufarlig i dag (én organisasjon, én ansettelse per person), men må vurderes før organisasjon nummer to (A426). Test som viser oppførselen.

## Data
Ingen nye tabeller eller felt. Leser `sessions` (`id`, `user_agent`, `created_at`, `updated_at`, `expires_at`, `user_id`); `ip_address` og `token` leses aldri inn i svarene. Revisjonsloggen får handlingen `employee.sessions_revoked_all`. `tests/tenant-tables.ts` er uendret, fordi `sessions` ikke har `organization_id`. Ingen nye faste koder i maler.

## Skjermer
- **Profil (PC og iPad):** hovedhandling «Logg ut» på en ukjent enhet eller «Logg ut av alle andre enheter». Før: ikke mulig. Etter: initialene → profil → knapp = 2 trykk.
- **Admin, ansatt (PC og iPad):** hovedhandling «Logg ut av alle enheter». Før: ikke mulig. Etter: knapp → bekreft = 2 trykk. Ved deaktivering: 0 ekstra trykk.
- Knapper minst 44 px, lesbare uten farge, fokus etter utlogging flyttes til kvitteringen, tastatur og skjermleser virker (UU).

## Regler
Ingen fagregler. Testsakene for `describeUserAgent` står i tabellen over og i testfilen.

## Testplan
**Enhet:**
- `describeUserAgent` med alle tilfellene i tabellen i Omfang 2, også 10 000 tegn (tid).
- Oslo-format «Aktiv i dag» / «Aktiv i går» / dato med fast klokke rundt midnatt og ved sommertid; aldri klokkeslett.
- Hvitliste for svarfelt (`id`, `device`, `browser`, `lastUsed`, `createdAt`, `isCurrent`), og for admin-listen (`device`, `browser`).
- Vakttest for auth-oppsettet (`cookieCache`, `secondaryStorage`) og at de fire Better Auth-stiene står i `CLOSED_PATHS`.

**Integrasjon mot testdatabasen:**
- `listOwnSessions`: bare egne økter, utløpte vises ikke, sortert, riktig «denne enheten»; innsendt id flytter ikke merket.
- `revokeOwnSession`: egen økt slettes; annens økt-id, ukjent id og utløpt økt gir samme «finnes ikke»; `getSession` med samme cookie gir ingen økt etterpå.
- `revokeOtherOwnSessions`: alle andre slettes, nåværende står, riktig antall.
- `listEmployeeSessions` og `revokeAllEmployeeSessions`: admin får lov; takstmann, kontor, leder og bruker uten ansattforhold får `AccessDeniedError`; deaktivert ansatt med `user_id` kan listes og logges ut; `user_id = null` gir tom liste og 0; admin i A med `employeeId` fra B får «finnes ikke» på begge; `expectTenantIsolation` for begge; bruker ansatt i A og B (kjent begrensning, A426).
- `confirmSelf` mangler når admin velger seg selv: avvist.
- Revisjonsrad med `sessionCount` og `reason`, også ved 0, uten IP, user-agent, token, økt-id og e-post; ikke synlig for admin i annen organisasjon.
- `deactivateEmployeeAction` sletter øktene og skriver rad med `reason: "deactivated"`; admin kan ikke deaktivere seg selv.
- Driftsloggen for egen utlogging uten bruker-id, økt-id og user-agent.
- De fire Better Auth-stiene gir 404 over HTTP med gyldig økt.

**E2e, PC og iPad-størrelse:**
- To kontekster som samme bruker: to rader, én «Denne enheten». Logg ut den andre, kvitteringen i `role=status` får fokus, og den andre konteksten havner på innloggingssiden ved neste forespørsel.
- «Logg ut av alle andre enheter» med kvittering og antall.
- «Logg ut her» fører til innloggingssiden.
- Admin logger ut alle for takstmannen (egen kontekst) etter bekreftelse, kvittering med antall; takstmannens kontekst havner på innloggingssiden.
- Admin logger ut seg selv fra alle enheter: dialogen sier «Du blir også logget ut her», admin havner på innloggingssiden, logger inn igjen med kode og når `/admin`.
- Takstmann får ikke se admin-delen.
- Uten nett: «Logg ut» gir tydelig feilmelding.
- Uten nett-køen: endring uten nett, ekstern utlogging, ny innlogging, endringen kommer fram (Omfang 9).
- HTML og RSC-svaret på `/profil` og `/admin/ansatte/[id]` inneholder verken token, IP eller rå user-agent.
- axe uten feil på begge sidene, knapper minst 44 px.

Testene bruker oppdiktede user-agenter og e-post på `example.com`.

## Akseptkriterier
- [ ] Profilsiden viser egne aktive økter med enhet, nettleser, «Aktiv …» uten klokkeslett og «logget inn …», og «Denne enheten» med «Aktiv nå» på den nåværende
- [ ] «Logg ut» på en annen enhet avslutter den økten; den enheten må logge inn på nytt ved neste forespørsel (e2e)
- [ ] «Logg ut av alle andre enheter» logger ut alle unntatt denne, med antall i kvitteringen
- [ ] En ansatt kan ikke se eller logge ut en annens økt, heller ikke med en gjettet økt-id (test)
- [ ] Better Auths `/list-sessions`, `/revoke-session`, `/revoke-sessions` og `/revoke-other-sessions` gir 404 (test)
- [ ] Admin ser enhet og nettleser (ikke «sist brukt») for en ansatt i egen organisasjon og kan logge ut av alle enheter etter bekreftelse; revisjonsloggen får en rad uten IP og user-agent
- [ ] Admin kan liste og logge ut en ansatt som har sluttet; tom `user_id` gir tom liste uten feil (test)
- [ ] Admin i A med en ansatt-id fra B får «finnes ikke» (test)
- [ ] Admin som logger ut seg selv fra alle enheter, får tydelig beskjed, serveren krever bekreftelsen, og admin kan logge inn igjen og nå `/admin` (test og e2e)
- [ ] Deaktivering logger ut alle enheter og skriver revisjonsrad med årsak `deactivated`
- [ ] Endringer i uten nett-køen går ikke tapt når iPaden logges ut eksternt (test)
- [ ] Takstmann, kontor og leder får ikke admin-funksjonene (test)
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation`)
- [ ] Token, IP-adresse og rå user-agent sendes aldri til klienten (test og e2e)
- [ ] Tilbakekalt økt er ugyldig med en gang; vakttest for `cookieCache`/`secondaryStorage`
- [ ] Personvernerklæringen er oppdatert (Omfang 10)
- [ ] Virker på PC og iPad-størrelse, axe uten feil (e2e)
- [ ] Ingen ny avhengighet, ingen migrering, `pnpm lint`, `typecheck`, `test` og `test:e2e` grønne
- [ ] KI-forslag: ikke aktuelt (ingen KI i funksjonen)

## Lagt til av forbedreren
Ført i `docs/plan/forbedrerens-tillegg.md` 17.11.2026.
- **F1** «Sist brukt» uten klokkeslett, «Aktiv nå» og «logget inn …» (Omfang 4).
- **F2** «Logg ut av alle andre enheter» på profilen (Omfang 1 og 5).
- **F3** iPaden kjennes igjen på «denne enheten», «iPad eller Mac» for andre Safari-økter, appnavn ved hjemskjerm (Omfang 2 og 3).
- **F4** Deaktivering logger ut alle enheter (Omfang 7, flyttet fra «Ikke med»).
- **F5** Uten nett-køen tømmes ikke ved ekstern utlogging, med test (Omfang 9).
- **Nytt planpunkt:** «Ny innlogging, var det deg?» i appen, lagt under «Fra forbedreren» i fase 2a-3. Ikke del av denne oppgaven.

## Avgjort ved uenighet (prosjektlederen 17.11.2026)
- **Tidstekst:** forbedreren foreslo «for 5 dager siden», sikkerhet-personvern og test-leder dato. Valgt: «Aktiv i dag», «Aktiv i går», ellers dato, og «Aktiv nå» på denne enheten. Dato er entydig, følger `oslo-format.ts`, og øktene lever høyst 30 dager.
- **`os`-feltet tas ut** (test-leder listet det i hvitlisten fordi kortet nevnte det). Enhetstypen sier allerede operativsystemet, og et felt mindre er mindre persondata.
- **Forbedrerens F2 bruker ikke Better Auths `revokeOtherSessions`**, fordi sikkerhet-personvern lukker de endepunktene. Samme virkning bygges i kjernen med direkte sletting og driftslogg.
- **Revisjonsraden får `reason`** i tillegg til `sessionCount` (sikkerhet-personvern ba om bare antall). `reason` er en fast kode (`manual`/`deactivated`) uten persondata, og trengs for å skille F4 fra manuell utlogging.
- **«Sist brukt» tas ut av admin-visningen** til Ståle har svart (spørsmål 89). Personvern avgjøres av Ståle; det enkleste trygge valget er å vise mindre.

## Beslutninger (autonom modus, ført i `docs/09-apne-sporsmal.md`, A423–A430)
- A423 Bare admin (`organization.manage`) ser og logger ut andres innlogginger, ikke leder. Lett å endre.
- A424 IP-adresse vises ikke, bare enhet og nettleser. Én enhet logges ut uten bekreftelse; «alle enheter» for en ansatt krever bekreftelse, sjekket på serveren når admin velger seg selv. Lett å endre.
- A425 Egen enkel tolking av user-agent (fast tabell, 512 tegn) i stedet for et bibliotek; «iPad eller Mac» for Macintosh + Safari. Lett å endre.
- A426 Økter hører til brukeren, ikke organisasjonen: «Logg ut av alle enheter» treffer alle brukerens økter. Må vurderes før organisasjon nummer to. Dyrt å endre (krever organisasjon på økten).
- A427 «Sist brukt» vises som dag uten klokkeslett, fordi `updated_at` fornyes høyst én gang i døgnet; `updateAge` endres ikke. Lett å endre.
- A428 Admin-visningen viser ikke «sist brukt» før Ståle har svart på spørsmål 89. Lett å endre.
- A429 Utlogging er direkte sletting i `sessions` fra kjernen; Better Auths fire økt-endepunkter lukkes. Lett å endre.
- A430 Deaktivering logger ut alle enheter automatisk, med revisjonsrad `reason: "deactivated"`. Lett å endre.
- Ny profilside `/profil` med lenke fra initialene (del av A423). Lett å endre.

## Avklart før bygging (prosjektlederen 17.11.2026, fra testplanen)
1. **`revokeOwnSession` med den nåværende økten** avvises med `{ ok: false, reason: "current_session" }` og sletter ingenting. «Logg ut her» bruker vanlig utlogging (`logOutAndClear`). Testplan 4.2.7.
2. **`revokeOtherOwnSessions`** sletter og teller bare aktive egne økter (`expires_at` > nå). Utløpte står til ryddingen (`auth-cleanup`). Testplan 4.3.4.
3. **Datoformat:** «Aktiv 12. nov.» og «logget inn 3. nov.» uten årstall i samme år (Oslo-tid); er året et annet enn i dag, med årstall: «Aktiv 28. des. 2025». Testplan 2.5 og 2.9.
4. **Deaktivering i én transaksjon:** `deactivateEmployee` setter `deactivated_at`, skriver deaktiveringsraden, og kaller så `revokeAllEmployeeSessions(..., { reason: "deactivated" }, tx)` i samme transaksjon. Feiler noe, rulles alt tilbake: den ansatte er da ikke deaktivert og øktene står. Testplan 6.2.
5. **Bøyning:** «1 enhet er logget ut.» og «2 enheter er logget ut.» (samme i admin-kvitteringen og i deaktiveringsbekreftelsen: «(1)» er uendret). Ved 0: «Ingen enheter var logget inn.» Testplan E3 og E5 følger dette, ikke «1 enheter».
6. **Feiltyper:** «finnes ikke» er `{ ok: false, reason: "not_found" }` (samme for annens, ukjent, utløpt økt og ansatt i annen organisasjon); manglende rettighet er `AccessDeniedError`; manglende `confirmSelf` når admin velger seg selv er `{ ok: false, reason: "confirm_self_required" }`. Vellykket: `{ ok: true, count }` (for én økt `count: 1`).
7. **`Actor.sessionId`** legges til som valgfritt felt (`sessionId?: string`) i `Actor` og fylles i `getCurrentActor` fra `session.session.id`. Mangler den, får ingen rad `isCurrent`.

## Roller
utvikler (kjerne og sider), testskriver (enhet, integrasjon, e2e, parallelt), sikkerhet-personvern (tilbakekalling av økter, lukkede endepunkter, persondata i svarene, tenant-isolasjon, personvernerklæringen), ki-ansvarlig (kort kontroll av at ingen øktdata kan nå KI-porten). Ikke arkitekt, ux eller ui-designer: ingen ny tabell, og skjermene følger eksisterende mønstre.

## Åpne spørsmål
- Nr. 89 i `docs/09-apne-sporsmal.md`: skal admin se når en ansatt sist brukte hver enhet, og skal visningen drøftes med eller varsles til de ansatte før ekte data? Stopper ikke bygging.
