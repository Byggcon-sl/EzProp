# CLAUDE.md

Instruksjoner for Claude Code i dette prosjektet. Les denne filen ved start av hver økt.

## Hva vi bygger

**EzProp** er Byggcons eget system for tilstandsrapporter. Det erstatter IVIT. Takstingeniørene gjør befaringen på iPad Pro (også uten nett) og ferdigstiller rapporten på PC. Systemmaler med regler og TG-logikk lages av Byggcon; egne maler lages senere i en visuell malbygger.

**Hovedmål (Ståle 10.11.2026), gjelder alt vi gjør:** «Vi skal lage et best mulig system for våre ansatte – KI først. Det betyr også at KI må ligge i bunnen, ikke komme som et tillegg senere.»
1. **Best mulig system for de ansatte.** En enklere, raskere og tryggere arbeidsdag for takstingeniørene, kontoret og lederne. De ansatte avgjør om vi har lykkes.
2. **KI først, og KI i bunnen.** KI er en del av grunnmuren og av hver funksjon fra første dag, ikke et tillegg senere. For hver oppgave: hva kan KI gjøre eller forberede, slik at den ansatte bare kontrollerer og godkjenner? Takstmannen har alltid siste ord og signerer. KI setter aldri TG og publiserer eller sender aldri selv.
3. **Færre reklamasjoner** (står fra 28.10.2026): halvparten så mange per 100 leverte rapporter.

50 % mindre tid per rapport er **ikke lenger hovedmål** (Ståle 10.11.2026). Tiden måles fortsatt, som ett av flere tegn på at systemet er godt.

**Produksjonsklar, full kvalitet (Ståle 13.11.2026):** «Løsningen vi koder skal benyttes til drift, og være 100% produksjonsklar. Ikke fokuser på midlertidige løsninger eller snarveier.» Det som står i planen, bygges ferdig for drift første gang: ingen minimumsløsninger, prototyper, prøvesider som erstatning for ekte skjermer, eller «første versjon» som må bygges om. EzProp lanseres ikke før det er klart. «Hold det enkelt» betyr fortsatt: bygg bare det som står i planen, og velg den enkleste løsningen som er god nok for drift.

**Ferdig betyr klart for drift:** feilhåndtering og tydelige feilmeldinger, logging uten persondata, tilgang og tenant-isolasjon, ytelse med ekte datamengder, universell utforming, uten-nett der planen krever det, migreringer som tåler ekte data, tester på alle nivåer, og dokumentasjon for drift. Testdata i repoet er fortsatt oppdiktet (regel 8).

Hver oppgave og hver PR skal si hvilket mål den støtter, og hvordan.

Les før du gjør endringer i et område:

- Produkt og mål: `docs/01-produktvisjon.md`
- Roller og tilgang: `docs/02-roller-og-tilgang.md`
- Domenemodell og ordliste: `docs/05-domenemodell.md` (fasit for datamodellen)
- Arkitektur og regler: `docs/06-arkitektur.md`
- Plan og status: `docs/07-utviklingsplan.md` (det ene levende plandokumentet). Levert arbeid: `docs/plan/levert.md`. Sporbarhet og endringslogg: `docs/plan/`.
- Designprinsipper (A «Fjord»): `docs/08-designprinsipper.md`
- Åpne spørsmål: `docs/09-apne-sporsmal.md`
- Utviklingsmiljø: `docs/10-utviklingsmiljo.md`
- Agentlaget og løkkene: `docs/11-agentlaget.md`, tilstand i `docs/agenter/tilstand.md`
- Testlaget (agenter som tester og validerer): `docs/agenter/testlag/LES-MEG.md`, funn i `docs/agenter/testlag/funn/`, siste rapport i `docs/agenter/testlag/rapport.md`
- Researchen (IVIT, Spectora, SmartTakst, regelverk, Ståles svar): `docs/kartlegging/`. Start med `docs/kartlegging/LES-MEG-kartlegging.md`. Ståles svar er fasit ved motstrid; nyeste dato gjelder.

## Regler som ikke kan brytes

