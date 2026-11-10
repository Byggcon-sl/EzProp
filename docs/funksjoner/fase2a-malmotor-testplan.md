# Testplan: Malmotoren (malfamilie, malversjon, seksjon, felt, kontrollpunkt, avviksspørsmål, utfall, standardtiltak og regler)

- **Oppgavekort:** `docs/funksjoner/fase2a-malmotor.md`
- **Dato:** 06.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** KI først og reklamasjoner (hovedsaken: testene låser at en fast kode aldri endres eller tas i bruk igjen etter arkivering, at publiserte versjoner aldri endres, og at bare den med maltilgang kan endre systemmalen. Da kan regelmotoren og KI senere knytte forslag, fraser og reklamasjoner til samme punkt over mange år). Tid: testene sikrer at `saveDraftContent` tåler samme dokument flere ganger (0/0/0), som regneark-importen og «Prøv malen» bygger på.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktede og nøytrale, uten fagtekst: koder som `sec.alpha`, `sec.alpha.sub`, `cp.one`, `el.size`, `opt.small`, `dq.first`, `out.a`, `rule.show_size`. For loggtestene brukes unike merker som ikke kan forekomme tilfeldig: `MERKE-TITTEL-M4K`, `MERKE-LEDETEKST-M4K`, `MERKE-AVVIK-M4K`, `MERKE-TILTAK-M4K`, `MERKE-NAVN-M4K`, `MERKE-MELDING-M4K`.

Ingen skjermer i oppgaven, så ingen ny e2e og ingen test uten nett. «Regeltestene» er strukturreglene (kodeformat, unike koder, referanser, arkiverte koder, TG-logikk, `tgiu`) som testsaker (`it.each`), med forventet `issues[].rule`.

## Avtale om signaturer (utvikler B og testskriver)

Fra kortet, Omfang 3–5. Avvik føres i kortet under en ny overskrift «Avgjort etter gjennomgangen».

- `src/core/templates/schemas.ts`: `templateDocumentSchema` og typen `TemplateDocument`. Alt peker med koder. Pushes først.
- `src/core/templates/errors.ts`: `TemplateNotFoundError` («Fant ikke malen.»), `TemplateStateError` (meldingene i kortet), `TemplateValidationError` med `issues: { path: string; rule: TemplateIssueRule; message: string }[]`. `TemplateIssueRule` er en fast liste: `schema`, `key_format`, `key_duplicate`, `key_unknown`, `key_archived`, `tg_logic_in_custom`, `outcome_tgiu`.
- Tjenester fra `@/core/templates`: `listTemplateFamilies(actor, organizationId)`, `getTemplateVersion(actor, organizationId, versionId)`, `createTemplateFamily(actor, organizationId, input)` → `{ familyId, versionId }`, `createDraftVersion(actor, organizationId, familyId)` → `{ versionId }`, `saveDraftContent(actor, organizationId, versionId, document)` → `{ added, changed, removed }`, `publishVersion(actor, organizationId, versionId, changeNote)` → `{ versionId }`. Alle som brukes i `expectTenantIsolation` må gi noe med en id.
- `checkNoTgLogicInCustom(kind, document)` er ren og gir en liste med `issues` (tom = godkjent).
- `src/core/access`: `requireTemplateEditAccess(actor, organizationId, family: { kind })` → `EmployeeGrant`, kaster `AccessDeniedError`.
- Testhjelpere:
  - `tests/template-document.ts` (ny): `buildTemplateDocument(overrides?)` gir et gyldig, nøytralt dokument som bruker alle tolv tabellene: to seksjoner (én underseksjon), tre felt (`choice` med to valg, `number`, `table`), ett kontrollpunkt med to avviksspørsmål, to utfall på det første, to standardtiltak på det ene utfallet, tre regler (`show`, `suggest_outcome`, `validate`) med to betingelser i to grupper og to testtilfeller.
  - `tests/factories.ts`: `createTemplate(organizationId, { status?, versionNumber?, document?, deletedAt?, versionDeletedAt? })` → `{ familyId, versionId }`. Legger inn direkte i databasen (ikke via tjenesten), så tenant-testene ikke er avhengige av tilgangen.
  - Alle tolv tabellene står i `RESET_TABLES` (barn før foreldre).

## 1. Rettigheten og hjelperen, `src/core/access/permissions.test.ts` og `guards.test.ts`

