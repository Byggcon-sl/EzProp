# Funksjon: Beslutningsnotat om KI-leverandør og Anthropic-adapteren

- **Fase:** 2a-1 KI-grunnmuren (siste punkt)
- **Modul:** kjerne (`src/core/ai`, `src/core/integrations`) og `docs/`
- **Status:** klar til bygging (forhåndsvurdert 11.11.2026 av forenkler, arkitekt, sikkerhet-personvern og test-leder)
- **Branch:** `fase2a-ki-leverandor` (bygger på `main`)
- **Støtter hovedmål:** KI i bunnen: den ekte leverandøren kobles inn bak den ene KI-porten, slik at alle funksjonene i 2a-2 kan bruke ekte KI så snart Ståle har lagt inn nøkkelen og avtalene er på plass. De ansatte: Ståle får ett kort notat i klarspråk med det han må vite og avgjøre, i stedet for å lete selv. Reklamasjoner: notatet sier hvilken modell som brukes til hvilken funksjon, og at hver funksjon må bestå evalueringssettet før den slås på, så dårlige forslag ikke havner i rapporter.

## Problem

Ståle har valgt Anthropic og har en API-nøkkel (10.11.2026), men koden har bare den falske leverandøren. Uten adapter kan ikke KI prøves med ekte svar i testmiljøet, og 2a-2 må bygges blindt. Uten notatet vet ikke Ståle hva det koster per rapport, om data behandles i EU/EØS, om Anthropic trener på dataene, hvilken avtale som må signeres, og hva han må velge for norsk tale til tekst (Anthropic tilbyr ikke det).

## KI i bunnen

- **Hva KI gjør fra første dag:** ingenting nytt for den ansatte. Adapteren gjør at funksjonene kan bruke Anthropic i stedet for den falske leverandøren, uten at en eneste funksjon endres. Forslagsmønsteret (godta, endre, avvis) og loggen i `ai_usage_log` er uendret.
- **Data som lagres for KI:** ingen nye tabeller. Raden i `integration_connections` (`port = ai`, `provider = anthropic`, `secret_ref = ANTHROPIC_API_KEY`, `settings.model`, `settings.features`, `settings.pricing`) er konfigurasjonen. Leverandør, modell, mengde (tokens inn og ut) og kostnad skrives i `ai_usage_log` som før, nå med ekte tall fra svaret.
- **Alt gjennom `src/core/ai`:** ja. Adapteren ligger i `src/core/ai/providers/anthropic.ts` og kalles bare fra `requestSuggestion` etter rettighet, tillatt-liste, sperre, `features`-sjekk, vask og lekkasjesjekk. Enheten snakker aldri med Anthropic og har aldri nøkkelen (ADR 0006 del 10).

## Brukerhistorier

- Som **daglig leder (Ståle)** vil jeg **lese ett kort notat** slik at **jeg vet hva KI koster per rapport, hvor dataene behandles, og hva jeg må signere og velge før ekte KI slås på**.
- Som **admin** vil jeg **koble organisasjonen til Anthropic med en tilkobling og en hemmelighet** slik at **KI kan slås på uten kodeendring, og slås av igjen med én bryter**.
- Som **takstmann** vil jeg **få forslag fra ekte KI på samme måte som i dag** slik at **jeg bare kontrollerer og godkjenner**.

## Omfang

**Med:**