1. **Hold det enkelt.** Bygg bare det som står i gjeldende fase i `docs/07-utviklingsplan.md`. Nye ideer foreslås i PR-en eller i `docs/09-apne-sporsmal.md`. De bygges ikke.
2. **Organisasjons-ID på alle data. Tilgang sjekkes bare i `src/core/access`.** Hver ny spørring skal ha en test som viser at andre organisasjoner ikke får tilgang. Spørringer filtrerer på `grant.organizationId` fra tilgangssjekken, aldri på en id fra adressen eller skjemaet.
3. **Ingenting slettes permanent** (myk sletting, `deleted_at`). Data oppbevares i 10 år.
4. **Modulene importerer aldri fra hverandre.** Bare fra `src/core`, `src/shared`, `src/db` og egen mappe. Håndheves med lint-regel.
5. **Regler og TG-logikk er data med testsaker.** De kjører både på iPaden og på serveren. TG-logikk finnes bare i systemmalen for tilstandsrapport.
6. **En fast kode (`key`) endres aldri, den arkiveres.** Gjelder kontrollpunkt, felt, valg, utfall, regel, romtype og terskel. Skal noe få ny betydning, arkiveres den gamle koden og det lages en ny.
7. **Fagstoff:** egne formuleringer, aldri tekst fra NS 3600, IVIT eller SmartTakst. Tallverdier (levetider, grenser) er fakta. Kilden står i bakgrunnen, ikke i rapportteksten. Ingen gjetteord («antas», «trolig»). Tekstene i `docs/kartlegging/` er referanse og skal aldri inn i kode, seed-data eller maler.
8. **Ingen kundeopplysninger, passord eller nøkler** i repoet, loggene eller testdata. Testdata er oppdiktet. **Testmiljøet har bare oppdiktede data, og produksjonsmiljøet har de ekte dataene; de holdes adskilt, og ekte data kopieres aldri til test** (Ståle 13.11.2026). Testdataene har ingen verdi, så i testmiljøet kan de brukes fritt, også mot ekte KI. Koden behandler likevel alle data som ekte, slik at den er klar for produksjon.
9. **Ingen nye avhengigheter uten begrunnelse** i PR-en.
10. **Produktnavnet står ett sted:** `src/shared/config/brand.ts`. Lint stopper «EzProp» andre steder i `src/`.
11. **Admin stenges aldri ute.** Nye tilgangsregler skal aldri stenge admin ute.
12. **Fra Ståles svar 27.10.2026:** gyldig ett år fra befaringsdato · alle takstmenn ser og kan foreløpig endre alt (innstillingen `access.inspectors_edit_all`), unntatt reklamasjonssaker (bare leder og admin) · fire oppdragsstatuser: bestilt, under arbeid, ferdig, fakturert, pluss merket «Rettet» fra versjon 2 · sidemannskontroll gir advarsel, aldri sperre, og sidemannen retter ikke · alle kan sende fakturagrunnlag · eget kostnadsbeløp gir advarsel hvis det ikke er rundet til nærmeste 10 000 · rettet rapport sendes manuelt.
13. **Øk versjonsnummeret** i `package.json` i hver PR (patch, f.eks. 0.1.0 → 0.1.1; minor ved større leveranser). Det vises i `/api/helse`.
14. **KI i bunnen.** All KI går gjennom én modul i kjernen (`src/core/ai`) bak KI-porten. KI lager forslag som den ansatte godtar, endrer eller avviser; forslag og beslutning logges i `ai_usage_log`. Navn, e-post, telefon, adresse og matrikkel sendes aldri til KI. Alt bygges og prøves mot en falsk leverandør; ekte leverandør slås på av Ståle. Se «KI i bunnen» i planen.

## Språk

- **Grensesnitt, feilmeldinger, e-poster, PDF:** norsk bokmål, enkelt og konkret.
- **Kode** (variabler, funksjoner, tabeller, filnavn): engelsk. Bruk ordlisten i `docs/05-domenemodell.md` avsnitt 8, og hold den oppdatert.
- **Commit-meldinger og dokumentasjon i `docs/`:** norsk.
- **Aldri modellnavn** i commits, PR-er eller kode.

