---
id: T-0094
tittel: Gårds- og bruksnummer med null foran vaskes ikke før KI når de skrives på vanlig måte
type: feil
alvor: middels
status: ny
funnet: 2026-11-17
rolle: test-ki
omrade: KI (vask før KI)
maal: KI i bunnen
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Matrikkel skal aldri sendes til KI (regel 14). Er gårdsnummeret lagret som «077», blir «77/4321» i teksten ikke vasket, og omvendt. Bare samme skrivemåte som er lagret, blir fanget. Lekkasjesjekken merker det heller ikke. Risikoen er liten nå fordi bare den falske KI-tjenesten er på, men det må være rettet før ekte KI slås på.

## Slik gjenskapes det
1. Lag et oppdrag i «Nytt oppdrag» med gårdsnummer «077» og bruksnummer «4321» (skjemaet godtar dette).
2. Be om KI-forslag på teksten «Eiendommen 77/4321.» og «Eiendommen 1804-77/4321.» for oppdraget.
3. Kontroll: lagre gårdsnummer «77» og send «Eiendommen 077/4321.».

## Forventet
Matrikkelen blir [matrikkel] uansett om nullen står foran i det lagrede eller i teksten. Dublettsøket tar allerede bort nuller foran.

## Faktisk
Teksten går urørt til KI-tjenesten. Med ordet «gnr» foran blir det vasket.

## Forslag
Ta bort nuller foran i gnr, bnr, snr og fnr når de kjente verdiene lages, og la mønsteret godta valgfrie nuller foran. Samme i lekkasjesjekken. Testsaker i begge retninger. Stedet i koden: `src/core/ai/redact-text.ts` og `src/core/ai/redaction.ts`.

## Etterprøvd
2026-11-17, bekreftet (middels). «077/4321» ble vasket, «77/4321» og «1804-77/4321» gikk urørt gjennom, og omvendt. Ikke duplikat av T-0044 eller T-0087.

## Logg
- 2026-11-17: funnet
