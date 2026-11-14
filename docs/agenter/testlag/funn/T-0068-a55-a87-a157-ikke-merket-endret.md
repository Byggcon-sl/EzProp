---
id: T-0068
tittel: Beslutning A55, A87 og A157 er ikke merket som endret av Ståle 12.11
type: feil
alvor: lite
status: delvis rettet
funnet: 2026-11-13
rolle: test-dokumentvakt
omrade: dokumenter (beslutninger)
maal: de ansatte
commit: e013fde7
forsok: 0
pr: PR #<nr> (13.11.2026, A157-delen)
---

## Hva
Ståle sa 12.11.2026 at kontoret alltid skal kunne rette en ordre (T1), og at oppbevaringstiden for avviste KI-forslag blir en innstilling (K7). A55 og A87 sier fortsatt at en ordre ikke kan endres, og A157 sier 10 år fast. En agent som leser A55, kan avvise retting av ordre.

## Slik gjenskapes det
1. Les planen linje 142 («Endrer A55 og A87») og 146 («Endrer A157»).
2. Les A55, A87 og A157 i `docs/09-apne-sporsmal.md`.
3. Sammenlign med A224 og A226, som er merket «Erstattet av» eller «Bekreftet av Ståles svar».

## Forventet
A55, A87 og A157 er merket «endret av Ståle 12.11.2026» (T1, K7), med kilde.

## Faktisk
Radene sier det gamle.

## Forslag
Legg en kort merknad på de tre radene nå. Selve endringen gjøres når T1 og K7 bygges. Raden for A157 i `beslutninger-til-staale.md` er rettet av testlaget i denne kjøringen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-13: funnet
- 2026-11-13: A157-delen rettet i PR #<nr> (branch `ki-oppbevaring-avviste`, K7): A157 har merknaden «Oppbevaringstiden endret av Ståle 12.11.2026 (K7), se A272.», og A272–A275 er ført. A55- og A87-delen (T1) står åpen og hører ikke til K7.
- 2026-11-14: dokumentvakten så at A55 og A87 nå er merket «Endret av Ståle 12.11.2026 (T1)» (`docs/09-apne-sporsmal.md` linje 94 og 159). Funnet ser helt rettet ut, men er ikke etterprøvd av kontrolløren. Status står fortsatt «delvis rettet».
