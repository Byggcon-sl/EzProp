# Erfaringer

Lærdom etter hver PR: feil som gikk igjen, ting Ståle avviste, det som sparte tid. Nyeste øverst. Får Ståle stadig de samme kommentarene, legges de inn som regel i den aktuelle agentbeskrivelsen.

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
