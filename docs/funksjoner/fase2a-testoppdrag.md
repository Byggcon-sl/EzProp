# Funksjon: Fire testoppdrag som grunndata

- **Fase:** 2a (Oppdrag og eiendom, siste punkt)
- **Modul:** kjerne (`src/db/seed`)
- **Status:** klar til bygging (avgjort av agentene i autonom modus, A130–A134; kortet justert etter forenkler og test-leder 06.11.2026)
- **Støtter hovedmål:** Tid: «Prøv malen», regeltestene og demoene får ferdige oppdrag med en gang. Ingen må skrive inn eiendom, bygninger og rom for hånd før hver prøve. / Reklamasjoner: reglene og malen prøves mot fire ulike boligtyper. Da finner vi feil før en ekte rapport går ut. / KI først: KI-forslagene i senere faser får faste oppdrag å prøve og måles mot. Det er de samme oppdragene hver gang.
- **Branch:** `fase2a-testoppdrag-grunndata` fra `main`
- **Kilde:** innspill P11 (`docs/kartlegging/innspill-datamodell-og-plan-2026-10-25.md`), A57 (prøveorganisasjon), `docs/personvern/sletting-av-betadata.md`

## Problem
Malmotoren, «Prøv malen», regeltestene og demoene trenger oppdrag med eiendom, bygninger, etasjer, areal og rom. I dag finnes ingen slike data, og hver prøve starter med tom database. Hvis vi lar være, lager hver utvikler og hver demo sine egne oppdrag for hånd. Da blir de ulike fra gang til gang, og det tar tid. Det er også fare for at noen bruker en ekte adresse.

## KI først
Dette er grunnlaget for å prøve KI, ikke en KI-funksjon. KI trinn 1–3 (tekstforslag, TG-forslag, kontroll av rapporten) skal prøves og sammenlignes på de samme fire oppdragene. Innholdet skrives fast i repoet og lages ikke av KI. Da er det likt hver gang, og ingen ekte data kan komme med.

## Brukerhistorier
- Som **fagansvarlig** vil jeg åpne et ferdig testoppdrag for hver boligtype, slik at jeg kan prøve malen og reglene uten å skrive inn et oppdrag først.
- Som **utvikler/testskriver** vil jeg ha faste testoppdrag i en egen prøveorganisasjon, slik at regeltester og demoer gir samme resultat hver gang.
- Som **Ståle** vil jeg vise systemet i testmiljøet uten at noen kundeopplysninger vises.

## Omfang
**Med:**
- En **prøveorganisasjon** med navnet `` `${brand.companyName} prøve` `` (A130). Den er merket `settings.sampleData = true` i den eksisterende `settings`-kolonnen, så det trengs ingen migrering. Seed-steget nekter å skrive i en organisasjon som ikke har dette merket.
- Et eget seed-steg `pnpm db:seed:testoppdrag` (`src/db/seed/sample-assignments.ts` med inngang `src/db/seed/sample-index.ts`). Det er trygt å kjøre flere ganger: andre kjøring lager ingen nye rader og endrer ingen. Hvert testoppdrag kjennes igjen på ordren i prøveorganisasjonen med fast `orders.external_ref` (`sample:detached-garage`, `sample:apartment-section`, `sample:apartment-cooperative`, `sample:holiday-home`) (A131).
- Grunndata i prøveorganisasjonen:
  - ett oppdiktet selskap (`Prøveselskap AS`, uten org.nr.) og ett kontor (`Prøvekontor`)
  - admin fra `SEED_ADMIN_EMAIL` som ansatt med rollen admin (han er den som utfører kallene til tjenestene). Appen har ingen organisasjonsvelger, så admin lander fortsatt i Byggcon i appen (A135).
  - én oppdiktet takstmann med e-post på `@example.invalid`, ansatt i prøveselskapet (`company_id` = Prøveselskap AS settes **før** han settes som ansvarlig, ellers blir ikke utstedende selskap satt av regelen, A67). Han er ansvarlig takstmann på alle fire oppdragene, og det er han e2e logger inn som.
