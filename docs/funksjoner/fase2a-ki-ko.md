# Funksjon: KI-kø uten nett

- **Fase:** 2a-1 KI-grunnmuren
- **Modul:** kjerne (`src/core/ai/client`, ny klientdel) og prøvesiden `/prove/ki`
- **Status:** utkast (11.11.2026, branch `fase2a-ki-ko` fra `main`)
- **Støtter hovedmål:**
  - **De ansatte:** takstmannen kan be om KI-hjelp også i kjelleren eller på hytta uten dekning. Han trykker én gang, skriver videre, og forslaget kommer når nettet er tilbake. Han slipper å huske å trykke på nytt.
  - **KI i bunnen:** KI virker likt med og uten nett. Køen er grunnmuren som tale til tekst, diktat og bilde til utkast på iPaden (fase 2b) bygger på. Alt går fortsatt gjennom `requestSuggestion` på serveren, med vask, tilgang, KI av/på og logg.
  - **Færre reklamasjoner:** et forslag som kommer sent, overskriver aldri tekst takstmannen har skrevet etterpå (T-0004, T-0005). Køen tømmes ved utlogging, så neste person på samme iPad ser ikke teksten.

## Problem
I dag sier `/prove/ki` bare «Krever nett» når nettet er borte, og teksten forsvinner ved ny lasting selv om siden sier at den er lagret (T-0035). På iPaden er takstmannen ofte uten nett. Uten kø må han huske hvilke felt han ville ha hjelp til og trykke på nytt senere. ADR 0006 del 10 har bestemt hvordan køen skal virke, men den er ikke bygget.

## KI i bunnen
- **KI gjør:** det samme som før (`language_polish` på prøvesiden). Det nye er at forespørselen venter lokalt og sendes av seg selv når nettet kommer tilbake. Forslaget vises i det vanlige forslagskortet, og takstmannen godtar, endrer eller avviser som før.
- **Ingen KI på enheten.** iPaden snakker aldri med leverandøren og har aldri nøkkelen. Vask og leverandørkall skjer bare på serveren i `requestSuggestion`.
- **Data som lagres for KI:** én post per forespørsel i lokal lagring på enheten: `requestId` (blir id-en i `ai_usage_log`, gir samme rad om den sendes to ganger), `feature`, mål (`targetType`, `targetId`, `fieldKey`), `organizationId` (bare for å tømme ved bytte), feltene funksjonen skal ha (bare koder fra tillatt-listen) og `queuedAt`. Ingen rad på serveren og ingen ny status før kallet er gjort.
- **Alt gjennom `src/core/ai`:** klientdelen ligger i `src/core/ai/client/` og har ingen server- eller databaseimport. Serverdelen er uendret: `requestSuggestion` sjekker tilgang, KI av/på og sperrer på nytt når køen sendes.

## Brukerhistorier
- Som **takstmann uten nett** vil jeg trykke «Foreslå bedre språk» og se «Venter på KI», slik at jeg kan skrive videre og få forslaget når nettet er tilbake.
- Som **takstmann** vil jeg at et forslag som kommer etter at jeg har skrevet mer, aldri sletter det jeg skrev.
- Som **neste person på samme iPad** skal jeg aldri se teksten som lå i køen til den som logget ut.

## Omfang
**Med:**
1. **Køen** i `src/core/ai/client/queue.ts` (ren logikk) med lagring i IndexedDB på enheten (`src/core/ai/client/queue-store.ts`, rått API som `src/modules/offline-trial/sync/local/idb.ts`, ingen ny avhengighet). Egen liten database for KI-køen (A186, se Data). Funksjoner: `enqueue`, `list`, `remove`, `clear`, og `processQueue(send)` som sender i rekkefølge (`queuedAt`), én om gangen.
   - **Én post per mål og felt:** ny forespørsel på samme mål og felt erstatter den gamle i køen (nyeste tekst gjelder).
   - **Grense:** høyst 50 poster og felt på høyst `AI_FIELD_MAX_LENGTH` tegn. Full kø gir en fast norsk melding, ingen stille tap.
   - **Validering ved lesing:** poster som ikke passer skjemaet (Zod), eller har en annen `organizationId` enn den innloggede, forkastes.
2. **Behandling når nettet er tilbake:** `online`-hendelsen og sidelasting starter `processQueue`. Posten sendes med samme `requestId` til serverhandlingen. Utfall:
   - `suggestion`, `no_match`, `error` (svar fra KI) eller `disabled`: posten fjernes. `disabled` og «ingen tilgang» forkastes uten nytt forsøk (ADR 0006 del 10).
   - Nettfeil eller tidsavbrudd: posten blir liggende til neste gang nettet kommer.
   - Fast feil fra serveren (ugyldig tekst o.l.): posten fjernes og den faste meldingen vises.
   - Bare én behandling av gangen per fane (lås i minnet). To faner som sender samme post, gir samme rad fordi `requestId` er den samme.
