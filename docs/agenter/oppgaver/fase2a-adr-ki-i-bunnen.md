# Funksjon: ADR 0006 – KI i bunnen

- **Fase:** 2a-1 KI-grunnmuren (første punkt)
- **Modul:** kjerne (`src/core/ai`, KI-porten i `src/core/integrations`). Bare dokumentasjon, ingen produktkode.
- **Status:** utkast, rettet etter forhåndsvurdering runde 1 (arkitekt, sikkerhet-personvern, test-leder)
- **Branch:** `fase2a-adr-ki-i-bunnen` (bygger på `main`)
- **Støtter hovedmål:**
  - **KI i bunnen:** legger grunnmuren som alle KI-funksjoner bygges på. Én vei inn, samme forslagsmønster overalt, logg over nytten.
  - **De ansatte:** forslag vises likt overalt og kan alltid angres. Takstmannen kontrollerer og godkjenner, og har siste ord.
  - **Reklamasjoner:** KI setter aldri TG, og ingen KI-tekst kommer i en publisert rapport uten godkjenning. Evalueringssett hindrer at dårlig KI slås på.

## Problem
De neste punktene i 2a-1 (KI-modulen og loggen, forslagsmønsteret, vask, evalueringssett, kø) og alle KI-funksjoner i 2a-2 og senere må bygges likt. Uten en felles beslutning lager hver funksjon sin egen vei til KI, sin egen lagring av forslag og sin egen vask. Da blir personvernet vanskelig å kontrollere, nytten kan ikke måles, og det blir dyrt å bytte leverandør.

## KI i bunnen
- Oppgaven **er** KI-grunnmuren på papir. Ingen KI kjører i denne oppgaven.
- ADR-en bestemmer hvilke data som lagres for KI: forslaget med kilde (funksjon, leverandør, modell, versjon av ledetekst, hvilke felt som var grunnlaget), status og hva den ansatte gjorde. Det gjør at KI senere kan bruke godkjente tekster og avvisninger som læring (3a), og at nytten kan måles.
- Alt går gjennom `src/core/ai`. Ingen modul snakker med en leverandør direkte. Dette håndheves med lint-regel (bestemmes i ADR-en, bygges i neste punkt).

## Brukerhistorier
- Som **utvikler** vil jeg ha én beskrevet vei til KI, slik at hver ny KI-funksjon bygges på samme måte.
- Som **takstmann** vil jeg at alle KI-forslag ser like ut og kan godtas, endres, avvises og angres, slik at jeg aldri lurer på hva som er KI og hva som er mitt.
- Som **Ståle** vil jeg kunne bytte KI-leverandør uten at funksjonene må skrives om, og se hva KI koster og hvor mye den hjelper.