- **Fire testoppdrag**, hvert med ordre som er gjort om til oppdrag (med oppdragsnummer fra nummerserien), team (ansvarlig takstmann) og utstedende selskap satt av den vanlige regelen. I tillegg får hvert oppdrag eiendom med matrikkel, boligtype og eierform, bygninger, etasjer, areal per etasje (BRA-i, BRA-e, BRA-b, ALH der det passer, metode og hvem som målte), rom med romtype og «under terreng», og parter (selger, megler, kjøper der det passer):
  1. **Enebolig med garasje:** `detached` / `freehold`. Bolig med to etasjer og kjeller under terreng, og frittstående garasje som egen bygning med BRA-b.
  2. **Leilighet i sameie:** `apartment` / `section`, med seksjonsnummer og fellesdeler.
  3. **Borettslagsleilighet:** `apartment` / `cooperative`, med borettslagets navn og fellesdeler.
  4. **Fritidsbolig:** `holiday_home` / `freehold`. Hytte med hems (ALH) og en bod som egen bygning.
- Status: enebolig er **bestilt**, de tre andre er **under arbeid** (A133). Da viser arbeidskøen mer enn én fane.
- Oppdragene lages **gjennom tjenestene i `src/core`** (ordre, gjør om til oppdrag, team, parter, eiendom, bygninger) med admin som den som utfører. Da gjelder de samme kontrollene, nummerserien, hendelsene og regelen for utstedende selskap som i appen. Bare grunndataene (organisasjon, selskap, kontor, ansatte, roller) legges inn direkte, slik `runSeed` gjør i dag.
- Alt innhold er **oppdiktet**, se «Data» (A132).
- **Oppslag og gjentatt kjøring:**
  - Prøveorganisasjonen finnes på navn **og** merket `settings.sampleData`. Finnes organisasjonen med navnet uten merket, stopper steget uten å skrive noe. Finnes det mer enn én organisasjon med navnet, stopper steget med feilmelding.
  - Oppslaget på `external_ref` filtrerer alltid på id-en til prøveorganisasjonen (regel 2), aldri bare på `external_ref`. Feltet er ikke unikt, og en ordre i Byggcon med samme verdi skal ikke påvirke noe.
  - Oppslaget tar med myk-slettede (kansellerte) oppdrag og avviste ordrer. Finnes ordren i en slik tilstand, hoppes testoppdraget over. Det lages ikke på nytt, og ingenting endres.
  - **Kjøring som stopper halvveis:** tjenestene i `src/core` har hver sin transaksjon, så hele testoppdraget kan ikke ligge i én transaksjon uten å bygge om tjenestene. Steget fortsetter derfor der det stoppet: for hvert testoppdrag sjekkes delene i fast rekkefølge (ordre, gjort om til oppdrag, team, eiendom, bygninger med etasjer, areal og rom, parter). En del som finnes, røres ikke. En del som mangler, lages. Bygninger og parter vurderes samlet: finnes ingen, lages alle; finnes noen, røres de ikke.
  - Andre kjøring kaller ingen tjeneste som skriver. Da brukes ingen nye nummer fra `number_sequences`, og det kommer ingen nye hendelser eller loggrader.
- Steget kjøres i utrullingen til **testmiljøet** etter `pnpm db:seed` (`deploy-azure.yml`), i CI etter `pnpm db:seed` og før `pnpm test:e2e`, og i `start.sh` etter `db:seed` (så e2e virker lokalt hos Ståle og utviklerne).
- Planpunktet krysses av. Bildene står som en egen linje under bildepunktet i planen (A134).

**Ikke med (bevisst utelatt):**
- **Bilder.** Fillagringen finnes, men bildemodellen på kontrollpunkt og rom finnes ikke ennå. Bildene (uten personer, egne bilder eller bilder med fri lisens) legges inn når bildepunktet bygges (A134).
- Fagtekster, TG, avvik, kontrollpunkter, malsvar og regler. De kommer med malmotoren og systemmalen.
- Reklamasjoner, tidsøkter lagt inn for hånd, avtaler med oppdragsgiver, kontakter og firma i kontaktregisteret (partene er fritekst).
- Rydding eller tilbakestilling av prøveorganisasjonen. Det er egen oppgave etter `docs/personvern/sletting-av-betadata.md`, og den rører ikke dette seed-steget.
- Nye skjermer, ny rettighet, nye tabeller, migrering.
- Testoppdrag i Byggcons ekte organisasjon. `pnpm db:seed` endres ikke.
- Kjøring i produksjon.

