# Funksjon: Fire testoppdrag som grunndata

- **Fase:** 2a (Oppdrag og eiendom, siste punkt)
- **Modul:** kjerne (`src/db/seed`)
- **Status:** utkast (avgjort av agentene i autonom modus, A130–A134)
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
  - admin fra `SEED_ADMIN_EMAIL` som ansatt med rollen admin, så admin kan bytte til prøveorganisasjonen
  - to oppdiktede takstmenn med e-post på `@example.invalid`, ansatt i prøveselskapet
- **Fire testoppdrag**, hvert med ordre som er gjort om til oppdrag (med oppdragsnummer fra nummerserien), team (ansvarlig takstmann) og utstedende selskap satt av den vanlige regelen. I tillegg får hvert oppdrag eiendom med matrikkel, boligtype og eierform, bygninger, etasjer, areal per etasje (BRA-i, BRA-e, BRA-b, ALH der det passer, metode og hvem som målte), rom med romtype og «under terreng», og parter (selger, megler, kjøper der det passer):
  1. **Enebolig med garasje:** `detached` / `freehold`. Bolig med to etasjer og kjeller under terreng, og frittstående garasje som egen bygning med BRA-b.
  2. **Leilighet i sameie:** `apartment` / `section`, med seksjonsnummer og fellesdeler.
  3. **Borettslagsleilighet:** `apartment` / `cooperative`, med borettslagets navn og fellesdeler.
  4. **Fritidsbolig:** `holiday_home` / `freehold`. Hytte med hems (ALH) og en bod som egen bygning.
- Status: enebolig er **bestilt**, de tre andre er **under arbeid** (A133). Da viser arbeidskøen mer enn én fane.
- Oppdragene lages **gjennom tjenestene i `src/core`** (ordre, gjør om til oppdrag, team, parter, eiendom, bygninger) med admin som den som utfører. Da gjelder de samme kontrollene, nummerserien, hendelsene og regelen for utstedende selskap som i appen. Bare grunndataene (organisasjon, selskap, kontor, ansatte, roller) legges inn direkte, slik `runSeed` gjør i dag.
- Alt innhold er **oppdiktet**, se «Data» (A132).
- Steget kjøres i utrullingen til **testmiljøet** etter `pnpm db:seed` (`deploy-azure.yml`), og i CI etter `pnpm db:seed`, så vi ser at det virker mot en tom database.
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
| admin (`SEED_ADMIN_EMAIL`) | alt i prøveorg. etter bytte av organisasjon | alt |
| ansatte i Byggcon (ekte org.) | ingenting fra prøveorg. | ingenting |

## Data
- Ingen nye tabeller eller kolonner. Koder som brukes: `HOUSING_TYPES` (`detached`, `apartment`, `holiday_home`), `OWNERSHIP_FORMS` (`freehold`, `section`, `cooperative`), `AREA_TYPES`, `MEASURING_METHODS`, romtypene i `src/core/buildings/codes.ts`, partsrollene og statusene som finnes.
- Innholdet ligger i én datafil (`src/db/seed/sample-assignments.data.ts`), så regeltester og «Prøv malen» kan lese de samme verdiene.
- Oppdiktet innhold (A132):
  - Adresser på gater som ikke finnes, for eksempel `Prøvevegen 1`. Kommunenummer `9999` hvis valideringen tillater det. Ellers brukes en ekte kommune med gnr 9000 eller høyere, som ikke peker på en ekte eiendom.
  - Navn som tydelig er oppdiktet (for eksempel «Kari Prøve», «Ola Testesen»). E-post bare på `@example.invalid`. Ingen telefonnummer, ingen fødselsnummer, ingen ekte firma eller org.nr.
  - Byggeår og areal skal være realistiske, så reglene får noe å virke på senere (for eksempel våtrom fra før 2000 i eneboligen).
- Ordliste (`docs/05-domenemodell.md` avsnitt 8): «Prøveorganisasjon» = organisasjon med `settings.sampleData`, og «Testoppdrag» = sample assignment, `orders.external_ref` med `sample:`.

## Skjermer
Ingen nye. Testoppdragene vises i arbeidskøen, på `/oppdrag/[id]` og `/oppdrag/[id]/bygninger` etter at admin har byttet til prøveorganisasjonen. Antall trykk: 0 for å lage dem, mot 15–20 minutter med inntasting per oppdrag i dag.

## Regler
Ingen nye regler. Testoppdragene er testgrunnlag for reglene som kommer.

## Akseptkriterier
- [ ] `pnpm db:seed:testoppdrag` lager prøveorganisasjonen med fire testoppdrag, med eiendom, matrikkel, bygninger, etasjer, areal, rom og parter som beskrevet (test mot testdatabasen)
- [ ] Andre kjøring gir nøyaktig samme antall rader i alle berørte tabeller og ingen nye hendelser (test)
- [ ] Et testoppdrag som er myk-slettet (kansellert), lages ikke på nytt (test)
- [ ] Steget nekter å skrive i en organisasjon med samme navn uten `settings.sampleData` (test)
- [ ] Byggcons ekte organisasjon får ingen nye rader, og `pnpm db:seed` er uendret (test)
- [ ] Bruker i annen organisasjon får ikke tilgang (test med `expectTenantIsolation`: en ansatt i Byggcon ser ingen testoppdrag i arbeidskøen og får ikke åpne dem)
- [ ] Admin fra `SEED_ADMIN_EMAIL` er admin i prøveorganisasjonen, og admin i Byggcon blir ikke borte (test)
- [ ] Alle e-postadresser i datafilen ender på `@example.invalid`, og ingen felt har fødselsnummer eller telefonnummer (test som leser datafilen)
- [ ] Utstedende selskap og oppdragsnummer er satt av de vanlige reglene (test)
- [ ] Virker på iPad-størrelse (e2e: admin bytter til prøveorganisasjonen, ser fire oppdrag i arbeidskøen og åpner bygningene på eneboligen)
- [ ] CI kjører steget etter `pnpm db:seed`. `deploy-azure.yml` kjører det i testmiljøet.
- [ ] Versjonen økt (patch). Planpunktet krysset av, med bildene som egen linje under bildepunktet. Ordlisten og `docs/personvern/intern-personvernerklaering.md` nevner prøveorganisasjonen.

## Åpne spørsmål
Ingen som stopper oppgaven. Beslutningene A130–A134 står i `docs/09-apne-sporsmal.md` og kan endres av Ståle.
