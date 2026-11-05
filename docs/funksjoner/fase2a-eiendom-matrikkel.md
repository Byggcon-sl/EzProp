# Funksjon: Eiendom og matrikkel på oppdraget

- **Fase:** 2a – Rapporten på PC (punktet «Eiendom og matrikkel lagt inn for hånd, med boligtype og eierform, og fellesdeler for leilighet» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/properties`, ny del av siden `/oppdrag/[id]` i rammen Fjord)
- **Branch:** `fase2a-eiendom-matrikkel` (bygger på `fase2a-oppdrag-team-parter`, ikke merget ennå)
- **Status:** utkast (05.11.2026, prosjektleder)
- **Støtter hovedmål:** Tid: eiendommen fylles ut fra ordren (adresse, gnr, bnr, seksjon, borettslag), så kontoret ikke skriver det samme to ganger; boligtype og eierform velges med ett trykk hver. Reklamasjoner: boligtype og eierform er faste koder som senere styrer hvilke kontrollpunkter som gjelder (leilighet og fellesdeler, svar 25.10.2026 nr. 10), så rapporten ikke mangler fellesdelspunkter eller får punkter som ikke gjelder; fellesdelene (forretningsfører, om det finnes tilstandsrapport og vedlikeholdsplan, hva som er sett) står svart på hvitt. KI først: feltene har samme form som et senere oppslag mot eiendomsdata (`data_source = manual` nå), så en tilkobling eller KI kan fylle dem ut og takstmannen bare kontrollere. Ingen KI og intet oppslag nå.

## Problem
Oppdraget har nummer, team og parter, men ingen eiendom. Adressen og matrikkelen står bare som tekst på ordren (A51). Uten eiendom med boligtype og eierform kan ikke malen senere velge riktige kontrollpunkter, og 60 % av rapportene er leiligheter der eierform og fellesdeler må være med fra start (Ståle 25.10.2026, nr. 10). Bygninger, etasjer og areal (neste planpunkt) trenger en eiendom å henge på.

## KI først
Ikke nå. Kontoret fyller ut eiendommen for hånd, forhåndsutfylt fra ordren. Kroken er `data_source` (`manual` nå) og at matrikkelen er en egen tabell med samme felt som Kartverket og Eiendomsverdi bruker. Når tilkoblingen `property_data` kommer (koster penger og krever konto, ikke nå), kan den eller KI foreslå feltene, og kontoret godkjenner.

## Brukerhistorier
- Som **kontor** vil jeg **legge inn eiendommen på oppdraget, forhåndsutfylt fra ordren**, slik at **jeg bare retter og legger til det som mangler**.
- Som **kontor** vil jeg **velge boligtype og eierform fra faste lister** slik at **rapporten senere får riktige kontrollpunkter**.
- Som **takstmann** vil jeg **fylle ut fellesdelene for en leilighet** (forretningsfører, tilstandsrapport og vedlikeholdsplan for fellesdelene, hva jeg har sett) slik at **det står i rapportgrunnlaget hva som er vurdert**.
- Som **takstmann** vil jeg **se adresse, matrikkel, boligtype og eierform på oppdraget** slik at **jeg vet hva jeg skal befare**.

## Omfang
**Med:**
1. **Tabellen `properties`** (migrering `0015`), enkel utgave av domenemodellen 4.4: `baseColumns`, `address` (påkrevd, høyst 200 tegn), `postal_code` (valgfri, fire sifre), `city` (valgfri, høyst 100 tegn), `municipality_number` (valgfri, fire sifre), `municipality_name` (valgfri, høyst 100 tegn), `housing_type` (påkrevd, fast kode, CHECK: `detached`, `semi_detached`, `terraced`, `apartment`, `apartment_in_house`, `holiday_home`, `farm`, `other`), `ownership_form` (påkrevd, fast kode, CHECK: `freehold`, `section`, `cooperative`, `share`; se A64), `data_source` (påkrevd, standard `manual`, CHECK: `manual`). Unik indeks `(organization_id, id)` som mål for sammensatte fremmednøkler.
2. **Tabellen `cadastral_units`** (samme migrering): `baseColumns`, `property_id` (påkrevd, sammensatt fremmednøkkel `(organization_id, property_id)` → `properties`), `gnr`, `bnr` (påkrevd, 1–5 sifre), `fnr`, `snr` (valgfri, 1–5 sifre), `association_name` (valgfri, høyst 200 tegn; navnet på borettslaget, sameiet eller boligaksjeselskapet), `association_org_number` (valgfri, ni sifre), `share_number` (valgfri, høyst 20 tegn, sifre og bindestrek; andelsnummer eller aksjenummer). Indeks `(organization_id, property_id)`. Tabellen tåler flere rader per eiendom (domenemodellen), men skjermen viser og lagrer én (A65).
3. **Kolonnen `assignments.property_id`** (valgfri, sammensatt fremmednøkkel `(organization_id, property_id)` → `properties`). Ett oppdrag har høyst én eiendom.
4. **Tabellen `common_areas`** (samme migrering), fellesdeler for leilighet, per oppdrag til rapportene finnes (A66): `baseColumns`, `assignment_id` (påkrevd, sammensatt fremmednøkkel → `assignments`), `managing_agent` (valgfri, høyst 200 tegn; forretningsfører), `condition_report_status` og `maintenance_plan_status` (påkrevd, standard `unknown`, CHECK: `yes`, `no`, `unknown`), `notes` (valgfri, høyst 2000 tegn; hva som er sett av fellesdelene, og hvordan). Unik delvis indeks `(organization_id, assignment_id)` der `deleted_at is null`.
5. **Faste koder** i `src/core/properties/codes.ts` (`as const`, endres aldri, regel 6): `HOUSING_TYPES` med `housingTypeLabel` (`Enebolig`, `Tomannsbolig`, `Rekkehus`, `Leilighet`, `Leilighet i tomannsbolig eller flermannsbolig uten sameie`, `Fritidsbolig`, `Våningshus`, `Annet`), `OWNERSHIP_FORMS` med `ownershipFormLabel` (`Selveier`, `Eierseksjon i sameie`, `Andel i borettslag`, `Aksjeleilighet`), `YES_NO_UNKNOWN` (`Ja`, `Nei`, `Vet ikke`). Og den rene funksjonen `hasCommonAreas({ housingType, ownershipForm })`: sann når boligtypen er `apartment`, eller eierformen er `section`, `cooperative` eller `share` (A67).
6. **Skjema** `propertyInputSchema` og `commonAreasInputSchema` i `src/core/properties/schemas.ts` (Zod). Verdiene trimmes, tom tekst blir `null`. Fritekstfeltene (adresse, poststed, kommunenavn, navn på borettslag, forretningsfører, notater) avviser 11 sifre på rad («Fødselsnummer skal ikke lagres her.»), samme mønster som ordren.
7. **Tjenester i `src/core/properties`** (eksportert fra `index.ts`; alle kaller `requireOrganizationAccess` først og filtrerer på `grant.organizationId`; fremmed, ukjent, slettet eller ugyldig oppdrags-id gir `AccessDeniedError`):
   - `getAssignmentProperty(actor, organizationId, assignmentId)`: `organization.read`. Returnerer `property` (feltene i punkt 1 og den ene matrikkelraden, eller `null`), `commonAreas` (eller `null`) og `prefill` når eiendom mangler: `{ address, gnr, bnr, snr, associationName }` fra ordren oppdraget ble laget fra (`address_text`, `gnr`, `bnr`, `snr`, `housing_association_name`), ellers tomme verdier. Adressen deles ikke opp i postnummer og sted (A68).
   - `saveAssignmentProperty(actor, organizationId, assignmentId, input)`: `assignment.edit`. I én transaksjon: lås oppdragsraden (`FOR UPDATE`, `deleted_at is null`). Har oppdraget ingen eiendom: lag `properties` og `cadastral_units` og sett `assignments.property_id`. Har det en: oppdater de to radene. Ingen endring gir ingen hendelse.
   - `saveCommonAreas(actor, organizationId, assignmentId, input)`: `assignment.edit`. Lager eller oppdaterer raden for oppdraget. Krever at oppdraget har en eiendom der `hasCommonAreas` er sann, ellers `CommonAreasNotApplicableError` («Fellesdeler gjelder bare leilighet, eierseksjon, borettslag og aksjeleilighet.»). Endres eiendommen senere slik at `hasCommonAreas` blir usann, blir raden stående (ingen sletting) og vises ikke.
   - **Hendelser og revisjonslogg** i samme transaksjon: `assignment.property_saved` (`data: { propertyId, created }`), `assignment.common_areas_saved` (`data: { commonAreasId, created }`). Revisjonslogg `property`, `cadastral_unit` og `common_areas` med `create`/`update`; `changes` har bare id-er, kodene for boligtype, eierform og ja/nei/vet ikke, og navnene på feltene som ble endret. **Aldri adresse, matrikkelnummer, navn på borettslag, andelsnummer, forretningsfører eller notater** (raden er kilden).
8. **Skjermen `/oppdrag/[id]`** (PC først, må virke i iPad-størrelse):
   - Ny del **«Eiendom»** over «Team». Uten eiendom: skjemaet er forhåndsutfylt fra ordren, med en kort linje «Fylt ut fra ordren. Kontroller før du lagrer.» Felt i denne rekkefølgen: adresse, postnummer, poststed, kommunenummer, kommune, boligtype, eierform, gnr, bnr, fnr, seksjonsnummer, borettslag eller sameie, organisasjonsnummer, andelsnummer eller aksjenummer. Boligtype og eierform er nedtrekkslister uten forhåndsvalg. Knappen «Lagre eiendom». Med eiendom: samme skjema med lagrede verdier. Uten `canEditOrders`: verdiene vises som tekst.
   - Del **«Fellesdeler»** under «Eiendom», bare når `hasCommonAreas` er sann for den lagrede eiendommen: forretningsfører, «Finnes tilstandsrapport for fellesdelene?» og «Finnes vedlikeholdsplan?» (Ja / Nei / Vet ikke), «Hva er sett av fellesdelene, og hvordan» (tekstfelt), knappen «Lagre fellesdeler».
   - Server actions `savePropertyAction` og `saveCommonAreasAction` i `src/app/(ansatt)/oppdrag/[id]/actions.ts`, samme `FormState`, `NO_ACCESS`, `UNKNOWN_ERROR` og loggkontrakt som team og parter (aldri skjemaverdier i loggen). Id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen. Kjent feil: `CommonAreasNotApplicableError`.
   - Feilmeldinger på norsk: «Skriv inn adressen.», «Velg boligtype.», «Velg eierform.», «Skriv inn gårdsnummer.», «Skriv inn bruksnummer.», «Gårdsnummer kan bare ha sifre.» (og tilsvarende for bruks-, feste- og seksjonsnummer), «Postnummeret må ha fire sifre.», «Kommunenummeret må ha fire sifre.», «Organisasjonsnummeret må ha ni sifre.», «Andelsnummeret kan bare ha sifre og bindestrek.», «Fødselsnummer skal ikke lagres her.»
9. **Tester** (testskriver). **Testdata er oppdiktet** («Testveien 1», gnr 999, bnr 999, «Borettslaget Test», organisasjonsnummer `000000000`).
   - **Fabrikker:** `createProperty` (med én matrikkelrad) og `createCommonAreas` i `tests/factories.ts` (tester i `factories.test.ts`); `RESET_TABLES` får de tre tabellene; alle tre i `tests/tenant-tables.ts` med `src/core/properties/properties.test.ts`.
   - **Enhetstester (`codes.test.ts`):** `hasCommonAreas` med testsaker for hver boligtype med `freehold`, og for `section`, `cooperative` og `share` med `detached` og `terraced`. Kodene og etikettene står i fast rekkefølge.
   - **Skjemaene (`schemas.test.ts`):** grenser for hvert felt (200/201, 100/101, 2000/2001 tegn; 1–5 sifre og 6 sifre; postnummer og kommunenummer 3, 4 og 5 sifre; organisasjonsnummer 8, 9 og 10 sifre; andelsnummer 20/21 tegn og bokstaver), trimming, tom tekst blir `null`, ukjent boligtype og eierform, 11 sifre på rad i fritekstfeltene. Alle feilmeldingene i punkt 8.
   - **Database (`src/db/properties-schema.test.ts`):** databasen avviser ukjent boligtype, eierform, `data_source` og ja/nei-kode, matrikkelrad og oppdrag som peker på eiendom i en annen organisasjon, fellesdeler på oppdrag i en annen organisasjon, og to aktive fellesdelsrader for samme oppdrag (en myk-slettet rad sperrer ikke).
   - **Tenant-isolasjon (regel 2):** `expectTenantIsolation` for `getAssignmentProperty`, `saveAssignmentProperty` og `saveCommonAreas`. **IDOR:** A med egen org-id og Bs `assignmentId` gir `AccessDeniedError` i alle tre, og Bs eiendom og fellesdeler er uendret.
   - **Rettigheter:** lese med `organization.read`, skrive med `assignment.edit`, kjørt med `access.inspectors_edit_all` på og av (admin stenges aldri ute, regel 11).
   - **Oppførsel:** første lagring lager eiendom og matrikkelrad og setter `property_id`; andre lagring oppdaterer de samme radene (ingen nye); lagring uten endring gir ingen hendelse; `prefill` kommer fra ordren og er tom for oppdrag uten ordre; `saveCommonAreas` på enebolig med selveier gir `CommonAreasNotApplicableError` og ingen rad; slettet oppdrag gir `AccessDeniedError`.
   - **Hendelser og logg:** i samme transaksjon; hele JSON-en for hendelser og revisjonslogg gjøres om til tekst, og adresse, gnr, bnr, navn på borettslag, andelsnummer, forretningsfører og notater står ikke der.
   - **Handlingene (`actions.test.ts`):** id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen; `CommonAreasNotApplicableError` gir norsk melding; loggeren får aldri skjemaverdier.
   - **E2E i `pc` og `ipad`:** ordre med gnr, bnr og borettslag → gjør om → oppdraget viser «Eiendom» forhåndsutfylt → velg «Leilighet» og «Andel i borettslag» → «Lagre eiendom» → «Fellesdeler» vises → fyll ut og lagre → last siden på nytt, verdiene står. Bytt til «Enebolig» og «Selveier» → «Fellesdeler» er borte.
10. **Dokumenter:** domenemodellen 4.4 og 4.3 får «Bygget i fase 2a» (hva som er med, hva som venter), ordlisten får de nye ordene, planpunktet krysses av, beslutningene A64–A68 føres i `docs/09-apne-sporsmal.md`. Versjon 0.2.72 → 0.2.73 (eller neste ledige ved PR).

**Ikke med (bevisst utelatt):**
- Oppslag mot Kartverket, Eiendomsverdi, PropCloud eller annen eiendomsdata (koster penger og krever konto). Bare for hånd. `overridden_fields`, `latitude` og `longitude` kommer med oppslaget og kartet.
- Søk etter eiendom som finnes fra før, gjenbruk av samme eiendom på flere oppdrag, og dubletter (A65). Hvert oppdrag får sin egen eiendom nå.
- Flere matrikkelrader per eiendom på skjermen (tabellen tåler det).
- `unit_number` (bruksenhetsnummer), `plot_area` (tomteareal) og byggeår. Byggeår og areal hører til bygningene (neste planpunkt).
- Eierform «obligasjonsleilighet» (A64).
- Sameiet eller borettslaget som firma (`association_firm_id`); navnet er tekst til «Kontakter og firma» kommer.
- Oppdeling av ordrens adresse i gate, postnummer og sted (A68). Forslag til eierform ut fra ordren (for eksempel seksjonsnummer gir eierseksjon).
- Kontrollpunkter, regler og malvalg som bruker boligtype og eierform (malmotoren og regelmotoren er egne planpunkter).
- Endring av eiendom på ordren, eller av ordren fra eiendommen (ordren endres ikke etter lagring, A55).
- Nye avhengigheter, ny rettighet.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Ja, alle oppdrag (`organization.read`) | Når `access.inspectors_edit_all` er på (`assignment.edit`); ellers ikke (A20) |
| kontor | Ja | Ja (`assignment.edit`) |
| leder | Ja | Ja |
| admin | Ja | Ja (admin stenges aldri ute) |

Ingen endring i `src/core/access`.

## Data
- Nye tabeller `properties`, `cadastral_units` og `common_areas`, alle med `organization_id`, myk sletting og sammensatte fremmednøkler. Ny kolonne `assignments.property_id`.
- Nye faste koder: `housing_type` (åtte), `ownership_form` (fire), `yes`/`no`/`unknown`, `data_source = manual`. Alle godkjent av Ståle 27.10.2026 (spørsmål 2) eller står i domenemodellen.
- Hendelser `assignment.property_saved`, `assignment.common_areas_saved`; revisjonslogg `property`, `cadastral_unit`, `common_areas`. Ingen adresse, matrikkel eller fritekst i hendelser eller logg.
- Oppdater `docs/05-domenemodell.md` 4.3, 4.4 og ordlisten (`property`, `cadastral_unit`, `common_areas`, `managing_agent`, `association_name`, `share_number`).

## Skjermer
- **PC og iPad.** Ingen ny side. To nye deler på `/oppdrag/[id]`. Hovedhandling: kontroller forhåndsutfylte felt → velg boligtype → velg eierform → «Lagre eiendom» (tre trykk pluss det som mangler). Fellesdeler: tre valg og et tekstfelt → «Lagre fellesdeler».
- iPad-størrelse: én kolonne, knapper minst 44 px. På PC kan skjemaet stå i to kolonner.

## Regler
Ingen fagregler. Dataregel med testsaker: `hasCommonAreas` (punkt 5 og 9). Hvilke kontrollpunkter boligtype og eierform slår på, kommer med regelmotoren.

## Akseptkriterier
- [ ] Kontor kan legge inn og endre eiendommen på oppdraget med adresse, postnummer, sted, kommune, boligtype, eierform, gnr, bnr, fnr, seksjonsnummer, borettslag eller sameie, organisasjonsnummer og andelsnummer.
- [ ] Skjemaet er forhåndsutfylt fra ordren (adresse, gnr, bnr, seksjonsnummer, borettslag) når eiendom mangler.
- [ ] Boligtype og eierform er påkrevd og bare de faste kodene godtas (skjema og database).
- [ ] «Fellesdeler» vises og kan lagres bare for leilighet, eierseksjon, borettslag og aksjeleilighet; kjernen avviser ellers.
- [ ] Hendelser og revisjonslogg skrives i samme transaksjon og inneholder aldri adresse, matrikkel, navn på borettslag, andelsnummer, forretningsfører eller notater.
- [ ] Takstmann ser eiendommen; med `access.inspectors_edit_all` av får takstmann ikke endret (test i kjernen).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for de tre funksjonene; tre tabeller i `tests/tenant-tables.ts`). Fremmed oppdrags-id i egen organisasjon avvises uten endring.
- [ ] Virker på iPad-størrelse (e2e i `pc` og `ipad`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjonen er økt.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` som A64–A68)
- **A64:** Eierform har de fire kodene Ståle godkjente 27.10.2026 (spørsmål 2, innspill D15): selveier, eierseksjon i sameie, andel i borettslag og aksjeleilighet. Obligasjonsleilighet tas ikke med nå, selv om oppgaven nevnte den: den er sjelden, står ikke i Ståles godkjente liste, og en kode kan legges til senere, men aldri endres (regel 6). Kilde: svarene 27.10.2026, domenemodellen 4.4. Endres ved å legge til koden `bond` i CHECK og kodelisten.
- **A65:** Hvert oppdrag får sin egen eiendom nå, uten søk eller gjenbruk, og skjermen viser én matrikkelrad. Domenemodellen sier at eiendommen er felles og brukes igjen; det kommer når søk og oppslag bygges. Rapportene kopierer boligtype og eierform når de startes (domenemodellen 4.5), så en senere endring rører ikke gamle rapporter. Kilde: domenemodellen 4.4, regel 1. Endres ved å legge til søk og koble flere oppdrag til samme `property_id`.
- **A66:** Fellesdelene lagres per oppdrag (`common_areas.assignment_id`) til rapportene finnes; da får tabellen `report_id`. Fellesdelene hører til den enkelte vurderingen, ikke til eiendommen (domenemodellen 4.4: «per rapport»), og i betaen har hvert oppdrag én rapport. Feltene er de fra domenemodellen, uten `association_firm_id`. Kilde: domenemodellen 4.4, svar 25.10.2026 nr. 10. Endres ved å legge til `report_id` når rapporten bygges.
- **A67:** Fellesdeler gjelder når boligtypen er leilighet, eller eierformen er eierseksjon, borettslag eller aksje (også rekkehus i borettslag har fellesdeler). «Leilighet i tomannsbolig uten sameie» med selveier får ikke fellesdeler (domenemodellen: der håndteres fellesdeler annerledes). Kilde: domenemodellen 4.4, svar 25.10.2026 nr. 10. Endres i `hasCommonAreas` med testsakene.
- **A68:** Ordrens adresse fylles inn som én tekst i adressefeltet og deles ikke opp i postnummer og sted. Oppdeling av fritekst kan bli feil, og kontoret kontrollerer uansett. Kilde: A51 (adressen er fritekst på ordren), regel 1. Endres når adressen hentes fra et oppslag.

