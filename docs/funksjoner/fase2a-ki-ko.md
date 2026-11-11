# Funksjon: KI-kø uten nett

- **Fase:** 2a-1 KI-grunnmuren
- **Modul:** kjerne (`src/core/ai/client`, ny klientdel) og prøvesiden `/prove/ki`
- **Status:** klar til bygging etter forhåndsvurdering runde 1 (11.11.2026, branch `fase2a-ki-ko` fra `main`)
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
  - `requestId` (UUID v7 fra `uuidv7` i `src/shared/lib/uuid.ts`; blir id-en i `ai_usage_log`, gir samme rad om den sendes to ganger, valideres med Zod på serveren),
  - `feature`, mål (`targetType`, `targetId`, `fieldKey`) og feltene funksjonen skal ha (bare koder fra tillatt-listen),
  - eier: `organizationId` og `employeeId` (bare til lokal tømming, sendes aldri),
  - `queuedAt` og `attempts` (blir på enheten, sendes aldri og logges aldri; ventetid per person er tidsmåling etter arbeidsmiljøloven kap. 9).
- Til serveren sendes bare `requestId`, `targetId` og `text`, som i dag. Ingen rad på serveren og ingen ny status før kallet er gjort.
- **Alt gjennom `src/core/ai`:** klientdelen ligger i `src/core/ai/client/` (inngang `@/core/ai/client` med egen `index.ts`) og er et rent blad: verdi-importer bare fra egen mappe, `src/core/ai/limits.ts`, `@/shared` og `zod`. Fra `../types` er bare `import type` lov.

## Brukerhistorier
- Som **takstmann uten nett** vil jeg trykke «Foreslå bedre språk» og se «Venter på KI», slik at jeg kan skrive videre og få forslaget når nettet er tilbake.
- Som **takstmann** vil jeg at et forslag som kommer etter at jeg har skrevet mer, aldri sletter det jeg skrev.
- Som **neste person på samme iPad** skal jeg aldri se teksten som lå i køen til en annen, heller ikke om han glemte å logge ut.

## Omfang
**Med:**
1. **Køen** i `src/core/ai/client/queue.ts` (ren logikk) med lagring i IndexedDB på enheten (`src/core/ai/client/queue-store.ts`, rått API med en liten egen åpner, ingen ny avhengighet; kjernen kan ikke importere `idb.ts` fra prøvemodulen). Egen database `local-ai-queue` (A186). Funksjoner: `enqueue`, `list`, `remove`, `clear`, og `processQueue(send)`, der `send` gis inn fra siden, så kjernen ikke importerer app eller moduler.
   - **Én post per mål og felt:** ny forespørsel på samme mål og felt erstatter den gamle i én IndexedDB-transaksjon (finn med `list()`, høyst 50 poster, ingen indeks). Den nye posten får **ny `requestId`**, ellers svarer serveren med forslaget på den gamle teksten. Erstatning teller ikke som ny post, så den virker også når køen har 50.
   - **Grense:** høyst 50 poster, felt på høyst `AI_FIELD_MAX_LENGTH` tegn. Full kø eller for lang tekst gir fast norsk melding, aldri stille tap.
   - **Rekkefølge:** `queuedAt`, deretter `requestId` (enhetens klokke kan gi like tider).
   - **Lesing med eiersjekk:** hver lesing kjører Zod-skjemaet for køposten (egen form i `client/`). Poster som ikke passer, har annen `organizationId` eller `employeeId` enn den innloggede, eller er eldre enn 7 dager (A189), **slettes fra lageret**, ikke bare hoppes over, og sendes aldri. Dette er den eneste mekanismen for organisasjonsbytte og ny ansatt; `clearIfOtherOrganization` i prøvemodulen brukes ikke.
   - Ingen tekst utenfor IndexedDB: ikke i localStorage, adressen, `console.*` eller feilmeldinger. Feil fra IndexedDB og Zod gir bare feilnavn. Mangler IndexedDB: fast melding, ikke krasj.
