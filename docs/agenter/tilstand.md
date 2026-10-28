# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 28.10.2026 (oppgave 3: PR #6 åpnet mot `main`, venter på Ståle)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #2 (grunnmuren) og PR #1 (testhjelperen) er merget 28.10.2026. PR #3, #4 (rutiner) og #5 (beslutning: testmiljø i Azure og felles innlogging) er også merget 28.10.2026.

Gjeldende fase: **Fase 1 – Prøve uten nett.** Første byggeoppgave (oppgave 3, testoppsett) ligger som PR #6.

## Gjeldende oppgave

**Oppgave 3 – Testoppsett for prøven uten nett** (fase 1): ferdig bygget, testet og godkjent av test-leder 28.10.2026. PR #6 fra `fase1-testskjema` mot `main`. Oppgavekort `docs/funksjoner/fase1-testskjema.md`, testplan `docs/funksjoner/fase1-testskjema-testplan.md`. Innhold: modulen `src/modules/offline-trial` (40 felt som data, telleren, visningen), siden `/prove/testskjema`, lenken på arbeidskøen, app på hjemskjermen (`manifest.ts`, `apple-icon.tsx`, `appleWebApp`, `brand.color`), `uuid.ts` uten `node:crypto`, enhetstester og e2e i PC- og iPad-størrelse, og planen for prøvene A–F med kriteriene for kandidatene. `main` er flettet inn i branchen etter PR #4 og #5 (bare dokumentkonflikt i denne filen). Versjon 0.1.2. Punktet er krysset av i planen.

**Neste oppgave når PR #6 er merget:** «Testmiljø i Azure» (nytt første punkt i fase 1 fra Ståle 28.10.2026). Den trenger svar på spørsmål nr. 6 (adresse og e-post) og at Ståle legger inn Azure-nøklene som secrets i GitHub. Deretter oppgave 4 (første kandidat: PowerSync), som bygger på testskjemaet. Kjente svakheter som tas i oppgave 4 står nederst i oppgavekortet for oppgave 3.

Hovedmål for fase 1: tid og KI først (grunnlaget for befaring på iPad, der KI-forslag senere vises og godkjennes).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| #6 | Oppgave 3: testskjema, app på hjemskjermen og plan for prøvene A–F | Venter på Ståle | Ingen |

Én PR venter. Grensen er 3.

## Venter på Ståle

- **PR #6:** les planen for prøvene A–F og kriteriene i PR-teksten, prøv skjemaet, og merge med **«Squash and merge»** (commit-meldingene på branchen inneholder modellnavn, og det kan ikke rettes fra skyen).
- **Gi rutinene tilgang** (se `docs/agenter/rutiner.md`): åpne hver rutine på claude.ai/code/routines → Edit → Advanced settings → Repository `Byggcon-sl/EzProp`, miljø «Byggcon», koblingen «Claude Code Remote». Før det gjør hovedløkken ingenting.
- Spørsmålene i `docs/09-apne-sporsmal.md`: nr. 6 (adresse og e-post for testmiljøet i Azure, trengs for neste oppgave) og nr. 8 (GPS-posisjon i bildene fra iPaden, trengs før prøve D).

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

28.10.2026 kl. 14:45–16:00: hovedløkken kjørte oppgave 3 fra oppgavekort til PR #6 (arbeidsflyten «oppgave»: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver). Fase 0a krysset av i planen. Læringsløkken kjørt for PR #4 og #5 (`erfaringer.md`). Sesjon: https://claude.ai/code/session_01JqwntzbzRrrZa27xqnubtP

28.10.2026 kl. 13:44: hovedløkken startet, men stoppet uten GitHub-tilgang. Ingen endringer gjort.

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
