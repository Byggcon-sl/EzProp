# Sammenligning av kandidatene for drift uten nett (fase 1)

- **Dato:** 30.10.2026
- **Status:** foreløpig. Bygger på de automatiske prøvene (Vitest og e2e i Chromium). Prøve A og B på ekte iPad er ikke kjørt.
- **Oppgavekort:** `docs/funksjoner/fase1-sammenligning-adr.md`. Valget står i `docs/adr/0004-drift-uten-nett.md`.
- **Kriteriene og vektene** er fra planen for prøvene i `docs/funksjoner/fase1-testskjema.md` («Kriterier for å sammenligne kandidatene»).
- **Støtter hovedmål:** tid (ett valg, så fase 0b og 2 bygges på én løsning), reklamasjoner (valget bygger på det som faktisk virket, og det som ikke virket står åpent), KI først (grunnlaget for at KI-forslag senere kan vises og godkjennes på iPaden uten nett).

## Kort for Ståle

| | PowerSync | ElectricSQL | Egenbygd |
|---|---|---|---|
| Hva det er | Ferdig synkverktøy med egen lokal database i nettleseren og egen tjeneste (container) | Tjeneste (container) som bare sender endringer **ned** til iPaden. Lagring og kø på iPaden eier vi selv | Lokal lagring og kø på iPaden, og «hent endringer siden sist» fra appen. Ingen ekstra tjeneste |
| Virker prøvene (automatisk) | Delvis: lagring og sending virker; henting fra tjenesten er **aldri prøvd** | Delvis: lagring og sending virker; henting bare prøvd med **falske** svar | Ja: sending **og** henting virker hele veien i e2e, også to «iPader» i samme skjema (fletting og varsel) |
| Ekte iPad (A og B) | Ikke kjørt | Ikke kjørt | Ikke kjørt |
| Egen kode vi eier (uten tester) | Minst (ca. 1 000 linjer) | Mest (ca. 2 300 linjer + tjeneste) | Nesten like mye som Electric (ca. 2 300 linjer), ingen tjeneste |
| Drift i EU/EØS | Selvdrevet i Sweden Central, ekstra container | Selvdrevet i Sweden Central, ekstra container | Bare appen og databasen, som i dag |
| Pris i testmiljøet | Del av ca. 700–850 kr/mnd for begge tjenestene | Del av ca. 700–850 kr/mnd | 0 kr ekstra |
| Poeng (vektet, 1–3) | **2,20** | **1,65** | **2,65** |

**Foreløpig valg: egenbygd.** Reserve: PowerSync hvis lagringen på iPaden svikter, ElectricSQL hvis bare hentingen svikter. Se ADR 0004.

## 1. Virker prøvene

Tellingen er kjørt 30.10.2026 på branchen `fase1-sammenligning-adr` ved commit `1f1fb5e` (koden lik `main` ved `1510923`, versjon 0.2.26; bare dokumentasjon lagt til):

