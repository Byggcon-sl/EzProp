# Erfaringer

Lærdom etter hver PR: feil som gikk igjen, ting Ståle avviste, det som sparte tid. Nyeste øverst. Får Ståle stadig de samme kommentarene, legges de inn som regel i den aktuelle agentbeskrivelsen.

## 29.10.2026 – PR #17 merget (synktjenestene i Azure)

- Arbeidsflyten «oppgave» gikk fra oppgavekort til merget PR uten Ståle (24 agenter, ca. 3 timer). Tjenester som koster penger, ble lagt inn **av som standard** (en Bicep-parameter og en GitHub-variabel), så mergen kostet ingenting og PR-en trengte ikke vente på Ståle. Spørsmålet om å slå dem på ligger som nr. 12. Regel: noe som koster penger, bygges slått av, og Ståle slår det på.
- To hovedløkker kjørte samtidig (taggen `ezprop-utvikling` kunne ikke sjekkes i skyen) og skrev begge i tilstandsfilen, som fikk doble linjer etter flettingen. Ryddet i en egen liten PR. Regel: les tilstandsfilen på nytt fra `main` rett før den oppdateres.
- En automatisk fletting fra `main` ga en CI-kjøring som ventet på godkjenning, så GitHub meldte «unstable». En ny vanlig commit startet CI på nytt.

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

## 30.10.2026 – Prøve D (PR #35) og prøve F (PR #34) samtidig

- To kjøringer jobbet samtidig med prøve D og prøve F, som rører ulike filer. Regelen om 3 timer for en branch med oppgavekort virket: hovedløkken lot prøve F være og valgte prøve D. Begge ble merget samme formiddag; eneste konflikt var versjonen og nummereringen av beslutningene i `docs/09-apne-sporsmal.md` (A5/A6 ble brukt av begge).
- Regel videre: når to kjøringer kan skrive beslutninger eller små oppgaver samtidig, sjekk siste nummer på `main` rett før PR-en åpnes, og bruk neste ledige. Kommentarer i koden som viser til et beslutningsnummer, rettes samtidig.
