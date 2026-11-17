---
id: T-0095
tittel: Er tilbudet allerede gjort om eller avslått, står siden fortsatt som «Åpent» uten lenke til oppdraget
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-robusthet
omrade: tilbud
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Har noen andre (eller den ansatte selv i en annen fane) allerede gjort om eller avslått tilbudet, kommer meldingen «Tilbudet er allerede gjort om eller avslått.», men siden viser fortsatt «Åpent» og knappene. Den ansatte må laste siden på nytt for å finne oppdraget. Ingenting blir dobbelt.

## Slik gjenskapes det
1. Lag et tilbud og åpne det i to faner.
2. Trykk «Gjør om til oppdrag» i begge, eller avslå i den ene og gjør om i den andre.
3. Se på siden i fanen som tapte.

## Forventet
Siden viser den nye statusen («Gjort om til oppdrag» med lenke til oppdraget, eller «Avslått»).

## Faktisk
Rød melding, men merket sier «Åpent» og knappene står. Etter omlasting vises riktig status.

## Forslag
Last siden på nytt når tilbudet allerede er behandlet, og vis «Gå til oppdraget» når det er gjort om. Gjelder både omgjøring og avslag (`src/app/(ansatt)/tilbud/actions.ts`).

## Etterprøvd
2026-11-17, bekreftet, satt ned fra middels til lite: meldingen er tydelig, ingenting blir dobbelt, og omlasting viser riktig status.

## Logg
- 2026-11-17: funnet
