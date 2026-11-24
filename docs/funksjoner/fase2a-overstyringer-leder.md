# Funksjon: Overstyringer for leder

- **Fase:** 2a-2 («Fra forbedreren», 17.11.2026, fra «Publisering av badet»)
- **Modul:** kjerne / `src/core/reports` (lesing og telling av overstyringer, ny fil `overrides.ts`), `src/core/claims` (kontrollpunkt på saken), `src/core/ai` (ny KI-funksjon `override_summary`)
- **Status:** klar til bygging (forhåndsvurdering runde 1 tatt inn 24.11.2026)
- **Branch:** `overstyringer-leder` (bygger på main)
- **Støtter hovedmål:**
  - **De ansatte:** leder ser på én side hvilke sperrer som krysses bort, og hvorfor, uten å åpne rapport for rapport. Fra ca. 150 trykk og en time i måneden til ca. 5 minutter.
  - **KI i bunnen:** KI skriver månedsoppsummeringen fra faste koder og tall; leder godtar, endrer eller avviser.
  - **Færre reklamasjoner:** overstyringer som senere ga reklamasjon på samme kontrollpunkt, blir røde, og punktet på reklamasjonen velges nesten av seg selv. Leder ser hvilke sperrer som ikke bør krysses bort.

## Problem
Publiseringen (`docs/funksjoner/fase2a-publisering-badet.md`) lar takstmannen krysse bort en sperre med en grunn. Overstyringene lagres i `publish_check_results`, men ingen ser dem samlet. Krysses «hull i våtrom» bort med «Ikke tilgang» i mange bad, og noen av dem ender i reklamasjon, får leder ikke vite det.

## KI i bunnen
- **Fra første dag:** ny KI-funksjon `override_summary`. Leder velger en måned og trykker «Lag oppsummering». Serveren teller og regner alle tall og prosenter; KI formulerer bare 2–5 korte setninger uten navn (for eksempel «Hull i våtrom ble krysset bort med ‹Ikke tilgang› i 7 av 18 rapporter, opp fra 2 måneden før»). Leder godtar, endrer eller avviser.
- **Funksjonsdefinisjon:** `AiFeatureCode` får `override_summary`; ledetekst `override_summary.v1`; `permission: "claims.read"`; `allowedFields: []`; `fieldSources: {}`; `serverSources.override_stats` med kolonnekildene `publish_check_results.check_code`, `publish_check_results.override_reason_code`, `publish_check_results.target_ref`, `claims.checkpoint_key`, `checkpoints.name` (navnet på punktet fra malversjonen), og de faste etikettene for kode og grunn fra kodelistene i `src/shared/config`. Ingen andre tekstkilder (A573).
- **Grunnlaget (`AiServerInput.overrideStats`):** `{ month, reportCount, previousMonth: { reportCount }, rows: [{ checkCode, checkLabel, checkpointKey, checkpointName, reasonCode, reasonLabel, count, sharePercent, claimCount, previousCount, previousSharePercent, deltaCount, deltaPoints }] }`. Alle tall er heltall eller `null`. `sharePercent` og prosentpoeng er `null` når `reportCount` er under 5 (bare antall, A570). Grunnlaget valideres med zod `strict` og kodemønster rett før kallet (en kode fra en egen mal senere skal ikke kunne bære tekst).
- **Aldri til KI** (står i `src/core/ai/never-fields.ts`, dekkes av lekkasjetesten): `publish_check_results.override_reason`, `publish_check_results.overridden_by`, `claims.created_by`, alle reklamasjonstekster (også `building_part_text`), navn, ansatt-id, oppdrags-id, oppdragsnummer, adresse og matrikkel.
- **Lagring og mål (A567):** ny liten tabell `override_summaries` (se Data). Leder trykker «Lag oppsummering» → serveren henter eller lager raden for (organisasjon, måned) → KI-målet er `{ type: "override_summary", id: <override_summaries.id>, fieldKey: "text" }`. Måltypen står i `RESOLVED_AI_TARGET_TYPES` med eget oppslag i `src/core/ai/resolve-target.ts`: raden slås opp på `grant.organizationId` og `deleted_at is null`, og gir `assignment_id` og `report_id` lik `null`. Måneden valideres på serveren (`YYYY-MM`, bare de fire tillatte månedene, Oslo-tid); ingen organisasjons-id fra klienten.
- **Godta, endre, avvis:** teksten leder godtar eller endrer, lagres i `override_summaries.text` med `ai_usage_log_id`. KI-forslaget i `ai_usage_log.output_text` skrives aldri over. Avvis setter ikke tekst. Siden viser `override_summaries.text` for måneden (siste beslutning gjelder; rekkefølgen godtatt → endret → avvist testes). Leder kan også skrive teksten selv (`source = 'manual'`).
- **Ekte leverandør (A568, tillegg til ADR 0006):** `isBlocked` i `src/core/ai/request-suggestion.ts` sperrer i dag alle mål uten oppdrag. Tillegget: et organisasjonsmål uten oppdrag er lov når funksjonen har tomme `allowedFields` og `fieldSources` og bare `serverSources` med faste koder, etiketter og tall. Endringen gjennomgås av sikkerhet-personvern (A175). Bare den falske leverandøren brukes til Ståle slår på den ekte.
- **Vakter:** `number_guard` (hvert tall og hver prosent i svaret må finnes i grunnlaget), TG-vakt, gjetteordvakt og navnevakt gjelder funksjonen.
- **Falsk leverandør:** gir et fast svar laget av tallene, og har de vanlige feilinngangene (`[fake: legg til tall]`, `[fake: legg til TG]`, `[fake: feil]`), slik at evalueringssettet får ekte negative saker.
- **Evalueringssett:** `src/core/ai/evals/override_summary.cases.json` med minst 30 saker med fasit, og egen gren i `src/core/ai/evals/run.ts`. Med: null utgivelser (KI kalles ikke), lite grunnlag under 5 (bare antall), én dominerende grunn, mange koder, mange røde, nøytrale tall, økning, nedgang, ny kode som ikke fantes måneden før, tall som må stå uendret, ingen gjetteord, ingen TG, ingen navn, og fritekst som ikke lekker.
- **Grenser (`src/core/ai/limits.ts`):** ett åpent forslag per måned (mållåsen), høyst 5 forespørsler per leder per time og 20 per organisasjon per døgn (A575).
- **Kostnad:** ca. 1–2 000 tokens inn og 200 ut per trykk, under 1 kr per oppsummering.
- **KI setter aldri TG og sender ingenting.** Teksten er bare for leder, og den går aldri inn i en rapport.

