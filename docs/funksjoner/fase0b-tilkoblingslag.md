# Funksjon: Tilkoblingslag med faste porter, første tilkobling e-post

- **Fase:** 0b (Grunnmur)
- **Modul:** kjerne (`src/core/integrations`, `src/core/email`)
- **Status:** klart til bygging (oppgavekort laget 02.11.2026, oppdatert etter runde 1 samme dag: forenkler, sikkerhet-personvern og test-leder)
- **Branch:** `fase0b-tilkoblingslag` fra `main`. Versjon **0.2.53** (én patch over `main`, som har 0.2.52; står `main` på en annen versjon når PR-en åpnes, brukes neste ledige patch).
- **Støtter hovedmål:**
  - **Tid:** alt som senere snakker med andre systemer (regnskap, meglersystem, eiendomsdata, KI, SMS) går gjennom ett lag med samme mønster. Hver ny tilkobling blir en adapter, ikke en ombygging. Takstmannen merker det ikke nå, men innlogging med kode på e-post via Microsoft 365 er det som gjør at alle ansatte kan logge inn i testmiljøet, ikke bare første admin.
  - **Reklamasjoner:** `last_ok_at`/`last_error` viser når en tilkobling sviktet, og revisjonsloggen viser hvem som endret en tilkobling. Hemmeligheter går én vei (`readSecret`), så de aldri havner i logg eller database.
  - **KI først:** porten `ai` er en fast kode fra dag én. KI-kallene i fase 2 og 3 bygger på dette laget, med samme tilgangssjekk og samme måte å holde hemmeligheter på. Ingen KI-kall bygges nå.

## Avgjørelser etter runde 1 (prosjektlederen, 02.11.2026)

Tre roller leste kortet. Dette er avgjort, og resten av kortet er skrevet om etter det:

1. **`external_references` utsettes til fase 3** (forenkler, kutt 1). Planpunktet for fase 0b nevner ikke tabellen, den har ingen kaller før eAccounting, og eAccounting-prøven i sandbox (planen, «Ved siden av fase 0 og 1») skal først vise hva koblingstabellen trenger. Bygges den nå, bygges den på gjetning. Tabellen føres på fase 3-punktet «Fakturagrunnlag til eAccounting» i planen. Sikkerhetsfunn 4 faller dermed bort; rådet om at modulen må vise at `entityId` hører til `grant.organizationId` før lagring, og at `external_id` aldri logges, står under «Til fase 3» nederst.
2. **`company_id` utsettes til fase 3** (forenkler, kutt 2). Bare regnskapet trenger selskap på tilkoblingen, og domenemodellen har to måter å koble selskap og tilkobling på (`integration_connections.company_id` og `companies.accounting_connection_id`); hvilken som brukes, avgjøres når regnskapet bygges. Unikheten blir enkel: én rad per organisasjon og port blant rader som ikke er slettet.
3. **Ingen token-mellomlager i Graph-adapteren** (forenkler, kutt 3, og sikkerhet 3). Volumet er noen innloggingskoder per dag, og `resolveEmailSender` lager uansett ny sender per kall (slik at `disabled` og nytt `secretRef` virker straks). Ett token-kall per sending. Test-leders punkt 6 (injiserbar klokke) trengs da ikke.
4. **`emailTransport` tas bort** (forenkler, kutt 4). Laget har én funksjon for valg av leverandør, `resolveEmailSender`. Testene i `email.test.ts` bruker den.
5. **Nektliste for hemmeligheter** (sikkerhet 1): appens egne hemmeligheter kan aldri leses gjennom `readSecret`.
6. **Statisk test i stedet for «lint dekker dette»** (sikkerhet 2, test-leder 9): `findActiveConnection` og `resolveEmailSender` eksporteres ikke fra `index.ts`, og en statisk test viser at ingen fil i `src/app` eller `src/modules` importerer dem.
7. **`tenantId` sjekkes og adressene kodes** (sikkerhet 3).
8. **Test-leders avklaringer 1–5, 7–9 og 11–13 er tatt inn** i Omfang og akseptkriteriene. 6 og 10 faller bort med kutt 3 og 1.
9. **`last_error` beholdes** når admin setter `error` → `active`, og nullstilles ved neste vellykkede sending (test-leder). Da ser admin fortsatt hva som gikk galt sist.
10. **Ståle må bekrefte databehandleravtalen og `Mail.Send` med tilgangspolicy** (sikkerhet 5). Står i Omfang 10, føres under «Trenger Ståle når han er tilbake». Ikke et åpent spørsmål som stopper PR-en.

