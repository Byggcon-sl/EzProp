---
id: T-0096
tittel: Beslutning A251, A287, A288 og A323 er ikke merket som endret av senere beslutninger
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-dokumentvakt
omrade: dokumenter (beslutninger)
maal: reklamasjoner
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Fire beslutninger sier fortsatt det gamle, selv om senere beslutninger har endret dem. En agent som leser A251, kan lese bestilleren fra tilbudet (ordren) i stedet for fra oppdraget, mot ADR 0011.

## Slik gjenskapes det
1. Les A251 i `docs/09-apne-sporsmal.md` («Bestilleren leses alltid fra ordren») og sammenlign med A292 og A293 (oppdraget eier bestillingen).
2. Les A288 (varsel bare etter lagring) mot A297 (varselet hentes før lagring).
3. Les A287 mot A325 («Endrer A287») og A323 mot A361 («Endrer A323»).

## Forventet
Den gamle raden er merket «Endret av Axxx (dato)», slik A224 og A226 er.

## Faktisk
Radene er ikke merket.

## Forslag
Merk de fire radene. Fast del av læringsløkken: når en ny rad sier «Endrer Axxx», merkes Axxx i samme PR. A285 hører til T-0072. A320 er ingen motsigelse (ADR 0012 punkt 4 valgte det A320 sier).

## Etterprøvd
2026-11-17, bekreftet for A251, A287, A288 og A323, satt ned til lite (som T-0068).

## Logg
- 2026-11-17: funnet
- 2026-11-18: også A350 (main 50fad3e4): A350 sier at KI-målkoden for avviksteksten er `description`, men er ikke merket «Endret av A356». Se også T-0124.