## Brukerhistorier
- Som **leder** vil jeg **se alle sperrer som er krysset bort siste 90 dager, gruppert** slik at **jeg ser mønstre i stedet for enkeltsaker**.
- Som **leder** vil jeg **se hvilke overstyringer som endte i reklamasjon på samme punkt** slik at **vi kan endre rutinen før neste reklamasjon**.
- Som **leder** vil jeg **få en kort oppsummering per måned som jeg godkjenner** slik at **jeg kan ta den med i fagmøtet uten å skrive den selv**.
- Som **leder** vil jeg **få kontrollpunktet foreslått når jeg registrerer en reklamasjon** slik at **koblingen til overstyringene blir riktig uten ekstra arbeid**.

## Omfang
**Med:**
- Siden `/oppdrag/overstyringer` (lenke fra oppdragslisten, bare synlig for den som har `claims.read`).
- Liste over overstyrte sperrer (`publish_check_results` med `overridden = true`, `severity = 'blocker'`) der `created_at` er i dag eller inntil 90 dager tilbake (Oslo-dato; dag 90 tas med, dag 91 ikke). `created_at` er utgivelsestidspunktet, og filteret bruker indeksen `publish_check_results_overridden_idx` (A572).
- **To nivåer (UX):** overskriften er kode og kontrollpunkt («Hull i våtrom · Bad 1. etg», eller «· Hele rapporten»), med grunnene som underlinjer. Hver overskrift og grunn viser antall unike rapporter og antall røde. Grupper med røde treff ligger øverst og er åpne fra start; ellers sortert etter antall, flest først. Gruppene er knapper med `aria-expanded`.
- Under hver grunn: én linje per utgivelse med oppdragsnummer, dato og versjon («v2» når det ikke er første versjon), og lenke til utgivelsen. Sortert på dato, aldri på person. Ingen navn, ingen adresse, ingen fritekst. **Begrunnelsen for «Annet» ses bare i utgivelsen** for den som har tilgang der (forbedrerens punkt 3 er lagt som spørsmål 123, personvern).
- **Telling (A570):** gruppetall teller unike rapporter per (`check_code`, `checkpoint_key`, `override_reason_code`), ikke utgivelser, så v1 og v2 av samme rapport telles én gang.
- **Rød markering (A571):** linjen er rød (tekst «Reklamasjon på samme punkt» og ikon, ikke bare farge) når oppdraget har en reklamasjon som ikke er slettet, med `checkpoint_key` lik overstyringens `target_ref.checkpointKey`, og utgivelsen er **den siste utgivelsen av rapporten** med `(released_at at time zone 'Europe/Oslo')::date <= claims.received_at`. Reklamasjon samme dag som utgivelsen gir rødt. En overstyring på v1 blir ikke rød når v2 kom før reklamasjonen.
- **Nøytral markering** («Reklamasjon på oppdraget, punkt ikke valgt», med lenken «Velg kontrollpunkt» til redigeringen av reklamasjonen) etter samme tidsregel når reklamasjonen mangler kontrollpunkt. Ikke rød.
- Overstyringer uten `checkpointKey` («Hele rapporten») blir aldri røde eller nøytrale.
- **Kontrollpunkt på reklamasjonen:** ny valgfri kolonne `claims.checkpoint_key` og feltet «Kontrollpunkt» i reklamasjonsskjemaet (nedtrekksmeny, punktene gruppert på rom eller kapittel). Øverst står punktene som ble krysset bort i utgivelsene på oppdraget, merket «Krysset bort ved publisering». Serveren forhåndsvelger det beste treffet mellom `building_part_text` og navnet på punktet med en enkel tekstsammenligning (ingen KI, fritekst går ikke til KI) når treffet er tydelig; ellers står «Ikke valgt» øverst og er valgt. Har oppdraget bare én rapport, vises bare punktene fra den. Etter lagring vises «Denne sperren ble krysset bort ved publisering (dato, grunn)» på saken (A576). Serveren sjekker at koden finnes i malversjonen til en rapport på oppdraget. En arkivert kode på en eldre sak vises med navnet fra malversjonen.
- **KI-oppsummering per måned (A577):** fire store knapper side om side (inneværende og de tre siste hele månedene, minst 44 pt). Siste hele måned er valgt fra start. Mangler den godkjent tekst, vises «Lag oppsummering» som et tydelig kort. «Lag oppsummering» og «Godta» er hovedknapper (56 pt på iPad); Endre og Avvis gjenbruker mønsteret fra sammendraget. Ved oppsummeringen står «Tall for hele måneden», fordi måneden kan gå lenger tilbake enn 90 dager. Måned uten utgivelser kaller ikke KI og viser «Ingen rapporter ble publisert i denne måneden.».
- Evalueringssett, lekkasjetest, tilgangstester, tenant-isolasjon og e2e på PC og iPad.

