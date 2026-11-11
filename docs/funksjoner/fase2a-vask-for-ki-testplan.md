# Testplan: Vask før KI

- **Oppgavekort:** `docs/funksjoner/fase2a-vask-for-ki.md`
- **Dato:** 11.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** KI i bunnen (testene låser at all tekst vaskes i den eneste veien til leverandøren, også den falske, og at sperrede forespørsler står i loggen med eget utfall) og de ansatte (takstmannen kan skrive fritt; persondata sendes aldri, regel 14). Reklamasjoner: indirekte.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. All testdata er oppdiktet (navn som «Åse Testesen», telefon `12345678`, gnr 999). Ingen ekte navn, adresser eller matrikkelnumre.

**Ingen nye `*-testplan.test.ts`** (kortet). Testene legges i filene som finnes for området; nye filer bare der området er nytt (`pii-patterns.test.ts`, `redaction.test.ts`). Numrene under (V1.1 osv.) står først i testnavnet, så rapporten kan krysse av.

Ingen TG-regler. «Regeltestene» er mønstrene og vasken som tabeller med testsaker (`it.each`), pluss testsettet med fasit (`redaction-cases.ts`).

## Avtale om signaturer (utvikler og testskriver)

Navn kan endres av utvikleren; avvik føres i kortet.

- `src/shared/lib/pii-patterns.ts`: `redactPii(text, { addresses?: boolean }) → { text, count }` og konstanten `PII_PLACEHOLDERS` (nøyaktig de åtte).
- `src/core/ai/redaction.ts`: `redactText(text, knownValues) → { text, count }` (ren), `loadKnownValues(grant, assignmentId) → KnownValues` (databasen).
- `src/core/ai/redaction-cases.ts`: `REDACTION_CASES: { name, input, knownValues?, mustRemove: string[], mustKeep: string[] }[]`.
- `src/core/ai/never-fields.ts` (eller i `features.ts`): `NEVER_FIELDS`, og `fieldSources` per funksjonsdefinisjon.
- Utfallet `blocked` i `AI_OUTCOMES`; `requestSuggestion` gir `{ kind: "blocked" }`.

## 1. Mønstrene, `src/shared/lib/pii-patterns.test.ts` (ny, ren)

`it.each`-tabeller, én blokk per mønster:

1. **V1.1 telefon** vaskes til `[telefon]`: `12345678`, `123 45 678`, `12 34 56 78`, `1234 5678`, `123-45-678`, `12.34.56.78`, `+4712345678`, `+47 123 45 678`, `0047 12345678`.
2. **V1.2 fødselsnummer:** `01019912345` og `010199 12345` → `[fødselsnummer]`; aldri `[telefon]` pluss rest.
3. **V1.3 organisasjonsnummer:** `123456789`, `123 456 789`, `NO 123456789 MVA` → `[organisasjonsnummer]`.
4. **V1.4 kontonummer:** `1234.56.78901`, `1234 56 78901` → `[kontonummer]`.
5. **V1.5 e-post:** vanlig, med punktum og pluss, med æøå i navnedelen, store bokstaver → `[e-post]`.
6. **V1.6 matrikkel:** `gnr 12 bnr 34`, `gnr. 12 bnr. 34`, `g.nr 12`, `gbnr 12/34`, `gnr 12/34/0/5`, `fnr 3`, `snr 5` → `[matrikkel]`.
7. **V1.7 adresse:** `Storgata 12`, `Fjordveien 3B`, `Sjøvegen 4 b`, `Bakkeplassen 1`, `Skogstien 7`, `Parkallé 2`, `8006 Bodø` → `[adresse]`.
8. **V1.8 står urørt** (`it.each`, teksten ut er lik teksten inn, `count` 0): `1200 mm`, `48x98`, `TG 2`, `2 x 4`, `0,25`, `1985`, `11.11.2026`, `2026-11-11`, `2026-11-11T10:00:00Z`, UUID med bokstaver og UUID med bare sifre i første gruppe, `kr 4 500 000`, `12/34` uten matrikkelord, `8006` uten poststed, «ved bakken», «langs stien», «Storgata» uten nummer (mønsteret; kjent verdi er egen test).
9. **V1.9 rekkefølge:** elleve sifre gir `[fødselsnummer]`, kontonummer gir ikke `[organisasjonsnummer]` eller `[telefon]`; ni sifre gir ikke `[telefon]` + siffer.
10. **V1.10 grenser:** tall inne i lengre tall eller UUID treffes ikke (`123456789012`, `a1234567-...`); æøå inntil tallet regnes som bokstav. Kildesjekk: ingen `\b` i filen, alle mønstre har flagget `u`.
11. **V1.11 NFC:** samme tekst i NFD og NFC gir samme resultat («Sjøgata 4» skrevet med kombinerende tegn).
12. **V1.12 kjent overvask** (A170, dokumentert): «1985 2010» → `[telefon]`. Testen sier i navnet at dette er villet.
13. **V1.13 adresse av i loggermodus:** `redactPii(..., { addresses: false })` lar «Storgata 12» stå.
14. **V1.14 ytelse:** 50 000 tegn med mange sifre, mellomrom og bindestreker vaskes under 500 ms; og en ond streng (`"1 ".repeat(25000)`) likeså.
15. **V1.15 plassholderne** er nøyaktig `[navn]`, `[e-post]`, `[telefon]`, `[adresse]`, `[matrikkel]`, `[fødselsnummer]`, `[organisasjonsnummer]`, `[kontonummer]`.
16. **V1.16 count** er antall treff (tre telefoner gir 3), og en tekst uten treff gir 0 og samme streng.

