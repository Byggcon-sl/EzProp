# Erfaringer

Lærdom etter hver PR: feil som gikk igjen, ting Ståle avviste, det som sparte tid. Nyeste øverst. Får Ståle stadig de samme kommentarene, legges de inn som regel i den aktuelle agentbeskrivelsen.

## 12.11.2026 – PR #159 merget (malen for ett bad)

- Arbeidsflyten for én mal tok rundt tre timer. En annen kjøring av hovedløkken startet i mellomtiden, så branchen uten PR og lot den være. Det virket: regelen «branch med commit siste 2 timer er i arbeid» hindret dobbelt arbeid.
- Funn om faste koder (`key`) må rettes før merge, fordi kodene ikke kan endres etterpå. Gjennomgangen fant fire slike (A210–A213); de ble rettet i samme PR i stedet for å bli småfunn.
- En PR som står med «unstable» etter automatisk fletting fra github-actions[bot] får CI i gang igjen med en ekte commit (her versjonshevingen én over main).

## 10.11.2026 – PR #123 merget (ADR 0006 KI i bunnen)

- PR-en ble merget av en annen kjøring mens denne kjøringen gjorde ferdig. Den lokale branchen var 6 commits foran og 8 bak origin, og lokal `main` lå bak `origin/main`, så `git diff main...branch` lokalt viste malmotorkode som ikke hørte til. Regel: kjør `git fetch` og sjekk `gh api repos/{owner}/{repo}/pulls?head=…&state=all` før push eller ny PR; er PR-en merget, push ikke til branchen, lag ny branch fra `origin/main`.
- En ADR uten produktkode fikk 14 småfunn. De fleste hører hjemme når koden bygges; før dem som liten oppgave knyttet til planpunktet, så de ikke blir glemt.

 – PR #57 merget (sertifisering med utløpsdato)

- Å skrive en dato med tastaturet i et `<input type="date">` i Playwright virker ulikt i Chromium lokalt og i CI (feltet ble tomt i CI, også når begge rekkefølger dag/måned ble prøvd). Delene inne i datofeltet styres av nettleseren. I e2e: sett datoen med `fill`, og test Tab-rekkefølge, fokus og Enter med tastaturet.
- En e2e-test som er grønn lokalt, men rød i CI, skal reproduseres med samme forutsetning før den rettes; ett retteforsøk som bare gjetter årsaken, koster en hel CI-runde (ca. 25 min).

## 29.10.2026 – PR #17 merget (synktjenestene i Azure)

- Arbeidsflyten «oppgave» gikk fra oppgavekort til merget PR uten Ståle (24 agenter, ca. 3 timer). Tjenester som koster penger, ble lagt inn **av som standard** (en Bicep-parameter og en GitHub-variabel), så mergen kostet ingenting og PR-en trengte ikke vente på Ståle. Spørsmålet om å slå dem på ligger som nr. 12. Regel: noe som koster penger, bygges slått av, og Ståle slår det på.
- To hovedløkker kjørte samtidig (taggen `ezprop-utvikling` kunne ikke sjekkes i skyen) og skrev begge i tilstandsfilen, som fikk doble linjer etter flettingen. Ryddet i en egen liten PR. Regel: les tilstandsfilen på nytt fra `main` rett før den oppdateres.
- En automatisk fletting fra `main` ga en CI-kjøring som ventet på godkjenning, så GitHub meldte «unstable». En ny vanlig commit startet CI på nytt.
- Automatiske flettinger fra `main` kan lage doble linjer i `docs/agenter/tilstand.md` (begge sider tatt med). Sjekk diffen på tilstandsfilen før merge, og ta main sin versjon hvis PR-en ikke skal endre den.

## 29.10.2026 – PR #21 (synkstatus) merget

- Arbeidsflyten «oppgave» gikk fra oppgavekort til merget PR uten alvorlige funn, men brukte ca. 3 t 45 min og 29 agenter for én skjermkomponent. Mens den kjørte, merget en annen sesjon fire PR-er, så versjonen måtte løftes fra 0.2.7 til 0.2.11 ved fletting. Regel: flett `main` inn rett før PR-en åpnes, og sett versjonen én patch over `main` da.
- To sesjoner jobbet samtidig (synktjenestene i Azure og synkstatus) uten å vite om hverandre, men på hver sin del av koden, så det gikk bra. Hovedløkken lar en branch med ferske commits og uten PR være, og tar en annen oppgave.

## 29.10.2026 – PR #14 og PR #15 merget, og en branch som aldri ble PR

- PR #14 (småfunn fra PowerSync-prøven, tidsavbrudd på bildeopplasting, stabile bildetester) ble merget kl. 13:58, og PR #15 (stabil e2e-test for bytte av organisasjon) av hovedløkken kl. 15:55 med `scripts/merge-klare-pr.sh`. Begge gikk rett gjennom: CI grønn, ingen konflikt.
- PR #15 var laget for PR #14, men kom etter at #14 var merget. Det gikk bra fordi den ble åpnet mot `main`. Regel: en rettelse til en PR som kan bli merget når som helst, lages mot `main` når den ikke trenger noe fra PR-en.
- En beslutning (ingen grense for PR-er som venter på Ståle) lå bare på branchen `beslutning-azure-felles-innlogging` etter at PR #5 var merget, fordi siste commit kom etter mergen. Rollefilen var rettet senere, men `LES-MEG-kartlegging.md` og endringsloggen i planen manglet den. Ført inn i `main` nå. Regel: push ikke til en branch etter at PR-en er merget; lag ny branch fra `main`.
- Branchen `fase1-synk-i-azure` (oppgave a) har oppgavekort, ADR og testplan, men ingen PR. Hovedløkken lar den være så lenge den kan være i arbeid i en annen sesjon, og tar en annen oppgave i mellomtiden.

