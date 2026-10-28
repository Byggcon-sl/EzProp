# Rutiner (forslag, ikke laget ennå)

Rutinene lages med `create_trigger` **først når Ståle har godkjent PR-en for fase 0a** og sagt ja til rutinene. Begge kjører i samme skymiljø som denne sesjonen, med `create_new_session_on_fire = true` og tag `ezprop-utvikling`.

## 1. Hovedløkken (løkke A)

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

## 2. Nattløkken (løkke E)

- **Når:** hver natt kl. 02:17 Oslo-tid (`CRON_TZ=Europe/Oslo 17 2 * * *`).
- **Hva:** kjører arbeidsflyten `natt`: hele testpakken, e2e på iPad-størrelse (også uten nett når det finnes), universell utforming, sårbare pakker (`pnpm audit`), appstørrelse og trege spørringer. Funn blir oppgaver i `tilstand.md`. Trygg rydding samles i én egen PR.
- **Prompt:**

```text
Du er prosjektlederen i EzProp. Kjør nattløkken: Workflow «natt». Skriv funnene inn under «Oppgaver fra nattløkken» i docs/agenter/tilstand.md. Rydding som er trygg (formatering, utdaterte pakker uten brudd, døde filer) samles i én PR med PR-malen. Commit og push. Ingen nye funksjoner.
```

## Hva Ståle må gjøre

1. Merge PR-en for fase 0a.
2. Svare «ja til rutinene» i en ny sesjon (eller i prosjektsamtalen). Da lages begge rutinene, og han får navn og tidspunkt tilbake.
3. Eventuelt øke «Dynamic workflow size» i `/config` hvis flere enn ca. 10 agenter skal kjøre samtidig.