## Problem

I dag sender `sendEmail` i `src/core/email` direkte ut fra miljøvariablene, og Microsoft 365-grenen kaster feil («kobles til i fase 0b»). Filtjenesten velger adapter med en miljøvariabel (A40) og sier selv at valget skal flyttes til tilkoblingslaget. Regnskap, meglersystem og KI kommer i fase 2 og 3. Uten et felles lag vil hver av dem lage sin egen måte å velge leverandør og holde hemmeligheter på. Lar vi være, blir hemmeligheter og leverandørvalg spredt rundt i koden, og nøkkelboksen (eget punkt) må kobles inn mange steder i stedet for ett.

## KI først

KI kan ikke gjøre denne oppgaven: den er grunnmur. Men laget er det KI-tjenestene senere kobles på gjennom (porten `ai`, egen hemmelighet, egen status). Ingenting KI-spesifikt bygges nå.

## Brukerhistorier

- Som **admin** vil jeg **se hvilke tilkoblinger organisasjonen har, og slå dem av og på**, slik at jeg vet hva EzProp snakker med. (Bare funksjonene nå; skjermen kommer senere.)
- Som **ansatt** vil jeg **få engangskoden på e-post fra Byggcons postboks** slik at jeg kan logge inn i testmiljøet, ikke bare første admin.
- Som **utvikler av senere funksjoner** vil jeg **legge til en ny tilkobling som én adapter bak en fast port** slik at jeg aldri må skrive leverandørkall i modulene.

## Omfang

**Med:**

1. **Portene som faste koder** i `src/core/integrations/ports.ts`: `accounting`, `email`, `broker`, `property_data`, `sms`, `speech_to_text`, `ai`, `file_storage`, `energy_label`, `scanning` (domenemodellen 4.10). Faste koder endres aldri (regel 6). Hver port har en fast liste over **leverandører** (`provider`) som er kjent i koden (`PROVIDERS_BY_PORT`, én oppføring per port). Nå er bare e-posten fylt ut: `email` = `dev_mailbox`, `server_log`, `microsoft365`. De andre portene har tom liste; en tilkobling med ukjent leverandør avvises med en tydelig feil. Statusene `CONNECTION_STATUSES` = `active`, `disabled`, `error`.
2. **Tabellen `integration_connections`** (ny migrering `0011_tilkoblinger.sql`) etter domenemodellen, uten `company_id` (avgjørelse 2): felles kolonner (`organization_id`, sporingsfelt, `deleted_at`/`deleted_by`, `row_version`), `port` (tekst, fast kode), `provider` (tekst, fast kode), `status` (`active`, `disabled`, `error`), `secret_ref` (tekst, valgfri; **bare navnet** på hemmeligheten), `settings` (jsonb, standard `{}`), `last_ok_at` (tidspunkt, valgfri), `last_error` (tekst, valgfri). **Én tilkobling per organisasjon og port blant rader som ikke er slettet, uansett status** (en `disabled` rad sperrer også; admin merker den gamle som slettet først). Delvis unik indeks `(organization_id, port) WHERE deleted_at IS NULL`, skrevet i Drizzle-skjemaet slik at `pnpm db:generate` ikke gir diff. Indeks som starter med `organization_id`. Brudd på unikheten gir `ConnectionValidationError` fra tjenesten (sjekk før innsetting; databasen er siste skanse).
3. **Hemmeligheter leses gjennom én funksjon**, `readSecret(secretRef)` i `src/core/integrations/secrets.ts`. Nå leser den `process.env[secretRef]`. `secretRef` må passe `^[A-Z][A-Z0-9_]{1,127}$` (minst to tegn), ellers kastes `InvalidSecretRefError` før noe leses. **Nektliste** (fast i `secrets.ts`): `BETTER_AUTH_SECRET`, `DATABASE_URL`, `TEST_DATABASE_URL`, `POWERSYNC_JWT_SECRET`, `FILE_STORAGE_AZURE_CONNECTION_STRING` gir `InvalidSecretRefError` både i `readSecret` og i Zod-sjekken for `secretRef` i `createConnection`/`updateConnection`; appens egne hemmeligheter kan aldri leses gjennom laget. Samme liste gjelder når nøkkelboksen kommer. Mangler verdien, eller er den tom streng, kastes `SecretNotFoundError` med **bare navnet** i meldingen. Dette er det eneste stedet som skal byttes når nøkkelboksen (Azure Key Vault, eget punkt) kommer. Verdien logges aldri; loggeren vasker allerede nøkler som heter `secret`/`clientsecret`.
4. **Tjenesten for tilkoblinger** i `src/core/integrations/connections.ts` (bare admin, `organization.manage`; all sjekk i `src/core/access`, alle spørringer filtrerer på `grant.organizationId`):
   - `listConnections(actor, organizationId)`: alle tilkoblinger som ikke er slettet, sortert på port og leverandør. Fast feltliste: `id`, `port`, `provider`, `status`, `secretRef`, `settings`, `lastOkAt`, `lastError`. Ingen sporingsfelt.
   - `createConnection(actor, organizationId, input)`: `input` = `{ port, provider, secretRef?, settings? }`, validert med Zod: port og leverandør må være kjente koder og høre sammen, `secretRef` som i Omfang 3, `settings` valideres per leverandør (se 6), ukjente nøkler avvises. Alt avvises med `ConnectionValidationError` før noe skrives. Status settes til `active`. Skriver én rad i revisjonsloggen (`entityType: "integration_connection"`, `action: "create"`, `changes` med port, leverandør og `secretRef`-navnet, aldri innhold fra `settings` som kan være en adresse).
   - `updateConnection(actor, organizationId, connectionId, input)`: `input` = `{ status?, secretRef?, settings? }` (port og leverandør kan ikke endres; lag en ny tilkobling i stedet). `status` kan settes til `active` eller `disabled` av admin; `error` settes bare av laget selv. `settings` sjekkes mot leverandøren **på raden**, ikke fra skjemaet; `secretRef` kan ikke fjernes for `microsoft365`. `last_error` røres ikke av admin (beholdes ved `error` → `active`, nullstilles ved neste vellykkede sending). Revisjonslogg med `action: "update"` og gammel/ny verdi per felt (for `settings`: bare nøklene som ble endret, ikke verdiene). Tomt `input`, eller input som ikke endrer noe, gir ingen loggrad. Ukjent id, ikke-uuid, slettet rad eller id fra en annen organisasjon gir `ConnectionNotFoundError` og endrer ingenting.
   - `markConnectionDeleted(actor, organizationId, connectionId)`: myk sletting, revisjonslogg `action: "delete"`. Samme «ikke funnet»-regel.
   - `findActiveConnection(organizationId, port)` (intern, uten actor; brukes bare av laget selv): raden med `status` ulik `disabled` og `deleted_at` tom, eller `null`. **Eksporteres ikke fra `index.ts`**; tenant-testen importerer den fra `./connections`. Kalles alltid med `grant.organizationId` eller organisasjonen laget selv kjenner, aldri med en id fra adresse eller skjema.
