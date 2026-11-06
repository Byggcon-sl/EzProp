# Funksjon: Malmotoren (malfamilie, malversjon, seksjon, felt, kontrollpunkt, avviksspørsmål, utfall, standardtiltak og regler)

- **Fase:** 2a – Rapporten på PC (første punkt under «Malen og reglene»)
- **Modul:** kjerne (`src/core/templates`, tabellene i `src/db/schema/templates.ts`)
- **Branch:** `fase2a-malmotor` (bygger på `main`)
- **Status:** klar til bygging, oppdatert etter forhåndsvurdering runde 1 (forenkler og test-leder, 06.11.2026)
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
1. **Tolv tabeller** i én migrering (`0024_malmotor`), etter `docs/05-domenemodell.md` 4.5 med kolonnene som venter tatt ut (se «Data»): `template_families`, `template_versions`, `template_sections`, `template_elements`, `template_element_options`, `checkpoints`, `deviation_questions`, `outcomes`, `standard_measures`, `rules`, `rule_conditions`, `rule_test_cases`. Alle har `organization_id`, `created_at`, `updated_at`, `deleted_at`. Undertabellene bruker sammensatte fremmednøkler med `organization_id` (som A84–A92), slik at en rad aldri kan peke inn i en annen organisasjon.
2. **Faste koder:** `key` er påkrevd, har fast format (små bokstaver, tall, `_` og `.`, for eksempel `wet_room.membrane`) og er unik per malversjon innenfor sin tabell (delvis unik indeks `WHERE deleted_at IS NULL`). Valg er unike per felt, avviksspørsmål per kontrollpunkt, utfall per spørsmål. **Området en kode gjelder i** er tabellen, pluss forelderens kode for valg (felt), spørsmål (kontrollpunkt) og utfall (spørsmål). Samme kode kan brukes i to forskjellige tabeller (for eksempel en seksjon og et kontrollpunkt), og samme valgkode under to forskjellige felt. Se A136–A137 og A141.
   - `standard_measures`, `rule_conditions` og `rule_test_cases` har ingen kode. De **erstattes samlet per forelder** (A142): er listen under forelderen lik den lagrede (samme verdier i samme rekkefølge), skjer ingenting. Ellers slettes de gamle mykt og de nye legges inn.
3. **Tjenester i `src/core/templates`** (alle filtrerer på `grant.organizationId`, Zod-skjema i `schemas.ts`):
   - Lese (`organization.read`, alle ansatte): `listTemplateFamilies`, `getTemplateVersion(versionId)` som gir hele treet (seksjoner, felt, valg, kontrollpunkter, spørsmål, utfall, tiltak, regler med betingelser og testtilfeller), sortert etter `sort_order` på hvert nivå, uten rader som er slettet mykt.
   - Endre (`template.edit_structure` for systemmaler): `createTemplateFamily`, `createDraftVersion(familyId)`, `saveDraftContent(versionId, document)` og `publishVersion(versionId, changeNote)`.
   - `createTemplateFamily` (bare `kind = system` nå, A139) lager familien **og en tom utkastversjon 1** i samme transaksjon, og gir begge id-ene tilbake (A143).
   - `createDraftVersion(familyId)` kopierer hele treet fra siste publiserte versjon med samme koder og nye id-er, setter `based_on_version_id` og `version_number` = høyeste + 1. Kilden er urørt. Finnes det allerede et utkast i familien (også når familien aldri er publisert, fordi v1 da er utkastet), gir den `TemplateStateError` («Det finnes allerede et utkast av denne malen.»). Bare ett utkast per familie håndheves også i databasen (delvis unik indeks), så to samtidige kall gir ett utkast.
   - `saveDraftContent` tar hele innholdet som ett dokument der alt peker på hverandre med **koder, ikke id-er** (det samme formatet regneark-importen skal bruke). Rader med samme kode oppdateres, nye legges til, rader som ikke er med lenger fjernes med myk sletting. Alt skjer i én transaksjon: en feil gir ingen endring. Referanser som sjekkes mot dokumentet: forelder (seksjon, kontrollpunkt, felt, spørsmål, utfall), `suggested_outcome`, regelmålene, `related_checkpoint_keys`, og betingelsenes `element_key` og `checkpoint_key`. En kode som ikke finnes, gir feil.
   - **Tellingen i svaret og i loggen** (A144): *lagt til* = ny kode (eller ny rad i en erstattet liste), *endret* = rad med samme kode der minst ett lagret felt er ulikt, *fjernet* = myk sletting (også gamle rader i en erstattet liste). Det samme dokumentet lagret to ganger gir 0/0/0.
   - `publishVersion`: utkast blir publisert, `published_by`/`published_at` settes, og forrige publiserte versjon i familien blir `retired`, i én transaksjon. To samtidige publiseringer gir én vinner; den andre får `TemplateStateError`.
   - **Publiserte og utgåtte versjoner endres aldri:** alle endringstjenester avviser dem med `TemplateStateError` («Malversjonen er publisert og kan ikke endres.»).
   - **Feil** (`src/core/templates/errors.ts`, norske meldinger uten id-er og fagtekst):
     - `AccessDeniedError` (fra `src/core/access`): mangler rettigheten.
     - `TemplateNotFoundError` («Fant ikke malen.»): familien eller versjonen finnes ikke, er slettet mykt eller hører til en annen organisasjon.
     - `TemplateStateError`: versjonen er ikke et utkast, eller det finnes allerede et utkast.
     - `TemplateValidationError`: dokumentet er ugyldig. Har `issues: { path, rule, message }[]`, der `rule` er en fast kode testene sjekker: `key_format`, `key_duplicate`, `key_unknown`, `key_archived`, `tg_logic_in_custom`, `outcome_tgiu`, og Zod-feil som `schema`. `message` er norsk.
