# Funksjon: Småfunn fra synktjenestene i Azure (etter PR #17)

- **Fase:** 1 – Prøve uten nett
- **Modul:** kjerne (drift: `scripts/azure`, `.github/workflows`, `docs/drift`)
- **Status:** godkjent (prosjektleder 29.10.2026), rettet etter test-leder runde 1
- **Branch:** `fase1-smafunn-synk-azure`, bygger på `main`
- **Støtter hovedmål:** Reklamasjoner: prøven uten nett må være til å stole på, og ingen lokale data eller replikeringsplasser skal forsvinne eller bli liggende uten at vi vet det. Tid: færre feil når Ståle slår på synktjenestene (spørsmål nr. 12), så prøve A og B kan kjøres uten stopp. KI først: indirekte, prøven er grunnlaget for befaring på iPad der KI-forslag senere vises og godkjennes.

## Problem
Gjennomgangen av PR #17 (synktjenestene i Azure) fant fem små ting som ikke stoppet merge, men som bør rettes før Ståle slår på tjenestene:

1. `dropUnusedSlots` i `scripts/azure/sync-trial-roles.ts` sletter ubrukte plasser som heter `powersync%` eller `electric_slot%` i **hele** PostgreSQL-serveren. Når `pnpm test` kjøres lokalt med Docker-containerne stoppet, slettes også plassene til `ezprop` (den lokale utviklingsdatabasen), og PowerSync og Electric må bygge alt på nytt neste gang.
2. `scripts/azure/check-sync-secrets.sh` sjekker lengden på de to DB-passordene, men ikke på `POWERSYNC_JWT_SECRET` og `ELECTRIC_SECRET`. En for kort hemmelighet slipper gjennom.
3. `.github/workflows/deploy-azure.yml` maskerer avledede adresser for synkrollene som ikke er like dem Bicep lager (`infra/azure/main.bicep`): PowerSync-maskene har `postgres://` og `?sslmode=…`, mens Bicep bruker `postgresql://` uten det. Maskene treffer da ikke det som faktisk kan havne i loggen. Siden passordene selv er maskert, er de avledede maskene uansett unødvendige.
4. `docs/drift/electricsql.md` sier at rollen «bare kan lese de tre trial-tabellene». Det er for bastant: REPLICATION-egenskapen gir mulighet til å lese hele databasen via replikeringsprotokollen, uavhengig av SELECT-rettighetene.
5. `applySyncTrialRoles` har to sjekker som aldri kan slå til.

## KI først
Nei. Dette er drift og rydding i skript. Det finnes ingenting takstmannen skal kontrollere eller godkjenne her.

## Brukerhistorier
- Som **utvikler** vil jeg at `pnpm test` bare rydder i testdatabasen, slik at den lokale synkprøven min ikke blir nullstilt.
- Som **Ståle** vil jeg at utrullingen stopper med en klar melding hvis en hemmelighet er for kort, slik at feilen ikke først vises når iPaden ikke får synket.

## Omfang
**Med:**
1. **Rydding bare i egen database.** `dropUnusedSlots` sletter bare plasser der `database = current_database()` (i tillegg til `not active` og navnemønstrene). Plasser i andre databaser, og fysiske plasser (som ikke hører til noen database), røres ikke. Kommentaren i toppen av filen og ved funksjonen oppdateres.
2. **Lengdekrav i `check-sync-secrets.sh`:** `POWERSYNC_JWT_SECRET` og `ELECTRIC_SECRET` må ha minst 32 tegn. Ingen krav til tegnsett (de går ikke inn i databaseadresser). Meldingen nevner bare navnet, aldri verdien. Kommentaren øverst og `docs/drift/testmiljo-azure.md` (der hemmelighetene lages) oppdateres med kravet. Bash 3.2.
3. **Maskene i `deploy-azure.yml`:** fjern de tre avledede adresse-maskene for synkrollene (linjene med `powersync_repl:` og `electric_repl:` i steget «Databaseadresse for kjøreren (maskert)»). Selve passordene er allerede maskert, og GitHub maskerer da også passordet inne i en adresse. Masken for `DATABASE_URL` til admin beholdes. Kommentaren rettes.
4. **`docs/drift/electricsql.md`** og samme setning i `docs/drift/powersync.md` (linjen om `powersync_repl`): skriv at rollen har SELECT bare på de tre trial-tabellene, men at REPLICATION-egenskapen gir mulighet til å lese hele databasen via replikeringsprotokollen; at skriptets sjekk dekker SELECT-rettighetene, ikke dette; og at det er akseptert for testmiljøet med oppdiktede data. Legg en linje **«Funn til ADR-en»** i `docs/funksjoner/fase1-synk-i-azure.md`: i produksjon må dette vurderes (egen database for synkdata, eller en tjeneste som ikke trenger REPLICATION).
5. **Én overflødig sjekk i `applySyncTrialRoles`:** `|| !passwords` i grenen for bryteren av kan aldri slå til. Den fjernes uten å endre oppførselen. Beregningen av `passwords` flyttes til etter grenen for bryteren av (da er `input.enabled` sann, og `passwords` er aldri null), slik at typecheck er grønn uten sjekken. Valideringen med `assertValidPassword` inne i `applySyncTrialRoles` **beholdes** (avgjort av prosjektleder 29.10.2026, etter test-leder): testen «bryteren på uten passord stopper med navnet» kaller funksjonen direkte med tomme og ugyldige passord, og dokumentasjonen på `SyncTrialRolesInput` lover at feil passord kastes. Typen `string` sikrer ikke det. Begrunnelsen står i PR-en.
6. Versjon i `package.json`: 0.2.8 → 0.2.9.

