# Rapport fra testlaget

**Kjøring 24.11.2026.** Det som er nytt siden 18.11 ble prøvd: «KI i veien» på badet, det vil si forslag til tekst i avviket, språkvask og utkast til sammendrag. Seks testere: takstmann, kontor, robusthet, fag, KI og dokumentvakt. Begge rutinene, hovedløkken og nattløkken, er slått på.

## Hva er prøvd
Badet på iPad og PC med forslag til avvik, årsak, konsekvens og tiltak, språkvask, utkast til sammendrag, og uten nett. Kontor og leder: nytt oppdrag fra bestilling, status, søk, endringer, sammenslåing av kontakter, reklamasjon og tilbud. Dobbelttrykk, to faner, tapt svar, utløpt innlogging, annen organisasjon og 72 avvik på ett bad. Sammendraget mot forskriften, og om dokumentene stemmer.

## Hva virker
- **Raskt:** avvik fra malen 3 trykk, forslag til tekst 2 trykk (listen kommer på 0,2 sekunder), språkvask 2 trykk, sammendrag 2 trykk.
- **KI setter aldri TG.** Koden lager overskriftene i sammendraget, TG3 først, og KI får aldri vite TG. Utkastet overskriver aldri takstmannens tekst; bare «Bruk» lagrer, og «Angre» gir teksten tilbake.
- **Persondata går ikke til KI:** navn, telefon og e-post byttes ut før KI, og takstmannen ser sine egne verdier.
- **Tilgang holder:** kontoret ser badet bare til lesing, og andre organisasjoner får nei.
- **Lukket:** KI-svar som endrer TG, stoppes nå (T-0046). Eksemplene som KI prøves mot, måler nytte (T-0047). Tomme felt sendes ikke til KI (T-0111). Den gamle prøvesiden er fjernet (T-0035).

## Hva virker ikke (viktigst først)
**Ingen alvorlige feil i denne kjøringen.** Ni middels:
1. **Kontrollen av KI-svar har hull.** Den ser ikke at to TG-er bytter plass, eller TG skrevet med romertall eller ord (T-0132). Den ser heller ikke at en måling forsvinner, at mm blir cm, eller at «bør» blir «må» (T-0144).
2. **Sammendraget stoppes hver gang takstmannen selv har skrevet «ikke undersøkt»** eller en TG i et funn, og meldingen gir KI skylden (T-0131).
3. **Går svaret tapt, står det «Ingenting er lagret» selv om teksten er lagret.** Nytt trykk gir samme tiltak to ganger (T-0133).
4. **Advarselen om tekst fra feil TG forsvinner** når man bytter punkt, og telles ikke i «Å se over» (T-0135).
5. **Sammendraget varsler ikke når et TG3-avsnitt er slettet,** så lenge punktets navn står et annet sted (T-0145).
6. Skjermleseren sier «brukt» når det feilet (T-0134). Forslag uten nett gir «Ingen treff» når feltet har tekst (T-0146). Søket finner ikke oppdraget etter sammenslåing av kontakter (T-0149).

I tillegg 11 mindre ting, blant annet at feltet ikke viser at teksten kom fra KI, og feil i dokumentene.

## Tall
| Nye funn | Åpne | Lukket |
|---|---|---|
| 20 (0 alvorlige, 9 middels, 11 små) | 134 (0 alvorlige, 46 middels, 88 små) | 4 |

En uavhengig kontrollør gjenskapte de sju feilene som ble etterprøvd (middels og oppover). De små feilene er ikke etterprøvd. **Ikke bekreftet:** ingen.

**Til deg:** fem forslag fra testlaget (nr. 106–110 i spørsmålsfilen), blant annet at forslag med samme TG som avviket står øverst. Fem spørsmål til fagrådet (nr. 105), blant annet om KI skal stoppes når «bør» blir «må». Ni nye rader i listen over dyre beslutninger, blant annet hva sammendraget tar med. Når ekte KI slås på, bør det prøves at telefonnumre og navn ikke bytter plass når KI flytter om på setninger.

## De tre viktigste tingene
1. **Tett hullene i kontrollen av KI-svar før ekte KI slås på** (T-0132, T-0144, T-0131), og svar på spørsmål 103 og 105.
2. **Det som er lagret, må vises riktig:** riktig melding når svaret går tapt, og advarselen om feil TG skal stå til den er sett (T-0133, T-0135).
3. **Spectora Advanced:** fristen for å slå av abonnementet (ca. 23.11.2026) er passert. Bare du kan gjøre det (T-0002).

Sist kjørt på commit: 01fc9e4c
Dato: 24.11.2026
