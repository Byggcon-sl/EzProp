# Funksjon: Overstyringer for leder

- **Fase:** 2a-2 («Fra forbedreren», 17.11.2026, fra «Publisering av badet»)
- **Modul:** kjerne / `src/core/reports` (lesing av overstyringer), `src/core/claims` (punkt på saken), `src/core/ai` (ny KI-funksjon)
- **Status:** utkast
- **Branch:** `overstyringer-leder` (bygger på main)
- **Støtter hovedmål:**
  - **De ansatte:** leder ser på én side hvilke sperrer som krysses bort, og hvorfor, uten å åpne rapport for rapport.
  - **KI i bunnen:** KI skriver månedsoppsummeringen fra faste koder og tall; leder godtar, endrer eller avviser.
  - **Færre reklamasjoner:** overstyringer som senere ga reklamasjon på samme kontrollpunkt, blir røde. Leder ser hvilke sperrer som ikke bør krysses bort, og kan ta det opp i fagmøtet.

## Problem
Publiseringen (`docs/funksjoner/fase2a-publisering-badet.md`) lar takstmannen krysse bort en sperre med en grunn. Overstyringene lagres i `publish_check_results`, men ingen ser dem samlet. Krysses «hull i våtrom» bort med «Ikke tilgang» i mange bad, og noen av dem ender i reklamasjon, får leder ikke vite det. Uten oversikten lærer Byggcon ikke av overstyringene.

## KI i bunnen
- **Fra første dag:** ny KI-funksjon `override_summary`. Leder velger en måned og trykker «Lag oppsummering». Serveren teller opp overstyringene og sender bare tallene til KI. KI skriver 2–5 korte setninger uten navn (for eksempel «Hull i våtrom krysses bort med ‹Ikke tilgang› i 40 % av badene»). Leder godtar, endrer eller avviser. Godtatt eller endret tekst vises øverst på siden for den måneden.
- **Hva som sendes til KI (tillatt-listen, `serverSources`):** bare faste koder og tall: `check_code`, `checkpoint_key`, `override_reason_code`, antall overstyringer, antall utgivelser i måneden, antall med reklamasjon på samme punkt. **Aldri** `override_reason` (fritekst), navn, ansatt-id, oppdrags-id, adresse, matrikkel eller reklamasjonstekstene. Dette står i funksjonsdefinisjonen og testes med en lekkasjetest.
- **Logg:** forslag og beslutning i `ai_usage_log` som i de andre funksjonene. Måltypen er `override_summary` med `fieldKey` `month` og målet `{ month: "YYYY-MM" }`; organisasjonen kommer fra tilgangssjekken. Ingen ny tabell: siste godtatte eller endrede rad for måneden er teksten som vises.
- **Falsk leverandør og evalueringssett:** `src/core/ai/evals/override_summary.cases.json` med minst 12 saker (tom måned, én kode, mange koder, høy andel, reklamasjon på punktet, tall som må stå uendret, ingen gjetteord, ingen TG, ingen navn). Ledetekst `override_summary.v1`. Funksjonen krever `claims.read`.
- **KI setter aldri TG og sender ingenting.** Teksten er bare for leder, og den går aldri inn i en rapport.

## Brukerhistorier
- Som **leder** vil jeg **se alle sperrer som er krysset bort siste 90 dager, gruppert** slik at **jeg ser mønstre i stedet for enkeltsaker**.
- Som **leder** vil jeg **se hvilke overstyringer som endte i reklamasjon på samme punkt** slik at **vi kan endre rutinen før neste reklamasjon**.
- Som **leder** vil jeg **få en kort oppsummering per måned som jeg godkjenner** slik at **jeg kan ta den med i fagmøtet uten å skrive den selv**.
- Som **leder** vil jeg **kunne velge kontrollpunkt når jeg registrerer en reklamasjon** slik at **koblingen til overstyringene blir riktig**.

