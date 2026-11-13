# Funksjon: Oppbevaringstid for avviste KI-forslag som innstilling (K7)

- **Fase:** 2a («Fra Ståles svar 12.11.2026», siste punkt)
- **Modul:** kjerne / `src/core/ai`, admin-side
- **Branch:** `ki-oppbevaring-avviste` fra `main` (13.11.2026)
- **Status:** utkast
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
1. **Innstillingen** `ai.rejected_retention_years` i `organizations.settings` (samme mønster som `photo.retention.*` i `src/core/files/retention.ts` og `time_tracking.enabled`). Heltall fra 1 til og med 10. Mangler den eller er den ugyldig: 10, og en advarsel logges med bare organisasjon og nøkkel (ikke verdien).
2. **Ny fil `src/core/ai/retention.ts`:** `readRejectedRetentionYears(organizationId, settings)` og `saveAiRetentionSettings(actor, organizationId, input)`. Lagring krever `organization.manage` via `requireOrganizationAccess`, validerer med Zod, slår sammen med de andre nøklene i én spørring (aldri overskriv andre nøkler) og skriver én rad i revisjonsloggen (`recordAuditEvent`) med nøkkel, gammel og ny verdi (bare tall).
3. **Utregningen av `retain_until`** i `src/core/ai`:
   - Ny rad (alle utfall, også `blocked` og feil): `created_at` + 10 år, som i dag.
   - Når status blir `rejected` (manuelt i `recordDecision` **og** automatisk når et nytt forslag erstatter et gammelt i `requestSuggestion`): `created_at` + innstillingen. Leses i samme transaksjon.
   - `accepted` og `edited`: `created_at` + 10 år.
   - «Angre» fra `rejected` tilbake til `suggested`: `created_at` + 10 år igjen.
   - Konstanten `AI_USAGE_RETENTION_YEARS` (10) blir stående for alt unntatt avviste.
4. **Admin-side `/admin/ki`** med fanen «KI» i adminmenyen: ett tallfelt «Oppbevar avviste KI-forslag i (år)», hjelpetekst «Godtatte og endrede forslag oppbevares alltid i 10 år. Endringen gjelder forslag som avvises etter at du har lagret.», knappen «Lagre», kvittering og feilmelding på norsk. Server action kaller `saveAiRetentionSettings`. Bruk eksisterende skjemadeler (`form-parts.tsx`, `form-state.ts`) og Fjord-profilen; ingen nye komponenter.
5. **Dokumenter:** ny A264 (og A265–A266 under) i «Avgjort av agentene» i `docs/09-apne-sporsmal.md`; A157 får merknaden «Oppbevaringstiden endret av Ståle 12.11.2026 (K7), se A264»; ADR 0006 del 5/7 får én setning; `docs/05-domenemodell.md` (4.12 `retain_until` og listen over innstillinger) og ordlisten (`rejected_retention_years`); T-0068 settes til «rettet» for A157-delen med PR-nummer (A55 og A87 sjekkes; er de ikke merket, merkes de også, én linje hver). Planen krysses av.
6. Versjon 0.10.10 → 0.10.11 (eller neste patch over det main har).

**Ikke med (bevisst utelatt):**
- Ingen jobb som merker utløpte rader som slettet. Ingenting slettes permanent; med 10 år som standard utløper ingen rader før 2036. Jobben tas når den trengs (står allerede som krok for bilder).
- Ingen tilbakevirkende endring: rader som alt er avvist, beholder sin `retain_until` (A265).
- Ingen egen oppbevaringstid for godtatte, endrede, sperrede eller feilede rader, og ingen tid per KI-funksjon.
- Ingen ny rettighet og ingen migrering (innstillingen ligger i `organizations.settings`).
- Ingen endring i `src/core/orders` eller ordresidene (T2 jobber der).
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
- `ai_usage_log.retain_until` regnes nå ut på nytt når status endres (se Omfang 3).
- Revisjonsloggen: hendelse for endret innstilling med nøkkel, gammel og ny verdi.

