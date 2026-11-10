# ADR 0006 – KI i bunnen

Dato: 10.11.2026. Status: vedtatt av agentene i autonom modus, bare dokumentasjon. Ingen KI kjører, og ingen ekte leverandør er valgt (S8). Oppgavekort: `docs/agenter/oppgaver/fase2a-adr-ki-i-bunnen.md`. Bygger på «KI i bunnen» i `docs/07-utviklingsplan.md`, `docs/05-domenemodell.md` 4.12, arkitekturregel 8 og 11 i `docs/06-arkitektur.md`, tilkoblingslaget (`src/core/integrations`), ADR 0004 («KI-forslag») og ADR 0005 (`readSecret`).

Støtter hovedmålene:

- **KI i bunnen:** én vei inn for all KI, samme forslagsmønster overalt, og en logg som viser nytten.
- **Best for de ansatte:** forslag ser like ut overalt og kan alltid angres. Takstmannen kontrollerer og godkjenner, og har siste ord.
- **Færre reklamasjoner:** KI setter aldri TG, og ingen KI-tekst kommer i en publisert rapport uten godkjenning. Evalueringssett hindrer at dårlig KI slås på.

## Beslutninger

### 1. Modulen `src/core/ai`

All KI går gjennom `src/core/ai`. Den offentlige flaten har to funksjoner. Begge tar `EmployeeGrant` fra `requireOrganizationAccess`, aldri en organisasjons-ID fra kalleren.

```ts
// src/core/ai/index.ts (grensesnitt utviklerne bygger mot)
export type AiFeatureCode = "language_polish"; // fast kode, flere kommer per funksjon
export type AiSuggestionStatus = "suggested" | "accepted" | "edited" | "rejected";
export type AiOutcome = "ok" | "no_match" | "error";

export type AiTargetRef = { type: string; id: string; fieldKey: string };

export type AiSuggestionRequest = {
  requestId: string; // UUID v7 laget på enheten, blir id-en i ai_usage_log
  feature: AiFeatureCode;
  assignmentId: string | null;
  reportId: string | null;
  target: AiTargetRef;
  fields: Record<string, string>; // feltkode → verdi, bare koder fra funksjonens tillatt-liste
  candidates?: { id: string; text: string }[]; // for eksempel godkjente fraser
};

export type AiSuggestionResult =
  | { kind: "suggestion"; usageId: string; status: "suggested"; text: string; candidateId: string | null }
  | { kind: "no_match"; usageId: string }
  | { kind: "error"; usageId: string }
  | { kind: "disabled" }; // KI er av: ingen rad, ingen kall

export function requestSuggestion(grant: EmployeeGrant, request: AiSuggestionRequest): Promise<AiSuggestionResult>;

export type AiDecision = "accepted" | "edited" | "rejected" | "undo";

export function recordDecision(grant: EmployeeGrant, usageId: string, decision: AiDecision): Promise<void>;
```

Mapper:

```
src/core/ai/
  index.ts        offentlig flate (de to funksjonene, senere samlede tall)
  features/       én fil per funksjon: kode, rettighet, tillatt-liste, ledetekstversjon, treffgrense
  prompts/        ledetekstene, versjonert
  scrub/          bygger inndata fra tillatt-listen og vasker fritekst
  providers/      grensesnittet AiProvider, falsk leverandør, senere ekte adaptere
  usage-log.ts    lesing og skriving av ai_usage_log
  evals/          evalueringssett og kjøreren
  client/         typer og KI-køen for nettleser og iPad
```

- **Ledetekstene ligger versjonert i `src/core/ai/prompts`.** Modulene sender aldri egen ledetekst, bare funksjonskode og felt. Hver endring av en ledetekst gir ny `prompt_version`.
- **`src/core/ai` importerer aldri fra en modul** (regel 4). Den importerer fra `core/access`, `core/integrations`, `core/audit`, `db` og `shared`. Det modulen eier, sendes inn: for eksempel godkjente fraser som `candidates`.
- **Hver funksjon har én definisjon** i `features/`: fast kode, hvilken rettighet som kreves, tillatt-listen (del 6), ledetekstversjon og treffgrense (del 9).
- **`client/` importerer aldri nøkler, adaptere, `readSecret` eller noe annet som bare hører hjemme på serveren.** Klienten kaller våre egne server actions.
- Lint-regel og statisk test (som `src/core/integrations/static-checks.test.ts`) håndhever dette. De bygges i punktet «KI-modulen og loggen».

