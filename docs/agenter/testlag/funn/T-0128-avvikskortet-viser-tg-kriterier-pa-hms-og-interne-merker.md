---
id: T-0128
tittel: HMS-avviket viser TG-kriterier, og kilden under forslaget viser interne merker
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-18
rolle: test-fag
omrade: badet, avvikskort, regelforslag
maal: reklamasjoner
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Et HMS-avvik har ikke TG-kriterium, men avvikskortet viser TG-kriteriene under «Årsak, kriterium». Kilden under forslaget har interne merker som ikke er ment for takstmannen.

## Slik gjenskapes det
1. Lag et HMS-avvik, og se under «Årsak, kriterium».
2. Se på kilden under et regelforslag: «Kilde: NS 3600:2025 (Ståle 12.11.2026, F3); tallene er ikke kontrollert …».

## Forventet
HMS-avviket viser ikke TG-kriterier (A204). Kilden vises i klarspråk uten interne merker.

## Faktisk
Som i stegene.

## Forslag
Skjul TG-kriteriene for `kind = hms`. Vis kilden kort, og hold de interne merkene i bakgrunnen (regel 7: kilden står i bakgrunnen).

## Etterprøvd
Ikke etterprøvd (forbedring). Slått sammen fra to små forbedringer.

## Logg
- 2026-11-18: funnet