**Ikke med (bevisst utelatt):**
- Filter eller visning per takstmann, og navn på den som krysset bort (spørsmål 100, venter på Ståle).
- Fritekst («Annet»-begrunnelsen) på siden (spørsmål 123).
- Advarsler (`severity = 'warning'`).
- Automatisk kjøring hver måned eller varsel om ny oppsummering. Leder trykker selv.
- Eksport til Excel eller PDF. Andre perioder enn 90 dager, og egne filter på kode eller grunn.
- Andel per bad (krever telling av rom i utgivelsens `snapshot`).
- Kobling av reklamasjon til avvik eller utgivelse (reklamasjonsmappen i fase 4). Bulkendring av eksisterende reklamasjoner.
- Linjen ved kryssboksen i publiseringen (eget planpunkt «Erfaringen ved kryssboksen»).

## Tilgang
Sjekkes bare i `src/core/access`. Siden viser reklamasjonsdata, så den følger reklamasjonsrettighetene, ikke `report.publish` (A565).

| Rolle | Se siden og oppsummeringen | Lage oppsummering (`claims.read`) | Godta, endre, avvise (`claims.manage`, ADR 0006 del 10) | Kontrollpunkt på reklamasjon (`claims.manage`) |
|---|---|---|---|---|
| takstmann | Nei («Ingen tilgang», ingen lenke), også med `access.inspectors_edit_all` | Nei | Nei | Nei |
| kontor | Nei | Nei | Nei | Nei |
| leder | Ja | Ja | Ja | Ja |
| admin | Ja, også uten lederrolle (regel 11) | Ja | Ja | Ja |