## Omfang
**Med:**
- `docs/adr/0006-ki-i-bunnen.md` med overskriftene `# ADR 0006 – KI i bunnen`, Status og Dato, Beslutning(er), Hvorfor, Forkastet og Konsekvenser (som ADR 0004 og 0005), og disse elleve delene:
  1. **Modulen `src/core/ai`:** offentlig flate med to funksjoner (be om forslag, registrere beslutning) som begge tar `EmployeeGrant`, aldri en organisasjons-ID fra kalleren. Mapper. Ledetekstene ligger versjonert i `src/core/ai`; modulene sender aldri egen ledetekst, bare funksjonskode og felt. `src/core/ai` importerer aldri fra en modul (regel 4): modulen sender for eksempel godkjente fraser inn som kandidater. Klientdelen av modulen importerer aldri nøkler eller adaptere.
  2. **KI-porten** i tilkoblingslaget: `ports.ts` har bare de faste kodene. Grensesnittet og adapterne ligger i `src/core/ai/providers/`, og leverandørens SDK importeres bare der (lint-regel og statisk test som i `static-checks.test.ts`). Bare `src/core/ai` kan bruke porten `ai`. Valg av leverandør per organisasjon via `integration_connections`, nøkkel bare via `readSecret` (aldri i `integration_connections`, `ai_usage_log` eller logg). Tale til tekst er egen port (`speech_to_text`) med egen tilkobling, men går gjennom `src/core/ai`. Bytte av leverandør som nummererte steg: ny kode i `PROVIDER_CODES.ai`, adapter i `providers/`, nøkkel via `readSecret`, rad i `integration_connections`, evalueringssettet kjøres på nytt. Ingen endring i funksjonene. Forutsetninger før en ekte leverandør legges inn: S8 avgjort, databehandleravtale, behandling i EU/EØS, ingen trening på våre data, ingen lagring hos leverandøren ut over kallet, oppdatert personvernerklæring.
  3. **Falsk leverandør (`fake`):** forutsigbare svar, null kostnad. Brukes i utvikling, test, CI og testmiljøet. I drift uten aktiv tilkobling er KI av. En ekte leverandør velges aldri fra miljøvariabler (ulikt `resolveEmailSender`). Bare `fake` kommer i `PROVIDERS_BY_PORT.ai` før S8.
  4. **Forslag:** én tabell, `ai_usage_log`, én rad per kall (ingen egen forslagstabell). Status `suggested` / `accepted` / `edited` / `rejected` erstatter `decision` (tabellen er ikke bygget, ingenting arkiveres). Utfallet av kallet er eget felt (ok, ingen treff, feil), ikke en status. Forslaget ligger aldri i verdien før det er godtatt (samsvar med ADR 0004), så publiseringssperren er en enkel kontroll på serveren. Angre: hva som skjer med `status` og `answers.ai_usage_id`, og at statusendringer går i revisjonsloggen. Merkingen er generell, fordi KI-tekst også havner utenfor `answers` (avvik, sammendrag, `peer_review_comments`, ordre fra e-post, fraser med `ai_draft`).
  5. **`ai_usage_log`:** feltene fra 4.12 pluss felles kolonner med `organization_id`, `prompt_version`, `source_fields` (bare feltkoder, aldri verdier), `assignment_id`, `report_id` som kan være tom, `target_ref` (type, id og feltkode), utfall, `cost` og `currency`, sammensatt fremmednøkkel med `organization_id`. Id-en er forespørselens UUID v7 fra enheten, så nytt forsøk gir ikke dobbel rad. `input_summary` er bare feltnavn, referanser og antall, aldri tekst. Tabellen regnes som personopplysninger (`output_text` kan inneholde noe som slapp gjennom): myk sletting (`deleted_at`), 10 år (`retain_until`), egen rad i den interne personvernerklæringen når den bygges. Ledetekst, inndata og svar skrives aldri til `logger`; feil fra leverandøren logges uten innhold.
  6. **Vask før KI:** tillatt-liste, ikke bare fjerning. Hver funksjon har en fast liste over felt den kan sende, og `src/core/ai` bygger inndata bare fra den. Felt som aldri kan stå på listen, med tabell og kolonne: `contacts` (navn, e-post, telefon), `firms.note`, partene på oppdraget, `orders` (adresse og matrikkel som tekst, notater), `properties` (adresse), `cadastral_units` (gårds-, bruks-, feste-, seksjons-, andels- og aksjenummer), `common_areas` (borettslag eller sameie, `association_name`, forretningsfører), `claims` (fritekstene), `employees`, og fødselsnummer. Fritekst (premisser, notater, kommentarer) vaskes i tillegg med mønstre (e-post, telefon, fødselsnummer, organisasjonsnummer, gnr/bnr) og med oppdragets kjente verdier (navn på parter, kontakter og ansatte, adresse, matrikkel), som erstattes med faste merker, for eksempel `[navn]`. Mønstrene deles med loggeren i `src/shared`, ikke kopiert. Vasken har tester med oppdiktede eksempler. ADR-en sier ærlig at fritekst har restrisiko, og at databehandleravtale derfor kreves uansett. Tale og bilde (2b) kan ikke vaskes: samme modul, EXIF og GPS fjernes fra bilder, og tale og bilde til ekte leverandør krever egen vurdering av Ståle.
  7. **Hva KI aldri gjør:** KI setter aldri TG (TG-forslag kommer bare fra regelmotoren), publiserer aldri, sender aldri e-post eller SMS. KI har ingen verktøy, svaret er bare tekst, kjøres aldri som kommando og vises escapet. Inndata (e-post til ordreforslag, fritekst) er ikke til å stole på.
  8. **KI velger fra det godkjente:** frasebanken først, «ingen treff» i stedet for oppdiktet tekst. Læring fra godkjente tekster (3a) krysser aldri organisasjoner.
  9. **Evalueringssett:** i repoet, bare oppdiktede eksempler (aldri ekte rapporttekst eller kundedata, ingen tekst fra NS 3600, IVIT eller SmartTakst). Format, fasit, kommando og treffgrense før en funksjon slås på.
  10. **KI-kø uten nett:** køen ligger bare lokalt på iPaden, ingen ny status. Vises som «venter på KI». Tømmes ved utlogging og sperring (ADR 0004). Vask og leverandørkall skjer bare på serveren, iPaden snakker aldri med leverandøren, og tilgang sjekkes på nytt når køen behandles.
  11. **KI av/på:** nøkkelen `ai.enabled` i `organizations.settings` (tabellen `settings` er ikke bygget). Ekte leverandør krever i tillegg en aktiv tilkobling: to låser. Bare admin endrer, og endring av bryter og leverandør logges i `audit_log`. Alt virker uten KI.