## Roller
- **utvikler:** migrering og skjema, koder, `schemas.ts`, tjenestene i `src/core/properties`, delene på siden og handlingene, dokumentene og versjonen.
- **testskriver** (i parallell, bare testfiler og fabrikker): punkt 9.
- **sikkerhet-personvern:** gjennomgang før PR: tre nye tabeller med `organization_id` og sammensatte fremmednøkler, ny fremmednøkkel på `assignments`, at adresse og fritekst ikke havner i hendelser, revisjonslogg eller applikasjonslogg, og at ingen id fra skjemaet brukes til filtrering.
- **fagansvarlig** (kort sjekk, ingen tekster): etikettene for boligtype og eierform, spørsmålene om fellesdeler og A64/A67.

Ikke med: arkitekt (ingen ny ADR, følger domenemodellen), ux-ansvarlig og ui-designer (skjemaet følger mønsteret fra team og parter i rammen Fjord), KI.

## Byggingen deles i to biter som ikke henger sammen
1. **utvikler:** `src/db/schema/properties.ts`, `cadastral-units.ts`, `common-areas.ts`, endring i `assignments.ts` (+ `index.ts`, migrering `0015`), `src/core/properties/*` (ikke `*.test.ts`), `src/app/(ansatt)/oppdrag/[id]/*` (ikke `*.test.ts`), `docs/05-domenemodell.md`, `docs/07-utviklingsplan.md`, `docs/09-apne-sporsmal.md`, `package.json`.
2. **testskriver:** `tests/factories.ts`, `tests/factories.test.ts`, `tests/tenant-tables.ts`, `src/core/properties/properties.test.ts`, `src/core/properties/codes.test.ts`, `src/core/properties/schemas.test.ts`, `src/db/properties-schema.test.ts`, `src/app/(ansatt)/oppdrag/[id]/actions.test.ts` (nye handlinger), `e2e/fase-2a-eiendom-matrikkel.spec.ts`.
   Testskriveren skriver mot signaturene i dette kortet. Avviker utvikleren, står det under «Avgjørelser etter gjennomgangen», og prosjektlederen retter testene ved sammenslåingen.
