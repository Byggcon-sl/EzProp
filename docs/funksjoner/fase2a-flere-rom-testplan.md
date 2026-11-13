# Testplan: Flere rom på én gang (T4)

- **Oppgavekort:** `docs/funksjoner/fase2a-flere-rom.md`
- **Fasit:** `docs/kartlegging/svar-fra-stale-2026-11-12.md` (T4)
- **Dato:** 13.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:**
  - **De ansatte:** e2e viser at en leilighet får alle rommene med tre trykk (åpne, sett, lagre), på iPad og PC, og at tellerne står igjen etter feil.
  - **KI i bunnen:** testene låser at `RoomDraft` og `addRooms` er eksportert fra `src/core/buildings`, at kilden er en lukket kodeliste (`ai_floor_plan` avvises nå), og at de rene funksjonene ikke importerer server eller database. Da kan KI-forslaget fra plantegning (2a-3) bruke samme inngang uendret.
  - **Færre reklamasjoner:** riktig arealtype og «under terreng» per rom, og like rom får unike numre som aldri kolliderer, heller ikke ved samtidig lagring.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet. Numrene (F1.1 osv.) står først i testnavnet, så rapporten kan krysse av mot akseptkriteriene.

**Testfiler** (ingen nye unntatt der det står «ny»):

| Fil | Innhold |
|---|---|
| `src/core/buildings/room-presets.test.ts` (ny) | F1, F2, F3 (rene funksjoner, tabelltester) |
| `src/core/buildings/schemas.test.ts` | F4 (Zod) |
| `src/core/buildings/buildings.test.ts` | F5–F9 (tjenesten mot testdatabasen, tilgang, tenant, myk sletting) |
| `src/core/buildings/buildings-transaction.test.ts` | F10 (alt eller ingenting) |
| `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.test.ts` og `actions-access.test.ts` | F11 (handlingen) |
| `e2e/fase-2a-flere-rom.spec.ts` (ny) | E1–E12 (PC og iPad) |
| `e2e/fase-2a-bygninger-areal-rom.spec.ts` | E13 (T-0018, `startRoom` virker) |

## Avtale om signaturer (utvikler og testskriver)

- `src/core/buildings/room-presets.ts`: `ROOM_PRESETS` (nøklene `apartment`, `house_main_floor`, `house_upper_floor`, `basement`; hvert sett har `key`, `label`, `draft: true` eller tilsvarende utkastmerke, `rooms: RoomDraft[]`), `suggestRoomPreset({ housingType, floorLevel, floorBelowGround }): RoomPresetKey`, `numberRoomDrafts(drafts, existingRooms): { roomType, name }[]`.
- `RoomDraft = { roomType: RoomType; count: number }`. Ingen `name`, ingen `origin`.
- `ROOM_DRAFT_SOURCES = ["manual", "preset"] as const`.
- `addRooms(actor, organizationId, floorId, { drafts, source, presetKey? })` gir de nye rommene (id, `roomType`, `name`) i rekkefølge.
- `addRoomsInputSchema` i `schemas.ts`.
- Handlingen heter `addRoomsAction` (eller tilsvarende) i `actions.ts`.
- Dialogen har rollen `dialog` med tilgjengelig navn «Legg til flere rom», flisene er knapper med navnet på romtypen, og «–» har navnet «Færre <romtype>».

Avvik i navn føres i kortet.

## F1. Ferdige sett, `room-presets.test.ts` (ny)

1. **F1.1 preset_keys_snapshot:** nøklene i `ROOM_PRESETS` er nøyaktig `apartment, house_main_floor, house_upper_floor, basement` i fast rekkefølge (regel 6, øyeblikksbilde som tall/strenger i testen, ikke `toMatchSnapshot`-fil).
2. **F1.2 preset_contents:** innholdet i hvert sett er som i kortet punkt 3 (romtype og antall), for eksempel `apartment` har `bedroom` ×2 og 7 rom totalt.
3. **F1.3 preset_room_types_active:** hver `roomType` i hvert sett finnes i `ROOM_TYPE_KEYS` (`it.each` over alle sett og rom).
4. **F1.4 preset_marked_draft:** hvert sett er merket «utkast, ikke godkjent av fagrådet».
5. **F1.5 preset_counts_valid:** hvert sett har `count` 1–20 per romtype og høyst 40 rom totalt, og ingen romtype står to ganger i samme sett. Viser at et sett alltid går gjennom `addRoomsInputSchema` (kjør skjemaet på hvert sett med `source: "preset"`).
6. **F1.6 draft_sources:** `ROOM_DRAFT_SOURCES` er nøyaktig `["manual", "preset"]`; `ai_floor_plan` finnes ikke.

