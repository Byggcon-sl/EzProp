# Rutiner

**Laget 28.10.2026** etter at Ståle merget PR #2 og #1 og sa ja til rutinene. Begge starter en ny sesjon i skymiljøet (`create_new_session_on_fire = true`), merker seg selv med taggen `ezprop-utvikling`, og sender varsel til Ståles telefon når en kjøring har noe å melde.

| Rutine | ID | Når | Første kjøring |
|---|---|---|---|
| EzProp hovedløkke | `trig_01PjEi1FmH6JzevEdpMoX7hp` | annenhver time, minutt 42 (`42 */2 * * *`, UTC) | 28.10.2026 kl. 13:42 norsk tid |
| EzProp nattløkke | `trig_01HAksdUvEXW6rRLmPVraJMN` | hver natt kl. 02:17 norsk tid | 29.10.2026 |

**Første kjøring 28.10.2026 kl. 13:44 stoppet etter 20 sekunder:** sesjonen rutinen startet hadde ikke GitHub-tilgang (403 på `gh api`, ingen push) og ikke sesjonsverktøyene (`list_sessions`, `set_session_tags`). Rutinene kan ikke gi seg selv dette; det settes på miljøet og rutinen i Claude.

**Må gjøres av Ståle før rutinene virker** (begge innstillingene ligger på selve rutinen, ikke på miljøet):
1. Gå til https://claude.ai/code/routines og klikk på «EzProp hovedløkke».
2. Klikk menyen ved siden av navnet og velg **Edit** (Rediger). Dialogen «Edit scheduled task» åpner seg.
3. Åpne **Advanced settings** (Avanserte innstillinger). På fanen **General**: under **Repository**, velg `Byggcon-sl/EzProp`. Under **Cloud environment** som dukker opp, velg «Byggcon».
4. Gå til fanen **Connectors** og sørg for at «Claude Code Remote» er med (den gir sesjonsverktøyene). Microsoft 365 og de andre kan tas bort.
5. Klikk **Save changes** nederst.
6. Gjør det samme for «EzProp nattløkke».
7. Prøv: klikk **Run now** på hovedløkkens side. Kjøringen dukker opp under **History**; klikk på den for å se hva den gjorde.

Promptene er rettet samme dag: finnes ikke GitHub-tilgang, sender rutinen ett varsel og avslutter uten å gjøre noe. Mangler sesjonsverktøyene, hopper den over det steget. Begge rutinene kjører prosjektlederen på ledermodellen (som i `.claude/agents/prosjektleder.md`).

Rutinene kan pauses, endres eller slettes i Claude under «Routines», eller av en sesjon med `update_trigger`. Sesjonene rutinene starter, har ikke SharePoint-koblingen; det de trenger ligger i repoet.

## Slik ble de foreslått

### 1. Hovedløkken (løkke A)

- **Når:** annenhver time (`0 */2 * * *`).
- **Hva:** ny sesjon leser `CLAUDE.md` og `docs/agenter/tilstand.md`, sjekker at ingen annen sesjon med tag `ezprop-utvikling` er i gang, sjekker åpne PR-er (merget → læringsløkken F; kommentar fra Ståle → ny oppgave), og kjører arbeidsflyten `oppgave` for neste punkt i gjeldende fase. Venter 3 PR-er eller flere på Ståle, rettes bare kommentarer og nattløkkens funn, og sesjonen avslutter.
- **Prompt:**

```text
Du er prosjektlederen i EzProp (se .claude/agents/prosjektleder.md). Kjør hovedløkken (løkke A i docs/11-agentlaget.md):
1. list_sessions: finnes en annen aktiv sesjon med tag ezprop-utvikling? Da avslutter du uten å gjøre noe.
2. Les docs/agenter/tilstand.md og status på åpne PR-er (gh pr list). Merget PR: kjør læringsløkken (oppdater erfaringer.md, planen, ordlisten). Kommentar eller avvisning fra Ståle: lag ny oppgave av kommentaren.
3. Venter 3 PR-er eller flere på Ståle: ikke start nye funksjoner. Rett kommentarer, og avslutt.
4. Ellers: finn neste uavkryssede punkt i gjeldende fase i docs/07-utviklingsplan.md og kjør Workflow «oppgave» med oppgaven som args. Ny fase starter bare når Ståle har merget siste PR i forrige fase.
Commit og push etter hvert ferdige steg. Oppdater tilstand.md før du avslutter.
```

### 2. Nattløkken (løkke E)

- **Når:** hver natt kl. 02:17 Oslo-tid (`CRON_TZ=Europe/Oslo 17 2 * * *`).
- **Hva:** kjører arbeidsflyten `natt`: hele testpakken, e2e på iPad-størrelse (også uten nett når det finnes), universell utforming, sårbare pakker (`pnpm audit`), appstørrelse og trege spørringer. Funn blir oppgaver i `tilstand.md`. Trygg rydding samles i én egen PR.
- **Prompt:**

```text
Du er prosjektlederen i EzProp. Kjør nattløkken: Workflow «natt». Skriv funnene inn under «Oppgaver fra nattløkken» i docs/agenter/tilstand.md. Rydding som er trygg (formatering, utdaterte pakker uten brudd, døde filer) samles i én PR med PR-malen. Commit og push. Ingen nye funksjoner.
```

## Hva Ståle kan gjøre

- Følge med i Claude under «Routines» og i GitHub (PR-er).
- Øke «Dynamic workflow size» i `/config` hvis flere enn ca. 10 agenter skal kjøre samtidig.
- Pause rutinene hvis noe går galt. Tilstanden ligger alltid i `docs/agenter/tilstand.md`.
