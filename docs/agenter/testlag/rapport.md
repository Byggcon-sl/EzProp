# Rapport fra testlaget

**Merk:** nattløkken 18.11.2026 kl. 02:17 stoppet etter 13 sekunder fordi bruksgrensen var nådd, så nattens fulle sjekk ble ikke kjørt. Begge rutinene, hovedløkken og nattløkken, er slått på.

**Kjøring 18.11.2026.** Det som er nytt siden 17.11 ble prøvd: badet på PC med forslag fra reglene, papirkurv og angre, rettingen av utløpt innlogging og nett som faller, rydding av innloggingsdata og «Mine innlogginger». Seks testere: takstmann, kontor, robusthet, fag, KI og dokumentvakt.

## Hva er prøvd
Hele badet i to testoppdrag, alle åtte punkter, på iPad og PC. Grensene i reglene (782 regelprøver og 27 egne grensetilfeller). Fjerne og hente tilbake rom, etasjer, bygninger og parter. Utlogging fra andre enheter, og admin som setter en ansatt til «Har sluttet». To faner, dobbelttrykk, uten nett, og forsøk på å se en annen organisasjons data. Vasken før KI og om dokumentene stemmer.

## Hva virker
- **Badet er raskt:** et avvik fra et forslag tar 3 trykk og ingen skriving. Hele badet med tre avvik tok rundt 35 trykk, mot 8–12 trykk per avvik i IVIT.
- **Reglene setter aldri TG selv.** Grensene er som vedtatt, «bør» ved TG2 og «må» ved TG3, alt merket utkast, ingen gjetteord.
- **Papirkurv og angre virker** for rom, etasje, bygning og part, også når flere trykker samtidig.
- **Tilgang og personvern holder:** kontoret ser badet uten å kunne endre, andre organisasjoner får nei, og loggene har verken navn, adresse eller fritekst.
- **Lukket:** nett som faller midt i en lagring gir nå norsk melding, og det som er skrevet, står (T-0071).

## Hva virker ikke (viktigst først)
1. **Fjerner takstmannen avviket fra et godtatt TG3-forslag, står forslaget som «godtatt» uten avvik og uten advarsel** (T-0117). Et TG3-forhold kan falle ut av rapporten.
2. **To avvik for samme funn** når forslaget godtas på ett skjermbilde og endres på et annet (T-0116).
3. **TG kan byttes etter «Godta» uten grunn,** og loggen sier fortsatt «godtatt» (T-0113). Da kan vi ikke forklare graden ved en reklamasjon.
4. **TGIU-opplysningene må skrives to ganger,** og de to stedene kan si ulikt (T-0114).
5. **En ansatt som har sluttet, kan logge inn med kode.** Hen ser ingen data, men innloggingen blir gyldig igjen hvis sluttdatoen angres (T-0118).
6. **Utløpt innlogging sletter fortsatt tekst** når man er logget ut fra en annen enhet, på badet og i «Endre bestillingen» (T-0070, prøvd én gang, og T-0120).
7. **Sperren mot fødselsnummer stopper vanlig tekst** med dato og klokkeslett, beløp eller en rekke målinger (T-0119).

I tillegg 11 mindre ting, blant annet «…» og interne koder i stedet for tall og enheter på skjermen, og en advarsel som aldri går bort.

## Tall
| Nye funn | Åpne | Lukket |
|---|---|---|
| 18 (0 alvorlige, 10 middels, 8 små) | 118 (0 alvorlige, 39 middels, 79 små) | 1 |

En uavhengig kontrollør gjenskapte de middels funnene. To eldre funn er hevet til middels: urimelig byggeår gir ingen advarsel (T-0061), og numrene på beslutninger og spørsmål kolliderer mellom arbeid som pågår (T-0024).

**Ikke bekreftet som nye:** to funn var allerede meldt (T-0061 og T-0024).

**Til deg:** ingen nye ideer. Seks spørsmål til fagrådet (nr. 104 i spørsmålsfilen), blant annet navnet på TG1 og om endring av TG etter «Godta» alltid skal kreve grunn. Tolv nye rader i listen over dyre beslutninger, blant annet at innloggingsdata slettes for godt og at utlogging fra admin gjelder personen i alle organisasjoner.

## De tre viktigste tingene
1. **Et godtatt forslag og avviket må alltid henge sammen** (T-0117, T-0116, T-0113, T-0115), så TG3 ikke faller ut og loggen kan forklare graden.
2. **Den som har sluttet, skal ikke kunne logge inn** (T-0118).
3. **Utløpt innlogging skal aldri slette det som er skrevet** (T-0070, T-0120).

Sist kjørt på commit: 50fad3e4
Dato: 18.11.2026
