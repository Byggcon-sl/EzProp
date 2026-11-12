---
id: T-0042
tittel: To agentbeskrivelser har utdatert tekst om persondata til KI og om synk
type: feil
alvor: lite
status: ny
funnet: 2026-11-12
rolle: test-dokumentvakt
omrade: dokumenter (agenter)
maal: KI i bunnen
commit: 11672aa
forsok: 0
pr:
---

## Hva
KI-ansvarlig får beskjed om at KI aldri får navn, e-post eller telefon. Regel 14 sier også adresse og matrikkel. Arkitekten får beskjed om at synkverktøy velges i fase 1, men egenbygd synk er godkjent (ADR 0004).

## Slik gjenskapes det
1. Les `.claude/agents/ki-ansvarlig.md` linje 18 og `.claude/agents/arkitekt.md` linje 16.
2. Sammenlign med `CLAUDE.md` regel 14 og ADR 0004.

## Forventet
Samme liste som regel 14, og «egenbygd synk (ADR 0004)».

## Faktisk
Som i stegene.

## Forslag
Rett de to linjene, sammen med T-0022.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-12: funnet