1. **Beslutningsnotat** `docs/beslutningsnotat-ki-leverandor.md`, skrevet til Ståle i klarspråk (uten programmeringsord), høyst rundt to sider. Innhold:
   - **Første avsnitt svarer rett ut på EU/EØS.** Notatet lover ikke EU/EØS for Anthropic direkte. Hovedregelen ved bruk av Anthropic direkte er behandling utenfor EØS (USA m.fl.); EU-behandling fås gjennom en skyleverandør som tilbyr Anthropic-modellene i EU-region. Påstandene sjekkes mot leverandørenes offentlige sider med dato. Alt som ikke kan bekreftes uten avtaletekst eller svar fra leverandøren, står i listen «Dette er usikkert».
   - **Modellvalg per funksjon:** modellklasse (minste, mellomste, største) for funksjonene i 2a og 2b: språkvask, forslag fra frasebanken, oppsummering, KI-sjekk før publisering, ordreforslag fra e-post, tale og bilde. Senere faser (sidemann-hjelp i 3a og videre) får én samlelinje. **Modellnavn og modell-id skrives ikke i notatet**; de står bare i tilkoblingens `settings.model`.
   - **Pris per rapport:** regnestykke med oppdiktede mengder (antall kall og tekstmengde per rapport), per modellklasse, i kroner. Prisene oppgis med dato og kilde (offentlig prisliste) og merkes «må sjekkes på nytt før avtale». Tallene er anslag og skal si det. Ingen tall fra ekte rapporter eller kunder.
   - **Databehandleravtale:** hva som må på plass (vilkår for API-kunder, DPA, grunnlag for overføring hvis data går ut av EØS), og at Ståle må signere.
   - **Trening og lagring, holdt fra hverandre:** «trener ikke på dataene» er ikke det samme som «lagrer ikke dataene». Notatet sier hva vilkårene sier om trening, hvor lenge data oppbevares ved vanlig bruk, at innhold som flagges for misbruk kan ligge lenger, og at null-lagring krever egen avtale. ADR 0006 sier «lagrer ingenting ut over kallet»; enten avtales null-lagring, eller Ståle endrer forutsetningen. Agentene avgjør ikke dette.
   - **Norsk tale til tekst:** to til tre alternativer, minst ett i EU-region, vurdert på EU/EØS, databehandleravtale, lagring og pris. Opptak kan ikke vaskes (spørsmål 55). Anbefaling, men Ståle velger (S8). Ingenting bygges før 2b.
   - **Hva Ståle må gjøre**, i rekkefølge: velge EU/EØS-vei, signere avtalen, svare på spørsmål 54–58 og 73, legge nøkkelen inn som secret `ANTHROPIC_API_KEY`, velge tale-leverandør. Notatet sier at tilkoblingen `anthropic` ikke lages for en organisasjon med ekte data før avtalen er signert, EU/EØS-veien er valgt og spørsmålene er besvart. I testmiljøet (oppdiktede data) kan Ståle slå den på; det koster penger og er hans valg. Forslag 64 (tak på KI-bruk) nevnes som anbefalt før nøkkelen legges inn.
   - Notatet kopierer ikke tekst fra leverandørenes vilkår; det oppsummerer med egne ord og lenker til kilden. Ingen ansatte nevnes ved navn, og ingen visning av KI-bruk per person (spørsmål 57).
2. **Leverandørkoden `anthropic`** i `PROVIDERS_BY_PORT.ai` (`src/core/integrations/ports.ts`) og i `PROVIDERS_REQUIRING_SECRET` (`src/core/integrations/connections.ts`). Fast kode (regel 6).
3. **Strengt skjema for `settings`** i `settingsSchemaFor` (`connections.ts`), grenen `anthropic`, med `.strict()`:
   - `model`: påkrevd, `^[A-Za-z0-9._:-]{1,100}$`.
   - `features`: liste med kjente funksjonskoder fra `features.ts`, standard tom.
   - `pricing`: **påkrevd**, `{ inputPerMillion: number >= 0, outputPerMillion: number >= 0, currency: "NOK" }`, lagt inn av admin. Ingen pristabell, ingen modellnavn og ingen valutaomregning i koden.
   - Ingen andre nøkler (ingen `baseUrl`). Ekstra felt avvises.
   - `secret_ref` for `anthropic` må være nøyaktig `ANTHROPIC_API_KEY`; sjekkes i `createConnection` og `updateConnection`.