5. **Tjenesten for eksterne referanser bygges ikke nå** (avgjørelse 1).
6. **E-postporten** i `src/core/email` med tre leverandører bak samme grensesnitt `EmailSender = { readonly provider: EmailProvider; send(email: Email): Promise<void> }`:
   - `dev_mailbox` (finnes i dag som `devMailbox`): flyttes til `src/core/email/dev-mailbox.ts`, samme oppførsel (50 siste, `/dev/epost` leser med `readDevMailbox`, bare når `DEV_MAILBOX` er på, skriver til konsollen som i dag).
   - `server_log` (finnes, `server-log.ts`): uendret, `createServerLogSender(seedAdminEmail, write?)` beholdes, bare første admin, aldri adressen i loggen.
   - `microsoft365` (**ny**, `src/core/email/graph.ts`): sender fra **én postboks** med klientlegitimasjon (tenant, klient-id, klienthemmelighet), som i Optiplan. Lages med `createGraphEmailSender({ tenantId, clientId, clientSecret, from }, fetchFn = fetch)`. `tenantId` må passe `^[A-Za-z0-9.-]{1,64}$` (GUID eller domene), `from` må være en e-postadresse; begge legges i adressene med `encodeURIComponent`. Per sending: henter token fra `https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token` med `grant_type=client_credentials` og `scope=https://graph.microsoft.com/.default` (**ingen mellomlager**, avgjørelse 3), og sender med `POST https://graph.microsoft.com/v1.0/users/<from>/sendMail` (`contentType: "Text"`, `saveToSentItems: false`, én mottaker). Ved feil kastes `EmailSendError` med `step` (`token` | `send`) og `statusCode` (`number | null`); meldingen er en fast norsk tekst, aldri svaret fra Microsoft, aldri mottaker, emne eller tekst, og `cause` settes ikke. Feil uten statuskode (nettfeil, tidsavbrudd, `fetchFn` som kaster) gir `statusCode: null`. Token-svar uten `access_token` gir `EmailSendError` med `step: "token"`. Tidsavbrudd 15 sekunder per kall (`AbortSignal.timeout`, sendes som `init.signal`). Ingen ny avhengighet: `fetch` innebygd i Node. **Kan ikke prøves mot ekte konto nå**; testene bruker en falsk `fetchFn`. Dette er samme mønster som Azure-adapteren i filtjenesten (A40, A41): bare kode, slås på av Ståle. `settings` for leverandøren er `{ from, tenantId, clientId }` (alle påkrevd, samme sjekk som over), og `secretRef` er påkrevd og peker på klienthemmeligheten. `dev_mailbox` og `server_log` godtar bare tomme `settings`.
   - **Valg av leverandør** i `src/core/email/resolve.ts`, `resolveEmailSender({ organizationId?, fetchFn? }, env)` → `Promise<{ sender: EmailSender; connectionId: string | null }>`. **Ny sender per kall**, raden leses hver gang:
     1. `DEV_MAILBOX` på → `dev_mailbox`, uansett organisasjon og tabell. Vinner alltid (og `env.ts` tillater den bare på localhost).
     2. Med organisasjon: `findActiveConnection(organizationId, "email")`. Finnes den, brukes dens leverandør, `settings` og `secretRef` (gjennom `readSecret`), og `connectionId` settes. Kaster `readSecret`, eller er `settings` på raden ugyldige, regnes det som svikt på tilkoblingen (se `sendEmail`). Finnes ingen (eller den er `disabled`), brukes systemvalget i punkt 3.
     3. Systemvalget (uten organisasjon, eller ingen tilkobling): `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID` og `MAIL_FROM` satt → `microsoft365` med `secretRef = "MS_GRAPH_CLIENT_SECRET"` lest **bare** gjennom `readSecret` (`env.ts` garanterer «alle fire eller ingen», så `resolve.ts` ser aldri på `env.MS_GRAPH_CLIENT_SECRET`); ellers `server_log`. `connectionId` er `null`.
     `resolveEmailSender` eksporteres ikke fra `index.ts`; tester importerer fra `./resolve`.
   - **`sendEmail(email, options?, env?)`** med `options = { organizationId?, fetchFn? }`. `sendEmail(email)` i `auth.ts` endres ikke. `fetchFn` finnes bare så testene kan vise hele veien tabell → Graph uten at `globalThis.fetch` kalles. Gikk sendingen gjennom en tilkobling i tabellen (`connectionId` satt), settes `last_ok_at` ved suksess, `last_error` nullstilles og `status` settes til `active` om den sto i `error`; ved feil (også svikt før sending: `readSecret` kaster, ugyldige `settings`) settes `last_error` (vasket med `scrubText`, høyst 500 tegn, aldri adresse, kode eller hemmelig verdi; navnet på hemmeligheten er lov) og `status = "error"`. Disse skrivingene er systemets egne og får **ingen** rad i revisjonsloggen. Feilen kastes videre etter at raden er oppdatert. Når `dev_mailbox` velges eller systemvalget brukes, skrives ingenting til tabellen. `sendEmail` med `organizationId` kalles alltid med `grant.organizationId`, aldri med en id fra adresse eller skjema.