## F2. Forslag til sett, `suggestRoomPreset` (tabelltest)

`it.each` med inndata og forventet sett:

1. **F2.1 below_ground_wins:** `floorBelowGround: true` gir `basement` for alle åtte boligtyper og `null`, også med `floorLevel` 1 eller 2.
2. **F2.2 apartment:** `apartment` og `apartment_in_house` gir `apartment` på nivå -1 (ikke under terreng), 0, 1, 2 og 5.
3. **F2.3 main_floor:** `detached`, `semi_detached`, `terraced`, `holiday_home`, `farm`, `other` og `null` på nivå 1, 0 og -1 (ikke under terreng) gir `house_main_floor`.
4. **F2.4 upper_floor:** de samme på nivå 2 og 20 gir `house_upper_floor`.
5. **F2.5 total:** for hver kombinasjon av alle boligtyper + `null`, nivå -2 til 20 og begge verdier av under terreng gir funksjonen en nøkkel som finnes i `ROOM_PRESETS` (aldri `undefined`).

## F3. Nummerering, `numberRoomDrafts` (tabelltest)

Romtypens navn hentes fra `roomTypeLabel`, ikke hardkodet.

1. **F3.1 single_empty_name:** ett `bedroom` i tom etasje gir tomt navn.
2. **F3.2 two_new:** `bedroom` ×2 i tom etasje gir «Soverom 1», «Soverom 2».
3. **F3.3 continue_after_existing:** «Soverom 1» og «Soverom 2» finnes, +1 gir «Soverom 3».
4. **F3.4 gap_uses_max:** bare «Soverom 2» finnes, +1 gir «Soverom 3» (ikke «Soverom 2»).
5. **F3.5 existing_unnamed:** ett soverom med tomt navn finnes, +1 gir «Soverom 2»; det som finnes, er ikke i resultatet og endres ikke.
6. **F3.6 count_beats_names:** tre soverom med tomt navn / fritekst («Hovedsoverom») finnes, +2 gir «Soverom 4», «Soverom 5».
7. **F3.7 high_number:** «Soverom 9» finnes sammen med ett annet soverom, +1 gir «Soverom 10».
8. **F3.8 types_independent:** `bedroom` ×2 og `bathroom` ×1 med «Bad 1» fra før: soverom blir «Soverom 1», «Soverom 2», bad blir «Bad 2»; ett nytt `kitchen` får tomt navn.
9. **F3.9 lookalike_names:** «Soverommet 3», «Soverom 3b», «soverom 7» (små bokstaver, avgjør og noter) og «Soverom  4» teller ikke som nummer; bare formen «<romtypens navn> N» gjør det. Dokumenter valget for store/små bokstaver i testnavnet.
10. **F3.10 unique_property:** egenskapstest med faste frø (ingen ny avhengighet; enkel løkke): for tilfeldige lister av eksisterende navn og utkast er alle ikke-tomme navn i etasjen unike etter nummerering, og antallet nye er lik summen av `count`.
11. **F3.11 order_stable:** utdata følger rekkefølgen i utkastene (romtype for romtype), slik at forhåndsvisningen og lagringen gir samme liste.

## F4. Skjema, `schemas.test.ts` (`addRoomsInputSchema`)

`it.each` med norsk melding (minst `toMatch(/[æøå]|rom/i)` og ingen engelske Zod-standardtekster):

