# Testplan: Sammenligning av kandidatene og ADR 0004 for drift uten nett (foreløpig)

- **Oppgavekort:** `docs/funksjoner/fase1-sammenligning-adr.md`
- **Fase:** 1 – Prøve uten nett
- **Branch:** `fase1-sammenligning-adr` (bygger på `main`)
- **Dato:** 30.10.2026
- **Laget av:** test-leder, før arbeidet starter. Navnene (S1, K1 osv.) er kontrakten for arkitekten og for test-lederens sluttgjennomgang.
- **Støtter hovedmål:** Tid (ett valg, så fase 0b og 2b bygges én gang), reklamasjoner (valget bygger bare på det som er vist i tester, og det som ikke virket står åpent) og KI først (ADR-en sier at KI-forslag ligger i egne felt og aldri overskriver takstmannens verdi).

Oppgaven er bare dokumentasjon. Det lages **ingen nye automatiske tester** (testskriver er ikke med). Testplanen er derfor to deler: (1) sjekker av dokumentene som test-leder går gjennom punkt for punkt, og (2) eksisterende tester som må være grønne uten endring, fordi ADR-en viser til dem som bevis.

## 0. Funn i oppgavekortet (for prosjektleder, før arbeidet starter)

1. **ElectricSQL har ingen klientpakke.** `package.json` har bare `@powersync/web` 2.5.0 og `@powersync/react` 2.1.0. ElectricSQL-klienten er egen kode i `sync/electricsql/` (fetch mot shape-ruten). Sammenligningen må si det, og versjonen for ElectricSQL kan bare hentes fra `docker-compose.yml` (`electricsql/electric:1.8.1`). Lite.
2. **`@electric-sql/pglite` står i `pnpm-lock.yaml`, men bare som valgfri peer-avhengighet til en annen pakke.** Den er ikke i bruk. Sammenligningen skal ikke oppgi den som avhengighet for ElectricSQL. Lite, men lett å ta feil av.
3. **Lisens for tjenestene står ikke i repoet.** `node_modules/@powersync/web` og `@powersync/react` sier `Apache-2.0`. For `powersync-service` og `electric` (bildene i `docker-compose.yml`) finnes ingen lisens i repoet med mindre `docs/drift/*.md` eller ADR 0003 sier det. Da skal det stå «ikke sjekket» (kortets regel). Lite.
4. **Versjonsnummer kolliderer med parallell branch.** `main` er 0.2.26. `fase1-smafunn-prove-d-f` har allerede 0.2.27 og A11–A12. Denne branchen bruker neste ledige patch på `main` rett før PR (0.2.27 hvis d-f ikke er merget, ellers 0.2.28) og A13/A14 (eller de neste ledige). Sjekkes på nytt rett før PR (K9, K10). Lite.
5. **Testtallene gjelder branchen, ikke `main`.** Kortet sier «ut fra de automatiske testene på `main`» og «kjør på branchen». Siden ingen kode endres, er det det samme, men rapporten skal oppgi commit-hash i tillegg til dato og kommando. Lite.

Ingen funn stopper oppgaven.

## 1. Hva som finnes fra før (og brukes)

- Vitest: `src/modules/offline-trial/sync/**/*.test.ts`, `src/modules/offline-trial/server/*.test.ts`, `src/modules/offline-trial/rules/*.test.ts`, `tests/powersync/*.test.ts`, `tests/electricsql/*.test.ts`, `tests/tenant-isolation.test.ts`.
- e2e (prosjektene `pc` og `ipad` 1194×834 med berøring, `playwright.config.ts`): `fase-1-powersync.spec.ts`, `fase-1-electricsql.spec.ts`, `fase-1-egenbygd.spec.ts`, `fase-1-prove-c-lagring.spec.ts`, `fase-1-prove-d-bilder.spec.ts`, `fase-1-prove-e-regler.spec.ts`, `fase-1-prove-f-innlogging.spec.ts`, `fase-1-synkstatus.spec.ts`, `fase-1-testskjema.spec.ts`.
- Resultatmaler for ekte iPad: `fase1-prove-ab-{powersync,electricsql,egenbygd}.md`, `fase1-prove-{c,d,e,f}-*-resultat.md`.
- `tests/factories.ts`, `e2e/helpers.ts`: brukes ikke (ingen ny spørring, ingen ny skjerm).

## 2. Tilgang, tenant-isolasjon, admin og myk sletting

| Krav | Hvordan det vises |
|---|---|
| Tilgang per rolle uendret | `git diff main --stat -- src/core/access docs/02-roller-og-tilgang.md` er tom. Eksisterende tilgangstester grønne. |
| Tenant-isolasjon | Ingen ny spørring. Disse må være grønne **uten endring**, fordi ADR-en bygger på dem: `apply-changes.test.ts`, `changes-since.test.ts`, `trial-queries.test.ts`, `electric-shape.test.ts`, `photo-storage.test.ts` (alle med `expectTenantIsolation`), `tests/powersync/config.test.ts` og `tests/electricsql/config.test.ts` (synkreglene filtrerer på `organization_id` og `deleted_at`). |
| Admin stenges aldri ute | Ingen ny tilgangsregel. ADR-en skal ikke innføre noe som begrenser admin (K7). |
| Myk sletting | ADR-en sier at DELETE gir `InvalidTrialChangeError` og at sletting er endring av `deleted_at` (K6), med `apply-changes.test.ts` som bevis. |

