# Rapport fra testlaget

**Kjøring 12.11.2026.** Det som er nytt siden 11.11 ble prøvd: vask av persondata før KI, KI-køen uten nett, evalueringssettet, koblingen til KI-leverandør, rettingen av synkfeilen og dokumentene. Fem testere: takstmann, kontor, robusthet, KI og dokumentvakt. Hovedløkken og nattløkken er begge slått på.

## Hva er prøvd
KI-prøvesiden med og uten nett på iPad-størrelse og PC, utlogging og innlogging, to faner, dobbelttrykk, lange og rare tekster, 40 skrivemåter av persondata gjennom vasken, tilgang for kontor, leder og annen organisasjon, kontorets hovedflyt fra ordre til oppdrag, og om plan, beslutninger og kode stemmer overens. Kontrollpunkter, avvik, TG, publisering og PDF er ikke bygget ennå.

## Hva virker
- **De tre viktigste feilene fra i går er rettet og lukket:** synken stopper ikke lenger på én endring (T-0001), og KI-kortet sletter ikke lenger egen tekst ved «Bruk» eller «Angre» (T-0004, T-0005).
- **KI uten nett:** ett trykk legger teksten i kø, og forslaget kommer av seg selv når nettet er tilbake. Logger en annen ansatt inn, slettes køen uten å bli sendt.
- **KI i bunnen holder:** én vei inn, alt logges, bare vasket tekst sendes, og ekte leverandør kan ikke slås på ved en feil. Ingen persondata i serverloggen.
- **Tilgang holder:** annen organisasjon ser ingenting, kontoret ser ikke KI, admin eller reklamasjoner.
- **Kontorets arbeid** er ikke ødelagt av endringene.

## Hva virker ikke (viktigst først)
1. **KI-hjelpen kan fjerne målinger fra teksten.** Fire fuktmålinger eller to årstall etter hverandre blir tatt for et telefonnummer. Trykker takstmannen «Bruk», står det «[telefon]» der målingene sto, uten varsel (T-0036). Må rettes før kortet brukes på avviksteksten i badet.
2. **«Logg ut» uten nett gjør ingenting og sier ikke fra.** Den ansatte er fortsatt innlogget, og tekst som venter på KI, blir liggende. På en delt iPad kan han tro at han er ute (T-0037).
3. **Vasken slipper gjennom noen skrivemåter:** «(at)» i e-post, telefon skrevet siffer for siffer, «N-8006 Bodø» og gatenavn som Solsvingen og Granlia (T-0044). Trygt nå fordi bare den falske KI-en finnes. Må tettes før ekte KI.
4. **Ingenting stopper en TG som KI selv legger til** i et forslag. I dag hindres det bare av instruksen til KI (T-0046).
5. **Evalueringssettet viser 100 %, men måler ikke nytte.** Den falske KI-en gjentar bare teksten og består likevel (T-0047). Bør utvides før det brukes penger på en kjøring mot ekte KI.
6. **Dokumentene henger etter igjen:** planen er ikke ryddet etter siste leveranse (T-0021, forsøk 1), og tilstandsfilen har flere doble linjer (T-0024).

I tillegg kom 9 små ting, mest i dokumentene.

## Tall
| Nye funn | Åpne | Lukket |
|---|---|---|
| 14 (0 alvorlige, 5 middels, 9 små) | 46 (0 alvorlige, 20 middels, 26 små) | 3 |

En uavhengig kontrollør gjenskapte T-0036 og T-0037. Fire rettede funn ble prøvd på nytt: tre er lukket, ett er fortsatt feil (T-0021). T-0034 er hevet fra lite til middels.

**Ikke bekreftet:** dokumentvakten meldte at spørsmålene til fagrådet (65–72) ikke står under «Trenger Ståle». Kontrolløren dømte det som duplikat av T-0002, T-0003 og T-0007.

**Til Ståle:** ingen nye forslag eller spørsmål denne gangen. To nye rader (A171 og A193) i `docs/agenter/testlag/beslutninger-til-staale.md`.

## De tre viktigste tingene
1. **Ståle må selv:** slå av Spectora Advanced før ca. 23.11.2026 (ellers koster det penger), og bytte passordene til IVIT, Spectora og SmartTakst (T-0002, åpent siden 11.11).
2. **Før badet bygges (2a-2):** KI-kortet må slutte å bytte målinger med «[telefon]» (T-0036), og svaret om fukt i eldre bad (59a) må avklares (T-0003).
3. **Før ekte KI slås på:** tett hullene i vasken, kontroller svaret for TG, og la evalueringssettet måle nytte (T-0044, T-0046, T-0047, T-0034).

Sist kjørt på commit: 11672aa
Dato: 12.11.2026
