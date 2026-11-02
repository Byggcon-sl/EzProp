# Funksjon: Tilkoblingslag med faste porter, første tilkobling e-post

- **Fase:** 0b (Grunnmur)
- **Modul:** kjerne (`src/core/integrations`, `src/core/email`)
- **Status:** utkast (oppgavekort laget av prosjektlederen 02.11.2026)
- **Branch:** `fase0b-tilkoblingslag` fra `main`. Versjon **0.2.53** (én patch over `main`, som har 0.2.52; står `main` på en annen versjon når PR-en åpnes, brukes neste ledige patch).
- **Støtter hovedmål:**
  - **Tid:** alt som senere snakker med andre systemer (regnskap, meglersystem, eiendomsdata, KI, SMS) går gjennom ett lag med samme mønster. Hver ny tilkobling blir en adapter, ikke en ombygging. Takstmannen merker det ikke nå, men innlogging med kode på e-post via Microsoft 365 er det som gjør at alle ansatte kan logge inn i testmiljøet, ikke bare første admin.
  - **Reklamasjoner:** `external_references` hindrer dubletter hos leverandøren (samme megler to ganger i eAccounting), og `last_ok_at`/`last_error` viser når en tilkobling sviktet. Revisjonsloggen viser hvem som endret en tilkobling.
  - **KI først:** porten `ai` er en fast kode fra dag én. KI-kallene i fase 2 og 3 bygger på dette laget, med samme tilgangssjekk og samme måte å holde hemmeligheter på. Ingen KI-kall bygges nå.

## Problem

I dag sender `sendEmail` i `src/core/email` direkte ut fra miljøvariablene, og Microsoft 365-grenen kaster feil («kobles til i fase 0b»). Filtjenesten velger adapter med en miljøvariabel (A40) og sier selv at valget skal flyttes til tilkoblingslaget. Regnskap, meglersystem og KI kommer i fase 2 og 3. Uten et felles lag vil hver av dem lage sin egen måte å velge leverandør, holde hemmeligheter og huske ID-er hos leverandøren. Lar vi være, blir hemmeligheter og leverandørvalg spredt rundt i koden, og nøkkelboksen (eget punkt) må kobles inn mange steder i stedet for ett.

## KI først

KI kan ikke gjøre denne oppgaven: den er grunnmur. Men laget er det KI-tjenestene senere kobles på gjennom (porten `ai`, egen hemmelighet, egen status). Ingenting KI-spesifikt bygges nå.

## Brukerhistorier

- Som **admin** vil jeg **se hvilke tilkoblinger organisasjonen har, og slå dem av og på**, slik at jeg vet hva EzProp snakker med. (Bare funksjonene nå; skjermen kommer senere.)
- Som **ansatt** vil jeg **få engangskoden på e-post fra Byggcons postboks** slik at jeg kan logge inn i testmiljøet, ikke bare første admin.
- Som **utvikler av senere funksjoner** vil jeg **legge til en ny tilkobling som én adapter bak en fast port** slik at jeg aldri må skrive leverandørkall i modulene.

## Omfang

**Med:**