4. **Adapteren** `src/core/ai/providers/anthropic.ts`, som implementerer `AiProvider` (grensesnitt under):
   - Innebygd `fetch` mot Anthropics meldings-API. **Ingen ny avhengighet, ingen SDK.** `fetch` sendes inn (standard `globalThis.fetch`), så testene bruker falsk HTTP.
   - **Adressen er en fast konstant i adapteren**, aldri fra `settings`, miljø eller forespørsel. `fetch` kalles med `redirect: "error"` og `cache: "no-store"`, uten nye forsøk ved feil (køen fra KI-kø tar nye forsøk), med tidsgrense (AbortController) og fast øvre grense for tokens ut.
   - Nøkkelen kommer inn som `apiKey` og ligger bare i lukningen, aldri som felt på objektet som returneres. Den sendes i hodet `x-api-key`, aldri i kroppen.
   - **Kroppen har bare** modell, grense for tokens ut og den vaskede ledeteksten. Ingen ansatt-id, organisasjons-id, oppdrags-id, `requestId` eller organisasjonsnavn i kropp, metadata eller hoder.
   - Svarkoder: tidsavbrudd → `timeout`, 429 → `rate_limited`, 5xx og nettverksfeil → `unavailable`, 400/401/403 → `rejected`, alt annet → `unknown`. Ingen underkoder.
   - **Svaret:** grense på størrelse før det leses. Bare tekstblokkene brukes; flere tekstblokker settes sammen, andre blokker ignoreres. Svar som stopper fordi grensen for tokens er nådd → `unknown` (en halv setning skal aldri havne i rapporten). Ugyldig JSON, uventet form, manglende `usage` eller negative tall → `unknown`. Tomt svar eller «ingen endring» → `no_match` som hos den falske leverandøren.
   - Kostnad = tokens × `pricing` / 1 000 000, i NOK.
   - Ingen logging av forespørsel, svar, hoder eller feilobjektet fra `fetch`; bare fast feilkode. Leverandørens melding går aldri til logg, feil, `ai_usage_log` eller `last_error` (adapteren skriver ikke til tilkoblingen).
5. **Valg av leverandør** (`provider-resolution.ts`): adapteren bygges fra tilkoblingen (fabrikk). `anthropic` er på **bare** når `ai.enabled` er `true`, det finnes en aktiv, ikke slettet tilkobling med `provider = anthropic`, `settings` består skjemaet i punkt 3, `secret_ref` er `ANTHROPIC_API_KEY`, og `readSecret` gir en ikke-tom nøkkel. `InvalidSecretRefError` og `SecretNotFoundError` fanges. Mangler noe: `disabled`, ingen kall, ingen rad, og ingen navn eller verdi lekker. Tilkoblingen hentes fortsatt bare med `grant.organizationId`. Miljøvariabler og `NODE_ENV` velger aldri leverandør (A160). `readSecret` kalles bare her.
6. **Sperrene i `requestSuggestion`:**
   - `isBlocked` sammenligner på fast kode: alt som ikke har `code === "fake"`, regnes som ekte. `ai_trial`, `answer` og fritekst uten oppdrag gir `blocked` mot `anthropic`, uten kall.
   - **Ny sperre `settings.features`** (A194): mellom tillatt-liste/sperre og vask. Funksjon som ikke står i listen → `disabled`, ingen rad, intet kall. Tom eller manglende liste betyr at alt er av. `fake` har ingen liste og tar alt.
   - **Lekkasjesjekken flyttes** fra evalueringskjøreren (`evals/run.ts`) til et felles sted i `src/core/ai` og kjøres på den ferdige, vaskede ledeteksten før kallet til en ekte leverandør (A195). Treff → `blocked`-rad uten kall. Evalueringskjøreren bruker den samme funksjonen.
