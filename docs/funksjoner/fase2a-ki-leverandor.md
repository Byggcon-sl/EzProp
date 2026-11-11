# Funksjon: Beslutningsnotat om KI-leverandør og Anthropic-adapteren

- **Fase:** 2a-1 KI-grunnmuren (siste punkt)
- **Modul:** kjerne (`src/core/ai`, `src/core/integrations`) og `docs/`
- **Status:** utkast
- **Branch:** `fase2a-ki-leverandor` (bygger på `main`)
- **Støtter hovedmål:** KI i bunnen: den ekte leverandøren kobles inn bak den ene KI-porten, slik at alle funksjonene i 2a-2 kan bruke ekte KI så snart Ståle har lagt inn nøkkelen og avtalene er på plass. De ansatte: Ståle får ett kort notat i klarspråk med det han må vite og avgjøre, i stedet for å lete selv. Reklamasjoner: notatet sier hvilken modell som brukes til hvilken funksjon, og at hver funksjon må bestå evalueringssettet før den slås på, så dårlige forslag ikke havner i rapporter.

## Problem

Ståle har valgt Anthropic og har en API-nøkkel (10.11.2026), men koden har bare den falske leverandøren. Uten adapter kan ikke KI prøves med ekte svar i testmiljøet, og 2a-2 må bygges blindt. Uten notatet vet ikke Ståle hva det koster per rapport, om data behandles i EU/EØS, om Anthropic trener på dataene, hvilken avtale som må signeres, og hva han må velge for norsk tale til tekst (Anthropic tilbyr ikke det).

## KI i bunnen

- **Hva KI gjør fra første dag:** ingenting nytt for den ansatte. Adapteren gjør at `language_polish` (prøvesiden `/prove/ki`) og senere alle funksjoner kan bruke Anthropic i stedet for den falske leverandøren, uten at en eneste funksjon endres. Forslagsmønsteret (godta, endre, avvis) og loggen i `ai_usage_log` er uendret.
- **Data som lagres for KI:** ingen nye tabeller. Raden i `integration_connections` (`port = ai`, `provider = anthropic`, `secret_ref = ANTHROPIC_API_KEY`, `settings.model`, `settings.features`) er konfigurasjonen. Leverandør, modell, mengde (tokens inn og ut) og kostnad skrives i `ai_usage_log` som før, nå med ekte tall fra svaret.
- **Alt gjennom `src/core/ai`:** ja. Adapteren ligger i `src/core/ai/providers/anthropic.ts` og kalles bare fra `requestSuggestion` etter rettighet, tillatt-liste, vask og lekkasjesjekk. Enheten snakker aldri med Anthropic og har aldri nøkkelen (ADR 0006 del 10).

## Brukerhistorier

- Som **daglig leder (Ståle)** vil jeg **lese ett kort notat** slik at **jeg vet hva KI koster per rapport, hvor dataene behandles, og hva jeg må signere og velge før ekte KI slås på**.
- Som **admin** vil jeg **koble organisasjonen til Anthropic med en tilkobling og en hemmelighet** slik at **KI kan slås på uten kodeendring, og slås av igjen med én bryter**.
- Som **takstmann** vil jeg **få forslag fra ekte KI på samme måte som i dag** slik at **jeg bare kontrollerer og godkjenner**.

## Omfang

**Med:**

1. **Beslutningsnotat** `docs/beslutningsnotat-ki-leverandor.md`, skrevet til Ståle i klarspråk (uten programmeringsord), høyst rundt to sider. Innhold:
   - **Modellvalg per funksjon:** hvilken modellklasse (minste, mellomste, største) som passer til hver KI-funksjon i planen (språkvask, avvikstekst-forslag, ordreforslag fra e-post, bildebeskrivelse, sidemannskontroll-hjelp osv.), og hvorfor. **Modellnavn og modell-id skrives ikke i notatet**; de står bare i tilkoblingens `settings.model`.
   - **Pris per rapport:** regnestykke med antatt antall kall og tekstmengde per rapport, per modellklasse, i kroner. Prisene oppgis med dato og kilde (Anthropics offentlige prisliste) og merkes «må sjekkes på nytt før avtale». Tallene er anslag og skal si det.
   - **EU/EØS:** si **tydelig** om behandlingen kan skje i EU/EØS ved bruk av Anthropic direkte, og hvilke veier som gir behandling i EU/EØS (for eksempel Anthropic-modellene gjennom en skyleverandør med EU-region, som Azure eller andre). Det som ikke kan bekreftes uten avtaletekst eller svar fra Anthropic, står i en egen liste «Dette er usikkert».
   - **Databehandleravtale:** hva som må på plass (Anthropics avtalevilkår for API-kunder, DPA, overføringsgrunnlag hvis data går ut av EØS), og at Ståle må signere.
   - **Ingen trening på våre data:** hva Anthropics vilkår sier for API-kunder, hvor lenge data oppbevares hos dem, og om null-lagring kan avtales.
   - **Norsk tale til tekst:** to til fire alternativer (for eksempel Azure Speech i EU-region, egen modell på egen server, andre leverandører med norsk), med fordeler, ulemper, EU/EØS og pris. Anbefaling, men Ståle velger (S8).
   - **Hva Ståle må gjøre**, i rekkefølge: signere avtalen, legge nøkkelen inn som secret `ANTHROPIC_API_KEY` i GitHub, velge tale-leverandør, svare på spørsmål 54–58.
   - Notatet kopierer ikke tekst fra leverandørenes vilkår; det oppsummerer med egne ord og lenker til kilden.
