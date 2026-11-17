# Funksjon: Mine innlogginger

- **Fase:** 2a-3, «Fra forbedreren» (forbedreren 17.11.2026, fra «Rydding av innloggingsdata»)
- **Modul:** kjerne (`src/core/auth` for øktene, `src/core/access` for tilgang, `src/core/audit` for revisjonsloggen), sider i `src/app/(ansatt)/profil` og `src/app/(ansatt)/admin/ansatte/[id]`
- **Status:** klar for bygging
- **Branch:** `mine-innlogginger` (bygger på `main`)
- **Støtter hovedmål:** De ansatte: den ansatte ser selv hvor hen er logget inn og kan stenge en ukjent enhet med ett trykk; admin kan stenge alle enheter med én handling når noen slutter eller mister iPaden, uten å ringe noen. Tryggere arbeidsdag, mindre risiko for at rapporter og kundedata blir sett av feil person. Færre reklamasjoner: ikke direkte. KI i bunnen: ikke berørt (se under).

## Problem
I dag kan ingen se hvilke enheter en ansatt er logget inn på, og ingen kan logge ut en annen enhet enn den de sitter med. Mister en takstmann iPaden, eller slutter en ansatt, står øktene åpne til de går ut av seg selv. Den ansatte har heller ingen måte å oppdage en innlogging hen ikke kjenner igjen. Lar vi være, må admin be drift slette rader i databasen.

## KI i bunnen
KI har ingen oppgave her, og det er bevisst: øktene har IP-adresse og nettleser, som er persondata og aldri sendes til KI (regel 14). Ingenting går gjennom `src/core/ai`, og ingen data lagres for KI. Revisjonsloggen for «Logg ut av alle enheter» er strukturert (hvem, hvem sin, når, antall økter) og kan senere leses av driftsrapporter uten persondata.

## Brukerhistorier
- Som **ansatt** vil jeg se enhetene jeg er logget inn på, med «denne enheten» merket, slik at jeg oppdager en innlogging jeg ikke kjenner igjen.
- Som **ansatt** vil jeg logge ut en enhet med ett trykk, slik at en glemt PC eller mistet iPad ikke lenger er logget inn.
- Som **admin** vil jeg se de samme innloggingene for en ansatt og logge ut av alle enhetene hens, slik at en som slutter eller mister iPaden er stengt ute med en gang.

## Omfang
**Med:**

1. **Kjernen** i `src/core/auth/sessions-list.ts` (eller tilsvarende, eksportert via `src/core/auth`):
   - `listOwnSessions(actor, currentSessionId)` gir aktive økter (`expires_at` > nå, ikke slettet) for den innloggede, sortert på sist brukt (`updated_at`) synkende.
   - `revokeOwnSession(actor, sessionId)` logger ut én egen økt. Spørringen filtrerer på både `id` og `user_id = actor.id`; en annens økt-id gir samme svar som en som ikke finnes.
   - `listEmployeeSessions(actor, organizationId, employeeId)` og `revokeAllEmployeeSessions(actor, organizationId, employeeId)` krever `requireOrganizationAccess(actor, organizationId, "organization.manage")` (samme rettighet som ansattsidene i admin) og finner `user_id` via ansattraden i `grant.organizationId`. Ansatt i en annen organisasjon gir «finnes ikke».
   - Utlogging bruker Better Auths tilbakekalling (`revokeSession`/`revokeSessions` i serverens API, eller samme sletting i `sessions` som Better Auth gjør, slik at hurtigbufferen for økten også ryddes). `sessions` er Better Auths tekniske tabell; der er sletting av raden riktig og i tråd med ADR 0014 (økter er ikke fagdata, regel 3 gjelder ikke).
   - Svarene til sidene har bare: id, enhetstype, nettleser, operativsystem, sist brukt, opprettet, «denne enheten». **Aldri token, aldri full IP, aldri rå user-agent** til klienten.
2. **Lesing av user-agent på serveren** i én ren funksjon `describeUserAgent(ua)` → `{ device: "iPad" | "iPhone" | "Mac" | "Windows-PC" | "Android" | "Ukjent enhet", browser: "Safari" | "Chrome" | "Edge" | "Firefox" | "Ukjent nettleser" }`. Egen enkel tolking uten ny avhengighet. iPadOS som melder seg som Mac (Safari med `Macintosh` og berøring) kan ikke skilles på serveren; vis «Mac eller iPad» i det tilfellet. Testsaker for vanlige user-agenter (iPad Safari, Mac Safari, Windows Edge, Windows Chrome, tom, søppel, svært lang).
3. **Profilsiden** `/profil` (finnes ikke i dag): lenke fra initialene/navnet i toppen. Viser navn og e-post (bare lesing) og delen «Mine innlogginger»: én rad per økt, for eksempel «iPad · Safari · sist brukt i dag 08:12», merket «Denne enheten» på den nåværende. Knappen «Logg ut» per rad; på «denne enheten» heter den «Logg ut her» og gjør vanlig utlogging (til innloggingssiden). Ingen bekreftelse på andre enheter (ett trykk), men kvittering «Enheten er logget ut.» i en `role=status`. Tid i Oslo-tid med `oslo-format.ts` («i dag 08:12», «i går 17:40», ellers dato).
4. **Admin-visning** på `/admin/ansatte/[id]`: delen «Innlogginger» med samme liste (uten «Logg ut» per rad) og knappen «Logg ut av alle enheter». Bekreftelsesdialog: «Logg ut <navn> fra alle enheter? Hen må logge inn på nytt med kode eller Microsoft.» Er det admin selv, står det i tillegg «Du blir også logget ut her», og admin kommer til innloggingssiden etterpå. Kvittering med antall økter som ble logget ut.
5. **Revisjonslogg** via `src/core/audit` for «Logg ut av alle enheter» (handling, hvem som gjorde det, hvilken ansatt, antall økter), uten IP og user-agent. Egen utlogging av én enhet skrives i driftsloggen uten persondata (bare at det skjedde), ikke i revisjonsloggen.
6. **Tester:** enhet for `describeUserAgent`; integrasjon for de fire kjernefunksjonene med tilgang (takstmann, kontor og leder får ikke admin-funksjonene), `expectTenantIsolation` for `listEmployeeSessions` og `revokeAllEmployeeSessions`, annen brukers økt-id gir «finnes ikke», utløpte økter vises ikke, token og IP er aldri med i svaret, revisjonsrad skrives; e2e på PC og iPad-størrelse: logg inn i to nettleserkontekster, se to rader med én «Denne enheten», logg ut den andre, den andre konteksten havner på innloggingssiden; admin logger ut alle for en ansatt med bekreftelse; axe uten feil på begge sidene.
7. Versjon til 0.16.0 (ny skjerm), ordlisten (`session`, `revoke`), domenemodellen (at `sessions` vises og tilbakekalles, ingen nye felt).

