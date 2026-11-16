# Testplan: Papirkurv og angre for sletting

- **Oppgavekort:** `docs/funksjoner/fase2a-papirkurv.md`
- **Dato:** 16.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** de ansatte (testene låser at et feiltrykk på «Fjern» rettes med ett trykk på «Angre», på samme plass og med samme verdier, og at en etasje med rom fjernes med ett trykk), KI i bunnen (testene viser at hendelsene har strukturerte felt uten persondata, og at KI-forslag på et gjenopprettet rom eller en etasje står uendret) og færre reklamasjoner (ingen rad slettes permanent, og hver sletting og gjenoppretting står i revisjonsloggen med hvem og når).

Alle Vitest-tester mot databasen går mot `TEST_DATABASE_URL` med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: bygninger «Bolighus test» og «Garasje test», etasjer «1. etasje» og «2. etasje», rom med romtype `bathroom` og navn «Bad test», part «Ola Testmann» med e-post `ola.testmann@example.invalid` og telefon `90000000` (alle oppdiktet). Fast tid: `TEST_NOW` og `vi.useFakeTimers` / `vi.setSystemTime` der tid betyr noe. Ingen KI-kall og ingen nett.

Papirkurven er en PC- og iPad-skjerm med nett. Papirkurv uten nett er bevisst utelatt (fase 2b), så det trengs ingen e2e uten nett. Ingen fagregler; «regeltestene» er slette- og gjenopprettingsreglene (A410, A411, A414, A415, A416, gjentatte kall) skrevet som tabeller med fasit **i testen**, ikke importert fra koden.

## Avtale om signaturer (utvikler og testskriver)

Avvik føres i kortet under «Avgjort av prosjektlederen».

- Fra `@/core/buildings`: `listTrash(actor, organizationId, assignmentId)`, `restoreBuilding(actor, organizationId, buildingId, how)`, `restoreFloor(...)`, `restoreRoom(...)`; fra `@/core/assignments`: `restoreParty(actor, organizationId, partyId, how)`. `how` er `"undo" | "trash"`. (Ligger `listTrash` i en felles fil, skal den likevel bare importeres fra kjernen, aldri fra en annen modul; regel 4.)
- Svaret fra `restore*` har minst `restored: { type, id }[]` (alt som kom tilbake, også overordnet ledd), `changed: boolean` og `notices: string[]` (beskjedene i kortet, faste norske tekster). Radene i svaret har `organizationId`, slik at `expectTenantIsolation` kan sammenligne.
- `listTrash` gir linjer med `type`, `id`, `label`, `path` (bygning › etasje), `groupCount`, `area` (BRA og P-ROM, bare etasjer), `removedAt`, `removedByName`; for parter bare `id`, `role`, `name`, `firmName`.
- `removeBuilding` og `removeFloor` gir `{ removed: { type, id }[] }`, slik at meldingen kan si «2. etasje og 4 rom er fjernet.».
- `BuildingNotEmptyError` og `FloorNotEmptyError` fjernes fra kjernen, skjermen og `actions.ts`.
- Fabrikkene `createBuilding`, `createFloor`, `createFloorArea`, `createRoom`, `createAssignmentParty` tar `deletedAt` og **`deletedBy`** (legges til der det mangler, med test i `tests/factories.test.ts`).
- Ny e2e-hjelper i `e2e/helpers.ts` (bare om den trengs): `trashCountsFor(assignmentId)` som teller fjernede rader direkte i databasen.

## Testfiler

| Kildefil | Testfil | Type |
|---|---|---|
| `src/core/buildings/service.ts` (eller ny `trash.ts`) | `src/core/buildings/trash.test.ts` (ny) | integrasjon |
| samme, samtidighet og tilbakerulling | `src/core/buildings/trash-transaction.test.ts` (ny) | integrasjon |
| `src/core/buildings/service.ts`, ny «Fjern» | `src/core/buildings/buildings.test.ts` (endres: 4.5.3 skrives om) | integrasjon |
| kansellert oppdrag | `src/core/buildings/buildings-cancel.test.ts` (utvides) | integrasjon |
| `src/core/assignments/parties.ts` | `src/core/assignments/party-restore.test.ts` (ny) | integrasjon |
| `src/core/ai/redaction.ts` | `src/core/ai/redaction.test.ts` (utvides) | integrasjon |
| `src/core/events/types.ts` | eksisterende test for hendelsestyper (utvides) | enhet |
| server-handlingene | `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.test.ts` og `actions-access.test.ts` (utvides), `src/app/(ansatt)/oppdrag/[id]/actions.test.ts` (parter) | integrasjon |
| `src/shared/ui/undo-toast.tsx` (navnet avgjøres av utvikler) | `src/shared/ui/undo-toast.test.ts` (ny) | enhet, falske tidtakere |
| skjermen | `e2e/fase-2a-papirkurv.spec.ts` (ny); `e2e/fase-2a-bygninger-areal-rom.spec.ts` 7.4 skrives om | e2e, PC og iPad |

