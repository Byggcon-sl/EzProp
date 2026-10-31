# Funksjon: Sertifisering med utløpsdato

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/organization`, `src/core/access`, adminområdet)
- **Branch:** `fase0b-sertifisering` (bygger på `main`)
- **Status:** utkast (31.10.2026)
- **Støtter hovedmål:** Reklamasjoner: ingen rapport kan publiseres av en ansvarlig uten gyldig sertifisering, og admin ser i god tid hvem som må fornye. Tid: admin slipper å holde oversikt i regneark; fornyelse er én ny rad. KI først: se under.

## Problem
Sertifiseringen er personlig (Ståle 23.10.2026). Bare den som har gyldig sertifisering, kan stå som ansvarlig og signere. I dag finnes ingen sertifiseringer i EzProp, så ingenting hindrer at en rapport utgis av en som har gått ut på dato (funksjonskart H5). En slik rapport gir en svak sak ved reklamasjon. Admin har heller ingen oversikt over hvem som snart må fornye.

## KI først
Ikke nå. Registreringen er noen få felt én gang hvert par år, og sjekken er en ren regel. Senere kan KI lese kopien av beviset (når filtjenesten finnes) og fylle ut område, nummer og datoer, slik at admin bare godkjenner. Det tas ikke med nå, fordi filtjenesten ikke finnes ennå.

## Brukerhistorier
- Som **admin** vil jeg **registrere sertifiseringen til en ansatt med utløpsdato** slik at **EzProp vet hvem som kan publisere**.
- Som **admin** vil jeg **se en liste over hvem som har gått ut eller går ut innen 60 dager** slik at **de rekker å fornye før de trenger å publisere**.
- Som **leder** vil jeg **være trygg på at ingen publiserer uten gyldig sertifisering** slik at **vi ikke får reklamasjoner på det grunnlaget**.

## Omfang
**Med:**
1. **Tabellen `certifications`** (migrering), etter domenemodellen 4.1: `id`, `organization_id`, `employee_id`, `area`, `issuer` (valgfri), `certificate_number` (valgfri), `valid_from` (valgfri, dato), `valid_to` (påkrevd, dato), sporingsfelt og `deleted_at` (myk sletting). Databasen sikrer at den ansatte hører til samme organisasjon (sammensatt fremmednøkkel, samme mønster som selskap og kontor på `employees`), og at `valid_from <= valid_to` når begge er fylt ut.
2. **Område som fast kode** (`area`): én kode nå, `condition_report`, med etiketten «Tilstandsrapport bolig». Listen ligger ett sted i koden. Nye områder legges til som nye koder (regel 6).
3. **Gyldig** betyr: ikke slettet, `valid_from` er tom eller i dag eller tidligere, og `valid_to` er i dag eller senere. Datoen regnes i norsk tid (Europe/Oslo). Utløpsdagen er siste gyldige dag.
4. **Sjekken i `src/core/access`:** når tilgangen regnes ut i `findGrant`, tas `report.publish` bort fra rettighetene hvis personen ikke har minst én gyldig sertifisering. Det gjelder alle roller, også admin og leder, og også når `report.publish` er gitt som enkeltrettighet. Andre rettigheter røres ikke, så **admin stenges aldri ute fra admin** (regel 11). Spørringen filtrerer på organisasjonen fra ansatt-raden. Sjekken av rapporttype per rapport kommer i fase 2a sammen med «ansvarlig» (A19).
5. **Spørringer i `src/core/organization`:** liste sertifiseringer for én ansatt, legge til, fjerne (myk sletting) og listen «går ut snart». Alle kaller `requireOrganizationAccess` først (`organization.manage` for endring og for listen) og filtrerer på `grant.organizationId`. Endringer skrives i revisjonsloggen som de andre adminhandlingene.
6. **Adminskjermen for ansatte** (`/admin/ansatte/[id]`): en seksjon «Sertifiseringer» med listen (område, nummer, utsteder, gyldig til, merket «Utgått» eller «Går ut snart»), et lite skjema «Legg til sertifisering» og knappen «Fjern» per rad (med bekreftelse). Retting av en feil gjøres med «Fjern» og ny registrering. Fornyelse er en ny rad; den gamle blir stående som historikk.
7. **Listen «Sertifiseringer»** (`/admin/sertifiseringer`, ny fane i adminområdet): aktive ansatte der den nyeste sertifiseringen per område har gått ut eller går ut innen 60 dager, sortert på dato (tidligst først). Ansatte som har fornyet, vises ikke. Tom liste viser «Ingen sertifiseringer går ut de neste 60 dagene.»
8. **Testfabrikk** `createCertification` i `tests/factories.ts`, og de eksisterende testene for `report.publish` får en gyldig sertifisering der de trenger rettigheten.
9. Ordlisten (avsnitt 8) og domenemodellen 4.1 oppdateres med det som er bygget. Versjon 0.2.43 → 0.2.44.

**Ikke med (bevisst utelatt):**
- Varsel i arbeidslisten og hendelsen `certification.expiring` (fase 3). Derfor heller ikke feltet `expiry_warned_at`.
- E-post eller annet varsel til den ansatte eller leder.
- Kopi av beviset (`document_file_id`): venter på filtjenesten (samme mønster som A17).
- Innstilling for antall dager (60 og 14). Nå er 60 dager en konstant ett sted; den blir innstilling sammen med varslene i fase 3.
- Sjekk per rapporttype og «ansvarlig på rapporten» (fase 2a, A19), og `certification_id` i utgivelsen.
- Redigering av en sertifisering i skjermen (fjern og legg til på nytt).
- At takstmann eller leder ser sertifiseringene (bare admin nå, A24).
- Krav om sertifisering fra avtaler med oppdragsgiver, og forslag til tildeling (A3).
- Nye avhengigheter.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Nei (ikke i skjerm nå) | Nei |
| kontor | Nei | Nei |
| leder | Nei (adminområdet er bare for admin, A24) | Nei |
| admin | Ja, alle i organisasjonen | Ja: legge til og fjerne |

`report.publish` krever i tillegg gyldig sertifisering, for alle roller.

## Data
- Ny tabell `certifications` (se Omfang 1). Myk sletting, `organization_id` på hver rad.
- Ny fast kode: område `condition_report`.
- Revisjonslogg: `certification.created` og `certification.deleted` (følg mønsteret for handlingsnavn i `src/core/audit`).
- Oppdater `docs/05-domenemodell.md` 4.1 med «Bygget i fase 0b» (hva som venter, og hvorfor).

## Skjermer
- **PC og iPad.** Adminområdet i rammen Fjord, samme skjemadeler som resten av admin (`form-parts.tsx`, `admin-list.tsx`).
- `/admin/ansatte/[id]`: hovedhandling «Legg til sertifisering». Område er forhåndsvalgt (bare ett), så admin fyller bare «Gyldig til» og eventuelt nummer, utsteder og «Gyldig fra». Ett skjema og ett trykk på «Lagre».
- `/admin/sertifiseringer`: bare en liste; hvert navn lenker til den ansatte. Ingen handling på siden.
- Feilmeldinger på norsk: «Velg dato for gyldig til.», «Gyldig fra kan ikke være etter gyldig til.»

## Regler
Ingen fagregler (ikke TG-logikk). Datoregelen (Omfang 3) testes med grensesaker: utløper i dag (gyldig), utløp i går (ugyldig), starter i morgen (ugyldig), 60 dager frem (i listen), 61 dager frem (ikke i listen), fornyet (ikke i listen), slettet (teller ikke).

## Akseptkriterier
- [ ] Admin kan legge til en sertifisering med utløpsdato på en ansatt, og fjerne den igjen (myk sletting, raden står i databasen med `deleted_at`).
- [ ] Endringene står i revisjonsloggen.
- [ ] Takstmann med utgått sertifisering (eller uten sertifisering) får ikke `report.publish`; med gyldig sertifisering får han den. Samme for leder og admin, og for enkeltrettigheten.
- [ ] Admin uten gyldig sertifisering har fortsatt `organization.manage` og `staff.manage`, og kommer inn i adminområdet (test).
- [ ] Grensesakene i «Regler» er dekket av tester, med fast dato i norsk tid.
- [ ] Listen på `/admin/sertifiseringer` viser utgåtte og de som går ut innen 60 dager, ikke de som har fornyet, ikke ansatte som har sluttet, og ikke slettede rader.
- [ ] Takstmann, kontor og leder får ikke åpnet `/admin/sertifiseringer` eller lagret en sertifisering (test i kjernen).
- [ ] Databasen avviser en sertifisering der den ansatte tilhører en annen organisasjon, og der `valid_from` er etter `valid_to`.
- [ ] Bruker i annen organisasjon får ikke tilgang: `expectTenantIsolation` for hver ny spørring som tar `organizationId`.
- [ ] Virker på iPad-størrelse (e2e: admin legger til en sertifisering og ser den i listen, i `pc` og `ipad`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A29:** `report.publish` tas bort i tilgangsmodulen når personen mangler gyldig sertifisering (alle roller, også enkeltrettighet). Begrunnelse: «Bare sertifiserte personer kan stå som ansvarlig og signere» (svar 23.10.2026, nr. 2) og rettighetsmatrisen «Ja (når sertifisert)». Endres i fase 2a når sjekken flyttes til per rapport og rapporttype.
- **A30:** Ett område nå (`condition_report`, «Tilstandsrapport bolig»); sjekken krever en gyldig sertifisering uansett område til flere rapporttyper finnes. Endres ved å legge til koder og sjekke type i fase 2a.
- **A31:** Listen «går ut snart» bruker 60 dager som konstant; innstillingen (60 og 14 dager, Ståle 27.10.2026) og varslene kommer i fase 3. Utløpsdagen er siste gyldige dag, i norsk tid.
- **A32:** Ingen redigering i skjermen; feil rettes med «Fjern» og ny registrering, og fornyelse er ny rad (historikk for reklamasjoner).

## Roller
- **utvikler:** migrering, skjema, spørringer, sjekken i `src/core/access`, skjermene, dokumentene.
- **testskriver** (i parallell): fabrikk, datoregelen, tilgang og tenant-isolasjon, admin stenges ikke ute, e2e.
- **sikkerhet-personvern:** sjekken i tilgangsmodulen og at admin ikke stenges ute.
- **test-leder:** godkjenner testene før PR.

## Åpne spørsmål
- Ingen som stopper oppgaven. Om sertifiseringskravet fra Norsk takst stiller andre krav (sidemannskontroll del 1), tas opp når Ståle er tilbake.