## Tilgang
Ingen nye rettigheter. Prøveorganisasjonen er en vanlig organisasjon, og tilgangen går gjennom `src/core/access` som før.

| Rolle | Se | Endre |
|---|---|---|
| takstmann (oppdiktet, i prøveorg.) | testoppdragene | som vanlig (`access.inspectors_edit_all`) |
| kontor | finnes ikke i prøveorg. | – |
| leder | finnes ikke i prøveorg. | – |
| admin (`SEED_ADMIN_EMAIL`) | admin i prøveorg., men lander i Byggcon i appen (ingen organisasjonsvelger, A135) | alt i prøveorg. via tjenestene |
| ansatte i Byggcon (ekte org.) | ingenting fra prøveorg. | ingenting |

## Data
- Ingen nye tabeller eller kolonner. Koder som brukes: `HOUSING_TYPES` (`detached`, `apartment`, `holiday_home`), `OWNERSHIP_FORMS` (`freehold`, `section`, `cooperative`), `AREA_TYPES`, `MEASURING_METHODS`, romtypene i `src/core/buildings/codes.ts`, partsrollene og statusene som finnes.
- Innholdet ligger i én datafil (`src/db/seed/sample-assignments.data.ts`), så regeltester og «Prøv malen» kan lese de samme verdiene.
- Oppdiktet innhold (A132):
  - Adresser på gater som ikke finnes, for eksempel `Prøvevegen 1`. Kommunenummer **`9999`** på alle fire. Valideringen (`optionalFixedDigits(4)` i `src/core/properties/schemas.ts`) godtar det, og kommunen finnes ikke, så ingen matrikkel kan treffe en ekte eiendom.
  - Navn som tydelig er oppdiktet (for eksempel «Kari Prøve», «Ola Testesen»). E-post bare på `@example.invalid`. Ingen telefonnummer, ingen fødselsnummer, ingen ekte firma eller org.nr.
  - Byggeår og areal skal være realistiske, så reglene får noe å virke på senere (for eksempel våtrom fra før 2000 i eneboligen).
- Ordliste (`docs/05-domenemodell.md` avsnitt 8): «Prøveorganisasjon» = organisasjon med `settings.sampleData`, og «Testoppdrag» = sample assignment, `orders.external_ref` med `sample:`.
- Personvernerklæringen endres ikke. Prøveorganisasjonen har bare oppdiktede data og ingen personopplysninger.

## Skjermer
Ingen nye. Testoppdragene vises i arbeidskøen, på `/oppdrag/[id]` og `/oppdrag/[id]/bygninger` for prøvetakstmannen (innlogging med kode der `DEV_MAILBOX=1`, altså lokalt og i CI). En organisasjonsvelger eller demobruker for testmiljøet er ført som eget spørsmål (A135), og bygges ikke her. Antall trykk: 0 for å lage dem, mot 15–20 minutter med inntasting per oppdrag i dag.

## Regler
Ingen nye regler. Testoppdragene er testgrunnlag for reglene som kommer.

