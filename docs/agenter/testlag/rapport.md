# Rapport fra testlaget

**Kjøring 13.11.2026.** Det som er nytt siden 12.11 ble prøvd: Microsoft-innloggingen, Byggcon-profilen og hopplenken, reglene og malen for badet, etasjer og rom, og dokumentene. Fem testere: takstmann, kontor, robusthet, fag og dokumentvakt. Hovedløkken og nattløkken er begge slått på.

## Hva er prøvd
Bygninger, etasjer, areal og rom på iPad-størrelse og PC. Kontorets flyt fra ordre til fakturert, parter, reklamasjon og avtaler. Innlogging med Microsoft og kode, også med feil og avbrudd. Tilgang for kontor, leder og annen organisasjon. Badreglene med 85 testsaker og 21 egne grensetilfeller. Om planen og beslutningene stemmer med det som er bygget. Badet har ingen skjerm ennå, så TG, avvik, publisering og PDF er bare prøvd i data.

## Hva virker
- **Tre funn fra forrige gang er rettet og lukket:** kjeller får riktig etasje og «under terreng» (T-0010), kryperom og uinnredet loft regnes ikke som BRA (T-0016), og reglene kan si «ikke vurdert» når data mangler (T-0015).
- **Microsoft-innloggingen er trygg:** feil, avbrudd og forsøk på å lure den sender tilbake til innloggingen med en norsk melding. Ingen persondata i loggen. En ansatt som er tatt bort, kommer ikke inn.
- **Badreglene følger Ståles svar:** grensene for alder og fukt slår til der de skal, og manglende data gir «ikke vurdert», aldri et stille nei.
- **Tilgang holder,** og kontorets arbeid virker. Profilen gir store nok trykkflater og ingen sidelengs rulling på iPad.

## Hva virker ikke (viktigst først)
1. **Valg i nedtrekkslister hopper tilbake etter en feilmelding, og feil verdi blir lagret uten varsel** (alvorlig, T-0050). Gjelder areal (målemetode, målt av), eiendom (boligtype, eierform), reklamasjon (forsikringskrav blir lagret som reklamasjon), parter og avtaler. Feil kan havne i rapporten. Rettes før neste nye punkt.
2. **Planen har mistet Ståles beslutninger fra 12.11** om live diktat og KI-briller som strekkmål 6 (T-0052). En senere endring skrev over dem.
3. **Valget «Ukjent (byggeåret for bygningen brukes)» gjør ikke det det lover.** Et gammelt bad med ukjent alder får ikke TG3-forslaget (T-0051).
4. **To ting i badmalen kan gi en rapport som sier imot seg selv:** «utført uten funn» sammen med forhøyet fukt (T-0059), og «må» i tiltaket når TG2 velges (T-0060).
5. **Rommene følger ikke etasjen** når den endres til eller fra «under terreng», og «1. etasje» gir ikke alltid etasjenummer 1 (T-0053, T-0054).
6. **Dokumentene henger etter:** endringsloggen er ikke ryddet (T-0021, forsøk 2), planen har en gammel linje om fukt i bad (T-0003), og flere grunndokumenter er ikke oppdatert etter 12.11.

I tillegg kom 12 små ting, blant annet at en ansatt kan endre sitt eget visningsnavn utenom admin (T-0057).

## Tall
| Nye funn | Åpne | Lukket |
|---|---|---|
| 19 (1 alvorlig, 4 middels, 14 små) | 61 (1 alvorlig, 19 middels, 41 små) | 3 |

En uavhengig kontrollør gjenskapte de alvorlige og middels funnene. Seks rettede funn ble prøvd på nytt: tre er lukket, T-0014 er fortsatt delvis rettet, og T-0003 og T-0021 er fortsatt feil.

**Ikke bekreftet:** ingen. Ett funn om etasjenummer ble dømt «ikke feil» (det står slik i oppgavekortet), og er tatt som forbedring (T-0054).

**Til Ståle:** ingen nye forslag. Fire nye spørsmål til fagrådet (nr. 78 i `docs/09-apne-sporsmal.md`). 18 nye rader (A200–A238) i `docs/agenter/testlag/beslutninger-til-staale.md`.

## De tre viktigste tingene
1. **Rett nedtrekkslistene** (T-0050), så det den ansatte valgte, faktisk blir lagret.
2. **Før live diktat og strekkmål 6 tilbake i planen** (T-0052), så fase 2b bygges slik Ståle vil.
3. **Før «Badet på PC»:** byggeår når alderen er ukjent, motstriden om fukt, og «bør» ved TG2 (T-0051, T-0059, T-0060).

Sist kjørt på commit: e013fde7
Dato: 13.11.2026