## 2. Loggeren, `src/shared/lib/logger.test.ts` (utvides)

1. **V2.1** åtte sifre sammen, fødselsnummer og organisasjonsnummer i en feilmelding og i et felt i `extra` vaskes.
2. **V2.2** `usageId`, `ref` (UUID), ISO-tid, feilkoder (`unavailable`, `unknown`) og HTTP-status står urørt.
3. **V2.3** Azure-nøkler, `client_secret` og Bearer vaskes fortsatt (eksisterende tester grønne), og vaskes før tallmønstrene (en nøkkel med åtte sifre blir nøkkelplassholder, ikke `[telefon]`).
4. **V2.4** adresse vaskes ikke i loggen («Storgata 12» står).
5. **V2.5 statisk:** `logger.ts` importerer mønstrene fra `pii-patterns.ts` og har ingen egen e-post- eller telefonregex.

## 3. Vasken med kjente verdier, `src/core/ai/redaction.test.ts` (ny, ren)

`it.each` med oppdiktede kjente verdier:

1. **V3.1** kjente verdier vaskes før mønstrene: partens telefon `12345678` gir én `[telefon]` og `count` 1 (ikke 2).
2. **V3.2** store og små bokstaver: «ÅSE TESTESEN», «åse testesen» vaskes.
3. **V3.3 personnavn:** hel frase og hvert ord på minst tre tegn; «Bo Li» vaskes som frase, men «Bo» alene står (restrisiko, A174, dokumentert i testnavnet).
4. **V3.4 æøå og bindestrek:** «Åse Ødegård», «Bjørnø», «Sjøgata», «Anne-Lise» (gir «Anne-Lise», «Anne», «Lise»), genitiv «Hansens», «Hansen's», «Anne-Lises».
5. **V3.5 regex-tegn:** «Bygg & Co A/S», «(Nord)», «St.», «Test+Sønn» vaskes, ingen unntak.
6. **V3.6 firmanavn som frase:** «Bygg og Tak AS» vaskes; «tak» og «bygg» alene i samme tekst står. Gjelder også borettslag, sameie, `managing_agent` og `ordered_by_text`.
7. **V3.7 adresse:** hel streng, gatenavn alene («i Storgata»), gatenavn + nummer, poststed alene; postnummer alene står.
8. **V3.8 matrikkel:** `12/34`, `12/34/0/5`, `1804-12/34`, «gnr 12», «bnr 34», «andelsnummer 5» vaskes; «123 mm», «34 grader» står.
9. **V3.9 lengste først:** «Anne-Lise Testesen» blir én `[navn]`, ikke `[navn]-[navn] [navn]`.
10. **V3.10 tom eller kort verdi** (tom streng, ett tegn, bare mellomrom) gir ikke et mønster som treffer alt.
11. **V3.11 testsett med fasit:** for hver sak i `redaction-cases.ts` (30–50 notater og avvikstekster): ingen `mustRemove` finnes i resultatet (krav: 0 bom), alle `mustKeep` finnes. Antall unødig vaskede ord skrives ut i testnavnet eller som `console.info` i testen. Egen test: settet har mellom 30 og 50 saker og dekker alle åtte plassholdere.