2. **Leverandørkoden `anthropic`** i `PROVIDERS_BY_PORT.ai` (`src/core/integrations/ports.ts`). Fast kode (regel 6).
3. **Adapteren** `src/core/ai/providers/anthropic.ts`, som implementerer `AiProvider`:
   - Bruker innebygd `fetch` mot Anthropics meldings-API. **Ingen ny avhengighet.** `fetch` sendes inn (standard global `fetch`), så testene kan bruke falsk HTTP.
   - Nøkkelen leses med `readSecret(connection.secretRef)` fra `@/core/integrations` ved hvert kall eller ved oppretting, aldri fra `process.env` direkte. Nøkkelen står aldri i feilmeldinger, logger eller `ai_usage_log`.
   - Modell-id kommer **bare** fra tilkoblingens `settings.model`. Ingen modell-id i koden. Mangler den, er KI av for organisasjonen.
   - Tidsgrense på kallet (AbortController), største antall tokens ut satt fast i koden per kall.
   - Svarkoder tilordnes de faste feilkodene: tidsavbrudd → `timeout`, 429 → `rate_limited`, 5xx og nettverksfeil → `unavailable`, 400/401/403 → `rejected`, alt annet og svar i uventet form → `unknown`. Leverandørens feilmelding logges aldri.
   - Leser `usage` (tokens inn og ut) fra svaret og regner kostnad ut fra en pristabell per modell i konfigurasjon (`settings.pricing` på tilkoblingen eller en liten konfigfil uten modellnavn i kode; utvikler velger det enkleste og fører beslutningen). Valuta som i dag.
   - Tomt svar eller svar som sier «ingen endring» gir `no_match` slik som den falske leverandøren.
4. **Valg av leverandør** (`provider-resolution.ts`): adapterne bygges fra tilkoblingen (fabrikk i stedet for fast objekt). Anthropic er på **bare** når `ai.enabled` er `true`, det finnes en aktiv tilkobling med `provider = anthropic`, `settings.model` er satt, og `readSecret` finner nøkkelen. Mangler noe av dette: `disabled`, ingen kall, ingen rad. Miljøvariabler og `NODE_ENV` velger fortsatt aldri leverandør (A160).
5. **Sperrene for ekte leverandør gjelder Anthropic:** `ai_trial`, `answer` og fritekst uten oppdrag blir `blocked` mot `anthropic` slik ADR 0006 del 5 og 6 sier. Funksjoner som ikke står i `settings.features`, sendes ikke.
6. **ADR 0006** oppdateres kort: Anthropic er første ekte adapter, hvor modell-id og nøkkel står. Domenemodellen får `anthropic` som leverandørkode. `.env.example` får en kommentert linje `ANTHROPIC_API_KEY=` (tom).
7. **Testmiljøet:** `docs/drift/testmiljo-azure.md` og utrullingen tar med secret `ANTHROPIC_API_KEY` på samme måte som de andre hemmelighetene (tom er lov; da er KI av). Ingen ekte nøkkel i repoet.
8. **Små funn som tas med** (samme område): `runEvals` tar vilkårlig leverandør, så sett en vakt slik at `pnpm ai:eval` fortsatt bare kjører mot `fake` (se «Ikke med»).
9. Versjon i `package.json` økes (minor: 0.6.0, ekte leverandør er en større leveranse). Planpunktet krysses av. Tilstandsfilen sier under «Trenger Ståle» at adapteren er klar og at nøkkelen kan legges inn.

**Ikke med (bevisst utelatt):**

- Ingen kall mot Anthropics ekte API, verken i tester, CI, e2e eller for hånd. Ingen kostnad.
- Ingen tilkobling `anthropic` i seed-data eller testmiljøet. Admin (Ståle) lager den når avtalen er signert.
- `pnpm ai:eval` mot ekte leverandør og avslutningskode under treffgrensen (koster penger, tas når Ståle har lagt inn nøkkelen).
- Ingen skjerm for å velge leverandør eller modell. Raden lages som i dag for andre tilkoblinger.
- Tale til tekst og bilde. Notatet beskriver alternativene, men ingenting bygges (fase 2b, spørsmål 55).
- Strømming av svar, verktøykall, hurtigbuffer for ledetekster og batch-API.
- Ingen SDK fra Anthropic.
- Ingen nye KI-funksjoner. Bare `language_polish` finnes, og den slås ikke på mot `anthropic` (står ikke i `settings.features` før evalueringen er kjørt).

