# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger. Filen holdes kort: bare det som gjelder nå. Historikken til og med 10.11.2026 står i `docs/agenter/arkiv/tilstand-til-2026-11-10.md` (der står også små funn fra tidligere leveranser, «liten oppgave (v)–(ad)»).

**Autonom modus: på** (Ståle 04.11.2026, til han sier fra: «Jeg synes det fungerte så bra at du kan kjøre videre på autonom utvikling igjen»). Ingen varsler, ingen spørsmål, ingen «Venter på Ståle». Agentene avgjør selv ut fra researchen og fører beslutningene i `docs/09-apne-sporsmal.md` («Avgjort av agentene mens Ståle var borte», neste nummer etter det høyeste A-nummeret, nå A166). Det bare Ståle kan gjøre, samles under «Trenger Ståle når han er tilbake». Se «Autonom modus» i `CLAUDE.md`.

**Hovedmål (Ståle 10.11.2026):** best mulig system for de ansatte, KI først og KI i bunnen, og færre reklamasjoner. 50 % mindre tid er ikke lenger hovedmål. Se `CLAUDE.md`.

**Ståle 10.11.2026 (i chat):**
- S1, S2 og S3 er gjort: testmiljøet i Azure virker, prøvene på ekte iPad er kjørt, ADR 0004 (egenbygd synk) er godkjent, og fagråd runde 1 er godkjent. De tre fagspørsmålene er besvart (spørsmål 59 i `docs/09-apne-sporsmal.md`, ført inn i PR #128).
- KI-leverandør er Anthropic, og Ståle har API-nøkkel. Anthropic-adapteren bygges bak KI-porten (ADR 0006) og kobles til secret `ANTHROPIC_API_KEY` via `readSecret`. Beslutningsnotatet (siste punkt i 2a-1) må si om behandlingen kan skje i EU/EØS.

## Gjeldende fase

**Fase 2a – Rapporten på PC**, i rekkefølgen **2a-1 KI-grunnmuren → 2a-2 Smal vei (ett våtrom fra kontrollpunkt til PDF) → 2a-3 Bredden.** Fase 0a og 1 er ferdige. Fase 0b er ferdig unntatt felles innlogging med Optiplan (venter på S6). «Minimum før ekte data» kan nå bygges i testmiljøet (S1 gjort). Levert arbeid står i `docs/plan/levert.md`.

## Gjeldende oppgave

- **Levert: KI-modulen og loggen** (2a-1, PR #127, versjon 0.5.0, migrering `0025_ki_logg`, A158–A165). Sikkerhet-personvern godkjent. Små funn som står (tas med «Forslagsmønsteret» eller «Vask før KI»): `ensureSampleAi` sjekker ikke selv `sampleData`; `recordDecision` leser raden før rettigheten sjekkes; mål-id-en kontrolleres mot organisasjonen når `answers` bygges. Fra liten oppgave (ad) står ad-1, ad-3, ad-4 og ad-7 (vask), ad-6 (publiseringssperren), ad-8 og ad-9.
- **Fjerne PowerSync og ElectricSQL** (ADR 0004, Ståle 10.11.2026): bygget på branchen `fjern-powersync-electric` (versjon 0.4.6, migrering må renummereres til 0026 etter PR #127). PR åpnes av prosjektlederen.
- **I arbeid: Forslagsmønsteret** (2a-1, branch `fase2a-forslagsmonster` fra `main`, oppgavekort `docs/funksjoner/fase2a-forslagsmonster.md`, A166–A167, versjon 0.5.1). Tar med ad-6 og småfunnene om `recordDecision` og `ensureSampleAi`. Roller: utvikler (to), testskriver, ux, sikkerhet-personvern. Steg: oppgavekort klart.
- **Neste i 2a-1 etter det:** Deretter «Vask før KI», «Evalueringssett», «KI-kø» og «Beslutningsnotat om KI-leverandør» (med Anthropic-adapteren).

## Åpne PR-er

Se GitHub. Ingen PR venter på Ståle.

## Trenger Ståle når han er tilbake

Kortlisten står i `docs/07-utviklingsplan.md` under «Venter på Ståle» (S4–S8). I tillegg:

- **Anthropic-nøkkelen (S8):** legg den inn som secret `ANTHROPIC_API_KEY` i GitHub (aldri i chat eller repo) når adapteren er merget. Agentene sier fra her når det er klart.
- **Synkprøven i Azure kan ryddes** (etter at PR-en som fjerner PowerSync og ElectricSQL er merget): de fire GitHub-secrets for synktjenestene og variabelen `ENABLE_SYNC_TRIAL` kan slettes (`docs/drift/testmiljo-azure.md`). Synkbryteren var aldri på, så ingenting må slettes i Azure.
- **Nøkkelboksen for hemmeligheter (ADR 0005):** sett GitHub-variabelen `ENABLE_KEY_VAULT` til `true`, kjør utrullingen og sjekk hakemerkene i App Service (`docs/drift/testmiljo-azure.md`, «Nøkkelboks for hemmeligheter»).
- **E-post via Microsoft 365 i testmiljøet (PR #64, A44):** de fire secretene `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` og `MAIL_FROM`, og én ekte innlogging i testmiljøet (`docs/drift/testmiljo-azure.md`).
- **Fillagring i Azure (PR #62):** lagringskonto i Sweden Central (koster penger), privat container, og bekreft at databehandleravtalen for Azure dekker den.
- **Tidsmåling (A121, A123):** legg inn tallene fra målingen i IVIT på `/statistikk/tid`, og drøft målingen med de ansatte først (arbeidsmiljøloven kapittel 9).
- **Personvernspørsmålene om KI** (54–58 i `docs/09-apne-sporsmal.md`) før ekte KI brukes med ekte data.

## Oppgaver fra testlaget

Funnene ligger som én fil per funn i `docs/agenter/testlag/funn/`. Testlaget har ikke kjørt ennå (satt opp 10.11.2026).

- Åpne alvorlige feil: 0

## Oppgaver fra nattløkken

Listen fra 06.11.2026 (punkt 1–23) står i arkivet. Alvorlige: (1) sårbar esbuild via drizzle-kit (bare utviklerverktøy) og (2) sårbar minimatch via eslint (bare lint). Punkt 3, 14 og 18 gjaldt synkkandidatene og faller bort når PowerSync og ElectricSQL er fjernet.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

10.11.2026 kl. 15:50 UTC (hovedløkken): ingen åpne PR-er ved start. PR #126 (Ståles svar) var merget. «KI-modulen og loggen» var satt sammen av en kjøring som stanset (siste push 14:59 UTC, ingen PR). Denne kjøringen flettet inn `main`, rettet fire røde tester og tre småfunn fra sikkerhet-personvern, og åpnet PR #127. Ståles fagsvar ført inn i PR #128 (merget). PowerSync og ElectricSQL fjernet av utvikler på egen branch. Tilstandsfilen ryddet (historikken til arkivet).
