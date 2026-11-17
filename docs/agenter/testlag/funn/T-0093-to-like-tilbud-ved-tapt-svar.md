---
id: T-0093
tittel: Går svaret tapt når et tilbud lagres, blir det to like tilbud når man trykker Lagre igjen
type: feil
alvor: middels
status: ny
funnet: 2026-11-17
rolle: test-robusthet
omrade: tilbud, nytt oppdrag
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Faller nettet akkurat idet et tilbud lagres, sier appen at det ikke er lagret, men serveren har lagret det. Trykker den ansatte Lagre igjen, blir det to like tilbud. Gjelder «Nytt tilbud» og «Lagre som tilbud i stedet». «Lagre» for oppdrag har allerede vern mot dette.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne «Nytt tilbud» (eller «Nytt oppdrag»).
2. Skriv en adresse.
3. La nettet falle akkurat når svaret skal komme (forespørselen når serveren, svaret når ikke nettleseren).
4. Appen sier «Du er uten nett. Endringen er ikke lagret.», og teksten står igjen.
5. Trykk Lagre (eller «Lagre som tilbud i stedet») igjen når nettet er tilbake.
6. Søk på adressen under Tilbud › Alle.

## Forventet
Ett tilbud, slik «Lagre» på «Nytt oppdrag» gir ett oppdrag.

## Faktisk
To tilbud med samme adresse.

## Forslag
Gi tilbudet samme engangsnøkkel som oppdraget (A298) i både `createOfferAction` og `saveAsOfferAction`.

## Etterprøvd
2026-11-17, bekreftet (middels). Både «Nytt tilbud» og «Lagre som tilbud i stedet» ga to tilbud; oppdraget ga ett.

## Logg
- 2026-11-17: funnet
