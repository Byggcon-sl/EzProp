# Funksjon: «Nytt oppdrag» er hovedveien

- **Fase:** 2a – Rapporten på PC, delen «Prioritert av Ståle 13.11.2026: rett på oppdrag, tilbud ved behov», første punkt
- **Modul:** kjerne (`src/core/assignments`, `src/core/orders` for gjenbruk av regler, `src/core/ai` bare for listen over felt som aldri sendes), sidene `/oppdrag/ny`, `/oppdrag/[id]`, `/arbeidskoe` og menyen i `(ansatt)/layout.tsx`
- **Branch:** `nytt-oppdrag-hovedvei` (bygger på `main`, 14.11.2026)
- **Status:** utkast (14.11.2026, prosjektleder). Versjon: øk minor i `package.json` (sjekk `main` ved start).
- **Kilde:** Ståle i chat 13.11.2026: «Det er svært sjelden vi oppretter ordre, men stort sett går vi rett på oppdrag. Jeg ønsker at vi i utgangspunktet skal gå rett på oppdrag, men ha mulighet for å opprette ett tilbud.»
- **Støtter hovedmål:**
  - **De ansatte:** ett skjema og ett trykk på «Lagre» gir et oppdrag. I dag må kontoret lage ordre, åpne den, velge kontor og trykke «Gjør om til oppdrag» (rundt 6–8 trykk mer og en ekstra side). 98–99 av 100 oppdrag går denne veien.
  - **KI i bunnen:** bestillingsopplysningene lagres strukturert på oppdraget med kilde (`manual`), slik at KI senere kan fylle det samme skjemaet som forslag (e-post til oppdrag, krok A1) uten ombygging.
  - **Færre reklamasjoner:** dublettvarselet virker på oppdraget, slik at samme eiendom ikke takseres to ganger ved en feil, og riktig adresse og matrikkel står fra start.

## Problem
I dag lages et oppdrag bare ved å gjøre om en ordre. Ståle sier at ordre nesten aldri brukes i praksis. Mellomsteget koster tid, gir dobbel registrering og en liste («Ordre») som ikke speiler arbeidsdagen. Lar vi være, må kontoret fortsette med to steg for hvert oppdrag, og neste punkt (Tilbud) får ingen hovedvei å vise til.

## KI i bunnen
- **Ingen nytt KI-kall i denne oppgaven.** Skjemaet er raskt å fylle for hånd, og dublettvarselet er en fast regel uten KI (Ståle 12.11.2026, T3). KI setter aldri noe på oppdraget selv.
- **Data for KI senere:** bestillingsopplysningene lagres som egne felt med kilde (`source`, nå bare `manual`). Når e-post til oppdrag kommer (krok A1), lager KI et forslag til akkurat disse feltene gjennom `src/core/ai`, og den ansatte godtar, endrer eller avviser i det samme skjemaet. Revisjonsloggen får feltkodene ved endring, slik at treffprosent per felt kan regnes ut uten å lese verdiene.
- **Vern:** nye kolonner med adresse, matrikkel og bestiller føres i `src/core/ai/never-fields.ts` og i vasken (`redaction.ts`), slik at de aldri sendes til KI (regel 14). Test som viser det.

## Brukerhistorier
- Som **kontor** vil jeg **trykke «Nytt oppdrag» i arbeidskøen og fylle ett skjema** slik at **oppdraget står i køen som «Bestilt» med én gang**.
- Som **takstmann** vil jeg **lage et oppdrag selv med meg som ansvarlig og befaringstid** slik at **jeg slipper å gå via kontoret**.
- Som **kontor** vil jeg **få varsel om et mulig dobbelt oppdrag på samme adresse eller matrikkel** slik at **vi ikke takserer samme bolig to ganger**.
- Som **leder** vil jeg **rette adresse eller bestiller etter lagring og se hvem som endret** slik at **feil kan følges opp**.

