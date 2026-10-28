# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 28.10.2026

## Gjeldende fase

**Fase 0a – Repo og database.** Grunnmuren ligger på branchen `fase-0a-grunnmur` (PR mot `main` åpnes av prosjektlederen). Testhjelperen for tenant-isolasjon ligger på branchen `prove-tenant-hjelper` oppå den (PR mot `fase-0a-grunnmur`). Fasen er ferdig når Ståle har merget begge.

Neste fase: **Fase 1 – Prøve uten nett** (starter når PR-en for fase 0a er merget). Første oppgave: oppgave 3 i `docs/07-utviklingsplan.md` (testoppsett for prøven uten nett).

## Gjeldende oppgave

Ingen pågående oppgave.

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| `fase-0a-grunnmur` (PR mot `main` ikke åpnet ennå) | Fase 0a: grunnmur, dokumentasjon og agentlag | venter på Ståle | – |
| [#1](https://github.com/Byggcon-sl/EzProp/pull/1) | Testhjelper for tenant-isolasjon (`docs/agenter/oppgaver/prove-tenant-hjelper.md`) | venter på Ståle | `fase-0a-grunnmur` (ikke merget) |

## Venter på Ståle

- Merge PR-en for fase 0a, deretter PR-en for testhjelperen (tenant-isolasjon).
- Godkjenne rutinene (`docs/agenter/rutiner.md`).
- Spørsmålene i `docs/09-apne-sporsmal.md`.

## Oppgaver fra nattløkken

Ingen ennå.

## Kjente ustabile tester

- `src/db/seed/run.test.ts` («kan kjøres to ganger uten duplikater») feilet én gang av ti fulle kjøringer 28.10.2026 (fant 2 organisasjoner). Ikke endret i noen åpen PR. Følges opp i nattløkken eller som egen liten oppgave.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
28.10.2026: oppgave «testhjelper for tenant-isolasjon» gjennom løkke B og D, PR åpnet mot `fase-0a-grunnmur`.