## Teknologi

TypeScript (strict), Next.js App Router, PostgreSQL, Drizzle ORM, Better Auth (e-post-OTP, samme som Optiplan), Tailwind + shadcn-mønster, Zod, Vitest, Playwright, pnpm. PWA for iPad Pro uten nett med synk per felt; synkløsningen velges i fase 1. Se `docs/06-arkitektur.md`.

## Kommandoer

```bash
pnpm dev          # start utviklingsserver (http://localhost:3000)
pnpm test         # enhets- og integrasjonstester (mot TEST_DATABASE_URL)
pnpm test:e2e     # Playwright, PC og iPad-størrelse (bygger og starter appen selv)
pnpm size         # egen JS per side fra siste bygg (kjør pnpm build først)
pnpm lint         # ESLint + modulgrenser + produktnavn
pnpm typecheck
pnpm format       # Prettier (ikke markdown)
pnpm db:generate  # lag ny migrering etter endring i src/db/schema
pnpm db:migrate   # kjør migreringer (valgfritt: database-URL som argument)
pnpm db:seed      # organisasjonen Byggcon og første admin
pnpm ai:eval [funksjon]  # kjør evalueringssettet mot den falske KI-leverandøren
```

**`start.sh`** (og `Start EzProp.command`) er Ståles oppstartsskript på Mac. Når oppsettet endres, oppdateres skriptet i samme PR. Det må virke med bash 3.2.

Oppsett første gang: `cp .env.example .env`, start PostgreSQL, `pnpm install`, `pnpm db:migrate`, `pnpm db:migrate "$TEST_DATABASE_URL"`, `pnpm db:seed`. I skyen gjøres dette av `scripts/session-start.sh`.

I utvikling sendes ikke e-post: innloggingskoder vises på http://localhost:3000/dev/epost (`DEV_MAILBOX=1`). For Playwright i skyen: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.

Tilgang: `requireOrganizationAccess(actor, organizationId, permission)` fra `@/core/access` gir en `EmployeeGrant` med `organizationId` og roller. Testhjelpere ligger i `tests/factories.ts`. Hver ny spørring som tar `organizationId` skal ha ett kall til `expectTenantIsolation` (`tests/tenant-isolation.ts`) i sin testfil; den viser at en annen organisasjon verken får rader eller tilgang. Ny tabell med `organization_id` må føres i `tests/tenant-tables.ts` med radbygger og testfilen sin, ellers blir `tests/tenant-isolation-all-tables.test.ts` rød.

## Brukeren

Ståle Limstrand er daglig leder i Byggcon og produkteier. Han er ikke utvikler, og han tar alle beslutninger om fag, pris, personvern og nye funksjoner. Skriv til ham på norsk bokmål i enkelt og konkret språk. Si tydelig fra når han må gjøre noe selv. **Bare prosjektlederen skriver til Ståle.** **Agentene merger selv** når en PR er klar: CI er grønn, ingen konflikt, ingen alvorlige funn i gjennomgangen, og ingenting står under «Må bestemmes av Ståle» (Ståle 29.10.2026). Bruk `scripts/merge-klare-pr.sh`. PR-er som trenger Ståle, får tittelen «Venter på Ståle: …» og merket `venter-pa-stale`, og merges aldri av agentene. Merge til main rulles ut til **testmiljøet**. Utrulling til produksjon gjør Ståle selv.

## Autonom modus (Ståle 29.10.2026, slått på igjen 04.11.2026, gjelder til Ståle sier fra)

Ståle vil ikke ha meldinger, spørsmål eller noe å teste mens modusen er på. Fra 04.11.2026: «Jeg synes det fungerte så bra at du kan kjøre videre på autonom utvikling igjen.» Hans ord 29.10.2026: «Kjør utvikling og testing autonomt. Er du i tvil, gå tilbake til undersøkelsene og tolk hva du mener blir beste løsning.» (Fra 13.11.2026 bygges alt for drift, se «Produksjonsklar» over.) Derfor, så lenge `docs/agenter/tilstand.md` sier «Autonom modus: på»:

