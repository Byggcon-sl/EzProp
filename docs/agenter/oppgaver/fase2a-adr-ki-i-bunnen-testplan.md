# Testplan: ADR 0006 – KI i bunnen

- **Oppgavekort:** `docs/agenter/oppgaver/fase2a-adr-ki-i-bunnen.md`
- **Fase:** 2a-1 KI-grunnmuren (første punkt)
- **Branch:** `fase2a-adr-ki-i-bunnen` (bygger på `main`)
- **Laget av:** test-leder, 10.11.2026 (før skriving)
- **Støtter hovedmål:**
  - **KI i bunnen:** testplanen sikrer at ADR-en er presis nok til at neste punkt («KI-modulen og loggen») kan testes mot den, og legger testkravene for KI-data fast nå.
  - **De ansatte:** statusene og angre er like i alle dokumenter, slik at forslag kan bygges likt overalt.
  - **Reklamasjoner:** «setter aldri TG», «publiserer aldri» og «sender aldri» skal stå ordrett og senere bli tester.

## Kort om omfanget

Oppgaven er bare dokumentasjon. Det skrives **ingen nye tester** og ingen produktkode. Kontrollen er derfor:

1. Dokumentsjekker (del 1), som test-leder kjører med `grep` og lesing i gjennomgangen.
2. Eksisterende testsuite skal være grønn og uendret (del 2).
3. Krav til testplanen for neste punkt, «KI-modulen og loggen», som ADR-en må gjøre testbare (del 3–6). Disse testene skrives **ikke nå**, men ADR-en avvises hvis den ikke gir grunnlag for dem.

## 1. Dokumentsjekker (gjennomgang, ingen kode)

