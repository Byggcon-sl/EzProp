# Testplan: Småfunn fra synktjenestene i Azure (etter PR #17)

- **Oppgavekort:** `docs/agenter/oppgaver/fase1-smafunn-synk-azure.md`
- **Fase:** 1 – Prøve uten nett
- **Branch:** `fase1-smafunn-synk-azure` (bygger på `main`)
- **Laget av:** test-leder, 29.10.2026 (før koding)
- **Støtter hovedmål:** Reklamasjoner: prøven uten nett må være til å stole på, og ingen replikeringsplasser skal forsvinne eller bli liggende uten at vi vet det. Tid: utrullingen stopper tidlig med klar melding ved for korte hemmeligheter, så prøve A og B kan kjøres uten stopp. KI først: indirekte (grunnlaget for befaring på iPad).

## Hva som skal vises

1. `dropUnusedSlots` sletter bare ubrukte **logiske** plasser i `current_database()` med synknavn. Fysiske plasser, aktive plasser og plasser i andre databaser står igjen.
2. `check-sync-secrets.sh` stopper med navnet (aldri verdien) når `POWERSYNC_JWT_SECRET` eller `ELECTRIC_SECRET` er under 32 tegn.
3. `deploy-azure.yml` har ingen avledede masker for synkrollene; passordmaskene og admin-masken står.
4. `applySyncTrialRoles` oppfører seg likt etter at `|| !passwords` er fjernet, og kaster fortsatt ved ugyldige passord.

## 1. Integrasjonstester mot testdatabasen: `scripts/azure/sync-trial-roles.test.ts`

| # | Testnavn | Hva den viser | CI |
|---|---|---|---|
| A1 | «bryteren av rører ikke fysiske plasser, selv med synknavn» | Fysiske plasser `powersync_testplan_1`, `electric_slot_testplan_1`, `annen_testplan_1` står igjen etter `apply({ enabled: false })`; `droppedSlots` er `[]`. Rollene og lagringsdatabasen står. Erstatter «bryteren av rydder ubrukte replikeringsplasser og ingenting annet». Feiler med dagens kode (regresjonstest). | Kjører alltid |
| A2 | «bryteren av sletter ubrukte logiske plasser i egen database» | Logiske plasser (`pgoutput`) `powersync_testplan_2` og `electric_slot_testplan_2` i testdatabasen slettes og står i `droppedSlots`; `annen_testplan_2` (logisk) står igjen. Andre kjøring gir `droppedSlots = []`. | `it.skipIf` med grunn når `wal_level` ikke er `logical` |
| A3 | «bryteren av rører ikke plasser i en annen database» | Midlertidig database `ezprop_slottest_other` med logisk plass `powersync_testplan_3` (laget via egen tilkobling til den databasen). Står igjen etter `apply`, og er ikke i `droppedSlots`. Bruk aldri `ezprop` eller `powersync_storage`. | Hoppes over som A2 |
| A4 | (valgfri) «bryteren av rører ikke aktive plasser» | En plass som holdes aktiv slettes ikke. Droppes hvis den blir ustabil; sies i testrapporten. | Hoppes over som A2 |

Krav til oppsett og opprydding:
- `afterAll` (og `finally` i hver test) sletter alle `*_testplan_*`-plasser, **logiske først**, og deretter `ezprop_slottest_other`. En logisk plass som blir liggende, holder på WAL og fyller disken: **alvorlig funn**.
- Grunnen til at A2–A4 hoppes over skal stå i testnavnet eller i `skipIf`-meldingen, så det synes i utskriften.
- Uendret og fortsatt grønne: «bryteren på uten passord stopper med navnet» (tomme og ugyldige passord kaster med navnet, beviser at `assertValidPassword` er beholdt), «bryteren av lager ingen roller og trenger ingen passord», «virker uten superbruker, slik som i Azure», «passord står ikke i loggen eller i feilmeldinger», og resten av filen.

## 2. Skripttest: `scripts/azure/check-sync-secrets.test.ts`

| # | Testnavn | Hva den viser |
|---|---|---|
| B1 | «POWERSYNC_JWT_SECRET under 32 tegn stopper» (i `describe.each` over de to navnene) | 31 tegn gir exit 1; utskriften har navnet, ikke verdien. Andre secrets gyldige. |
| B2 | Samme for `ELECTRIC_SECRET` | Som B1. |
| B3 | «JWT- og Electric-hemmelighet med nøyaktig 32 tegn gir exit 0» | Grensen er ≥ 32, ikke > 32. |
| B4 | «32 tegn med spesialtegn gir exit 0» | Verdi med `-` og `/` godtas (ikke krav til tegnsett). |

Uendret og fortsatt grønne: «aldri verdiene i utskriften», «virker med bash 3.2», «bryter av gir ok uten secrets», «alle satt gir exit 0» (testdata må oppfylle 32 tegn). Alle verdier er oppdiktet.

## 3. Arbeidsflyttest: `tests/deploy-workflow.test.ts`

«passord og tilkoblingsstrenger for synk maskeres før bruk» skrives om til «passordene for synk maskeres før bruk, uten avledede adresser»:

| # | Hva den viser |
|---|---|
| C1 | Ingen `::add-mask::`-linje (utenom kommentarer) inneholder `powersync_repl:` eller `electric_repl:`. |
| C2 | Maskene for `$POWERSYNC_DB_PASSWORD` og `$ELECTRIC_DB_PASSWORD` står før `sync-trial-roles.ts`. |
| C3 | «DATABASE_URL maskeres før bruk» er uendret og grønn. |

«ingen set -x og ingen echo av hemmeligheter» skal fortsatt være grønn.

## 4. Tilgang per rolle

Ingen endring. Ingen ny rettighet, side eller handling i appen. `guards.test.ts` er uendret. Admin berøres ikke, så regel 11 holdes.

## 5. Tenant-isolasjon

Ingen ny spørring tar `organizationId`, så ingen nytt kall til `expectTenantIsolation`. Spørringene i rolleskriptet går mot systemkatalogen (`pg_replication_slots`), ikke mot organisasjonsdata. Avvises hvis PR-en likevel legger til en spørring med `organizationId` uten test.

## 6. Regeltester

Ingen fagregler eller TG-logikk endres. Ingen nye testsaker.

## 7. E2E (PC og iPad-størrelse, uten nett)

Ingen nye e2e-tester: ingen skjermer endres. `pnpm test:e2e` kjøres i sin helhet (PC og iPad, med prøven uten nett) og skal være grønn som før.

## 8. Myk sletting

Ingen data i appen slettes. Replikeringsplasser er driftsobjekter, ikke kundedata; regel 3 gjelder ikke. Rollene og `powersync_storage` står igjen når bryteren er av (sjekkes i A1).

## 9. Kjøring og godkjenning

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` er grønne. Typecheck beviser at `|| !passwords` er borte uten `!`-påstand eller ny sjekk.
- `package.json` har 0.2.9.
- Testrapporten oppgir hvilke av A2–A4 som ble hoppet over lokalt og i CI på grunn av `wal_level`, og om A2–A3 er kjørt minst én gang med `wal_level=logical` (lokalt mot PowerSync/Electric-oppsettet).
- Dokumentene (punkt 4 i oppgavekortet, og 32 tegn i `docs/drift/testmiljo-azure.md`) sjekkes ved gjennomgang.
- Avvises hvis: A1 mangler, logiske testplasser blir liggende, en test bruker `ezprop` eller `powersync_storage` som «annen database», eller «bryteren på uten passord stopper med navnet» er fjernet eller svekket.
