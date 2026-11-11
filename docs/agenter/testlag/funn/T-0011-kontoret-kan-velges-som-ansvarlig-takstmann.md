---
id: T-0011
tittel: Kontoransatte kan velges som ansvarlig takstmann og sidemann, og sertifisering vises ikke
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-kontor, test-fag
omrade: oppdrag (team)
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
I listen over hvem som kan være ansvarlig takstmann, befaringstakstmann og sidemann, står alle ansatte, også kontoret. Ingen ser om personen har gyldig sertifisering før ved publisering. Utstedende selskap settes fra den som velges, så et feiltrykk gir feil selskap på rapporten.

## Slik gjenskapes det
1. Logg inn som kontor (eller takstmann).
2. Lag en ny ordre, gjør den om til oppdrag og åpne oppdraget.
3. Åpne «Ansvarlig takstmann» i kortet «Team»: kontoransatte står i listen. Velg en kontoransatt og lagre.
4. Gjør det samme under «Sidemann».

## Forventet
Ståle 23.10.2026: bare sertifiserte personer kan stå som ansvarlig og signere. Takstmenn står først, og den som ikke er takstmann eller mangler gyldig sertifisering, er merket (advarsel, ikke sperre).

## Faktisk
Alle ansatte står i listene uten merke. Lagringen går gjennom uten varsel, og utstedende selskap settes fra kontoransattes rad.

## Forslag
Filtrer eller sorter kandidatene på rolle i kjernen (`teamCandidates` i `src/core/assignments/assignments.ts`), og vis «mangler gyldig sertifisering» i listen og på oppdraget. Om det skal være advarsel eller sperre, er lagt fram for fagrådet i `docs/09-apne-sporsmal.md`; til svaret kommer: advarsel.

## Etterprøvd
Ikke etterprøvd (forbedring). Meldt av to testere hver for seg.

## Logg
- 2026-11-11: funnet