2. **Behandling når nettet er tilbake:** `online`-hendelsen og sidelasting starter `processQueue`. Én behandling av gangen per fane (lås i minnet), én post om gangen. To faner som sender samme post, gir samme rad fordi `requestId` er den samme. Utfallet avgjøres av en ren funksjon `classifyQueueOutcome` med tre grener:
   - **Prøv senere** (posten blir liggende, runden stopper): nettfeil (`navigator.onLine` er false, eller kallet kaster `TypeError`) eller tidsavbrudd på **30 sekunder**. Utløpt økt (omdirigering til innlogging) er heller ikke fast feil: posten blir liggende, ingen nye forsøk i løkke, og eiersjekken rydder hvis en annen logger inn.
   - **Ferdig** (posten fjernes, runden går videre): alle kjente svar, `suggestion`, `no_match`, `error`, `disabled` (dekker også `blocked`, som serverhandlingen allerede viser som «KI er av.») og `failed` med `reason` `invalid` eller `no_access`. Meldingen vises fast i kortet.
   - **Ukjent serverfeil** (unntak mens nettet er oppe, eller `failed` med `reason: "unknown"`): `attempts` økes, posten blir liggende, runden går videre til neste post. Etter 3 forsøk fjernes posten med den faste meldingen «Noe gikk galt. Teksten din er uendret. Prøv igjen.» Én dårlig post stopper aldri resten (lærdom fra T-0001).
   - Posten fjernes alltid på `requestId`, aldri på mål, så en nyere post på samme felt ikke slettes. Svar på en erstattet `requestId` vises som forslag på eldre tekst (punkt 4), aldri med «Bruk».
   - `TrialFailure` i `src/app/(ansatt)/prove/ki/actions.ts` får en fast kode `reason: "invalid" | "no_access" | "unknown"` ved siden av meldingen, så klienten aldri tolker norsk tekst. Skjemaet tar fortsatt bare `requestId`, `targetId` og `text`.
3. **Prøvesiden `/prove/ki`:**
   - Den innloggedes `organizationId` og `employeeId` kommer fra økten i `page.tsx` og gis til klienten.
   - Uten nett er «Foreslå bedre språk» aktiv og legger forespørselen i køen. Kortet viser «Venter på KI. Forslaget kommer når nettet er tilbake.» (ny tekst i `AI_SUGGESTION_TEXTS`, `queued`). Erstatter «Krever nett …» på denne siden.
   - Mål-id og tekst hentes fra køen ved ny lasting, slik at teksten faktisk står der (retter T-0035 punkt 4).
   - Når svaret kommer, vises det i det vanlige forslagskortet.
4. **Forslag på eldre tekst (T-0004):** kortet husker teksten forslaget ble laget fra. Er feltet endret etterpå, viser kortet «Forslaget gjelder teksten før du skrev videre.» og «Bruk» erstattes av «Nytt forslag». Gjelder både vanlige og køede forslag.
5. **Angre etter at teksten er endret (T-0005):** er feltet endret etter «Bruk», setter «Angre» bare status tilbake i loggen og beholder teksten, med meldingen «Statusen er satt tilbake. Teksten din er uendret.» Merknad til ki-ansvarlig: mønsteret må ses mot publiseringssperren før det brukes i 2a-2 (føres i `docs/09-apne-sporsmal.md`).
6. **Én melding per tilstand (T-0019):** liten endring i `src/shared/ui/ai-suggestion.tsx` så skjermlesertekst står i bare ett `aria-live`-område. Ikke noe nytt meldingssystem. En gammel feilmelding forsvinner når teksten endres (T-0035 punkt 3). Blir PR-en stor, flyttes T-0019 til neste oppgave på prøvesiden sammen med resten av T-0035.
7. **Tømming ved utlogging:** `LogOutButton` henter køen med dynamisk import (fellesbunten vokser ikke), setter merket `ai-queue-clear-pending` i localStorage, tømmer køen, fjerner merket og kaller `signOut`. Feil ved tømming stopper ikke utloggingen. Står merket der når køen åpnes, slettes databasen før noe annet. Tømmingen stopper en behandling som pågår (en teller i minnet), så et svar etter utlogging verken vises eller skrives tilbake. Om merket uteblir (fanen lukket, økten utløpt), rydder eiersjekken i punkt 1.
8. **Småfunn i synkområdet (tilstand.md, fra T-0001):**
   - `stripValue` i `src/shared/lib/clean-text.ts` får dybdegrense 32, der lister og objekter teller likt. Dypere nesting kaster en egen feilklasse i `src/shared/lib` (uten verdien i meldingen). Synkruten i prøvemodulen gjør den om til avvist endring (400, legges til side, logger bare feilnavn), ikke 500.
   - `__proto__`-nøkkel i `stripValue` og `cleanData` (`src/modules/offline-trial/server/apply-changes.ts`): resultatet er et vanlig objekt, og nøkkelen settes med `Object.defineProperty`, så den blir en vanlig nøkkel og aldri endrer prototypen. Ikke `Object.create(null)`.
   - `requestSuggestion` vasker bare strenger og berøres ikke av dette.
   - Overflødig tom-sjekk i `requestSuggestion` fjernes hvis den står igjen.
