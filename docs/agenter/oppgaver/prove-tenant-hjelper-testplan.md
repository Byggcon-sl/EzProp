# Testplan: Testhjelper for tenant-isolasjon (`expectTenantIsolation`)

- **Oppgavekort:** `docs/agenter/oppgaver/prove-tenant-hjelper.md`
- **Fase:** 0a – Repo og database
- **Branch:** `prove-tenant-hjelper` (bygger på `fase-0a-grunnmur`)
- **Laget av:** test-leder, 28.10.2026 (før koding)
- **Støtter hovedmål:** Reklamasjoner, indirekte: en feil der én organisasjon ser en annens data skal aldri nå produksjon, og hver ny spørring får samme sjekk. Tid og KI først: ikke direkte (testverktøy for utviklerne).

## Hva som skal vises

Hjelperen `expectTenantIsolation` skal bevise fire ting for enhver spørring `query(actor, organizationId)`:

1. Bruker i A mot A får **alle** egne rader (minst én) og **ingen** B-rader.
2. Bruker i B mot B får det samme speilvendt.
3. Bruker i A mot B sin id får `AccessDeniedError`.
4. Bruker i B mot A sin id får `AccessDeniedError`.

Feiler én av disse, kaster hjelperen `TenantIsolationError` med norsk melding som sier hvilken organisasjon og hvilken rad-id (eller hvilken retning) det gjelder.

Fast oppsett i alle tester: `resetDatabase` i `beforeEach`, admin-ansatt i begge organisasjoner (regel 11: admin stenges aldri ute, så isolasjonen må holde selv for admin), fabrikkene i `tests/factories.ts`.

## 1. Enhets-/integrasjonstester (mot testdatabasen)

### 1a. Selvtest av hjelperen: `tests/tenant-isolation.test.ts`

| # | Testnavn | Hva den viser |
|---|---|---|
| 1 | «godtar en spørring som filtrerer på grant.organizationId» | Hjelperen er grønn for `listAuditEvents` når `seed` legger inn én hendelse per organisasjon med `recordAuditEvent(db, grantA/grantB, …)`. Viser at hjelperen ikke gir falske feil. |
| 2 | «feiler når spørringen returnerer rader fra den andre organisasjonen» | Lokal spørring `db.select().from(auditLog)` uten `where` (etter at tilgangen er sjekket). Hjelperen kaster `TenantIsolationError`, og meldingen nevner organisasjonen som lekket (`rejects.toThrow(/organisasjon B/)` eller tilsvarende). |
| 3 | «feiler når spørringen ikke kaster AccessDeniedError for fremmed id» | Lokal spørring som returnerer `[]` for fremmed organisasjons-id i stedet for å kaste. Sjekkes i begge retninger: en variant som nekter bare A→B, og en som nekter bare B→A, skal begge feile. Meldingen nevner retningen. |
| 4 | «feiler når spørringen ikke returnerer organisasjonens egne rader» | Lokal spørring som alltid gir `[]` (og kaster riktig for fremmed id). Hjelperen kaster `TenantIsolationError` og sier hvilken organisasjon som manglet egne rader. Uten denne sjekken ville en tom spørring «bestått». |

Krav: feilspørringene i test 2–4 er lokale funksjoner i selvtesten, aldri i `src/`.

### 1b. Bruk i eksisterende test: `src/core/audit/audit.test.ts`

| # | Testnavn | Hva den viser |
|---|---|---|
| 5 | «lagrer hendelsen på organisasjonen fra tilgangssjekken, og bare leder og admin leser den» | **Uendret.** Tilgang per rolle: admin leser, takstmann nektes (`staff.manage`). |
| 6 | «viser aldri hendelser fra en annen organisasjon» | Byttes ut med ett kall til `expectTenantIsolation({ seed, query: listAuditEvents, idOf: (row) => row.id })`. `seed` legger én hendelse i hver organisasjon og returnerer id-ene. Dekker tenant-isolasjon for `listAuditEvents` i begge retninger, pluss at egne rader kommer. |

### 1c. Tilgang: `src/core/access/guards.test.ts`

**Uendret.** Dekker allerede: ansatt i A nektes B (også admin, for alle rettigheter), utenforstående, myk slettet og sluttet ansatt, slettet organisasjon, rettighetsmatrisen, admin har alt. Hjelperen skal ikke gjøre disse testene overflødige; de beviser `requireOrganizationAccess` i seg selv, hjelperen beviser spørringene som bruker den.

### 1d. Kjøring: `vitest.config.ts`

| # | Sjekk | Hva den viser |
|---|---|---|
| 7 | `include` har `tests/**/*.test.ts` | `pnpm test` lister `tests/tenant-isolation.test.ts` med 4 tester i utskriften. Godkjennes ikke før dette er sett i kjøringen. |

## 2. Tilgang per rolle

Ingen ny produktfunksjon, ingen nye rettigheter. Rolle-dekningen ligger i test 5 (audit) og `guards.test.ts` (uendret). Admin brukes i hjelperen, så regel 11 holdes: ingen test skal noen gang vise at admin nektes i egen organisasjon.

## 3. Tenant-isolasjon

Dekket av test 1–4 (hjelperen i seg selv) og test 6 (`listAuditEvents`). Fra og med denne PR-en er regelen for gjennomgang: **hver ny spørring som tar `organizationId` skal ha ett kall til `expectTenantIsolation`** i sin testfil. Test-leder avviser PR-er uten.

## 4. Regeltester (regler som data)

Ingen. Oppgaven har ingen regler eller TG-logikk.

## 5. E2E (PC og iPad-størrelse, uten nett)

Ingen. Ingen skjerm endres. `pnpm test:e2e` kjøres likevel til slutt for å vise at ingenting er brukket (eksisterende `e2e/fase-0a.spec.ts`).

## 6. Myk sletting

Ikke relevant for hjelperen (bare lesing). Spørringer som senere bruker hjelperen må i tillegg ha egen test for `deleted_at`-filtrering; det ligger utenfor hjelperen.

## 7. Godkjenningskriterier (test-leder til slutt)

- `pnpm lint`, `pnpm typecheck`, `pnpm test` grønne; `pnpm test:e2e` grønn.
- Utskriften fra `pnpm test` viser at `tests/tenant-isolation.test.ts` kjørte med 4 tester.
- Test 2–4 feiler på `TenantIsolationError` (ikke generell assert), og meldingene er norske og nevner organisasjon/rad/retning.
- `src/core/audit/index.ts` og `src/core/access/guards.test.ts` er uendret (`git diff --stat`).
- Ingen nye avhengigheter i `package.json` (bare patch-versjon økt).
- Ingen kundeopplysninger i testdata; `seed` bruker oppdiktede verdier (`entityType: "x"` o.l.).

Avvises hvis: selvtesten ikke kjører, en av de fire sjekkene mangler i hjelperen, eller feilspørringene ligger i `src/`.