1. **F4.1 valid_manual:** `{ drafts: [{ roomType: "bedroom", count: 2 }], source: "manual" }` godtas.
2. **F4.2 valid_preset:** `source: "preset", presetKey: "apartment"` godtas.
3. **F4.3 unknown_room_type:** `roomType: "ballroom"` avvises. **Arkivert romtype:** `ROOM_TYPES` har i dag ingen arkiverte koder. Hvis utvikleren legger til arkivmerke, skal en arkivert kode avvises i samme test; ellers føres «arkivert» som ikke testbart i rapporten (ikke en mangel).
4. **F4.4 count_bounds:** `count` 0, -1, 21, 1,5 og `"2"` avvises; 1 og 20 godtas.
5. **F4.5 total_max_40:** 40 rom totalt godtas (for eksempel 20 + 20); 41 avvises med meldingen om høyst 40 rom.
6. **F4.6 empty_drafts:** tom liste avvises.
7. **F4.7 duplicate_type:** samme romtype to ganger i listen: avvis eller slå sammen (utvikleren velger, testen låser valget). Summen teller mot 40 uansett.
8. **F4.8 source_closed:** `source` mangler, `"ai_floor_plan"`, `"ai"` og `""` avvises.
9. **F4.9 preset_key_rules:** `preset` uten `presetKey`, med ukjent `presetKey` (`"villa"`) avvises; `manual` med `presetKey` avvises.
10. **F4.10 no_name_field:** et ekstra `name` i utkastet blir ikke med i resultatet (`strict` avviser, eller `strip` fjerner; låses). Klienten kan aldri styre navnet.

## F5. Tjenesten, `buildings.test.ts` (mot testdatabasen)

Nytt `describe("F5 addRooms")`.

1. **F5.1 saves_all:** settet `apartment` i tom etasje gir 7 aktive rom med riktig `roomType`, `organization_id = org A`, `floor_id`, navn etter F3, og returverdien har de samme rommene.
2. **F5.2 area_and_below_ground:** hvert rom har `area_type` lik `suggestAreaType(roomType)` og `below_ground` lik `suggestBelowGround` (sammenlign med `saveRoom` for samme type); settet `basement` i etasje med `below_ground = true` gir `belowGround = true` på alle.
3. **F5.3 numbering_server:** «Soverom 1» og «Soverom 2» finnes; `addRooms` med `bedroom` ×1 gir «Soverom 3». Bare «Soverom 2» finnes gir «Soverom 3».
4. **F5.4 deleted_not_counted:** «Soverom 1» (aktiv) og «Soverom 2» (myk-slettet) finnes; +1 gir «Soverom 2». Det myk-slettede rommet er uendret og fortsatt slettet.
5. **F5.5 existing_untouched:** øyeblikksbilde av eksisterende rom (navn, `updated_at`) før og etter er likt.
6. **F5.6 concurrent_unique_names:** to `addRooms` med `bedroom` ×3 på samme etasje startet med `Promise.all` gir 6 soverom med 6 unike navn «Soverom 1»–«Soverom 6» (`lockFloor`). Kjøres 5 ganger i løkke for å fange flak.
7. **F5.7 other_floor_unaffected:** rom i en annen etasje i samme bygning teller ikke med i nummereringen.
8. **F5.8 audit_per_room:** én `audit_log`-rad `room`/`create` per nytt rom; `changes` har `source` og ved sett `presetKey`; ingen loggrad inneholder romnavnet (søk etter «Soverom» i hele raden som tekst).
9. **F5.9 event_per_room:** én hendelse `assignment.room_saved` per rom, med `organization_id = org A`.
10. **F5.10 no_name_from_client:** et ekstra `name` sendt forbi skjemaet (direkte kall med `as never`) påvirker ikke navnet som lagres.
11. **F5.11 max_from_server:** 41 rom gir valideringsfeil fra tjenesten og 0 nye rader i `rooms`, `audit_log` og `events`.
12. **F5.12 no_delete:** kildesjekk: `addRooms` og `room-presets.ts` inneholder ingen `delete(` eller `DELETE`.

## F6. Tilgang per rolle (`buildings.test.ts`, regel 11 og 12)