- Tilgang i ADR-en (tabellen under), med rettighetene som finnes i `src/core/access`. Ingen ny rettighet.
- Rette `docs/05-domenemodell.md` 4.7, 4.10 og 4.12 og ordlisten i avsnitt 8, slik at statusene og feltene er like i ADR-en, domenemodellen, punkt 11 i `docs/06-arkitektur.md` og «KI-forslag» i `docs/adr/0004-drift-uten-nett.md`.
- Rette `docs/06-arkitektur.md`: punkt 11 viser til ADR 0006, og linjen under «Personvern og sikkerhet» sier at adresse og matrikkel **aldri** sendes til KI (i dag står «uten at det er vurdert», i strid med regel 14).
- Beslutninger som agentene tar, føres i `docs/09-apne-sporsmal.md` fra **A148** (A136–A147 er brukt av malmotoren, PR #119), merket «lett å endre» eller «dyrt å endre».
- Spørsmål til Ståle i `docs/09-apne-sporsmal.md` (ikke A-beslutninger): restrisiko i fritekst, tale og bilde til ekte leverandør, om avviste forslag skal ligge i 10 år, og når de ansatte eventuelt sier ja til tall per person.
- Krysse av punktet i `docs/07-utviklingsplan.md`, én linje i `docs/plan/endringslogg.md` hvis planteksten endres.
- Versjon i `package.json`: 0.4.1 → **0.4.2**. Malmotoren (PR #119) har også 0.4.2: den som merges sist, øker én patch.

**Ikke med (bevisst utelatt):**
- Ingen produktkode, ingen migrering, ingen tabeller, ingen lint-regel. `src/core/integrations/ports.ts` er uendret (`ai: []`); `fake` legges inn i «KI-modulen og loggen».
- Ikke valg av ekte KI-leverandør eller pris. Det er beslutningsnotatet (siste punkt i 2a-1) og S8.
- Ikke tale til tekst og bilde til tekst (fase 2b). ADR-en sier bare at de går gjennom samme modul.
- Ingen skjermer og ingen skisser av forslagsvisningen (forslagsmønsteret er eget punkt).
- Ingen innhold i evalueringssett, bare oppsettet.
- Ingen nye tester og ingen nye avhengigheter.

## Tilgang
ADR-en beskriver tilgangen, ingen kode nå. Ingen ny rettighet:

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Forslag på oppdrag de kan endre | Be om, godta, endre, avvise forslag der de har `report.edit` eller `assignment.edit` |
| kontor | Forslag på oppdrag de kan endre | Samme, der de har `assignment.edit` |
| leder | Samlede tall per funksjon og periode (antall, status, kostnad), uten forslagstekst og aldri per ansatt (`statistics.read`). Forslag i reklamasjonssaker (`claims.read`) | Forslag i reklamasjonssaker (`claims.manage`) |
| admin | Alt, også én rad til feilsøking og reklamasjon (`organization.manage`), også når KI er av | KI av/på og leverandør (`organization.manage`) |

- Å be om og avgjøre et forslag krever samme rettighet som å endre feltet forslaget gjelder. Forslag i reklamasjonssaker følger saken (bare leder og admin).
- `decided_by` settes fra tilgangssjekken, aldri fra klienten.
- Det lages ingen spørring eller visning per ansatt før de ansatte har sagt ja (arbeidsmiljøloven kap. 9, som A121).
- Admin stenges aldri ute.
- All tilgang sjekkes i `src/core/access`. Spørringer filtrerer på `grant.organizationId`. Når tabellene bygges: `organization_id` på all KI-data, `expectTenantIsolation` og rad i `tests/tenant-tables.ts`.

## Data
Bare i dokumentasjonen: `ai_usage_log` (4.12) får feltene i del 5, ingen egen forslagstabell. Faste koder som beskrives: leverandør `fake` på porten `ai`, port `speech_to_text`, status `suggested` / `accepted` / `edited` / `rejected`, utfall (for eksempel `ok` / `no_match` / `error`), innstillingen `ai.enabled`, funksjonen `language_polish` (prøvefunksjonen i «Ferdig når»).

## Skjermer
Ingen.

## Regler
Ingen nye fagregler. ADR-en slår fast at TG-forslag kommer fra regelmotoren, aldri fra KI.

## Akseptkriterier
- [ ] `docs/adr/0006-ki-i-bunnen.md` finnes, har overskriftene `# ADR 0006 – KI i bunnen`, Status og Dato, Beslutning(er), Hvorfor, Forkastet og Konsekvenser, og alle elleve delene under «Med» kan finnes igjen.
- [ ] ADR-en sier med disse ordene: KI «setter aldri TG», «publiserer aldri», «sender aldri», og bare `src/core/ai` kan bruke porten `ai` (lint-regel og statisk test).
- [ ] Vaskelisten har tabell og kolonne for hvert felt, med festenummer, fødselsnummer, `association_name` og fritekst. Organisasjonsnummer og e-post i fritekst er med. Kravet om vasketester med oppdiktede eksempler står.
- [ ] Bytte av leverandør er nummererte steg (ny kode i `PROVIDER_CODES.ai`, nøkkel via `readSecret`, rad i `integration_connections`, evalueringssettet kjøres på nytt) med forutsetningene fra del 2, og krever ingen endring i funksjonene.
- [ ] Statusene, utfallet, angre og feltene er like i ADR-en, 4.7, 4.12, ordlisten i avsnitt 8, punkt 11 i `docs/06-arkitektur.md` og «KI-forslag» i ADR 0004. 4.7 sier ikke lenger bare «hvis teksten ble godkjent».
- [ ] `docs/06-arkitektur.md` sier at adresse og matrikkel aldri sendes til KI.
- [ ] ADR-en sier: myk sletting (`deleted_at`), 10 år (`retain_until`), aldri fritekst i `input_summary`, aldri innhold i `logger`.
- [ ] ADR-en har tilgangstabellen over, sier at leder ser samlede tall uten forslagstekst og aldri per ansatt, at kostnad står på raden (`cost`, `currency`), og at admin aldri stenges ute og alltid kan slå KI av og på og se loggen, også når KI er av. Rettighetene som brukes, er de som finnes.
- [ ] ADR-en krever `organization_id` på all KI-data, filter på `grant.organizationId`, `expectTenantIsolation` og rad i `tests/tenant-tables.ts` når tabellene bygges.
- [ ] Ordlisten har forslag, falsk leverandør, vask, evalueringssett og KI-kø.
- [ ] Beslutningene står i `docs/09-apne-sporsmal.md` fra A148, hver med «lett å endre» eller «dyrt å endre». De fire spørsmålene til Ståle står som spørsmål, ikke som A-beslutninger.
- [ ] Ingen modellnavn eller leverandørnavn i eksemplene, ingen kundeopplysninger, ingen tekst fra NS 3600, IVIT eller SmartTakst, ingen sitater fra `docs/kartlegging/`.
- [ ] Diffen rører bare `docs/` og `package.json`. Versjon 0.4.2. `ports.ts` er uendret. `pnpm lint`, `pnpm typecheck` og `pnpm test` er grønne (`pnpm test:e2e` bare hvis CI krever det).
- [ ] Punktet er krysset av i planen, og endringsloggen har én linje hvis planteksten er endret.
- [ ] Godta, endre, avvise og tenant-isolasjon prøves ikke nå (ingen kode). Testplanen i «KI-modulen og loggen» skal ha tenant-isolasjon for hver spørring, tester per rolle, admin ikke stengt ute, myk sletting og vasketester mot falsk leverandør.

## Avgjort av prosjektlederen (runde 1)
- **A-numre fra A148, ikke A136** (test-leder T7 mot arkitekt 1): A136–A147 er tatt av malmotoren i PR #119. Arkitekten har rett.
- **Én tabell (`ai_usage_log`), ikke egen forslagstabell** (arkitekt 6): det enkleste som virker, og `answers.ai_usage_id` peker dit fra før.
- **Ingen ny rettighet** (test-leder 5, sikkerhet 3, arkitekt 14): `organization.manage` for KI av/på, leverandør og oppslag på én rad (bare admin), `statistics.read` for samlede tall (leder og admin, aldri per person, som A121). Å be om og avgjøre et forslag følger rettigheten for feltet.
- **`fake` legges ikke inn i `ports.ts` nå** (test-leder T10 og sikkerhet 5 stemmer): oppgaven er bare dokumentasjon.
- **Fire spørsmål går til Ståle i 09, ikke som A-beslutninger** (sikkerhet): de gjelder personvern, som er Ståles område også i autonom modus.

## Roller
- **arkitekt:** skriver ADR-en og oppdaterer domenemodell og arkitektur.
- **ki-ansvarlig:** forslagsmønster, evalueringssett, «velger fra det godkjente», kø.
- **sikkerhet-personvern:** vask, hva som aldri sendes, tilgang og logg.
- Ikke `utvikler` og `testskriver` (ingen kode), ikke UX/UI (ingen skjermer), ikke fagansvarlig (ingen fagtekster).

## Åpne spørsmål
- Ingen som stopper ADR-en. Leverandørvalg og databehandleravtale ligger i S8. Det ADR-en avgjør selv, føres som A148 og videre. Restrisiko i fritekst, tale og bilde, oppbevaring av avviste forslag og tall per person føres som spørsmål til Ståle.
