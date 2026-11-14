---
id: T-0075
tittel: Teksten «Eiendom og bestiller på oppdraget endres på oppdraget» stemmer ikke
type: feil
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-kontor
omrade: ordre og oppdrag (T1)
maal: reklamasjoner
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Når kontoret endrer en ordre som er gjort om til oppdrag, sier skjemaet at oppdraget ikke endres og at bestilleren endres på oppdraget. Men oppdraget endres (avtaleforslaget forsvinner), og oppdragssiden har ikke noe felt for bestilleren.

## Slik gjenskapes det
1. Som kontor: finn en ordre som er gjort om, med bestiller koblet til en kontakt i et firma med avtale.
2. Åpne oppdraget: det står «Forslag: <avtale> (bestilleren er fra …)».
3. På ordren: «Endre ordren». Teksten sier at oppdraget ikke endres, og at bestilleren endres på oppdraget.
4. Trykk «Fjern kobling» og lagre.
5. Åpne oppdraget igjen.

## Forventet
Det vises tydelig hva som gjelder (oppgavekortet).

## Faktisk
Avtaleforslaget er borte fra oppdraget, altså endres oppdraget. Oppdragssiden viser ingen bestiller og har ikke noe felt for å endre den. Eiendomsskjemaet på oppdraget følger også ordren til eiendommen er lagret.

## Forslag
Skriv for eksempel: «Bestilleren på ordren gjelder for oppdraget. Eiendommen på oppdraget følger ordren til den er lagret der, og endres deretter bare på oppdraget.» Vis gjerne bestilleren som lesefelt på oppdragssiden.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-14: funnet