1. **Portene som faste koder** i `src/core/integrations/ports.ts`: `accounting`, `email`, `broker`, `property_data`, `sms`, `speech_to_text`, `ai`, `file_storage`, `energy_label`, `scanning` (domenemodellen 4.10). Faste koder endres aldri (regel 6). Hver port har en fast liste over **leverandører** (`provider`) som er kjent i koden. Nå er bare e-posten fylt ut: `email` = `dev_mailbox`, `server_log`, `microsoft365`. De andre portene har tom liste; en tilkobling med ukjent leverandør avvises med en tydelig feil.
2. **Tabellen `integration_connections`** (ny migrering) etter domenemodellen: felles kolonner (`organization_id`, sporingsfelt, `deleted_at`/`deleted_by`, `row_version`), `company_id` (valgfri, sammensatt fremmednøkkel `(company_id, organization_id)` mot `companies` som på `employees`), `port` (tekst, fast kode), `provider` (tekst, fast kode), `status` (`active`, `disabled`, `error`), `secret_ref` (tekst, valgfri; **bare navnet** på hemmeligheten), `settings` (jsonb, standard `{}`), `last_ok_at` (tidspunkt, valgfri), `last_error` (tekst, valgfri). **Én aktiv tilkobling per organisasjon, port og selskap** blant rader som ikke er slettet; to rader uten selskap for samme port er også sperret. Løses med delvis unik indeks (`COALESCE(company_id, nil-uuid)` eller tilsvarende) **eller** en sjekk i tjenesten under lås; utvikleren velger, testen i akseptkriteriene er den samme. Indeks som starter med `organization_id`.
3. **Tabellen `external_references`** (samme migrering): felles kolonner, `entity_type` (tekst, for eksempel `contact`, `invoice_draft`), `entity_id` (uuid, ingen fremmednøkkel, raden kan ligge i hvilken som helst tabell), `connection_id` (sammensatt fremmednøkkel `(connection_id, organization_id)` mot `integration_connections`), `external_id` (tekst). Unik på `(connection_id, external_id)` og på `(connection_id, entity_type, entity_id)` blant rader som ikke er slettet.
4. **Hemmeligheter leses gjennom én funksjon**, `readSecret(secretRef)` i `src/core/integrations/secrets.ts`. Nå leser den `process.env[secretRef]`. `secretRef` må passe `^[A-Z][A-Z0-9_]{1,127}$`, ellers avvises den før noe leses. Mangler verdien, kastes `SecretNotFoundError` med **bare navnet** i meldingen. Dette er det eneste stedet som skal byttes når nøkkelboksen (Azure Key Vault, eget punkt) kommer. Verdien logges aldri; loggeren vasker allerede nøkler som heter `secret`/`clientsecret`.
5. **Tjenesten for tilkoblinger** i `src/core/integrations/connections.ts` (bare admin, `organization.manage`; all sjekk i `src/core/access`, alle spørringer filtrerer på `grant.organizationId`):
   - `listConnections(actor, organizationId)`: alle tilkoblinger som ikke er slettet, sortert på port og leverandør. Fast feltliste: `id`, `companyId`, `port`, `provider`, `status`, `secretRef`, `settings`, `lastOkAt`, `lastError`. Ingen sporingsfelt.
   - `createConnection(actor, organizationId, input)`: `input` = `{ port, provider, companyId?, secretRef?, settings? }`, validert med Zod: port og leverandør må være kjente koder og høre sammen, `companyId` må være et selskap i samme organisasjon som ikke er slettet, `settings` valideres per leverandør (se 7), ukjente nøkler avvises. Status settes til `active`. Skriver én rad i revisjonsloggen (`entityType: "integration_connection"`, `action: "create"`, `changes` med port, leverandør, selskap og `secretRef`-navnet, aldri innhold fra `settings` som kan være en adresse).
   - `updateConnection(actor, organizationId, connectionId, input)`: `input` = `{ status?, secretRef?, settings? }` (port, leverandør og selskap kan ikke endres; lag en ny tilkobling i stedet). `status` kan settes til `active` eller `disabled` av admin; `error` settes bare av laget selv. Revisjonslogg med `action: "update"` og gammel/ny verdi per felt (for `settings`: bare nøklene som ble endret, ikke verdiene). Ukjent id, slettet rad eller id fra en annen organisasjon gir «ikke funnet» og endrer ingenting.
   - `markConnectionDeleted(actor, organizationId, connectionId)`: myk sletting, revisjonslogg `action: "delete"`. `external_references` som peker på tilkoblingen, røres ikke (de er historikk).
   - `findActiveConnection(organizationId, port, companyId?)` (intern, uten actor; brukes av portene i laget, aldri fra moduler eller sider): første rad med `status` ulik `disabled` og `deleted_at` tom. Med `companyId` prøves selskapets rad først, så raden uten selskap. Eksporteres fra `@/core/integrations` bare fordi tenant-testen trenger den.
6. **Tjenesten for eksterne referanser** i `src/core/integrations/external-references.ts` (alle ansatte med `organization.read`, siden den som sender faktura eller oppretter kontakt hos leverandøren trenger den; selve fagsjekken gjør modulen):
   - `saveExternalReference(actor, organizationId, { connectionId, entityType, entityId, externalId })`: tilkoblingen må finnes i `grant.organizationId`. Finnes raden fra før med samme `externalId`, returneres den (ingen dublett, ingen feil). Finnes raden med en annen `externalId`, kastes `ExternalReferenceConflictError`.
   - `findExternalReference(actor, organizationId, { connectionId, entityType, entityId })`: raden eller `null`.
   Ingen revisjonslogg for referanser (de er en speiling av leverandøren, ikke en beslutning).