1. **antallet rettigheter er uendret** i `permissions.test.ts` (ingen ny rettighet, kortet «Data»). `template.edit_structure` står fortsatt i `grantablePermissions`.
2. **`requireTemplateEditAccess`, rolletabell** (`it.each`, familien `system`, innstillingen `access.inspectors_edit_all` på og av):
   | ansatt | resultat |
   |---|---|
   | takstmann | `AccessDeniedError` |
   | kontor | `AccessDeniedError` |
   | leder | `AccessDeniedError` |
   | takstmann med enkeltrettighet | grant |
   | leder med enkeltrettighet | grant |
   | admin uten andre roller og uten enkeltrettigheter | grant |
3. **innstillingen gir aldri maltilgang:** takstmann med `access.inspectors_edit_all` på får nei (dekkes av raden over med innstillingen på, egen testnavn så det er lett å finne).
4. **fjernet, deaktivert og manglende ansatt** gir `AccessDeniedError`.
5. **rettighet i A gir ikke tilgang i B:** takstmann med enkeltrettighet i A, ansatt uten rettighet i B, får nei mot B.
6. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten sertifisering og uten andre roller får grant.

## 2. Ren funksjon og skjema, `src/core/templates/schemas.test.ts` (ny, enhet, regler som data)

Hver regel er en tabell med testsaker: dokument (med `buildTemplateDocument` og én endring), forventet godtatt/avvist og forventet `rule`. En egen test sjekker at alle verdiene i `TemplateIssueRule` finnes i minst én avvist testsak (her eller i 4.3).

1. **`key_format`:** `wet_room.membrane`, `a`, `a1.b_2` godtas. `Stor`, `med mellomrom`, `med-bindestrek`, `""`, `.ledende`, `æøå` avvises. Prøves på seksjon, felt, valg, kontrollpunkt, spørsmål, utfall og regel.
2. **`outcome_tgiu`:** utfall med TG-verdi `tgiu` avvises i Zod. TG2, TG3 og de andre lovlige verdiene godtas.
3. **`schema`:** manglende `key`, ukjent `field_type`, ukjent `repeat`, ukjent regeltype, `table_columns` som ikke er en liste, ukjent `phrase_slot` avvises. Gyldig liste og kjent ord godtas (bare grunnsjekk, kortet «Ikke med»).
4. **`organizationId`, `id` og `version_id` i dokumentet** strippes eller avvises (aldri brukt).
5. **`checkNoTgLogicInCustom`** (én test, `it.each`, beslutning 27.10.2026): `custom` + kontrollpunkt → `tg_logic_in_custom`; `custom` + `suggest_outcome` → avvist; `custom` + `suggest_tgiu` → avvist; `custom` + `show` og `validate` → godtatt; `system` + alt → godtatt.

## 3. Databasen, `src/db/templates-schema.test.ts` (ny, direkte innsetting)

1. **sammensatte fremmednøkler** (`it.each` over undertabellene): en rad i B som peker på en forelder i A (seksjon → versjon, felt → seksjon, valg → felt, kontrollpunkt → seksjon, spørsmål → kontrollpunkt, utfall → spørsmål, tiltak → utfall, betingelse → regel, testtilfelle → regel) avvises med fremmednøkkelfeil.
2. **CHECK på utfall:** direkte innsetting med `tgiu` avvises.
3. **delvis unik indeks på kode:** to aktive kontrollpunkter med samme kode i samme versjon avvises; samme kode når den ene er slettet mykt godtas; samme kode i to versjoner godtas. Én test per nivå med forelder: samme valgkode under to felt godtas, under samme felt avvises.
4. **ett utkast per familie:** to rader med `status = 'draft'` i samme familie avvises; utkast i to familier godtas.
5. **standardverdier:** `deleted_at = null`, `created_at` og `updated_at` satt, `status = 'draft'`.
6. **tenant-tabellene:** alle tolv står i `tests/tenant-tables.ts` med radbygger og testfilen `src/core/templates/templates.test.ts`; `tests/tenant-isolation-all-tables.test.ts` er grønn (tolv tabeller mer enn før). `tests/factories.test.ts` er grønn (alle i `RESET_TABLES`).
7. **migreringen er ren:** `0024_malmotor` finnes, og `pnpm db:generate` lager ingen ny fil (sjekkes i gjennomgangen).

## 4. Kjernen, `src/core/templates/templates.test.ts` (ny, mot databasen)

### 4.1 Tilgang per rolle (kortet «Tilgang», én tabell)