## 1. Regler for sletting og gjenoppretting, `trash.test.ts` (integrasjon, fasit i testen)

1. **A414 «Fjern» etasje tar med innholdet:** etasje med 4 aktive rom og arealrad → én `removeFloor`; etasjen, alle 4 rom og arealraden har **nøyaktig samme** `deleted_at` og `deleted_by`; svaret lister 1 etasje og 4 rom.
2. **A414 «Fjern» bygning tar med innholdet:** bygning med 2 etasjer, 3 rom og 2 arealrader → alt får samme tidspunkt.
3. **A414 rom fjernet før blir liggende:** rom R1 fjernet kl. 10:00, så etasjen kl. 10:05 → `restoreFloor` henter etasjen og rommene fra 10:05, R1 står fortsatt fjernet.
4. **A411 `removeFloor` med ett tidspunkt:** etasje uten rom, med arealrad → etasjen og arealraden har lik `deleted_at` (testen ville vært rød med to `softDelete()`-kall: sett systemtiden til å flytte seg mellom kallene med en falsk klokke som teller opp).
5. **A411 arealraden følger etasjen:** `restoreFloor` → arealraden med samme `deleted_at` er aktiv igjen.
6. **A411 eldre rader, tabell:**
   | arealradens `deleted_at` i forhold til etasjen | `deleted_by` | kommer tilbake |
   |---|---|---|
   | −0,9 s | samme | ja |
   | +0,9 s | samme | ja |
   | −1,1 s | samme | nei |
   | +1,1 s | samme | nei |
   | 0,0 s | annen ansatt | nei |
7. **A411 ny aktiv arealrad finnes:** etasjen har fått en ny aktiv arealrad etter slettingen → `restoreFloor` lykkes, den nye står, den gamle blir liggende fjernet, `notices` har beskjeden; ingen feil fra `floor_areas_active_floor_idx`.
8. **A410 overordnet ledd:** rom i fjernet etasje i fjernet bygning (fjernet hver for seg, ulike tider) → `restoreRoom` henter rommet, etasjen og bygningen; søskenrom og andre etasjer blir liggende; `restored` lister alle tre; `notices` har «Rommet kom tilbake, sammen med etasjen «1. etasje».».
9. **A410 gjennom slettegruppe:** rom i en etasje fjernet som gruppe (A414) → `restoreRoom` på ett rom henter rommet og etasjen, ikke de andre rommene i gruppen.
10. **samme plass, samme verdier, samme id:** for rom, etasje, bygning: `id`, `sort_order`, navn, romtype, arealtype, under terreng, målt av, metode og kommentar er like før sletting og etter gjenoppretting; `deleted_at` og `deleted_by` er `null`, `updated_by` er den som gjenopprettet.
11. **arkiverte koder:** rom med romtype og etasje med etasjeverdi som er arkivert i malen etter slettingen → gjenopprettes uendret, ingen valideringsfeil.
12. **gjentatte kall:** `restoreRoom` to ganger → andre kall gir `changed: false`, samme rad, og antall `events` og `audit_log` er uendret etter andre kall. Gjelder alle fire `restore*` (`it.each`).
13. **gjentatte kall etter tilgang:** et aktivt rom i organisasjon B kalt fra A gir `AccessDeniedError`, ikke `changed: false` (rekkefølgen tilgang → organisasjon → «allerede aktiv»).
14. **`listTrash`:** nyeste først; slettegruppe som én linje med `groupCount` («2. etasje (4 rom)»), og rommene i gruppen kan også hentes enkeltvis; riktig `path` når bygning og etasje også er fjernet; areal for etasjer fra arealraden; `removedByName` også for ansatt med `deleted_at` (sluttet); ingen e-post; ingen rader fra et annet oppdrag i samme organisasjon; høyst 200 linjer (lag 205).
15. **tom papirkurv:** oppdrag uten fjernede rader → tom liste.