7. **E-postporten** i `src/core/email` med tre leverandører bak samme grensesnitt `EmailSender = { readonly provider: EmailProvider; send(email: Email): Promise<void> }`:
   - `dev_mailbox` (finnes i dag som `devMailbox`): flyttes til `src/core/email/dev-mailbox.ts`, samme oppførsel (50 siste, `/dev/epost` leser med `readDevMailbox`, bare når `DEV_MAILBOX` er på).
   - `server_log` (finnes, `server-log.ts`): uendret oppførsel, bare første admin, aldri adressen i loggen.
   - `microsoft365` (**ny**, `src/core/email/graph.ts`): sender fra **én postboks** med klientlegitimasjon (tenant, klient-id, klienthemmelighet), som i Optiplan. Lages med `createGraphEmailSender({ tenantId, clientId, clientSecret, from }, fetchFn = fetch)`. Henter token fra `https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token` med `grant_type=client_credentials` og `scope=https://graph.microsoft.com/.default`, husker token i minnet til 60 sekunder før utløp, og sender med `POST https://graph.microsoft.com/v1.0/users/<from>/sendMail` (`contentType: "Text"`, `saveToSentItems: false`, én mottaker). Ved feil kastes `EmailSendError` med **bare statuskode** og hvilket steg (token eller sending), aldri svaret fra Microsoft, aldri mottaker, emne eller tekst. Tidsavbrudd 15 sekunder per kall (`AbortSignal.timeout`). Ingen ny avhengighet: `fetch` innebygd i Node. **Kan ikke prøves mot ekte konto nå**; testene bruker en falsk `fetchFn`. Dette er samme mønster som Azure-adapteren i filtjenesten (A40, A41): bare kode, slås på av Ståle. `settings` for leverandøren er `{ from, tenantId, clientId }` (alle påkrevd, `from` er en e-postadresse), og `secretRef` er påkrevd og peker på klienthemmeligheten.
   - **Valg av leverandør** i `src/core/email/resolve.ts`, `resolveEmailSender({ organizationId? }, env)`:
     1. Uten organisasjon (innloggingskoder, `otpEmail`): som i dag fra miljøet. `DEV_MAILBOX` på → `dev_mailbox`; alle fire `MS_GRAPH_*`/`MAIL_FROM` satt → `microsoft365` med `secretRef = "MS_GRAPH_CLIENT_SECRET"` lest gjennom `readSecret`; ellers `server_log`. `DEV_MAILBOX` vinner alltid lokalt (som i dag).
     2. Med organisasjon: `findActiveConnection(organizationId, "email")`. Finnes den, brukes dens leverandør, `settings` og `secretRef` (gjennom `readSecret`). Finnes ingen, brukes systemvalget i punkt 1. `DEV_MAILBOX` vinner også her, slik at ingen ekte sending kan skje lokalt eller i test.
   - **`sendEmail(email, options?)`** beholder dagens signatur for e-post uten organisasjon (`sendEmail(email)` i `auth.ts` endres ikke), og får valgfritt `{ organizationId }`. Gikk sendingen gjennom en tilkobling i tabellen, settes `last_ok_at` ved suksess (og `status` tilbake til `active` om den sto i `error`), og `last_error` (vasket med `scrubText`, høyst 500 tegn, aldri adresse) og `status = "error"` ved feil. Disse skrivingene er systemets egne og får **ingen** rad i revisjonsloggen (ingen ansatt gjorde det). Feilen kastes videre etter at raden er oppdatert. Systemvalget (uten tilkobling i tabellen) skriver ingenting til tabellen.
   - `emailTransport(env)` beholdes som navn for bakoverkompatible tester, men returnerer leverandørkodene `dev_mailbox` | `microsoft365` | `server_log`. Testene i `email.test.ts` oppdateres tilsvarende.
