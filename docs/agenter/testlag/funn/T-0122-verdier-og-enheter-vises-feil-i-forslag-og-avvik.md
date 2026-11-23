---
id: T-0122
tittel: Forslaget og avvikskortet viser «…» og interne koder i stedet for verdier og enheter
type: feil
alvor: lite
status: ny
funnet: 2026-11-18
rolle: test-fag, test-takstmann, test-ki
omrade: badet, regelforslag, avvikskort
maal: reklamasjoner
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Forslagskortet og «Utfall:» viser «…» der verdiene skulle stått, og avvikskortet viser den interne koden «weight_percent». Enhetene er skrevet ulikt. Det ser uferdig ut, og kan arves av rapporten.

## Slik gjenskapes det
1. Hulltaking «Utført med funn», «Vekt-%», 18,5. Godta som TG2.
2. Se på avvikskortet: «Måling: 18,5 weight_percent».
3. Se på forslagskortet og «Utfall:»: «registrert som fra ….» og «målt til … …. Målested: ….».

## Forventet
«18,5 vekt-%» og verdiene fra feltene i forslaget, slik avviket som lages har dem.

## Faktisk
Interne koder og «…». I tillegg: «Vekt-%» med stor V midt i setningen («16 Vekt-%» havner i avviksteksten), komma til slutt i «Nytt forslag fra reglene: TG0,», og begrunnelsen mangler enhet («Fuktmåling i hullet: 16. Grensen er 15.»). Steder: `deviation-card.tsx` linje 311 og 578, `room-model.ts` linje 132 (`outcomeName`), `src/db/seed/templates/wet-room.ts` linje 507.

## Forslag
Én funksjon for verdi med enhet, brukt i forslag, avvik, begrunnelse og senere PDF. Liten forbokstav for enheten midt i setning.

## Etterprøvd
Intern kode sett også av kontrolløren. Resten er ikke etterprøvd (lite). Slått sammen fra en liten feil og en forbedring.

## Logg
- 2026-11-18: funnet