**Ikke med (bevisst utelatt):**
- Ingen nye funksjoner, ingen nye avhengigheter.
- Ingen utrulling til Azure, og ingen endring i Bicep.
- Ingen endring i rollenes rettigheter (REPLICATION beholdes; det er en sak for ADR-en).
- Ingen endring i synkstatus (`fase1-synkstatus`) eller i kandidatene.
- Ingen nye spørsmål til Ståle.
- `_` som jokertegn i LIKE-mønsteret `electric_slot%` rettes ikke (ingen praktisk betydning). Notert her og kan vente.
- Lengden i `check-sync-secrets.sh` telles i byte (`LC_ALL=C`), så æøå teller dobbelt. Det er greit for et minstekrav og endres ikke.

## Tilgang
Ingen endring. Ingen ny spørring som tar `organizationId`, så ingen ny tenant-isolasjonstest.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | – | – |
| kontor | – | – |
| leder | – | – |
| admin | – | – |

## Data
Ingen endring i tabeller eller faste koder. Ingen migrering.

## Skjermer
Ingen.

## Regler
Ingen fagregler.

## Akseptkriterier
- [ ] `dropUnusedSlots` sletter bare ubrukte logiske plasser i `current_database()`. Fysiske plasser og plasser i andre databaser røres ikke.
- [ ] `check-sync-secrets.sh` gir exit 1 med navnet (aldri verdien) når `POWERSYNC_JWT_SECRET` eller `ELECTRIC_SECRET` er under 32 tegn, og exit 0 med 32 tegn, også med spesialtegn. Bash 3.2.
- [ ] `deploy-azure.yml` har ingen masker med `powersync_repl:` eller `electric_repl:`. Passordmaskene og admin-masken står.
- [ ] `docs/drift/electricsql.md` og `docs/drift/powersync.md` sier ikke lenger at rollen «bare kan lese» de tre tabellene, forklarer REPLICATION og sier at det er akseptert for testmiljøet. «Funn til ADR-en» står i `docs/funksjoner/fase1-synk-i-azure.md`. Kravet om 32 tegn står i `docs/drift/testmiljo-azure.md`.
- [ ] `|| !passwords` er fjernet uten å endre oppførselen, og typecheck er grønn. `assertValidPassword` i `applySyncTrialRoles` er beholdt, med begrunnelse i PR-en. Alle eksisterende tester for rolleskriptet er grønne, også «bryteren på uten passord stopper med navnet».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjon 0.2.9. Testrapporten sier hvilke tester som ble hoppet over i CI på grunn av `wal_level`.

## Testplan (fra test-leder, runde 1)
Ingen ny spørring tar `organizationId`: ingen test for tenant-isolasjon eller roller i appen, og ingen ny e2e. Admin berøres ikke.

**A. `scripts/azure/sync-trial-roles.test.ts`**
- A1. «bryteren av rører ikke fysiske plasser, selv med synknavn»: fysiske plasser `powersync_testplan_1`, `electric_slot_testplan_1` og `annen_testplan_1` står igjen, og `droppedSlots` er tom. Erstatter dagens test «bryteren av rydder ubrukte replikeringsplasser og ingenting annet». Kjører alltid, også i CI, og feiler med dagens kode (regresjonstest for funnet).
- A2. «bryteren av sletter ubrukte logiske plasser i egen database» (`pgoutput`). Hoppes over med tydelig grunn når `wal_level` ikke er `logical`.
- A3. «bryteren av rører ikke plasser i en annen database»: midlertidig database (f.eks. `ezprop_slottest_other`) med en logisk plass med synknavn; den står igjen. Bruk aldri `ezprop` eller `powersync_storage`. Hoppes over som A2.
- A4. (valgfri) «bryteren av rører ikke aktive plasser». Droppes hvis den blir ustabil.
- `afterAll` sletter alle logiske testplasser før den midlertidige databasen slettes. En logisk plass som blir liggende, holder på WAL og fyller disken; det regnes som alvorlig funn.

**B. Skripttesten for `check-sync-secrets.sh` (`scripts/azure/check-sync-secrets.test.ts`)**
- B1. `POWERSYNC_JWT_SECRET` med 31 tegn gir exit 1, navnet men ikke verdien i utskriften.
- B2. Det samme for `ELECTRIC_SECRET`.
- B3. Begge med nøyaktig 32 tegn gir exit 0.
- B4. 32 tegn med `-` og `/` gir exit 0 (ikke krav til tegnsett).
- Testene for bash 3.2 og «aldri verdiene i utskriften» er fortsatt grønne.

**C. `tests/deploy-workflow.test.ts`** (testen «passord og tilkoblingsstrenger for synk maskeres før bruk» skrives om)
- C1. Ingen `::add-mask::`-linje inneholder `powersync_repl:` eller `electric_repl:`.
- C2. Maskene for `POWERSYNC_DB_PASSWORD` og `ELECTRIC_DB_PASSWORD` står før `sync-trial-roles.ts`.
- C3. Masken for `$DATABASE_URL` står før `pnpm db:migrate` (finnes allerede).

**D. Dokumentene** sjekkes ved gjennomgang (se akseptkriteriene).

## Roller
- **utvikler:** punkt 1–6 (punkt 5: bare `|| !passwords` fjernes, `assertValidPassword` beholdes).
- **testskriver (i parallell):** testplanen A–C. Kontrakten er navnene i dette kortet; ingen nye eksporter. `applySyncTrialRoles` kaster fortsatt ved ugyldige passord.
- Ingen arkitekt, UX, UI, KI, fag eller sikkerhet-personvern: ingen nye valg, og punkt 4 er bare en mer presis beskrivelse av det sikkerhet-personvern allerede har godkjent for testmiljøet. Selve vurderingen tas i synk-ADR-en.

## Åpne spørsmål
- Ingen nye. Nr. 10, 11 og 12 gjelder fortsatt.