1. **rolletabell** (`it.each`): takstmann, kontor, leder, leder med enkeltrettighet, admin uten enkeltrettigheter. Hver rad kjøres mot `getTemplateVersion` (alle får lese) og mot `saveDraftContent` (nei gir `AccessDeniedError`, ja går gjennom). Ved nei: antall rader i alle tolv tabellene og i `audit_log` er uendret.
2. **takstmann uten rettighet får nei på alle fire endringstjenestene** (`createTemplateFamily`, `createDraftVersion`, `saveDraftContent`, `publishVersion`). Viser at hver tjeneste kaller `requireTemplateEditAccess`. Ingen rader endret.
3. **`access.inspectors_edit_all` på:** takstmann får fortsatt nei på `saveDraftContent`.
4. **fjernet ansatt** får `AccessDeniedError` på `listTemplateFamilies` og `saveDraftContent`.
5. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller lager familie, lagrer innhold, publiserer og lager nytt utkast.

### 4.2 Tenant-isolasjon (regel 2; seks kall til `expectTenantIsolation`)

1. **`listTemplateFamilies`:** `seed` lager én mal i A og B med `createTemplate`; `idOf = id`.
2. **`getTemplateVersion`:** `seed` lager én versjon i A og B; `query` returnerer `[versjonen]`.
3. **`createTemplateFamily`:** `query` lager en familie og returnerer `[{ id: familyId }]`. Etterpå: B har nøyaktig én familie og én versjon, og alle `audit_log`-rader for B har `organization_id = B`.
4. **`createDraftVersion`:** `seed` lager en publisert versjon i A og B; `query` lager utkast. Etterpå: B har nøyaktig ett nytt utkast, og alle rader i det har `organization_id = B`.
5. **`saveDraftContent`:** `seed` lager et utkast i A og B; `query` lagrer `buildTemplateDocument()`. Etterpå: alle rader under Bs versjon har `organization_id = B`.
6. **`publishVersion`:** `seed` lager et utkast i A og B; `query` publiserer.

### 4.3 Fremmed id med egen grant (IDOR)

Admin i A, med `orgA.id` som organisasjon, `it.each` over tjenestene som tar id:

1. **Bs `versionId`** i `getTemplateVersion`, `saveDraftContent`, `publishVersion`, og **Bs `familyId`** i `createDraftVersion` → `TemplateNotFoundError`. Bs rader er uendret (alle felt, `updated_at`, `status`), og A har ingen nye rader.
2. **tilfeldig uuid og `"ikke-en-id"`** → `TemplateNotFoundError`, aldri databasefeil.
3. **slettet familie og slettet versjon** (`deletedAt` satt) → `TemplateNotFoundError` med samme melding som 4.3.1.

### 4.4 Versjoner

1. **`createTemplateFamily`** lager familien og en tom utkastversjon 1 i samme transaksjon (A143); begge id-er kommer tilbake. `kind = custom` avvises (A139), ingen rader.
2. **`createDraftVersion` kopierer hele treet:** etter lagring og publisering av v1 har v2 samme koder i alle tolv tabellene, nye id-er, `based_on_version_id = v1`, `version_number = 2`. Kilden er urørt (dyp sammenligning før og etter). Rader som var slettet mykt i v1, kopieres ikke.
3. **ett utkast:** `createDraftVersion` når det finnes et utkast (også når v1 aldri er publisert) → `TemplateStateError` med meldingen i kortet.
4. **samtidige utkast:** to kall i `Promise.all` gir ett utkast og én `TemplateStateError`.
5. **publisering:** utkast blir `published`, `published_by` og `published_at` satt, `change_note` lagret; forrige publiserte blir `retired`.
6. **samtidige publiseringer:** to kall på samme utkast i `Promise.all` gir én vinner og én `TemplateStateError`; nøyaktig én `published` i familien.
7. **publisert og utgått endres aldri** (`it.each` over status × `saveDraftContent`, `publishVersion`): `TemplateStateError` («Malversjonen er publisert og kan ikke endres.»), ingen rader endret.
8. **`getTemplateVersion`** gir hele treet sortert etter `sort_order` på hvert nivå (lagret i stokket rekkefølge), uten rader slettet mykt.
9. **`listTemplateFamilies`** viser ikke slettede familier.

### 4.5 `saveDraftContent`

