---
id: T-0013
tittel: Lederen kan ikke se hvem som endret status eller kansellerte et oppdrag, og hvorfor
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-kontor
omrade: oppdrag (status)
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Oppgavekortet for statusflyten sier at lederen skal kunne se hvem som endret status, når og hvorfor, for å spore hva som skjedde ved en klage. I dag kan bare admin se grunnen.

## Slik gjenskapes det
1. Som kontor: sett et oppdrag til Fakturert, og så tilbake til Ferdig med grunnen «Fakturert ved en feil».
2. Logg inn som leder og åpne oppdraget: ingen historikk.
3. Åpne `/admin/logg`: «Ingen tilgang».

## Forventet
Som i brukerhistorien i `docs/funksjoner/fase2a-statusflyt.md`: lederen ser hvem som endret status, når og hvorfor.

## Faktisk
Oppdragssiden har ingen historikk, og lederen har ikke tilgang til loggen. Kjernen (`listAuditEvents`) gir lederen lov, men ingen skjerm viser det.

## Forslag
Vis status- og kanselleringshendelsene med grunn på oppdragssiden for leder og admin. Det enkleste er en kort liste nederst på oppdraget.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
