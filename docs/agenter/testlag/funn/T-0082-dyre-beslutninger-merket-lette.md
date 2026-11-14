---
id: T-0082
tittel: Fire beslutninger som er dyre å endre (A272, A273, A280, A283), er merket «Lett å endre»
type: feil
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-dokumentvakt
omrade: dokumenter (beslutninger)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Oppbevaringstiden for avviste KI-forslag (A272, A273) gjelder personvern og lagres som dato per rad. Kodene for romsett og kilde (A280, A283) står i revisjonsloggen i 10 år og kan ikke endres (regel 6). Likevel står alle fire som «Lett å endre». Ståle kan da hoppe over dem når han går gjennom beslutningene.

## Slik gjenskapes det
1. Les A272, A273, A280 og A283 i `docs/09-apne-sporsmal.md` (linje 268, 271, 288 og 289).
2. Se at `docs/agenter/testlag/beslutninger-til-staale.md` gikk bare til A248.

## Forventet
De fire er merket som dyre å endre, og står i listen over dyre beslutninger.

## Faktisk
Merket «Lett å endre». Listen gikk bare til A248.

## Forslag
Rett merkingen i de fire radene. Listen `beslutninger-til-staale.md` er oppdatert av testlaget 14.11.2026 (A252, A272/A273, A280/A283 og A289); det som står igjen, er merkingen i `docs/09-apne-sporsmal.md`.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-14: funnet