**Krav til ADR-en om tenant-isolasjon (sjekkes i K6):** `organization_id` settes alltid fra grant, aldri fra nyttelasten, og hver ny spørring i fase 0b og 2b får `expectTenantIsolation`.

## 3. Sjekker av sammenligningen (`docs/funksjoner/fase1-sammenligning.md`)

| Navn | Hva den viser | Alvor hvis den feiler |
|---|---|---|
| S1 Fem punkter per kandidat | Tabellen har prøvene, arbeid, EU/EØS, pris og modenhet for PowerSync, ElectricSQL og egenbygd. Ingen tom celle; det som ikke er målt står «ikke målt». | Alvorlig |
| S2 Testtall med dato, kommando og commit | `pnpm test` og `pnpm test:e2e` er kjørt på branchen, med antall bestått/feilet/hoppet over, dato og commit. Tallene stemmer med test-lederens egen kjøring (avsnitt 6) innen samme commit. | Alvorlig |
| S3 Prøve C–F per kandidat | For hver prøve og kandidat: hvilken spec-fil eller testfil viser det, og om e2e er kjørt i både `pc` og `ipad`. Skiller «virker i automatiske tester» fra «ikke prøvd på ekte iPad». | Alvorlig |
| S4 Prøve A og B | Står «ikke kjørt» for alle tre, med lenke til resultatmalen per kandidat. Ingen påstand om at A eller B virker. | Alvorlig |
| S5 Linjetelling i tre deler | Egen kode (`custom/`, `electricsql/`, `powersync/`), felles kode (`local/` for egenbygd og ElectricSQL; filene rett i `sync/` for alle) og testfiler for seg. Kommando og dato står. Test-leder kjører kommandoen på nytt og får samme tall. Arkitektens gamle tall står bare som sammenligning. | Lite (alvorlig hvis tester og kode er blandet) |
| S6 Avhengigheter og tjenester | PowerSync: `@powersync/web`, `@powersync/react` og egen tjeneste. ElectricSQL: ingen klientpakke, egen tjeneste. Egenbygd: ingen ny pakke, ingen ny tjeneste. `@electric-sql/pglite` står ikke som avhengighet (funn 2). | Lite |
| S7 EU/EØS | Hvor data går, selvdrevet i Azure Sweden Central, behov for databehandleravtale. Kilde: ADR 0003, `docs/drift/powersync.md`, `docs/drift/electricsql.md`. | Alvorlig hvis noe sier at data går ut av EU/EØS uten at det er avklart |
| S8 Pris | Ca. 700–850 kr per måned for begge synktjenestene samlet (ADR 0003); egenbygd ingen ekstra tjeneste. Skytjenestene bare som «ikke valgt». Ingenting slått på. | Lite |
| S9 Modenhet med kilde | Versjon fra `docker-compose.yml` (1.27.2 og 1.8.1) og `package.json`/`node_modules` (2.5.0, 2.1.0, Apache-2.0). Alt annet «ikke sjekket». Ingen påstand om stabilitet eller lisens uten fil. | Alvorlig hvis påstand uten kilde |
| S10 Det som ikke virket | Minst: Electrics 400-kropp sendes uendret (PR #10, funn 1), bildekøen som kunne stå fast (PR #14), småfunnene fra prøve D (liten oppgave h). | Alvorlig |

## 4. Sjekker av ADR 0004 (`docs/adr/0004-drift-uten-nett.md`)

| Navn | Hva den viser | Alvor |
|---|---|---|
| K1 Status øverst | Ordrett «Status: foreløpig, bekreftes etter prøve A og B på ekte iPad.» | Alvorlig |
| K2 Valg og begrunnelse | Én valgt løsning, knyttet til de tre hovedmålene og «det enkleste som virker», med henvisning til S-tabellen. | Alvorlig |
| K3 Det som ikke virket / ikke prøvd | Per kandidat. Samme tre punkter som S10. `sync_conflicts` står som «ikke prøvd». | Alvorlig |
| K4 Krav til prøve A og B | Målbare krav: null tapte svar og bilder etter 30 min i flymodus, 200 bilder, lukking og omstart, tekst flettes, «siste endring vinner» med varsel for TG, valg og tall. Sier hva som skjer hvis kravene ikke holder, og hvilken kandidat er reserve. | Alvorlig |
| K5 Reserve bak samme kontrakt | `TrialSyncStore` (`sync/types.ts`) er grensen; `candidate-boundaries.test.ts` er beviset; kontrakten beholdes i fase 2b. | Alvorlig |
| K6 Felles kolonner | `id` UUID v7 fra iPaden; `organization_id` fra grant, aldri nyttelasten; `row_version` eies av serveren og øker bare ved endring; DELETE gir `InvalidTrialChangeError`. Hver påstand viser til `apply-changes.test.ts` eller tilsvarende. | Alvorlig (tenant og myk sletting) |
| K7 Ingen ny tilgangsregel | ADR-en endrer ikke rollematrisen og stenger ikke admin ute. | Alvorlig |
| K8 Konflikter, bilder, KI-forslag | Sier **hvor** fletting skjer (server i `applyTrialChanges` eller klient). Bilder: egen id, bare tillegg, fingeravtrykk (A9, A10), felles bildekø. KI-forslag i egne felt (`suggested_by_rule_id`, `suggestion_status`, `suggestion_override_reason`), aldri «siste endring vinner» over takstmannens verdi. | Alvorlig |
| K9 Plassering og opprydding | Synkmotoren skal til `src/core/sync` (eller `src/shared`), modulene melder inn egne tabeller, ingen import mellom moduler. Flytting og fjerning av de to andre kandidatene i egen PR etter Ståles godkjenning. | Lite |
| K10 Regelmotoren | Uavhengig av synkvalget, med henvisning til `rules/trial-rule-cases.ts` og testene i `rules/`. | Lite |
| K11 Krav til fase 2b | Indeksen `(organization_id, updated_at, id)` og at N+1 i `applyTrialChanges` ikke tas videre. Ingen migrering nå. | Lite |
| K12 Forkastede alternativer | De to andre kandidatene og skytjenestene, med grunn. | Alvorlig |

## 5. Sjekker av de andre filene

| Navn | Hva den viser | Alvor |
|---|---|---|
| D1 Spørsmål nr. 10 og 11 | Ført i «Avgjort av agentene mens Ståle var borte» med A-nummer som ikke kolliderer med `main` eller `fase1-smafunn-prove-d-f` (A11–A12 brukt der). Status «avgjort, se A13/A14» (eller de numrene som ble brukt). Beslutningen gjelder bare selvdrevet i Azure Sweden Central og at skytjenesten ikke velges. | Alvorlig hvis kollisjon |
| D2 Planen | Begge punktene i `docs/07-utviklingsplan.md` (linje 165–166) er krysset av med «foreløpig; Ståles godkjenning i demoen gjenstår». | Lite |
| D3 Tilstandsfilen | «les og godkjenn ADR 0004 i demoen» under «Trenger Ståle når han er tilbake». | Lite |
| D4 Versjon | Patch økt én gang over `main` rett før PR (funn 4). | Lite |
| D5 Ordlisten | Bare endret hvis ADR-en innfører nye ord. | Lite |
| D6 Bare dokumentasjon | `git diff main --stat` viser bare `docs/` og `package.json`. Ingenting i `src/`, `e2e/`, `infra/`, `scripts/`, `powersync/`, `docker-compose.yml` eller `pnpm-lock.yaml`. | Alvorlig |
| D7 Ingen forbudt tekst | Ingen modellnavn, kundeopplysninger, hemmeligheter eller tekst fra NS 3600, IVIT eller SmartTakst. Ingen gjetteord («antas», «trolig») i påstander om hva som virker. Sjekkes med grep i de endrede filene. | Alvorlig |
| D8 Hver påstand har kilde | Hver «virker» viser til en test, en PR eller en fil. Stikkprøve: test-leder åpner minst fem henvisninger og ser at filen eller testen finnes med det navnet. | Alvorlig |

## 6. Kjøring (test-leder til slutt)

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` grønne. Antall Vitest som før (ingen ny test, ingen fjernet).
2. `pnpm test:e2e` grønn i både `pc` og `ipad` (`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` i skyen). Tallene sammenlignes med S2.
3. Disse må være grønne uten endring, fordi ADR-en bruker dem som bevis: `candidate-boundaries.test.ts`, `apply-changes.test.ts`, `changes-since.test.ts`, `photo-uploader.test.ts`, `photo-upload.test.ts`, `trial-rule-cases.test.ts`, `evaluate-trial-rules.test.ts`, `tests/tenant-isolation.test.ts`.
4. Linjetellingen (S5) kjøres på nytt med kommandoen fra sammenligningen.
5. `git diff main --stat` (D6), grep etter modellnavn og gjetteord (D7), stikkprøver (D8).

Uten nett og iPad-størrelse: ingen ny skjerm, så ingen ny e2e. Eksisterende e2e for uten nett i `ipad`-prosjektet (prøve C, D, F og de tre kandidatene) må være grønne, siden sammenligningen bygger på dem.

## 7. Godkjenning

Test-leder **avviser** hvis en sjekk merket «Alvorlig» feiler, særlig K1, K6, S9, S10, D1 eller D6. Funn merket «Lite» står i PR-en og kan tas i en liten oppgave.
