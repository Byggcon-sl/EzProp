---
id: T-0078
tittel: DPIA-punktet (K3) i planen er skrevet om uten at Ståle har sagt det
type: feil
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-dokumentvakt
omrade: dokumenter (plan), personvern
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Ståle svarte 12.11.2026 (K3): «Ja, et kort utkast fra agentene». I planen er «kort utkast» og «ikke før testing» tatt bort, og endringsloggen nevner det ikke. Det bryter regelen om at Ståles beslutninger i planen ikke skrives om uten at han har sagt det.

## Slik gjenskapes det
1. Kjør `git diff e013fde7..a1ca41d9 -- docs/07-utviklingsplan.md` og se linjen om DPIA (nå linje 256).
2. Sammenlign med `docs/kartlegging/svar-fra-stale-2026-11-12.md` linje 26 (K3).
3. Søk etter DPIA i `docs/plan/endringslogg.md`.

## Forventet
Punktet sier det Ståle sa (kort utkast fra agentene), og en endring står i endringsloggen.

## Faktisk
«Kort utkast» og «ikke før testing» er borte. Ingen linje i endringsloggen.

## Forslag
Før tilbake Ståles ord fra K3 i planen. Ved tvil: behold begge versjonene og flett, slik arbeidsflyten sier (regel 7, funn T-0052).

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-14: funnet