8. **Filtjenesten røres ikke.** `FILE_STORAGE_DRIVER` (A40) beholdes; flytting av valget til tabellen er en egen liten oppgave etter denne.
9. **Dokumentasjon og oppsett:** `docs/drift/testmiljo-azure.md` (de fire secretene kan nå legges inn, alle fire sammen; appregistreringen skal være begrenset til én postboks med en tilgangspolicy i Exchange, som i Optiplan; ingen ekstra kostnad), `.env.example` (kommentar om at `MS_GRAPH_CLIENT_SECRET` er navnet laget leser gjennom `readSecret`), `docs/05-domenemodell.md` (4.10: «Bygget i fase 0b» med feltene slik de ble, status-reglene og én aktiv per port og selskap), `docs/06-arkitektur.md` (regel 8 peker på `src/core/integrations`, `readSecret` som eneste vei til hemmeligheter), ordlisten (tilkobling, port, leverandør, ekstern referanse, hemmelighetsnavn). `start.sh` endres ikke. Versjon 0.2.53.
10. **Beslutninger som føres i `docs/09-apne-sporsmal.md`** («Avgjort av agentene mens Ståle var borte») av prosjektlederen i PR-en, med neste ledige numre (A44 og videre):
    - Graph-adapteren bygges nå som bare kode, selv om spørsmål nr. 6 sa «ikke før Ståle har svart»: autonom modus, ingen sending uten at Ståle legger inn de fire secretene, samme mønster som Azure-adapteren (A40). Kilde: planen fase 0b, nr. 6, `CLAUDE.md` autonom modus.
    - E-post uten organisasjon (innloggingskoder) bruker systemvalget fra miljøet; en tilkobling i tabellen gjelder bare når avsenderen oppgir organisasjon. Kilde: innloggingen skjer før organisasjonen er kjent (Better Auth), og testmiljøet skal virke uten rader i tabellen.
    - Leverandørlistene per port er faste koder i koden, tomme for alle porter unntatt e-post. Filtjenesten beholder miljøvariabelen (A40) til en egen liten oppgave flytter den. Kilde: regel 1 (hold det enkelt) og regel 6.
    - Automatiske oppdateringer av `last_ok_at`, `last_error` og `status = error` får ingen rad i revisjonsloggen. Kilde: revisjonsloggen er for det ansatte gjør (A33).
11. **Trenger Ståle når han er tilbake** (føres i `docs/agenter/tilstand.md` av prosjektlederen): legge inn de fire secretene i GitHub (alle fire sammen) og prøve én ekte innlogging i testmiljøet; sette tilgangspolicyen i Exchange slik at appregistreringen bare kan sende fra `MAIL_FROM`; bekrefte at samme appregistrering som Optiplan skal brukes. Ingen e-post til ekte mottakere før det.

**Ikke med (bevisst utelatt):**

- Skjermer for admin (liste over tilkoblinger, slå av og på). Kommer som egen oppgave når en tilkobling trenger innstillinger fra admin (regnskap i fase 3).
- Regnskap/eAccounting, meglersystem, eiendomsdata, SMS, tale til tekst, KI-kall, energimerking, skanning. Bare portkodene finnes.
- Nøkkelboksen (Azure Key Vault): eget punkt i fase 0b. `readSecret` leser miljøvariabler til da.
- Flytting av filtjenestens valg (`FILE_STORAGE_DRIVER`) inn i tabellen. Egen liten oppgave etter denne.
- E-post til ekte mottakere, innlogging i Microsoft 365, secrets i GitHub, endring i `infra/` eller utrullingen. Ingenting som koster penger.
- HTML-e-post, vedlegg, flere mottakere, kopi, svar-til, maler for e-post. Rapporten som vedlegg kommer i fase 3 (rutinene).
- Helsesjekk eller «prøv tilkoblingen»-knapp (`/api/helse` endres ikke).
- Innstillinger på selskap for e-post (bare organisasjon nå; `company_id` er med i tabellen for regnskapet senere og testes bare som kolonne og unikhet).
- Automatisk ny sending etter feil, kø for e-post. Better Auth gir feil til brukeren, som prøver igjen.
- Sletting av rader i `external_references` ved sletting av tilkobling.

## Tilgang

All sjekk i `src/core/access` via `requireOrganizationAccess`. Spørringer filtrerer på `grant.organizationId`. Ingen nye rettigheter.

| Rolle | Se tilkoblinger | Endre tilkoblinger | Eksterne referanser (lese og lagre) |
|---|---|---|---|
| takstmann | nei | nei | ja (`organization.read`) |
| kontor | nei | nei | ja |
| leder | nei | nei | ja |
| admin | ja (`organization.manage`) | ja | ja |

Admin stenges ikke ute. `findActiveConnection` og `resolveEmailSender` har ingen actor (de brukes av laget selv, for eksempel ved innlogging) og eksporteres ikke til moduler eller sider: lint-regelen for modulgrenser dekker dette ved at bare `src/core` kaller dem.

## Data