**Ikke med (bevisst utelatt):**
- Tømme data på iPaden eller sperre en mistet iPad (hører til «Sperring av iPader» under «Klar for drift»).
- Visning av IP-adresse eller sted (land/by). IP er persondata og gir lite for den ansatte; heller ingen oppslag mot tjenester utenfor.
- Varsel på e-post om ny innlogging, eller «var dette deg?»-meldinger.
- Kobling av Microsoft-kontoer (admin-visning for koblede kontoer er et eget lite funn fra PR #166).
- Ny tabell, nye kolonner eller migrering. Ingen navngiving av enheter.
- Leder ser ikke andres innlogginger (bare admin), og takstmann ser bare sine egne.
- Automatisk utlogging når en ansatt deaktiveres (kan vurderes senere; deaktivering stenger allerede tilgangen i `requireOrganizationAccess`).
- KI.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | egne innlogginger | logge ut egne enheter |
| kontor | egne innlogginger | logge ut egne enheter |
| leder | egne innlogginger | logge ut egne enheter |
| admin | egne, og alle ansattes i egen organisasjon | egne enheter; «Logg ut av alle enheter» for en ansatt i egen organisasjon |

All tilgang sjekkes i `src/core/access`. Admin stenges aldri ute: admin kan logge seg selv ut av alle enheter bare etter en bekreftelse som sier det, og kan alltid logge inn igjen med kode. Ingen side kan logge ut en bruker som ikke er ansatt i organisasjonen til den som spør.

## Data
Ingen nye tabeller eller felt. Leser `sessions` (`id`, `user_agent`, `created_at`, `updated_at`, `expires_at`, `user_id`); `ip_address` og `token` leses aldri inn i svarene. Revisjonsloggen får handlingen `employee.sessions_revoked_all`. Ingen nye faste koder i maler.

## Skjermer
- **Profil (PC og iPad):** hovedhandling «Logg ut» på en ukjent enhet. Før: ikke mulig. Etter: initialene → profil → «Logg ut» = 2 trykk.
- **Admin, ansatt (PC og iPad):** hovedhandling «Logg ut av alle enheter». Før: ikke mulig. Etter: knapp → bekreft = 2 trykk.
- Knapper minst 44 px, lesbare uten farge, fokus etter utlogging flyttes til kvitteringen, tastatur og skjermleser virker (UU).

## Regler
Ingen fagregler. Testsakene for `describeUserAgent` står i testfilen.

## Akseptkriterier
- [ ] Profilsiden viser egne aktive økter med enhet, nettleser og sist brukt, og «Denne enheten» på den nåværende
- [ ] «Logg ut» på en annen enhet avslutter den økten; den enheten må logge inn på nytt ved neste forespørsel (e2e)
- [ ] En ansatt kan ikke se eller logge ut en annens økt, heller ikke med en gjettet økt-id (test)
- [ ] Admin ser innloggingene til en ansatt i egen organisasjon og kan logge ut av alle enheter etter bekreftelse; revisjonsloggen får en rad uten IP og user-agent
- [ ] Admin som logger ut seg selv fra alle enheter, får tydelig beskjed i bekreftelsen og havner på innloggingssiden
- [ ] Takstmann, kontor og leder får ikke admin-funksjonene (test)
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation`)
- [ ] Token, IP-adresse og rå user-agent sendes aldri til klienten (test)
- [ ] Virker på PC og iPad-størrelse, axe uten feil (e2e)
- [ ] Ingen ny avhengighet, ingen migrering, `pnpm lint`, `typecheck`, `test` og `test:e2e` grønne
- [ ] KI-forslag: ikke aktuelt (ingen KI i funksjonen)

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`, A423 og videre)
- Bare admin (`organization.manage`) ser og logger ut andres innlogginger, ikke leder. Lett å endre.
- IP-adresse vises ikke, bare enhet og nettleser. Lett å endre.
- Én enhet logges ut uten bekreftelse; «alle enheter» krever bekreftelse. Lett å endre.
- Egen enkel tolking av user-agent i stedet for et bibliotek. Lett å endre.
- Ny profilside `/profil` med lenke fra initialene. Lett å endre.

## Roller
utvikler (kjerne og sider), testskriver (enhet, integrasjon, e2e, parallelt), sikkerhet-personvern (tilbakekalling av økter, persondata i svarene, tenant-isolasjon), ki-ansvarlig (kort kontroll av at ingen øktdata kan nå KI-porten, fordi den ansatte ser og bruker skjermen). Ikke arkitekt, ux eller ui-designer: ingen ny tabell, og skjermene følger eksisterende mønstre.

## Åpne spørsmål
- Ingen som stopper bygging.