## 2. Hendelser, revisjonslogg og varige data

I `trash.test.ts`, med `auditRows(organizationId)` og direkte spørring mot `events`.

1. **én revisjonslinje per rad:** «Fjern» bygning med 1 etasje, 2 rom og 1 arealrad gir 5 linjer med `action: "delete"`; `restoreBuilding` gir 5 linjer med `action: "restore"` og samme `entityType` som slettingen. Slettelinjene er uendret etterpå.
2. **hendelser:** `assignment.*_removed` én for øverste del med `groupCount`; `assignment.*_restored` én for øverste del med `how`, `secondsSinceRemoval` (falsk klokke: 42 s → `42`), `groupCount` og `roomTypeKey`/`floorKey`; pluss én per overordnet ledd etter A410.
3. **nye hendelsestyper finnes:** `assignment.building_restored`, `assignment.floor_restored`, `assignment.room_restored`, `assignment.party_restored` i `src/core/events/types.ts`.
4. **ingen persondata:** etter fjerning og gjenoppretting av part og rom inneholder ingen `events.data` eller `audit_log.changes` «Ola Testmann», e-posten, telefonen, romnavnet «Bad test» eller kommentaren.
5. **ingenting slettes permanent:** tell rader i `buildings`, `floors`, `floor_areas`, `rooms`, `assignment_parties` før og etter en hel runde (fjern, angre, fjern, gjenopprett) → like mange; `audit_log` og `events` bare vokser.
6. **KI-forslag overlever:** `createAiUsageLog` med `target_ref.type` `room` og `floor` som peker på radene → hele raden er lik før og etter fjerning og gjenoppretting, og rommet med samme id viser forslaget igjen.

## 3. Transaksjon og samtidighet, `trash-transaction.test.ts`

1. **tilbakerulling:** feil i hendelsesskrivingen (spion som kaster) midt i `restoreFloor` → etasjen, rommene og arealraden er fortsatt fjernet, ingen ny `audit_log`- eller `events`-rad. Det samme for `removeFloor` med innhold.
2. **to gjenopprettinger samtidig** (`Promise.all`, samme etasje) → begge lykkes eller én får `changed: false`; aldri 500-feil eller ukjent databasefeil; nøyaktig én `floor_restored`-hendelse.
3. **gjenoppretting samtidig med ny arealrad** (`restoreFloor` og `saveFloorArea` på samme etasje i `Promise.all`) → ingen ubehandlet feil fra den unike indeksen; nøyaktig én aktiv arealrad etterpå.

## 4. Tilgang per rolle og avslag (`trash.test.ts`, `party-restore.test.ts`)

`it.each` over `listTrash` og alle fire `restore*`:

| aktør | `listTrash` | `restore*` |
|---|---|---|
| takstmann, `access.inspectors_edit_all` på | ja | ja |
| takstmann, `access.inspectors_edit_all` av | ja | `AccessDeniedError`, ingen endring |
| kontor | ja | ja |
| leder | ja | ja |
| admin (eneste rolle) | ja | ja (regel 11) |
| ansatt med `deleted_at` | `AccessDeniedError` | `AccessDeniedError` |

1. **samme avslag uten lekkasje:** ukjent id, id fra annen organisasjon, ugyldig UUID (`"ikke-en-id"`) og rad på kansellert oppdrag gir alle `AccessDeniedError` med samme melding.
2. **id fra skjema brukes aldri:** `restoreRoom` kalt med `organizationId` fra A men rom-id fra B → avslag; spørringen bruker `grant.organizationId` (test som viser at B-raden er uendret).
3. **ingen tilgangslogikk utenfor kjernen:** eksisterende statisk test for `src/core/access` dekker de nye filene (utvides om den lister filer).

## 5. Tenant-isolasjon

Ett `expectTenantIsolation`-kall per funksjon, i testfilen for funksjonen:

