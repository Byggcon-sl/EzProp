# Rapport fra testlaget

**Kjøring 11.11.2026.** Første kjøring, så alt som er bygget ble prøvd. Seks testere: takstmann, kontor, robusthet, fag, KI og dokumentvakt.

## Hva er prøvd
Arbeidskøen, oppdrag, ordre, kontakter, team, parter, status og kansellering, bygninger, etasjer og rom, tidsstatistikk, reklamasjon, KI-prøvesiden (språkvask med forslag), testskjemaet uten nett med bilder, tilgang mellom roller og organisasjoner, malmotoren og prøvereglene, og om dokumentene stemmer med det som er bygget. Kontrollpunkter, avvik, TG, publisering og PDF er ikke bygget ennå og ble ikke prøvd.

## Hva virker
- **Tilgang holder.** En annen organisasjon får aldri se data. Kontoret ser ikke reklamasjoner eller admin. Utlogget kommer ingen inn.
- **Ingenting går tapt uten nett** i testskjemaet: to iPader på samme felt, to faner, lukket fane og utløpt innlogging gikk bra.
- **Kontorets arbeid** med ordre, oppdrag, team, parter, status og sammenslåing av kontakter virker, med klare feilmeldinger på norsk.
- **KI:** én vei inn, alt logges, KI kan ikke sette TG og sender ingenting. Forslagskortet er tydelig merket.
- **Reglene** gir samme svar på iPaden og på serveren, også rett på grensen.

## Hva virker ikke (viktigst først)
1. **Alvorlig:** Hvis én endring i testskjemaet ikke kan lagres, blir alt annet som venter, liggende på iPaden for godt, og takstmannen får ikke vite hvilket felt det gjelder (T-0001). Må rettes før den ekte synken på iPad.
2. **KI-kortet kan slette egen tekst:** skriver takstmannen videre og så trykker «Bruk» eller «Angre», forsvinner det nye uten varsel (T-0004, T-0005). Må rettes før kortet brukes på avviksteksten.
3. **Svaret om fukt i eldre bad (59a)** står med ulik mening i planen og strider mot forskriften (T-0003). Fagrådet er spurt.
4. Et bilde over 25 MB prøves sendt for alltid uten forklaring (T-0006).
5. Dokumentene henger etter: resultatene fra prøvene og fagrådet er ikke skrevet ned, og beslutningene fra 10.11 mangler i tabellen over Ståles beslutninger (T-0007, T-0008).
6. **KI i bunnen mangler fortsatt** det som står i planen: tekst vaskes ikke for navn og adresser før KI, og fritekst lagres uvasket i KI-loggen. Det er trygt nå bare fordi bare den falske KI-en finnes. Vasken må være på plass før ekte KI slås på.

I tillegg kom 27 mindre ting og forbedringer, for eksempel at kontoransatte kan velges som ansvarlig takstmann, at endringer på oppdraget kan forsvinne uten varsel, og at «Kjeller» blir 2. etasje.

## Tall
| Nye funn | Åpne | Lukket |
|---|---|---|
| 35 (1 alvorlig, 16 middels, 18 små) | 35 | 0 |

Alle de 10 middels og alvorlige feilene ble gjenskapt av en uavhengig kontrollør. To var like og er slått sammen. Ingen ble avvist.

**Ikke bekreftet:** ingen.

**Til Ståle:** 5 forslag til nye funksjoner og 8 spørsmål til fagrådet står i `docs/09-apne-sporsmal.md` (nr. 60–72). Beslutningene som er dyre å endre, står i `docs/agenter/testlag/beslutninger-til-staale.md`.

## De tre viktigste tingene
1. **Ståle må selv:** slå av Spectora Advanced før ca. 23.11.2026 (ellers koster det penger), og bytte passordene til IVIT, Spectora og SmartTakst nå som kartleggingen er ferdig. Ingen av delene sto i planen eller i listen over det Ståle må gjøre (T-0002).
2. **Synkfeilen** rettes først (T-0001), før neste nye punkt i planen.
3. **Før badet bygges:** svaret om fukt (59a) avklares, og KI-kortet slutter å slette tekst (T-0003, T-0004, T-0005).

Sist kjørt på commit: 0b8e3b9
Dato: 11.11.2026
