---
id: T-0002
tittel: Listen over det bare Ståle kan gjøre, mangler Spectora-abonnementet med frist og passordbyttet
type: feil
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt
omrade: dokumenter (plan, tilstand)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
To ting som bare Ståle kan gjøre, står ikke i planen eller i tilstandsfilen: Spectora Advanced skal slås av før ca. 23.11.2026 (ellers koster det penger), og passordene til IVIT, Spectora og SmartTakst skal byttes nå som kartleggingen er ferdig. Fordi de ikke står i listene, blir Ståle ikke minnet på dem.

## Slik gjenskapes det
1. Les regel 3 i `docs/07-utviklingsplan.md`: alt bare Ståle kan gjøre, står i S1–S8.
2. Sammenlign med «Trenger Ståle når han er tilbake» i `docs/agenter/tilstand.md`.
3. Les `docs/kartlegging/LES-MEG-kartlegging.md`, «Neste steg» (linjen om Spectora Advanced) og avsnittet «Testdata» (linjen om passord).
4. Søk etter «Spectora Advanced» og «passord» i planen og tilstandsfilen: ingen treff.

## Forventet
Alt som bare Ståle kan gjøre, står i S-listen eller har en henvisning derfra. Ting med frist og pris står øverst.

## Faktisk
Spectora Advanced (frist ca. 23.11.2026, koster penger) og passordbyttet står bare i kartleggingen. I tillegg står nøkkelboksen, e-post via Microsoft 365, fillagring i Azure, rydding av synk-secrets og personvernspørsmålene 54–58 bare i tilstandsfilen. Planen viser dit, så den delen er mindre viktig. S1–S3 er gjort, men står fortsatt i listen.

## Forslag
Legg Spectora Advanced (med frist) og passordbyttet inn som nye S-punkter øverst, og under «Trenger Ståle» i tilstandsfilen. La S-listen henvise til resten i tilstandsfilen, og ta ut S1–S3.

## Etterprøvd
2026-11-11, bekreftet (middels). Kontrolløren fant ingen treff på Spectora Advanced eller passordbyttet i planen eller tilstandsfilen. De andre punktene står bare i tilstandsfilen.

## Logg
- 2026-11-11: funnet
- 2026-11-12: fortsatt åpent. Spectora Advanced må slås av før ca. 23.11.2026 og står fortsatt ikke under «Trenger Ståle». Dokumentvakten meldte også at spørsmålene til fagrådet (65–72) ikke har henvisning fra «Trenger Ståle»; kontrolløren dømte det som duplikat av dette funnet (se også T-0003 og T-0007).
