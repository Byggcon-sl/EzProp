---
id: T-0063
tittel: Meldingene fra reglene og spørsmålstekstene er ikke merket som utkast i data
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-fag
omrade: mal, regler
maal: reklamasjoner
commit: e013fde7
forsok: 0
pr:
---

## Hva
Utfall og tiltak i badmalen er merket «utkast», men meldingene takstmannen ser ved et TG-forslag, og spørsmålstekstene, er ikke merket. Kilden for regelen om TGIU sier heller ikke «utkast». Da kan de gli gjennom godkjenningen hos fagrådet.

## Slik gjenskapes det
1. Les reglene i `src/db/seed/templates/wet-room.ts` og typen for regeldokumentet: ingen tekststatus.

## Forventet
Alt fagstoff som ikke er godkjent av fagrådet, er merket slik i data.

## Faktisk
Bare utfall og tiltak har `text_status = draft`.

## Forslag
Gi regler og spørsmål en tekststatus, eller ta dem med i listen som godkjennes i 2a-3.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-13: funnet
