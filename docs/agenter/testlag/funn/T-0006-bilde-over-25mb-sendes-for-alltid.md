---
id: T-0006
tittel: Et bilde over 25 MB prøves sendt om og om igjen, uten at takstmannen får vite hvorfor
type: feil
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-robusthet
omrade: bilder uten nett (testskjema)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Et bilde som er for stort, kommer aldri fram, men appen prøver å sende det hvert tiende sekund og sier bare «Venter: 1 bilde». Takstmannen får ikke vite at bildet er for stort, og hvert forsøk kan sende hele filen over mobilnett.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne et nytt testskjema på `/prove/testskjema`.
2. Velg et JPEG-bilde på over 25 MB (for eksempel 8000 x 6000 punkter med støy) i «Forsidebilde».
3. Vent 30–40 sekunder.

## Forventet
Takstmannen får beskjed om at bildet er for stort, eller appen lager en mindre kopi som kan sendes. Appen slutter å prøve når serveren har sagt at filen er for stor.

## Faktisk
`PUT /api/prove/bilder/[id]` gir 413 om og om igjen (11–14 forsøk på ca. 40 sekunder). Statuslinjen står på «Venter: 0 endringer, 1 bilde» uten forklaring. Bildet kommer aldri fram. Bildet ligger trygt på iPaden.

## Forslag
Behandle 413 som endelig feil for bildet i `src/modules/offline-trial/sync/photo-uploader.ts`: vis «Bildet er for stort (over 25 MB)» ved feltet og stopp nye forsøk. Vurder å skalere ned originalen før opplasting når den er over grensen. Tas med i den ekte bildeopplastingen i 2a-3 og 2b.

## Etterprøvd
2026-11-11, bekreftet (middels). Kontrolløren brukte et bilde på 95 MB: 413 fra serveren 14 ganger på 42 sekunder, og statusen forklarte ingenting. Middels fordi bildet ikke går tapt.

## Logg
- 2026-11-11: funnet
