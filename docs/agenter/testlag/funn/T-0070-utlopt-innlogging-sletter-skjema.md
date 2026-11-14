---
id: T-0070
tittel: Utløpt innlogging midt i et skjema sletter det som er skrevet
type: feil
alvor: middels
status: ny
funnet: 2026-11-14
rolle: test-robusthet
omrade: innlogging, alle skjemaer
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Går innloggingen ut mens den ansatte fyller ut et skjema, sendes han rett til innloggingen når han trykker Lagre. Det han skrev, er borte, og etter innlogging havner han i arbeidskøen i stedet for der han var.

## Slik gjenskapes det
1. Logg inn som takstmann, åpne en ordre og trykk «Endre ordren».
2. Skriv noe i «Borettslag eller sameie» og kryss av «Egenerklæring mottatt».
3. La innloggingen gå ut (slett informasjonskapslene, eller trykk «Logg ut» i en annen fane).
4. Trykk Lagre.
5. Det samme skjer med «Legg til flere rom» og «Lagre eiendom».

## Forventet
Det som er skrevet, står igjen med meldingen «Du er logget ut. Logg inn igjen.», eller innloggingen sender tilbake til samme side.

## Faktisk
Rett til `/logg-inn` uten adresse å gå tilbake til. Alt som er skrevet, er borte. Etter innlogging havner man i arbeidskøen. Ordren er ikke endret. `requireActor` i `src/core/auth/session.ts` sender til innlogging uten neste side, og `safeNextPath` godtar bare arbeidskøen og testskjemaet.

## Forslag
Når lagringen mangler innlogging: gi tilbake skjemaet med verdiene og en melding. I tillegg, eller i stedet: send til `/logg-inn?neste=<side>`, og la `safeNextPath` godta alle interne sider.

## Etterprøvd
2026-11-14, bekreftet (middels). Ikke duplikat.

## Logg
- 2026-11-14: funnet