| Kommando | Resultat 30.10.2026 |
|---|---|
| `pnpm test` (Vitest, mot `TEST_DATABASE_URL`) | **67 testfiler, 988 bestått, 0 feilet, 3 hoppet over** (de tre i `scripts/azure/sync-trial-roles.test.ts` som krever `wal_level=logical`, punkt 2 i nattløkken) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:e2e` (Chromium, prosjektene `pc` og `ipad`) | **356 tester: 300 bestått, 55 hoppet over, 1 feilet** på 21,9 min. De som hoppes over, er bevisst bare kjørt i `pc` (testplanene, punkt 4 i nattløkken). Den ene feilen var helsesjekken i `ipad` (`e2e/fase-0a.spec.ts`), fordi versjonen i `package.json` ble økt mens kjøringen pågikk; kjørt på nytt etterpå: `fase-0a.spec.ts` 10 av 10 bestått. Ingen feil i synk- eller prøvetestene |

**Viktig skille:** «virker i automatiske tester» betyr Chromium på Linux uten synktjenestene (skyen har ikke Docker: `fase1-kandidat-powersync.md` pkt. 16, `fase1-kandidat-electricsql.md` pkt. 14). Ingenting er prøvd i Safari på ekte iPad. PowerSync- og Electric-tjenesten er ikke startet i noen automatisk test.

| Prøve | PowerSync | ElectricSQL | Egenbygd |
|---|---|---|---|
| **A** – én takstmann uten nett | Ikke kjørt. Forberedt: `fase1-prove-ab-powersync.md` | Ikke kjørt. Forberedt: `fase1-prove-ab-electricsql.md` | Ikke kjørt. Forberedt: `fase1-prove-ab-egenbygd.md` |
| **B** – to i samme skjema | Ikke kjørt | Ikke kjørt | Ikke kjørt |
| Uten nett, omlasting, sending når nettet kommer (grunnlaget for A) | Virker i e2e: `e2e/fase-1-powersync.spec.ts` (lokal database, hurtiglager, sending til `/api/prove/synk/endringer`). **Henting fra tjenesten ikke prøvd** | Virker i e2e: `e2e/fase-1-electricsql.spec.ts`. Henting bare med simulerte Electric-svar (200, `live`, 409) gjennom testkroken | Virker i e2e hele veien: `e2e/fase-1-egenbygd.spec.ts` (sending og henting mot ekte hente-rute og testdatabase) |
| Tekstfletting og varsel (grunnlaget for B) | Flettingen er felles kode (`text-merge.ts`, `text-state.ts`, flettes også på serveren i `apply-changes.ts`). Ikke prøvd mellom to enheter gjennom tjenesten | Som PowerSync. Vist med testkroken («en annen enhet») | **Virker i e2e med to nettleserkontekster** (bare `pc`): «tekst skrevet på én enhet vises på den andre uten omlasting», «samtidig tekst i samme felt gir begge bidrag på begge», «TG på begge gir samme verdi på begge og Endret av en annen hos den som tapte» (`e2e/fase-1-egenbygd.spec.ts`). Det er prøve B i liten skala, ikke på ekte iPad |
| **C** – lagring i Safari | e2e i `pc` og `ipad` med PowerSync (`e2e/fase-1-prove-c-lagring.spec.ts`). Ekte iPad: ikke kjørt (`fase1-prove-c-lagring-resultat.md`) | Ikke kjørt med denne kandidaten. Plassmålingen er felles kode | Ikke kjørt med denne kandidaten i e2e. Plassmålingen er felles kode |
| **D** – bilder | Bildekøen er felles (`photo-uploader.ts`), ikke kjørt med denne kandidaten i prøve D | Som PowerSync | e2e i `pc` og `ipad` med egenbygd (`e2e/fase-1-prove-d-bilder.spec.ts`). Ekte iPad: ikke kjørt (`fase1-prove-d-bilder-resultat.md`) |
| **E** – regler uten nett | Regelmotoren er uavhengig av kandidaten (`src/modules/offline-trial/rules/`, felles testsaker i `trial-rule-cases.ts`) | Som PowerSync | e2e med egenbygd (`e2e/fase-1-prove-e-regler.spec.ts`), Vitest med samme testsaker på serveren. Ekte iPad: ikke kjørt |
| **F** – innlogging som har gått ut | e2e med PowerSync (`e2e/fase-1-prove-f-innlogging.spec.ts`). Uten tjenesten må testen trykke «Synk nå» etter innlogging | Ikke kjørt med denne kandidaten | Ikke kjørt med denne kandidaten. Sendingen går gjennom samme rute og samme innlogging som de andre |
| Synkstatus | e2e (`e2e/fase-1-synkstatus.spec.ts`). Uten tjenesten når den aldri «Alt er lagret på serveren» | e2e. Når «Alt er lagret» fordi skriveruten finnes | e2e. Når «Alt er lagret» med ekte henting |
| Kandidatgrensen | `src/modules/offline-trial/sync/candidate-boundaries.test.ts`: sidene og bildekøen importerer aldri SDK-en, bare `TrialSyncStore` | Samme test | Samme test |

**Poeng (vekt 40 %, port: A og C må bestås):** egenbygd **3** (eneste med hele rundturen i automatiske tester, og brukt i prøve D og E), PowerSync **2** (lokal database og sending virker, også i C og F; henting aldri prøvd), ElectricSQL **2** (samme lokale kjerne som egenbygd; henting bare med falske svar). Porten (A og C på ekte iPad) er ikke prøvd for noen.

## 2. Hvor mye arbeid

**Linjetelling** 30.10.2026 med `wc -l` (alle linjer, også tomme og kommentarer), fra `src/modules/offline-trial/sync/`:

```bash
cd src/modules/offline-trial/sync
for d in custom electricsql powersync local; do
  echo "$d kode: $(find $d -name '*.ts' -o -name '*.tsx' | grep -v '\.test\.' | xargs cat | wc -l)" \
       "tester: $(find $d -name '*.test.ts*' | xargs cat | wc -l)"
