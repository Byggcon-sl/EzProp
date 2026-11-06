# Funksjon: Reklamasjoner med enkelt skjema

- **Fase:** 2a – Rapporten på PC (punktet «Reklamasjoner med enkelt skjema fra første ekte rapport» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/claims`, delen «Reklamasjoner» på `/oppdrag/[id]` og sidene under `/oppdrag/[id]/reklamasjoner`)
- **Branch:** `fase2a-reklamasjoner` (bygger på `main`)
- **Status:** klar til bygging (06.11.2026, prosjektleder)
- **Dato:** 06.11.2026
- **Støtter hovedmål:** Reklamasjoner (hovedsaken): uten registrerte saker kan vi aldri vise at reklamasjonene er halvert. Hver sak lagres på oppdraget med dato, utfall og beløp fra første ekte rapport, så tallet «reklamasjoner per 100 leverte rapporter» kan regnes ut senere og sammenlignes med nullpunktet. Tid: skjemaet har bare fem felt som må fylles, og ligger på oppdraget, så leder slipper egne regneark. KI først: se under.

## Problem
Byggcon har i dag ingen fast plass å føre reklamasjoner. Ståle bestemte 27.10.2026 (spørsmål 4) at de skal registreres med et enkelt skjema fra første ekte rapport, og at bare leder og admin ser dem. Lar vi være, mangler vi tallene for hovedmål 2, og saker fra betaperioden går tapt før reklamasjonsmappen kommer i fase 4.

## KI først
Ikke KI nå. Det er for få saker til at KI har noe å lære av, og en reklamasjon er en juridisk sak som leder fører selv. Denne oppgaven lager grunnlaget KI skal bruke senere: når kontrollpunktene finnes, kobles sakene til punktet, og KI kan da varsle om risikopunkter før publisering (robusthetsråd, S2 i fase 4) og foreslå hvilket punkt en ny sak gjelder ut fra beskrivelsen.

## Brukerhistorier
- Som **leder** vil jeg **registrere en reklamasjon på oppdraget den gjelder** slik at **saken ikke går tapt og kan telles**.
- Som **leder** vil jeg **lukke saken med utfall og eventuelt beløp** slik at **vi ser hva sakene endte med**.
- Som **takstmann** skal jeg **ikke se reklamasjonssakene** (Ståle 27.10.2026).

## Omfang
**Med:**
1. **Ny tabell `claims`** (migrering `0023_reklamasjoner`), knyttet til oppdraget. Feltene står under «Data». Myk sletting med `deleted_at`.
2. **Ny rettighet `claims.manage`** (registrere, endre, lukke og fjerne reklamasjonssaker) i `src/core/access/permissions.ts`. Leder og admin har den. Den gis ikke av innstillingen `access.inspectors_edit_all` og kan ikke gis som enkeltrettighet (står ikke i `grantablePermissions`). Lesing bruker den eksisterende `claims.read`.
3. **Tjenester i `src/core/claims`:**
   - `listClaimsForAssignment(actor, organizationId, assignmentId)` – `claims.read`.
   - `getClaim(actor, organizationId, claimId)` – `claims.read`.
   - `createClaim(actor, organizationId, assignmentId, input)` – `claims.manage`. Lagrer hendelsen `claim.registered` (finnes alt i `src/core/events/types.ts`).
   - `updateClaim(actor, organizationId, claimId, input)` – `claims.manage`. Lukking er en vanlig endring der utfallet settes til noe annet enn «åpen»; da settes `closed_at` på serveren. Åpnes saken igjen, nullstilles `closed_at`.
   - `removeClaim(actor, organizationId, claimId)` – `claims.manage`, myk sletting.
   - Alle spørringer filtrerer på `grant.organizationId`. Oppdraget sjekkes mot samme organisasjon før en sak lagres på det. Zod-skjema i `schemas.ts`.
   - **Fjernet oppdrag** (`deleted_at` satt): `createClaim` og `listClaimsForAssignment` gir begge «finnes ikke», samme svar som for et oppdrag i en annen organisasjon. Ett svar for begge er enklest å teste og avslører ingenting.
4. **Revisjonsloggen** får bare handling og **feltnavn**, aldri innholdet i `claimant_text`, `description` eller `building_part_text` (kan inneholde navn og helseopplysninger). Hendelsen `claim.registered` får bare `claimId`, `assignmentId`, `claimType` og `receivedAt`.
5. **Skjermer** (se under), bare for den som har `claims.read`; endringsknappene bare for `claims.manage`. Hvem som ser hva, avgjøres i `src/core/access`, ikke i sidene.
6. **Personvernerklæringen** (`docs/personvern/intern-personvernerklaering.md`) får tabellen `claims`, og `tests/tenant-tables.ts` får tabellen.
7. **Domenemodellen** avsnitt 4.13 oppdateres med det som faktisk bygges nå (oppdraget i stedet for rapporten, fritekst for punktet, klager), og ordlisten får de nye ordene.

**Ikke med (bevisst utelatt):**
- Reklamasjonsmappen med alt om saken samlet (H6, fase 4), intern avviksregistrering (fase 4) og robusthetsråd før publisering (S2).
- Visning av tallet «reklamasjoner per 100 leverte rapporter». Tallet kan regnes fra tabellen senere; rapporter og utgivelser finnes ikke ennå.
- Kobling til rapport, utgivelse, kontrollpunkt (`checkpoint_key`) og avvik. Tabellene finnes ikke ennå. Bygningsdelen skrives som fritekst foreløpig.
- Egen liste over alle reklamasjoner i organisasjonen (kommer med mappen i fase 4). Leder finner sakene på oppdraget.
- Vedlegg og bilder på saken, ansvarlig internt (`handled_by`), varsler og e-post.
- `cost_observations` (krok S3).
- KI.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | nei (heller ikke med `access.inspectors_edit_all`) | nei |
| kontor | nei | nei |
| leder | ja (`claims.read`) | ja (`claims.manage`) |
| admin | ja | ja (admin har alltid alle rettigheter) |

En takstmann som åpner adressen til en sak direkte, får «finnes ikke» (samme svar som for en sak i en annen organisasjon), så det ikke kan avsløres at saken finnes.

## Data
Ny tabell **`claims`** (`organization_id`, `created_at`, `updated_at`, `deleted_at` som de andre):

| Felt | Type | Forklaring |
|---|---|---|
| `assignment_id` | uuid, påkrevd | Oppdraget saken gjelder. Erstatter `report_id` fram til rapportene finnes. |
| `claim_type` | enum, påkrevd | `complaint` (reklamasjon), `insurance_claim` (forsikringskrav), `other` (annet). `internal` legges til i fase 4. |
| `received_at` | dato, påkrevd | Når kravet kom. Ikke fram i tid. |
| `claimant_party_id` | uuid, valgfri | En part på oppdraget (`assignment_parties`), samme oppdrag og organisasjon |
| `claimant_text` | tekst, valgfri (høyst 200 tegn) | Hvem som klaget, når det ikke er en part. Enten part eller fritekst må fylles. |
| `description` | tekst, påkrevd (1–2 000 tegn) | Hva som påstås, kort |
| `building_part_text` | tekst, valgfri (høyst 200 tegn) | Kontrollpunkt eller bygningsdel, fritekst foreløpig |
| `outcome` | enum, påkrevd, standard `open` | `open` (åpen), `rejected` (avvist), `upheld` (medhold), `settled` (forlik), `withdrawn` (trukket). Status «åpen» eller «lukket» leses av utfallet. |
| `amount` | heltall kroner, valgfri | Beløp ved medhold eller forlik. Bare lov når utfallet er `upheld` eller `settled`. |
| `closed_at` | tidspunkt, valgfri | Settes av serveren når utfallet går fra `open` |
| `created_by` | uuid | Den ansatte som registrerte saken |

Ingen nye faste koder (`key`) utover enum-verdiene over, som aldri endres (regel 6).

## Skjermer
PC og iPad-størrelse, Fjord-designet.
- **`/oppdrag/[id]`:** ny del «Reklamasjoner» nederst, bare synlig med `claims.read`. Liste med dato, type, kort beskrivelse og merke «Åpen» eller «Lukket (utfall)». Knappen «Registrer reklamasjon» med `claims.manage`.
- **`/oppdrag/[id]/reklamasjoner/ny`:** skjemaet. Hovedhandling «Lagre». Velg part fra oppdraget eller skriv hvem. Dato er satt til i dag. Fire trykk pluss beskrivelsen.
- **`/oppdrag/[id]/reklamasjoner/[claimId]`:** samme skjema for endring, med utfall og beløp. Knappen «Fjern» med bekreftelse.
- Hjelpeteksten under beskrivelsen: «Skriv kort hva som påstås. Ikke skriv fødselsnummer eller helseopplysninger.»
- Sidene trenger ikke virke uten nett. Dette er lederarbeid på PC, ikke befaring.

## Regler
Valideringsregler i Zod, med testsaker:
- Enten `claimant_party_id` eller `claimant_text` må være satt.
- `received_at` kan ikke være fram i tid.
- `amount` bare når utfallet er `upheld` eller `settled`; heltall, 0 eller mer.
- `received_at` måles mot dagens dato i Europe/Oslo. I dag er lov, i morgen er ikke lov. Testene setter tiden med `TEST_NOW`.
- `closed_at` settes av serveren når utfallet går fra `open`, og nullstilles når det går tilbake til `open`. En `closed_at` fra klienten ignoreres.
- **Gjenåpning:** settes utfallet tilbake til `open` mens `amount` er fylt, **avvises** endringen (samme regel som over, `amount_only_upheld_or_settled`). Skjemaet tømmer og skjuler beløpsfeltet når «Åpen» velges, så leder merker det ikke. Begrunnelse: én regel i stedet for to, og serveren endrer aldri et beløp i stillhet.
- Parten må høre til samme oppdrag og samme organisasjon, og kan ikke være fjernet (`deleted_at` satt). Gjelder både ved registrering og ved endring.
- `created_by` er den som utfører handlingen, aldri en verdi fra skjemaet.

## Akseptkriterier
- [ ] Leder og admin kan registrere, endre, lukke og fjerne en reklamasjonssak på et oppdrag (test og e2e).
- [ ] Takstmann og kontor ser verken delen, listen eller sidene, også med `access.inspectors_edit_all` på (test og e2e).
- [ ] `claims.manage` kan ikke gis som enkeltrettighet, og påvirkes ikke av innstillingen (test).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for alle tjenestene, og tabellen i `tests/tenant-tables.ts`).
- [ ] En part fra et annet oppdrag, en annen organisasjon eller en fjernet part kan ikke velges som klager, verken ved registrering eller endring (test).
- [ ] Et fjernet oppdrag gir «finnes ikke» ved registrering og liste (test).
- [ ] Fjernede saker vises ikke, men raden står i databasen med `deleted_at` (test).
- [ ] Revisjonsloggen og hendelsen inneholder ikke beskrivelsen, klageren eller bygningsdelen (test).
- [ ] Valideringsreglene over har testsaker, også gjenåpning med beløp og datogrensen i Europe/Oslo.
- [ ] Virker på iPad-størrelse (e2e).
- [ ] Versjonen i `package.json` økes, personvernerklæringen, domenemodellen og ordlisten er oppdatert.

## Beslutninger tatt av agentene (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A125:** Saken knyttes til oppdraget (`assignment_id`) fordi rapporter og utgivelser ikke finnes ennå. `report_id` og `release_id` legges til når de finnes. Kilde: domenemodellen 4.13, planen fase 2a. Kan endres med en ny kolonne og en flytting av data.
- **A126:** Ny rettighet `claims.manage` for å registrere og endre, ved siden av `claims.read` for å se. Bare leder og admin, kan ikke gis som enkeltrettighet. Kilde: Ståle 27.10.2026 (bare leder og admin ser reklamasjonssaker). Kan endres ved å legge den i `grantablePermissions`.
- **A127:** Status «åpen/lukket» leses av utfallet (`outcome = open` er åpen) i stedet for et eget statusfelt, slik domenemodellen allerede har det. Det er ett felt mindre å holde i takt. Kilde: domenemodellen 4.13.
- **A128:** Bygningsdel eller kontrollpunkt er fritekst nå; kobling til `checkpoint_key` kommer når malmotoren finnes. Typen `internal` venter til fase 4. Kilde: planen fase 2a og fase 4 (H6).
- **A129:** Beløp er med (valgfritt, bare ved medhold eller forlik), fordi hovedmålet måles både i antall og beløp. Kilde: utviklingsplanen, «Reklamasjoner: antall … og beløp».

## Testplan (test-leder, runde 1, 06.11.2026)
Testfiler: `src/core/claims/schemas.test.ts`, `src/core/claims/claims.test.ts`, `src/core/access/*.test.ts`, `e2e/claims.spec.ts`. Fellestester: `tests/tenant-tables.ts` (`claims` med radbygger), `tests/factories.ts` (`createClaim`, `claims` i `RESET_TABLES`).
- **Regler som data:** `claimant_required`, `received_at_not_future`, `amount_only_upheld_or_settled` (negativt og desimal avvist, 0 lov), `text_limits` (beskrivelse 0 og 2001 tegn, klager og bygningsdel 201 tegn avvist), `no_national_id` (elleve sifre på rad i fritekstene avvist, lagt til i sikkerhetsgjennomgangen 06.11.2026), `enum_values`.
- **Rettigheter:** rolletabellene får `claims.manage`. Takstmann har verken `claims.read` eller `claims.manage`, med innstillingen på og av. Enkeltrettighet i `employee_permissions` ignoreres. Uten gyldig sertifisering tas bare `report.publish` bort. Admin har alltid begge.
- **Integrasjon:** full livssyklus for leder og admin; takstmann (innstilling på og av) og kontor får «finnes ikke» på alle fem tjenestene; `expectTenantIsolation` for `list`, `get`, `create`, `update`, `remove`; `closed_at`, myk sletting, revisjonsloggen uten de oppdiktede fritekstene, nøklene i `claim.registered`, `created_by`.
- **E2e (PC og iPad):** leder registrerer, lukker med utfall og beløp, fjerner; merket går fra «Åpen» til «Lukket (utfall)». Takstmann og kontor ser ikke delen og får «finnes ikke» på direkte adresser. Hjelpeteksten vises.
- **Ikke testet nå (bevisst):** telling per 100 rapporter og kobling til rapport eller kontrollpunkt.
- **Krav før godkjenning:** tilgangstester per rolle med innstillingen på og av, `expectTenantIsolation` for alle fem tjenestene, og testen som viser at revisjonsloggen ikke inneholder klager, beskrivelse eller bygningsdel.

## Roller
- **utvikler** og **testskriver** i parallell. Bitene henger ikke sammen: (1) migrering, rettighet og tjenester i `src/core/claims`; (2) sidene og delen på oppdragssiden. Testskriveren skriver tilgang, tenant-isolasjon, valideringsregler og e2e mot kortet.
- **sikkerhet-personvern:** ny rettighet som er unntak fra «alle ser alt», fritekst som kan inneholde personopplysninger, revisjonsloggen og personvernerklæringen.
- **test-leder:** gjennomgang før merge.

## Åpne spørsmål
- Ingen som stopper oppgaven. Hvem som skal kunne se reklamasjonsmappen i fase 4, og om takstmannen skal få vite om en sak på egne rapporter, tas når mappen bygges.