### 2. KI-porten i tilkoblingslaget

- `src/core/integrations/ports.ts` har bare de faste kodene: porten `ai` og leverandørkodene i `PROVIDERS_BY_PORT.ai` (oppgavekortet kaller listen `PROVIDER_CODES.ai`; det er samme liste).
- Grensesnittet og adapterne ligger i `src/core/ai/providers/`. Leverandørens SDK importeres bare der.
- **Bare `src/core/ai` kan bruke porten `ai`.** Håndheves med lint-regel og statisk test.
- Leverandør velges per organisasjon med en rad i `integration_connections` (`port = ai`). Modellen står i `settings.model`, og funksjonene som er godkjent for denne leverandøren og modellen, i `settings.features` (del 9).
- Nøkkelen leses bare med `readSecret`. Den står aldri i `integration_connections`, `ai_usage_log` eller loggen.
- **Tale til tekst er egen port** (`speech_to_text`) med egen tilkobling, men går gjennom `src/core/ai` og følger de samme reglene (fase 2b).

```ts
// src/core/ai/providers/types.ts
export type AiProviderRequest = {
  feature: AiFeatureCode;
  promptVersion: string;
  prompt: string; // ferdig bygget og vasket av src/core/ai
  model: string;
};

export type AiProviderResult =
  | { outcome: "ok"; text: string; tokensIn: number; tokensOut: number; cost: number; currency: string }
  | { outcome: "no_match"; tokensIn: number; tokensOut: number; cost: number; currency: string }
  | { outcome: "error"; errorCode: "timeout" | "rate_limited" | "unavailable" | "rejected" | "unknown" };

export interface AiProvider {
  readonly code: string; // fast kode fra PROVIDERS_BY_PORT.ai
  complete(request: AiProviderRequest): Promise<AiProviderResult>;
}
```

**Slik byttes leverandøren:**

1. Ny fast kode i `PROVIDERS_BY_PORT.ai` (`PROVIDER_CODES.ai` i oppgavekortet).
2. Ny adapter i `src/core/ai/providers/` som oppfyller `AiProvider`.
3. Nøkkelen legges i nøkkelboksen og leses via `readSecret`.
4. Admin lager en rad i `integration_connections` (`port = ai`, ny leverandør, `settings.model`, tom `settings.features`).
5. Evalueringssettet kjøres på nytt for hver funksjon. Funksjoner som treffer godt nok, føres i `settings.features`.
6. Den gamle raden settes til `disabled`.

Ingen endring i funksjonene, i modulene eller i `ai_usage_log`.

**Forutsetninger før en ekte leverandør legges inn:** S8 er avgjort av Ståle, databehandleravtale er signert, behandlingen skjer i EU/EØS, leverandøren trener ikke på våre data og lagrer ingenting ut over kallet, og personvernerklæringen er oppdatert.

### 3. Falsk leverandør (`fake`)

- Forutsigbare svar, null kostnad, ingen nettverkskall. Samme inndata gir alltid samme svar. Faste prøveverdier gir «ingen treff» og feil, slik at alle utfall kan prøves.
- Brukes i utvikling, test, CI og testmiljøet.
- Utvikling og test (`NODE_ENV` er ikke `production`): `fake` er standard når organisasjonen ikke har en aktiv tilkobling.
- Bygg for drift (også testmiljøet): leverandøren kommer **bare** fra en aktiv rad i `integration_connections`. Testmiljøet får en rad med `fake`. Uten aktiv tilkobling er KI av.
- **En ekte leverandør velges aldri fra miljøvariabler** (ulikt `resolveEmailSender`). Da kan ikke en feil innstilling i miljøet sende data ut.
- Bare `fake` kommer i `PROVIDERS_BY_PORT.ai` før S8. Den legges inn i punktet «KI-modulen og loggen», ikke nå.

### 4. Forslag

