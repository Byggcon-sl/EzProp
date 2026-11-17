---
id: T-0101
tittel: To dyre beslutninger er merket «lett» (A298, A299), og tre er ikke merket (A315–A317)
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-dokumentvakt
omrade: dokumenter (beslutninger)
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Ståle skal bare trenge å lese de dyre beslutningene. To som er dyre, er merket «Lett å endre», og tre har ingen merking. Han kan da hoppe over dem.

## Slik gjenskapes det
1. Les A298 (engangsnøkkel mot dobbel lagring) i `docs/09-apne-sporsmal.md`: merket «Lett å endre», men er en kolonne med unik indeks.
2. Les A299 (sperre mot elleve sifre): merket «Lett å endre», men gjelder personvern.
3. A315, A316 og A317 har ingen merking.
4. Radene A285–A299 står etter A379, så tabellen er ikke i nummerrekkefølge.

## Forventet
Det som endrer datamodellen eller personvernet, er merket dyrt. Alle rader er merket, og tabellen står i rekkefølge.

## Faktisk
Som i stegene.

## Forslag
Merk A298 og A299 som dyre, merk A315–A317, og sorter tabellen. A298 og A299 er ført i `beslutninger-til-staale.md` av testlaget 17.11.2026. Samme slags feil som T-0082 og T-0023; kan rettes sammen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-17: funnet