## 29.10.2026 – «Oppdater åpne PR-er» fikk konflikt i felles dokument

- Første kjøring etter PR #12 ga konflikt i `erfaringer.md`, selv om filen skal flettes med begge sider. Årsak: skriptet byttet til PR-ens branch før flettingen, og den eldre branchen hadde ikke `scripts/git/union-filer`. Rettet ved å kopiere hjelpefilene ut før byttet. Regel: et skript som bytter branch, kan ikke lese sine egne hjelpefiler etterpå.

## 29.10.2026 – PR #10 og PR #11 merget, kandidat 3 havnet utenfor `main`

- Ståle merget PR #10 (kandidat 2) til `main` kl. 12:25 og PR #11 (kandidat 3) kl. 12:43. PR #11 pekte på branchen til PR #10, og GitHub flytter ikke en PR til `main` når branchen den bygger på er merget, så kandidat 3 havnet i den gamle branchen og ikke i `main`. Rettet med en ny PR fra `fase1-kandidat-egenbygd-til-main` til `main`.
- Regel: når en PR merges og en annen PR bygger på den, endrer prosjektlederen med en gang målet for den andre PR-en til `main` (`gh api -X PATCH repos/{owner}/{repo}/pulls/<nr> -f base=main`) og fletter `main` inn. Skriv også i PR-teksten under «Bygger på»: «merg PR #X først; denne flyttes da til main».
- To kjøringer av hovedløkken jobbet samtidig på kandidat 3 (den ene via arbeidsflyten, den andre for hånd på samme branch). Arbeidsflyten oppdaget det og pushet ikke. Sjekken av andre sesjoner (taggen `ezprop-utvikling`) virker bare når verktøyene for sesjoner finnes; ellers må tilstandsfilen på `main` og nyeste commit-tid på branchene sjekkes før en oppgave startes.

## 29.10.2026 – Fase 1, kandidat 3 egenbygd (PR #11)

