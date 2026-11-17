---
id: T-0092
tittel: Bytter man romtype på et rom, overskrives arealtypen takstmannen har valgt, uten varsel
type: feil
alvor: middels
status: ny
funnet: 2026-11-17
rolle: test-takstmann
omrade: bygninger, areal og rom
maal: reklamasjoner
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Når takstmannen bytter romtype under «Endre» på et rom, settes arealtypen til forslaget for den nye romtypen, selv om takstmannen har valgt en annen. Det samme skjer i «Legg til rom» når arealtypen velges før romtypen. Listen ligger under romtypen, så han ser det ikke. Feil areal kan havne i rapporten.

## Slik gjenskapes det
1. Logg inn som takstmann. Under «Bygninger, areal og rom»: lag et rom med romtype Soverom og arealtype BRA-e, og lagre.
2. Trykk «Endre» på rommet. Arealtype viser BRA-e.
3. Bytt romtype til «Kontor eller arbeidsrom». Arealtype hopper til BRA-i uten melding.
4. Trykk Lagre.

## Forventet
Arealtypen som er lagret eller valgt for hånd, blir stående når romtypen byttes, eller det kommer en tydelig melding ved feltet. Forslaget fra romtypen (A97) gjelder bare så lenge arealtypen ikke er rørt.

## Faktisk
Rommet lagres som kontor med BRA-i. «Under terreng» overskrives på samme måte. I «Legg til rom» ble valgt BRA-e lagret som BRA-i etter feilmeldingen «Velg romtype».

## Forslag
Bruk forslaget fra romtypen bare når brukeren ikke har endret arealtypen selv, og rommet ikke er lagret med en annen arealtype. Ellers en kort melding ved feltet («Arealtype endret til BRA-i etter romtypen»). E2e-test for «Endre rom». Stedet i koden: `onRoomTypeChange` i `src/app/(ansatt)/oppdrag/[id]/bygninger/buildings-editor.tsx`.

## Etterprøvd
2026-11-17, bekreftet (middels). Kontrolløren lagret et soverom med BRA-e, byttet romtype under «Endre» og fikk BRA-i uten melding; lagret som kontor/BRA-i. «Under terreng» overskrives også. Ikke samme feil som T-0050 (som er rettet).

## Logg
- 2026-11-17: funnet