## Tilgang

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Forslag som i dag | Godta, endre, avvise som i dag |
| kontor | Som takstmann | Som takstmann |
| leder | Som i dag | Som i dag |
| admin | Tilkoblingen (uten nøkkel) | KI av/på og tilkobling (`organization.manage`), som i dag |

Ingen ny tilgangslogikk. Alt sjekkes i `src/core/access` som før. Admin stenges ikke ute.

## Data

- Ingen nye tabeller og ingen migrering. `anthropic` legges til i `PROVIDERS_BY_PORT.ai` (hvis listen også står i en CHECK-regel i databasen, trengs migrering; utvikler sjekker).
- `integration_connections.settings` for `port = ai`: `model` (påkrevd for ekte leverandør), `features` (som før), eventuelt `pricing`. Føres i `docs/05-domenemodell.md`.
- Ordlisten (avsnitt 8): «KI-adapter / `AiProvider` adapter», «leverandørkode `anthropic`».

## Skjermer

Ingen nye. Prøvesiden `/prove/ki` er uendret og bruker fortsatt bare den falske leverandøren (`ai_trial` er sperret mot ekte leverandør).

## Regler

Ingen fagregler. Tekniske regler med tester:

- Anthropic er av uten `ai.enabled`, uten aktiv tilkobling, uten `settings.model` eller uten nøkkel.
- Nøkkelen sendes bare i forespørselshodet til Anthropic og finnes aldri i logg, feilmelding eller `ai_usage_log`.
- Ledeteksten som sendes, er den vaskede (lekkasjesjekken kjører før kallet, som i dag).

## Akseptkriterier

- [ ] `docs/beslutningsnotat-ki-leverandor.md` finnes, er i klarspråk, og har alle sju delene (modellvalg per funksjon, pris per rapport, EU/EØS, databehandleravtale, ingen trening, tale til tekst, hva Ståle må gjøre). Svaret om EU/EØS står i første avsnitt, og «Dette er usikkert» er en egen liste.
- [ ] Ingen modellnavn eller modell-id i notatet, koden, testene, commit-meldingene eller PR-teksten (en test eller lint-sjekk som leter etter kjente modellnavn i `src/` og `docs/beslutningsnotat-ki-leverandor.md` er velkommen).
- [ ] Adapteren sender riktig forespørsel (adresse, hoder, modell fra `settings.model`, ledetekst, tidsgrense) og leser svar, tokens og kostnad riktig (test med falsk `fetch`).
- [ ] Hver feiltype (tidsavbrudd, 429, 5xx, 400, 401, nettverksfeil, svar i uventet form, tomt svar) gir riktig fast kode, og leverandørens melding og nøkkelen står ikke i loggen eller feilen (test).
- [ ] `resolveAiProvider` gir `disabled` for hver manglende lås (KI av, ingen tilkobling, ukjent leverandør, tom modell, manglende nøkkel) og `enabled` når alt er der (test).
- [ ] `ai_trial`, `answer` og fritekst uten oppdrag blir `blocked` mot `anthropic`, og ingen `fetch` kalles (test).
- [ ] En funksjon som ikke står i `settings.features`, sender ikke (test).
- [ ] Bruker i annen organisasjon får ikke bruke tilkoblingen eller nøkkelen til en annen organisasjon (`expectTenantIsolation`).
- [ ] Ingen test, e2e eller CI-jobb gjør nettverkskall til Anthropic (statisk test eller falsk `fetch` som feiler hvis den ekte brukes).
- [ ] Ingen ny avhengighet i `package.json`.
- [ ] `pnpm ai:eval` kjører fortsatt bare mot `fake`.
- [ ] KI-forslag kan fortsatt godtas, endres og avvises, og logges (eksisterende tester grønne mot falsk leverandør).
- [ ] Virker på iPad-størrelse (eksisterende e2e for `/prove/ki` grønn).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.

## Åpne spørsmål

- Om Anthropic direkte kan love behandling i EU/EØS. Hvis ikke: skal Byggcon bruke Anthropic-modellene gjennom en skyleverandør med EU-region? Dette er **dyrt å endre** og avgjøres av Ståle; notatet anbefaler, agentene bygger bare adapteren for Anthropic direkte nå (en adapter for skyleverandør kan legges til bak samme port senere). Føres i `docs/09-apne-sporsmal.md` under «Spørsmål til Ståle», og som A-beslutning: «adapteren bygges mot Anthropic direkte; EU-vei avgjøres av Ståle (lett å endre, ny adapter bak porten)».
- Leverandør for norsk tale til tekst (S8, Ståle velger).
