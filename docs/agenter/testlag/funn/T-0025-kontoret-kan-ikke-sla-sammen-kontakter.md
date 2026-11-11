---
id: T-0025
tittel: Kontoret kan ikke slå sammen eller fjerne like kontakter, selv om Ståle sier at alle kan endre alt
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt, test-kontor
omrade: kontakter, tilgang
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Kontoret holder kontaktregisteret ved like hver dag, men kan ikke rydde bort doble kontakter. De må be lederen hver gang. Begrensningen (A108) bygger ikke på noe Ståle har sagt; Ståle sa 27.10.2026 at alle kan se og endre alt, med reklamasjonssaker som eneste unntak.

## Slik gjenskapes det
1. Logg inn som kontor og lag to like kontakter.
2. Åpne den ene: knappen «Slå sammen med …» finnes ikke.
3. Gå til `/kontakter/[id]/sla-sammen`: «Fant ikke siden».
4. Les A108 i `docs/09-apne-sporsmal.md`: rettigheten `contacts.manage` gis bare leder og admin, med kilden «oppgaven sier».

## Forventet
Bare reklamasjonssaker er stengt for andre enn leder og admin (CLAUDE.md regel 12).

## Faktisk
Kontoret kan ikke fjerne eller slå sammen kontakter og firma.

## Forslag
Gi `contacts.manage` til kontoret i `permissionsForRole` (lett å endre), og før endringen av A108 i `docs/09-apne-sporsmal.md`. Et varsel om mulig dublett når en kontakt lages, er ny funksjon og er lagt fram som forslag.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-11: funnet