7. **Filtjenesten røres ikke.** `FILE_STORAGE_DRIVER` (A40) beholdes; flytting av valget til tabellen er en egen liten oppgave etter denne.
8. **Loggeren:** `scrubText` vasker `client_secret=[^&\s]+` til `client_secret=[fjernet]`. Nøkkelen `clientsecret` er allerede dekket.
9. **Dokumentasjon og oppsett:** `docs/drift/testmiljo-azure.md` (de fire secretene kan nå legges inn, alle fire sammen; appregistreringen skal ha `Mail.Send` som applikasjonsrettighet og være begrenset til én postboks med en tilgangspolicy i Exchange, som i Optiplan; ingen ekstra kostnad), `.env.example` (kommentar om at `MS_GRAPH_CLIENT_SECRET` er navnet laget leser gjennom `readSecret`), `docs/05-domenemodell.md` (4.10: «Bygget i fase 0b» med feltene slik de ble, status-reglene, én per organisasjon og port; `company_id` og `external_references` merket «fase 3»), `docs/06-arkitektur.md` (regel 8 peker på `src/core/integrations`, `readSecret` som eneste vei til hemmeligheter), ordlisten (tilkobling, port, leverandør, hemmelighetsnavn). `start.sh` endres ikke. Versjon 0.2.53.
10. **Beslutninger som føres i `docs/09-apne-sporsmal.md`** («Avgjort av agentene mens Ståle var borte») av prosjektlederen i PR-en, med neste ledige numre (A44 og videre):
    - Graph-adapteren bygges nå som bare kode, selv om spørsmål nr. 6 sa «ikke før Ståle har svart»: autonom modus, ingen sending uten at Ståle legger inn de fire secretene, samme mønster som Azure-adapteren (A40). Kilde: planen fase 0b, nr. 6, `CLAUDE.md` autonom modus. Spørsmål nr. 6 oppdateres med en henvisning.
    - E-post uten organisasjon (innloggingskoder) bruker systemvalget fra miljøet; en tilkobling i tabellen gjelder bare når avsenderen oppgir organisasjon. Kilde: innloggingen skjer før organisasjonen er kjent (Better Auth), og testmiljøet skal virke uten rader i tabellen.
    - Leverandørlistene per port er faste koder i koden, tomme for alle porter unntatt e-post. Filtjenesten beholder miljøvariabelen (A40) til en egen liten oppgave flytter den. Kilde: regel 1 (hold det enkelt) og regel 6.
    - Automatiske oppdateringer av `last_ok_at`, `last_error` og `status = error` får ingen rad i revisjonsloggen. Kilde: revisjonsloggen er for det ansatte gjør (A33).
    - `external_references` og `company_id` på tilkoblinger bygges i fase 3 sammen med regnskapet, etter eAccounting-prøven. Kilde: regel 1, planen fase 0b nevner dem ikke, planpunktet «eAccounting-prøve» skal først vise hva koblingstabellen trenger.
    - **Ståle må gjøre selv** (føres under «Trenger Ståle når han er tilbake» i tilstandsfilen): legge inn de fire secretene i GitHub (alle fire sammen) og prøve én ekte innlogging i testmiljøet; gi appregistreringen `Mail.Send` som applikasjonsrettighet og sette tilgangspolicyen i Exchange slik at den bare kan sende fra `MAIL_FROM` (uten policyen kan appen sende fra alle postbokser i Byggcon); bekrefte at samme appregistrering som Optiplan skal brukes; bekrefte at Microsofts databehandleravtale for Microsoft 365 dekker appregistreringen (samme som for Azure-lagringen i PR #62). Ingen e-post til ekte mottakere før det.

**Ikke med (bevisst utelatt):**

- **`external_references`** og **`company_id`** på tilkoblinger. Fase 3, «Fakturagrunnlag til eAccounting» (avgjørelse 1 og 2). Se «Til fase 3» nederst.
- Skjermer for admin (liste over tilkoblinger, slå av og på). Kommer som egen oppgave når en tilkobling trenger innstillinger fra admin (regnskap i fase 3).
- Regnskap/eAccounting, meglersystem, eiendomsdata, SMS, tale til tekst, KI-kall, energimerking, skanning. Bare portkodene finnes.
- Nøkkelboksen (Azure Key Vault): eget punkt i fase 0b. `readSecret` leser miljøvariabler til da.
- Flytting av filtjenestens valg (`FILE_STORAGE_DRIVER`) inn i tabellen. Egen liten oppgave etter denne.
- E-post til ekte mottakere, innlogging i Microsoft 365, secrets i GitHub, endring i `infra/` eller utrullingen. Ingenting som koster penger.
- HTML-e-post, vedlegg, flere mottakere, kopi, svar-til, maler for e-post. Rapporten som vedlegg kommer i fase 3 (rutinene).
- Helsesjekk eller «prøv tilkoblingen»-knapp (`/api/helse` endres ikke).
- Token-mellomlager i Graph-adapteren (avgjørelse 3). Legges til når volumet krever det.
- Automatisk ny sending etter feil, kø for e-post. Better Auth gir feil til brukeren, som prøver igjen.

## Tilgang

All sjekk i `src/core/access` via `requireOrganizationAccess`. Spørringer filtrerer på `grant.organizationId`. Ingen nye rettigheter.

| Rolle | Se tilkoblinger | Endre tilkoblinger |
|---|---|---|
| takstmann | nei | nei |
| kontor | nei | nei |
| leder | nei | nei |
| admin | ja (`organization.manage`) | ja |

Admin stenges ikke ute. `findActiveConnection` og `resolveEmailSender` har ingen actor (de brukes av laget selv, for eksempel ved innlogging). Lint-regelen for modulgrenser stopper **ikke** at `src/app` eller `src/modules` importerer fra `@/core`, derfor: de eksporteres ikke fra `index.ts`, og en statisk test (`src/core/integrations/static-checks.test.ts`, samme mønster som `src/core/files/static-checks.test.ts`) viser at ingen fil under `src/app` eller `src/modules` importerer `connections`, `resolve`, `findActiveConnection` eller `resolveEmailSender`. `sendEmail(email, { organizationId })` kalles alltid med `grant.organizationId`.

## Data

- Ny tabell **`integration_connections`** (Omfang 2), én migrering (`0011_tilkoblinger.sql`).
- Faste koder: portene (Omfang 1), leverandørene `dev_mailbox`, `server_log`, `microsoft365`, statusene `active`, `disabled`, `error`. Revisjonsloggens `entityType` `integration_connection` med `action` `create`, `update`, `delete`.
- `secret_ref` er alltid et navn, aldri en verdi. Zod avviser verdier som inneholder `=`, mellomrom eller små bokstaver, slik at en som limer inn selve nøkkelen ved et uhell, får feil. Nektlisten i Omfang 3 gjelder også her.
- Ingen seed-endring: Byggcon får ingen tilkobling automatisk; testmiljøet bruker systemvalget fra miljøet.

## Skjermer

Ingen. `/dev/epost` virker som før (leser utviklingspostkassen).

## Regler

Ingen fagregler. Valgreglene for leverandør (Omfang 6) får testsaker i `resolve.test.ts` med fasiten skrevet inn i testen.

## Grensesnitt mellom utvikler og testskriver (så de kan jobbe i parallell)

```ts
// src/core/integrations/index.ts
export { INTEGRATION_PORTS, PROVIDERS_BY_PORT, CONNECTION_STATUSES, type IntegrationPort, type ConnectionStatus } from "./ports";
export { readSecret, SecretNotFoundError, InvalidSecretRefError } from "./secrets";
export { listConnections, createConnection, updateConnection, markConnectionDeleted, ConnectionValidationError, ConnectionNotFoundError, type ConnectionSummary, type CreateConnectionInput, type UpdateConnectionInput } from "./connections";
// IKKE findActiveConnection (importeres fra "./connections" i tester)

// src/core/email/index.ts
export type Email = { to: string; subject: string; text: string; logLine?: string };
export type EmailProvider = "dev_mailbox" | "server_log" | "microsoft365";
export type EmailSender = { readonly provider: EmailProvider; send(email: Email): Promise<void> };
export type StoredEmail = Email & { id: number; sentAt: Date };
export function sendEmail(email: Email, options?: { organizationId?: string; fetchFn?: typeof fetch }, env?: Env): Promise<void>;
export function readDevMailbox(): StoredEmail[];
export { createGraphEmailSender, EmailSendError } from "./graph"; // EmailSendError: step "token" | "send", statusCode number | null
// IKKE resolveEmailSender (importeres fra "./resolve" i tester)

// src/core/email/resolve.ts
export function resolveEmailSender(options: { organizationId?: string; fetchFn?: typeof fetch }, env?: Env): Promise<{ sender: EmailSender; connectionId: string | null }>;
```

Fabrikk i `tests/factories.ts`: `createIntegrationConnection(organizationId, overrides = {})` (standard `port: "email"`, `provider: "server_log"`, `status: "active"`, `settings: {}`; overstyringer: `port`, `provider`, `status`, `secretRef`, `settings`, `lastOkAt`, `lastError`, `deletedAt`, `deletedBy`). Setter inn rått uten validering, slik at testene kan lage rader tjenesten ville avvist. `RESET_TABLES` får `integration_connections`. Testskriveren lager fabrikken; utvikleren bruker ikke fabrikken i kode.

## Akseptkriterier

Tabell og tilgang
- [ ] Migreringen lager tabellen med felles kolonner og den delvise unike indeksen. `pnpm db:migrate` og `pnpm db:generate` gir ingen diff etterpå.
- [ ] `listConnections`, `createConnection`, `updateConnection` og `markConnectionDeleted` krever `organization.manage`: takstmann, kontor og leder får `AccessDeniedError`, ingen rad endres og ingen loggrad skrives. Admin får alt.
- [ ] `expectTenantIsolation` for `listConnections` (admin i A ser ikke B sine tilkoblinger, og får nektet mot B sin id) og for `updateConnection`.
- [ ] `findActiveConnection(orgA, "email")` finner aldri raden til organisasjon B, selv når B har den eneste aktive e-posttilkoblingen (`expectTenantIsolation` der det passer, ellers vist for hånd).
- [ ] Ukjent port, ukjent leverandør, leverandør som ikke hører til porten, `secretRef` med `=`/mellomrom/små bokstaver/ett tegn, `secretRef` på nektlisten, og ukjent nøkkel i `settings` avvises med `ConnectionValidationError` før noe skrives (ingen rad, ingen loggrad).
- [ ] `microsoft365` krever `secretRef` og `settings` med `from` (e-postadresse), `tenantId` (`^[A-Za-z0-9.-]{1,64}$`) og `clientId`; `dev_mailbox` og `server_log` godtar bare tomme `settings`.
- [ ] To tilkoblinger for samme organisasjon og port avvises med `ConnectionValidationError`, også når den første er `disabled`; etter myk sletting av den første kan en ny lages. Den delvise indeksen i databasen stopper også en rå innsetting (fabrikken) av en dublett.
- [ ] `updateConnection` godtar bare `active` og `disabled` fra admin, aldri `error`; port og leverandør kan ikke endres; `settings` sjekkes mot radens leverandør; `secretRef` kan ikke fjernes for `microsoft365`; `last_error` beholdes ved `error` → `active`; tomt input gir ingen loggrad.
- [ ] `updateConnection` og `markConnectionDeleted` med ukjent id, ikke-uuid, slettet rad eller id fra en annen organisasjon gir `ConnectionNotFoundError` og endrer ingenting.
- [ ] Revisjonsloggen får én rad per `create`, `update` og `delete` med `entityType: "integration_connection"`, organisasjonen fra tilgangssjekken, og aldri en e-postadresse eller hemmelighet i `changes` (test: `settings.from` står ikke i `changes`, bare nøkkelen `from`).

Hemmeligheter
- [ ] `readSecret("MS_GRAPH_CLIENT_SECRET")` gir verdien fra miljøet; mangler den eller er tom streng, kastes `SecretNotFoundError` der meldingen inneholder navnet og aldri noen verdi. Ugyldig navn (`"ms graph"`, `"a=b"`, `"lowercase"`, tom, `"A"`, `"1ABC"`, `"ABC-DEF"`, 129 tegn, navn med linjeskift) kastes som `InvalidSecretRefError` uten å lese miljøet.
- [ ] Nektlisten: `readSecret("BETTER_AUTH_SECRET")` (og de andre fire) kaster `InvalidSecretRefError` selv om verdien finnes i miljøet, og `createConnection`/`updateConnection` med slikt `secretRef` gir `ConnectionValidationError`.
- [ ] Statisk test: ingen fil i `src/` leser `MS_GRAPH_CLIENT_SECRET` som verdi (`env.MS_GRAPH_CLIENT_SECRET`, `.MS_GRAPH_CLIENT_SECRET` etter `getEnv()`/`env`/`process.env`, `process.env["MS_GRAPH_CLIENT_SECRET"]`) unntatt `src/shared/config/env.ts` (validerer bare at verdien finnes), `src/core/integrations/secrets.ts` og `*.test.ts`. Strengen `"MS_GRAPH_CLIENT_SECRET"` som navn er lov. `env.ts` beholder «alle fire eller ingen».
- [ ] Statisk test: ingen fil under `src/app` eller `src/modules` importerer `connections`, `resolve`, `findActiveConnection` eller `resolveEmailSender`; `index.ts` i begge mappene eksporterer dem ikke.

E-post
- [ ] `resolveEmailSender` følger fasit-tabellen i testen: `DEV_MAILBOX` → `dev_mailbox` (uansett tilkobling); organisasjon med aktiv `microsoft365`-tilkobling → `microsoft365` med tilkoblingens `settings` og `secretRef`, `connectionId` satt; `disabled` eller ingen tilkobling → systemvalget (`connectionId` `null`); de tre verdiene i miljøet satt → `microsoft365` via `readSecret("MS_GRAPH_CLIENT_SECRET")`; ellers `server_log`. Hvert kall gir ny sender (raden leses på nytt).
- [ ] `sendEmail` uten organisasjon virker som i dag; dagens tester for `server_log` og postkassen går grønne med `resolveEmailSender`. `/dev/epost` viser fortsatt e-poster lokalt.
- [ ] Vellykket sending gjennom en tilkobling (falsk `fetchFn` via `options.fetchFn`) setter `last_ok_at`, nullstiller `last_error` og setter `status = active` fra `error`; feil (også `readSecret` som kaster før sending) setter `last_error` (uten mottaker, kode eller hemmelig verdi, høyst 500 tegn; navnet på hemmeligheten kan stå) og `status = error`, feilen kastes videre, og revisjonsloggen får ingen rad. `dev_mailbox` og systemvalget skriver ingenting til tabellen.
- [ ] Graph-adapteren (falsk `fetchFn`, aldri nett): hver sending gjør ett token-kall og ett sendekall; sender til riktig adresse med `from` kodet i stien, `contentType: "Text"`, `saveToSentItems: false`, én mottaker; `tenantId` kodet i token-adressen; klienthemmeligheten står bare i kroppen til token-kallet; `init.signal` er en `AbortSignal` på begge kallene; feil 401 fra token og 403/429/500 fra sending gir `EmailSendError` med `step` og `statusCode`; `fetchFn` som kaster gir `EmailSendError` med `statusCode: null` og uten `cause`; meldingen inneholder verken svaret fra Microsoft, mottaker, emne, tekst eller hemmeligheten; token-svar uten `access_token` gir `EmailSendError` med `step: "token"`. Ugyldig `tenantId` eller `from` avvises når senderen lages.
- [ ] Ingen test gjør et ekte nettkall: `fetch` i `globalThis` er aldri kalt i e-posttestene (spion som i dagens test).
- [ ] Loggeren vasker `client_secret=…` i tekst, og `clientSecret` som nøkkel gir `[fjernet]` mens `secretRef`-navnet står.

Alltid
- [ ] Bruker i annen organisasjon får ikke tilgang (test).
- [ ] Virker på iPad-størrelse (e2e): ingen ny skjerm, men innloggingstestene (pc og iPad) går grønne uendret.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Ingen ny avhengighet. Ingen produktnavn i `src/` utenom `brand.ts`. Ingen modellnavn.

## Roller

Forenkler (runde 1 på kortet, runde 2 på koden), sikkerhet-personvern (hemmeligheter, e-post, vasking i logg), test-leder (testplan), utvikler og testskriver i parallell. Ingen ux-ansvarlig, ui-designer, fagansvarlig eller KI-ansvarlig: ingen skjermer, ingen fagtekst, ingen KI-kall.

**Deling i to biter:**
- **Utvikler:** skjema og migrering, `ports.ts`, `secrets.ts`, `connections.ts`, e-postadapterne (`dev-mailbox.ts`, `graph.ts`, `resolve.ts`), omskriving av `sendEmail`, `scrubText`, dokumentasjon, `.env.example`, versjon.
- **Testskriver:** fabrikken, testene for tilgang og tenant-isolasjon, validering, unikhet, revisjonslogg, `readSecret` (med nektliste), `resolve.test.ts`, `graph.test.ts` med falsk `fetchFn`, de statiske testene, oppdatering av `email.test.ts` og `logger.test.ts`. Testplanen `fase0b-tilkoblingslag-testplan.md` gjelder med kuttene i «Avgjørelser etter runde 1» (avsnittene om `external_references`, `company_id`, token-mellomlager og klokke går ut).

## Til fase 3 (huskes på planpunktet «Fakturagrunnlag til eAccounting»)

- `external_references` (`entity_type`, `entity_id`, `connection_id`, `external_id`; unik per tilkobling) og `company_id` på `integration_connections` (eller `companies.accounting_connection_id`, velges etter eAccounting-prøven).
- Modulen som lagrer en referanse, må vise at `entity_id` hører til `grant.organizationId` før den lagrer, og spørringene filtrerer på `organization_id` på referanseraden selv, ikke bare via tilkoblingen (sikkerhet, runde 1).
- `external_id` logges aldri (`externalid` inn i `SENSITIVE_KEY` i loggeren).

## Åpne spørsmål

- Ingen som stopper PR-en. Det Ståle må gjøre selv, står i Omfang 10 og føres under «Trenger Ståle når han er tilbake».
