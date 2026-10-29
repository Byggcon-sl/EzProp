# Erfaringer

Lærdom etter hver PR: feil som gikk igjen, ting Ståle avviste, det som sparte tid. Nyeste øverst. Får Ståle stadig de samme kommentarene, legges de inn som regel i den aktuelle agentbeskrivelsen.


## 29.10.2026 – Modellbytte når kvoten er brukt opp

- Lederrollene hadde fast modell i `.claude/agents/`. Da kvoten for ledermodellen var brukt opp, ville arbeidsflytene stoppe selv om rutinen ble flyttet til en annen modell. Lederne arver nå modellen fra rutinen (`model: inherit`). Bytte modell gjøres bare på rutinen. Utøverne har fortsatt fast modell.
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
