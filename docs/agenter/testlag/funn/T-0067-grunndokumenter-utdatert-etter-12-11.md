---
id: T-0067
tittel: Grunndokumentene beskriver innloggingen og designet slik de var før 12.11
type: feil
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-dokumentvakt
omrade: dokumenter (CLAUDE.md, arkitektur, roller)
maal: de ansatte
commit: e013fde7
forsok: 0
pr:
---

## Hva
Dokumentene agentene leser først, sier fortsatt at innlogging bare skjer med kode på e-post, at designet heter «Fjord», og nevner ikke regelmotoren. Microsoft-innloggingen, Byggcon-profilen og regelmotoren kom 12.11.2026. Agentene kan bygge på feil grunnlag, og innloggingen er beskrevet feil i tilgangsdokumentet.

## Slik gjenskapes det
1. `CLAUDE.md` linje 25 («Designprinsipper (A «Fjord»)») og 58 («Better Auth (e-post-OTP …)»).
2. `docs/06-arkitektur.md`: «Sist oppdatert: 10.11.2026», linje 14 nevner bare koden, og ingen treff på `core/rules`, ADR 0008 eller 0009 (ADR 0009 innfører en ny lint-grense).
3. `docs/02-roller-og-tilgang.md` linje 26, `.claude/agents/ui-designer.md` linje 3.
4. `docs/drift/testmiljo-azure.md` linje 222 sier at Microsoft-innloggingen venter på secretene, som ble lagt inn 12.11.

## Forventet
Microsoft-innlogging som hovedvalg med koden som reserve (ADR 0008) står i CLAUDE.md, 02 og 06. Regelmotoren og ADR 0007–0009 står i 06. Designet heter Byggcon-profilen.

## Faktisk
Som i stegene.

## Forslag
Rett linjene i én liten PR, sammen med T-0022 og T-0042 (samme slags utdatert tekst).

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-13: funnet