- Alle spørringer filtrerer på `grant.organizationId`. Admin stenges aldri ute.
- Takstmann og kontor som kjenner en `usageId` for `override_summary`, får samme avvisning som for ukjent id på status, godta, endre, avvis og angre.
- En annen leder enn den som ba om forslaget, kan se og avgjøre det (åpent forslag gjenbrukes for hele organisasjonen for denne måltypen, ikke bare for den som ba om det).
- Lenken til utgivelsen følger dagens tilgang der; navnet står bare i selve utgivelsen, som i dag.

## Data
- **Ny kolonne:** `claims.checkpoint_key text null` med CHECK for nøkkelformat (samme mønster som `nullOrKeyFormat` i `src/db/schema/reports.ts`). Lagres som `key`, ikke id (regel 6). Ingen ny indeks: `claims_organization_id_assignment_id_idx` dekker oppslaget. Kan stå i revisjonsloggen (fast kode).
- **Ny tabell `override_summaries` (A567):** `id`, `organization_id`, `month` (`text`, CHECK `^\d{4}-(0[1-9]|1[0-2])$`), `text` (null, CHECK lengde høyst 2000), `status` (`empty`, `accepted`, `edited`, `manual`, `rejected`), `source` (`ai`, `manual`), `ai_usage_log_id` (null), `decided_by`, `decided_at`, `created_at`, `updated_at`, `deleted_at`. Unik på (`organization_id`, `month`) der `deleted_at is null`. Myk sletting, 10 år. Føres i `tests/tenant-tables.ts`.
- **Migrering `0039`** (høyeste på main er 0038). Ingen tilbakefylling: eksisterende reklamasjoner får `null`. Ingen data flyttes eller slettes. `origin/reklamasjonskobling` endrer også `claims` (migrering 0036, ADR 0013); den som merges sist, omnummererer.
- **KI:** `override_summary` (fast kode) i `ai_usage_log.feature` og som måltype; CHECK-reglene i `src/db/schema/ai-usage-log.ts` utvides. `report_id` og `assignment_id` er `null`.
- **Myk sletting i alle ledd:** `deleted_at is null` på `publish_check_results`, `report_releases`, `reports`, `assignments` og `claims`, i listen og i KI-grunnlaget, så siden og oppsummeringen stemmer.
- Arkitekten leverer: Drizzle og migrering, tillegg til ADR 0006 (organisasjonsmål uten oppdrag), én linje i ADR 0015 (lesing av overstyringer), typene, og ordlisten i `docs/05-domenemodell.md` (`override_summary`, `override_summaries`, `checkpoint_key` på reklamasjon, avsnitt 4.7 og 4.13).

## Tjenester (grensesnitt)
- `src/core/reports/overrides.ts` (leser `claims` via `@/db`, eneste inngang `requireOrganizationAccess(..., "claims.read")`, ikke bak `report.read`):
  - `listPublishOverrides(actor, organizationId): Promise<OverrideOverview>`. Svaret har aldri `overriddenBy`, `overrideReason` eller reklamasjonstekster; spørringen henter dem ikke i det hele tatt.
  - `buildOverrideStats(grant, month): Promise<OverrideStats>` (tallene til KI).
  - `requestOverrideSummary(actor, organizationId, { requestId, month })`, `getOverrideSummary(actor, organizationId, month)`, `saveOverrideSummary(actor, organizationId, { month, text })` (manuell eller endret tekst).
- `src/core/claims`: `listClaimCheckpointOptions(actor, organizationId, assignmentId)` (`claims.manage`), og validering av `checkpoint_key` ved lagring.
- `src/core/ai` importerer aldri `@/core/reports` eller `@/core/claims`; tallene gis inn som `AiServerInput`.
- Rene funksjoner med enhetstester: `computeOverrideShare`, `buildOverrideSummaryInput`, `classifyClaimMarker`, `rankCheckpointMatch`, `validateSummaryText`, etiketter med trygg tekst for ukjent kode.