## 4. Integrasjon, `src/core/ai/request-suggestion.test.ts` (utvides, testdatabasen)

Spion-leverandør (`AiProvider` som tar vare på `request.prompt`), injisert slik eksisterende tester gjør.

1. **V4.1 én rad per kolonne** (`it.each`, én tabelldrevet test): hver kjent verdi i kortets punkt 2 lagres i sin kolonne (`assignment_parties` → `contacts.name/email/phone`, `firms.name/org_number`; `orders.ordered_by_contact_id`, `ordered_by_firm_id`, `ordered_by_text`, `address_text`, `gnr/bnr/snr`, `housing_association_name`; `employees.name` via `assignment_team_members`; `properties.address/postal_code/city/municipality_name/municipality_number`; `cadastral_units.gnr/bnr/fnr/snr/share_number/association_name/association_org_number`; `common_areas.managing_agent`). Verdien står i teksten; prompten inneholder den ikke. For navn også fornavn og etternavn alene og i annen skrift.
2. **V4.2 mykt slettet:** verdier fra mykt slettede parter, kontakter, firma, teammedlemmer, matrikkel og fellesareal vaskes.
3. **V4.3 alt i én tekst:** alle mønstre og kjente verdier i samme tekst; ingen av verdiene i prompten; `redacted_count` lik fasit.
4. **V4.4 ingen lekkasje** (i `no-leak.test.ts`): verdiene finnes ikke i `input_summary`, `source_fields`, `target_ref`, `audit_log`, fanget logger eller svaret. `input_summary` er regnet av vasket tekst (lengden stemmer med vasket tekst).
5. **V4.5 feil stenger:** oppslaget kaster (spion på `loadKnownValues` eller ødelagt rad) → leverandøren kalles ikke, ingen `ok`-rad; samme for unntak i vasken. Feilmeldingen og loggeren har ingen verdier.
6. **V4.6 rekkefølge:** «KI er av» og `blocked` kjører ikke oppslaget (spion på `loadKnownValues`, 0 kall).
7. **V4.7 falsk leverandør vaskes også:** med `fake` og `ai_trial` uten oppdrag blir `12345678` til `[telefon]` i forslaget.
8. **V4.8 `assignmentId` null:** bare mønstrene brukes, ingen databaseoppslag på kjente verdier.

## 5. Utfallet `blocked` (ad-1)

I `request-suggestion.test.ts`, `record-decision.test.ts`, `approval-check.test.ts`, `suggestion-status.test.ts`:

1. **V5.1** `answer` med ekte leverandør (testleverandør med annen `code` enn `fake`) → rad med `outcome = blocked`, `status`, `output_text`, `error_code` null, tokens, kostnad og `redacted_count` 0; leverandøren ikke kalt; svar `{ kind: "blocked" }`.
2. **V5.2** samme for `ai_trial` med ekte leverandør, og for fritekst uten oppdrag (`assignmentId` null, mål ikke `ai_trial`) med ekte leverandør.
3. **V5.3** `answer` med falsk leverandør virker (A173).
4. **V5.4** forrige åpne forslag på samme mål står som `suggested` etter `blocked`.
5. **V5.5** samme `requestId` igjen → `blocked`, ingen ny rad, intet kall.
6. **V5.6** `recordDecision`, `checkAiTextApproved` og `getSuggestionStatus` godtar ikke `blocked`-raden.
7. **V5.7** «KI er av» gir fortsatt ingen rad og `{ kind: "disabled" }`.
8. **V5.8 prøvesiden** (`src/app/(ansatt)/prove/ki/actions.test.ts`): `blocked` fra kjernen gir samme svar til klienten som `disabled`, slik at siden viser samme tekst. Merk: kortet sier «KI er ikke tilgjengelig», siden viser i dag «KI er av.». Testen låser «samme tekst som KI av»; utvikler retter kortet eller siden så de stemmer.

## 6. Databasen, `src/db/schema/ai-usage-log.test.ts` (utvides)

1. **V6.1** `redacted_count` finnes, ikke tom, standard 0 (gamle rader og rad uten verdi får 0), `-1` avvises.
2. **V6.2** `blocked` godtas med tomme `status`, `output_text`, `error_code`; avvises med hver av dem satt (`it.each`).
3. **V6.3** migreringen `0027_*` sletter ingenting og endrer ikke eksisterende rader (utenom standardverdien).