- **Agentene avgjør selv** spørsmål om fag, innhold og funksjoner innenfor planen. Grunnlaget er researchen i `docs/kartlegging/` (Ståles svar er fasit, nyeste dato gjelder), hovedmålene og forskriften. Velg det som best støtter målene (best for de ansatte, KI i bunnen, færre reklamasjoner), og det enkleste som virker.
- **Hver slik beslutning føres** i `docs/09-apne-sporsmal.md` i tabellen «Avgjort av agentene mens Ståle var borte» (hva, hvorfor, kilde i researchen, hvordan det kan endres), og nevnes i PR-en. PR-en merges som vanlig.
- **Ingen PushNotification, ingen «Venter på Ståle»-PR-er.** Det som virkelig bare Ståle kan gjøre (hemmeligheter, kontoer, noe som koster penger, e-post/SMS til ekte mottakere), legges under «Trenger Ståle når han er tilbake» i tilstandsfilen, og løkken går videre med en annen oppgave.
- **Ikke lov uansett:** noe som koster penger (for eksempel å slå på tjenester i Azure), sende e-post eller SMS til ekte mottakere, logge inn i IVIT, Spectora eller SmartTakst, rulle ut til produksjon, ekte kundedata, hemmeligheter i repoet, tekst fra NS 3600, IVIT eller SmartTakst.
- **Fagtekster** (avvikstekster, regler, terskler) kan lages som utkast etter beslutningene og prøveeksemplene i researchen. De merkes «utkast, ikke godkjent av fagrådet» i data, slik at Ståle godkjenner dem før ekte bruk.
- Gjeldende fase fullføres først. Når alle punktene i en fase er levert, går løkken videre til neste fase i planen.

## Arbeidsflyt

Arbeidet gjøres av agentlaget i `.claude/agents/` med arbeidsflytene i `.claude/workflows/` (`docs/11-agentlaget.md`). Kort:

1. Les `docs/agenter/tilstand.md`. Rett først alvorlige feil som testlaget har bekreftet (`docs/agenter/testlag/funn/`, status «ny»). Finn deretter neste uavkryssede punkt i gjeldende fase i `docs/07-utviklingsplan.md` (`/neste`). Det som står under «Venter på Ståle» i planen, er ikke for agentene.
2. Spesifiser med malen `docs/maler/funksjon.md` (`/spesifiser`). Større funksjoner får en fil i `docs/funksjoner/`.
3. Skriv tester sammen med koden (tilgang og tenant-isolasjon alltid). Regler får testsaker.
4. Kjør `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` før noe meldes ferdig. Åpne PR mot `main` med PR-malen i `docs/maler/pr.md`.
5. Oppdater `docs/07-utviklingsplan.md` (kryss av; etter merge flyttes linjen til `docs/plan/levert.md`), ordlisten og `docs/agenter/tilstand.md`. Endres planen, får endringen én linje i `docs/plan/endringslogg.md`. Commit og push ofte, minst etter hvert ferdige steg.
6. Arkitekturbeslutninger skrives som ADR i `docs/adr/`.
7. Spørsmål du ikke kan avgjøre selv, legges i `docs/09-apne-sporsmal.md`. Ikke gjett.
8. **Testlaget** (løkke G) prøver det som er merget, slik at Ståle ikke må teste hver leveranse. Bekreftede feil blir retteoppgaver, forbedringer innenfor planen tas med neste oppgave i samme område, og nye ideer blir forslag i `docs/09-apne-sporsmal.md`.

## Ikke gjør

- Ikke lag produktfunksjoner som ikke står i planen.
- Ikke skriv tilgangslogikk i komponenter eller sider. Bruk `src/core/access`.
- Ikke kopier tekst fra NS 3600, IVIT eller SmartTakst inn i koden.
- Ikke logg inn i IVIT, Spectora eller SmartTakst. Kartleggingen er ferdig.
- Ikke gjør noe som koster penger eller sender e-post eller SMS til ekte mottakere uten at Ståle har sagt ja.
- Ikke lag mange avvikstekster før Ståle har avklart lengde, tone og varianter (i autonom modus: utkast er lov, se over).
