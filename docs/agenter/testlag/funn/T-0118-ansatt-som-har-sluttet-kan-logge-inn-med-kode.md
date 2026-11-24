---
id: T-0118
tittel: En ansatt som har sluttet, kan fortsatt logge inn med kode
type: feil
alvor: middels
status: ny
funnet: 2026-11-18
rolle: test-kontor
omrade: innlogging, admin
maal: de ansatte
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Når admin har satt en ansatt til «Har sluttet», kan personen logge inn igjen med engangskode. Hen ser ingen data, men får en misvisende melding, admin ser en aktiv innlogging, og etter «Angre sluttet» gir den gamle innloggingen full tilgang uten ny innlogging.

## Slik gjenskapes det
1. Admin lager en ny ansatt, og den ansatte logger inn.
2. Admin: «Har sluttet» → bekreft. Innloggingen logges ut.
3. Den ansatte logger inn på nytt med kode.

## Forventet
Ingen innlogging (domenemodellen linje 196 og 2062: «Personen kan ikke logge inn»), samme svar som for ukjent adresse.

## Faktisk
Ny innlogging. `/arbeidskoe` viser «Du er ikke registrert som ansatt …». Alt annet gir «Ingen tilgang». Admin ser «1 aktiv innlogging» på en som har sluttet. Etter «Angre sluttet» gir den innloggingen full tilgang. Kode-innloggingen i `src/core/auth/auth.ts` linje 289–301 sjekker ikke `employees.deactivated_at`; Microsoft-innloggingen gjør det (test M3.14). A217 sier bevisst «Engangskoden får ikke sjekken nå», men det strider mot domenemodellen.

## Forslag
Avvis kode-innlogging når personen ikke har en aktiv ansattrad, med samme svar som for ukjent adresse. Integrasjonstest som M3.14. Rettingen må ikke stenge admin ute (regel 11). A217 merkes endret.

## Etterprøvd
2026-11-18, bekreftet (middels). Bevis: test-kontor/bevis-sluttet-kan-logge-inn.txt, 44-*.png og 45-*.png; funn-kontrollor-2/bevis.txt.

## Logg
- 2026-11-18: funnet