## 7. Tilgang per rolle og tenant-isolasjon

I `request-suggestion.test.ts`, `access.test.ts` og `suggestion-status.test.ts`:

1. **V7.1 `expectTenantIsolation`** på `loadKnownValues`: organisasjon B får ingen verdier fra A sitt oppdrag og ingen tilgang.
2. **V7.2 bevis i praksis:** navnet på en part i B står i teksten fra A og vaskes **ikke** (B sine verdier brukes aldri). Også med samme `assignmentId` sendt fra B.
3. **V7.3** A sitt oppdrag i en forespørsel fra B avvises (nøytralt avslag), ingen oppslag, ingen rad i A.
4. **V7.4 rollene** (`it.each`): takstmann, kontor, leder, admin får samme svar som før (kontor uten `report.edit` avvises som i dag). **Admin stenges ikke ute:** admin får vasket forslag, ikke `blocked`, ved gyldig forespørsel med falsk leverandør.
5. **V7.5 `getSuggestionStatus` uten KI-rettighet:** spion på `db.select` (eller telling av spørringer) viser 0 lesinger av `ai_usage_log`; svaret `null`. Med rettighet: rettigheten på raden sjekkes som før; mykt slettet rad gir `null`; admin ser status.
6. **V7.6 `tests/tenant-tables.ts`** er uendret eller oppdatert slik at `tenant-isolation-all-tables.test.ts` er grønn (ingen ny tabell, men kolonnen må ikke brekke radbyggeren).

## 8. Statiske tester

I `src/core/ai/features/features.test.ts` og `src/core/ai/static-checks.test.ts`:

1. **V8.1** hver feltkode på tillatt-listen i hver definisjon har en kilde i `fieldSources` (`tabell.kolonne` eller `free_text`).
2. **V8.2** ingen kilde er i `NEVER_FIELDS`. Ikke hul: en oppdiktet definisjon med kilde `contacts.email` blir fanget, og en uten kilde blir fanget.
3. **V8.3** `NEVER_FIELDS` inneholder en fast kopi av minimumslisten (skrevet i testen) pluss `assignment_team_members.handed_over_reason`, `certifications.certificate_number`, `assignments.number`.
4. **V8.4** kommentaren over listene nevner gjennomgang av sikkerhet-personvern (A175).
5. **V8.5** `provider.complete` kalles bare i `src/core/ai/request-suggestion.ts`, og kallet står etter vaskekallet i filen (kildesjekk).
6. **V8.6** `src/core/ai` har ingen modulnivå-variabel som mellomlagrer kjente verdier (kildesjekk: ingen `Map`/`cache` på toppnivå i `redaction.ts`), og `redactedCount` står ikke i returtypen til `requestSuggestion`.
7. **V8.7** ingen visning, liste eller telling av `redacted_count` eller `blocked` per ansatt eksporteres fra `@/core/ai` (utvider 12.7).

## 9. E2E (Playwright, prosjektene `pc` og `ipad`)

I `e2e/fase-2a-forslagsmonster.spec.ts` (utvides; ingen ny testplan-spec):

1. **V9.1** på `/prove/ki` skriver prøvetakstmannen en oppdiktet tekst med telefon `12345678` og e-post; forslaget fra den falske leverandøren viser `[telefon]` og `[e-post]`, og verken nummeret eller adressen står i forslaget. Raden med markøren har `redacted_count` 2.
2. **V9.2** eksisterende tester for `/prove/ki` (12.1–12.15) er grønne på PC og iPad, også «uten nett» (12.8, 12.9: knappen sperret, egen tekst ikke tapt).
3. **V9.3** admin kommer inn og får forslag (12.15 utvides med vasket forslag).

`blocked` kan ikke nås i e2e (bare falsk leverandør i testmiljøet); den dekkes av V5.8.

## 10. Myk sletting og 10 år

1. **V10.1** ingen `.delete(` på `ai_usage_log` (12.4 grønn); `blocked`-rader får `retain_until` = opprettet + 10 år.
2. **V10.2** mykt slettede kilderader brukes i vasken (V4.2), men slettes eller endres aldri av den.

## Godkjenning

Avvises hvis V7.1–V7.5 (tilgang og tenant) eller V4.5 (feil stenger) mangler eller er røde. Lint, typesjekk, Vitest og e2e må være grønne, og versjonen 0.5.5.
