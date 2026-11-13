# Funksjon: Oppbevaringstid for avviste KI-forslag som innstilling (K7)

- **Fase:** 2a («Fra Ståles svar 12.11.2026», siste punkt)
- **Modul:** kjerne / `src/core/ai`, admin-side
- **Branch:** `ki-oppbevaring-avviste` fra `main` (13.11.2026, main flettet inn på nytt kl. 19 UTC). Beslutningene flyttet fra A264–A267 til A272–A275, fordi A264–A271 er testdata-kortets.
- **Status:** klar til bygging (forhåndsvurdering runde 1 innarbeidet 13.11.2026: sikkerhet-personvern og test-leder; forenkler innarbeidet 13.11.2026)
- **Støtter hovedmål:**
  - **KI i bunnen:** loggen over KI-forslag er grunnlaget for å måle og forbedre KI. Oppbevaringen blir en tydelig, styrbar del av grunnmuren, med 10 år som standard slik at grunnlaget beholdes.
  - **De ansatte:** admin kan selv korte ned hvor lenge avviste forslag (som kan inneholde rester av personopplysninger) står, uten å be utviklerne om det.
  - **Reklamasjoner:** godtatte og endrede forslag står fortsatt i 10 år, så det alltid kan vises hva KI foreslo og hva takstmannen bestemte i en rapport.

## Problem

A157 sier at alt i `ai_usage_log` lagres i 10 år, også avviste forslag. Ståle svarte 12.11.2026 (K7, spørsmål 56, `docs/kartlegging/svar-fra-stale-2026-11-12.md`): oppbevaringstiden for avviste forslag skal være en **innstilling, 10 år som standard**. I dag er tallet en konstant i koden (`AI_USAGE_RETENTION_YEARS` i `src/core/ai/usage-log.ts`). Testlaget har også meldt at A157 ikke er merket som endret (T-0068, lite).

## KI i bunnen

KI lager ingen forslag her. Oppgaven styrer hvor lenge KI-forslag og beslutningene om dem står i loggen. Alt skjer i `src/core/ai` (lesing av innstillingen og utregning av `retain_until`), så loggen fortsatt har én eier. Ingen nye data sendes til KI. Loggen (forslag, beslutning, `retain_until`) er det KI-forbedring og målinger senere bygger på; derfor er standarden 10 år.

## Brukerhistorier

- Som **admin** vil jeg **sette hvor mange år avviste KI-forslag oppbevares** slik at vi lagrer personopplysninger ikke lenger enn vi trenger.
- Som **leder** vil jeg at **godtatte og endrede forslag står i 10 år** slik at vi kan svare på en reklamasjon.

## Omfang

**Med:**
1. **Innstillingen** `ai.rejected_retention_years` i `organizations.settings` (samme mønster som `photo.retention.*` i `src/core/files/retention.ts` og `time_tracking.enabled`). Heltall fra 1 til og med 10, **lagret som tall i JSON** (aldri tekst; en lagret tekst «5» er ugyldig). Mangler den: 10 uten advarsel (det er normaltilstanden). Er den ugyldig: 10, og en advarsel logges med bare organisasjon og nøkkel (aldri verdien).
2. **Ny fil `src/core/ai/retention.ts`:**
   - `readRejectedRetentionYears(organizationId, settings)`: validert tall eller 10.
   - `retainUntilFor(status, createdAt, rejectedYears)`: **den ene funksjonen** som gir `retain_until` (status + `created_at` + år → dato, med `addYears` fra `usage-log.ts`). Brukes ved ny rad og ved **hver** statusovergang, så en rad som ender som `accepted` eller `edited` aldri blir stående med kort dato, uansett vei (også via angre).
   - `getAiRetentionSettings(actor, organizationId)`: lesefunksjonen siden bruker. Krever `organization.manage` via `requireOrganizationAccess` og leser med `grant.organizationId`. Siden leser aldri `settings` direkte.
   - `saveAiRetentionSettings(actor, organizationId, input)`: krever `organization.manage` via `requireOrganizationAccess` og bruker bare `grant.organizationId`. Validerer med Zod (tekst fra skjemaet gjøres om til heltall). Feilmeldingen og loggen gjengir aldri det som ble skrevet inn. I én transaksjon: les raden med radlås (`for update`), finn gammel verdi med `readRejectedRetentionYears` (verdien som faktisk gjaldt, altså 10 når nøkkelen mangler eller er ugyldig, aldri råverdien fra JSONB), slå sammen med de andre nøklene (aldri overskriv andre nøkler, som i `src/core/work-sessions/settings.ts`) og skriv én rad i revisjonsloggen (`recordAuditEvent`) med nøkkel, gammel og ny verdi (bare tall). **Samme verdi som før:** ingen skriving og ingen rad i revisjonsloggen, men skjemaet viser vanlig kvittering (A275).