7. **Vakt i `runEvals`:** kaster når `provider.code !== "fake"`. `evals/` importerer fortsatt ikke database eller adapteren.
8. **Logger:** nytt mønster for nøkkelformatet i `src/shared/lib/logger.ts` som ekstra sikring, test med tydelig oppdiktet nøkkel.
9. **Statiske tester** (`static-checks.test.ts` 12.8 og E7.5) snevres inn til tillatt-liste, ikke fjernes: `fetch(` bare i `providers/anthropic.ts`, `readSecret` bare i `provider-resolution.ts`. `client/` og `evals/` har ingen av delene. Fortsatt ingen SDK og ingen `process.env` i `src/core/ai`.
10. **Test mot modellnavn:** én Vitest-test (ingen lint-regel) som leter i `src/`, `tests/`, `e2e/` og notatet etter `claude-` og navnene på modellfamiliene. Testen bygger søkeordene av biter, så den selv ikke inneholder navnene, og søket treffer ikke «CLAUDE.md».
11. **Ingen ekte nettverkskall i tester:** en global oppsettfil i Vitest får `fetch` til å kaste for Anthropics vertsnavn. Seed har ingen `anthropic`-tilkobling.
12. **Eksisterende tester** som bruker `provider: "anthropic"` som «ukjent leverandør» (trial-target-testplan 2.2 og 2.8, `other_provider` i `trial-target.test.ts`) bytter til en oppdiktet ukjent kode.
13. **ADR 0006** oppdateres: Anthropic er første ekte adapter; modell-id i `settings.model`, nøkkel i `ANTHROPIC_API_KEY`. Statuslinjen («ingen ekte leverandør er valgt») rettes. Del 2 presiseres: koden kan ligge i main, men forutsetningene (avtale, EU/EØS, trening og lagring, personvernerklæring) gjelder før tilkoblingen `anthropic` opprettes for en organisasjon med ekte data og `ai.enabled` slås på. Kjent begrensning: nøkkelen er felles for alle organisasjoner og må løses før selskap nummer to får KI (A193). «Slik byttes leverandøren»: fake-raden slettes mykt før `anthropic`-raden lages (én rad per port).
14. **Domenemodellen** (4.10, 4.12 og ordlisten): `anthropic`, `settings.model`, `settings.features`, `settings.pricing`, «KI-adapter».
15. **Testmiljøet:** `ANTHROPIC_API_KEY` legges inn samme steder som `MS_GRAPH_CLIENT_SECRET` (`.github/workflows/deploy-azure.yml`, `infra/azure/main.bicep`, `tests/deploy-workflow.test.ts`, eventuelt `start.sh`), i nøkkelboksen når `ENABLE_KEY_VAULT` er på (ADR 0005). Tom verdi er lov og betyr KI av. Én linje i `docs/drift/testmiljo-azure.md`. `.env.example` får bare en tom linje.
16. **Planen:** nytt punkt i «Minimum før ekte data»: «KI-leverandør: databehandleravtale signert, EU/EØS-vei valgt og spørsmål 54–58 og 73 besvart, før tilkoblingen `anthropic` lages for en organisasjon med ekte data.» Én linje i `docs/plan/endringslogg.md`.
17. **Tilstandsfilen**, «Trenger Ståle»: adapteren er klar; hva som må på plass før nøkkelen brukes med ekte data (som i punkt 16); oppskrift for å legge inn nøkkelen og lage tilkoblingen i testmiljøet.
18. Versjon `0.6.0` i `package.json` (minor, ekte leverandør er en større leveranse). Planpunktet krysses av.

**Ikke med (bevisst utelatt):**

- Ingen kall mot Anthropics ekte API, verken i tester, CI, e2e eller for hånd. Ingen kostnad.
- Ingen tilkobling `anthropic` i seed-data eller testmiljøet. Ståle lager den.
- `pnpm ai:eval` mot ekte leverandør og avslutningskode under treffgrensen (koster penger, tas når Ståle har lagt inn nøkkelen).
- Ingen skjerm for å velge leverandør eller modell.
- Tale til tekst og bilde bygges ikke (fase 2b, spørsmål 55).
- Strømming, verktøykall, hurtigbuffer for ledetekster og batch-API.
- Ingen nye KI-funksjoner. `language_polish` slås ikke på mot `anthropic` (står ikke i `settings.features` før evalueringen er kjørt).
- Tak på KI-bruk (forslag 64) bygges ikke; det står som forslag hos Ståle.
- Nøkkel per organisasjon (A193).
- Ingen ny kontroll av at hemmeligheten finnes ved oppstart.

## Grensesnitt

```ts
// src/core/ai/providers/anthropic.ts
export const ANTHROPIC_PROVIDER_CODE = "anthropic";
export const ANTHROPIC_SECRET_REF = "ANTHROPIC_API_KEY";
export type AiPricing = { inputPerMillion: number; outputPerMillion: number; currency: "NOK" };
export type AnthropicProviderOptions = {
  model: string;
  apiKey: string;
  pricing: AiPricing;
  fetch?: typeof fetch;   // standard globalThis.fetch
  timeoutMs?: number;
};
export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider;

// src/core/ai/provider-resolution.ts
export type ResolvedAiProvider =
  | { kind: "enabled"; provider: AiProvider; model: string; features: readonly string[] | null } // null = alle (bare fake)
  | { kind: "disabled" };
```

`AiProvider` er uendret (`code`, `model`, `complete`). `fakeAiProvider` forblir samme faste objekt.

## Tilgang

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Forslag som i dag | Godta, endre, avvise som i dag |
| kontor | Som takstmann | Som takstmann |
| leder | Som i dag | Som i dag |
| admin | Tilkoblingen (uten nøkkel) | KI av/på og tilkobling (`organization.manage`), som i dag |

Ingen ny tilgangslogikk. Alt sjekkes i `src/core/access` som før. Admin stenges ikke ute.

## Data