## Skjermer
- **PC (hovedskjerm):** overskrift «Overstyrte sperrer, siste 90 dager». Øverst månedsknappene og KI-oppsummeringen for valgt måned. Under: gruppene. Flyt: oppdragslisten → «Overstyringer» → åpne gruppe → utgivelse (2 trykk fra siden til utgivelsen).
- **iPad:** samme side, én kolonne, trykkflater minst 44 px, hovedknapper 56 pt.
- **Tom tilstand:** «Ingen sperrer er krysset bort de siste 90 dagene.»
- **Feil:** KI-feil gir «Oppsummeringen kunne ikke lages nå. Prøv igjen senere.», og listen virker fortsatt. Siden virker når KI-porten er av.
- **Uten nett:** siden krever nett (kontorside, planen krever ikke uten nett). Når nettet er borte, vises en tydelig melding i stedet for en tom side, «Lag oppsummering» er grået ut med «Krever nett», og synkstatusen vises som på de andre sidene.
- **Universell utforming:** rødt følges av tekst og ikon, kontrast etter Fjord-paletten, `aria-expanded` på gruppene, axe uten feil.

## Regler
- **Ytelse:** gruppering og telling i SQL, ikke per rad i JavaScript. Testet med 2 000 overstyringer, med tidsgrense og EXPLAIN-sjekk på at `publish_check_results_overridden_idx` brukes og at koblingen mot `claims` går på (organisasjon, oppdrag).
- **90 dager (A572):** `created_at` på resultatraden, i Oslo-dato. Testsaker: dag 89, 90 og 91.
- **Måned (A572):** `report_releases.released_at` i Oslo-tid, også over skiftet til vintertid. Testsak: 31.10 kl. 23:30 Oslo hører til oktober.
- **Prosent (A570):** andel = unike rapporter med overstyringen (kode, punkt, grunn) / unike rapporter publisert i måneden. Skrives «av rapportene som ble publisert», ikke «av badene». Regnet av serveren. Under 5 rapporter: bare antall. Null rapporter: ingen deling på null, KI kalles ikke.
- **Endring fra måneden før:** antall og prosentpoeng per kode og grunn, regnet av serveren.
- **Rød og nøytral (A571):** se Omfang. Testsaker: før utgivelsen (ingen), samme dag (rød), utgivelse kl. 23:30 Oslo og reklamasjon neste dag (rød), annet punkt (ingen), uten punkt (nøytral), slettet sak (ingen), annet oppdrag (ingen), v1 og v2 med samme overstyring (telles én gang), reklamasjon mellom v1 og v2 (v1 rød, v2 ikke), reklamasjon i annen organisasjon med samme `checkpoint_key` (ingen).
- **Lederens tekst (A574):** serveren kontrollerer før lagring: høyst 2000 tegn, ingen elleve sifre på rad, ingen e-post eller telefonnummer, og ikke navnet på en ansatt i organisasjonen (navnene hentes med `grant.organizationId`). Feilmeldinger på norsk, for eksempel «Oppsummeringen kan ikke inneholde navn på ansatte.». Teksten logges aldri; logger og revisjonslogg får bare id, måned og status.