4. **Låsing av systemmalen** i `src/core/access`: ny hjelper (for eksempel `requireTemplateEditAccess`) som krever `template.edit_structure` når familien er `system`. Rettigheten finnes allerede (admin har den alltid, den kan gis som enkeltrettighet). Ingen tilgangslogikk i tjenestene utenom kallet dit.
5. **TG-logikk bare i systemmalen:** én ren funksjon (for eksempel `checkNoTgLogicInCustom(kind, document)`) avviser kontrollpunkter og reglene `suggest_outcome` og `suggest_tgiu` når `kind = custom`, og godtar `show` og `validate`. Den kalles fra `saveDraftContent` og har én enhetstest (beslutning 27.10.2026). Utfall kan aldri være `tgiu` (innspill D1): avvises både i Zod og med CHECK i databasen.
6. **Revisjonsloggen** får hvem, når, malversjon og handling (opprettet, innhold lagret med antall rader lagt til, endret og fjernet, publisert). Ingen titler, ledetekster eller fagtekster i loggen. Ingen ny hendelse (A145).
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
- Dyp kontroll av `table_columns` og `phrase_slot`: her sjekkes bare at `table_columns` er gyldig JSON (liste) og at `phrase_slot` er et kjent ord. Det fulle oppsettet bestemmes når tabellfelt og fraser brukes i rapporten.
- Hendelsen `template.version_published` (A145).
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
- `template_versions` uten `lifespan_table_id`, `threshold_table_id` og `cost_band_set_id` (kommer med levetider, terskler og kostnadsintervaller).
- `template_families` uten `company_id`, `archived_at` og `owner_employee_id` (A146; kommer med egne maler i fase 5 eller når en tjeneste trenger dem). Revisjonsloggen viser hvem som laget og publiserte.
- `rule_conditions` har bare `rule_id`, `group_no`, `type`, `element_key`, `checkpoint_key`, `operator` og `value`. `threshold_key`, `age_year_element_key`, `age_source_element_key`, `documentation_element_key` og `material_element_key` kommer med regelmotoren og levetider/terskler (A147).
- `rule_test_cases` uten `last_result` og `last_run_at` (kommer med kontrollen før publisering, som kjører testene, A147).
- `deviation_text`, `default_consequence_text` og tiltakene lagres uten egen godkjenningsstatus nå. Merket «utkast, ikke godkjent av fagrådet» legges på når systemmalen med fagtekster lages (eget punkt).
- Ingen nye faste koder for hendelser, og ingen nye rettigheter. Domenemodellen 4.5 merkes med kolonnene som kommer senere.

## Skjermer
Ingen i denne oppgaven.

