# Funksjon: Malmotoren (malfamilie, malversjon, seksjon, felt, kontrollpunkt, avviksspørsmål, utfall, standardtiltak og regler)

- **Fase:** 2a – Rapporten på PC (første punkt under «Malen og reglene»)
- **Modul:** kjerne (`src/core/templates`, tabellene i `src/db/schema/templates.ts`)
- **Branch:** `fase2a-malmotor` (bygger på `main`)
- **Status:** klar til bygging (06.11.2026, prosjektleder)
- **Dato:** 06.11.2026
- **Støtter hovedmål:** KI først og reklamasjoner (hovedsaken): kontrollpunkter, utfall og regler blir data med faste koder. Da kan regelmotoren foreslå TG og tekster, KI kan senere koble fraser, reklamasjoner og statistikk til samme punkt over mange år, og alle rapporter bygger på samme godkjente mal. Det gir færre glemte punkter og færre reklamasjoner. Tid: dette er grunnmuren for regneark-importen, «Prøv malen» og rapportskjermen, som er der tiden spares.

## Problem
Alle de neste punktene i fase 2a (regneark inn og ut, kontroll av malen, «Prøv malen», regelmotoren, systemmalen og selve rapporten) trenger et sted å lagre malen. I dag finnes ingen maltabeller. Uten en fast struktur med faste koder vil fraser, regler og reklamasjoner miste koblingen når malen endres, og hvem som helst kunne endre systemmalen.

## KI først
Ikke KI i denne oppgaven. Den lager datagrunnlaget KI trenger: hvert kontrollpunkt, felt, utfall og hver regel får en fast kode (`key`) som aldri endres. Det gjør at KI senere kan foreslå utfall, avvikstekster og tiltak per punkt, lære av reklamasjoner på samme punkt, og at regelmotoren (eget punkt) kan gi TG-forslag som takstmannen bare godkjenner.

## Brukerhistorier
- Som **fagansvarlig (maltilgang)** vil jeg **lage en ny utkastversjon av systemmalen fra den publiserte og lagre innholdet** slik at **endringer alltid blir en ny versjon og gamle rapporter står urørt**.
- Som **takstmann uten maltilgang** vil jeg **lese malen** (til rapporten), men skal **ikke kunne endre den**.
- Som **admin** har jeg alltid maltilgang (admin stenges aldri ute).

## Omfang
**Med:**
1. **Tolv tabeller** i én migrering (`0024_malmotor`), etter `docs/05-domenemodell.md` 4.5: `template_families`, `template_versions`, `template_sections`, `template_elements`, `template_element_options`, `checkpoints`, `deviation_questions`, `outcomes`, `standard_measures`, `rules`, `rule_conditions`, `rule_test_cases`. Alle har `organization_id`, `created_at`, `updated_at`, `deleted_at`. Undertabellene bruker sammensatte fremmednøkler med `organization_id` (som A84–A92), slik at en rad aldri kan peke inn i en annen organisasjon.
2. **Faste koder:** `key` er påkrevd, har fast format (små bokstaver, tall, `_` og `.`, for eksempel `wet_room.membrane`) og er unik per malversjon innenfor sin tabell (delvis unik indeks `WHERE deleted_at IS NULL`). Valg er unike per felt, avviksspørsmål per kontrollpunkt, utfall per spørsmål. Se A136–A137 for hvordan koden arkiveres.
3. **Tjenester i `src/core/templates`** (alle filtrerer på `grant.organizationId`, Zod-skjema i `schemas.ts`):
   - Lese (`organization.read`, alle ansatte): `listTemplateFamilies`, `getTemplateVersion(versionId)` som gir hele treet (seksjoner, felt, valg, kontrollpunkter, spørsmål, utfall, tiltak, regler med betingelser og testtilfeller), sortert etter `sort_order`.
   - Endre (`template.edit_structure` for systemmaler): `createTemplateFamily` (bare `kind = system` nå, A139), `createDraftVersion(familyId)` som kopierer hele treet fra siste publiserte versjon med samme koder og setter `based_on_version_id`, `saveDraftContent(versionId, document)` og `publishVersion(versionId, changeNote)`.
   - `saveDraftContent` tar hele innholdet som ett dokument der alt peker på hverandre med **koder, ikke id-er** (det samme formatet regneark-importen skal bruke). Rader med samme kode oppdateres, nye legges til, rader som ikke er med lenger fjernes med myk sletting. En kode som ikke finnes i dokumentet (for eksempel et regelmål eller `suggested_outcome`), gir feilmelding.
   - `publishVersion`: utkast blir publisert, `published_by`/`published_at` settes, og forrige publiserte versjon i familien blir `retired`. Bare én utkastversjon per familie om gangen.
   - **Publiserte og utgåtte versjoner endres aldri:** alle endringstjenester avviser dem.
