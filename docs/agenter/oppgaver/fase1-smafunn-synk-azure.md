# Funksjon: Småfunn fra synktjenestene i Azure (etter PR #17)

- **Fase:** 1 – Prøve uten nett
- **Modul:** kjerne (drift: `scripts/azure`, `.github/workflows`, `docs/drift`)
- **Status:** godkjent (prosjektleder 29.10.2026)
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
5. **To overflødige sjekker i `applySyncTrialRoles`:** (a) passordene valideres på nytt med `assertValidPassword`, selv om typen og `readSyncTrialRolesInput` allerede sikrer dem; (b) `|| !passwords` i grenen for bryteren av kan aldri slå til. Fjern dem uten å endre oppførselen. Hvis typen `SyncTrialRolesInput` gjør at valideringen faktisk trengs (input som ikke kommer fra `readSyncTrialRolesInput`), beholdes (a), og det står i PR-en hvorfor.
6. Versjon i `package.json`: 0.2.8 → 0.2.9.

**Ikke med (bevisst utelatt):**
- Ingen nye funksjoner, ingen nye avhengigheter.
- Ingen utrulling til Azure, og ingen endring i Bicep.
- Ingen endring i rollenes rettigheter (REPLICATION beholdes; det er en sak for ADR-en).
- Ingen endring i synkstatus (`fase1-synkstatus`) eller i kandidatene.
- Ingen nye spørsmål til Ståle.

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
- [ ] `dropUnusedSlots` sletter bare ubrukte plasser i `current_database()`. Test i `scripts/azure/sync-trial-roles.test.ts`: en plass med riktig navn i en annen database (eller en fysisk plass) blir liggende. Logiske plasser krever `wal_level=logical`; CI-databasen har ikke det, så testene som trenger logiske plasser hoppes over med tydelig grunn når `wal_level` ikke er `logical`, mens testen med fysisk plass kjører alltid. Den eksisterende testen som i dag sletter fysiske plasser, skrives om tilsvarende.
- [ ] `check-sync-secrets.sh` gir exit 1 med navnet (aldri verdien) når `POWERSYNC_JWT_SECRET` eller `ELECTRIC_SECRET` er under 32 tegn, og exit 0 med 32 tegn. Skripttesten utvides.
- [ ] `deploy-azure.yml` har ingen masker med `powersync_repl:` eller `electric_repl:`. Passordmaskene og admin-masken står. `tests/deploy-workflow.test.ts` sjekker dette.
- [ ] `docs/drift/electricsql.md` og `docs/drift/powersync.md` sier ikke lenger at rollen «bare kan lese» de tre tabellene, og forklarer REPLICATION. «Funn til ADR-en» står i `docs/funksjoner/fase1-synk-i-azure.md`.
- [ ] De to sjekkene er fjernet (eller begrunnet beholdt), og alle eksisterende tester for rolleskriptet er grønne.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjon 0.2.9.

## Roller
- **utvikler:** punkt 1–6.
- **testskriver (i parallell):** testene i akseptkriteriene (`sync-trial-roles.test.ts`, skripttesten for `check-sync-secrets.sh`, `tests/deploy-workflow.test.ts`). Kontrakten er navnene i dette kortet; ingen nye eksporter.
- Ingen arkitekt, UX, UI, KI, fag eller sikkerhet-personvern: ingen nye valg, og punkt 4 er bare en mer presis beskrivelse av det sikkerhet-personvern allerede har godkjent for testmiljøet. Selve vurderingen tas i synk-ADR-en.

## Åpne spørsmål
- Ingen nye. Nr. 10, 11 og 12 gjelder fortsatt.