1. `listTrash` (seed: én fjernet rad i hvert oppdrag i A og B; `idOf` = linjens id).
2. `restoreBuilding`, 3. `restoreFloor`, 4. `restoreRoom` (i `trash.test.ts`; `query` lager en fersk fjernet rad og gjenoppretter den, slik at hvert kall har noe å gi tilbake).
5. `restoreParty` (i `party-restore.test.ts`).

`tests/tenant-tables.ts` endres ikke (ingen nye tabeller); `tests/tenant-isolation-all-tables.test.ts` skal være grønn uendret.

## 6. Kansellert oppdrag (A416), `buildings-cancel.test.ts`

1. `listTrash` og alle fire `restore*` på kansellert oppdrag gir `AccessDeniedError` for alle roller, også admin.
2. etter avslaget: ingen endring i radene, ingen nye `audit_log`- eller `events`-rader.
3. det kansellerte oppdraget står aldri i `listTrash` for et annet oppdrag.

## 7. Parter (A415), `party-restore.test.ts`

1. **vanlig gjenoppretting:** part med aktiv kontakt og firma → samme id, rolle, navn og koblinger.
2. **kontakt fjernet:** `contactId` og `firmId` blir `null`, navn og verdier står, `notices` har «Parten kom tilbake, men kontakten den var koblet til, er fjernet.».
3. **firma fjernet:** samme som 2 for firmaet.
4. **sammenslått kontakt:** slå sammen kontakten (eksisterende kjernefunksjon) mens parten er fjernet → parten kommer tilbake med den flyttede koblingen.
5. **kontakt i annen organisasjon** (rad lagt inn direkte) → kobling settes til `null`, aldri til B sin kontakt.
6. **`listTrash` for parter** gir bare id, rolle, navn og firmanavn: test at objektet ikke har nøklene `email`, `phone`, `contactId`, `firmId`.
7. **vasken før KI:** `src/core/ai/redaction.test.ts` får en sak der parten er fjernet; navnet vaskes fortsatt bort.

## 8. Server-handlingene

1. organisasjonen hentes fra sesjonen; skjemafelt `organizationId` ignoreres (som eksisterende `actions-access.test.ts`).
2. `AccessDeniedError` blir den faste norske feilteksten, ingen stakk eller id i svaret.
3. `BuildingNotEmptyError`/`FloorNotEmptyError` er borte fra `actions.ts`; testene 382–383 og 430–431 i `actions.test.ts` fjernes eller skrives om.
4. revalidering av `/oppdrag/[id]/bygninger` og oppdragssiden etter `restore*`.

## 9. Angre-meldingen, `src/shared/ui/undo-toast.test.ts` (enhet, falske tidtakere)

1. vises med teksten «Rommet «Bad» er fjernet.», knappen «Angre» og «Du finner det også i papirkurven.».
2. lukkes etter 10 000 ms, ikke ved 9 999 ms.
3. hover og fokus stopper tiden; tiden går videre fra der den stoppet når de forsvinner.
4. ny sletting erstatter meldingen, «Angre» gjelder bare den nye, og teksten «Mer i papirkurven» vises; aldri to meldinger.
5. Cmd+Z og Ctrl+Z utløser «Angre»; ikke når fokus står i `input`, `textarea` eller `contenteditable`.
6. feil fra handlingen → meldingen står, viser «Fikk ikke hentet tilbake rommet. Prøv igjen, eller bruk papirkurven.» og ny «Angre»; ingenting markeres som gjenopprettet før svaret.
7. `role="status"`; lukkeknapp med tilgjengelig navn.
8. ingen lagring: `localStorage` og `sessionStorage` er tomme etterpå, og loggeren er ikke kalt med navn.
9. ingen ny avhengighet i `package.json`.

## 10. E2E, `e2e/fase-2a-papirkurv.spec.ts` (PC 1440×900 og iPad Pro 1024×1366, begge prosjektene)

Bruk Playwrights klokke (`page.clock`) for de 10 sekundene, aldri `waitForTimeout`.

