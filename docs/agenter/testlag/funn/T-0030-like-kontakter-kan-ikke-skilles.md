---
id: T-0030
tittel: Like kontakter kan ikke skilles i søket, og telefonnummer forsvinner ved sammenslåing uten varsel
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-kontor
omrade: kontakter
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
To kontakter med samme navn ser like ut i søketreffene, så kontoret kan velge feil person som bestiller eller part. Ved sammenslåing forsvinner et telefonnummer som bare finnes på kontakten som fjernes, uten at lederen får vite det.

## Slik gjenskapes det
1. Lag to kontakter «Kari Testmegler»: én med e-post og firma, én med bare telefon.
2. På `/ordre/ny`: søk «Kari». Treffene viser bare navn og firma.
3. Som leder: slå dem sammen og behold den med e-post. Bekreftelsen sier «Kari Testmegler fjernes. Oppdrag og ordrer flyttes til Kari Testmegler.»
4. Telefonnummeret er borte, uten varsel.

## Forventet
Treffene viser e-post eller telefon. Sammenslåingen sier hvilken kontakt som fjernes, og advarer når et felt bare finnes på den som fjernes.

## Faktisk
Som i stegene.

## Forslag
Vis e-post (eller telefon) i treffene i `contact-picker.tsx` og i bekreftelsesteksten. Legg til en linje over knappen: «Telefon … finnes bare på den som fjernes. Legg det inn etterpå.»

## Etterprøvd
Ikke etterprøvd (forbedring). To funn er slått sammen.

## Logg
- 2026-11-11: funnet