3. **Prøvesiden `/prove/ki`:**
   - Uten nett er «Foreslå bedre språk» aktiv og legger forespørselen i køen. Kortet viser «Venter på KI. Forslaget kommer når nettet er tilbake.» (ny tekst i `AI_SUGGESTION_TEXTS`, `queued`). Erstatter «Krever nett …» på denne siden.
   - Mål-id og tekst hentes fra køen ved ny lasting, slik at teksten faktisk står der (retter T-0035 punkt 4: «lagret» brukes bare når den er lagret).
   - Når svaret kommer, vises det i forslagskortet som et vanlig forslag.
4. **Forslag på eldre tekst (T-0004):** kortet husker teksten forslaget ble laget fra. Er feltet endret etterpå, viser kortet «Forslaget gjelder teksten før du skrev videre.» og «Bruk» erstattes av «Nytt forslag». Egen tekst overskrives aldri uten at takstmannen ser det. Gjelder både vanlige og køede forslag.
5. **Angre etter at teksten er endret (T-0005):** er feltet endret etter «Bruk», setter «Angre» bare status tilbake i loggen og beholder teksten i feltet, med meldingen «Statusen er satt tilbake. Teksten din er uendret.»
6. **Én melding per tilstand (T-0019):** skjermlesertekst i bare ett `aria-live`-område i `src/shared/ui/ai-suggestion.tsx`. En gammel feilmelding forsvinner når teksten endres (T-0035 punkt 3).
7. **Tømming:**
   - Ved utlogging: `LogOutButton` tømmer KI-køen før `signOut` (feil ved tømming stopper ikke utloggingen, men databasen slettes da ved neste sidelasting).
   - Ved organisasjonsbytte: samme sted som resten (`clearIfOtherOrganization` i `select-store.ts`, eller tilsvarende kall på `/prove/ki`), og poster med annen `organizationId` forkastes ved lesing.
8. **Småfunn i synkområdet (tilstand.md, fra T-0001):**
   - `stripValue` i `src/shared/lib/clean-text.ts` får dybdegrense (32 nivåer). Dypere nesting gir en egen feil som synkruten gjør om til avvist endring (400, legges til side), ikke 500 som stopper køen.
   - `__proto__`-nøkkel i `stripValue` og `cleanData`: resultatet bygges uten prototype-arv (`Object.create(null)` eller `Object.defineProperty`), så nøkkelen blir en vanlig nøkkel og aldri endrer prototypen. Test for begge.
   - Overflødig tom-sjekk i `requestSuggestion` fjernes hvis den står igjen.
9. **Dokumentasjon:** ordlisten (`docs/05-domenemodell.md` avsnitt 8: «KI-kø», «venter på KI», database og lager), ADR 0006 del 10 (hvor køen ligger, grense, én per mål og felt), A186–A188 i `docs/09-apne-sporsmal.md`. Versjon 0.5.13 → 0.5.14.

**Ikke med (bevisst utelatt):**
- KI-kø i ekte skjermer (rapporten, befaringen på iPad). Kommer i fase 2b.
- Tømming ved **sperring av enheten**: sperring finnes ikke ennå (fase 2b). Står i ADR-en og tas med når sperringen bygges.
- Tømming av resten av lokal lagring (prøveskjemaet, bildene) ved utlogging. Eget punkt i «Minimum før ekte data» eller 2b; nevnes i PR-en.
- Bakgrunnssynk når siden er lukket (Service Worker, Background Sync), og å bufre `/prove/ki` for lasting uten nett. Køen sendes bare når en side med køen er åpen.
- Varsel om at et forslag er klart på en annen side.
- Rad på serveren før kallet, ny status i `ai_usage_log` eller ny tabell.
- Resten av T-0035: menypunkt for `/prove/ki` og «KI er av» før man skriver. Tas med neste oppgave på prøvesiden.
- Andre småfunn fra T-0001 (400 fra proxy, klasse 22, logging med parametre, doble tester, ustabil test i `photo-uploader.test.ts`).

## Tilgang
Ingen ny rettighet. Køen ligger bare på enheten og gir ingen tilgang i seg selv. Når den sendes, sjekkes alt på nytt på serveren.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Egen kø på egen enhet | Be om forslag der de har `report.edit` (som før) |
| kontor | Egen kø på egen enhet | Som før (`assignment.edit` der funksjonen krever det) |
| leder | Egen kø på egen enhet | Som før |
| admin | Egen kø på egen enhet | Som før. Admin stenges ikke ute |

- Organisasjon og ansatt kommer alltid fra økten på serveren, aldri fra posten i køen. `organizationId` i posten brukes bare til å tømme lokalt.
- Mistet tilgang eller KI av når køen sendes: forkastes, ingen rad (`disabled`) eller sperret rad som i dag.

