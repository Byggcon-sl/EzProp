---
id: T-0106
tittel: Rettes adresse eller matrikkel i bestillingen etter at eiendommen er lagret, viser oppdraget to ulike adresser uten varsel
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-17
rolle: test-takstmann, test-kontor
omrade: oppdrag (bestilling og eiendom), arbeidskø
maal: reklamasjoner
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Retter kontoret eller takstmannen adressen eller matrikkelen under «Endre bestillingen» etter at eiendommen er lagret, endres bare bestillingen. Eiendommen og arbeidskøen viser fortsatt den gamle adressen, og ingenting sier fra. Feil adresse og matrikkel kan komme i rapporten.

## Slik gjenskapes det
1. Lag et oppdrag med «Testlagveien 17, 8006 Bodø», gnr 917, bnr 17, og lagre eiendommen.
2. «Endre bestillingen»: rett adressen til «Testlagveien 19, 8006 Bodø» og bnr til 19. Lagre.
3. Se kortet «Eiendom».
4. Åpne arbeidskøen og søk «Testlagveien 19».

## Forventet
Oppdraget sier tydelig fra når bestilling og eiendom har ulik adresse eller matrikkel, og tilbyr å oppdatere eiendommen med ett trykk. Ingen automatisk overskriving.

## Faktisk
Bestillingen viser nr. 19, eiendommen nr. 17, uten varsel. Søket på «Testlagveien 19» gir et kort med «Testlagveien 17».

## Forslag
Varsel på oppdraget når adresse, gnr, bnr eller snr i bestillingen er ulik eiendommens, for eksempel «Adressen i bestillingen er endret. Kontroller eiendommen.» med knappen «Bruk i eiendommen». Kontrollen før publisering bør ta det med.

## Etterprøvd
Ikke etterprøvd (forbedring). Meldt uavhengig av to testere (TM-3 og KO-1); slått sammen hit.

## Logg
- 2026-11-17: funnet
