# Funksjon: KI-modulen og loggen

- **Fase:** 2a-1 KI-grunnmuren (andre punkt)
- **Modul:** kjerne (`src/core/ai`), tabell i `src/db/schema`, leverandørkode i `src/core/integrations/ports.ts`, seed i `src/db/seed/sample-assignments.ts`
- **Status:** klar til bygging (rettet etter forenkler, KI-ansvarlig, sikkerhet og personvern og testleder 10.11.2026)
- **Branch:** `fase2a-ki-modul-logg`
- **Bygger på:** `main` (ADR 0006 er merget i PR #123, ryddingen i PR #124). Kortet og testplanen er flyttet oppå `main` 10.11.2026.
- **Grunnlag:** `docs/adr/0006-ki-i-bunnen.md` del 1, 3, 4, 5 og «Avgrensning for 2a-1» under Konsekvenser. `docs/05-domenemodell.md` 4.12.
- **Støtter hovedmål:**
  - **KI i bunnen:** bygger den ene veien inn til KI og loggen som viser nytten. Alle KI-funksjoner i 2a-2 og senere bygges oppå denne.
  - **De ansatte:** alt kan bygges og prøves mot en falsk leverandør. I testmiljøet får de ansatte prøvd KI-forslag i prøveorganisasjonen uten kostnad og uten at data sendes ut. Ingen tall per person.
  - **Reklamasjoner:** loggen viser hvem som godtok hvilket forslag, og når. Det er grunnlaget for sperren mot publisering med KI-tekst som ikke er godkjent (neste punkt).

## Problem
ADR 0006 beskriver KI-grunnmuren på papir. Ingen kode finnes. Uten modulen, tabellen og den falske leverandøren kan ingen av de neste punktene (forslagsmønsteret, vask, evalueringssett, kø) eller KI-funksjonene i 2a-2 bygges eller prøves. Lar vi være, vil hver funksjon lage sin egen vei til KI.

## KI i bunnen
- **Oppgaven er KI-grunnmuren i kode.** All KI går gjennom `src/core/ai` med to funksjoner: `requestSuggestion(grant, request)` og `recordDecision(grant, usageId, decision)`. Begge tar `EmployeeGrant` fra `requireOrganizationAccess`, aldri en organisasjons-ID fra kalleren.
- **Data som lagres for KI:** én rad i `ai_usage_log` per kall: funksjon, leverandør, modell, ledetekstversjon, mål (`target_ref`), hvilke felt som var grunnlaget (bare koder), utfall, forslaget, status, hvem som avgjorde og når, mengde og kostnad.
- **Ingen ekte KI kjører.** Bare den falske leverandøren `fake`, med null kostnad og uten nettverkskall. En statisk test sikrer at `PROVIDERS_BY_PORT.ai` bare har `fake` til vasken og S8 er på plass.
- KI setter aldri TG, publiserer aldri og sender aldri (ADR 0006 del 7). Et TG-felt kan ikke være mål.

## Brukerhistorier
- Som **utvikler** vil jeg kalle `requestSuggestion` og `recordDecision` fra `src/core/ai`, slik at hver ny KI-funksjon bygges likt og logges.
- Som **takstmann** vil jeg at forslaget jeg godtar, endrer eller avviser, blir registrert med mitt navn fra innloggingen, slik at det alltid er klart hva som er KI og hva som er mitt.
- Som **Ståle** vil jeg at alt kan prøves uten kostnad før jeg velger leverandør (S8).

## Omfang
**Med:**
1. **Tabellen `ai_usage_log`** (skjema i `src/db/schema/ai-usage-log.ts` og migrering), med feltene i ADR 0006 del 5:
   - felles kolonner fra `src/db/schema/common.ts` (`organization_id`, sporingsfelt, `deleted_at`/`deleted_by`, `row_version`)
   - `id` er forespørselens UUID fra kalleren (`requestId`)
   - `employee_id`, `feature`, `provider`, `model`, `prompt_version`, `assignment_id` (kan være tom), `report_id` (kan være tom, ingen fremmednøkkel, A158), `target_ref` (jsonb: type, id, feltkode), `source_fields` (bare feltkoder), `input_summary` (bare feltnavn og antall tegn, aldri tekst), `outcome`, `error_code`, `output_text`, `status`, `decided_by`, `decided_at`, `tokens_in`, `tokens_out`, `cost` (numeric, ikke flyttall), `currency` (`NOK`), `retain_until` (påkrevd, settes av tjenesten til opprettet + 10 år, samme mønster som `src/core/files/retention.ts`)
   - sammensatte fremmednøkler med `organization_id` til `employees` (både `employee_id` og `decided_by`) og `assignments`
   - sjekk i databasen: `status` og `output_text` er tomme når `outcome` ikke er `ok`, og `status` er satt når `outcome` er `ok`
   - ført i `tests/tenant-tables.ts` med radbygger og testfil
2. **`src/core/ai`** med offentlig flate i `index.ts` (typene og de to funksjonene fra ADR 0006 del 1). Mappestrukturen er retning; undermapper lages bare når det er mer enn én fil. `index.ts` eksporterer ingenting som lister eller teller rader per ansatt (spørsmål 57).
3. **`requestSuggestion`**, i denne rekkefølgen. Alle avslag før kallet gir: ingen rad, intet kall til leverandøren, ingen linje i `audit_log`.
   1. `request` valideres strengt: `requestId` er UUID; `feature` er en kjent kode (ukjent gir feil); `target` har bare `type`, `id` (UUID) og `fieldKey`, og `type` og `fieldKey` står på funksjonens lister over lovlige mål; `reportId` må være tom i denne leveransen (`reports` finnes ikke); `candidates` må være tom eller mangle (ingen funksjon bruker dem ennå); hver verdi i `fields` er høyst 5 000 tegn.
   2. Rettigheten sjekkes med `grantHasPermission` fra `src/core/access`, ikke egen logikk på `grant.roles`. Admin slipper alltid til.
   3. Alle feltkoder i `fields` står på funksjonens tillatt-liste. Ukjent felt gir feil.
   4. `assignmentId` (hvis satt) slås opp med `grant.organizationId` og `deleted_at is null`. Ukjent eller slettet oppdrag gir samme nøytrale avslag som annen ugyldig forespørsel, ikke en databasefeil.
   5. Samme `requestId` på nytt (ikke slettet rad, samme organisasjon og samme ansatt, samme funksjon og samme mål) gir svaret fra første gang uten nytt kall. Samme id med annen funksjon eller annet mål, eller en id som finnes hos en annen organisasjon eller ansatt, gir det nøytrale avslaget. Raden til en annen leses aldri tilbake, og det brukes ingen `onConflictDoUpdate`.
   6. KI av (se Omfang 6): svaret `disabled`, ingen rad.
   7. Ledeteksten bygges og leverandøren kalles. Unntak fra leverandøren fanges og gir `outcome = error`, `error_code = unknown`. Feilobjektet og meldingen sendes aldri videre.
   8. Én transaksjon: ny rad settes inn (med `on conflict do nothing` på id, så to samtidige kall med samme id gir én rad og samme svar), og det forrige forslaget på **samme mål** som fortsatt er `suggested` og ikke slettet, settes til `rejected` med `decided_by` fra `grant`. Den endringen skrives i `audit_log` i samme transaksjon.
   - **Samme mål** = samme organisasjon, samme `feature` og samme `target_ref` (type, id, feltkode), uansett hvilken ansatt som ba om forslaget (alle takstmenn kan endre alt, `access.inspectors_edit_all`).
4. **`recordDecision`**: avgjørelsen kan tas av hvem som helst i samme organisasjon som har rettigheten funksjonen krever, også en annen enn den som ba om forslaget. Raden slås opp med `grant.organizationId` og `deleted_at is null`; slettet eller ukjent rad gir samme nøytrale avslag. Bare rader med utfall `ok`. `decided_by` og `decided_at` settes fra `grant` og serverens klokke. Statusendringen og linjen i `audit_log` skrives i samme transaksjon. `changes` i `audit_log` har bare gammel og ny status, aldri `output_text` eller feltverdier.

   **Lovlige endringer** (alt annet gir feil, ingen endring og ingen linje i `audit_log`):

   | Fra | `accepted` | `edited` | `rejected` | `undo` |
   |---|---|---|---|---|
   | `suggested` | lov | lov | lov | feil |
   | `accepted` | ingen endring (gjentatt kall) | feil, angre først | feil, angre først | lov → `suggested` |
   | `edited` | feil, angre først | ingen endring (gjentatt kall) | feil, angre først | lov → `suggested` |
   | `rejected` | feil | feil | ingen endring (gjentatt kall) | lov → `suggested`, men feil hvis det finnes et nyere forslag på samme mål som ikke er slettet |

   «Ingen endring» betyr at et gjentatt kall fra iPaden går gjennom uten ny linje i `audit_log`. Ved `undo` tømmes `decided_by` og `decided_at`. Regelen mot `undo` når et nyere forslag finnes, gjør at det aldri kan være to `suggested`-forslag på samme mål.
5. **Én funksjonsdefinisjon:** `language_polish` (prøvefunksjonen i «Ferdig når» for 2a-1): fast kode, rettighet `report.edit`, tillatt-liste med én feltkode for teksten (`text`), lovlige mål (én måltype og én feltkode, for eksempel `answer` og `text`; endelige navn velges av utvikler og står i definisjonen), ledetekstversjon `language_polish.v1`. Ledeteksten er en kort, egen formulering. Ingen treffgrense ennå; den legges til med evalueringssettet.
   - Statisk test: ingen funksjonsdefinisjon har et TG-felt som mål (feltkode `tg` eller som starter med `tg_`) eller et felt fra sperrelisten i ADR 0006 del 6 («aldri på tillatt-liste») på tillatt-listen. Sperrelisten ligger fast i testen.
6. **Falsk leverandør `fake`** (`AiProvider` fra ADR 0006 del 2): forutsigbare svar, null kostnad (`cost = 0`, `currency = NOK`), modellkoden `fake-v1`, ingen nettverkskall. Samme inndata gir samme svar. Faste prøveverdier gir `no_match` og `error` (med en kode fra den faste listen), slik at alle utfall kan prøves. `fake` føres i `PROVIDERS_BY_PORT.ai`.
7. **Valg av leverandør: én vei.** Leverandøren kommer bare fra en aktiv rad i `integration_connections` med `port = ai` (via `findActiveConnection`, som også regner status `error` som aktiv; det er ment slik, fordi `error` bare betyr at siste kall feilet). KI er av (`disabled`) når `ai.enabled` ikke er sann, når det ikke finnes en aktiv rad, eller når raden har en leverandørkode koden ikke har adapter for. Ingen reserve til `fake` ut fra `NODE_ENV`, og miljøvariabler kan aldri velge leverandør. Testene lager raden med en fabrikk. ADR 0006 del 3 er rettet tilsvarende (A160).
8. **Seed:** `pnpm db:seed:testoppdrag` slår på KI med `fake` i **prøveorganisasjonen** (den som har `settings.sampleData = true`). Den kjøres i utvikling, CI og testmiljøet, så de ansatte kan prøve KI i testmiljøet. `pnpm db:seed` (Byggcon) rører ikke KI. Seed:
   - setter `ai.enabled = true` bare når nøkkelen mangler, og endrer ikke andre nøkler i `settings`
   - lager tilkoblingen med `fake` bare når organisasjonen ikke har noen rad på porten `ai` (også deaktiverte og slettede teller)
   - endrer aldri en rad som finnes, lager aldri annet enn `fake`, og rører aldri en organisasjon uten `sampleData`
   - tåler å kjøres to ganger. `start.sh` oppdateres hvis oppsettet endres.
9. **Statiske kontroller** i `src/core/ai/static-checks.test.ts` (samme mønster som `src/core/integrations/static-checks.test.ts`, ingen ny ESLint-regel):
   - portene `"ai"` og `"speech_to_text"` står bare i `src/core/ai/**`, `src/core/integrations/ports.ts`, `src/db/seed/sample-assignments.ts` og testfiler. Testen prøver også mønsteret mot en kort tekst i minnet, så den ikke kan være hul.
   - ingen `.delete(` på `aiUsageLog`
   - ingen `console.` og ingen `process.env` i `src/core/ai` (`NODE_ENV` og andre verdier leses via `src/shared/config/env.ts` hvis de trengs)
   - `PROVIDERS_BY_PORT.ai` er nøyaktig `["fake"]`. Testen fjernes bare i punktet som bygger vasken, sammen med S8.
   - At `src/core/ai` ikke importerer fra moduler, håndheves allerede av `eslint-rules/module-boundaries.js`. Ingen ny kontroll.
10. **Ingen logging av innhold:** feil fra leverandøren logges bare med funksjon, leverandørkode, `error_code` og id. Vist med én oppførselstest på feilveien (spion på `logger`), ikke et tekstsøk.
11. **Personvern:** ny rad for `ai_usage_log` i `docs/personvern/intern-personvernerklaering.md` (hva: hvem som ba om og avgjorde forslaget, forslagsteksten, feltkoder og antall tegn; formål: KI-forslag som den ansatte kontrollerer, og sporbarhet ved reklamasjon; hvor: database; hvor lenge: 10 år, myk sletting, spørsmål 56; hvem ser: ingen skjerm, ingen tall per person). Raden for `audit_log` får en setning om at den nå også har én linje per avgjort eller angret KI-forslag med hvem som gjorde det (spørsmål 57). Tabellen føres i `docs/personvern/sletting-av-betadata.md` der prøvedata listes.
12. `docs/05-domenemodell.md` (4.12 og ordlisten) oppdateres om noe avviker fra ADR-en. Versjon i `package.json` økes én patch over `main` (0.4.4 → 0.4.5).

**Ikke med (bevisst utelatt):**
- Ingen skjermer, knapper eller visning av forslag (neste punkt: forslagsmønsteret).
- Ingen ekte leverandør, ingen SDK, ingen nøkkel (S8).
- Ingen admin-skjerm for KI av/på eller tilkobling. Settes bare med seed.
- Ingen vask av fritekst (mønstre og kjente verdier). Bare tillatt-listen som avviser ukjente felt. Vasken er eget punkt.
- Ingen logikk, vask eller tester for `candidates` og `candidateId`. Typene står som i ADR-en; `candidates` avvises hvis de er med. Kommer med første frasefunksjon i 2a-2.
- Ingen treffgrense, evalueringssett eller `pnpm ai:eval` (eget punkt).
- Ingen KI-kø (eget punkt).
- Ingen sperre på `settings.features` (etter S8).
- Ingen samlede tall eller visning for leder og admin, og ingen spørring eller filter per ansatt (spørsmål 57), heller ikke på KI-linjene i `audit_log`.
- Ingen publiseringssperre og ingen `ai_usage_id` på andre tabeller (kommer med forslagsmønsteret og når tabellene bygges).
- Ingen fremmednøkkel til `reports`: tabellen finnes ikke ennå (A158).
- Ingen ESLint-regel for portene (statisk test holder, A161).
- Tale til tekst (2b). Porten `speech_to_text` sperres bare i den statiske testen.

## Tilgang
Ingen ny rettighet (A156). All tilgang sjekkes i `src/core/access` (`grantHasPermission`).

| Rolle | Be om forslag (`language_polish`) | Avgjøre og angre |
|---|---|---|
| takstmann, `access.inspectors_edit_all` på | Ja (`report.edit`) | Ja, også forslag en annen ba om |
| takstmann, `access.inspectors_edit_all` av | Nei (mister `report.edit`) | Nei |
| kontor | Nei (mangler `report.edit`) | Nei |
| leder | Ja | Ja |
| admin | Ja, også med innstillingen av; stenges aldri ute | Ja |

Ved avslag: ingen rad, intet kall, ingen linje i `audit_log`.

## Data
- Ny tabell `ai_usage_log` (se Omfang 1). Oppdater `docs/05-domenemodell.md` 4.12 hvis noe avviker.
- Ny innstilling: `ai.enabled` i `organizations.settings` (standard av).
- Nye faste koder: funksjon `language_polish`, leverandør `fake` (port `ai`), modell `fake-v1`, ledetekstversjon `language_polish.v1`, utfall `ok`/`no_match`/`error`, status `suggested`/`accepted`/`edited`/`rejected`, feilkoder `timeout`/`rate_limited`/`unavailable`/`rejected`/`unknown`.
- Tabellen regnes som personopplysninger (A157): myk sletting, `retain_until` 10 år.

## Skjermer
Ingen.

## Regler
Ingen fagregler. Tillatt-listen og de lovlige målene per funksjon er data i funksjonsdefinisjonen, med test.

## Små funn fra liten oppgave (ad) som tas med her
Fra gjennomgangen av ADR 0006 (`docs/agenter/tilstand.md`, liten oppgave (ad)). Bare funnene som gjelder modulen og loggen:
- **ad-2 (hvem avviser, angre på avvist):** løst med A162 og A164: `decided_by` kommer alltid fra `grant`, forrige forslag avvises bare når det nye ga `ok`, og angre virker også på avvist forslag når det ikke finnes et nyere. Forenklerens forslag om å fjerne den automatiske avvisningen er vurdert og ikke tatt: da kan det bli to åpne forslag på samme mål, og regelen i A162 bygger på at det aldri skjer.
- **ad-5 (seed i drift):** løst med A160: seed slår bare på KI i prøveorganisasjonen, aldri i Byggcon (Omfang 8, akseptkriterium om seed).
- **ad-10 (to veier til leverandør):** løst med A160: én vei, bare fra en aktiv tilkobling.
- **ad-11 (detaljtyper i ADR-en):** ADR 0006 del 1 og 2 får en setning om at typene er retning, og at koden er fasit når den er bygget.
- **ad-12 (dobbel parentes om `PROVIDER_CODES.ai`):** den andre forekomsten i ADR 0006 del 2 fjernes.

Tas ikke her: ad-1 (eget utfall for sperret fritekst uten oppdrag) og ad-3, ad-4, ad-7 tas med «Vask før KI», fordi sperren bare har mening når vasken og en ekte leverandør finnes (her finnes bare `fake`). ad-6 tas med forslagsmønsteret (publiseringssperren). ad-8 tas når samlede tall bygges. ad-9 tas etter S8.

## Akseptkriterier
- [ ] Migreringen lager `ai_usage_log` med feltene over. Skjematest: hver sammensatte fremmednøkkel (`employee_id`, `decided_by`, `assignment_id`) avviser en rad fra en annen organisasjon; sjekken godtar `ok` med status og avviser `no_match` med status eller med `output_text`; `report_id` kan være tom; `retain_until` er opprettet + 10 år.
- [ ] `requestSuggestion` mot `fake` gir et forslag med status `suggested` og skriver én rad med funksjon, leverandør, `fake-v1`, ledetekstversjon, kostnad 0, `NOK` og `source_fields` uten verdier.
- [ ] De faste prøveverdiene gir `no_match` og `error`; da er `status` og `output_text` tomme, og `error_code` er en fast kode. Et unntak i leverandøren gir `error` med `unknown`.
- [ ] Ukjent funksjon, felt som ikke står på tillatt-listen, ulovlig mål (også TG-felt), `reportId` satt, `candidates` med innhold, for lang verdi, ugyldig `requestId` og ukjent eller slettet oppdrag gir avslag: ingen rad og intet kall (spion på `fake`).
- [ ] KI av (`ai.enabled` av, ingen tilkobling, tilkobling med status `disabled`, eller ukjent leverandørkode): svaret er `disabled`, ingen rad, intet kall. Forslag som finnes, kan fortsatt avgjøres og angres.
- [ ] En satt miljøvariabel (for eksempel `AI_PROVIDER`) endrer ikke valget av leverandør.
- [ ] Samme `requestId` to ganger (etter hverandre og samtidig med `Promise.all`) gir samme svar og én rad. Samme id med annen funksjon eller annet mål, eller fra en annen ansatt eller organisasjon, gir det nøytrale avslaget; den andres rad er urørt og røpes ikke.
- [ ] Nytt forslag på samme mål setter det forrige `suggested`-forslaget til `rejected` i samme transaksjon, med linje i `audit_log`. Forslag på samme mål i en annen organisasjon og mykt slettede forslag røres ikke.
- [ ] `recordDecision` følger tabellen over lovlige endringer (én test per rute); `decided_by` kommer fra `grant`; en annen ansatt med `report.edit` kan avgjøre; hver endring står i `audit_log` med bare gammel og ny status. Ugyldig endring gir feil uten endring og uten linje i `audit_log`.
- [ ] Tilgang per rolle med de fem variantene i tabellen under «Tilgang», for begge funksjonene.
- [ ] Bruker i annen organisasjon får ikke tilgang: `expectTenantIsolation` for hver spørring (oppslag på `requestId`, oppslag av oppdrag, settet som avviser forrige forslag, lesing og endring i `recordDecision`, lesing av `ai.enabled`, oppslag av tilkobling), og `ai_usage_log` står i `tests/tenant-tables.ts`.
- [ ] Myk sletting: `recordDecision` på en slettet rad gir avslag; et slettet forslag blir ikke satt til `rejected` og blir ikke returnert når samme `requestId` kommer igjen.
- [ ] Ingen innhold på avveie: en unik markørtekst i inndataene finnes ikke i noen kolonne utenom `output_text`, ikke i `audit_log` og ikke i kall til `logger`, både ved vellykket kall og på feilveien.
- [ ] De statiske kontrollene i Omfang 9 er grønne, også at `PROVIDERS_BY_PORT.ai` er nøyaktig `["fake"]`, og at ingen funksjonsdefinisjon har TG-felt eller felt fra sperrelisten.
- [ ] Seed slår på KI med `fake` i prøveorganisasjonen og tåler to kjøringer. Den slår ikke KI på igjen når admin har satt `ai.enabled = false`, lager ikke ny rad når det finnes en deaktivert eller slettet rad på porten `ai`, endrer ikke andre nøkler i `settings`, og rører ikke Byggcon.
- [ ] Personvernerklæringen har rad for `ai_usage_log` og setningen om `audit_log`; tabellen står i sletteregelen.
- [ ] ADR 0006 er rettet for ad-11 og ad-12.
- [ ] Versjon 0.4.5 i `package.json`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Ingen ny avhengighet. Ingen nye e2e-tester (ingen skjerm).

## Beslutninger tatt i autonom modus (føres i `docs/09-apne-sporsmal.md`)
- **A158:** `report_id` får ingen fremmednøkkel før `reports` er bygget, og må være tom i denne leveransen. **Lett å endre.**
- **A159:** Første funksjonsdefinisjon er `language_polish` med rettigheten `report.edit`, én feltkode på tillatt-listen og én lovlig måltype og feltkode. Ledeteksten er en kort egen formulering, versjon `language_polish.v1`. **Lett å endre.**
- **A160:** Leverandøren kommer bare fra en aktiv tilkobling, også i utvikling og test; ingen reserve til `fake` ut fra `NODE_ENV`. Seed lager `fake`-tilkoblingen og slår KI på bare i prøveorganisasjonen. Begrunnelse: én vei å teste (forenkleren), testmiljøet får KI uten miljøvariabler (KI-ansvarlig), og den ekte organisasjonen får aldri KI slått på av seed (testleder). Retter ADR 0006 del 3 og A152. **Lett å endre.**
- **A161:** Portene håndheves med statisk test, ikke ESLint-regel, som i tilkoblingslaget. Testleders ønske om en fil som bryter regelen erstattes av at testen prøver mønsteret mot en tekst i minnet; det viser det samme uten en egen fil. **Lett å endre.**
- **A162:** Lovlige statusendringer som i tabellen over: avgjørelser bare fra `suggested`, bytte mellom godtatt og endret krever angre først, angre er forbudt når et nyere forslag finnes, og gjentatt samme avgjørelse gir ingen endring. Samme mål gjelder uansett ansatt, og en annen ansatt med samme rettighet kan avgjøre. **Lett å endre.**
- **A163:** To samtidige kall med samme `requestId` gir én rad og samme svar, men leverandøren kan bli kalt to ganger. Å hindre det krever en lås rundt leverandørkallet, som holder en databasetilkobling under et nettverkskall. Med `fake` koster det ingenting; vurderes på nytt før en ekte leverandør (S8). **Lett å endre.**

## Avklaringer før bygging (prosjektleder 10.11.2026, etter testplanen, A164)
- **A. Avvise forrige forslag:** forrige `suggested`-forslag på samme mål settes til `rejected` **bare når det nye utfallet er `ok`.** Gir det nye kallet `no_match` eller `error`, står det forrige forslaget urørt, så takstmannen ikke mister et brukbart forslag.
- **B. Samme `requestId` etter at KI er slått av:** gir det lagrede svaret (oppslaget i trinn 5 kommer før KI av/på i trinn 6). Rettigheten sjekkes fortsatt først (trinn 2).
- **C. Samme `requestId` når raden er mykt slettet:** det nøytrale avslaget (id-en er primærnøkkel og kan ikke brukes på nytt).
- **D. «Nyere forslag» ved `undo`:** sammenlignes på serverens `created_at`, bare rader med `outcome = ok` som ikke er slettet, på samme mål og i samme organisasjon. Aldri på id-en fra enheten.
- **E. `fake`-tilkobling i Byggcon:** med `fake` i `PROVIDERS_BY_PORT.ai` kan admin lage en `fake`-tilkobling via `createConnection`. Det koster ingenting og sender ingenting ut. Godtas, og nevnes i PR-en.

## Uenighet og avgjørelse
- **Valg av leverandør (forenkler, KI-ansvarlig, testleder):** forenkleren ville ha én vei, KI-ansvarlig ville at testmiljøet får KI, testleder ville at seed i drift ikke slår KI på. Løst med A160: én vei, og seed bare i prøveorganisasjonen (som allerede bare finnes i utvikling, CI og testmiljøet), uten å lese `NODE_ENV`.
- **Lint-regel (forenkler mot testleder):** forenkleren får medhold (A161). ADR 0006 del 1 og Konsekvenser er rettet.
- **Kontroll av import fra moduler:** finnes allerede i `eslint-rules/module-boundaries.js`. Ikke laget på nytt.
- **Treffgrense og kandidater:** tas ut (forenkleren). Typene beholdes.
- **Ett kall ved samtidige forsøk (testleder):** ikke tatt med, se A163.

## Åpne spørsmål
- Tillegg til spørsmål 57 (fra sikkerhet og personvern): `audit_log` får én linje per avgjort og angret KI-forslag med hvem som gjorde det, og leder og admin kan lese revisjonsloggen. Linjene bygges, fordi de trengs ved reklamasjon, men det må tas med når Ståle drøfter målingen med de ansatte. Ført i `docs/09-apne-sporsmal.md`. Stopper ikke oppgaven.
- Spørsmål 54–58 (personvern) står fortsatt til Ståle og stopper ikke denne oppgaven, fordi bare `fake` brukes.

## Roller
- **utvikler** (to i parallell): (a) tabell, migrering, `tests/tenant-tables.ts`, seed, personvernfilene; (b) `src/core/ai` (funksjonsdefinisjon, `fake`, valg av leverandør, de to funksjonene) og de statiske kontrollene.
- **testskriver:** testplan `docs/funksjoner/fase2a-ki-modul-logg-testplan.md` og testene etter akseptkriteriene.
- **sikkerhet-personvern:** gjennomgang av tenant-isolasjon, tillatt-liste, ingen innhold i logger, ingen leverandør fra miljøvariabler.
- Ikke med: arkitekt (ADR 0006 er skrevet), UX, UI, fag.