done
echo "sync/ rett: kode $(ls *.ts | grep -v '\.test\.' | xargs cat | wc -l) tester $(ls *.test.ts | xargs cat | wc -l)"
```

| Del | Kode | Tester | Brukes av |
|---|---|---|---|
| **Egen kode** `custom/` | 560 | 879 | egenbygd |
| **Egen kode** `electricsql/` | 534 | 285 | ElectricSQL |
| **Egen kode** `powersync/` | 851 | 218 | PowerSync |
| **Felles** `local/` (lokal kjerne: lagring, kø, innfletting) | 1 523 | 1 156 | egenbygd og ElectricSQL |
| **Felles** filene rett i `sync/` (kontrakt, bildekø, visningskopi, tekstfletting, valg av kandidat, testkrok) | 1 433 | 1 686 | alle tre |

Arkitektens tall med testene regnet med (bare til sammenligning): custom 1 439, electricsql 819, powersync 1 069, local 2 679. De stemmer med summene over.

**Serverdelen** (samme kommando, `src/modules/offline-trial/server/` og `src/app/api/prove/synk/`):

| Del | Kode | Tester | Brukes av |
|---|---|---|---|
| Hente-ruten `changes-since.ts` + `synk/hent/route.ts` | 238 | 574 | egenbygd |
| Proxy-ruten `electric-shape.ts` + `synk/shape/route.ts` | 211 | 598 | ElectricSQL |
| Synktoken `sync-token.ts` + `synk/token/route.ts` | 110 | 196 | PowerSync |
| PowerSync-oppsett `powersync/config.yaml` + `sync-rules.yaml` | 56 | – | PowerSync |
| Skriveruten `apply-changes.ts` + `change-schema.ts` + `synk/endringer/route.ts` | 479 | 698 | alle tre |

**Sum egen kode per kandidat (uten tester og uten det som er felles for alle tre):**

| | Klient | Server | Sum | Annet å eie |
|---|---|---|---|---|
| PowerSync | 851 | 166 | **ca. 1 000** | Tjenesten (container), synkregler, JWT-nøkkel, ca. 9 MB worker og wasm som kopieres til `public/@powersync/` (`next.config.ts`), publikasjon og replikeringsplass |
| ElectricSQL | 534 + 1 523 | 211 | **ca. 2 270** | Tjenesten (container), migrering `0002` (`REPLICA IDENTITY FULL` og publikasjon), `ELECTRIC_SECRET`, replikeringsplass |
| Egenbygd | 560 + 1 523 | 238 | **ca. 2 320** | Ingenting utover appen og databasen |

**Nye avhengigheter:** PowerSync: `@powersync/web`, `@powersync/react`, `@journeyapps/wa-sqlite` (`package.json`). ElectricSQL: ingen (`@electric-sql/client` ble prøvd og tatt ut igjen, `fase1-prove-ab-electricsql.md`). Egenbygd: ingen. `yjs` brukes av alle tre.

**Tid brukt:** alle tre under to arbeidsdager (resultatfilene, «Tid brukt»). Egenbygd gikk raskt fordi den lokale kjernen kom fra ElectricSQL.

**Det som må bygges videre for ekte maler, uansett kandidat:** synk per felt med `field_clock` (prøven synker per rad), `sync_conflicts` på serveren, tekstfletting for alle tekst- og frasefelt, bildekø for ekte bilder, myk sletting for alle tabeller, `organization_id` fra grant. Forskjellen er hvor mye i tillegg:

- **PowerSync:** synkregler (YAML) og et klientskjema per tabell, i tillegg til Drizzle-skjemaet. Ny publikasjon og replikeringsrolle for hver ny tabell.
- **ElectricSQL:** én shape per tabell gjennom proxyen, `REPLICA IDENTITY FULL` per tabell, og hele den lokale kjernen som for egenbygd.
- **Egenbygd:** hente-ruten og den lokale kjernen må gjøres generelle (tabellene meldes inn), og den kjente grensen i hentemarkøren må fjernes (se ADR 0004, fase 2b).

**Poeng (vekt 20 %):** PowerSync **3** (minst egen kode), egenbygd **2** (mest egen kode, men ingen tjeneste), ElectricSQL **1** (like mye egen kode som egenbygd, pluss tjeneste og migrering).

## 3. Drift i EU/EØS

Kilder: ADR 0003, `docs/drift/powersync.md`, `docs/drift/electricsql.md`, `docs/drift/testmiljo-azure.md`.

| | PowerSync | ElectricSQL | Egenbygd |
|---|---|---|---|
| Hvor data går | iPad → appen (skriving); PowerSync-container → iPad (lesing), med JWT fra appen | iPad → appen (både skriving og lesing gjennom proxyen); Electric-container → appen | iPad ↔ appen. Ingenting annet |
| Selvdrevet i Azure Sweden Central | Ja, bygget i Bicep, av som standard (ADR 0003) | Ja, bygget i Bicep, av som standard (ADR 0003) | Ja, i appen som i dag |
| Hva tjenesten kan lese | Rollen `powersync_repl` har `REPLICATION`, som gir mulighet til å lese hele databasen via replikeringsprotokollen, uansett `SELECT` (`docs/drift/powersync.md`). Godtatt bare for testmiljøet | `electric_repl`: samme forhold (`REPLICATION`) | Ingen ekstra rolle. Appens vanlige tilgang, med `requireOrganizationAccess` |
| Databehandleravtale | Bare ved skytjenesten (nr. 10). Ikke valgt | Bare ved skytjenesten (nr. 11). Ikke valgt | Trengs ikke |
| Nettverk | Åpen https-inngang for iPadene | https med IP-sperre og `ELECTRIC_SECRET` (forbehold: delte utgående adresser, ADR 0003 pkt. 4) | Ingen ny inngang |

**Poeng (vekt 15 %):** egenbygd **3**, PowerSync **2**, ElectricSQL **2**.

## 4. Pris

| | PowerSync | ElectricSQL | Egenbygd |
|---|---|---|---|
| Selvdrevet, testmiljøet | Én container (0,5 vCPU / 1 GiB). Anslaget i ADR 0003 er ca. 700–850 kr per måned **for begge tjenestene sammen**; prisen for én alene er ikke regnet ut | Som PowerSync | 0 kr ekstra (ingen tjeneste) |
| Produksjon (10 takstmenn, 2 000 rapporter i året) | Ikke regnet ut. Minst én container til, og senere privat nettverk (ADR 0003, «Konsekvenser») | Som PowerSync | Ingen ekstra tjeneste. Litt mer last på appen og databasen (hentinger hvert 5. sekund mens appen er åpen, `fase1-prove-ab-egenbygd.md`) |
| Skytjeneste | Ikke valgt (A13) | Ikke valgt (A14) | Finnes ikke |
| Å bytte senere | Synkregler og klientskjema må skrives om. Lisensen på tjenesten (se under) | Lagret posisjon og proxy må skrives om; kjernen kan beholdes | Kjernen kan beholdes for ElectricSQL; for PowerSync bak samme kontrakt (`TrialSyncStore`) |

**Poeng (vekt 10 %):** egenbygd **3**, PowerSync **2**, ElectricSQL **2**.

## 5. Hvor modent verktøyet er

Versjon og lisens er bare hentet fra filer i repoet. «Ikke sjekket» betyr at det ikke finnes en kilde i repoet.

| | PowerSync | ElectricSQL | Egenbygd |
|---|---|---|---|
| Tjeneste, versjon | `journeyapps/powersync-service:1.27.2` (`docker-compose.yml`) | `electricsql/electric:1.8.1` (`docker-compose.yml`) | Ingen tjeneste |
| Tjeneste, lisens | FSL-1.1-ALv2 ifølge resultatfilen (sjekket mot npm 28.10.2026, `fase1-prove-ab-powersync.md`). Ikke sjekket mot en fil i repoet | Ikke sjekket mot en fil i repoet (`docs/drift/electricsql.md` sier Apache-2.0, uten kilde) | – |
| Klient, versjon og lisens | `@powersync/web` 2.5.0 Apache-2.0, `@powersync/common` 2.4.0 Apache-2.0, `@powersync/react` 2.1.0 Apache-2.0 (`node_modules/*/package.json`). `@journeyapps/wa-sqlite` 2.0.10: MIT (`LICENSE` i pakken). `yjs` 13.6.33 MIT | Ingen klientpakke i bruk. `@electric-sql/client` 1.5.28 ble prøvd og tatt ut | Ingen pakke. Bruker IndexedDB, som er innebygd i nettleseren |
| Hvor lenge stabilt | Ikke sjekket | Ikke sjekket | Vår egen kode, laget 29.10.2026 |
| Kjente begrensninger fra prøvene | Flere faner synker ikke samtidig (av i Safari i SDK-en). Service workeren må hurtiglagre worker og wasm, ellers åpner ikke databasen uten nett | SDK-klienten holdt ikke regelen om høyst ett kall per 5 s, og ble byttet med egen løkke. Update og delete sender bare endrede kolonner uten `REPLICA IDENTITY FULL` | Hentemarkøren har en kjent grense (rad som blir synlig mer enn 60 s «bakover i tid», test i `changes-since.test.ts`). Ikke trygt med flere faner (ingen `navigator.locks`) |
| Postgres og Drizzle | Postgres med logisk replikering. Drizzle ikke direkte (eget klientskjema) | Postgres med logisk replikering. Drizzle ikke direkte | Drizzle og Postgres direkte, uten logisk replikering |
| Safari på iPad | Ikke prøvd | Ikke prøvd | Ikke prøvd |

**Poeng (vekt 15 %):** PowerSync **2** (mest ferdig bygget, men aldri prøvd mot tjenesten), egenbygd **2** (ingen avhengighet å stole på, men ny kode), ElectricSQL **1** (klientpakken holdt ikke våre regler og ble tatt ut).

## 6. Det som ikke virket

**PowerSync**
- Henting fra tjenesten er aldri prøvd (ingen Docker i skyen). Uten tjenesten når synkstatusen aldri «Alt er lagret på serveren», og køen sendes bare med «Synk nå» (`e2e/fase-1-prove-f-innlogging.spec.ts`).
- Endringer serveren avviser (400 eller 409), blir liggende i køen og prøves på nytt for alltid; køen stopper for den enheten (`fase1-prove-ab-powersync.md`, «Det som ikke virket», 3).
- Utlogging tømmer ikke den lokale databasen og de hurtiglagrede sidene (samme fil, 2 og 11). Gjelder i praksis alle tre; må løses før ekte data («Sperring av iPader» under «Minimum før ekte data» i planen).
- Et skjema som ikke er synket til enheten, kan ikke åpnes (samme fil, 4).

**ElectricSQL**
- **Electrics 400-svar sendes videre til iPaden uendret** (PR #10, funn 1 fra sikkerhet-personvern). Proxyen (`server/electric-shape.ts`) videresender kroppen ved 400, 409 og 429. Ikke rettet; ville måtte rettes før ekte data hvis ElectricSQL velges.
- `ShapeStream` fra `@electric-sql/client` holdt ikke regelen om høyst ett kall per tabell per 5 s, og holdt posisjonen bare i minnet. Tatt ut; egen løkke brukes (`fase1-prove-ab-electricsql.md`).
- En eldre melding som var underveis før vår skriving, kan tas for ekkoet av vår egen skriving (kjent svakhet, samme fil).
- Avviste bunter blir liggende som i PowerSync. Ikke prøvd mot ekte Electric-tjeneste.

**Egenbygd**
- Hentemarkøren bruker `updated_at` med 60 s overlapp. En rad som blir synlig mer enn 60 s «bakover i tid» (lang transaksjon eller appklokke mer enn 60 s bak databasen), hoppes over. Dokumentert med test (`fase1-prove-ab-egenbygd.md`, `server/changes-since.test.ts`).
- `updated_at` settes av databasen ved innsetting og av appklokken ved oppdatering (`src/db/schema/common.ts`). Bør ryddes før ekte data.
- Rader endret de siste 60 s sendes på nytt i hver henting (ca. 12 ganger per endring med takt 5 s). Ufarlig, men unødvendig nettbruk. Ikke målt på ekte iPad.
- Avviste bunter blir liggende som for de andre (felles kjerne med ElectricSQL).

**Felles for alle tre (skiller dem ikke)**
- **Bildekøen kunne stå fast:** én opplasting uten svar stoppet alle bildene etter den til siden ble lastet på nytt. Rettet med tidsavbrudd per opplasting i PR #14 (`photo-uploader.ts`, `photoUploadTimeoutMs`).
- **Småfunnene fra prøve D** (liten oppgave h, PR #35): en visningskopi som avvises (400) eller får 404 etter myk sletting, sendes på nytt hver runde; metadatasjekken i `photo-storage.ts` slipper COM og andre APP-felt; to tegneveier i `display-copy.ts`; falskt `{ id } as TrialPhotoRow` i `sendPhoto`; adressen til visningsruten bygges to steder; e2e-saker som dobler Vitest. Rettes på branchen `fase1-smafunn-prove-d-f`.
- Skriveruten gjør én spørring per rad (N+1 i `applyTrialChanges`, punkt 12 i nattløkken). Krav til fase 2b.
- `sync_conflicts` finnes ikke i prøven. TG, valg og tall følger «siste endring kommer fram, vinner» på serveren, og varselet vises bare på iPaden (`foreign-change.ts`). Den tapte verdien lagres ikke. **Ikke prøvd.**

## 7. Poeng samlet

| Kriterium | Vekt | PowerSync | ElectricSQL | Egenbygd |
|---|---|---|---|---|
| Virker prøvene (A og C er port; ikke kjørt for noen) | 40 % | 2 | 2 | 3 |
| Arbeid | 20 % | 3 | 1 | 2 |
| Drift i EU/EØS | 15 % | 2 | 2 | 3 |
| Pris | 10 % | 2 | 2 | 3 |
| Modenhet | 15 % | 2 | 1 | 2 |
| **Vektet sum** | | **2,20** | **1,65** | **2,65** |

Summen avgjør ikke alene (planen for prøvene). Begrunnelsen, det som ikke virket, og hva prøve A og B må vise, står i ADR 0004.
