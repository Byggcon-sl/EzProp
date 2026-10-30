# 06 – Arkitektur

Sist oppdatert: 28.10.2026. Begrunnelse for teknologivalg: [ADR 0001](adr/0001-teknologivalg.md). Testmiljø i Azure: [ADR 0002](adr/0002-testmiljo-azure.md).

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
| Uten nett | PWA på iPad Pro, lokal lagring og synk per felt. Foreløpig valg: egenbygd lokal lagring og endringskø, uten synktjeneste (ADR 0004, bekreftes etter prøve A og B) |
| Test | Vitest (enhet og integrasjon), Playwright (PC og iPad-størrelse) |
| CI | GitHub Actions: format, lint, typesjekk, migrering i takt med skjema, test, bygg, e2e |
| Hosting | Azure App Service + PostgreSQL Flexible Server, Sweden Central (ADR 0002). Testmiljø fra fase 1, rulles ut fra GitHub Actions ved merge til `main` (`infra/azure/main.bicep`, `.github/workflows/deploy-azure.yml`). Bare oppdiktede data til «Minimum før ekte data» er på plass |

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
    audit/                # Revisjonslogg
    email/
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
8. **Tilkoblinger bak faste porter** (regnskap, e-post, meglersystem, eiendomsdata, KI, bildelagring). Kjernen snakker aldri direkte med en leverandør.
9. **Navn og profil ett sted:** `src/shared/config/brand.ts`.
10. **Server først.** Klientkomponenter bare der det trengs. Befaringen på iPad er unntaket (fase 1 og 2b).

## Personvern og sikkerhet

- Data i EU/EØS. Byggcon er behandlingsansvarlig. Databehandleravtaler med alle leverandører, også KI (EU/EØS, ingen trening på våre data).
- Ingen kundeopplysninger i logg, repo eller testdata. Loggeren vasker e-post, telefon og nøkler.
- Revisjonslogg på alle endringer. Myk sletting. Oppbevaring 10 år.
- Tidsmåling bare samlet til de ansatte har sagt ja (arbeidsmiljøloven kap. 9). Ståle drøfter med de ansatte.
- Sikkerhetshoder på alle svar (`src/shared/config/security-headers.ts`).