- **Én tabell: `ai_usage_log`, én rad per kall.** Ingen egen forslagstabell.
- **Status** er hva den ansatte gjorde: `suggested` (foreslått), `accepted` (godtatt), `edited` (endret og godtatt), `rejected` (avvist). `status` erstatter `decision` i 4.12. Tabellen er ikke bygget, så ingenting arkiveres.
- **Utfallet av kallet er eget felt** (`outcome`): `ok`, `no_match` (ingen treff), `error` (feil). Det er ikke en status. Bare `ok` gir et forslag; ellers er `status` og `output_text` tomme.
- **Forslaget ligger aldri i verdien før det er godtatt** (som i ADR 0004). Forslagsteksten ligger i `ai_usage_log.output_text`. Når den ansatte godtar, er det hans egen endring av feltet, med hans `field_clock`, og feltet får `ai_usage_id`.
- **Publiseringssperren** er derfor en enkel kontroll på serveren: hver `ai_usage_id` i rapporten må peke på en rad i samme organisasjon med status `accepted` eller `edited`. Åpne forslag (`suggested`) er ikke en del av rapporten og sperrer ikke.
- **Angre** (`recordDecision(..., "undo")`): raden går tilbake til `suggested`, og `decided_by` og `decided_at` tømmes. Var forslaget godtatt, tømmes `ai_usage_id` på feltet, og verdien settes tilbake av modulen som en vanlig endring gjort av den ansatte. Hver statusendring skrives i revisjonsloggen (`audit_log`), så historikken finnes selv om raden bare viser siste status.
- **Nytt forslag** er et nytt kall og en ny rad. Det gamle forslaget settes til `rejected` hvis det fortsatt var `suggested`.
- **Merkingen er generell.** KI-tekst havner også utenfor `answers`: avvik, sammendrag, `peer_review_comments` (`author_type = ai`), ordre fra e-post (`orders.source = email`) og fraser (`source = ai_draft`). Hver tabell som kan få tekst fra KI, får en `ai_usage_id` med sammensatt fremmednøkkel, og `target_ref` på loggraden sier hvor forslaget gjelder (type, id og feltkode). Visningen leser merket samme sted overalt.
- `decided_by` settes fra tilgangssjekken (`grant`), aldri fra klienten.

### 5. `ai_usage_log`

| Felt | Forklaring |
|---|---|
| Felles kolonner | `id`, `organization_id`, sporingsfelt, `deleted_at`/`deleted_by`, `row_version` (`src/db/schema/common.ts`) |
| `id` | Forespørselens UUID v7 fra enheten. Et nytt forsøk med samme id gir ikke ny rad og ikke nytt kall; svaret fra første gang returneres |
| `employee_id` | Hvem som ba om forslaget |
| `feature` | Fast kode, for eksempel `language_polish` |
| `provider`, `model` | Leverandørkode og modell slik tilkoblingen sa det |
| `prompt_version` | Versjonen av ledeteksten |
| `assignment_id` | Oppdraget. Kan være tom (ordreforslag fra e-post) |
| `report_id` | Rapporten. Kan være tom |
| `target_ref` | Hvor forslaget gjelder: type, id og feltkode |
| `source_fields` | Hvilke felt som var grunnlaget. Bare feltkoder, aldri verdier |
| `input_summary` | Bare feltnavn, referanser og antall (for eksempel antall tegn og antall kandidater). Aldri tekst |
| `outcome` | `ok`, `no_match`, `error` |
| `error_code` | Fast kode ved feil. Aldri leverandørens melding |
| `output_text` | Forslaget. Tom når utfallet ikke er `ok` |
| `status` | `suggested`, `accepted`, `edited`, `rejected`. Tom når utfallet ikke er `ok` |
| `decided_by`, `decided_at` | Hvem som avgjorde, og når. Fra tilgangssjekken |
| `tokens_in`, `tokens_out` | Mengde |
| `cost`, `currency` | Kostnad per kall |
| `retain_until` | Oppbevares til (10 år) |

