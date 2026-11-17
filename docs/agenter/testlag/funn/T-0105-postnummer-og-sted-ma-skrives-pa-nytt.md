---
id: T-0105
tittel: Postnummer og sted fra bestillingen må skrives på nytt i «Eiendom», og havner to ganger i adressen
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-17
rolle: test-takstmann
omrade: oppdrag, eiendom
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
«Nytt oppdrag» ber om adressen med postnummer og sted i ett felt. Når eiendommen fylles ut fra bestillingen, kommer hele teksten i adressefeltet, mens postnummer og sted er tomme. Takstmannen må skrive dem på nytt, og de blir lagret to ganger. Det kan gi dobbelt postnummer og sted på rapportforsiden.

## Slik gjenskapes det
1. Som takstmann på iPad: «Nytt oppdrag» med adresse «Testlagveien 17, 8006 Bodø», gnr 917, bnr 17, kontor Bodø. Lagre.
2. Se kortet «Eiendom»: adressen er hele teksten, postnummer og poststed er tomme.
3. Skriv 8006 og Bodø, velg boligtype og eierform, og lagre eiendommen.

## Forventet
Postnummer og sted hentes ut av adressen, og adressefeltet får bare gate og nummer. Takstmannen kontrollerer i stedet for å skrive.

## Faktisk
7 trykk på «Eiendom», og lagret adresse «Testlagveien 17, 8006 Bodø» med postnummer 8006 og sted Bodø i tillegg.

## Forslag
Del adressen i gate, postnummer og sted når eiendomsforslaget lages (ved det siste firesifrede tallet), og vis det som forslag som skal kontrolleres. Eller be om de tre feltene hver for seg i «Nytt oppdrag». Begge krever at A73 («adressen deles ikke opp») endres; det er en beslutning agentene tok 05.11, før oppdraget ble hovedveien, og den er lett å endre. Stedet i koden: `propertyFormValues` i `src/app/(ansatt)/oppdrag/[id]/page.tsx`.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-17: funnet