9. **Flytting av konstant:** `AI_FIELD_MAX_LENGTH` flyttes til `src/core/ai/limits.ts` (ingen importer) og eksporteres videre fra `request.ts`, så ledetekstene i `features.ts` ikke havner i nettleseren.
10. **Dokumentasjon:** ADR 0006 del 10 rettes i teksten: egen database `local-ai-queue`, eier på posten, grense 50, én per mål og felt med ny `requestId` ved erstatning, 7 dagers levetid, at køen holder fritekst ukryptert lokalt og at bare oppdiktede data brukes nå, og at den flyttes inn i den ekte lokale databasen i fase 2b. Ordlisten (`docs/05-domenemodell.md` avsnitt 8): `queuedAt`, «venter på KI», database og lager. A186–A190 i `docs/09-apne-sporsmal.md`. Versjon 0.5.13 → 0.5.14.

**Ikke med (bevisst utelatt):**
- KI-kø i ekte skjermer (rapporten, befaringen på iPad). Kommer i fase 2b, og ikke før «Sperring av iPader» er levert, fordi køen holder fritekst lokalt.
- Tømming ved **sperring av enheten**: sperring finnes ikke ennå (fase 2b). Står i ADR-en.
- Kryptering av køen på enheten. Vurderes sammen med sperringen i 2b.
- Tømming av resten av lokal lagring (prøveskjemaet, bildene) ved utlogging. Nevnes i PR-en.
- Bakgrunnssynk når siden er lukket (Service Worker, Background Sync), og å bufre `/prove/ki` for lasting uten nett.
- Varsel om at et forslag er klart på en annen side.
- Rad på serveren før kallet, ny status i `ai_usage_log` eller ny tabell.
- Endring av `requestSuggestion` eller ny spørring på serveren.
- Resten av T-0035: menypunkt for `/prove/ki` og «KI er av» før man skriver.
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
- Lokalt: IndexedDB-databasen `local-ai-queue`, lager `ai_queue` med nøkkel `requestId`, ingen indeks (A186, A187).
- Den lokale køen er ikke data som oppbevares i 10 år; den er en mellomlagring og slettes. Raden i `ai_usage_log` slettes fortsatt bare mykt.

## Skjermer
Bare prøvesiden `/prove/ki`, PC og iPad-størrelse.
- Uten nett: ett trykk på «Foreslå bedre språk» legger forespørselen i køen (før: ikke mulig). Kortet viser «Venter på KI …».
- Nettet tilbake: forslaget dukker opp uten trykk.
- Antall trykk for å få et forslag uten nett: fra «umulig, prøv senere» til ett trykk.

## Regler
Ingen nye regler eller TG-logikk.

