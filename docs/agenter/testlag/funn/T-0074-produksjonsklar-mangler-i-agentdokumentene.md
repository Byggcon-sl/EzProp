---
id: T-0074
tittel: «Produksjonsklar» (Ståle 13.11) står ikke i agentbeskrivelsene og produktvisjonen
type: feil
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-dokumentvakt
omrade: dokumenter (agentlaget)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Ståles krav om at alt bygges ferdig for drift første gang, står bare i CLAUDE.md og planen. Forenkleren har fortsatt tekst om å «kutte omfang» og flytte til «en senere fase». Ved en gjennomgang kan den foreslå å kutte driftskvalitet som ikke står i oppgavekortet.

## Slik gjenskapes det
1. Søk etter «produksjonsklar» i `docs/11-agentlaget.md`, `.claude/agents/` og `docs/01-produktvisjon.md` (sist oppdatert 10.11): ingen treff.
2. Les `.claude/agents/forenkler.md` linje 3 og 11 («kutte omfang», «en senere fase»).
3. Les `docs/kartlegging/svar-claude-pa-vegne-av-stale-2026-11-10.md` linje 12 («smalt i betaen, kan bygges ut senere»).

## Forventet
Prinsippet står der agentene arbeider, og eldre tekst som sier noe annet, er merket.

## Faktisk
Teksten er ikke oppdatert. Alle agentene leser CLAUDE.md først, og forenkleren får ikke kutte det som står i planen, så det bryter ikke med 13.11 i dag.

## Forslag
Legg prinsippet inn i `docs/11-agentlaget.md`, `forenkler.md` (aldri kutte tester, feilhåndtering eller universell utforming i planpunkter) og produktvisjonen. Skriv øverst i svarfilen fra 10.11 at 13.11 gjelder.

## Etterprøvd
2026-11-14, bekreftet. Meldt som middels, etterprøvd til lite.

## Logg
- 2026-11-14: funnet
