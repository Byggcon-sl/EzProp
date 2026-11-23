---
id: T-0024
tittel: Tilstandsfilen har utdaterte og doble linjer
type: feil
alvor: middels
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
- 2026-11-17: fortsatt åpent (main 2dc573c0). Filen har 6917 ord (6465 forrige gang), og «Gjeldende oppgave» har 24 «Levert»-avsnitt tilbake til 10.11. To tellere for neste A-nummer sier ulikt (linje 5 «nå A328», linje 112 «A419»), og A-numrene har kollidert to ganger denne perioden (A380–A381 og A315–A317). Linje 33 sier «Neste: testdata …», men de er levert; linje 52 sier «S4–S8», men planen har S1–S11. Forslag: én linje «Neste ledige A-nummer: …» og flytt «Levert»-avsnittene til arkivet. Meldt av dokumentvakten som DV-5; kontrolløren dømte det som duplikat av dette funnet.
- 2026-11-18: hevet fra lite til middels (main 50fad3e4). To tellere for neste A-nummer igjen (linje 5: A431, linje 126: A427). Branchene `ki-i-veien`, `publisering-badet`, `reklamasjonskobling` og `rett-vask-for-ki` bruker A419–A430 og spørsmål 88, som alt er tatt på main; noen av dem er dyre beslutninger, så kollisjonene kan blande beslutninger Ståle skal lese. Linje 19 og 20 har både «Levert» og «I arbeid» for Mine innlogginger; linje 38 er utdatert; linje 59 sier «(S4–S8)». Filen er 188 linjer og ca. 60 000 tegn. Meldt av dokumentvakten; dømt som duplikat av dette.
