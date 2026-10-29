# Erfaringer

Lærdom etter hver PR: feil som gikk igjen, ting Ståle avviste, det som sparte tid. Nyeste øverst. Får Ståle stadig de samme kommentarene, legges de inn som regel i den aktuelle agentbeskrivelsen.

## 29.10.2026 – PR #10 og PR #11 merget, kandidat 3 havnet utenfor `main`

- Ståle merget PR #10 (kandidat 2) til `main` kl. 12:25 og PR #11 (kandidat 3) kl. 12:43. PR #11 pekte på branchen til PR #10, og GitHub flytter ikke en PR til `main` når branchen den bygger på er merget, så kandidat 3 havnet i den gamle branchen og ikke i `main`. Rettet med en ny PR fra `fase1-kandidat-egenbygd-til-main` til `main`.
- Regel: når en PR merges og en annen PR bygger på den, endrer prosjektlederen med en gang målet for den andre PR-en til `main` (`gh api -X PATCH repos/{owner}/{repo}/pulls/<nr> -f base=main`) og fletter `main` inn. Skriv også i PR-teksten under «Bygger på»: «merg PR #X først; denne flyttes da til main».
- To kjøringer av hovedløkken jobbet samtidig på kandidat 3 (den ene via arbeidsflyten, den andre for hånd på samme branch). Arbeidsflyten oppdaget det og pushet ikke. Sjekken av andre sesjoner (taggen `ezprop-utvikling`) virker bare når verktøyene for sesjoner finnes; ellers må tilstandsfilen på `main` og nyeste commit-tid på branchene sjekkes før en oppgave startes.

## 29.10.2026 – Fase 1, kandidat 3 egenbygd (PR #11)

- Kjøringen som startet oppgaven, stoppet etter at bitene var satt sammen, uten at Vitest og e2e var kjørt på det sammensatte. Neste kjøring fant 3 røde Vitest-tester og 3 røde e2e-tester. Regel: kjør `pnpm test` med en gang etter sammensetting, og skriv resultatet i tilstandsfilen før neste steg.
- Utvikler og testskriver skrev hvert sitt sett med tester for samme kode (`.impl.test.ts` ved siden av `.test.ts`), over 1 000 linjer dobbelt. Regel: utvikleren skriver ikke egne testfiler når testskriveren har oppgaven; utvikleren gir heller testskriveren en liste over grensetilfeller.
- Falske tidtakere i Vitest gjør en tidtaker på 0 ms om til 1 ms når den settes under en tick. Henting «med en gang» går derfor via et løfte, ikke en tidtaker.
- Begge e2e-feilene lå i testene: testkroken finnes bare på skjemasiden, og en test hang på tidsforløpet. Sjekk først om testen venter på riktig side og riktig tilstand før koden endres.
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
