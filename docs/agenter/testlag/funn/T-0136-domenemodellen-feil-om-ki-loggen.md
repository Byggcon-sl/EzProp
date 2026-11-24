---
id: T-0136
tittel: Domenemodellen sier feil om loggen over KI-bruk etter «KI i veien»
type: feil
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-dokumentvakt
omrade: dokumenter, KI
maal: KI i bunnen
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Domenemodellen er fasit for datamodellen, men beskriver loggen over KI-bruk slik den var før «KI i veien». Den som bygger publiseringssperren, kan bygge på feil beskrivelse. Hovedmål: KI i bunnen.

## Slik gjenskapes det
1. Les `docs/05-domenemodell.md` linje 1749, 1754, 1757, 1761, 1762, 1769 og 2453.
2. Sammenlign med `0037_ki-i-veien.sql`, `request-suggestion.ts` linje 422–426 og `decide-ai.ts` linje 129.

## Forventet
Domenemodellen sier det samme som skjemaet og ADR 0006.

## Faktisk
Linje 1761 og 1769: `error_code` «bare ved error», men CHECK godtar `stopped` med fire vaktkoder. Linje 1762 og 1769: `output_text` er tom når utfallet ikke er ok, men `stopped` lagrer svaret. Linje 1757: `candidate_refs` «tom tillatt», men CHECK krever 1–5 eller null. Linje 1749: bare `language_polish` er bygget. Linje 1754 og 2453: prøvesiden og `ai_trial` står fortsatt. Linje 1769: «Angre» gir `suggested`, men koden bruker `undo_and_reject`. `decideAiText`, `undo_and_reject` og grensen på 200 funn i `summary_basis` mangler i ordlisten.

## Forslag
Rett før «Publisering av badet», fordi sperren bygger på disse radene (tilstandsfilen sier alt at `isNotReportText` regner stoppede svar som godkjent).

## Etterprøvd
2026-11-24, bekreftet og senket til lite av funn-kontrolløren. Ikke duplikat av T-0124 eller T-0125 (andre linjer).

## Logg
- 2026-11-24: funnet