## Skjermer

`/admin/ki` på PC og iPad. Hovedhandling: skriv tallet og trykk «Lagre» (to trykk). Ugyldig verdi (0, 11, desimal, tomt, tekst) gir feilmelding ved feltet: «Skriv et helt antall år fra 1 til 10.»

## Regler

Ingen fagregler eller TG-logikk.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)

| Nr | Hva | Hvorfor | Lett/dyrt |
|---|---|---|---|
| A264 | Avviste KI-forslag får `retain_until` = opprettet + innstillingen `ai.rejected_retention_years` (1–10 år, standard 10). Gjelder både manuelt avvist og avvist fordi et nytt forslag erstattet det. Godtatte, endrede, sperrede og feilede rader står i 10 år. Endrer A157. | Ståle 12.11.2026 (K7, spørsmål 56). Øvre grense 10 år følger regel 3; kortere enn 1 år gir for lite grunnlag til å måle KI. | Lett å endre |
| A265 | Endringen virker bare fremover; rader som allerede er avvist, beholder sin dato. Angre fra avvist gir 10 år igjen. | Enklest, og ingen data får kortere tid uten at admin ser det. | Lett å endre |
| A266 | Innstillingen settes av admin på `/admin/ki` med `organization.manage`, og endringen logges i revisjonsloggen med gammel og ny verdi. | Samme mønster som tidsmålingen (A121) og A156 (admin styrer KI). | Lett å endre |

## Akseptkriterier

- [ ] Uten innstilling får en avvist rad `retain_until` = `created_at` + 10 år (test).
- [ ] Med innstillingen 2 får en manuelt avvist rad og en rad avvist ved nytt forslag `created_at` + 2 år; godtatt og endret rad får + 10 år; sperret og feilet rad + 10 år (test).
- [ ] Angre fra avvist gir + 10 år igjen (test).
- [ ] Ugyldige verdier i databasen (0, 11, 2.5, "5", null, negativ) gir 10 og en advarsel uten verdien (test).
- [ ] `saveAiRetentionSettings` avviser 0, 11, desimal og tekst med norsk feilmelding, beholder andre nøkler i `organizations.settings` (også `access.inspectors_edit_all` og `time_tracking.*`), og skriver én rad i revisjonsloggen med gammel og ny verdi (test).
- [ ] Takstmann, kontor og leder får ingen tilgang til lagring eller siden; admin har alltid tilgang (test).
- [ ] Bruker i annen organisasjon får ikke tilgang, og innstillingen i én organisasjon påvirker ikke `retain_until` i en annen (`expectTenantIsolation`).
- [ ] Ingen rad i `ai_usage_log` slettes permanent eller får `deleted_at` av denne endringen (test).
- [ ] `/admin/ki` virker på PC og iPad-størrelse: lagre, kvittering, feilmelding (e2e).
- [ ] A157 merket endret, A264–A266 ført, domenemodell, ordliste og ADR 0006 oppdatert, T-0068 oppdatert.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.

## Roller

- **utvikler:** `src/core/ai/retention.ts`, endringene i `record-decision.ts`, `request-suggestion.ts` og `usage-log.ts`, admin-siden og dokumentene.
- **testskriver** (parallelt): enhets- og integrasjonstester for utregning, lagring, tilgang og tenant-isolasjon, og e2e for `/admin/ki`.
- **sikkerhet-personvern:** gjennomgang av oppbevaring, revisjonslogg og at ingenting slettes.

Ikke med: arkitekt (følger eksisterende mønster for innstillinger), ux/ui (ett felt med eksisterende skjemadeler), fagansvarlig (ikke fagstoff), ki-ansvarlig (ingen ny KI-funksjon eller ledetekst).

## Åpne spørsmål

- Ingen til Ståle. Jobben som faktisk merker utløpte rader, tas når den første raden kan utløpe (tidligst ett år etter at noen setter 1 år).