- Kjøringen som startet oppgaven, stoppet etter at bitene var satt sammen, uten at Vitest og e2e var kjørt på det sammensatte. Neste kjøring fant 3 røde Vitest-tester og 3 røde e2e-tester. Regel: kjør `pnpm test` med en gang etter sammensetting, og skriv resultatet i tilstandsfilen før neste steg.
- Utvikler og testskriver skrev hvert sitt sett med tester for samme kode (`.impl.test.ts` ved siden av `.test.ts`), over 1 000 linjer dobbelt. Regel: utvikleren skriver ikke egne testfiler når testskriveren har oppgaven; utvikleren gir heller testskriveren en liste over grensetilfeller.
- Falske tidtakere i Vitest gjør en tidtaker på 0 ms om til 1 ms når den settes under en tick. Henting «med en gang» går derfor via et løfte, ikke en tidtaker.
- Begge e2e-feilene lå i testene: testkroken finnes bare på skjemasiden, og en test hang på tidsforløpet. Sjekk først om testen venter på riktig side og riktig tilstand før koden endres.
- En ustabil bildetest på iPad avslørte en ekte feil: en opplasting uten svar stoppet bildekøen for godt. Tidsavbruddet på opplastingen (PR #14) kom ikke med i PR #13, fordi den ble laget mens PR #13 ble satt sammen. Regel for e2e: kall aldri `page.unroute` mens appen kan sende til ruten; la ruten stå og bruk en bryter.
- Modellnavn i commit-meldinger (`Co-Authored-By`) har kommet inn på `main` og på flere brancher. Nye commits skrives uten. Gamle skrives ikke om.


## 29.10.2026 – Hvorfor PR-er stoppet hos Ståle

- Tre av ti PR-er stoppet: to med konflikt i felles filer (versjon, tilstand, erfaringer, åpne spørsmål), én med en ende-til-ende-test som feilet på tid i CI og gikk grønt ved neste kjøring. Ingen ekte kodefeil.
- Tiltak (Ståle 29.10.2026): agentene merger selv når alt er grønt (`scripts/merge-klare-pr.sh`), «Oppdater åpne PR-er» fletter main inn i åpne PR-er etter hver merge, felles dokumenter flettes med begge sider, og varselet «Endret av en annen» får 15 s ventetid i e2e.
- Commit-meldinger fra skyen kan få modellnavn i attribusjonslinjen. Squash-merge med bare tittelen holder main fri for dem.
## 29.10.2026 – Modellbytte når kvoten er brukt opp (PR #9)

- Lederrollene hadde fast modell i `.claude/agents/`. Da kvoten for ledermodellen var brukt opp, ville arbeidsflytene stoppe selv om rutinen ble flyttet til en annen modell. Lederne arver nå modellen fra rutinen (`model: inherit`). Bytte modell gjøres bare på rutinen. Utøverne har fortsatt fast modell.
- Merget av Ståle 29.10.2026 kl. 11:27, uten kommentarer. Mergen ga en liten konflikt i denne filen på PR #10 (to nye avsnitt øverst samtidig). Løst ved å beholde begge.

## 29.10.2026 – Fase 1, kandidat 1 PowerSync (PR #8)

- Merget av Ståle 29.10.2026 kl. 08:30, uten kommentarer eller endringer. Merget som vanlig fletting (ikke «Squash and merge»), så kandidat 2-branchen som lå oppå, kunne flette inn `main` uten konflikter.
- Oppgaven ble delt i én kjøring som stoppet midt i (kvoten for ledermodellen ble brukt opp natt til 29.10.) og en ny kjøring som fortsatte. Tilstandsfilen på selve oppgavebranchen sa nøyaktig hvor arbeidet sto («neste: sikkerhet-personvern, test-leder, PR»), så ingenting måtte gjøres på nytt. Regel: skriv neste steg i tilstandsfilen på branchen og push før hvert lengre steg.
- Lederrollene har fast modell i `.claude/agents/`. Når kvoten for den modellen er brukt opp, feiler agentene med en gang. PR #9 (merget 29.10.2026) lar dem følge modellen rutinen kjører på.
- Testskriveren leverte to runder som overlappet. Prosjektlederen beholdt versjonen som var avstemt mot koden. Én runde per testskriver er nok; gi heller retteoppgave enn ny runde.

## 28.10.2026 – Fase 1, testmiljø i Azure (PR #7)

- Merget av Ståle samme kveld (kl. 20:19), uten kommentarer eller endringer. Det Ståle må gjøre selv (ressursgruppe, GitHub-innlogging i Azure, secrets) står i `docs/drift/testmiljo-azure.md` og i tilstandsfilen under «Venter på Ståle» til han bekrefter at appen åpner på iPaden.
- To PR-er som begge øker versjonsnummeret i `package.json`, gir alltid konflikt når den første merges. Regel: den som merges sist, settes til neste patch over `main` (her 0.1.3 → 0.2.1). Prosjektlederen fletter `main` inn i de åpne branchene i første kjøring etter en merge, før nye oppgaver.
- `docs/agenter/tilstand.md`, `docs/09-apne-sporsmal.md` og ordlisten i `docs/05-domenemodell.md` endres i nesten hver PR og gir konflikter når to PR-er er åpne samtidig. Løsning som brukes: ta med begge sider (nye rader fra begge), og skriv tilstandsfilen helt på nytt ut fra det som faktisk gjelder. Når samme oppdatering gjøres likt på to brancher, går neste fletting rent.
- Ståle 28.10.2026: det er ingen grense for hvor mange PR-er som kan vente på ham. Hovedløkken fortsetter alltid med neste oppgave, og oppgaver som bygger på en åpen PR legges oppå den (PR mot den branchen, «Bygger på» i teksten). Rollefilen `prosjektleder.md` er rettet.

## 28.10.2026 – Fase 1, oppgave 3 (PR #6)

- Arbeidsflyten «oppgave» gikk hele veien fra oppgavekort til PR uten retteforsøk (18 agenter, ca. 41 minutter). Ingen alvorlige funn i gjennomgangen, 12 små som er notert i oppgavekortet og tas i oppgave 4.
- Agentene i skyen setter inn et modellnavn i `Co-Authored-By`-linjen i commit-meldingene. Det bryter regelen «aldri modellnavn». Prosjektlederen kan ikke skrive om historikken fra skyen (force-push er sperret), så for PR #6 må Ståle bruke «Squash and merge» i GitHub; da får `main` én commit med PR-tittelen. Varig løsning: utvikler, testskriver og retter skal ikke sette inn modellnavn i commit-meldinger (legges inn i rollefilene og i `oppgave.js`), og prosjektlederen sjekker `git log origin/main..HEAD` før PR.
- En agent pushet sin worktree-branch (`worktree-wf_…`) til GitHub. Slike brancher skal bare finnes lokalt. Prosjektlederen rydder dem etter sammensetting.
- Oppgavekortet motsa seg selv om antall valg- og bildefelt (8/8 mot 9/7). Testskriveren fant det, og det ble rettet i kortet, ikke i testen. Tabellen i kortet er fasit; summer i prosa skal regnes ut fra tabellen.
- PR #4 og #5 (bare dokumentasjon) ble merget av Ståle mens oppgaven pågikk. Ståles beslutning i PR #5 (testmiljø i Azure og felles innlogging med Optiplan) ga et nytt første punkt i fase 1 og besvarte et åpent spørsmål. Flett `main` inn i branchen før PR når Ståle har merget noe underveis.

## 28.10.2026 – Fase 0a

- En rutine som starter ny sesjon får ikke repoet og koblingene fra sesjonen som laget den. Repoet og koblingene settes på selve rutinen (claude.ai/code/routines → Edit → Advanced settings → Repository og Connectors), ikke på miljøet. Rutineprompten skal alltid sjekke tilgangen først og varsle i stedet for å prøve videre.

- Første kjøring av arbeidsflyten «oppgave» (PR #1) virket fra oppgavekort til PR, men tre ting måtte rettes etterpå:
  - Worktrees for utvikler og testskriver feilet fordi de ble laget fra `origin/main` i stedet for gjeldende branch. Rettet med `worktree.baseRef: "head"` i `.claude/settings.json`.
  - `gh pr create` virker ikke i skyen (GraphQL er sperret). PR-er lages med `gh api repos/{owner}/{repo}/pulls`.
  - Agenter som kjørte tester samtidig delte testdatabasen, og `src/db/seed/run.test.ts` feilet én gang («fant 2 organisasjoner»). Det er ikke en feil i koden, men i kjøringen. Rettet med `scripts/egen-testdb.sh` (egen testdatabase per branch) i prompten til utvikler og testskriver.
- Agentbeskrivelsene i `.claude/agents/` lastes ved start av en sesjon. I sesjonen som lagde dem, fant ikke `Workflow` rollene, så skriptene har en reserve: en vanlig agent får beskjed om å lese og følge rollefilen.

- SharePoint-leseren kutter store Excel-faner ved ca. 190 000 tegn uten sidedeling. Store faner må deles eller lagres som CSV før de leses.
- Rader som skal kunne lages uten nett, bør ikke ha fremmednøkkel på `created_by` (bare bruker-id som tekst), ellers feiler innsetting når innloggingen er utløpt.
- Optiplans oppsett kunne kopieres nesten direkte; forskjellene er dokumentert i ADR 0001.
- Lokal lagring: øyeblikksbilder lest før en skriving må forkastes. Ellers vises den gamle verdien et øyeblikk. Funnet av e2e for prøve E.

## 29.10.2026 – Prøve E (PR #23)

- Arbeidsflyten «oppgave» gikk fra oppgavekort til merget PR på ca. 2,5 timer (27 agenter), uten alvorlige funn. `main` hadde fått PR #21 og #22 underveis; eneste konflikt var versjonsnummeret. Ta alltid versjonen som én patch over `main` ved fletting, ikke over branchens egen.
- Hovedløkken kan starte neste oppgave fra `main` mens en klar PR venter på CI, så lenge oppgavene ikke rører de samme filene. Det sparte ventetid her.

## 29.10.2026 – Småfunn fra synkstatus (PR #26)

- Når boten fletter `main` inn i en PR, kan CI-kjøringen bli stående og vente på godkjenning. `merge-klare-pr.sh --vent` gir da opp etter 30 minutter. Løsning: en ny commit fra agenten på branchen, så starter CI som vanlig.
- Testskriver og utvikler laget doble testfiler for samme kode. Test-leder bør sjekke etter doble testfiler før gjennomgangen er ferdig.

## 30.10.2026 – To kjøringer gjorde samme oppgave (PR #28 og #29)

- Hovedløkken så at siste push på `fase1-smafunn-prove-e` var 45 minutter gammel og trodde kjøringen hadde stoppet. Den var i live: arbeidsflyten «oppgave» kan gå 50 minutter uten push mens utvikler og testskriver jobber i egne worktrees. Begge kjøringene leverte samme oppgave; PR #28 ble merget, PR #29 lukket.
- Regel videre: en oppgave som har oppgavekort på en branch uten PR, regnes som tatt i **3 timer** fra siste push (ikke 30 minutter). Har den ingen PR etter 3 timer, kan neste kjøring ta over. Hovedløkken velger da heller en annen oppgave som ikke rører de samme filene.
- Er siste merge til `main` mindre enn 1 time gammel og ingen PR er åpen, kan den andre kjøringen holde på med neste oppgave. Start ikke en ny oppgave i den situasjonen; vent til neste kjøring.

## 30.10.2026 – PR #32–#35 merget (prøve C, D og F)

- Arbeidsflyten «oppgave» leverte tre PR-er på rad i én kjøring (ca. 3 t, 1 t 40 min og 3 t). Små oppgaver med småfunn går omtrent dobbelt så fort som en prøve.
- To kjøringer jobbet samtidig (prøve F og prøve D) på hver sin branch uten konflikt i koden, men begge skrev i tilstandsfilen, og det ble to linjer «Sist oppdatert». Regel som før: vent til den andre PR-en er merget, les tilstandsfilen på nytt fra `main`, og oppdater den i en egen liten PR.

## 30.10.2026 – Prøve D (PR #35) og prøve F (PR #34) samtidig

- To kjøringer jobbet samtidig med prøve D og prøve F, som rører ulike filer. Regelen om 3 timer for en branch med oppgavekort virket: hovedløkken lot prøve F være og valgte prøve D. Begge ble merget samme formiddag; eneste konflikt var versjonen og nummereringen av beslutningene i `docs/09-apne-sporsmal.md` (A5/A6 ble brukt av begge).
- Regel videre: når to kjøringer kan skrive beslutninger eller små oppgaver samtidig, sjekk siste nummer på `main` rett før PR-en åpnes, og bruk neste ledige. Kommentarer i koden som viser til et beslutningsnummer, rettes samtidig.

## 30.10.2026 – UU-funnene fra nattløkken

- e2e henger når en gammel next-server holder port 3100 (reuseExistingServer). Kjør med CI=1 og en ledig E2E_PORT. Kilde: nattløkken 30.10.2026.
## 30.10.2026 – PR #38 og #39 merget (småfunn D og F, sammenligning og ADR 0004)

- Regelen om 3 timer virket igjen: hovedløkken lot `fase1-smafunn-prove-d-f` (84 min siden push) være og valgte sammenligningen og ADR-en, som bare rører dokumenter. Beslutningsnumrene A11/A12 ble holdt av til den andre kjøringen, så ADR-en brukte A13–A15 uten konflikt.
- En oppgave med bare dokumentasjon tok like lang tid som en prøve (ca. 3 t 15 min, 22 agenter), fordi alle rollene leser mye. Regel videre: rene dokumentoppgaver kan få færre roller i forhåndsvurderingen.

## 30.10.2026 – PR #41 merget (organisasjon → selskap → kontor → ansatt)

- Første punkt i fase 0b gikk fra oppgavekort til merget PR i én kjøring (24 agenter, ca. 2 t 45 min). Ingen alvorlige funn, 6 små, lagt inn som liten oppgave (i).
- To kjøringer tok samme oppgave: den andre startet «organisasjon → selskap → kontor» i en egen worktree-branch mens denne kjøringen allerede hadde pushet oppgavekortet til `fase0b-organisasjon-selskap-kontor`, og pushet også til samme branch. Det ble flettet uten tap, men arbeidet ble gjort to ganger. Regel videre: før en oppgave startes, sjekk alle brancher på origin med push de siste 3 timene (også `worktree-wf_*`) og om oppgavekortet for punktet allerede finnes der. Finnes det, velg et annet punkt.
- Beslutningsnumrene kolliderte igjen (A13–A15 brukt av ADR 0004). Regelen fra prøve D gjelder: sjekk siste nummer på `main` rett før PR-en åpnes.

## 31.10.2026 – PR #51 merget (grunnlayout Fjord)

- Containeren startet på nytt to ganger mens arbeidsflyten kjørte. Arbeidsflyten ble gjenopptatt med `resumeFromRunId`, og arbeidet som var pushet, gikk ikke tapt. Regel som før: push etter hvert steg.
- Etter at «Oppdater åpne PR-er» flettet inn `main`, fikk PR-en samme versjon som `main` og ble stående «unstable» (CI-kjøringen for `pull_request` ventet på godkjenning, bare `workflow_dispatch`-kjøringen var grønn). En ny push fra agenten med versjonen én patch over `main` startet vanlig CI, og skriptet merget. Regel videre: står en PR «unstable» med alle jobbene grønne, sjekk versjonen og push en liten endring.

## 02.11.2026 – filtjenesten kolliderte med PR #60

- Parallelle PR-er med migrering: oppdater fra main og kjør db:generate på nytt før push. To migreringer med samme nummer gir rød test.
- Rett før PR åpnes: flett inn `main` og sjekk at versjonen er én patch over. Branchen gikk fra #60, og #61 (bare tilstandsfilen) økte versjonen på `main` etterpå, så GitHub meldte konflikt på versjonslinjen. Flettingen tok fem minutter, men CI måtte kjøre på nytt (25 min), og merge-skriptet med `--vent` ga opp etter 30 minutter fordi klokken startet før flettingen. Regel: flett inn `main` først, kjør skriptet etterpå.
## 31.10.–02.11.2026 – PR #59 og #60 merget (revisjonslogg, sperre ved innlogging)

- Revisjonsloggen (PR #59) ble påbegynt i én kjøring og fullført i neste. Det gikk bra fordi oppgavekortet og testplanen lå på branchen, så den neste kjøringen kunne ta over uten å begynne på nytt. Regel som før: push oppgavekortet først.
- Sperren ved innlogging (PR #60) er den første tabellen uten organisasjons-ID siden Better Auths tabeller. `expectTenantIsolation` passer ikke da; isolasjonen ble i stedet vist med en vanlig integrasjonstest (sperre på én adresse påvirker ikke en annen). Regel videre: en tabell uten organisasjons-ID må begrunnes i oppgavekortet og få en egen test som viser at den ikke lekker mellom organisasjoner.
- Arbeidsflyten merget PR #60 selv, men kjøringen rakk ikke å oppdatere tilstandsfilen og erfaringene etterpå. Hovedløkken tok det igjen i neste kjøring. Regel som før: læringsløkken (tilstand, erfaringer, plan, ordliste) kjøres i en egen liten PR straks en PR er merget, også når det er arbeidsflyten som merget.

## 02.11.2026 – PR #64 (tilkoblingslaget): to kjøringer bygde samme oppgave

- To kjøringer tok «Tilkoblingslag med faste porter» samtidig. Begge brukte samme branch og samme testskriver-commit, men hver sin utvikler-variant. Den ene (denne) satte sammen fire arbeidstrær lokalt og fikk test-lederens godkjenning uten å pushe; den andre pushet sin variant rett på branchen en time senere. Prosjektlederen beholdt den godkjente varianten og flettet inn origin med `-s ours` (ingen force-push), slik at ingen av kjøringene mister historikk. Den andre variantens forbedringer står i liten oppgave (p).
- Regel videre (presisering av 3-timersregelen): sjekk `origin` for push på branchen, også rett før hvert av de siste stegene (sammensetting, test-leder, PR), ikke bare ved start. Og push den sammensatte branchen straks den er satt sammen, før test-lederen kjører, så den andre kjøringen ser at arbeidet finnes.

## 02.11.2026 – PR #64 sett fra den andre kjøringen (hovedløkken kl. 21:05)

- Hovedløkken fant branchene for tilkoblingslaget uten push på 54 minutter og tok over fra byggesteget. Den forrige kjøringen levde fortsatt: den satte sammen og testet lokalt i over en time uten å pushe. Resultat: to varianter, flettet uten tap, men arbeidet ble gjort to ganger. Regel videre: hovedløkken bruker 3-timersregelen også når oppgavekortet alt er pushet («30 minutter uten push» holder ikke), og en kjøring som tar over, pusher en markør i `docs/agenter/tilstand.md` på branchen først.
- Containeren startet på nytt tre ganger i løpet av to timer. Alt som var pushet, ble tatt videre; det som lå i arbeidskopier uten push (en PR-tekst, en tilstandsendring) måtte gjøres på nytt. Regel som før: push etter hvert steg, også små.

## 03.11.2026 – PR #69 (liten oppgave (o), (p) og (q))

- Nattløkken (PR #68) og oppgaveløkken (PR #69) tok samme versjonsnummer (0.2.57) fra hver sin branch. Prosjektlederen fletter `main` inn rett før PR-en åpnes og setter versjonen til neste ledige tall da, ikke når kortet skrives. Sjekk: `git show origin/main:package.json | grep version`.
- Når `main` har fått en ny migrering siden branchen ble laget, kjøres `pnpm db:migrate "$TEST_DATABASE_URL"` før de berørte testene kjøres på nytt; ellers er røde tester en falsk alarm.
- Det samme gjelder e2e: `pnpm db:migrate` kjøres også mot `DATABASE_URL`, fordi e2e-serveren bruker utviklingsdatabasen og `playwright.config.ts` ikke kjører migreringer. Uten det ga reklamasjonsbranchen 62 røde e2e-tester med «relation "claims" does not exist» (06.11.2026).
- To av tre fulle `pnpm test`-kjøringer ble falskt røde fordi en annen agent tømte den delte testdatabasen samtidig (kjent fra liten oppgave (k)). Test-leder og prosjektleder kjører de berørte filene alene før de sier «rød», og CI er fasiten. Hver kjøring sin egen testdatabase (f.eks. `ezprop_test_<worktree>`) er en liten oppgave verd å ta.
- Et funn fra en gjennomgang kan være feil: «overflødig `FOR UPDATE` i `markFileDeleted`» (o) ble avvist av sikkerhet-personvern i runde 1 med begrunnelse, og låsen står. Kortet skal si det når et funn ikke tas, så det ikke dukker opp igjen i neste liste.

## 03.11.2026 – PR #71 (liten oppgave (r) og (s))

- En ustabil e2e-test rettes i produktkoden, ikke i testen, når årsaken er et ekte vindu (halvskrevet fil som en leser kan se). Midlertidig fil + `rename` er ti linjer og fjerner vinduet for alle lesere, ikke bare testen.
- Opprydding i en `catch`-gren må aldri kunne kaste selv; da forsvinner den opprinnelige feilen fra loggen. Tre gjennomgangsagenter fant det samme; prosjektlederen rettet det før PR (`.catch(() => undefined)` på `rm`).
- Premisset for en ytelsesretting skal være presist i kommentaren («Better Auth skriver aldri `users.email`», ikke «skriver aldri `users`»), ellers setter neste utvikler det gamle tilbake av forsiktighet.
- `merge-klare-pr.sh … --vent` må kjøres i bakgrunnen med lang tidsgrense (CI med e2e tar 20–25 min); 10 minutter i forgrunnen er for lite, og skriptet skriver først når det er ferdig.


## 04.11.2026 – PR #84 (personvernerklæring og sletteregel for betadata)

- Rollen sikkerhet-personvern feilet på kvoten både i forhåndsvurderingen og i gjennomgangen, og reserven til opus slo ikke inn. PR-en ble likevel merget uten rollens vurdering. Gjennomgangen i ettertid fant 3 alvorlige feil (hvem ser hva, arbeidsmiljøloven kapittel 9, ekte bilder i prøvetabellene). Regel videre: feiler en rolle i arbeidsflyten, står det i sluttrapporten, og hovedløkken kjører rollen for hånd før neste oppgave. Gjenkjenningen av kvotefeil i `oppgave.js` leser nå hele feilen, ikke bare `message`.
- En hengt `next start` på port 3100 fra en tidligere kjøring stoppet e2e. Sjekk `ps` for gamle `next-server` før e2e når testene får tidsavbrudd på `/api/helse`.

## 05.11.2026 – PR #87 (team og parter på oppdraget)

- Reserven når kvoten er brukt opp, virket fortsatt ikke: den kjørte uten rolletype og arvet samme modell. Rettet slik at rollen beholdes og bare modellen byttes. Ble rollen likevel ikke kjørt, kjører prosjektlederen gjennomgangen selv før neste oppgave.
- Nye tabeller med personopplysninger skal føres i `docs/personvern/intern-personvernerklaering.md` i samme PR. Ta det med i oppgavekortet når en tabell har navn, e-post eller telefon.
- Hjelpetekster for fritekst må ikke foreslå helseopplysninger («sykdom»).

## 05.11.2026 – PR #89 (utstedende selskap)

- Reserven til opus slo fortsatt ikke inn for sikkerhet-personvern i gjennomgangen (bare én «started» i journalen). Inntil årsaken er funnet: kjør sikkerhetsgjennomgangen for hånd etter hver arbeidsflyt der rollen feilet, før neste oppgave.

## 05.11.2026 – fase2a-bygninger-areal-rom (ustabil e2e i sertifisering)

- I e2e skal man aldri navigere bort rett etter et klikk på «Lagre». Vent først på et synlig tegn på at lagringen er ferdig, ellers avbrytes forespørselen.
## 05.11.2026 – PR #95 (kontakter og firma)

- Reserven feilet igjen for sikkerhet-personvern, både i forhåndsvurderingen og i gjennomgangen: også kallet med `agentType` og `model: "opus"` ga «Fable limit». Rollefilen har `model: fable`, og den ser ut til å vinne over modellen i arbeidsflyten. Gjennomgangen for hånd med en vanlig agent på opus som leser rollefilen, virket (40 sekunder). Fortsett slik til reserven er rettet; en mulig retting er å la rollefilen styre bare verktøyene og la arbeidsflyten velge modellen.
- Når `main` får flere PR-er mens en oppgave er i arbeid, må migreringen og A-numrene renummereres ved hver fletting (her tre ganger). Sjekk høyeste migrering og høyeste A-nummer på `origin/main` rett før PR-en åpnes.
- Lokale databaser med en migrering som senere ble renummerert, må bygges på nytt (tøm `public` og `drizzle`, og fjern publikasjonene `powersync` og `electric_publication_default`), ellers feiler `pnpm db:migrate`.
- Tilfeldige id-er (uuid) skal ikke stå i fritekst som går gjennom fødselsnummersjekken (11 sifre på rad gir ustabile tester). Fjern sifrene eller bruk faste navn.

## 05.11.2026 – PR #97 (koble kontakter)

- Merge-skriptet merger alle klare PR-er, også de en annen kjøring jobber med. PR #97 ble merget mens arbeidsflyten fortsatt rettet funn fra gjennomgangen, så siste commit kom ikke med. Regel videre: arbeidsflyten åpner PR-en først når gjennomgangen og rettingene er ferdige (slik den gjør), og etter en omstart sjekkes `origin/main` for en merget PR fra branchen før noe annet.
- Å gjenoppta arbeidsflyten med `resumeFromRunId` etter en omstart feilet: planleggingssteget kjørte på nytt og ga ingen biter. Når bare sjekker og PR gjenstår, er det raskere å fullføre for hånd.

## 05.11.2026: samme planpunkt bygget to ganger

- To kjøringer bygde «Bygninger, etasjer, areal per etasje og rom» samtidig. Den ene startet fra `main` med et annet branchnavn enn den som alt var i arbeid, og leverte PR #98; den andre (startet 08:45 UTC, branch `fase2a-bygninger-areal-rom`) brukte ca. 7 timer og endte med bare en opprydding (PR #100). Regel videre: før en kjøring starter et planpunkt, søker den etter branches på `origin` med push de siste 3 timene som gjelder samme punkt (`git for-each-ref --sort=-committerdate refs/remotes/origin`, se på navn og oppgavekort), ikke bare etter samme branchnavn. Den som starter, pusher oppgavekortet straks, så andre ser det.

## 05.11.2026 – PR #102 (arbeidskøen)

- En branch som er satt sammen («slå sammen del …»), men aldri gjennomgått, kan overtas etter 3 timer uten push. Det gikk raskt å fullføre for hånd: flette inn `main`, kjøre sjekkene, én gjennomgang fra test-leder, rette og åpne PR. Ingen ny arbeidsflyt trengs når bare gjennomgang og PR gjenstår.
- Testplanen kan selv be om noe som bryter mønsteret: her ba den om `from`/`to` med notatteksten i revisjonsloggen. Fritekst (notater) skal aldri i revisjonsloggen, bare feltnavnet, uansett hva testplanen sier.
- Ikke slett en testfil mens hele Vitest kjører; den feiler da med «Cannot find module». Kjør de berørte mappene på nytt etterpå.

## 06.11.2026 – PR #110 og #111 (tidsmåling og reklamasjoner)

- To kjøringer bygde hver sin oppgave samtidig fra samme `main`, og begge tok de samme A-numrene (A119–) og samme migreringsnummer (0022). Den som merges sist, må få nye numre: bytt numrene bare i filene branchen selv har endret (`git diff --name-only origin/main`), og lag migreringen på nytt med `pnpm db:generate` i stedet for å gi filen nytt navn.
- Tester som teller (antall rettigheter, «migreringen 00NN finnes») brytes når to brancher legger til samme slags ting. Kjør hele Vitest etter flettingen, ikke bare de berørte mappene.
- Når en branch som bygger på en annen er flettet med den, og den andre merges med «Squash and merge», blir det konflikter mot `main` selv om innholdet er likt. Sjekk `git diff origin/<grunnbranch> origin/main` er tom, og ta da vår side i alle konfliktene.

## 06.11.2026 – PR #115 (fire testoppdrag)

- Når admin blir ansatt i mer enn én organisasjon (her prøveorganisasjonen), blir oppslag som «organisasjonen til admin … limit 1» tilfeldige. Det slo ut i mange eldre e2e-tester i CI, men ikke lokalt da bare den nye testen ble kjørt. Kjør hele e2e-pakken (eller i det minste alle fase-2a-filene) lokalt når seed-data endres, og la testhjelperne hoppe over organisasjoner med `settings.sampleData`.
- Lokal `main` i containeren kan være gammel historikk som ikke kan spoles fram. Arbeid fra `origin/main` i en ny branch i stedet for å nullstille `main`.

## 10.11.2026 – fase2a-forslagsmonster (forslagsmønsteret)

- Når seeden for testoppdrag endres (her `ensureSampleAi`, som slår på KI i prøveorganisasjonen), må `pnpm db:seed:testoppdrag` kjøres på nytt lokalt før `pnpm test:e2e`. CI og `scripts/session-start.sh` gjør det selv, men en arbeidskopi som ble satt opp før endringen, gir røde e2e-tester («KI er av.») uten at koden er feil.
## 10.11.2026 – «KI-modulen og loggen» bygget to ganger

- Hovedløkken pushet en branch midt i en arbeidsflyt (etter beskjed fra stoppkroken). En annen kjøring så branchen uten PR og trodde kjøringen hadde stanset, overtok den og merget PR #127. Den første arbeidsflyten bygget det samme ferdig i parallell, og det arbeidet ble lagt bort (`arkiv-ki-modul-logg-parallell`). Regel videre: før en arbeidsflyt startes, skriv punktet og branchen under «Gjeldende oppgave» i `docs/agenter/tilstand.md` på `main` (eller sjekk at ingen annen kjøring har det). Ikke overta en branch med commit yngre enn 60 minutter mens en arbeidsflyt kan være i gang.


## 11.11.2026 – PR #135 (vask før KI) og retting av T-0001

- To kjøringer reserverte de samme A-numrene: «Vask før KI» hadde satt av A169–A179, mens oppgavekortet for T-0001 tok A169 og A170 på sin branch. Regel videre: et kort som tar A-numre, leser «nå A…» og reservasjonene i `docs/agenter/tilstand.md` på `origin/main` rett før numrene skrives, og den som merges sist, nummererer om i sine egne filer.
- Læringsløkken etter merge ble ikke kjørt for PR #131, så testlaget meldte det som funn (T-0021). Flytt punktet til `docs/plan/levert.md` i samme kjøring som merger.

## 11.11.2026 – PR #141 (evalueringssett)

- En kjøring stoppet midt i arbeidet (kl. 10:30 UTC) uten PR, og branchen ble liggende bak main. Neste hovedløkke fant den ved å se på nyeste commit på åpne brancher. Regel videre: en branch uten PR og uten commit de siste 30 minuttene overtas, og main flettes inn før noe annet.
- Ikke endre filer mens `pnpm test` kjører i samme mappe: testene som kjører etter endringen, prøver halvferdig kode og gir falske røde. Kjør de berørte testene på nytt etter endringen.

## 11.11.2026 – PR #143 (KI-kø)

- Igjen stoppet en kjøring etter sammensetting av bitene, før «Kjør og rett» og PR. Hovedløkken tok over: kjørte sjekkene, tre gjennomgangsroller i parallell, rettet og åpnet PR. Det tok rundt en time; regelen fra #141 virket.
- Testskriver og utvikler hadde ulike navn på samme felt (`ownText` mot `sourceText`) og ulik oppfatning av når køen skal stoppe uten nett. Testplanen bør si eksakt hvilke felt i tilstanden testen setter.
- En test som sorterer på tilfeldig id når tidspunktene er like, feiler bare av og til. Gi hver post sitt eget tidspunkt i testene, eller sammenlign uten rekkefølge.
- Minneutgaven av et lager må ikke tillate poster som det ekte lageret ikke kan ha (eller må kunne slette dem): rydding ble skrevet etter nøkkel, og poster uten nøkkel ble liggende.

- Gammel next-server på port 3100 gjør e2e ugyldig (reuseExistingServer). Stopp den før kjøring.

**PR #174 (svarene i reglene og bygningene, 12.11.2026):**
- Nok en kjøring stoppet midt i «Bygg», med bygningsdelen og beslutningene på to worktree-brancher og regeldelen ikke pushet. Hovedløkken slo sammen branchene og lot én utvikler bygge resten etter kortet; det gikk raskere enn å starte arbeidsflyten på nytt, fordi kortet og testplanen var ferdige og presise.
- Branchen var laget oppå en plan-PR, og main fikk tre plan-PR-er til før merge. Flett inn main før PR-en åpnes, ikke etter gjennomgangen.
- Lokal utviklingsdatabase uten nyeste migrering gjør e2e rød. Kjør `pnpm db:migrate` etter å ha hentet en branch med ny migrering.
