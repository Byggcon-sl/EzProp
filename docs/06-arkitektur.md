# 06 – Arkitektur

Sist oppdatert: 10.11.2026. Begrunnelse for teknologivalg: [ADR 0001](adr/0001-teknologivalg.md). Testmiljø i Azure: [ADR 0002](adr/0002-testmiljo-azure.md).

## Teknologi

| Område | Valg |
|---|---|
| Språk | TypeScript (strict) |
| Rammeverk | Next.js (App Router), React Server Components, Server Actions |
| UI | Tailwind CSS, komponenter etter shadcn-mønster i `src/shared/ui` |
| Database | PostgreSQL 16 |
| ORM / migrering | Drizzle ORM + drizzle-kit |
| Innlogging | Better Auth med e-post-engangskode (OTP), som Optiplan |
| Validering | Zod |
| E-post | Utviklings-postkasse lokalt (`DEV_MAILBOX=1`). I drift før e-post er koblet til: engangskoden for første admin skrives i serverloggen (bare den, ingen andre kan logge inn). Microsoft 365 (Graph) som Optiplan kobles til i fase 0b; valget skjer automatisk når de fire `MS_GRAPH`/`MAIL_FROM`-verdiene er satt |
| Uten nett | PWA på iPad Pro, lokal lagring og synk per felt. Valgt: egenbygd lokal lagring og endringskø, uten synktjeneste (ADR 0004, godkjent av Ståle 10.11.2026). PowerSync og ElectricSQL er fjernet fra koden |
| Test | Vitest (enhet og integrasjon), Playwright (PC og iPad-størrelse) |
| CI | GitHub Actions: format, lint, typesjekk, migrering i takt med skjema, test, bygg, e2e |
| Hosting | Azure App Service + PostgreSQL Flexible Server, Sweden Central (ADR 0002). Testmiljø fra fase 1, rulles ut fra GitHub Actions ved merge til `main` (`infra/azure/main.bicep`, `.github/workflows/deploy-azure.yml`). Bare oppdiktede data til «Minimum før ekte data» er på plass |

## Nettleser (Ståle 04.11.2026)

Vi støtter **Chrome**: på PC og Mac, og på iPad Pro. e2e-testene kjører i Chromium (prosjektene `pc` og `ipad`). På iPad bruker Chrome Apples motor (WebKit), som alle nettlesere der må. Lagringsgrenser, sletting av data og hjemskjerm-appen følger derfor WebKit, ikke Chromium. Regler og prøver for Safari på iPad (fase 1, prøve A–D) gjelder fortsatt. Bruk ikke funksjoner som bare finnes i Chromium på datamaskin, i det som skal virke på iPaden.

## Mappestruktur

```
src/
  app/                    # Next.js-ruter (tynne sider som kaller kjernen og modulene)
    (ansatt)/             # Innloggede ansatte: arbeidskø (senere oppdrag, rapport, admin)
    logg-inn/
    dev/epost/            # Utviklings-postkassen
    api/helse, api/auth
  core/                   # Kjernen
    access/               # Rettigheter og tilgangssjekk (eneste sted)
    auth/                 # Better Auth, sesjon
    ai/                   # All KI: forslag, vask, leverandører, evalueringssett (ADR 0006, bygges i fase 2a-1)
    audit/                # Revisjonslogg
    email/
    files/                # Filtjenesten: porten FileStorage, adaptere, tabellen files
    health/
  modules/                # Fagmoduler (kommer: rapport, maler, regler, oppdrag …)
  shared/
    config/               # brand.ts, env.ts, security-headers.ts
    lib/                  # uuid v7, logger, cn
    ui/                   # Felles komponenter
  db/
    schema/               # Drizzle-skjema, én fil per område. common.ts = felles kolonner
    migrations/
    seed/
```

## Arkitekturregler

