# Funksjon: KI-kø uten nett

- **Fase:** 2a-1 KI-grunnmuren
- **Modul:** kjerne (`src/core/ai/client`, ny klientdel) og prøvesiden `/prove/ki`
- **Status:** klar til bygging etter forhåndsvurdering runde 2 (11.11.2026, branch `fase2a-ki-ko` fra `main`, main med evalueringssettet PR #141 og læringsløkken PR #142 flettet inn). Runde 2 kuttet synkfunnene, T-0019 og merket ved utlogging (se «Avgjort ved uenighet»).
- **Støtter hovedmål:**
  - **De ansatte:** takstmannen kan be om KI-hjelp også i kjelleren eller på hytta uten dekning. Han trykker én gang, skriver videre, og forslaget kommer når nettet er tilbake. På en delt iPad ser ingen en annens tekst.
  - **KI i bunnen:** KI virker likt med og uten nett. Køen er grunnmuren som tale til tekst, diktat og bilde til utkast på iPaden (fase 2b) bygger på. Alt går fortsatt uendret gjennom `requestSuggestion` på serveren, med vask, tilgang, KI av/på og logg.
  - **Færre reklamasjoner:** et forslag som kommer sent, overskriver aldri tekst takstmannen har skrevet etterpå (T-0004, T-0005). Forslaget føres alltid på den som ba om det.

## Problem
I dag sier `/prove/ki` bare «Krever nett» når nettet er borte, og teksten forsvinner ved ny lasting selv om siden sier at den er lagret (T-0035). På iPaden er takstmannen ofte uten nett. Uten kø må han huske hvilke felt han ville ha hjelp til og trykke på nytt senere. ADR 0006 del 10 har bestemt hvordan køen skal virke, men den er ikke bygget.

## KI i bunnen
- **KI gjør:** det samme som før (`language_polish` på prøvesiden). Det nye er at forespørselen venter lokalt og sendes av seg selv når nettet kommer tilbake. Forslaget vises i det vanlige forslagskortet, og takstmannen godtar, endrer eller avviser som før.
- **Ingen KI på enheten.** iPaden snakker aldri med leverandøren og har aldri nøkkelen. Vask og leverandørkall skjer bare på serveren i `requestSuggestion`, som ikke endres.
- **Data som lagres for KI:** én post per mål og felt i lokal lagring på enheten:
  - `requestId` (tilfeldig UUID v4 fra `crypto.randomUUID()`, som prøvesiden bruker i dag; **ikke v7**, fordi v7 har klokkeslettet i seg og da kunne ventetiden uten nett regnes ut per ansatt i `ai_usage_log`. Blir id-en i `ai_usage_log`, gir samme rad om den sendes to ganger, valideres med Zod på serveren),
  - `feature`, mål (`targetType`, `targetId`, `fieldKey`, `assignmentId: string | null`, `null` på prøvesiden, så formen ikke må endres i 2b) og feltene funksjonen skal ha (bare koder fra tillatt-listen, se punkt 1),
  - eier: `organizationId` og `employeeId` (bare til lokal tømming, sendes aldri),
  - `queuedAt` og `attempts` (blir på enheten, sendes aldri og logges aldri; ventetid per person er tidsmåling etter arbeidsmiljøloven kap. 9).
- Til serveren sendes bare `requestId`, `targetId` og `text`, som i dag. Ingen rad på serveren og ingen ny status før kallet er gjort.
- **Alt gjennom `src/core/ai`:** klientdelen ligger i `src/core/ai/client/` (inngang `@/core/ai/client` med egen `index.ts`) og er et rent blad: verdi-importer bare fra egen mappe, `src/core/ai/limits.ts`, `@/shared` og `zod`. Fra `../types` og `../features` er bare `import type` lov. Måltypen (`ai_trial`) står ikke i `client/`; den gis inn fra siden.

## Brukerhistorier
- Som **takstmann uten nett** vil jeg trykke «Foreslå bedre språk» og se «Venter på KI», slik at jeg kan skrive videre og få forslaget når nettet er tilbake.
- Som **takstmann** vil jeg at et forslag som kommer etter at jeg har skrevet mer, aldri sletter det jeg skrev.
- Som **neste person på samme iPad** skal jeg aldri se teksten som lå i køen til en annen, heller ikke om han glemte å logge ut.

## Omfang
**Med:**
1. **Køen** i `src/core/ai/client/queue.ts` (ren logikk). `queue.ts` kjenner bare grensesnittet `AiQueueStore`, med to utgaver: IndexedDB (`queue-store.ts`) og minne (til enhetstester). Ingen ny avhengighet (`fake-indexeddb` finnes ikke). I 2b byttes bare utgaven. Funksjoner: `enqueue`, `list`, `remove`, `clear`, og `processQueue(send)`, der `send` gis inn fra siden, så kjernen ikke importerer app eller moduler.
   - **IndexedDB-utgaven:** rått API med en liten egen åpner (kjernen kan ikke importere `idb.ts` fra prøvemodulen). Egen database `local-ai-queue`, versjon 1 (A186). Tilkoblingen lukkes etter hver operasjon og ved `versionchange`, så en annen fane aldri blokkeres. Prøves bare i e2e.
   - **Tillatt-listen på klienten:** en liten konstant i `client/` typet som `Record<AiFeatureCode, readonly string[]>` (bare `import type`). En statisk test viser at den er lik `AI_FEATURES[*].allowedFields`, så listen i praksis finnes ett sted. Endring krever gjennomgang av sikkerhet-personvern (A175). `AI_FEATURES` flyttes ikke.
   - **Én post per mål og felt:** ny forespørsel på samme mål og felt erstatter den gamle i én IndexedDB-transaksjon (finn med `list()`, høyst 50 poster, ingen indeks). Den nye posten får **ny `requestId`**, ellers svarer serveren med forslaget på den gamle teksten. Erstatning teller ikke som ny post, så den virker også når køen har 50.
   - **Grense:** høyst 50 poster, felt på høyst `AI_FIELD_MAX_LENGTH` tegn. Full kø eller for lang tekst gir fast norsk melding, aldri stille tap.
   - **Rekkefølge:** `queuedAt`, deretter `requestId` (enhetens klokke kan gi like tider).
   - **Lesing med eiersjekk:** hver lesing kjører Zod-skjemaet for køposten (egen form i `client/`). Poster som ikke passer, har annen `organizationId` eller `employeeId` enn den innloggede, eller er eldre enn 7 dager (A189), **slettes fra lageret**, ikke bare hoppes over, og sendes aldri. Dette er den eneste mekanismen for organisasjonsbytte og ny ansatt; `clearIfOtherOrganization` i prøvemodulen brukes ikke.
   - Ingen tekst utenfor IndexedDB: ikke i localStorage, adressen, `console.*` eller feilmeldinger. Feil fra IndexedDB og Zod gir bare feilnavn. Mangler IndexedDB: fast melding, ikke krasj.
2. **Behandling når nettet er tilbake:** `online`-hendelsen og sidelasting starter `processQueue`. Én behandling av gangen per fane (lås i minnet), én post om gangen. To faner som sender samme post, gir samme rad fordi `requestId` er den samme. Utfallet avgjøres av en ren funksjon `classifyQueueOutcome(result, online)`: `online` gis inn, funksjonen leser ikke `navigator.onLine` selv. Svaret fra `send` har typen `AiQueueSendResult` (`kind` og `reason`), som eies av `client/`; svaret fra serverhandlingen på prøvesiden passer inn i den. Forslagsteksten går uendret tilbake til siden gjennom et tilbakekall. Tre grener:
   - **Prøv senere** (posten blir liggende, runden stopper): nettfeil (`online` er false, eller kallet kaster `TypeError`) eller tidsavbrudd på **30 sekunder**.
   - **Ferdig** (posten fjernes, runden går videre): alle kjente svar, `suggestion`, `no_match`, `error`, `disabled` (dekker også `blocked`, som serverhandlingen allerede viser som «KI er av.») og `failed` med `reason` `invalid` eller `no_access`. Meldingen vises fast i kortet.
   - **Utløpt økt har ingen egen gren.** Serverhandlingen gir i dag `failed` med `no_access` når økten mangler (`trialGrant` gir `null`), så posten fjernes med fast melding. Teksten står fortsatt i feltet på siden som er åpen.
   - **Ukjent serverfeil** (unntak mens nettet er oppe, eller `failed` med `reason: "unknown"`): `attempts` økes, posten blir liggende, runden går videre til neste post. Etter 3 forsøk fjernes posten med den faste meldingen «Noe gikk galt. Teksten din er uendret. Prøv igjen.» Én dårlig post stopper aldri resten (lærdom fra T-0001).
   - Posten fjernes alltid på `requestId`, aldri på mål, så en nyere post på samme felt ikke slettes. Svar på en erstattet `requestId` vises som forslag på eldre tekst (punkt 4), aldri med «Bruk».
   - `TrialFailure` i `src/app/(ansatt)/prove/ki/actions.ts` får en fast kode `reason: "invalid" | "no_access" | "unknown"` ved siden av meldingen, så klienten aldri tolker norsk tekst. `AiRequestRejectedError` (id-en er tatt, ulovlig mål, ikke egen forespørsel) gir `reason: "invalid"`, ikke `"unknown"`, så posten fjernes med en gang i stedet for tre forsøk som aldri kan lykkes. Meldingen er den samme faste teksten som før. Skjemaet tar fortsatt bare `requestId`, `targetId` og `text`.
3. **Prøvesiden `/prove/ki`:**
   - Den innloggedes `organizationId` og `employeeId` hentes fra `grant` (svaret fra `requireOrganizationAccess` i `page.tsx`, `grant.organizationId` og `grant.employeeId`) og gis til klienten. Ingen ny spørring.
   - Uten nett er «Foreslå bedre språk» aktiv og legger forespørselen i køen. Kortet viser «Venter på KI. Forslaget kommer når nettet er tilbake.» (ny tekst i `AI_SUGGESTION_TEXTS`, `queued`). Erstatter «Krever nett …» på denne siden.
   - Mål-id og tekst hentes fra køen ved ny lasting, slik at teksten faktisk står der (retter T-0035 punkt 4).
   - Når svaret kommer, vises det i det vanlige forslagskortet.
4. **Forslag på eldre tekst (T-0004):** kortet husker teksten forslaget ble laget fra. Er feltet endret etterpå, viser kortet «Forslaget gjelder teksten før du skrev videre.» og «Bruk» erstattes av «Nytt forslag». Gjelder både vanlige og køede forslag.
5. **Angre etter at teksten er endret (T-0005):** er feltet endret etter «Bruk», setter «Angre» bare status tilbake i loggen og beholder teksten, med meldingen «Statusen er satt tilbake. Teksten din er uendret.» Merknad til ki-ansvarlig: mønsteret må ses mot publiseringssperren før det brukes i 2a-2 (føres i `docs/09-apne-sporsmal.md`).
6. **Tømming ved utlogging:** `LogOutButton` henter køen med dynamisk import (fellesbunten vokser ikke), tømmer køen med `clear()` og kaller `signOut`. Feil ved tømming stopper ikke utloggingen. Tømmingen stopper en behandling som pågår (en teller i minnet), så et svar etter utlogging verken vises eller skrives tilbake. Ble tømmingen ikke fullført (feil, fanen lukket, økten utløpt), rydder eiersjekken i punkt 1 ved neste lesing for en annen ansatt eller organisasjon. Logger samme person inn igjen, er det hans egen tekst. Ikke noe merke i localStorage og ingen sletting av hele databasen.
7. **Flytting av konstant:** `AI_FIELD_MAX_LENGTH` flyttes til `src/core/ai/limits.ts` (ingen importer) og eksporteres videre fra `request.ts`, så ledetekstene i `features.ts` ikke havner i nettleseren.
8. **Dokumentasjon:** ADR 0006 del 10 rettes i teksten, merket med dato 11.11.2026 og A186: egen database `local-ai-queue`, eier på posten, grense 50, én per mål og felt med ny `requestId` ved erstatning, `requestId` uten tid i seg (v4) og hvorfor, 7 dagers levetid, at køen holder fritekst ukryptert lokalt og at bare oppdiktede data brukes nå, og at den flyttes inn i den ekte lokale databasen i fase 2b. Krav til 2b i ADR-en: eiersjekk og aldersrydding kjøres ved innlogging og oppstart av appen, ikke bare på skjermen som bruker køen (i dag ryddes det bare når `/prove/ki` åpnes); og en fane som ble lastet av en annen ansatt, må ikke kunne sende sin post under en ny økt (eiersjekken bruker id-ene siden fikk ved lasting). Ordlisten (`docs/05-domenemodell.md` avsnitt 8): `queuedAt`, «venter på KI», database og lager. A186–A191 i `docs/09-apne-sporsmal.md`. Versjon 0.5.13 → 0.5.14.

**Ikke med (bevisst utelatt):**
- KI-kø i ekte skjermer (rapporten, befaringen på iPad). Kommer i fase 2b, og ikke før «Sperring av iPader» er levert, fordi køen holder fritekst lokalt.
- Tømming ved **sperring av enheten**: sperring finnes ikke ennå (fase 2b). Står i ADR-en.
- Kryptering av køen på enheten. Vurderes sammen med sperringen i 2b.
- Tømming av resten av lokal lagring (prøveskjemaet, bildene) ved utlogging. Nevnes i PR-en.
- Bakgrunnssynk når siden er lukket (Service Worker, Background Sync), og å bufre `/prove/ki` for lasting uten nett.
- Varsel om at et forslag er klart på en annen side.
- Rad på serveren før kallet, ny status i `ai_usage_log` eller ny tabell.
- Endring av `requestSuggestion` eller ny spørring på serveren.
- Resten av T-0035 (menypunkt for `/prove/ki`, «KI er av» før man skriver, punkt 3 gammel feil forsvinner) og T-0019 (ett `aria-live`-område). Tas i neste oppgave på prøvesiden.
- Småfunnene i synkområdet fra T-0001 (dybdegrense og `__proto__` i `stripValue`/`cleanData`, 400 i stedet for 500 i synkruten) og den overflødige tom-sjekken i `requestSuggestion`. Gjelder prøvemodulens synk, ikke KI-køen. Egen oppgave i synkområdet eller sammen med 2a-2.
- Andre småfunn fra T-0001 (400 fra proxy, klasse 22, logging med parametre, doble tester, ustabil test i `photo-uploader.test.ts`).

## Tilgang
Ingen ny rettighet. Køen ligger bare på enheten og gir ingen tilgang i seg selv. Når den sendes, sjekkes alt på nytt på serveren.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Egne poster på enheten | Be om forslag der de har `report.edit` (som før) |
| kontor | Egne poster på enheten | Som før |
| leder | Egne poster på enheten | Som før |
| admin | Egne poster på enheten | Som før. Admin stenges ikke ute |

- Organisasjon og ansatt kommer alltid fra økten på serveren, aldri fra posten. `organizationId` og `employeeId` i posten brukes bare til lokal tømming.
- Mistet tilgang når køen sendes: avslag før raden lages, altså **ingen rad**, posten fjernes. KI av: `disabled`, ingen rad. Sperret: `blocked`-rad som i dag, vist som «KI er av.».

## Data
- **Ingen ny tabell, ingen migrering, ingen ny spørring.** Derfor ingen endring i `tests/tenant-tables.ts`.
- Lokalt: IndexedDB-databasen `local-ai-queue` versjon 1, lager `ai_queue` med nøkkel `requestId`, ingen indeks (A186, A187).
- Den lokale køen er ikke data som oppbevares i 10 år; den er en mellomlagring og slettes. Raden i `ai_usage_log` slettes fortsatt bare mykt.

## Skjermer
Bare prøvesiden `/prove/ki`, PC og iPad-størrelse.
- Uten nett: ett trykk på «Foreslå bedre språk» legger forespørselen i køen (før: ikke mulig). Kortet viser «Venter på KI …».
- Nettet tilbake: forslaget dukker opp uten trykk.
- Antall trykk for å få et forslag uten nett: fra «umulig, prøv senere» til ett trykk.

## Regler
Ingen nye regler eller TG-logikk.

## Akseptkriterier
**Kø og lesing (enhetstester mot minneutgaven av `AiQueueStore`; IndexedDB-utgaven prøves i e2e):**
- [ ] `enqueue`, `list`, `remove`, `clear`, rekkefølge etter `queuedAt` og så `requestId`.
- [ ] Ny forespørsel på samme mål og felt erstatter den gamle med ny `requestId`; virker også med 50 poster.
- [ ] Grensen: 49 og 50 poster går, nr. 51 gir fast melding. Tekst lik `AI_FIELD_MAX_LENGTH` går, én over gir fast melding.
- [ ] Ved lesing slettes poster med feil form, ukjent feltkode, `__proto__` i fields, annen `organizationId`, annen `employeeId` eller eldre enn 7 dager.
- [ ] IndexedDB mangler: fast melding, ikke krasj.
- [ ] `requestId` i en ny post har ikke tid i seg (versjonssifferet er 4).

**Behandling (enhetstester for `classifyQueueOutcome` og `processQueue`):**
- [ ] Nettfeil og tidsavbrudd (30 s) stopper runden og beholder posten.
- [ ] Kjente svar og `failed` med `invalid`/`no_access` fjerner posten og runden går videre. `classifyQueueOutcome` får `online` inn og leser ikke `navigator`.
- [ ] Ukjent serverfeil øker `attempts`, går videre til neste post, og fjerner posten etter 3 forsøk med fast melding.
- [ ] Låsen: to samtidige `processQueue` gir ett kall per post.
- [ ] Svar på en erstattet `requestId` fjerner ikke den nye posten og vises ikke med «Bruk».
- [ ] Kallet til serveren har bare `requestId`, `targetId` og `text` (ikke `queuedAt`, `employeeId`, `organizationId`).
- [ ] Tømming under en pågående behandling: svaret vises ikke og skrives ikke tilbake.

**Server (integrasjon mot testdatabasen):**
- [ ] Samme `requestId` to ganger og KI av: ingen nye tester. PR-en peker på de eksisterende i `src/core/ai/request-suggestion.test.ts` (6.11 etter hverandre, 6.12 samtidig med `Promise.all`, V5.7 «KI er av» gir `disabled` og ingen rad), fordi serveren er uendret.
- [ ] `reason` på `TrialFailure`: mistet tilgang gir `no_access` og ingen rad, ugyldig tekst gir `invalid`, `AiRequestRejectedError` gir `invalid`, ukjent feil gir `unknown`.
- [ ] Ekstra felt i kallet (fremmed `organizationId` eller `employeeId`) endrer ingenting: raden får organisasjon og ansatt fra økten.
- [ ] Tenant-isolasjon: den eksisterende `expectTenantIsolation` for `requestSuggestion` (`src/core/ai/request-suggestion.test.ts`) dekker kø-flyten, fordi serveren er uendret. Det står i PR-en; ingen ny isolasjonstest.
- [ ] Én test viser at et forslag fra køen havner i samme forslagsflyt (godta, endre, avvise logges som før).

**Prøvesiden (komponent og e2e på PC og iPad-størrelse, nett av med `context.setOffline`):**
- [ ] Uten nett: trykk legger én post i køen og kortet viser «Venter på KI». Nett på: forslaget vises, køen er tom.
- [ ] Posten overlever ny lasting: teksten står i feltet og forslaget kommer.
- [ ] Utlogging: legg i kø, logg ut, køen er tom. Komponenttest: feiler tømmingen, går utloggingen likevel videre.
- [ ] Ny ansatt uten utlogging: legg i kø, slett øktkaken, logg inn som annen ansatt i samme organisasjon: teksten vises ikke, køen er tom, ingen rad i `ai_usage_log`.
- [ ] KI av før nettet kommer: «KI er av.».
- [ ] T-0004: endret tekst etter forslaget gir ikke «Bruk», egen tekst står (komponent og e2e).
- [ ] T-0005: «Angre» etter endret tekst beholder teksten og setter status tilbake (komponent).
- [ ] Testdata er oppdiktet, uten navn, telefon eller adresse; e-post bare på `example.com`.

**Statiske sjekker:**
- [ ] Importgrensene håndheves med den eksisterende lint-regelen for modulgrenser (`eslint-rules/module-boundaries.js`, med test i `module-boundaries.test.ts`), utvidet med én regel: `src/core/ai/client` har bare verdi-importer fra egen mappe, `limits.ts`, `@/shared` og `zod` (ingen `@/db`, `server-only`, `src/core/ai/index.ts` eller servermoduler), bare `import type` fra `../types` og `../features`; og `@/core/ai/client` importeres bare fra `src/app/(ansatt)/prove/ki` og `src/app/(ansatt)/log-out-button.tsx` (henvisning til ADR 0006 del 10; fjernes når «Sperring av iPader» er levert). Ikke noe eget testskript. Går det ikke i lint-regelen, legges sjekken i den eksisterende `src/core/ai/static-checks.test.ts`.
- [ ] `src/core/ai/index.ts` eksporterer ikke klientdelen. `client/` kaller aldri `.complete(`, har ingen `console.` og ingen `ai_trial` (sjekkes i `static-checks.test.ts`).
- [ ] Statisk test: tillatt-listen i `client/` er lik `AI_FEATURES[*].allowedFields`.
- [ ] Lint, typecheck, test og e2e er grønne.
- [ ] T-0004, T-0005 og T-0035 punkt 4 settes til «rettet» med PR-nummer (T-0035 for punkt 4; resten av T-0035 står åpent).

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A186 (lett å endre):** KI-køen ligger i en egen IndexedDB-database `local-ai-queue` i `src/core/ai/client`, ikke i prøvedatabasen. ADR 0006 del 10 rettes i teksten. Grunn: kjernen kan ikke importere fra moduler (regel 4), og prøvemodulen skal kastes eller gjøres om. Flyttes inn i den ekte lokale databasen i fase 2b uten at serveren endres.
- **A187 (lett å endre):** én post per mål og felt med ny `requestId` ved erstatning, høyst 50 poster, ingen indeks. Grunn: takstmannen vil ha forslag på teksten slik den står nå, og med 50 poster er gjennomgang av listen nok.
- **A188 (lett å endre):** forslag som kommer etter at teksten er endret, kan ikke brukes direkte; «Angre» etter endret tekst rører ikke teksten. Grunn: egen tekst skal aldri gå tapt uten at takstmannen ser det (T-0004, T-0005, ADR 0004).
- **A189 (lett å endre):** poster i KI-køen eldre enn 7 dager slettes ved lesing. Grunn: fritekst skal ikke bli liggende ukryptert på en iPad som ikke kommer på nett. En befaring ferdigstilles normalt innen en uke.
- **A190 (lett å endre):** posten har eier (`organizationId`, `employeeId`) og slettes ved lesing hvis eieren ikke er den innloggede. Det er eneste mekanisme for bytte av organisasjon og ansatt, og dekker også en tømming ved utlogging som ikke ble fullført. Grunn: ADR 0004 og planens «Delt iPad og utlogging» (bare den som gjorde endringen, sender den).
- **A191 (lett å endre):** `requestId` i KI-køen er tilfeldig (UUID v4), ikke tidsbasert (v7). Grunn: id-en lagres i `ai_usage_log`, og med v7 kunne ventetiden uten nett regnes ut per ansatt (tidsmåling, arbeidsmiljøloven kap. 9). Rekkefølgen i køen bruker `queuedAt` lokalt.

## Avgjort ved uenighet i forhåndsvurderingen
- **Indeks (forenkler mot arkitekt):** ingen indeks. Med høyst 50 poster holder `list()`, og det er mindre å flytte i 2b. Erstatningen skjer i én transaksjon, så to like poster oppstår ikke.
- **Organisasjonsbytte (forenkler, arkitekt, sikkerhet):** én måte: eiersjekk ved lesing som sletter. Ingen kobling til `clearIfOtherOrganization`.
- **Utfall (forenkler: to grener; arkitekt og test-leder: flere):** tre grener i `classifyQueueOutcome`. Den tredje (ukjent serverfeil med 3 forsøk) trengs fordi én krasjende post ellers stopper køen for alltid eller forkastes ved første nettblaff på serveren, samme feil som T-0001.
- **E2e for utlogging (forenkler mot sikkerhet og test-leder):** utloggingstesten forenkles til «logg ut, køen er tom». Det alvorlige punktet om delt iPad får sin egen e2e (ny ansatt uten utlogging), fordi den viser at eiersjekken virker der tømmingen ikke ble kjørt.
- **Tenant-isolasjon (forenkler og test-leder):** ingen ny spørring, så den eksisterende `expectTenantIsolation` for `requestSuggestion` gjelder. Det legges bare til én test for at ekstra felt i kallet ikke endrer organisasjon eller ansatt (sikkerhet punkt 9), og en rollematrise for sending lages ikke, fordi tilgangssjekken er den samme som i dag.
- **Utløpt økt (runde 2, forenkler):** ingen egen gren og ingen tolkning av omdirigering. Forenkleren foreslo «prøv senere», men serverhandlingen gir allerede `failed` med `no_access` når økten mangler. Det enkleste er å bruke det serveren svarer: posten fjernes med fast melding, teksten står i feltet. Det er også tryggest på en delt iPad.
- **Synkfunnene og tom-sjekken (runde 2, forenkler):** flyttet ut. De gjelder prøvemodulens synk, og serveren for KI skal være uendret.
- **T-0019 og T-0035 punkt 3 (runde 2, forenkler):** flyttet til neste oppgave på prøvesiden, bestemt nå i stedet for underveis.
- **Merket `ai-queue-clear-pending` (runde 2, forenkler mot sikkerhet og arkitekt):** kuttet. Eiersjekken dekker en tømming som ikke ble fullført, for en annen ansatt eller organisasjon; for samme person er det hans egen tekst. Dermed faller også sikkerhetens punkt om å fjerne merket bare ved vellykket tømming og arkitektens punkt om sletting av hele databasen. Tilkoblingen lukkes likevel etter hver operasjon, slik at `clear()` aldri blokkeres av en annen fane.
- **Avslag på `requestId` (arkitekt `rejected` mot sikkerhet `invalid`):** `invalid`. Begge vil ha posten fjernet med en gang; `invalid` gir samme virkning uten en ny kode.
- **`requestId` v7 (arkitekt) mot v4 (sikkerhet):** v4 (A191). Personvern veier tyngre, og v7 trengs ikke når rekkefølgen tas fra `queuedAt`.
- **Server-tester (runde 2, forenkler):** ingen nye tester for samme `requestId` og KI av; de finnes (6.11, 6.12, V5.7). Nye tester bare for `reason` og for ekstra felt i kallet.
- **Statisk sjekk (runde 2, forenkler og sikkerhet):** én utvidelse av lint-regelen for modulgrenser dekker både grensene for `client/` og hvem som får importere køen. Ikke eget testskript.

## Roller
arkitekt (plassering, grenser, statiske sjekker), utvikler, testskriver, sikkerhet-personvern (eier på posten, lokal tekst, tømming), ki-ansvarlig (køen går uendret gjennom `requestSuggestion`; T-0005 mot publiseringssperren før 2a-2).

## Åpne spørsmål
- Ingen som stopper oppgaven. Tømming ved sperring og eventuell kryptering av køen tas når sperringen bygges (fase 2b). Merknaden om «Angre» mot publiseringssperren føres i `docs/09-apne-sporsmal.md` til 2a-2.