## Omfang
**Med:**
1. **ADR (neste ledige nummer, 0011 hvis ingen annen PR har tatt det): oppdrag uten ordre.** Avgjør hvor bestillingsopplysningene står når det ikke finnes en ordre: adresse, matrikkel (`gnr`, `bnr`, `snr`), bestiller (tekst, kontakt, firma), meglerens ordrenummer, borettslag/sameie, mottatt-tidspunkt og kilde. Krav til løsningen:
   - Ingen skjult ordre i mellom. `assignments.order_id` er tom for oppdrag laget direkte (slik kolonnen alt er beskrevet).
   - Faste koder endres ikke (regel 6). Nye koder og kolonner er tillegg.
   - Gamle oppdrag laget fra ordre virker som før, uten tap av data. Migreringen tåler ekte data.
   - Stenger ikke for neste punkt: et tilbud (dagens ordre) skal kunne gjøres om til oppdrag med ett trykk og fylle de samme feltene.
   - Prosjektlederens forslag, som arkitekten vurderer: bestillingsfeltene som egne kolonner på `assignments` (samme navn og regler som på ordren), og eiendommen fylles fra dem på oppdragssiden slik den fylles fra ordren i dag. Alternativet «lag eiendom med en gang» krever boligtype og eierform i skjemaet, som Ståle ikke har bedt om.
2. **Tjenesten `createAssignment(actor, organizationId, input)`** i `src/core/assignments`: `requireOrganizationAccess(..., "assignment.edit")`, kontoret og ansvarlig takstmann kontrolleres i `grant.organizationId`, nummer fra `nextAssignmentNumber`, status `ordered`, utstedende selskap fra ansvarlig (samme regel som `setTeamMember`), valgfri `inspection_at`. Alt i én transaksjon med hendelsen `assignment.created` (`{ number, orderId: null }`) og revisjonslogg uten verdier. Zod-reglene for adresse, matrikkel og bestiller gjenbrukes fra ordren (ikke kopi, flyttes til `src/shared` eller kjernen ved behov).
3. **Skjemaet `/oppdrag/ny`:** adresse, matrikkel, bestiller (velg kontakt eller fritekst, som på ordren), rapporttype (bare «Tilstandsrapport» nå, forhåndsvalgt), kontor (forhåndsvalgt med den ansattes kontor), ansvarlig takstmann (forhåndsvalgt med den innloggede hvis hen er takstmann) og befaringstid (valgfri). Etter lagring: til oppdragssiden.
4. **Knappen «Nytt oppdrag»** i arbeidskøen (hovedhandling, også i tom kø i stedet for «Ny ordre») og øverst i menyen.
5. **Dublettvarsel på oppdraget:** samme regel som A285–A291 (adresse eller matrikkel, åpent eller innen 90 dager), nå over både ordre og oppdrag laget direkte. Vises i skjemaet før lagring og på oppdragssiden. Stopper aldri lagringen. Ett sted for regelen; ordre og oppdrag bruker den samme.
6. **Endre etter lagring på oppdragssiden:** bestillingsfeltene kan endres i alle statuser av alle med `assignment.edit`, med `row_version`-kontroll (ingen stille overskriving), revisjonslogg og historikk som for ordren (A249–A254).
7. **Søk:** arbeidskøen og søket finner oppdrag laget direkte på adresse, matrikkel, bestiller og meglerens ordrenummer, som for oppdrag fra ordre. Adressen på kortet i køen kommer fra eiendommen, ellers fra oppdraget, ellers fra ordren.
8. **Dokumentasjon:** `docs/05-domenemodell.md` (felt, hendelse, ordliste), ADR, beslutninger A292 og videre i `docs/09-apne-sporsmal.md`, `start.sh` hvis oppsettet endres.