- Sammensatte fremmednøkler med `organization_id` til `employees`, `assignments` og `reports`, slik at en rad aldri kan peke på tvers av organisasjoner.
- **Tabellen regnes som personopplysninger.** `output_text` kan inneholde noe som slapp gjennom vasken. Derfor: myk sletting (`deleted_at`), 10 år (`retain_until`), og egen rad i den interne personvernerklæringen når tabellen bygges.
- Teksten den ansatte endte med (ved `edited`), ligger i feltet forslaget gjaldt, ikke i loggen.
- **Ledetekst, inndata og svar skrives aldri til `logger`.** Feil fra leverandøren logges uten innhold: bare funksjon, leverandørkode, `error_code` og id.
- Når tabellen bygges: `organization_id` på all KI-data, spørringer filtrerer på `grant.organizationId`, hver spørring får `expectTenantIsolation`, og tabellen føres i `tests/tenant-tables.ts`.

### 6. Vask før KI

**Tillatt-liste, ikke bare fjerning.** Hver funksjon har en fast liste over feltkoder den kan sende. `src/core/ai` bygger inndata bare fra den listen. Et felt som ikke står der, gir feil i `requestSuggestion` og sendes ikke.

Felt som **aldri** kan stå på en tillatt-liste:

| Tabell | Kolonner |
|---|---|
| `contacts` | `first_name`, `last_name`, `email`, `phone`, `notes` |
| `firms` | `org_number`, `notes` |
| `assignment_parties` (partene på oppdraget) | `name`, `firm_name`, `email`, `phone` |
| `orders` | `address_text`, `gnr`, `bnr`, `snr`, `housing_association_name`, `ordered_by_text`, `external_ref`, `rejected_reason` |
| `properties` | `address`, `postal_code`, `city` |
| `cadastral_units` | `gnr`, `bnr`, `fnr` (festenummer), `snr` (seksjonsnummer), `share_number` (andels- eller aksjenummer), `association_name` (borettslag eller sameie), `association_org_number` |
| `common_areas` | `managing_agent` (forretningsfører), `notes` |
| `claims` | `claimant_text`, `description`, `building_part_text` (fritekstene) |
| `employees` | `name` |
| `users` | `name`, `email` |
| `assignments` | `internal_note` |
| Alle | Fødselsnummer. Ingen kolonne skal ha det, men mønsteret fanges i fritekst |

**Fritekst** (premisser, notater, kommentarer, diktat, e-post til ordreforslag) kan stå på en tillatt-liste, men vaskes i tillegg på to måter:

1. **Mønstre:** e-post, telefon, fødselsnummer, organisasjonsnummer og gnr/bnr (også med feste- og seksjonsnummer).
2. **Oppdragets kjente verdier:** navn på parter, kontakter og ansatte, adresse og matrikkel. `src/core/ai` henter dem selv fra databasen for oppdraget, så modulen kan ikke glemme det.

Treff erstattes med faste merker: `[navn]`, `[e-post]`, `[telefon]`, `[adresse]`, `[matrikkel]`, `[fødselsnummer]`, `[organisasjonsnummer]`.

- Mønstrene deles med loggeren og ligger ett sted i `src/shared`. De kopieres ikke.
- Vasken har tester med oppdiktede eksempler for hvert mønster og hver kjent verdi, og en test som viser at den falske leverandøren aldri får se verdiene.
- Vasken skjer bare på serveren, rett før kallet.
- **Restrisiko:** fritekst kan inneholde opplysninger vasken ikke kjenner igjen, for eksempel et navn skrevet feil eller en beskrivelse som peker på én bolig. Vasken gjør risikoen liten, ikke null. Databehandleravtale kreves derfor uansett (spørsmål 54 til Ståle).
- **Tale og bilde (fase 2b) kan ikke vaskes.** De går gjennom samme modul, EXIF og GPS fjernes fra bilder før noe sendes, og tale og bilde til en ekte leverandør krever egen vurdering av Ståle (spørsmål 55).

### 7. Hva KI aldri gjør

- KI **setter aldri TG**. TG-forslag kommer bare fra regelmotoren. Ingen KI-funksjon kan ha et TG-felt som mål.
- KI **publiserer aldri**.
- KI **sender aldri** e-post eller SMS.
- KI har ingen verktøy. Svaret er bare tekst. Det kjøres aldri som kommando, brukes aldri i en spørring og vises alltid escapet.
- Inndata er ikke til å stole på. En e-post til et ordreforslag eller en fritekst kan inneholde instrukser. De er data, ikke ordre, og kan uansett ikke gjøre mer enn å gi et dårlig forslag som den ansatte avviser.