1. **rom:** «Fjern» → melding → «Angre» → rommet står på samme plass (samme rekkefølge i lista), fokus på rommet, uthevet rad.
2. **etasje med rom:** ett trykk på «Fjern» → «2. etasje og 4 rom er fjernet.» → «Angre» → etasjen med alle rom tilbake. (Erstatter 7.4 i `fase-2a-bygninger-areal-rom.spec.ts`, som skrives om fra «Fjern rommene først.» til ett trykk.)
3. **bygning med innhold:** «Fjern» → «Angre» → alt tilbake.
4. **part:** «Fjern» på partkortet → «Angre» → kortet tilbake.
5. **meldingen overlever revalidering** etter server-handlingen (står fortsatt etter at siden er oppdatert).
6. **tiden:** `page.clock.runFor(9_999)` → synlig; `runFor(1)` → borte; hover stopper tiden (PC).
7. **ny sletting erstatter:** to «Fjern» etter hverandre → én melding, «Mer i papirkurven».
8. **papirkurven:** «Papirkurv (n)» er lukket, åpnes med tastatur; linjen viser hva, hvor, areal, hvem og «i dag HH:MM»; «Gjenopprett» → raden er borte fra lista og står i rapporten med fokus og rulling (iPad); tom papirkurv vises ikke.
9. **A410 på skjermen:** rom i fjernet etasje → «Gjenopprett» → beskjeden om etasjen.
10. **Cmd/Ctrl+Z** utløser «Angre» på PC, ikke når fokus er i et tekstfelt.
11. **feil:** avbryt server-handlingen med `page.route` → feilteksten og ny «Angre»; rommet vises ikke som gjenopprettet.
12. **tilgang:** takstmann med `setInspectorsEditAll(false)` ser papirkurven uten «Gjenopprett» (og uten «Fjern»); innstillingen settes tilbake med `restoreInspectorsEditAll`.
13. **størrelser:** «Fjern», «Gjenopprett» og lukkeknappen minst 44 px; «Angre» minst 56 px på iPad (`expectAtLeast44` og tilsvarende for 56).
14. **meldingen dekker ikke hovedknappene** festet nederst (bounding box overlapper ikke), på begge størrelser.
15. **skjermleser:** meldingen har `role="status"`; alle knapper har navn; tab-rekkefølge når «Angre» og ×.
16. **`prefers-reduced-motion: reduce`:** ingen animasjon på uthevingen (beregnet `transition-duration`/`animation-name`).
17. **ingen persondata i nettleserlagring:** etter fjerning av part er `localStorage` og `sessionStorage` uten partnavnet, og adressen har ingen id eller navn fra meldingen.

## 11. Statiske sjekker og felles

1. `pnpm lint` grønn: ingen import mellom moduler; produktnavnet bare i `brand.ts`.
2. `pnpm typecheck` grønn.
3. versjonen i `package.json` er økt.
4. ordlisten har `trash`, `restore`, `removal group`; A410–A418 står i `docs/09-apne-sporsmal.md`; tillegget står i `docs/plan/forbedrerens-tillegg.md`.
5. ingen filer fra brancher i arbeid er endret (tilbud/ordre, badmalen, avvikskortene, innloggingen): `git diff --stat origin/main` sjekkes ved gjennomgangen.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| «Fjern» og «Angre» på rom, etasje, bygning og part | 1.10, 10.1–10.4 |
| slettegruppe med ett tidspunkt (A414) | 1.1–1.4, 10.2–10.3 |
| papirkurvens innhold og «Gjenopprett» | 1.14–1.15, 10.8 |
| overordnet ledd (A410) | 1.8–1.9, 10.9 |
| arealraden (A411) | 1.4–1.7, 3.3 |
| part med fjernet kontakt (A415) | 7.1–7.6 |
| arkiverte koder | 1.11 |
| gjentatte kall | 1.12–1.13, 3.2 |
| kansellert oppdrag og takstmann uten endringsrett (A416) | 4, 6, 10.12 |
| revisjonslogg og hendelser uten persondata | 2.1–2.4 |
| KI-forslag overlever | 2.6 |
| ingenting slettes permanent | 2.5 |
| tenant-isolasjon | 5.1–5.5 |
| tastatur, skjermleser, Cmd/Ctrl+Z, revalidering, feil, iPad | 9, 10.5–10.17 |
| admin stenges aldri ute | 4 (admin som eneste rolle), 6.1 (avslag også for admin bare på kansellert oppdrag, som i dag) |

Test-leder avviser PR-en hvis noen av 4, 5 eller 6 mangler.
