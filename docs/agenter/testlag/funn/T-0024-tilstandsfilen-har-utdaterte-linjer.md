---
id: T-0024
tittel: Tilstandsfilen har utdaterte og doble linjer
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt
omrade: dokumenter (tilstand)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Tilstandsfilen skal bare si det som gjelder nå, men har småfunn som er tatt og status som er gammel. Agentene kan gjøre arbeid som allerede er gjort.

## Slik gjenskapes det
1. Les «Gjeldende oppgave» i `docs/agenter/tilstand.md`: første punkt sier at småfunnene om `ensureSampleAi` og `recordDecision` står, og tredje punkt sier at PR #131 tok dem med.
2. «Trenger Ståle» sier «etter at PR-en … er merget» om synk-secrets, men PR #129 er merget.
3. «Siste kjøring» sier at «Forslagsmønsteret» er i arbeid hos en annen kjøring, men det er merget.

## Forventet
Filen har bare det som gjelder nå.

## Faktisk
Som i stegene.

## Forslag
Prosjektlederen tar bort det som er tatt, skriver om de to linjene og beholder én «Siste kjøring».

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-11: funnet
- 2026-11-12: flere linjer er kommet til (main 11672aa): «Levert: KI-kø uten nett» står to ganger; «Neste i 2a-1: Beslutningsnotat» er utdatert; linjen om KI-leverandør nevner to brancher; «når PR-en for `fase2a-ki-leverandor` er merget» (den er merget som #154); pekeren «(S4–S8)» tar ikke med resten av S1 (første innlogging og iPad).
- 2026-11-13: flere utdaterte linjer på main e013fde7: «PR åpnet: Småfunn etter svarene i reglene» (merget som #180), og «Ingen åpne PR-er» med gammelt klokkeslett; «Svar også på spørsmål 74 og 75» (besvart, I1 og I2) og «når PR-en `microsoft-innlogging` er merget» (merget som #166); «T-0003 må tas før 2a-2» (regelen er rettet); to linjer som motsier hverandre om T-0021; T-0010 og T-0016 omtalt som lukket før de var etterprøvd. «Gjeldende oppgave» har 17 punkter, de fleste levert historikk.
- 2026-11-14: fortsatt åpent (main a1ca41d9). Tilstandsfilen motsier seg selv: linje 33 og 112 sier ulike ting om hva som er neste; linje 73 «ingen alvorlige» mot linje 74 «1 alvorlig»; linje 75 sier at T-0052 er åpent (det er lukket 14.11); linje 52 viser til «S4–S8» selv om S9 finnes. Filen har 154 linjer, mange over 2 000 tegn. Nytt: linjen om neste ledige A-nummer står to ganger (linje 5 og 6) med ulike tall («nå A284» og «nå A263»), mens høyeste i bruk er A291. Linje 5 sier at A264–A271 er tatt av testdata (branchen `testdata-overtatt` bruker A300–A307) og at A272–A279 er ledige (A272–A275 er brukt til K7). I `docs/09-apne-sporsmal.md` er A264–A271 og A276–A279 hull uten forklaring.