- Ingen nye tabeller. `provider` er fri tekst uten CHECK-regel, så `anthropic` trenger ingen migrering (arkitekten har sjekket; utvikler bekrefter). Ingen ny rad i `tests/tenant-tables.ts`.
- `ai_usage_log.cost` er `not null`; derfor er `pricing` påkrevd (se avgjørelser).
- Svaret lagres som i dag i `ai_usage_log.output_text` (10 år, myk sletting). Ingen endring i oppbevaring; spørsmål 56 står åpent.

## Skjermer

Ingen nye. Prøvesiden `/prove/ki` er uendret og bruker bare den falske leverandøren (`ai_trial` er sperret mot ekte leverandør).

## Regler

Ingen fagregler. Tekniske regler med tester:

- `anthropic` er av uten `ai.enabled`, uten aktiv tilkobling, med ugyldige `settings`, med annen `secret_ref` eller uten nøkkel.
- Nøkkelen sendes bare i hodet til Anthropic og finnes aldri i logg, feil eller `ai_usage_log`.
- Ledeteksten som sendes, er vasket og har bestått lekkasjesjekken.

## Testplan

**Enhet, adapteren med falsk `fetch`:**
- A1: riktig adresse, `x-api-key` og versjonshode bare i hodene, modell fra `settings.model`, fast grense for tokens, vasket ledetekst, `redirect: "error"`, `cache: "no-store"`. Hele kroppen og alle hodene har ingen id-er, organisasjonsnavn eller nøkkel utenfor `x-api-key`.
- A2: tekst, tokens inn og ut, kostnad og valuta; flere tekstblokker; tomt svar og «ingen endring» gir `no_match`.
- A3: tabell over feil: tidsavbrudd (falsk tid), 429, 500/503, 400, 401, 403, nettverksfeil, ugyldig JSON, uventet form, avkortet svar, manglende `usage`, negative tall, for stort svar. Hver gir sin faste kode. Leverandørens melding og nøkkelen står ikke i feilen, i console-spion eller i raden. Ingen nye forsøk.
- A4: loggeren skjuler oppdiktet nøkkel.

**Integrasjon mot testdatabasen:**
- R1: tabell der én lås mangler om gangen gir `disabled`: KI av, ingen tilkobling, mykt slettet eller inaktiv tilkobling, ukjent leverandør, tom eller manglende modell, manglende eller ugyldig `pricing`, ekstra felt i `settings` (f.eks. `baseUrl`), annen `secret_ref`, manglende nøkkel, tom nøkkel (""). Alt på plass gir `enabled`. Ingen unntak lekker.
- R2: `ai_trial`, `answer` og fritekst uten oppdrag mot `anthropic` gir `blocked`, `fetch` kalles ikke.
- R3: funksjon som ikke står i `settings.features` (og tom liste) gir `disabled` uten rad og uten `fetch`.
- R4: hele flyten med stubbet `fetch`: navn og adresse er vasket før kallet; en ledetekst med lekkasje gir `blocked` uten kall; raden har `provider = anthropic`, modell fra konfigurasjonen og ekte tokens og kostnad.
- R5: regresjon: den falske leverandøren virker som før (fabrikk og `code`-sjekk).
- R6: `expectTenantIsolation` for veien med `anthropic`: organisasjon A har Anthropic, B har ingenting; B får `disabled`, A sin tilkobling og modell brukes aldri, og motsatt. `createConnection` med `anthropic` og annen `secret_ref` avvises.
- R7: tilgang per rolle som før; admin stenges ikke ute.

**Statiske tester:**
- S1: ingen modellnavn eller modell-id (punkt 10).
- S2: global `fetch`-sperre for Anthropics vertsnavn; seed uten `anthropic`; `ANTHROPIC_API_KEY` tom i CI.
- S3: ingen ny avhengighet; SDK forbudt.
- S4: `runEvals` avviser alle leverandører unntatt `fake`.
- S5: tillatt-listen for `fetch` og `readSecret` (punkt 9).

**Dokument:** D1: test som sjekker at notatet har de sju delene, og at listen «Dette er usikkert» finnes. Klarspråk sjekkes manuelt.

**E2e:** `/prove/ki` på PC og iPad-størrelse, også uten nett, grønn uten endring.

## Akseptkriterier