| # | Sjekk | Hva den viser | Slik sjekkes det |
|---|---|---|---|
| D1 | ADR-filen og overskriftene | `docs/adr/0006-ki-i-bunnen.md` finnes, første linje er `# ADR 0006 – KI i bunnen`, og den har Status, Dato, Beslutning(er), Hvorfor, Forkastet og Konsekvenser som ADR 0004 og 0005 | `head -1`, `grep -n "^## "` |
| D2 | Alle elleve delene | Modulen, KI-porten, falsk leverandør, forslag, `ai_usage_log`, vask, hva KI aldri gjør, velger fra det godkjente, evalueringssett, KI-kø uten nett, KI av/på kan finnes igjen | lesing, én avkrysning per del |
| D3 | Ordrette forbud | «setter aldri TG», «publiserer aldri», «sender aldri» står i ADR-en | `grep -c` for hver frase, alle ≥ 1 |
| D4 | Bare `src/core/ai` bruker porten `ai` | ADR-en krever lint-regel **og** statisk test (som `src/core/integrations/static-checks.test.ts`), og at leverandørens SDK bare importeres i `src/core/ai/providers/` | lesing |
| D5 | Offentlig flate tar `EmployeeGrant` | Begge funksjonene (be om forslag, registrere beslutning) tar `EmployeeGrant`, aldri organisasjons-ID fra kalleren; `decided_by` settes fra tilgangssjekken | lesing |
| D6 | Vaskelisten | Tabell og kolonne for hvert felt: `contacts`, `firms.note`, partene, `orders`, `properties`, `cadastral_units` (med festenummer, seksjons-, andels- og aksjenummer), `common_areas` med `association_name`, `claims`, `employees`, fødselsnummer. Fritekstmønstre med e-post, telefon, fødselsnummer, organisasjonsnummer, gnr/bnr. Tillatt-liste per funksjon | `grep` på hvert navn |
| D7 | Krav om vasketester | ADR-en krever vasketester med oppdiktede eksempler, og at mønstrene deles med loggeren i `src/shared` | lesing |
| D8 | Bytte av leverandør | Nummererte steg: ny kode i `PROVIDER_CODES.ai`, adapter i `providers/`, nøkkel via `readSecret`, rad i `integration_connections`, evalueringssettet kjøres på nytt. Ingen endring i funksjonene. Forutsetningene (S8, databehandleravtale, EU/EØS, ingen trening, ingen lagring) står | lesing |
| D9 | Samme statuser og felt overalt | `suggested` / `accepted` / `edited` / `rejected`, utfallet (`ok` / `no_match` / `error`) som eget felt, og angre er like i ADR 0006, `docs/05-domenemodell.md` 4.7, 4.10, 4.12, ordlisten (avsnitt 8), punkt 11 i `docs/06-arkitektur.md` og «KI-forslag» i ADR 0004. 4.7 sier ikke lenger bare «hvis teksten ble godkjent». `decision` er borte fra 4.12 | `grep -rn "suggested\|accepted\|edited\|rejected\|decision" docs/adr docs/05-domenemodell.md docs/06-arkitektur.md` |
| D10 | Adresse og matrikkel | `docs/06-arkitektur.md` sier at adresse og matrikkel **aldri** sendes til KI. «uten at det er vurdert» er borte | `grep -n "uten at det er vurdert"` gir 0 treff |
| D11 | Lagring og logg | Myk sletting (`deleted_at`), 10 år (`retain_until`), aldri fritekst i `input_summary`, aldri innhold i `logger`, `cost` og `currency` på raden, id er UUID v7 fra enheten | `grep` |
| D12 | Tilgangstabellen | Tabellen fra oppgavekortet med `report.edit`, `assignment.edit`, `statistics.read`, `claims.read`, `claims.manage`, `organization.manage`. Alle finnes i `src/core/access` (sjekket 10.11.2026). Ingen ny rettighet. Leder ser samlede tall uten forslagstekst og aldri per ansatt | `grep` mot `src/core/access/permissions.ts` for hver rettighet |
| D13 | Admin stenges aldri ute | ADR-en sier at admin alltid kan slå KI av og på og se loggen, også når KI er av | lesing |
| D14 | Tenant-krav | ADR-en krever `organization_id` på all KI-data, sammensatt fremmednøkkel, filter på `grant.organizationId`, `expectTenantIsolation` og rad i `tests/tenant-tables.ts` når tabellene bygges | `grep` |
| D15 | Ordlisten | Forslag, falsk leverandør, vask, evalueringssett og KI-kø står i avsnitt 8 | `grep` |
| D16 | Beslutninger og spørsmål | Nye A-beslutninger starter på A148 (ingen kollisjon med A136–A147), hver merket «lett å endre» eller «dyrt å endre». De fire spørsmålene til Ståle (restrisiko i fritekst, tale og bilde, avviste forslag i 10 år, tall per person) står som spørsmål, ikke som A-beslutninger | `grep -n "A14[89]\|A15[0-9]" docs/09-apne-sporsmal.md` |
| D17 | Ingen forbudt tekst | Ingen modellnavn eller leverandørnavn i eksemplene, ingen kundeopplysninger, ingen tekst fra NS 3600, IVIT eller SmartTakst, ingen sitater fra `docs/kartlegging/` | `git diff main -- docs` lest i sin helhet, `grep -in` på kjente modell- og leverandørnavn |
| D18 | Diffen | `git diff --stat main` rører bare `docs/` og `package.json`. `src/core/integrations/ports.ts` er uendret (`ai: []`) | `git diff --stat main`, `git diff main -- src` er tom |
| D19 | Versjon | `package.json` har 0.4.3 (én patch over `main`, 0.4.2, etter at PR #119 ble merget) | `grep version package.json` |
| D20 | Plan og endringslogg | Punktet er krysset av i `docs/07-utviklingsplan.md`; én linje i `docs/plan/endringslogg.md` hvis planteksten er endret | `git diff main -- docs/07-utviklingsplan.md docs/plan/` |

## 2. Eksisterende tester (skal være grønne og uendret)

| # | Kommando | Hva den viser |
|---|---|---|
| K1 | `pnpm lint` | Produktnavnet og modulgrensene er uberørt |
| K2 | `pnpm typecheck` | Ingen kode er endret ved et uhell |
| K3 | `pnpm test` | Hele suiten grønn, særlig `src/core/integrations/static-checks.test.ts`, `src/core/access/permissions.test.ts`, `src/core/access/guards.test.ts` og `tests/tenant-isolation-all-tables.test.ts` (ingen ny tabell, så registeret er uendret) |
| K4 | `pnpm test:e2e` | Bare hvis CI krever det. Ingen skjermer er endret, så e2e på PC og iPad-størrelse skal gi samme resultat som på `main` |

Ingen nye testfiler i denne PR-en. Finnes det en ny `*.test.ts` eller `*.spec.ts` i diffen, avvises den (utenfor omfang).

## 3. Krav til testplanen for «KI-modulen og loggen» (neste punkt)

ADR-en skal gjøre disse testene mulige. De skrives i neste punkt, mot falsk leverandør (`fake`) og testdatabasen.

### 3a. Tenant-isolasjon (én per spørring)

| # | Testnavn (forslag) | Hva den viser |
|---|---|---|
| T1 | `requestSuggestion` lagrer på `grant.organizationId` | Raden i `ai_usage_log` får organisasjonen fra tilgangssjekken, ikke fra inndata |
| T2 | `expectTenantIsolation` for hver lesespørring på `ai_usage_log` (én rad, samlede tall) | Organisasjon B får verken rader eller tilgang til A, begge retninger |
| T3 | `recordDecision` på en rad fra annen organisasjon | Gir `AccessDeniedError`, raden er uendret |
| T4 | Sammensatt fremmednøkkel | Rad med `assignment_id` eller `report_id` fra annen organisasjon avvises av databasen |
| T5 | `ai_usage_log` i `tests/tenant-tables.ts` | `tests/tenant-isolation-all-tables.test.ts` er grønn med radbygger og testfil |
| T6 | Valg av tilkobling per organisasjon | Aktiv tilkobling i A gjelder ikke B |

### 3b. Tilgang per rolle

| # | Testnavn (forslag) | Hva den viser |
|---|---|---|
| R1 | takstmann med `report.edit` ber om, godtar, endrer, avviser | Lykkes på felt i rapporten |
| R2 | kontor uten `report.edit` | Nektes på rapportfelt, lykkes der `assignment.edit` gjelder |
| R3 | takstmann og kontor i reklamasjonssak | Nektes (bare leder og admin, `claims.manage`) |
| R4 | leder leser samlede tall (`statistics.read`) | Får antall, status og kostnad per funksjon og periode, **ingen forslagstekst, ingen ansatt-id** i svaret |
| R5 | leder leser én rad | Nektes utenfor reklamasjonssak (`organization.manage` kreves) |
| R6 | ingen spørring per ansatt | Statisk eller enhetstest: samlede tall grupperes aldri på `decided_by` eller ansatt |
| R7 | `decided_by` fra klienten | Ignoreres; settes alltid fra tilgangssjekken |
| R8 | ansatt som er sperret, sluttet eller myk slettet | Nektes |

### 3c. Admin stenges aldri ute

| # | Testnavn (forslag) | Hva den viser |
|---|---|---|
| AD1 | admin slår KI av og på (`ai.enabled`) | Lykkes, hendelse i `audit_log` |
| AD2 | admin leser loggen når KI er av | Lykkes |
| AD3 | admin bytter tilkobling | Lykkes, hendelse i `audit_log`; ingen nøkkel i `integration_connections`, `ai_usage_log` eller logg |
| AD4 | ingen annen rolle endrer `ai.enabled` | takstmann, kontor og leder nektes |

### 3d. Myk sletting og oppbevaring

| # | Testnavn (forslag) | Hva den viser |
|---|---|---|
| M1 | sletting setter `deleted_at` | Raden finnes fortsatt, forsvinner fra vanlige spørringer |
| M2 | `retain_until` settes til 10 år | Riktig dato på ny rad |
| M3 | angre | `status` og `answers.ai_usage_id` følger ADR-en, statusendringen står i revisjonsloggen |

### 3e. Vask (mot falsk leverandør, bare oppdiktede data)

| # | Testnavn (forslag) | Hva den viser |
|---|---|---|
| V1 | bare felt på tillatt-listen sendes | Falsk leverandør tar opp inndata; felt utenfor listen er aldri med |
| V2 | hvert forbudt felt i vaskelisten | Én test per tabell og kolonne: verdien når aldri leverandøren |
| V3 | mønstre i fritekst | E-post, telefon, fødselsnummer, organisasjonsnummer og gnr/bnr erstattes med faste merker |
| V4 | kjente verdier på oppdraget | Navn på parter, kontakter og ansatte, adresse og matrikkel i fritekst blir `[navn]` osv. |
| V5 | samme mønstre som loggeren | Mønstrene importeres fra `src/shared`, ikke kopiert (statisk test) |
| V6 | `input_summary` | Inneholder bare feltkoder, referanser og antall, aldri tekst fra inndata |
| V7 | `logger` | Ledetekst, inndata og svar skrives aldri; feil fra leverandøren logges uten innhold |

### 3f. Hva KI aldri gjør og grenser

| # | Testnavn (forslag) | Hva den viser |
|---|---|---|
| G1 | KI setter aldri TG | Forespørsel om TG-felt avvises; TG kommer bare fra regelmotoren |
| G2 | publiseringssperre | Rapport med forslag i status `suggested` kan ikke publiseres; verdien er aldri forslaget før godkjenning |
| G3 | svaret er bare tekst | Svar fra falsk leverandør med HTML eller skript vises escapet og kjøres aldri |
| G4 | samme forespørsels-id to ganger | Gir én rad (UUID v7 fra enheten) |
| G5 | KI av | `requestSuggestion` gir tydelig «KI er av», funksjonen virker uten KI |
| G6 | ekte leverandør velges aldri fra miljøvariabler | Bare `fake` i `PROVIDERS_BY_PORT.ai`; uten aktiv tilkobling er KI av |
| G7 | statisk test: bare `src/core/ai` bruker porten `ai` og SDK-en | Som `static-checks.test.ts`; klientdelen importerer aldri nøkler eller adaptere |
| G8 | `src/core/ai` importerer aldri fra en modul | Lint-regel (regel 4) |
| G9 | «ingen treff» | Falsk leverandør uten treff gir utfall `no_match`, ikke oppdiktet tekst |

## 4. Regeltester (regler som data)

Ingen nye fagregler. Senere: evalueringssettet (oppdiktede eksempler med fasit i repoet) kjøres med egen kommando, og en funksjon slås ikke på før treffgrensen er nådd. ADR-en må beskrive format, fasit, kommando og treffgrense så dette kan testes. Regelmotorens TG-tester er uendret.

## 5. E2e (PC og iPad-størrelse, også uten nett)

Ingen nå (ingen skjermer). Når forslagsmønsteret og køen bygges:

| # | Test (forslag) | Hva den viser |
|---|---|---|
| E1 | iPad-størrelse uten nett: be om forslag | Vises som «venter på KI», ingen kall til leverandøren fra enheten |
| E2 | nett tilbake | Køen behandles på serveren, tilgang sjekkes på nytt |
| E3 | utlogging og sperring | Den lokale KI-køen tømmes (ADR 0004) |
| E4 | godta, endre, avvise, angre på PC og iPad-størrelse | Forslaget er merket likt overalt; verdien endres bare ved godta eller endre |

## 6. Godkjenning

Test-leder godkjenner PR-en når D1–D20 er krysset av og K1–K3 er grønne. ADR-en avvises hvis den mangler krav til tilgang per rolle, tenant-isolasjon, admin ikke stengt ute eller myk sletting, fordi del 3 da ikke kan bygges.