- Ny tabell **`integration_connections`** og **`external_references`** (Omfang 2 og 3), én migrering (`0011_tilkoblinger.sql`).
- Faste koder: portene (Omfang 1), leverandørene `dev_mailbox`, `server_log`, `microsoft365`, statusene `active`, `disabled`, `error`. Revisjonsloggens `entityType` `integration_connection` med `action` `create`, `update`, `delete`.
- `secret_ref` er alltid et navn, aldri en verdi. Zod avviser verdier som inneholder `=`, mellomrom eller små bokstaver, slik at en som limer inn selve nøkkelen ved et uhell, får feil.
- Ingen seed-endring: Byggcon får ingen tilkobling automatisk; testmiljøet bruker systemvalget fra miljøet.

## Skjermer

Ingen. `/dev/epost` virker som før (leser utviklingspostkassen).

## Regler

Ingen fagregler. Valgreglene for leverandør (Omfang 7) får testsaker i `resolve.test.ts`.

## Grensesnitt mellom utvikler og testskriver (så de kan jobbe i parallell)

```ts
// src/core/integrations/index.ts
export { INTEGRATION_PORTS, PROVIDERS_BY_PORT, CONNECTION_STATUSES, type IntegrationPort, type ConnectionStatus } from "./ports";
export { readSecret, SecretNotFoundError, InvalidSecretRefError } from "./secrets";
export { listConnections, createConnection, updateConnection, markConnectionDeleted, findActiveConnection, ConnectionValidationError, type ConnectionSummary, type CreateConnectionInput, type UpdateConnectionInput } from "./connections";
export { saveExternalReference, findExternalReference, ExternalReferenceConflictError } from "./external-references";

// src/core/email/index.ts
export type Email = { to: string; subject: string; text: string; logLine?: string };
export type EmailProvider = "dev_mailbox" | "server_log" | "microsoft365";
export type EmailSender = { readonly provider: EmailProvider; send(email: Email): Promise<void> };
export function sendEmail(email: Email, options?: { organizationId?: string }, env?: Env): Promise<void>;
export function emailTransport(env?: Env): EmailProvider;
export function readDevMailbox(): StoredEmail[];
export { createGraphEmailSender, EmailSendError } from "./graph";
export { resolveEmailSender } from "./resolve";
```

Fabrikker i `tests/factories.ts`: `createIntegrationConnection(organizationId, overrides)` (standard port `email`, leverandør `server_log`, status `active`) og `createExternalReference(organizationId, connectionId, overrides)`. Testskriveren lager fabrikkene; utvikleren bruker ikke fabrikkene i kode.

## Akseptkriterier

Tabeller og tilgang
- [ ] Migreringen lager begge tabellene med felles kolonner, fremmednøkler og de unike indeksene. `pnpm db:migrate` og `pnpm db:generate` gir ingen diff etterpå.
- [ ] `listConnections`, `createConnection`, `updateConnection` og `markConnectionDeleted` krever `organization.manage`: takstmann, kontor og leder får `AccessDeniedError` og ingen rad endres. Admin får alt.
- [ ] `expectTenantIsolation` for `listConnections` (admin i A ser ikke B sine tilkoblinger, og får nektet mot B sin id).
- [ ] `expectTenantIsolation` for en lesespørring på `external_references` (for eksempel en testhjelper rundt `findExternalReference`, eller en `listExternalReferences` som bare brukes av testen), slik at begge tabellene har hver sin isolasjonstest.
- [ ] `findActiveConnection(orgA, "email")` finner aldri raden til organisasjon B, selv når B har den eneste aktive e-posttilkoblingen.
- [ ] Ukjent port, ukjent leverandør, leverandør som ikke hører til porten, `secretRef` med `=`/mellomrom/små bokstaver, `companyId` fra en annen organisasjon eller et slettet selskap, og ukjent nøkkel i `settings` avvises med `ConnectionValidationError` før noe skrives.
- [ ] `microsoft365` krever `secretRef` og `settings` med `from` (e-postadresse), `tenantId` og `clientId`; `dev_mailbox` og `server_log` godtar bare tomme `settings`.
- [ ] To aktive tilkoblinger for samme organisasjon, port og selskap (også begge uten selskap) avvises; etter myk sletting av den første kan en ny lages.
- [ ] `updateConnection` godtar bare `active` og `disabled` fra admin, aldri `error`; port, leverandør og selskap kan ikke endres.
- [ ] `updateConnection` og `markConnectionDeleted` med id fra en annen organisasjon gir «ikke funnet» og endrer ingenting.
- [ ] Revisjonsloggen får én rad per `create`, `update` og `delete` med `entityType: "integration_connection"`, organisasjonen fra tilgangssjekken, og aldri en e-postadresse eller hemmelighet i `changes` (test: `settings.from` står ikke i `changes`, bare nøkkelen `from`).
- [ ] `saveExternalReference` gir samme rad to ganger for samme `externalId` (ingen dublett), kaster `ExternalReferenceConflictError` ved annen `externalId`, og avviser `connectionId` fra en annen organisasjon med «ikke funnet».