1. **F6.1 WRITES:** `addRooms` legges i `WRITES` og `runWrite` (med `{ drafts: [{ roomType: "bedroom", count: 2 }], source: "manual" }`). Da dekker eksisterende `WRITE_MATRIX` automatisk: takstmann med innstillingen på, kontor, leder og admin, med innstillingen på og av, får lagre (4.1.2), takstmann med innstillingen av avvises med `AccessDeniedError` og ingen tabell endres (4.1.2), og takstmann med `assignment.edit` får lagre (4.1.3).
2. **F6.2 events_count:** testen som teller `WRITES.length` hendelser (linje rundt 543) rettes for at `addRooms` med 2 rom gir 2 hendelser. Testen skal ikke svekkes til `toBeGreaterThan`.
3. **F6.3 no_employee_row / no_roles:** 4.1.4 utvides med `addRooms`: bruker uten ansattrad og ansatt uten roller får `AccessDeniedError`, 0 nye rader.
4. **F6.4 admin_never_locked_out:** admin som bare har rollen `admin`, med `access.inspectors_edit_all` av, lagrer et sett (dekkes av F6.1, men skal stå med eget navn i rapporten: «F6.4 admin uten andre roller og med innstillingen av kan bruke addRooms»).
5. **F6.5 inactive_employee:** hvis eksisterende tester har deaktivert eller myk-slettet ansatt for de andre skrivingene, tas `addRooms` med der.

## F7. Tenant-isolasjon (`buildings.test.ts`, regel 2)

1. **F7.1 expectTenantIsolation(addRooms):** nytt kall til `expectTenantIsolation` for `addRooms`. Viser at bruker i organisasjon B verken får tilgang eller får rom inn i A, og at en etasje i B ikke får rader fra A.
2. **F7.2 foreign_floor_id:** bruker i A med `organizationId = A` og etasje-id fra B gir `AccessDeniedError`; 0 nye rader i begge organisasjoner (legges i 4.3.3).
3. **F7.3 org_id_from_grant:** bruker i A som sender `organizationId = B` gir `AccessDeniedError` (tilgangssjekken), ikke databasefeil.
4. **F7.4 unknown_and_invalid_id:** ukjent uuid og ugyldig uuid (`"abc"`, `""`) som etasje-id gir `AccessDeniedError`, aldri databasefeil (legges i 4.3.8).
5. **F7.5 housingType_isolated:** 4.2.1 utvides: eiendommen til oppdraget i B har en annen boligtype enn i A; `getAssignmentBuildings` for A gir As `housingType`, og bruker i B får aldri As. Oppdrag uten eiendom gir `housingType: null`.
6. **F7.6 all_tables:** `tests/tenant-isolation-all-tables.test.ts` grønn uten endring i `tests/tenant-tables.ts` (ingen ny tabell). Endres `tenant-tables.ts`, avvises PR-en med mindre kortet er endret.

## F8. Myk sletting (`buildings.test.ts`, 4.4)

1. **F8.1 deleted_parents:** `DELETED_CASES` (4.4.2) får `addRooms` for myk-slettet etasje, myk-slettet bygning og myk-slettet oppdrag: `AccessDeniedError` og 0 nye rader.
2. **F8.2 deleted_rooms_ignored:** F5.4.

## F9. Eksport og KI-grense (kildesjekk)

1. **F9.1 exports:** `RoomDraft` (type), `RoomPreset` (type), `ROOM_PRESETS`, `ROOM_DRAFT_SOURCES`, `suggestRoomPreset`, `numberRoomDrafts` og `addRooms` kan importeres fra `@/core/buildings`.
2. **F9.2 pure_no_server:** `room-presets.ts` (og filen med `numberRoomDrafts` om den er en annen) importerer ikke fra `@/db`, `drizzle-orm`, `server-only`, `next/*` eller `./service`.
3. **F9.3 no_ai_import:** ingen fil i `src/core/buildings` importerer fra `@/core/ai` eller `src/core/ai`.
4. **F9.4 no_ai_call:** `ai_usage_log` har 0 rader etter F5.1.

## F10. Alt eller ingenting, `buildings-transaction.test.ts`

