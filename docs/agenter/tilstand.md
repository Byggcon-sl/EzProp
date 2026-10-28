# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 28.10.2026 (oppgave 4: oppgavekort for første kandidat, PowerSync, på branchen `fase1-kandidat-powersync`)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #1–#6 er merget 28.10.2026.

Gjeldende fase: **Fase 1 – Prøve uten nett.** Testskjemaet (oppgave 3, PR #6) er merget. Testmiljøet i Azure ligger som PR #7 og venter på Ståle.

## Gjeldende oppgave

**Oppgave 4 – Første kandidat: PowerSync koblet til testskjemaet** (fase 1, punktet «Kandidater satt opp mot samme testskjema»). Branch `fase1-kandidat-powersync` fra `main` (etter PR #6). Oppgavekort `docs/funksjoner/fase1-kandidat-powersync.md`, protokoll og resultatmal for prøve A og B `docs/funksjoner/fase1-prove-ab-powersync.md`. Steg: oppgavekort skrevet 28.10.2026; neste er forenkler, arkitekt, sikkerhet-personvern og test-leder (testplan), så utvikler og testskriver i parallell (fire biter, kontrakten står i kortet under «Data»). Versjon 0.1.2 → 0.1.3. Nytt spørsmål nr. 10 til Ståle (PowerSync: selvdrevet eller sky, pris, lisens, databehandleravtale), ikke blokkerende.

**Rekkefølge videre i fase 1:** kandidat 2 (ElectricSQL) og kandidat 3 (egenbygd) på samme skjema og samme protokoll → Ståle kjører prøve A og B per kandidat på ekte iPad når PR #7 og PowerSync i Azure er oppe → prøve C–F → sammenligning og ADR. Punktet «Kandidater satt opp …» krysses av først når alle tre er satt opp.

Hovedmål for fase 1: tid og KI først (grunnlaget for befaring på iPad, der KI-forslag senere vises og godkjennes). Oppgave 4 støtter også reklamasjoner (ingenting går tapt mellom befaring og rapport).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| #7 | Testmiljø i Azure (fase 1, første punkt). Versjon 0.2.0 | Venter på Ståle (nøkler, adresse, «Squash and merge») | Ingen |

Én PR venter. Grensen er 3. Oppgave 4 blir PR nr. 2 i køen; den bygger ikke på #7 i kode, men prøvene A og B trenger testmiljøet. Versjonskonflikten (0.1.3 mot 0.2.0) løses av prosjektlederen når Ståle har merget #7.

## Venter på Ståle

- **PR #7:** følg `docs/drift/testmiljo-azure.md`: lag ressursgruppen og GitHub-innloggingen i Azure, legg inn secrets og variabler, svar på spørsmål nr. 6 og nr. 9, og merge med **«Squash and merge»**.
- **Gi rutinene tilgang** (se `docs/agenter/rutiner.md`): åpne hver rutine på claude.ai/code/routines → Edit → Advanced settings → Repository `Byggcon-sl/EzProp`, miljø «Byggcon», koblingen «Claude Code Remote». Før det gjør hovedløkken ingenting.
- Spørsmålene i `docs/09-apne-sporsmal.md`: nr. 6 (adresse og e-post for testmiljøet), nr. 8 (GPS-posisjon i bildene, før prøve D), nr. 9 (tilgang til ressursgruppen, i PR #7) og nr. 10 (PowerSync som leverandør, før ADR-en).

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

28.10.2026: hovedløkken startet oppgave 4 (første kandidat, PowerSync): branch, oppgavekort, protokoll for prøve A og B, spørsmål nr. 10, ordliste og denne filen. Sesjon: https://claude.ai/code/session_01JqwntzCcVvuiXSedMUVdYg

28.10.2026 kl. 17:34–18:49: PR #6 merget av Ståle (kl. 17:34), deretter oppgaven «Testmiljø i Azure» fra oppgavekort til PR #7 (åpnet kl. 18:49).

28.10.2026 kl. 14:45–16:00: hovedløkken kjørte oppgave 3 fra oppgavekort til PR #6 (arbeidsflyten «oppgave»: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver). Fase 0a krysset av i planen. Læringsløkken kjørt for PR #4 og #5 (`erfaringer.md`). Sesjon: https://claude.ai/code/session_01JqwntzbzRrrZa27xqnubtP

28.10.2026 kl. 13:44: hovedløkken startet, men stoppet uten GitHub-tilgang. Ingen endringer gjort.

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