## Regler
Ingen regler kjøres. Strukturregler som testes: kodeformat, unike koder i sitt område, koder som peker på noe som finnes, ingen TG-logikk i egne maler, ingen `tgiu` som utfall, arkivert kode tas ikke i bruk igjen.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A136 – En kode er arkivert når den fantes i en tidligere versjon av familien, men ikke i den siste publiserte.** `saveDraftContent` avviser at en arkivert kode tas i bruk igjen. En kode som er fjernet og lagt til igjen i samme utkast, men som finnes i siste publiserte versjon, er ikke arkivert og godtas. (Sjekken av «kode brukt på ny slags ting» er tatt ut, se A141.) Kilde: regel 6 i `CLAUDE.md`, domenemodellen 4 (felles regler, innspill `funksjonalitet-ki` avsnitt 8). Enklest uten eget kode-register. Endres ved å lage en egen tabell for arkiverte koder.
- **A137 – Innhold i en versjon peker på hverandre med koder i dokumentet, og koden kan ikke endres på en rad.** Å «gi nytt navn» til en kode er å fjerne den gamle og legge til en ny. Kilde: regel 6, P19 (regneark med faste ID-er). Endres ikke uten ny beslutning om regel 6.
- **A138 – Ny versjon lages ved å kopiere hele den publiserte versjonen.** Publiserte versjoner endres aldri (4.5, beslutning 24.–25.10). Enkelt og trygt; rapporter som er låst til en versjon, påvirkes aldri.
- **A139 – Bare systemmaler kan lages nå.** Egne maler kommer med malbyggeren i fase 5. Endres ved å tillate `custom` i `createTemplateFamily`.
- **A140 – Publisering i denne oppgaven har ingen fagkontroll ennå.** Kontrollen før publisering er et eget punkt i planen og legges inn i `publishVersion` da. Før det publiseres ingen ekte mal (systemmalen er også et eget punkt).
- **A141 – En kode identifiseres med tabellen, og forelderens kode for valg, spørsmål og utfall.** Ingen egen sjekk av «kode brukt på ny slags ting»: kodene er unike per tabell, og betingelsene sier selv hva de leser (`element_key` eller `checkpoint_key`), så forveksling kan ikke skje. Regel 6 er dekket av A136. Kilde: forenkler og test-leder 06.11.2026. Endres ved å innføre ett felles koderegister.
- **A142 – Rader uten kode (standardtiltak, betingelser, testtilfeller) erstattes samlet per forelder** når listen er endret. Ingen kode betyr ingen fast identitet å ta vare på. Endres ved å gi dem `key`.
- **A143 – En ny malfamilie får en tom utkastversjon 1 med en gang.** Da finnes alltid et sted å lagre innhold, og `createDraftVersion` brukes bare etter første publisering.
- **A144 – «Endret» betyr minst ett lagret felt ulikt.** Gir eksakte tall i loggen og 0/0/0 når ingenting er endret.
- **A145 – Ingen hendelse ved publisering ennå.** Ingen leser den, og revisjonsloggen viser publiseringen. Legges inn når «Rapporten låses til malversjonen» eller statistikken trenger den.
- **A146 – `company_id`, `archived_at` og `owner_employee_id` på malfamilien venter.** Ingen tjeneste bruker dem nå; de hører til egne maler i fase 5.
- **A147 – Kolonnene for terskler, alder og testresultat venter** (`rule_conditions`: `threshold_key`, `age_year_element_key`, `age_source_element_key`, `documentation_element_key`, `material_element_key`; `rule_test_cases`: `last_result`, `last_run_at`). De kommer med regelmotoren, levetider og terskler og kontrollen før publisering. Da sjekkes ingen koder mot tabeller som ikke finnes.