- [ ] `docs/beslutningsnotat-ki-leverandor.md` finnes, er i klarspråk og har alle sju delene (modellvalg per funksjon, pris per rapport, EU/EØS, databehandleravtale, trening og lagring, tale til tekst, hva Ståle må gjøre). Svaret om EU/EØS står i første avsnitt, og «Dette er usikkert» er en egen liste.
- [ ] Ingen modellnavn eller modell-id i notatet, koden eller testene (test). Commit-meldinger og PR-tekst sjekkes manuelt.
- [ ] Adapteren sender riktig forespørsel og bare det den skal, og leser tekst, tokens og kostnad riktig (A1, A2).
- [ ] Hver feiltype, også avkortet svar, gir riktig fast kode, og leverandørens melding og nøkkelen står ikke i logg eller feil (A3, A4).
- [ ] `resolveAiProvider` gir `disabled` for hver manglende lås og `enabled` når alt er der (R1).
- [ ] `ai_trial`, `answer` og fritekst uten oppdrag blir `blocked` mot `anthropic` uten `fetch` (R2).
- [ ] En funksjon som ikke står i `settings.features`, gir `disabled` uten rad og uten `fetch` (R3).
- [ ] Lekkasjesjekken stopper kallet i den ekte veien (R4).
- [ ] En annen organisasjons tilkobling brukes aldri (`expectTenantIsolation`), og `anthropic` godtar bare `secret_ref = ANTHROPIC_API_KEY` (R6).
- [ ] Ingen test, e2e eller CI-jobb gjør nettverkskall til Anthropic (S2).
- [ ] Ingen ny avhengighet i `package.json` (S3).
- [ ] `pnpm ai:eval` kjører bare mot `fake` (S4).
- [ ] KI-forslag kan fortsatt godtas, endres og avvises, og logges (eksisterende tester grønne).
- [ ] Virker på iPad-størrelse (eksisterende e2e for `/prove/ki` grønn).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.

## Avgjørelser fra forhåndsvurderingen (prosjektlederen, 11.11.2026)

- **Pris:** `settings.pricing` på tilkoblingen, ingen konfigfil (forenkler, arkitekt). Mangler den, er KI av (test-leder), ikke kostnad 0 eller null. Begrunnelse: `ai_usage_log.cost` er `not null` (null krever migrering), og kostnad 0 i det stille gir feil tall for Ståle. Ett skjema som feiler lukket er enklest. A196.
- **Nøkkelen:** fast navn `ANTHROPIC_API_KEY` for `anthropic` (arkitekt, sikkerhet-personvern). At nøkkelen er felles for alle organisasjoner, er kjent begrensning (bare Byggcon i dag) og må løses før selskap nummer to får KI. Akseptkriteriet er skrevet om (test-leder vei b). A193.
- **`features`:** `disabled` før vasken, ingen rad, intet kall; tom eller manglende liste er av (alle tre). A194.
- **Lekkasjesjekken:** bygges nå i den ekte veien (sikkerhet-personvern), ikke utsatt. Liten endring, og den er siste vern før tekst forlater oss. A195.
- **Avkortet svar:** `unknown` (test-leder). Halve setninger skal aldri bli forslag.
- **Modellnavn-sjekk:** Vitest-test, ingen lint-regel (forenkler), med søkeord som hindrer treff på «CLAUDE.md» (test-leder).
- **Tale:** to til tre alternativer, minst ett i EU-region (forenkler).
- **Tenant-isolasjon:** sikkerhet-personvern og test-leder ber om én test for veien med `anthropic`; forenkler mente det ikke trengs uten ny spørring. Testen tas med, fordi det er nye låser i `resolveAiProvider` (navnet på nøkkelen) som skal bevises mot en annen organisasjon.
- **Personvern** (overføring ut av EØS, DPIA, behandlingsprotokoll, personvernerklæring, null-lagring): Ståles spørsmål, ført som nr. 73 i `docs/09-apne-sporsmal.md`, ikke som A-beslutning. Stopper ikke PR-en, fordi ingen tilkobling lages og intet sendes.

## Åpne spørsmål

- Nr. 73 i `docs/09-apne-sporsmal.md` (Ståle, personvern): EU/EØS-vei, null-lagring, overføringsgrunnlag, DPIA, behandlingsprotokoll og personvernerklæring.
- Leverandør for norsk tale til tekst (S8, Ståle velger).
- A197: adapteren bygges mot Anthropic direkte; EU-vei avgjøres av Ståle (lett å endre, ny adapter bak samme port).