3. **Utregningen av `retain_until`** i `src/core/ai`, alltid med `retainUntilFor` og innstillingen lest med `grant.organizationId` (aldri organisasjonen fra raden, målet eller skjemaet):
   - Ny rad (alle utfall, også `blocked` og feil): `created_at` + 10 år, som i dag.
   - Når status blir `rejected` (manuelt i `recordDecision` **og** automatisk når et nytt forslag erstatter et gammelt i `requestSuggestion`, rundt linje 303–320): `created_at` + innstillingen. Innstillingen leses i samme transaksjon. Datoen regnes ut **i koden per rad**, ikke med `created_at + interval` i SQL: PostgreSQL gir 28. februar for 29. februar, mens `addYears` gir 1. mars («minst så mange år»). I `requestSuggestion` hentes radene som avvises (id og `created_at`) og hver får sin egen dato.
   - `accepted` og `edited`: `created_at` + 10 år. `record-decision.ts` setter i dag ikke `retain_until` i det hele tatt; det rettes.
   - «Angre» fra `rejected` tilbake til `suggested`: `created_at` + 10 år igjen.
   - Konstanten `AI_USAGE_RETENTION_YEARS` (10) blir stående for alt unntatt avviste.
4. **Admin-side `/admin/ki`** med fanen «KI» i adminmenyen: ett tallfelt «Oppbevar avviste KI-forslag minst (år)», hjelpetekst «Tallet er hvor lenge et avvist forslag minst oppbevares. Ingenting fjernes automatisk ennå. Godtatte og endrede forslag oppbevares alltid i minst 10 år. Endringen gjelder bare forslag som avvises etter at du har lagret.» Siden lover aldri sletting. Siden og server action bruker tilgangssjekken i `src/core/access` (ingen rollesjekk i komponenten); organisasjonen kommer fra økten. knappen «Lagre», kvittering og feilmelding på norsk. Server action kaller `saveAiRetentionSettings`. Bruk eksisterende skjemadeler (`form-parts.tsx`, `form-state.ts`) og Fjord-profilen; ingen nye komponenter.
5. **Dokumenter:** ny A272 (og A273–A275 under) i «Avgjort av agentene» i `docs/09-apne-sporsmal.md`; A157 får merknaden «Oppbevaringstiden endret av Ståle 12.11.2026 (K7), se A272»; ADR 0006 linje 193 og 198 rettes (ikke lenger fast 10 år for alt); `docs/05-domenemodell.md` (4.12 `retain_until` rundt linje 1693, og listen over innstillinger) og ordlisten (`rejected_retention_years`); kommentaren i `src/db/schema/ai-usage-log.ts` linje 23; den interne personvernerklæringen `docs/personvern/intern-personvernerklaering.md`, rad `ai_usage_log` (innstilling 1–10 år, standard 10, satt av admin, ingen automatisk rydding ennå, se spørsmål 81); T-0068 settes til «rettet» for A157-delen med PR-nummer. A55 og A87 hører ikke til K7 og røres ikke her. Planen krysses av.
6. Versjon: neste patch over det main har når PR-en åpnes (main har 0.11.1 13.11.2026 kl. 19 UTC).