1. **legger til, endrer og fjerner:** første lagring gir `added` = antall rader i dokumentet, `changed = 0`, `removed = 0`.
2. **samme dokument to ganger gir 0/0/0** (A144), og ingen rad får ny `updated_at`.
3. **endret** teller bare rader der minst ett lagret felt er ulikt (endre én `label` → `changed = 1`).
4. **fjernet** er myk sletting: raden står med `deleted_at` satt; antall rader i tabellen går aldri ned (ingen hard sletting).
5. **rader uten kode erstattes samlet per forelder** (A142): lik liste → 0/0/0; endret rekkefølge eller én ny verdi → gamle slettes mykt (`removed`), nye legges til (`added`). Gjelder standardtiltak, betingelser og testtilfeller.
6. **`key_unknown`** (`it.each` over hver referanse): forelderseksjon, seksjon på felt og kontrollpunkt, kontrollpunkt på felt og spørsmål, felt på valg, spørsmål på utfall, utfall på tiltak, `suggested_outcome`, regelmål, `related_checkpoint_keys`, betingelsens `element_key` og `checkpoint_key`. `issues[].path` peker på stedet.
7. **`key_duplicate`** (`it.each` over hvert område): to seksjoner, to felt, to kontrollpunkter, to regler med samme kode; to valg under samme felt; to spørsmål under samme kontrollpunkt; to utfall under samme spørsmål.
8. **lovlig gjenbruk:** samme valgkode under to felt godtas; samme kode på en seksjon og et kontrollpunkt godtas (A141).
9. **`key_archived`** (A136): v1 har `cp.one`, publiseres; v2 fjerner den, publiseres; v3 som legger `cp.one` til igjen → avvist. **Fjernet og lagt til igjen i samme utkast** når koden finnes i siste publiserte → godtatt.
10. **`key_format`** via tjenesten (én sak per tabell med kode), så sjekken også gjelder etter Zod.
11. **feil midt i lagringen etterlater ingenting:** testen lager en midlertidig trigger på `rule_test_cases` som kaster feil, lagrer et gyldig dokument og sjekker at ingen av de tolv tabellene og `audit_log` er endret. Triggeren fjernes i `finally`.
12. **valideringsfeil etterlater ingenting:** dokument med én feil i siste regel → ingen rader endret.
13. **`organization_id` på alle nye rader** er `grant.organizationId`.

### 4.6 Revisjonsloggen og hendelser

1. **én rad per handling** (opprettet, innhold lagret, publisert) med `versionId`, hvem og handling; innhold lagret har `added`, `changed`, `removed` som stemmer med svaret.
2. **ingen fagtekst i loggen:** dokumentet bruker merkene over i `title`, `label`, `deviation_text`, tiltakstekst, familiens `name` og en regels `message`; ingen av dem finnes i `audit_log` eller `events` (søk i hele JSON-en).
3. **ingen ny hendelse** (A145): antall rader i `events` er uendret etter publisering.
4. **avvist handling** (tilgang, status, validering) gir ingen loggrad.

## 5. e2e

Ingen nye skjermer og ingen ny spec (kortet «Skjermer»). `pnpm test:e2e` skal være grønn som før, både PC og iPad-størrelse. Ikke aktuelt uten nett i denne oppgaven; malen på iPaden testes når rapporten bruker den.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Tolv tabeller, `organization_id`, myk sletting, sammensatte fremmednøkler | 3.1, 3.5, 3.6, 4.5.4 |
| Lese for alle, endre bare med maltilgang, admin alltid | 1.2–1.6, 4.1 |
| Kopi av treet, forrige blir utgått, publisert endres ikke | 4.4.2, 4.4.5–4.4.7 |
| Tom v1, ett utkast | 4.4.1, 4.4.3, 4.4.4, 3.4 |
| `saveDraftContent` etter kode, tall, feil, én transaksjon | 4.5 |
| Ingen TG-logikk i egne maler, ingen `tgiu` | 2.2, 2.5, 3.2, 4.4.1 |
| Tenant-isolasjon | 4.2, 4.3, 3.1, 3.6 |
| Revisjonslogg uten fagtekst | 4.6 |
| Grønne kommandoer | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` |

## Godkjennes ikke uten

- 4.2 (seks `expectTenantIsolation`) og 4.3 (fremmed id).
- 1.2, 1.6 og 4.1.5 (admin stenges aldri ute).
- 4.1.2 (alle fire endringstjenestene prøvd uten rettighet).
- 4.5.4 og 4.5.5 (myk sletting, aldri hard sletting).
- 4.5.9 (arkivert kode tas ikke i bruk igjen, regel 6).