**Ikke med (bevisst utelatt):**
- «Ordre» blir «Tilbud», flytting i menyen, gjøre om tilbud med ett trykk, avslag og utløp (neste planpunkt). Menypunktet «Ordre» og `/ordre/ny` står som i dag.
- Endring av seed-filene for testdata (PR #203 er åpen og seeder ordre). Bare testfabrikker i `tests/factories.ts` kan få tillegg.
- KI-forslag fra e-post (krok A1) og bestillingsskjema for meglere (fase 3b).
- Frist, intern merknad, parter og avtale i skjemaet. De settes på oppdragssiden som i dag.
- Nye rapporttyper. Bare `condition_report` finnes.
- Oppslag mot Kartverket eller annet register for adresse og matrikkel.
- Oppretting uten nett. Nummeret lages bare på serveren (D9); skjemaet sier tydelig fra når det ikke er nett.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | alle oppdrag i organisasjonen | lage og endre når `access.inspectors_edit_all` er på (`assignment.edit`) |
| kontor | alle oppdrag i organisasjonen | lage og endre (`assignment.edit`) |
| leder | alle | lage og endre |
| admin | alle | lage og endre (stenges aldri ute) |

All tilgang i `src/core/access`. Spørringer filtrerer på `grant.organizationId`, aldri på id fra adressen eller skjemaet.

## Data
Avgjøres i ADR-en (punkt 1). Forventet: nye valgfrie kolonner på `assignments` for bestillingsopplysningene, med sammensatte fremmednøkler `(organization_id, …)` til `contacts` og `firms`, og `row_version`. Ingen ny tabell med `organization_id` uten føring i `tests/tenant-tables.ts`. Uttrykksindekser for dublettregelen på oppdraget, med uttrykkene ett sted (`duplicate-sql.ts`). Faste koder som tas i bruk: `ordered`, `condition_report`, `manual`, `address`, `cadastre` (alle finnes). Oppdater ordlisten.

## Skjermer
- **Arbeidskøen (PC og iPad):** «Nytt oppdrag» som hovedknapp øverst. Fra kø til lagret oppdrag: 1 trykk + skjema + «Lagre». I dag: «Ny ordre», skjema, «Lagre», «Gjør om til oppdrag», velg kontor, bekreft.
- **Menyen:** «Nytt oppdrag» øverst, før «Arbeidskø».
- **`/oppdrag/ny`:** ett skjema, én kolonne på iPad, feltene i rekkefølgen over, tydelige feilmeldinger per felt, dublettvarsel over «Lagre».
- **`/oppdrag/[id]`:** kortet «Bestilling» med «Endre» og «Endringer» (historikk), dublettvarsel.
- Universell utforming: etiketter, tastaturrekkefølge, kontrast, varsel med `role="status"`.

## Regler
Dublettregelen er fast kode med testsaker (ikke regelmotoren): samme sett som A285–A291, utvidet med oppdrag uten ordre, og en paritetstest som viser at ordre og oppdrag gir samme svar.

## Akseptkriterier
- [ ] ADR godkjent i PR-en; ingen fast kode er endret.
- [ ] «Nytt oppdrag» står i arbeidskøen (også tom kø) og øverst i menyen, og lager oppdrag med status «Bestilt», nummer, kontor, ansvarlig og eventuelt befaringstid, uten ordre (`order_id` tom).
- [ ] Ugyldig eller fremmed kontor eller takstmann gir tydelig feilmelding, og ingenting lagres.
- [ ] Dublettvarsel vises i skjemaet og på oppdraget når adresse eller matrikkel treffer et åpent oppdrag eller en ordre, og stopper ikke lagringen.
- [ ] Bestillingsfeltene kan endres etter lagring; samtidig endring gir melding i stedet for stille overskriving; historikken viser endringen.
- [ ] Søket og arbeidskøen finner oppdrag laget direkte på adresse, matrikkel, bestiller og ordrenummer.
- [ ] Oppdrag laget fra ordre virker som før (regresjonstest), og ordreflyten er uendret.
- [ ] Nye kolonner sendes aldri til KI (test mot `never-fields` og vasken).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for hver ny spørring).
- [ ] Virker på iPad-størrelse og PC (e2e: lage oppdrag fra køen, dublettvarsel, endre).
- [ ] Logger og hendelser har bare id-er og feltkoder, aldri adresse, matrikkel eller bestiller.
- [ ] KI-forslag: ingen i denne oppgaven (se «KI i bunnen»).

## Roller
arkitekt (ADR og datamodell), ux (skjema, plassering i kø og meny, trykk), ui (skjema og kort), sikkerhet-personvern (nye persondatafelt, vern mot KI, tenant-isolasjon), utvikler og testskriver i parallell. Ikke fag: ingen fagtekst eller TG.

## Beslutninger (autonom modus)
Føres fra A292 i `docs/09-apne-sporsmal.md` når de tas (blant annet: bestillingsfelt på oppdraget, forhåndsvalg av kontor og ansvarlig, dublettregel over både ordre og oppdrag). Hver merkes «lett å endre» eller «dyrt å endre».

## Åpne spørsmål
- Ingen som stopper. Navn og plassering av «Tilbud» avgjøres i neste punkt.