**Ikke med (bevisst utelatt):**
- Ingen jobb som merker utløpte rader som slettet, og ingen tømming av `output_text`. Ingenting slettes permanent; med 10 år som standard utløper ingen rader før 2036. Hva som skal skje når tiden er ute, er Ståles spørsmål (nr. 81, personvern) og bygges ikke nå.
- Ingen tilbakevirkende endring, verken kortere eller lengre: rader som alt er avvist, beholder sin `retain_until` (A273).
- Ingen egen oppbevaringstid for godtatte, endrede, sperrede eller feilede rader, og ingen tid per KI-funksjon.
- Ingen ny rettighet og ingen migrering (innstillingen ligger i `organizations.settings`).
- Ingen endring i `src/core/orders` eller ordresidene (T3 jobber der på `varsel-dublett`).
- Ingen visning av selve forslagene for admin.

## Tilgang

| Rolle | Se | Endre |
|---|---|---|
| takstmann | nei | nei |
| kontor | nei | nei |
| leder | nei | nei |
| admin | ja (`organization.manage`) | ja (`organization.manage`) |

Admin stenges aldri ute (regel 11). Innstillingen gjelder bare egen organisasjon (`grant.organizationId`).

## Data

- Ny nøkkel i `organizations.settings`: `ai.rejected_retention_years` (heltall 1–10, standard 10). Ingen migrering.
- `ai_usage_log.retain_until` regnes nå ut på nytt ved hver statusendring med `retainUntilFor` (se Omfang 3). Ingen databasesjekk hindrer kortere dato, så ingen migrering.
- Revisjonsloggen: hendelse for endret innstilling med nøkkel, gammel (verdien som gjaldt) og ny verdi, bare tall. Ingen rad når verdien er den samme.
- Ingen ny tabell, så `tests/tenant-tables.ts` endres ikke.

## Skjermer

`/admin/ki` på PC og iPad. Hovedhandling: skriv tallet og trykk «Lagre» (to trykk). Ugyldig verdi (0, 11, desimal, tomt, tekst) gir feilmelding ved feltet: «Skriv et helt antall år fra 1 til 10.»

## Regler

Ingen fagregler eller TG-logikk.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)

| Nr | Hva | Hvorfor | Lett/dyrt |
|---|---|---|---|
| A272 | Avviste KI-forslag får `retain_until` = opprettet + innstillingen `ai.rejected_retention_years` (1–10 år, standard 10). Gjelder både manuelt avvist og avvist fordi et nytt forslag erstattet det. Godtatte, endrede, sperrede og feilede rader står i 10 år. Tallet er hvor lenge forslaget **minst** oppbevares; ingenting fjernes automatisk ennå, og myk sletting lar teksten stå (spørsmål 81). Endrer A157. | Ståle 12.11.2026 (K7, spørsmål 56). Øvre grense 10 år følger regel 3. Nedre grense 1 år er agentenes valg (kortere gir for lite grunnlag til å måle KI) og står i spørsmål 81. | Lett å endre |
| A273 | Endringen virker bare fremover, både ved kortere og lengre tid: rader avvist med 2 år beholder 2 år selv om admin setter 10 igjen, og rader avvist med 10 år beholder 10 år når admin setter 2. Angre fra avvist gir 10 år igjen. | Enklest, og ingen data får kortere tid uten at admin ser det. | Lett å endre |
| A274 | Innstillingen settes av admin på `/admin/ki` med `organization.manage`, og endringen logges i revisjonsloggen med gammel og ny verdi. | Samme mønster som tidsmålingen (A121) og A156 (admin styrer KI). | Lett å endre |
| A275 | I revisjonsloggen er gammel verdi den som faktisk gjaldt (10 når nøkkelen mangler eller er ugyldig), lest med radlås i samme transaksjon. Lagres samme verdi som før, skrives ingenting og ingen rad i loggen. `retain_until` regnes ut i koden per rad med samme `addYears` som i dag (29. februar gir 1. mars). | Se «Avgjort ved uenighet» under. | Lett å endre |