## Akseptkriterier
- [ ] Leder og admin ser siden; takstmann og kontor får «Ingen tilgang» og ser ikke lenken (test per rolle, også med `access.inspectors_edit_all`).
- [ ] Bruker i annen organisasjon ser verken overstyringer, reklamasjoner, kontrollpunkter eller oppsummering (`expectTenantIsolation` for `listPublishOverrides`, `buildOverrideStats`, `getOverrideSummary`, `requestOverrideSummary`, `listClaimCheckpointOptions` og markeringen).
- [ ] Bare overstyrte sperrer siste 90 dager vises, i to nivåer, med antall unike rapporter, versjon og lenke til utgivelsen.
- [ ] Rød og nøytral markering følger reglene over (alle testsakene).
- [ ] Slettet utgivelse, rapport, oppdrag, resultatrad og reklamasjon holdes utenfor listen og tallene (én testsak hver).
- [ ] Ingen navn, ansatt-id, `override_reason` eller reklamasjonstekst i svaret til siden eller i KI-grunnlaget (test på begge).
- [ ] Lekkasjetest mot falsk leverandør med kjente markørstrenger i `override_reason`, `description`, `claimant_text`, `building_part_text`, navn og oppdrags-id; `override_summary` er med i `features.test`, `static-checks` og `no-leak`.
- [ ] Oppsummeringen kan lages, godtas, endres og avvises; forslag og beslutning logges i `ai_usage_log`, og endret tekst ligger i `override_summaries` (test).
- [ ] Lederens tekst med navn, e-post, telefon eller elleve sifre avvises (test per tilfelle).
- [ ] Grensene i `limits.ts` gjelder (test).
- [ ] `pnpm ai:eval override_summary` består med minst 30 saker.
- [ ] Reklamasjonsskjemaet har «Kontrollpunkt» med de bortkryssede punktene øverst og forhåndsvalg ved tydelig treff; kjent kode og tomt felt godtas; ukjent kode, kode fra annen organisasjon og kode fra annet oppdrag gir samme feil (test).
- [ ] Migreringen tåler eksisterende reklamasjoner (test).
- [ ] Ytelse med 2 000 overstyringer, med EXPLAIN-sjekk.
- [ ] E2e på PC og iPad-størrelse: to trykk til utgivelsen, rød og nøytral med tekst og ikon, godta/endre/avvis, «Ingen tilgang» for takstmann, tom tilstand, kontrollpunkt i skjemaet, uten nett-melding, axe uten feil, trykkflater minst 44 px.
- [ ] Versjon økt i `package.json`. Ordlisten oppdatert.

## Testplan (kort)
- **Enhet:** `computeOverrideShare` (null og under 5), `buildOverrideSummaryInput` (zod strict, kodemønster), `classifyClaimMarker` (alle saker under Regler), `rankCheckpointMatch`, `validateSummaryText`, etiketter med ukjent kode.
- **Integrasjon:** listen (gruppering, telling, sortering, grensene for 90 dager og måned, slettede rader), ytelse, lesing av oppsummering i rekkefølgen godtatt → endret → avvist, reklamasjonsskjemaet, migreringen.
- **Tilgang og tenant-isolasjon:** som i akseptkriteriene, også `usageId`-avvisning for takstmann og kontor og at en annen leder kan avgjøre.
- **KI:** lekkasje, vakter, feil fra leverandør, logg, evalueringssett.
- **E2e:** som i akseptkriteriene.

## Lagt til av forbedreren (Ståle 14.11.2026)
1. **Telling uten dobbelttelling ved ny versjon:** unike rapporter per gruppe, prosent av unike rapporter, «v2» ved datoen, rød mot siste utgivelse før reklamasjonen (A570, A571).
2. **Kontrollpunktet velges nesten av seg selv:** bortkryssede punkter øverst, forhåndsvalg fra enkel tekstsammenligning på serveren, og «Denne sperren ble krysset bort ved publisering» på saken (A576).
3. **Endring fra måneden før og bedre månedsvalg:** «økt fra 2 til 7», siste hele måned forhåndsvalgt, «Lag oppsummering» som kort, «Tall for hele måneden» (A577).
4. **Ytelse og indeks:** filteret går på `created_at`, som indeksen dekker; EXPLAIN-sjekk.
5. **Annet-teksten på siden** er ikke tatt inn: det er personvern, og sikkerhet-personvern vil ikke at spørringen henter fritekst. Lagt som spørsmål 123 til Ståle.
- **Nytt planpunkt:** «Erfaringen ved kryssboksen» er lagt inn i planen under «Fra forbedreren» i 2a-2.

