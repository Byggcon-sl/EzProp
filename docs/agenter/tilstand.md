# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 28.10.2026 (oppgave 3: de tre bitene slått sammen på `fase1-testskjema`, alle sjekker grønne)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #2 (grunnmuren) og PR #1 (testhjelperen) er merget 28.10.2026.

Gjeldende fase fra nå: **Fase 1 – Prøve uten nett.** Første oppgave (oppgave 3, testoppsett) er i arbeid.

## Gjeldende oppgave

**Oppgave 3 – Testoppsett for prøven uten nett** (fase 1, første punkt). Branch `fase1-testskjema` fra `main`. Oppgavekort: `docs/funksjoner/fase1-testskjema.md` (ferdig 28.10.2026, revidert samme dag etter forenkler og test-leder: fem kutt, fem presiseringer, `icon.tsx` droppet). Testplan fra test-leder: `docs/funksjoner/fase1-testskjema-testplan.md` (commit `dcdbbcc`). Byggingen er delt i tre biter som ikke henger sammen: bit 1 utvikler (modulen `src/modules/offline-trial`, siden `/prove/testskjema`, lenken på arbeidskøen, `uuid.ts`), bit 2 utvikler (`manifest.ts`, `apple-icon.tsx`, `appleWebApp` i layout, `brand.color`, versjon 0.1.2), bit 3 testskriver (enhetstester, e2e `e2e/fase-1-testskjema.spec.ts`, fixture). Status 28.10.2026: alle tre bitene er slått sammen på `fase1-testskjema` (commit `9c7a6b4`). To testsett fantes (bit 11 skrevet mot koden, bit 12 skrevet blindt mot kortet); det grundigste (12) ble beholdt, og fordelingen rettet til valg 8 / bilde 8 fordi summeringslinjen i oppgavekortet var feiltalt mot tabellen (kort og testplan rettet). `pnpm lint`, `typecheck`, `test` (68) og `test:e2e` (35 bestått, 1 hoppet over med vilje på PC) er grønne. Ingen nye tabeller, så `tests/factories.ts` er uendret. Worktrees fjernet. Neste steg: test-leder godkjenner, så PR mot `main` med planen A–F og begrunnelsen for at tenant-isolasjon og myk sletting ikke gjelder. Prosjektleder krysser av i planen ved PR. Hovedmål: tid og KI først (grunnlaget for befaring på iPad).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| #4 | Rutinene trenger tilgang (bare dokumentasjon) | Venter på Ståle | Ingen |

## Venter på Ståle

- PR #4: les `docs/agenter/rutiner.md` (avsnittet «Må gjøres av Ståle») og merge.
- Spørsmålene i `docs/09-apne-sporsmal.md`, nytt nr. 6: hvor prøveappen skal kjøre (trengs før oppgave 4 prøves på ekte iPad).

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