## Akseptkriterier

- [ ] Uten innstilling får en avvist rad `retain_until` = `created_at` + 10 år (test).
- [ ] Med innstillingen 2 får en manuelt avvist rad og en rad avvist ved nytt forslag `created_at` + 2 år; godtatt og endret rad får + 10 år; sperret og feilet rad + 10 år (test).
- [ ] Én angre-test: avvist med 2 år → angre (+ 10 år igjen) → godtatt gir + 10 år (test). Andre angre-veier dekkes av at `retainUntilFor` brukes ved hver overgang.
- [ ] Når et nytt forslag erstatter gamle, får hver avvist rad sin egen dato ut fra egen `created_at` (test med minst to rader med ulik `created_at`).
- [ ] A273: rad avvist med innstilling 10 beholder + 10 år etter at innstillingen settes til 2, og rad avvist med 2 beholder + 2 år etter at den settes til 10 igjen (test).
- [ ] Grensene 1 og 10 gir riktig dato, og 29. februar gir 1. mars, i enhetstesten av `retainUntilFor` (test). Integrasjonstestene bruker vanlige datoer; den statiske sjekken ST1 viser at ingen `interval` i SQL brukes for `retain_until`.
- [ ] Ugyldige verdier i databasen (0, 11, 2.5, "5", null, -1, {}, og `settings` = null) gir 10 og en advarsel med bare organisasjon og nøkkel, aldri verdien: én tabelltest (`it.each`) med spion på `logger.warn`. Manglende nøkkel gir 10 uten advarsel (test).
- [ ] `saveAiRetentionSettings` avviser 0, 11, 2.5, «abc», tom verdi og negativt tall med «Skriv et helt antall år fra 1 til 10.» uten å gjengi det som ble skrevet, og skriver ingenting (test).
- [ ] Lagring beholder andre nøkler (`access.inspectors_edit_all`, `time_tracking.*`, `photo.retention.*`), lagrer verdien som tall (`typeof` number) også når skjemaet sender tekst, og skriver én rad i revisjonsloggen med nøkkel, gammel og ny verdi som tall. Gammel verdi er 10 når det som stod var ugyldig. Samme verdi som før gir ingen ny rad (test).
- [ ] Takstmann, kontor og leder får ingen tilgang til lagring eller siden; admin har alltid tilgang (test).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` på både `saveAiRetentionSettings` og `getAiRetentionSettings`; testen sender `organizationId` fra en annen organisasjon), og innstilling 1 i én organisasjon endrer ikke `retain_until` når noe avvises i en annen (test).
- [ ] Ingen rad i `ai_usage_log` slettes permanent eller får `deleted_at` av denne endringen; antall rader er det samme etter alle overgangene (test).
- [ ] Hjelpeteksten på `/admin/ki` sier «minst» og at ingenting fjernes automatisk ennå (e2e).
- [ ] Eksisterende `record-decision-order*.test.ts` og `suggestion-status*.test.ts` er grønne uendret.
- [ ] `/admin/ki` virker på PC og iPad-størrelse: admin lagrer 3, får kvittering og ser 3 etter omlasting; 0 og 11 gir feilmelding ved feltet; leder og takstmann ser verken fanen eller siden (e2e, `e2e/fase-2a-ki-oppbevaring.spec.ts`). Uten nett er ikke aktuelt (admin-side bare på nett); det står i testrapporten.
- [ ] A157 merket endret, A272–A275 ført, spørsmål 81 lagt inn, domenemodell, ordliste, ADR 0006, skjemakommentaren og den interne personvernerklæringen oppdatert, T-0068 oppdatert.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.

## Roller

- **utvikler:** `src/core/ai/retention.ts`, endringene i `record-decision.ts`, `request-suggestion.ts` og `usage-log.ts`, admin-siden og dokumentene.
- **testskriver** (parallelt): testplanen fra test-leder: `src/core/ai/retention.test.ts` (enhet og integrasjon), tillegg i `usage-log.test.ts`, `record-decision.test.ts` og `request-suggestion.test.ts`, `src/app/(ansatt)/admin/ki/actions.test.ts` (feil rolle, tekst lagres som tall) og e2e `e2e/fase-2a-ki-oppbevaring.spec.ts` på PC og iPad.
- **sikkerhet-personvern:** gjennomgang av oppbevaring, revisjonslogg og at ingenting slettes.
- **ki-ansvarlig** (kort gjennomgang): at loggen fortsatt gir grunnlag for målinger og evaluering, og at alt går gjennom `src/core/ai`.

Ikke med: arkitekt (følger eksisterende mønster for innstillinger), ux/ui (ett felt med eksisterende skjemadeler), fagansvarlig (ikke fagstoff), ingen ny KI-funksjon eller ledetekst, så ki-ansvarlig bare ser over loggen.

## Avgjort ved uenighet (prosjektlederen, 13.11.2026)

- **Gammel verdi i revisjonsloggen:** sikkerhet-personvern foreslo `null` når nøkkelen mangler eller er ugyldig; test-leder foreslo verdien som faktisk gjaldt (10). Valgt: verdien som gjaldt. Den forteller hvilken oppbevaring som styrte avvisningene før endringen, er alltid et validert tall, og kravet fra sikkerhet-personvern (aldri råverdien fra JSONB) er oppfylt. (A275)
- **Samme verdi som før:** ingen skriving og ingen rad i revisjonsloggen. Loggen skal vise endringer, ikke trykk på «Lagre». (A275)
- **Skuddår:** utregning i koden per rad med dagens `addYears`, ikke SQL-intervall, så samme regel gjelder overalt. (A275)
- **Forenkler (13.11.2026), godtatt:**
  - A55 og A87 tas ut av omfanget. De er ikke K7; testlaget tar dem.
  - Angre: én test (avvist med 2 år → angre → godtatt). `retainUntilFor` brukes ved hver overgang, så flere angre-tester gir ikke mer trygghet.
  - Ugyldige verdier i databasen: én tabelltest.
  - Skuddår testes bare i enhetstesten av `retainUntilFor` (U4). Faren for SQL-intervall i den automatiske avvisningen dekkes av den statiske sjekken ST1 (ingen `interval` for `retain_until`), ikke av egne skuddårstester i integrasjon.
  - Ingen nye komponenter, avhengigheter, migreringer eller rettigheter.
- **Funn F1 og F2 i testplanen:** F1: mangler nøkkelen, gis 10 uten advarsel (mangler er normalt, advarsel per avvisning blir støy); bare ugyldig verdi gir advarsel. F2: lesefunksjonen `getAiRetentionSettings` med tilgangssjekk er lagt inn i omfanget.
- **Spørsmål til Ståle:** kortet sa «ingen». Det holder ikke: hva som skjer når tiden er ute, er personvern og Ståles. Lagt inn som spørsmål 81 (stopper ikke bygging). Nr. 80 er tatt av T2.

## Åpne spørsmål

- **Spørsmål 81 i `docs/09-apne-sporsmal.md`** (personvern, stopper ikke bygging): når tiden for et avvist forslag er ute, skal raden bare merkes slettet (teksten står), eller skal `output_text` tømmes? Og er nedre grense 1 år riktig? Bygges ikke nå; med 10 år som standard utløper ingen rad før 2036.