## Oppdeling (kan bygges i parallell)
1. **Utvikler A:** skjema og migrering `0024_malmotor`, `tests/tenant-tables.ts`, domenemodell og ordliste.
2. **Utvikler B:** `src/core/templates` (lesing, utkast, lagre innhold, publisere), `errors.ts` og tilgangshjelperen i `src/core/access`. Starter på skjemafilen når A har pushet den. **Pusher `schemas.ts` (dokumentformatet), `errors.ts` og eksportene fra `src/core/templates` først**, før testskriveren begynner på saveDraftContent og TG-logikk.
3. **Testskriver:** testplan `docs/funksjoner/fase2a-malmotor-testplan.md` og testene under. Testdata er oppdiktede og nøytrale, uten fagtekst.
   - **Tilgang:** én tabell med rader for takstmann, kontor, leder, leder med enkeltrettighet og admin uten enkeltrettigheter. Hver rad kjøres mot lesing og mot én endringstjeneste (nei gir `AccessDeniedError` og ingen rader endret, ja går gjennom). I tillegg: takstmann uten rettighet får nei på alle fire endringstjenestene. `access.inspectors_edit_all` på gir ikke maltilgang. Fjernet ansatt avvises. Rettighet i A gir ikke tilgang i B. `requireTemplateEditAccess` testes for seg i `guards.test.ts`. Antallet rettigheter i `permissions.test.ts` er uendret. Ingen full matrise med alle roller mot alle tjenester.
   - **Tenant-isolasjon:** ett kall til `expectTenantIsolation` per spørring (`listTemplateFamilies`, `getTemplateVersion`, `createTemplateFamily`, `createDraftVersion`, `saveDraftContent`, `publishVersion`). Fremmed id med egen grant gir `TemplateNotFoundError` og ingen endring i B. Sammensatte fremmednøkler avviser en rad som peker inn i en annen organisasjon. Alle tolv tabellene i `tests/tenant-tables.ts` og `RESET_TABLES`.
   - **Versjoner:** kopi av hele treet (samme koder, nye id-er, kilden urørt), ett utkast også ved samtidige kall, publisering gjør forrige utgått, samtidige publiseringer gir én vinner, publisert og utgått avvises, slettet familie eller versjon gir `TemplateNotFoundError`, sortering og myk sletting i `getTemplateVersion`.
   - **saveDraftContent:** legger til, endrer og fjerner (ingen hard sletting), tall etter A144 (samme dokument to ganger gir 0/0/0), erstatning av rader uten kode (A142), ukjent kode i hver referanse, kodeformat (store bokstaver, mellomrom, bindestrek, tom, ledende punktum), doble koder i hvert område, arkivert kode, kode fjernet og lagt til igjen godtas, samme valgkode under to felt godtas, feil midt i lagringen etterlater ingenting. Sjekk `issues[].rule`.
   - **TG-logikk:** én enhetstest av den rene funksjonen (custom avviser kontrollpunkter, `suggest_outcome`, `suggest_tgiu`, godtar `show` og `validate`). `tgiu` avvises i Zod og med CHECK. `createTemplateFamily` avviser `custom`.
   - **Logg:** én rad per handling med versionId og riktige tall, og ingen `title`, `label`, `text`, `deviation_text`, `name` eller `message` fra testdokumentet i `audit_log` eller `events`.
   - **e2e:** ingen nye skjermer og ingen ny spec. `pnpm test:e2e` skal være grønn som før.

## Akseptkriterier
- [ ] Migreringen lager de tolv tabellene med `organization_id`, myk sletting og sammensatte fremmednøkler.
- [ ] Takstmann, kontor og leder uten `template.edit_structure` kan lese malen, men får nei på alle endringstjenester (test). Med enkeltrettigheten får de lov (test). Admin får alltid lov (test).
- [ ] `createDraftVersion` kopierer hele treet med samme koder; `publishVersion` gjør forrige versjon utgått; publiserte og utgåtte versjoner kan ikke endres (test).
- [ ] `createTemplateFamily` lager familien med en tom utkastversjon 1; `createDraftVersion` avviser når det finnes et utkast (test).
- [ ] `saveDraftContent` legger til, oppdaterer og fjerner etter kode (rader uten kode erstattes samlet), gir riktige tall (0/0/0 for samme dokument), og avviser ukjente koder, feil format, doble koder og arkiverte koder som tas i bruk igjen, i én transaksjon (test).
- [ ] Egne maler kan ikke ha kontrollpunkter eller TG-regler, og utfall kan ikke være `tgiu` (test).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for hver spørring, og `tenant-isolation-all-tables` grønn).
- [ ] Revisjonsloggen lagres for hver handling, uten titler, ledetekster eller fagtekst (test).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.
- [ ] Virker på iPad-størrelse: ikke aktuelt (ingen skjermer).

## Åpne spørsmål
- Ingen som stopper oppgaven. Beslutningene A136–A147 kan endres av Ståle når han er tilbake.

## Avgjort etter forhåndsvurdering runde 1 (prosjektleder, 06.11.2026)
- **Forenklerens kutt 1–8 er tatt med.** Kutt 1–5 er ført som A141 og A145–A147. Kutt 6: én tilgangstabell, men takstmann prøves mot alle fire endringstjenestene. Grunnen er at det er den billigste måten å vise at hver tjeneste kaller tilgangshjelperen, og det erstatter en egen test som bare sjekker at kallet finnes. Kutt 7: den rene funksjonen testes uten en egen mal laget med fabrikk. Kutt 8: står under «Ikke med».
- **Test-lederens seks punkter er avklart i kortet:** rader uten kode (A142), området for en kode (A141), første versjon (A143), hva som er «endret» (A144), referanser (threshold_key er tatt ut, de andre sjekkes), og feiltypene med `issues[].rule`.
- **Uenighet:** test-leder ville ha en test for «kode brukt på ny slags ting» og en test for hendelsen. Begge er tatt ut sammen med funksjonen (A141, A145). Test-leder ville teste TG-sperren med en egen mal fra fabrikk. Det er erstattet med en enhetstest, fordi `createTemplateFamily` ikke kan lage egne maler (A139) og funksjonen er ren.