1. **F10.1 audit_fails_mid:** `failAuditOnce` satt til å feile på rom nr. 3 av 5 (utvid hjelperen med «feil på kall nr. N» om nødvendig): `addRooms` kaster; 0 nye rom, 0 nye loggrader, 0 nye hendelser; eksisterende rom uendret.
2. **F10.2 event_fails_mid:** samme med `failEventOnce` på rom nr. 3.
3. **F10.3 retry_after_fail:** et nytt kall etter feilen lagrer alle 5 rommene med navn som om det første aldri skjedde (ingen hull i numrene).

## F11. Serverhandlingen

1. **F11.1 action_no_access_logic** (`actions-access.test.ts`): «alle sju handlingene gir NO_ACCESS» blir «alle åtte»: takstmann uten skriverett får `NO_ACCESS` fra kjernen også fra den nye handlingen, og ingenting lagres. Kildesjekken som viser at `actions.ts` ikke har egen tilgangslogikk dekker den nye handlingen.
2. **F11.2 action_error_shape** (`actions.test.ts`): 41 rom gir samme feilformat som de andre handlingene, med norsk melding; ugyldig JSON/skjema gir norsk melding, aldri stakk eller 500.
3. **F11.3 action_ok:** gyldig sett gir ok og `revalidatePath` for bygningssiden (som de andre handlingene).

## E. E2e, `e2e/fase-2a-flere-rom.spec.ts` (ny, kjøres i prosjektene `pc` og `ipad`)

Oppsett gjennom eksisterende hjelpere (`logIn`, testoppdrag med eiendom og bygning). Ingen nye hjelpere i `e2e/helpers.ts` uten at de brukes av minst to tester. Ingen `waitForTimeout`.

1. **E1 open_with_suggestion:** leilighet, etasje 1: «Legg til flere rom» åpner dialogen med etasjens navn øverst, og settet «Leilighet» er merket «Foreslått» og står først.
2. **E2 three_taps:** trykk «Leilighet», så «Legg til 7 rom i <etasje>»: dialogen lukkes, 7 rom står i etasjen, og etter ny lasting står de fortsatt (med «Soverom 1», «Soverom 2»). Teller trykkene i testen: åpne + sett + lagre = 3.
3. **E3 counter_up_down:** trykk på flisen «Soverom» to ganger gir 2; «–» gir 1; «–» på 0 er av eller gjør ingenting; hovedknappen viser riktig N hele tiden.
4. **E4 preset_replaces:** velg «Leilighet», øk «Soverom» til 3, trykk «Leilighet» igjen: «Soverom» er tilbake på 2 (erstatter, legger ikke til).
5. **E5 more_types:** «Flere romtyper» folder ut gruppene fra `ROOM_TYPE_GROUPS` med norske gruppenavn; teller på «Garasje» virker og kommer med i listen og lagringen.
6. **E6 basement_suggested:** etasje med under terreng gir «Kjeller eller underetasje» som «Foreslått»; lagrede rom har «Under terreng» avkrysset.
7. **E7 existing_and_numbering:** etasje med «Soverom 1» og «Soverom 2»: dialogen viser «Etasjen har allerede 2 rom»; +1 soverom viser «Soverom 3» i listen før lagring, og «Soverom 3» etter lagring. Forhåndsvisningen er lik det som lagres.
8. **E8 max_20:** 20 trykk på en flis gir 20, og flisen blir av (21. trykk endrer ingenting).
9. **E9 server_max_40:** tre romtyper på 20, 20 og 1 (41): serverens norske melding om høyst 40 rom står i dialogen, dialogen er åpen, og tellerne står igjen (20, 20, 1). Ingen rom er lagret (sjekk etter ny lasting).
10. **E10 no_double_save:** forsink svaret fra serveren (`page.route` på handlingen med kontrollert slipp): hovedknappen er av og viser at den jobber; dobbelttrykk og Enter gir likevel bare 7 rom etter ny lasting.
11. **E11 discard_prompt:** lukk (Lukk-knappen og Escape) med tellere over 0 gir «Forkaste N rom?»; «Fortsett» beholder tellerne; «Forkast» lukker og lagrer ingenting. Lukk med tellere på 0 spør ikke.
12. **E12 no_access_ui:** takstmann uten skriverett (innstillingen av) ser ikke «Legg til flere rom» (jf. 7.7).