### 8. KI velger fra det godkjente

- Der det finnes godkjente fraser, sender modulen dem inn som `candidates`, og KI velger blant dem. Svaret er id-en til en kandidat. En id som ikke var blant kandidatene, regnes som «ingen treff».
- Finner KI ingenting som passer, er utfallet `no_match`. Den lager ikke ny tekst for å fylle hull.
- Læring fra godkjente tekster og avvisninger (fase 3a) krysser aldri organisasjoner.

### 9. Evalueringssett

- Ligger i repoet: `src/core/ai/evals/<funksjon>.cases.json`, 30–50 eksempler per funksjon.
- **Bare oppdiktede eksempler.** Aldri ekte rapporttekst eller kundedata, og ingen tekst fra NS 3600, IVIT eller SmartTakst.
- Hvert eksempel har id, inndata (felt og eventuelle kandidater) og fasit. Fasiten er én av: forventet kandidat, forventet «ingen treff», tekst som må være med, eller tekst som ikke kan være med (for eksempel gjetteord, TG eller tall som ikke sto i inndata). Et eksempel kan merkes `must_pass`.
- Kommando: `pnpm ai:eval [funksjon]`. Den viser treffprosent og feiler under grensen. I CI kjøres den mot den falske leverandøren (prøver oppsettet, ikke kvaliteten).
- **Treffgrense før en funksjon slås på for en ekte leverandør:** minst 90 % av eksemplene, og 100 % av dem som er merket `must_pass`. Grensen står i funksjonens definisjon.
- En funksjon brukes bare mot en ekte leverandør når den står i `settings.features` på tilkoblingen. Ny leverandør, ny modell eller ny ledetekstversjon betyr ny kjøring. Resultatet (dato, leverandørkode, modell, ledetekstversjon, treffprosent) føres i `docs/`.
- Denne ADR-en lager bare oppsettet. Innholdet kommer med hver funksjon.

### 10. KI-kø uten nett

- Køen ligger **bare lokalt** på iPaden, i samme lokale lagring som endringskøen (ADR 0004). Ingen rad på serveren og ingen ny status før kallet er gjort.
- En forespørsel i køen har `requestId` (blir id-en i `ai_usage_log`), funksjon og mål. Feltet vises som «venter på KI».
- Køen tømmes ved utlogging og sperring av enheten, som resten av de lokale dataene (ADR 0004).
- Vask og leverandørkall skjer bare på serveren. iPaden snakker aldri med leverandøren og har aldri nøkkelen.
- Tilgang sjekkes på nytt når køen behandles. Har den ansatte mistet tilgangen, eller er KI slått av, forkastes forespørselen.
- Opptak, bilder, frasesøk og regelsjekker virker uten nett og uten KI.

### 11. KI av/på

- Nøkkelen `ai.enabled` i `organizations.settings` (tabellen `settings` er ikke bygget). Standard er av.
- **To låser** for en ekte leverandør: `ai.enabled` er på, **og** organisasjonen har en aktiv tilkobling på porten `ai`.
- Bare admin endrer bryteren og tilkoblingen (`organization.manage`). Begge endringene logges i `audit_log`.
- **Alt virker uten KI.** Er KI av, gir `requestSuggestion` svaret `disabled`, det lages ingen rad, og skjermene viser ingen KI-knapper. Forslag som allerede finnes, kan fortsatt avgjøres og angres.

### Tilgang

Ingen ny rettighet. Rettighetene finnes i `src/core/access/permissions.ts`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Forslag på oppdrag de kan endre | Be om, godta, endre, avvise forslag der de har `report.edit` eller `assignment.edit` |
| kontor | Forslag på oppdrag de kan endre | Samme, der de har `assignment.edit` |
| leder | Samlede tall per funksjon og periode (antall, status, kostnad), uten forslagstekst og aldri per ansatt (`statistics.read`). Forslag i reklamasjonssaker (`claims.read`) | Forslag i reklamasjonssaker (`claims.manage`) |
| admin | Alt, også én rad til feilsøking og reklamasjon (`organization.manage`), også når KI er av | KI av/på og leverandør (`organization.manage`) |