## Data
- **Ingen ny tabell, ingen migrering.**
- Lokalt: IndexedDB-databasen `local-ai-queue`, lager `ai_queue` med nøkkel `requestId` og indeks på `[targetType, targetId, fieldKey]` (A186).
- Ordlisten: «KI-kø» står allerede (`src/core/ai/client`). Legg til `queuedAt` og «venter på KI».

## Skjermer
Bare prøvesiden `/prove/ki`, PC og iPad-størrelse.
- Uten nett: ett trykk på «Foreslå bedre språk» legger forespørselen i køen (før: ikke mulig). Kortet viser «Venter på KI …».
- Nettet tilbake: forslaget dukker opp uten trykk.
- Antall trykk for å få et forslag uten nett: fra «umulig, prøv senere» til ett trykk.

## Regler
Ingen nye regler eller TG-logikk.

## Akseptkriterier
- [ ] Uten nett: trykk legger én post i køen med `requestId`, funksjon og mål, og kortet viser «Venter på KI» (e2e med nettet slått av).
- [ ] Nettet tilbake: posten sendes med samme `requestId`, forslaget vises, posten er borte fra køen (e2e).
- [ ] Samme post sendt to ganger gir én rad i `ai_usage_log` (test).
- [ ] KI slått av før nettet kommer tilbake: posten forkastes, ingen rad, kortet viser «KI er av.» (test).
- [ ] Mistet tilgang før sending: posten forkastes, ingen rad (test).
- [ ] Ny forespørsel på samme mål og felt erstatter den gamle i køen (enhetstest).
- [ ] Køen er full ved 50 poster, og den ansatte får beskjed (enhetstest).
- [ ] Poster med feil form eller annen organisasjon forkastes ved lesing (enhetstest).
- [ ] Utlogging tømmer køen (e2e: legg i kø, logg ut, logg inn som annen ansatt, køen er tom og teksten vises ikke).
- [ ] Organisasjonsbytte tømmer køen (test).
- [ ] Posten overlever ny lasting av siden: teksten står i feltet og forslaget kommer (e2e: legg i kø uten nett, slå på nettet og last siden).
- [ ] T-0004: endret tekst etter forslaget gir ikke «Bruk», egen tekst står (test og e2e).
- [ ] T-0005: «Angre» etter endret tekst beholder teksten og setter status tilbake (test).
- [ ] T-0019: hver melding står én gang og i ett `aria-live`-område (test).
- [ ] `stripValue` med 33 nivåer gir avvist endring (400), ikke 500; `__proto__` endrer ikke prototypen i `stripValue` og `cleanData` (test).
- [ ] `src/core/ai/client` importerer ikke `@/db`, serverkode eller `src/core/ai/index.ts` (statisk test). `src/core/ai/index.ts` eksporterer ikke klientdelen.
- [ ] Ingen nettverkskall til leverandøren fra nettleseren (statisk test: `client/` kaller aldri `.complete(`).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for serverhandlingen med kø-flyten).
- [ ] Virker på iPad-størrelse (e2e).
- [ ] KI-forslag fra køen kan godtas, endres og avvises, og logges (test mot falsk leverandør).
- [ ] T-0004, T-0005 og T-0019 settes til status «rettet» med PR-nummer.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A186 (lett å endre):** KI-køen ligger i en egen IndexedDB-database `local-ai-queue` i `src/core/ai/client`, ikke som nytt lager i prøvedatabasen `offline-trial-custom`. ADR 0006 sier «samme lokale lagring som endringskøen»; vi leser det som samme lagringsform (IndexedDB på enheten) og samme tømming. Grunn: prøvemodulen skal kastes eller gjøres om, kjernen kan ikke importere fra moduler (regel 4), og ordlisten sier allerede `src/core/ai/client`. Kan flyttes inn i den ekte lokale databasen i fase 2b uten at serveren endres.
- **A187 (lett å endre):** én post per mål og felt (nyeste tekst gjelder), høyst 50 poster. Grunn: enklest, og takstmannen vil ha forslag på teksten slik den står nå.
- **A188 (lett å endre):** et forslag som kommer etter at teksten er endret, kan ikke brukes direkte; kortet ber om nytt forslag. «Angre» etter endret tekst rører ikke teksten. Grunn: egen tekst skal aldri gå tapt uten at takstmannen ser det (T-0004, T-0005, ADR 0004 «forslag overskriver aldri takstmannens verdi»).

## Roller
arkitekt (plassering av køen, grensen mot prøvemodulen, statiske sjekker), utvikler, testskriver, sikkerhet-personvern (lokal lagring av tekst, tømming ved utlogging og bytte, ny tilgangssjekk ved sending), ki-ansvarlig (at køen går gjennom `requestSuggestion` uendret og logges riktig).

## Åpne spørsmål
- Ingen som stopper oppgaven. Tømming ved sperring av enheten venter på at sperringen bygges (fase 2b).