## Akseptkriterier
**Kø og lesing (enhetstester, `fake-indexeddb` hvis den alt finnes, ellers en minneversjon bak samme grensesnitt):**
- [ ] `enqueue`, `list`, `remove`, `clear`, rekkefølge etter `queuedAt` og så `requestId`.
- [ ] Ny forespørsel på samme mål og felt erstatter den gamle med ny `requestId`; virker også med 50 poster.
- [ ] Grensen: 49 og 50 poster går, nr. 51 gir fast melding. Tekst lik `AI_FIELD_MAX_LENGTH` går, én over gir fast melding.
- [ ] Ved lesing slettes poster med feil form, ukjent feltkode, `__proto__` i fields, annen `organizationId`, annen `employeeId` eller eldre enn 7 dager.
- [ ] IndexedDB mangler: fast melding, ikke krasj.

**Behandling (enhetstester for `classifyQueueOutcome` og `processQueue`):**
- [ ] Nettfeil og tidsavbrudd (30 s) stopper runden og beholder posten.
- [ ] Kjente svar og `failed` med `invalid`/`no_access` fjerner posten og runden går videre.
- [ ] Ukjent serverfeil øker `attempts`, går videre til neste post, og fjerner posten etter 3 forsøk med fast melding.
- [ ] Låsen: to samtidige `processQueue` gir ett kall per post.
- [ ] Svar på en erstattet `requestId` fjerner ikke den nye posten og vises ikke med «Bruk».
- [ ] Kallet til serveren har bare `requestId`, `targetId` og `text` (ikke `queuedAt`, `employeeId`, `organizationId`).
- [ ] Tømming under en pågående behandling: svaret vises ikke og skrives ikke tilbake. Merket i localStorage gir sletting av databasen ved neste åpning.

**Server (integrasjon mot testdatabasen):**
- [ ] Samme `requestId` sendt to ganger etter hverandre og samtidig (`Promise.all`) gir én rad.
- [ ] KI av før sending: `disabled`, ingen rad, kortet viser «KI er av.».
- [ ] Mistet tilgang før sending: `failed` med `no_access`, ingen rad.
- [ ] Ekstra felt i kallet (fremmed `organizationId` eller `employeeId`) endrer ingenting: raden får organisasjon og ansatt fra økten.
- [ ] Tenant-isolasjon: den eksisterende `expectTenantIsolation` for `requestSuggestion` (`src/core/ai/request-suggestion.test.ts`) dekker kø-flyten, fordi serveren er uendret. Det står i PR-en; ingen ny isolasjonstest.
- [ ] Én test viser at et forslag fra køen havner i samme forslagsflyt (godta, endre, avvise logges som før).

**Prøvesiden (komponent og e2e på PC og iPad-størrelse, nett av med `context.setOffline`):**
- [ ] Uten nett: trykk legger én post i køen og kortet viser «Venter på KI». Nett på: forslaget vises, køen er tom.
- [ ] Posten overlever ny lasting: teksten står i feltet og forslaget kommer.
- [ ] Utlogging: legg i kø, logg ut, køen er tom.
- [ ] Ny ansatt uten utlogging: legg i kø, slett øktkaken, logg inn som annen ansatt i samme organisasjon: teksten vises ikke, køen er tom, ingen rad i `ai_usage_log`.
- [ ] KI av før nettet kommer: «KI er av.».
- [ ] T-0004: endret tekst etter forslaget gir ikke «Bruk», egen tekst står (komponent og e2e).
- [ ] T-0005: «Angre» etter endret tekst beholder teksten og setter status tilbake (komponent).
- [ ] T-0019 (hvis med): nøyaktig ett `aria-live`-område, hver melding én gang. T-0035 punkt 3: gammel feil forsvinner når teksten endres.

**Synkområdet:**
- [ ] `stripValue` med 32 nivåer går gjennom, 33 nivåer (lister og objekter likt) gir avvist endring (400), ikke 500, og synkkøen går videre.
- [ ] `__proto__` i `stripValue` og `cleanData` blir en vanlig nøkkel, `Object.prototype` er uendret, og `constructor` og `prototype` går gjennom som vanlige nøkler.