- Å be om og avgjøre et forslag krever samme rettighet som å endre feltet forslaget gjelder. Rettigheten står i funksjonens definisjon. Forslag i reklamasjonssaker følger saken (bare leder og admin).
- Kostnaden står på raden (`cost`, `currency`) og summeres i de samlede tallene.
- Det lages ingen spørring eller visning per ansatt før de ansatte har sagt ja (arbeidsmiljøloven kap. 9, som A121; spørsmål 57).
- **Admin stenges aldri ute.** Admin kan alltid slå KI av og på og se loggen, også når KI er av.
- All tilgang sjekkes i `src/core/access`. Spørringer filtrerer på `grant.organizationId`.

## Hvorfor

- **Én vei inn** gjør at personvernet kan kontrolleres ett sted, nytten kan måles, og leverandøren kan byttes uten å røre funksjonene.
- **Én tabell** er det enkleste som virker. `answers.ai_usage_id` peker dit fra før, og hvert forslag er uansett ett kall.
- **Forslaget utenfor verdien** gjør at et forslag aldri kan overskrive takstmannens tekst gjennom synk (ADR 0004), og at publiseringssperren blir én enkel kontroll.
- **Tillatt-liste** feiler trygt: et nytt felt i datamodellen sendes ikke til KI før noen har vurdert det.
- **Falsk leverandør** gjør at alt kan bygges og prøves for 0 kr, og at testene er forutsigbare.
- **Status og utfall hver for seg** gir rene tall: hvor ofte KI svarer, og hva de ansatte gjør med svaret.

## Forkastet

- **Egen forslagstabell ved siden av loggen.** To tabeller som må holdes i takt, uten at noe blir enklere. Tas opp igjen hvis ett kall skal gi flere forslag som avgjøres hver for seg.
- **Forslaget skrevet rett i feltet med et merke.** Enklere visning, men forslaget kan da overskrive takstmannens tekst gjennom synk, og sperren må lete i all tekst.
- **Bare mønstervask (svarteliste).** Glemmer nye felt, og fanger ikke navn.
- **Ledetekster i modulene.** Da kan ingen kontrollere hva som sendes, og evalueringssettet prøver ikke det som faktisk kjører.
- **Leverandør valgt i miljøvariabler.** Én feil innstilling kan sende data til en ekte leverandør.
- **Kall til leverandøren fra iPaden.** Nøkkelen måtte ligget på enheten, og vasken kunne omgås.
- **KI med verktøy** (som selv henter data, setter verdier eller sender). Bryter «KI foreslår, den ansatte bestemmer».
- **Kø på serveren med egen status.** Ikke nødvendig: forespørselen finnes ikke for serveren før nettet er tilbake.
- **Ny rettighet for KI.** Forslaget følger feltet, og de rettighetene finnes.

## Konsekvenser

- Ingen produktkode, ingen migrering, ingen tabell, ingen lint-regel og ingen ny avhengighet i denne oppgaven. `ports.ts` er uendret (`ai: []`).
- Punktet «KI-modulen og loggen» bygger `ai_usage_log`, `fake`, de to funksjonene, lint-regelen og den statiske testen. Testplanen der skal ha tenant-isolasjon for hver spørring, tester per rolle, admin ikke stengt ute, myk sletting og vasketester mot den falske leverandøren.
- Hver tabell som senere kan få KI-tekst, får `ai_usage_id` når den bygges.
- `docs/05-domenemodell.md` (4.7, 4.10, 4.12 og ordlisten), regel 11 og personvernlinjen i `docs/06-arkitektur.md` og «KI-forslag» i ADR 0004 er rettet slik at statusene og feltene er like.
- Beslutningene står som A148–A157 i `docs/09-apne-sporsmal.md`. Fire spørsmål om personvern står til Ståle der (nr. 54–57): restrisiko i fritekst, tale og bilde til ekte leverandør, om avviste forslag skal ligge i 10 år, og tall per person.
- Ekte leverandør, pris og databehandleravtale avgjøres av Ståle (S8) etter beslutningsnotatet sist i 2a-1.
