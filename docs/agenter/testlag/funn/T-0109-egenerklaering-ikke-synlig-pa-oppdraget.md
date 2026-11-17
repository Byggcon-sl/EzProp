---
id: T-0109
tittel: «Egenerklæring mottatt» kan verken ses eller settes på oppdraget
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-kontor
omrade: oppdrag (bestilling)
maal: reklamasjoner
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Nesten alle bestillinger lages nå rett som oppdrag. Kontoret kan ikke se eller krysse av for at egenerklæringen er mottatt på oppdraget, så det må holdes rede på utenfor EzProp. For oppdrag fra et tilbud blir verdien med, men vises ikke.

## Slik gjenskapes det
1. Som kontor: åpne et tilbud, kryss av «Egenerklæring mottatt» og lagre.
2. Velg kontor og «Gjør om til oppdrag».
3. Se kortet «Bestilling» og «Endre bestillingen» på oppdraget.
4. Åpne «Nytt oppdrag».

## Forventet
Kontoret kan se og registrere om egenerklæringen er mottatt, på oppdraget.

## Faktisk
Verdien er lagret på oppdraget, men vises ikke, og skjemaene har ikke feltet.

## Forslag
Vis «Egenerklæring mottatt: Ja/Nei» i «Bestilling», og ha avkrysningen i «Endre bestillingen». A316 sier selv at feltet legges inn hvis kontoret trenger det.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-17: funnet