**Bare iPad (`test.describe("iPad (prosjektet ipad)")`, stående format):**

13. **E-iPad.1 touch_targets:** fliser minst 56 px høye, «–» og alle andre knapper minst 44 px; avstanden mellom flis og «–» er minst 8 px (måles med `boundingBox`).
14. **E-iPad.2 sticky_main_button:** hovedknappen er synlig i visningsvinduet uten å rulle, også når «Flere romtyper» er åpnet, og er 56–72 px høy.
15. **E-iPad.3 no_horizontal_scroll:** dialogen åpen og «Flere romtyper» utfoldet gir ingen vannrett rulling.
16. **E-iPad.4 keyboard:** dialogen kan brukes med Tab og Enter (fokus fanges i dialogen, Escape gir E11-spørsmålet, fokus går tilbake til knappen som åpnet).

**PC:**

17. **E-PC.1 one_dialog:** siden har høyst én dialog «Legg til flere rom» i DOM-en selv med tre etasjer (jf. T-0058); den åpnes for riktig etasje fra hver etasjes knapp, og rommene havner i den etasjen.

**Uten nett:** ikke med (kortet, «Ikke med»: siden er for PC med nett; befaringsvisningen kommer i 2b). Rapporten noterer det.

## E13. Eksisterende e2e, `e2e/fase-2a-bygninger-areal-rom.spec.ts`

1. **E13.1 optgroup (T-0018):** nedtrekkslisten for ett rom har `optgroup` med gruppenavnene, og alle 33 romtyper står i en gruppe.
2. **E13.2 startRoom_works:** alle eksisterende tester i filen er grønne uten at `startRoom` svekkes (valg skjer fortsatt med `selectOption` på verdi eller etikett).

## Godkjenning (test-leder)

Avvises hvis noe av dette mangler:

- `expectTenantIsolation` for `addRooms` (F7.1) og utvidet 4.2.1 for `housingType` (F7.5).
- `addRooms` i `WRITES`/`WRITE_MATRIX`, deny for takstmann med innstillingen av, uten ansattrad og uten roller (F6).
- Admin uten andre roller og med innstillingen av lagrer (F6.4).
- Alt eller ingenting (F10.1, F10.2) og samtidig lagring (F5.6).
- Myk-slettet etasje, bygning og oppdrag (F8.1).
- E2e grønn i både `pc` og `ipad` (E1–E12, E-iPad.1–4, E-PC.1).

Kjøres til slutt: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. Versjonen i `package.json` er 0.11.0 (kortet).

## Sporing mot akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Dialogen, «Foreslått», «allerede N rom» | E1, E7, F2, F7.5 |
| Sett + lagre gir rom med arealtype og under terreng | E2, E6, F5.1, F5.2 |
| Listen viser navnene slik de lagres | E7, F3.11 |
| Nummerering på serveren, myk-slettede telles ikke, eksisterende endres ikke | F3, F5.3–F5.5 |
| Samtidig lagring gir unike navn | F5.6 |
| Alt eller ingenting | F10 |
| Skjemaet avviser ugyldig inndata med norsk melding | F4 |
| Over 40 i dialogen, tellere står igjen; stopp på 20 | E8, E9, F5.11, F11.2 |
| Ingen dobbel lagring | E10 |
| «Forkaste N rom?» | E11 |
| Revisjonslogg og hendelser per rom | F5.8, F5.9 |
| Tenant-isolasjon | F7 |
| Myk-slettet forelder | F8.1 |
| Rollematrisen | F6, F11.1, E12 |
| Settene: aktive koder, utkast, øyeblikksbilde | F1 |
| T-0018 og `startRoom` | E13 |
| iPad og PC | E1–E12, E-iPad, E-PC |
| Ingen KI, eksport, ingen import fra `src/core/ai` | F9 |
| Versjon 0.11.0 | gjennomlesing |
