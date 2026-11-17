---
id: T-0107
tittel: Fra tilbud til oppdrag forsvinner befaringstid og kontor, og ansvarlig må velges på nytt
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-takstmann, test-kontor
omrade: nytt oppdrag, tilbud
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Trykker man «Lagre som tilbud i stedet» etter å ha skrevet befaringstid og valgt kontor, blir de ikke med, og ingenting sier fra. Når tilbudet senere gjøres om, får oppdraget ingen ansvarlig og ingen befaring, og det vises ikke under «Mine». Det trengs rundt 6 trykk ekstra.

## Slik gjenskapes det
1. Som takstmann: «Nytt oppdrag», fyll adresse, avtalt befaring 25.11 kl. 10 og kontor Tromsø, og trykk «Lagre som tilbud i stedet».
2. Tilbudet har verken befaring eller kontor. Kvitteringen sier bare «Tilbudet er laget. Gyldig til …».
3. Velg kontor og trykk «Gjør om til oppdrag».
4. Oppdraget har ansvarlig «Ikke satt» og ingen befaring.
5. Trykk lenken «Velg takstmann og befaringsdato». Den hopper til Team, mens befaringen står øverst.

## Forventet
Takstmannen som gjør om tilbudet, er forhåndsvalgt som ansvarlig, slik i «Nytt oppdrag» (A295). Lenken leder til både takstmann og befaring. Det som ikke blir med i tilbudet, sies tydelig.

## Faktisk
Som i stegene.

## Forslag
Sett den innloggede takstmannen som ansvarlig ved omgjøring. La lenken gå til «Befaring og frist». Si ved «Lagre som tilbud i stedet» at befaringstid, kontor og takstmann ikke blir med (hjelpetekst eller kvittering).

## Etterprøvd
Ikke etterprøvd (forbedring). TM-4 og KO-5 er slått sammen hit.

## Logg
- 2026-11-17: funnet