4. **Låsing av systemmalen** i `src/core/access`: ny hjelper (for eksempel `requireTemplateEditAccess`) som krever `template.edit_structure` når familien er `system`. Rettigheten finnes allerede (admin har den alltid, den kan gis som enkeltrettighet). Ingen tilgangslogikk i tjenestene utenom kallet dit.
5. **TG-logikk bare i systemmalen:** valideringen avviser kontrollpunkter og reglene `suggest_outcome` og `suggest_tgiu` i en familie med `kind = custom` (finnes ikke ennå, men regelen står i koden med test, beslutning 27.10.2026). Utfall kan aldri være `tgiu` (innspill D1).
6. **Revisjonsloggen** får hvem, når, malversjon og handling (opprettet, innhold lagret med antall rader lagt til, endret og fjernet, publisert). **Hendelse:** `template.version_published` med `familyId`, `versionId` og `versionNumber`.
7. `tests/tenant-tables.ts` får alle tolv tabellene. Domenemodellen 4.5 og ordlisten oppdateres med det som faktisk bygges. `package.json` får ny minor-versjon (større leveranse).

**Ikke med (bevisst utelatt):**
- Maleditor og skjermer for malen (fase 5). Ingen nye sider i denne oppgaven.
- Regneark inn og ut (eget punkt, bygger på `saveDraftContent`).
- Automatisk kontroll av malen før publisering (eget punkt): obligatoriske punkter, TG3 med kostnad, kjøring av testtilfeller. Her sjekkes bare at kodene i dokumentet henger sammen.
- Regelmotoren som kjører reglene (eget punkt). Regler, betingelser og testtilfeller lagres bare.
- Levetider, terskler og kostnadsintervaller (eget punkt). Kolonnene `lifespan_table_id`, `threshold_table_id` og `cost_band_set_id` på `template_versions` kommer med dem.
- Selve systemmalen for bolig og leilighet, avvikstekster og «Handling»-frasene (egne punkter). Ingen fagtekster i denne oppgaven; testdataene er oppdiktede og nøytrale.
- Rapporten låst til malversjonen (eget punkt, når `reports` finnes).
- Egne maler (`kind = custom`) og godkjenning av en annen person (`approved_by`).
- KI.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (`organization.read`) | nei, med mindre admin har gitt `template.edit_structure` |
| kontor | ja | nei |
| leder | ja | nei, med mindre admin har gitt `template.edit_structure` |
| admin | ja | ja (alltid) |

Innstillingen `access.inspectors_edit_all` gir aldri maltilgang. En mal i en annen organisasjon gir «finnes ikke».

## Data
Tabellene og feltene står i `docs/05-domenemodell.md` 4.5. Avvik fra den, ført som beslutninger:
- `template_versions` uten kolonnene for levetider, terskler og kostnadsintervaller (kommer med det punktet).
- `deviation_text`, `default_consequence_text` og tiltakene lagres uten egen godkjenningsstatus nå. Merket «utkast, ikke godkjent av fagrådet» legges på når systemmalen med fagtekster lages (eget punkt).
- Nye faste koder i koden: `template.version_published` (hendelse). Ingen nye rettigheter.