## Omfang
**Med:**
- Siden `/oppdrag/overstyringer` (lenke fra oppdragslisten, bare synlig for den som har `claims.read`).
- Liste over overstyrte sperrer (`publish_check_results` med `overridden = true`) der `overridden_at` er siste 90 dager (Oslo-tid), bare på utgivelser som ikke er slettet.
- Gruppering i tre nivåer: kode (sperren, norsk etikett) → kontrollpunkt (navn fra malversjonen, eller «Hele rapporten») → grunn (etikett for `override_reason_code`). Hver gruppe viser antall. Grupper sortert etter antall, flest først.
- Under hver grunn: én linje per overstyring med dato og lenke til utgivelsen (`/oppdrag/<id>/rapport/...` som publiseringen bruker). Ingen navn på takstmannen, og ingen fritekst i listen (fritekst ses i utgivelsen for den som har tilgang der).
- **Rød markering:** overstyringen er rød (tekst «Reklamasjon på samme punkt» og ikon, ikke bare farge) når oppdraget har en reklamasjon som ikke er slettet, med `checkpoint_key` lik overstyringens `target_ref.checkpointKey` og `received_at` etter utgivelsens `released_at`. Gruppene viser også antall røde.
- **Nøytral markering** («Reklamasjon på oppdraget, punkt ikke valgt») når oppdraget har en reklamasjon etter utgivelsen uten valgt kontrollpunkt. Ikke rød.
- **Punkt på reklamasjonen:** ny valgfri kolonne `claims.checkpoint_key` (ikke ny tabell) og et valgfritt felt «Kontrollpunkt» i reklamasjonsskjemaet, med punktene fra malversjonene til rapportene på oppdraget. Serveren sjekker at koden finnes i en av dem. `building_part_text` står som før.
- KI-oppsummering per måned (valg av måned blant de tre siste hele månedene og inneværende) som forslag med Godta, Endre og Avvis.
- Evalueringssett, lekkasjetest, tilgangstester, tenant-isolasjon og e2e på PC og iPad.

**Ikke med (bevisst utelatt):**
- Filter eller visning per takstmann, og navn på den som krysset bort (spørsmål 100, venter på Ståle).
- Advarsler (`severity = 'warning'`); bare sperrer som er krysset bort.
- Automatisk kjøring hver måned eller varsel om ny oppsummering. Leder trykker selv.
- Eksport til Excel eller PDF.
- Andre perioder enn 90 dager, og egne filter på kode eller grunn.
- Kobling av reklamasjon til avvik eller utgivelse (kommer med reklamasjonsmappen i fase 4).
- Endring av eksisterende reklamasjoner i bulk for å sette kontrollpunkt.
- Ny tabell.

## Tilgang
Rettigheten er `claims.read` (bare leder og admin, regel 12), sjekket i `src/core/access`. Siden viser reklamasjonsdata, så den følger reklamasjonsrettigheten, ikke `report.publish`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Nei (siden finnes ikke i menyen, adressen gir «Ingen tilgang») | Nei |
| kontor | Nei | Nei |
| leder | Ja | Lage, godta, endre og avvise KI-oppsummering |
| admin | Ja | Som leder |

Alle spørringer filtrerer på `grant.organizationId`. Admin stenges aldri ute (regel 11).

## Data
- **Ingen nye tabeller.** Leser `publish_check_results`, `report_releases`, `reports`, `claims` og malversjonens kontrollpunkt.
- **Ny kolonne:** `claims.checkpoint_key text null`. Migrering uten tilbakefylling (eksisterende saker får `null`). Ny indeks `(organization_id, assignment_id, checkpoint_key)` der `deleted_at is null`.
- **Ny KI-måltype og funksjon:** `override_summary` (fast kode, regel 6) i `ai_usage_log.feature` og `target_ref`.
- Domenemodellen (4.13 reklamasjon og 4.7 publisering) og ordlisten oppdateres: `override_summary`, `checkpoint_key` på reklamasjon.

## Skjermer
- **PC (hovedskjerm):** overskrift «Overstyrte sperrer, siste 90 dager». Øverst KI-oppsummeringen for valgt måned (eller knappen «Lag oppsummering»). Under: gruppene som sammenleggbare seksjoner med antall og antall røde. Hovedhandling: se mønsteret og åpne en utgivelse (to trykk fra listen til utgivelsen).
- **iPad:** samme side, én kolonne, trykkflater minst 44 px.
- Tom tilstand: «Ingen sperrer er krysset bort de siste 90 dagene.»
- Feil: tydelig norsk melding, siden virker uten KI (KI-feil viser «Oppsummeringen kunne ikke lages nå. Prøv igjen senere.»).
- Universell utforming: rødt følges av tekst og ikon, kontrast etter Fjord-paletten, gruppene er knapper med `aria-expanded`.