## Akseptkriterier
- [ ] `pnpm db:seed:testoppdrag` lager prøveorganisasjonen med fire testoppdrag, med eiendom, matrikkel, bygninger, etasjer, areal, rom og parter som beskrevet (test mot testdatabasen)
- [ ] Andre kjøring gir nøyaktig samme antall rader i alle berørte tabeller, ingen nye hendelser eller loggrader, og uendret teller i `number_sequences`. I samme test er ett testoppdrag kansellert før andre kjøring, og det lages ikke på nytt (test)
- [ ] Kjøring som stoppet halvveis (bare ordren finnes) fullføres av neste kjøring, og resultatet har samme antall rader som en ren kjøring (test)
- [ ] Steget nekter å skrive i en organisasjon med samme navn uten `settings.sampleData`, og stopper hvis to organisasjoner har navnet (test)
- [ ] Byggcons ekte organisasjon får ingen nye rader, og `pnpm db:seed` er uendret (test)
- [ ] Bruker i annen organisasjon får ikke tilgang (test med `expectTenantIsolation`: en ansatt i Byggcon ser ingen testoppdrag i arbeidskøen og får nei på `getAssignment`; en ordre i Byggcon med samme `external_ref` blir ikke endret og stopper ikke prøveorganisasjonen)
- [ ] Admin fra `SEED_ADMIN_EMAIL` er admin i prøveorganisasjonen, og admin i Byggcon blir ikke borte, også etter to kjøringer (test)
- [ ] Steget sletter aldri noe og setter aldri `deleted_at` (test)
- [ ] Alle e-postadresser i datafilen ender på `@example.invalid`, ingen felt har fødselsnummer, telefonnummer eller org.nr., kommunenummeret er `9999`, og romtyper og arealtyper finnes i kodelistene (test som leser datafilen)
- [ ] Utstedende selskap og oppdragsnummer er satt av de vanlige reglene (test)
- [ ] Virker på iPad-størrelse (én liten e2e-fil, PC og iPad: prøvetakstmannen logger inn, ser eneboligen under «Bestilt» og de tre andre under «Under arbeid», åpner bygningene på eneboligen og ser bolig og garasje, uten vannrett rulling). Mangler testoppdragene, stopper testen med meldingen «Kjør pnpm db:seed:testoppdrag først», ikke «fant ikke»
- [ ] CI kjører steget etter `pnpm db:seed` og før `pnpm test:e2e`. `deploy-azure.yml` kjører det i testmiljøet etter `db:seed` og før brannmurregelen slettes. `tests/deploy-workflow.test.ts` sjekker de to linjene hver for seg (i dag treffer `findIndex("pnpm db:seed")` også `db:seed:testoppdrag`)
- [ ] `start.sh` kjører steget etter `db:seed` (bash 3.2)
- [ ] Versjonen økt (patch). Planpunktet krysset av, med bildene som egen linje under bildepunktet. Ordlisten nevner prøveorganisasjonen og testoppdrag.

## Avgjort ved uenighet (prosjektleder 06.11.2026)
- **Én takstmann, ikke to** (forenkler). Ingen akseptkriterier trenger to, og arbeidskøen viser fanene uansett. Testplanen bruker én.
- **Kommunenummer 9999** (forenkler og test-leder er enige). Reserveløsningen er strøket.
- **Kansellert testoppdrag:** forenkler ville kutte egen test, test-leder ville ha to (kansellert og avvist). Avgjørelse: én påstand i testen for andre kjøring (ett oppdrag kanselleres før kjøringen). Avvist ordre får ingen egen test: steget gjør alltid om ordren til oppdrag med en gang, og en ordre som er gjort om kan ikke avvises, så tilstanden kan ikke oppstå fra steget. Oppslaget tar likevel med avviste ordrer.
- **Kjøring som stopper halvveis:** test-leder foreslo én transaksjon per testoppdrag. Det krever at tjenestene i `src/core` bygges om til å ta imot en ytre transaksjon, og det er utenfor oppgaven. Avgjørelse: steget fortsetter der det stoppet (se «Oppslag og gjentatt kjøring»), med én test.
- **E2e:** egen liten fil `e2e/fase-2a-testoppdrag.spec.ts` (ingen eksisterende test har prøveorganisasjonen). Bare de to sjekkene over. Sjekken av at Byggcon ikke viser testoppdrag gjøres i integrasjonstesten, ikke i e2e. E2e kjører ikke seed-steget selv; CI og `start.sh` gjør det.
- **Personvernerklæringen** endres ikke (forenkler).
- **Ingen organisasjonsvelger** (test-leder, alvorlig funn). `findEmployeeGrant` velger første organisasjon etter navn, så admin lander i Byggcon. Avgjørelse: e2e logger inn som prøvetakstmannen, og en test låser at admin fortsatt lander i Byggcon. Velger eller demobruker i testmiljøet føres som A135 og bygges ikke her.
- **Seed-steget deles i én funksjon per del** (ordre, omgjøring, team, eiendom, bygninger, parter), så halvveis kjøring er enkel å teste.

## Åpne spørsmål
Ingen som stopper oppgaven. Beslutningene A130–A134 står i `docs/09-apne-sporsmal.md` og kan endres av Ståle.