1. **Moduler importerer bare fra `core/`, `shared/`, `db/` og egen mappe.** Håndheves med lint-regelen `eslint-rules/module-boundaries.js`.
2. **All datatilgang går gjennom funksjoner som tar inn innlogget bruker og kaller `requireOrganizationAccess` først.** Komponenter snakker ikke med databasen.
3. **Tenant-isolasjon testes** for hver ny spørring.
4. **Felles kolonner på alle tabeller** (`src/db/schema/common.ts`): `id` laget på enheten (UUID v7), `organization_id`, laget/endret av og når, myk sletting, `row_version`.
5. **Migreringer er versjonert** og må være i takt med skjemaet (CI sjekker `pnpm db:generate`).
6. **Regler er data med testsaker** og kjører likt på iPad og server (fase 1 og 2a).
7. **Faste koder endres aldri, de arkiveres.**
8. **Tilkoblinger bak faste porter** (regnskap, e-post, meglersystem, eiendomsdata, KI, bildelagring). Kjernen snakker aldri direkte med en leverandør. Laget ligger i `src/core/integrations`: portene og leverandørene som faste koder, tabellen `integration_connections` og tjenesten for tilkoblinger (bare admin). `readSecret` i `src/core/integrations/secrets.ts` er eneste vei til hemmeligheter: fra miljøvariabler lokalt; i Azure fylles de fra nøkkelboksen ved oppstart (ADR 0005), og en referanse som ikke ble hentet regnes som at hemmeligheten mangler. Adapterne ligger i kjernen (`src/core/email`, `src/core/files`); modulene kaller aldri en leverandør direkte. Leverandør for e-post velges i `resolveEmailSender`: utviklingspostkassen først, så en tilkobling i tabellen for organisasjonen, ellers systemvalget fra miljøet (Microsoft 365 eller serverloggen). Filtjenesten beholder `FILE_STORAGE_DRIVER` (A40) til en egen liten oppgave flytter valget til laget.
9. **Navn og profil ett sted:** `src/shared/config/brand.ts`.
10. **Server først.** Klientkomponenter bare der det trengs. Befaringen på iPad er unntaket (fase 1 og 2b).
11. **KI i bunnen** (Ståle 10.11.2026, [ADR 0006](adr/0006-ki-i-bunnen.md)). All KI går gjennom én modul i kjernen, `src/core/ai`, bak KI-porten i tilkoblingslaget (regel 8). Bare `src/core/ai` kan bruke portene `ai` og `speech_to_text`, og modulene kaller bare de to funksjonene der (be om forslag, registrere beslutning). Ledetekstene ligger versjonert i `src/core/ai`. KI lager **forslag**, aldri ferdig innhold: én rad per kall i `ai_usage_log` med kilde (funksjon, leverandør, modell, ledetekstversjon, feltkoder), utfall (`ok`, `no_match`, `error`), status (`suggested` foreslått, `accepted` godtatt, `edited` endret, `rejected` avvist) og kostnad. Forslaget ligger aldri i verdien før den ansatte har godtatt det, og angre setter det tilbake til foreslått. KI setter aldri TG, publiserer aldri og sender aldri noe. Hver funksjon har en tillatt-liste over felt; navn, e-post, telefon, adresse og matrikkel sendes aldri, og fritekst vaskes. En falsk leverandør (`fake`) brukes i utvikling, test og testmiljøet; ekte leverandør slås på av Ståle og velges aldri fra miljøvariabler. Hver KI-funksjon har et evalueringssett som må bestås før den slås på. KI av/på er `ai.enabled` i `organizations.settings`.

## Filtjenesten (fase 0b)

Alle filer (bilder, PDF-er, dokumenter, senere logo og signatur) lagres og hentes gjennom `src/core/files`. Modulene kaller bare tjenesten, aldri en lagringsleverandør direkte (arkitekturregel 8). Oppgavekort: `docs/funksjoner/fase0b-filtjeneste.md`.

- **Tjenesten:** `saveFile`, `readFile` og `markFileDeleted`. Tilgang via `requireOrganizationAccess` (lagre og hente: `organization.read`; merke som slettet: `organization.manage`). Metadata ligger i tabellen `files` med `organization_id`, type, størrelse og SHA-256. Fingeravtrykket kontrolleres ved hver henting. Rekkefølgen er filen først, så raden; feiler raden, blir filen liggende uten rad og kan ikke nås.
- **Porten `FileStorage`:** bare `put` og `get`. Ingen slette-operasjon, og `put` skriver aldri over en fil som finnes (A39). Nøkkelen er `<organisasjon>/<kind>/<fil-id>`, aldri et filnavn fra brukeren.
- **Adaptere:** velges med `FILE_STORAGE_DRIVER` (A40) til tilkoblingslaget (`integration_connections`) kommer.
  - `local` (standard): mappen `FILE_STORAGE_DIR` (standard `var/files`). Nøkkelen kan ikke gå ut av mappen. Brukes i utvikling og test.
  - `azure`: Azure Blob Storage med `FILE_STORAGE_AZURE_CONNECTION_STRING` og `FILE_STORAGE_AZURE_CONTAINER`. Bare kode foreløpig; ingen ressurser er opprettet. Lagringskontoen skal ligge i **Sweden Central** (EU/EØS), containeren skal være **privat** (ingen offentlig tilgang), og Microsofts databehandleravtale gjelder. `@azure/storage-blob` importeres bare i adapteren. Feil fra Azure pakkes inn uten den opprinnelige meldingen.
  - Senere kan en adapter for et lokalt arkiv hos Byggcon legges til uten endring i tjenesten.
- **Oppbevaring:** tidene for bilder er innstillinger i `organizations.settings` (`readFileRetention`, A42). Så lenge `retain_until` er i fremtiden, kan en fil ikke merkes som slettet, heller ikke av admin.
- **Visning (senere):** en rute som sender filer til nettleseren skal sette `Content-Disposition` (med et trygt filnavn laget av oss) og `X-Content-Type-Options: nosniff`, og bare bruke `mime_type` fra `files`. Ingen slik rute finnes ennå.

## Personvern og sikkerhet

- Data i EU/EØS. Byggcon er behandlingsansvarlig. Databehandleravtaler med alle leverandører, også KI (EU/EØS, ingen trening på våre data).
- Ingen kundeopplysninger i logg, repo eller testdata. Loggeren vasker e-post, telefon og nøkler.
- Revisjonslogg på alle endringer. Myk sletting. Oppbevaring 10 år.
- Adresse, gårds- og bruksnummer, seksjonsnummer, andels- eller aksjenummer og forretningsfører på eiendommen peker på én bestemt bolig og er personopplysninger. De sendes **aldri** til KI, og heller ikke navn, e-post, telefon, festenummer, borettslag eller sameie, organisasjonsnummer og fødselsnummer (regel 14 i `CLAUDE.md`, ADR 0006 del 6). Fritekst vaskes før den sendes, men har restrisiko; databehandleravtale kreves derfor uansett.
- Tidsmåling bare samlet til de ansatte har sagt ja (arbeidsmiljøloven kap. 9). Ståle drøfter med de ansatte.
- Sikkerhetshoder på alle svar (`src/shared/config/security-headers.ts`).