## Skjermer
Ingen i denne oppgaven.

## Regler
Ingen regler kjøres. Strukturregler som testes: kode-format, unike koder, koder som peker på noe som finnes, ingen TG-logikk i egne maler, ingen `tgiu` som utfall, arkivert kode tas ikke i bruk igjen.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A136 – En kode er arkivert når den fantes i en tidligere versjon av familien, men ikke i den siste publiserte.** `saveDraftContent` avviser at en arkivert kode tas i bruk igjen, og at en kode brukt på én slags ting (for eksempel kontrollpunkt) brukes på en annen. Kilde: regel 6 i `CLAUDE.md`, domenemodellen 4 (felles regler, innspill `funksjonalitet-ki` avsnitt 8). Enklest uten eget kode-register. Endres ved å lage en egen tabell for arkiverte koder.
- **A137 – Innhold i en versjon peker på hverandre med koder i dokumentet, og koden kan ikke endres på en rad.** Å «gi nytt navn» til en kode er å fjerne den gamle og legge til en ny. Kilde: regel 6, P19 (regneark med faste ID-er). Endres ikke uten ny beslutning om regel 6.
- **A138 – Ny versjon lages ved å kopiere hele den publiserte versjonen.** Publiserte versjoner endres aldri (4.5, beslutning 24.–25.10). Enkelt og trygt; rapporter som er låst til en versjon, påvirkes aldri.
- **A139 – Bare systemmaler kan lages nå.** Egne maler kommer med malbyggeren i fase 5. Endres ved å tillate `custom` i `createTemplateFamily`.
- **A140 – Publisering i denne oppgaven har ingen fagkontroll ennå.** Kontrollen før publisering er et eget punkt i planen og legges inn i `publishVersion` da. Før det publiseres ingen ekte mal (systemmalen er også et eget punkt).

## Oppdeling (kan bygges i parallell)
1. **Utvikler A:** skjema og migrering `0024_malmotor`, `tests/tenant-tables.ts`, domenemodell og ordliste.
2. **Utvikler B:** `src/core/templates` (lesing, utkast, lagre innhold, publisere) og tilgangshjelperen i `src/core/access`. Starter på skjemafilen når A har pushet den.
3. **Testskriver:** testplan `docs/funksjoner/fase2a-malmotor-testplan.md` og tester for tilgang (takstmann, kontor, leder uten og med enkeltrettighet, admin), tenant-isolasjon (`expectTenantIsolation` for hver spørring), publiserte versjoner som ikke kan endres, kodeformat, arkiverte koder og TG-logikk i egne maler.

## Akseptkriterier
- [ ] Migreringen lager de tolv tabellene med `organization_id`, myk sletting og sammensatte fremmednøkler.
- [ ] Takstmann, kontor og leder uten `template.edit_structure` kan lese malen, men får nei på alle endringstjenester (test). Med enkeltrettigheten får de lov (test). Admin får alltid lov (test).
- [ ] `createDraftVersion` kopierer hele treet med samme koder; `publishVersion` gjør forrige versjon utgått; publiserte og utgåtte versjoner kan ikke endres (test).
- [ ] `saveDraftContent` legger til, oppdaterer og fjerner etter kode, avviser ukjente koder, feil format, doble koder, arkiverte koder som tas i bruk igjen og kode brukt på ny slags ting (test).
- [ ] Egne maler kan ikke ha kontrollpunkter eller TG-regler, og utfall kan ikke være `tgiu` (test).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for hver spørring, og `tenant-isolation-all-tables` grønn).
- [ ] Revisjonslogg og hendelsen `template.version_published` lagres uten fagtekst i loggen.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.
- [ ] Virker på iPad-størrelse: ikke aktuelt (ingen skjermer).

## Åpne spørsmål
- Ingen som stopper oppgaven. Beslutningene A136–A140 kan endres av Ståle når han er tilbake.