## Avgjort ved uenighet (prosjektlederen)
- **Ny tabell `override_summaries` mot «ingen nye tabeller» (ki-ansvarlig mot forbedreren, sikkerhet-personvern og arkitekten):** valgt ny tabell. Teksten leder endrer, må ligge et sted, og `ai_usage_log` skal ikke være lager for innhold eller få KI-forslaget overskrevet. En egen rad gir også en ekte UUID til KI-målet og et oppslag bundet til organisasjonen, så `AiTargetRef` ikke trenger et nytt `period`-felt. «Ingen nye tabeller» var forbedrerens forslag, ikke Ståles beslutning.
- **Hva telles (forbedreren mot arkitekten):** gruppetall og prosent teller unike rapporter (forbedreren), fordi «40 %» ellers blir feil ved ny versjon. Linjene viser hver utgivelse med versjon (arkitekten). Nevneren er alle rapporter publisert i måneden (arkitekten), ikke utgivelser med sperren, som alltid ga 100 %.
- **Rød mot hvilken utgivelse:** siste utgivelse før reklamasjonen (forbedreren). Den sier hva kunden faktisk fikk.
- **Tre eller to nivåer:** to (UX), fordi det gir 2 trykk til utgivelsen.
- **Forhåndsvalg mot «Ikke valgt» øverst:** forhåndsvalg bare ved tydelig treff (forbedreren), ellers «Ikke valgt» (UX).
- **Rettighet for beslutning:** `claims.manage` (ADR 0006 del 10). Leder og admin har begge, ingen stenges ute.

## Beslutninger tatt i autonom modus (føres i `docs/09-apne-sporsmal.md`)
Numrene er flyttet fra A526–A531 (A526 er brukt på main, A530–A542 av `pdf-motor-badet`, A550–A563 av `skriv-det-du-ser`) til A564–A577.
- **A564 (dyrt å endre):** `claims.checkpoint_key` som valgfri kolonne med CHECK for nøkkelformat, migrering 0039, ingen ny indeks.
- **A565 (lett å endre):** siden og «Lag oppsummering» krever `claims.read`; godta, endre og avvise krever `claims.manage`.
- **A566 (lett å endre):** reklamasjon uten punkt gir nøytral markering med lenken «Velg kontrollpunkt», ikke rød.
- **A567 (dyrt å endre):** ny tabell `override_summaries` for lederens tekst; KI-målet peker på raden.
- **A568 (dyrt å endre):** ny KI-funksjon og måltype `override_summary`; organisasjonsmål uten oppdrag er lov for ekte leverandør når bare faste koder, etiketter og tall sendes (tillegg til ADR 0006).
- **A569 (lett å endre):** bare sperrer, ikke advarsler; ingen navn og ingen fritekst på siden (spørsmål 100 og 123).
- **A570 (lett å endre):** telling av unike rapporter; prosent av rapporter publisert i måneden; under 5 rapporter bare antall.
- **A571 (lett å endre):** rød mot siste utgivelse med Oslo-dato til og med reklamasjonsdatoen; samme dag er rød.
- **A572 (lett å endre):** 90 dager på `created_at` (dag 90 med), måned på `released_at`, begge i Oslo-tid.
- **A573 (lett å endre):** til KI går bare koder, tall, punktnavn fra malversjonen og faste etiketter.
- **A574 (lett å endre):** kontroll av lederens tekst (lengde, sifre, e-post, telefon, ansattnavn).
- **A575 (lett å endre):** grenser: ett åpent forslag per måned, 5 per leder per time, 20 per organisasjon per døgn.
- **A576 (lett å endre):** kontrollpunkt i reklamasjonsskjemaet med bortkryssede punkter øverst og forhåndsvalg ved tydelig tekstreff, uten KI.
- **A577 (lett å endre):** fire månedsknapper, siste hele måned valgt, endring fra måneden før i grunnlaget.

## Åpne spørsmål
- Spørsmål 100 (overstyringer per takstmann) står åpent. Bygges uten personfilter. Tillegg 24.11.2026 fra sikkerhet-personvern: oversikten kan være et kontrolltiltak også uten navn (få takstmenn, navnet ett trykk unna); skal den drøftes med de ansatte før ekte data? Ført som S12 i planen.
- Spørsmål 123: skal «Annet»-begrunnelsen kunne leses samlet på siden (forbedreren)?

## Roller
- `arkitekt`: tabell, kolonne, migrering, ADR-tillegg, typer, ytelse.
- `ux` og `ui`: siden, markeringene, månedsknappene, kontrollpunkt i skjemaet.
- `ki`: `override_summary`, ledetekst, tillatt-liste, vakter, falsk leverandør, evalueringssett.
- `sikkerhet-personvern`: tillatt-listen og «aldri»-listen, endringen i `isBlocked` (A175), kontroll av lederens tekst.
- `domene` trengs ikke: ingen fagtekster, regler eller TG.
- `utvikler` og `testskriver` i parallell.