## Regler
- **Ytelse:** gruppering og telling gjøres i én SQL-spørring (ikke per rad i JavaScript). Testet med 2 000 overstyringer.
- **Prosent i KI-grunnlaget:** andel = overstyringer med koden og grunnen / utgivelser i måneden som hadde sperren. Regnet av serveren, ikke av KI. Testsaker for null utgivelser (ingen deling på null).
- **Rød:** `claims.checkpoint_key = target_ref.checkpointKey` og samme oppdrag og `claims.received_at >= dato for released_at` og saken ikke slettet. Testsaker: før utgivelsen (ikke rød), annet punkt (ikke rød), uten punkt (nøytral), slettet sak (ingen markering), annet oppdrag (ingen markering).

## Akseptkriterier
- [ ] Leder og admin ser siden; takstmann og kontor får «Ingen tilgang» (test per rolle).
- [ ] Bruker i annen organisasjon ser verken overstyringer, reklamasjoner eller KI-oppsummering (`expectTenantIsolation` for hver ny spørring).
- [ ] Bare overstyringer siste 90 dager vises, gruppert på kode, kontrollpunkt og grunn, med antall og lenke til utgivelsen.
- [ ] Rød og nøytral markering følger reglene over (testsaker).
- [ ] Ingen navn eller ansatt-id på siden eller i KI-grunnlaget (test).
- [ ] `override_reason` (fritekst) og reklamasjonstekstene sendes aldri til KI (lekkasjetest mot falsk leverandør).
- [ ] KI-oppsummeringen kan godtas, endres og avvises, og forslag og beslutning logges i `ai_usage_log` (test mot falsk leverandør).
- [ ] Evalueringssettet `override_summary` består med `pnpm ai:eval override_summary`.
- [ ] Reklamasjonsskjemaet har valgfritt «Kontrollpunkt»; ukjent kode avvises av serveren (test).
- [ ] Migreringen tåler eksisterende reklamasjoner (test).
- [ ] Virker på PC og iPad-størrelse (e2e), og axe uten feil.
- [ ] Versjon økt i `package.json`.

## Beslutninger tatt i autonom modus (føres i `docs/09-apne-sporsmal.md`)
- **A526 (dyrt å endre):** `claims.checkpoint_key` som ny valgfri kolonne og valgfritt felt i reklamasjonsskjemaet. Planpunktet krever «samme `checkpoint_key`», men reklamasjonen har bare fritekst (A128 sa at koden kommer når kontrollpunktene finnes; de finnes nå). Ny kolonne, ikke ny tabell.
- **A527 (lett å endre):** Siden krever `claims.read`, ikke `report.publish`, fordi den viser reklamasjonsdata (regel 12).
- **A528 (lett å endre):** Reklamasjon uten valgt punkt gir nøytral markering, ikke rød.
- **A529 (lett å endre):** KI-oppsummeringen lages når leder trykker, ikke automatisk; godtatt tekst leses fra `ai_usage_log` (ingen ny tabell).
- **A530 (dyrt å endre):** Ny KI-funksjon og måltype `override_summary` (fast kode).
- **A531 (lett å endre):** Bare sperrer, ikke advarsler, og ingen navn på siden (spørsmål 100).

## Åpne spørsmål
- Spørsmål 100 (overstyringer per takstmann) står åpent. Bygges uten personfilter.

## Roller
- `arkitekt`: ny kolonne på `claims`, ny KI-funksjon og spørringen (ytelse).
- `ux` og `ui`: side med gruppering, rød og nøytral markering, KI-forslag (gjenbruk fra sammendraget).
- `ki`: `override_summary`, ledetekst, tillatt-liste og evalueringssett.
- `sikkerhet-personvern`: endret tillatt-liste i KI (A175), reklamasjonsdata, ingen navn.
- `domene` trengs ikke: ingen fagtekster, regler eller TG; etikettene finnes fra publiseringen.
- `utvikler` og `testskriver` i parallell.