Hemmeligheter
- [ ] `readSecret("MS_GRAPH_CLIENT_SECRET")` gir verdien fra miljøet; mangler den, kastes `SecretNotFoundError` der meldingen inneholder navnet og aldri noen verdi. Ugyldig navn (`"ms graph"`, `"a=b"`, `"lowercase"`, tom) kastes som `InvalidSecretRefError` uten å lese miljøet.
- [ ] Ingen fil utenfor `src/core/integrations/secrets.ts` leser `MS_GRAPH_CLIENT_SECRET` fra `process.env` eller `getEnv()` for å bruke den (statisk test med `grep` på `src/`, unntatt `env.ts` som bare validerer at verdien finnes). `env.ts` beholder valideringen «alle fire eller ingen».

E-post
- [ ] `sendEmail` uten organisasjon virker som i dag: `DEV_MAILBOX` → postkassen, de fire satt → `microsoft365`, ellers `server_log` (bare første admin, aldri adresse i loggen). Dagens tester for `server_log` og postkassen går fortsatt grønne (med nye leverandørnavn).
- [ ] `sendEmail` med organisasjon som har aktiv `microsoft365`-tilkobling bruker tilkoblingens `settings` og `secretRef`; har organisasjonen `disabled` eller ingen tilkobling, brukes systemvalget. `DEV_MAILBOX` vinner i begge tilfeller.
- [ ] Vellykket sending gjennom en tilkobling setter `last_ok_at` og `status = active`; feil setter `last_error` (uten mottaker, kode eller hemmelighet, høyst 500 tegn) og `status = error`, feilen kastes videre, og revisjonsloggen får ingen rad.
- [ ] Graph-adapteren (falsk `fetchFn`, aldri nett): henter token én gang og bruker det igjen i neste sending; henter nytt når det er under 60 sekunder igjen; sender til riktig adresse med `from` i stien, `contentType: "Text"`, `saveToSentItems: false`; klienthemmeligheten står bare i kroppen til token-kallet; feil 401 fra token og 403/429/500 fra sending gir `EmailSendError` med steg og statuskode, og meldingen inneholder verken svaret fra Microsoft, mottaker, emne eller tekst; token-svar uten `access_token` gir `EmailSendError`.
- [ ] Ingen test gjør et ekte nettkall: `fetch` i `globalThis` er aldri kalt i e-posttestene (spion som i dagens test).
- [ ] Loggeren vasker `client_secret=…` i tekst (utvid `scrubText` med `client_secret=[^&\s]+`) og nøkkelen `clientsecret` er allerede dekket.
- [ ] `/dev/epost` viser fortsatt e-poster lokalt (e2e for innlogging går grønn uten endring).

Alltid
- [ ] Bruker i annen organisasjon får ikke tilgang (test, begge tabellene).
- [ ] Virker på iPad-størrelse (e2e): ingen ny skjerm, men innloggingstestene (pc og iPad) går grønne.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Ingen ny avhengighet. Ingen produktnavn i `src/` utenom `brand.ts`. Ingen modellnavn.

## Roller

Forenkler (runde 1 på kortet, runde 2 på koden), sikkerhet-personvern (hemmeligheter, e-post, vasking i logg), test-leder (testplan), utvikler og testskriver i parallell. Ingen ux-ansvarlig, ui-designer, fagansvarlig eller KI-ansvarlig: ingen skjermer, ingen fagtekst, ingen KI-kall.

**Deling i to biter:**
- **Utvikler:** skjema og migrering, `ports.ts`, `secrets.ts`, `connections.ts`, `external-references.ts`, e-postadapterne (`dev-mailbox.ts`, `graph.ts`, `resolve.ts`), omskriving av `sendEmail`, `scrubText`, dokumentasjon, `.env.example`, versjon.
- **Testskriver:** fabrikkene, testene for tilgang og tenant-isolasjon (begge tabellene), validering, unikhet, revisjonslogg, `readSecret`, `resolve.test.ts`, `graph.test.ts` med falsk `fetchFn`, den statiske testen for hemmeligheter, oppdatering av `email.test.ts`.

## Åpne spørsmål

- Ingen som stopper PR-en. Det Ståle må gjøre selv, står i Omfang 11 og føres under «Trenger Ståle når han er tilbake».