**Statiske sjekker:**
- [ ] `src/core/ai/client` har bare verdi-importer fra egen mappe, `limits.ts`, `@/shared` og `zod` (ingen `@/db`, `server-only`, `src/core/ai/index.ts` eller servermoduler); bare `import type` fra `../types`. `src/core/ai/index.ts` eksporterer ikke klientdelen.
- [ ] `client/` kaller aldri `.complete(` og har ingen `console.`.
- [ ] Lint, typecheck, test og e2e er grønne.
- [ ] T-0004, T-0005, T-0035 punkt 3 og 4 (og T-0019 hvis med) settes til «rettet» med PR-nummer.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A186 (lett å endre):** KI-køen ligger i en egen IndexedDB-database `local-ai-queue` i `src/core/ai/client`, ikke i prøvedatabasen. ADR 0006 del 10 rettes i teksten. Grunn: kjernen kan ikke importere fra moduler (regel 4), og prøvemodulen skal kastes eller gjøres om. Flyttes inn i den ekte lokale databasen i fase 2b uten at serveren endres.
- **A187 (lett å endre):** én post per mål og felt med ny `requestId` ved erstatning, høyst 50 poster, ingen indeks. Grunn: takstmannen vil ha forslag på teksten slik den står nå, og med 50 poster er gjennomgang av listen nok.
- **A188 (lett å endre):** forslag som kommer etter at teksten er endret, kan ikke brukes direkte; «Angre» etter endret tekst rører ikke teksten. Grunn: egen tekst skal aldri gå tapt uten at takstmannen ser det (T-0004, T-0005, ADR 0004).
- **A189 (lett å endre):** poster i KI-køen eldre enn 7 dager slettes ved lesing. Grunn: fritekst skal ikke bli liggende ukryptert på en iPad som ikke kommer på nett. En befaring ferdigstilles normalt innen en uke.
- **A190 (lett å endre):** posten har eier (`organizationId`, `employeeId`) og slettes ved lesing hvis eieren ikke er den innloggede. Det er eneste mekanisme for bytte av organisasjon og ansatt. Grunn: ADR 0004 og planens «Delt iPad og utlogging» (bare den som gjorde endringen, sender den).

## Avgjort ved uenighet i forhåndsvurderingen
- **Indeks (forenkler mot arkitekt):** ingen indeks. Med høyst 50 poster holder `list()`, og det er mindre å flytte i 2b. Erstatningen skjer i én transaksjon, så to like poster oppstår ikke.
- **Organisasjonsbytte (forenkler, arkitekt, sikkerhet):** én måte: eiersjekk ved lesing som sletter. Ingen kobling til `clearIfOtherOrganization`.
- **Utfall (forenkler: to grener; arkitekt og test-leder: flere):** tre grener i `classifyQueueOutcome`. Den tredje (ukjent serverfeil med 3 forsøk) trengs fordi én krasjende post ellers stopper køen for alltid eller forkastes ved første nettblaff på serveren, samme feil som T-0001.
- **E2e for utlogging (forenkler mot sikkerhet og test-leder):** utloggingstesten forenkles til «logg ut, køen er tom». Det alvorlige punktet om delt iPad får sin egen e2e (ny ansatt uten utlogging), fordi den viser at eiersjekken virker der tømmingen ikke ble kjørt.
- **Tenant-isolasjon (forenkler og test-leder):** ingen ny spørring, så den eksisterende `expectTenantIsolation` for `requestSuggestion` gjelder. Det legges bare til én test for at ekstra felt i kallet ikke endrer organisasjon eller ansatt (sikkerhet punkt 9), og en rollematrise for sending lages ikke, fordi tilgangssjekken er den samme som i dag.
- **Utløpt økt:** posten beholdes (sikkerhet og test-leder er enige). Klienten skiller den fra nettfeil ved at den gir omdirigering, ikke nye forsøk i løkke.

## Roller
arkitekt (plassering, grenser, statiske sjekker), utvikler, testskriver, sikkerhet-personvern (eier på posten, lokal tekst, tømming), ki-ansvarlig (køen går uendret gjennom `requestSuggestion`; T-0005 mot publiseringssperren før 2a-2).

## Åpne spørsmål
- Ingen som stopper oppgaven. Tømming ved sperring og eventuell kryptering av køen tas når sperringen bygges (fase 2b). Merknaden om «Angre» mot publiseringssperren føres i `docs/09-apne-sporsmal.md` til 2a-2.
