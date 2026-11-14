---
id: T-0081
tittel: Unntaket for Byggcons fraser (Ståle 13.11) står bare i regel 7, ikke i forbudslistene
type: feil
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-dokumentvakt
omrade: dokumenter (CLAUDE.md og agenter), fraser
maal: KI i bunnen
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Ståle sa 13.11.2026 at Byggcons fraser i SharePoint, også fra IVIT-malene, skal inn i frasebanken gjennom importen i admin. Forbudslistene sier fortsatt «aldri tekst fra IVIT» uten unntak. En agent kan da stoppe eller avvise importen av frasene, som planen krever.

## Slik gjenskapes det
Les forbudene og se at unntaket mangler:
- `CLAUDE.md` linje 99 («Ikke gjør»)
- `docs/11-agentlaget.md` linje 57
- `.claude/agents/fagansvarlig.md` linje 13
- `.claude/agents/utvikler.md` linje 23
- `.claude/agents/test-fag.md` linje 17
Sammenlign med regel 7 i CLAUDE.md og planen linje 196–197.

## Forventet
Forbudene viser til unntaket: Byggcons fraser legges inn som data gjennom importen, aldri i kode, seed-data eller repoet.

## Faktisk
Unntaket står bare i regel 7.

## Forslag
Legg en kort henvisning til unntaket i hvert forbud. CLAUDE.md endres av prosjektlederen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-14: funnet
