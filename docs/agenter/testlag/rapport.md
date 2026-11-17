# Rapport fra testlaget

**Kjøring 17.11.2026.** Det som er nytt siden 14.11 ble prøvd: «Nytt oppdrag» som hovedvei, tilbud i stedet for ordre, testdataene for arbeidshverdagen, og dokumentene. Fem testere: takstmann, kontor, robusthet, KI og dokumentvakt. Fagtesteren var ikke med, fordi ingenting i maler, regler eller rapportutskrift var endret.

## Hva er prøvd
Hele veien fra «Nytt oppdrag» til eiendom, bygning og rom på iPad og PC, som takstmann, kontor og leder. Tilbud: lage, forlenge, avslå og gjøre om til oppdrag. Dobbelttrykk, to faner, uten nett, nett som faller midt i en lagring, og forsøk på å se en annen organisasjons data. KI-vasken av de nye feltene på oppdraget. Om planen og beslutningene stemmer med det som er bygget.

## Hva virker
- **«Nytt oppdrag» er raskt:** 9 trykk og 5 felt fra arbeidskøen til lagret oppdrag på iPad. Uten nett står alt igjen, og ett trykk lagrer når nettet er tilbake. Dobbelttrykk gir ett oppdrag.
- **Tilbud:** fra tilbud til oppdrag tar 5 trykk via varselet om mulig dublett, og to raske trykk eller to faner gir likevel bare ett oppdrag. Avslag med fast grunn, forlengelse og tallene i tilbudslisten virker.
- **Tilgang og skille mellom organisasjonene holder,** også når noen tukler med skjemaene. Ingen adresser eller navn i loggene.
- **KI:** alle nye felt er stengt for KI, og navn, adresse og telefon ble vasket i alle prøvene ende til ende. KI satte aldri TG og sendte aldri noe.
- **Lukket:** valgene i skjemaene hopper ikke lenger tilbake etter en feilmelding (T-0050). Prøvd i 13 skjemaer.

## Hva virker ikke (viktigst først)
1. **Bytter takstmannen romtype på et rom, endres arealtypen han har valgt, uten varsel** (T-0092). Feil areal kan havne i rapporten.
2. **Rettes adressen i bestillingen etter at eiendommen er lagret, viser oppdraget to ulike adresser uten varsel,** og arbeidskøen viser den gamle (T-0106). Meldt av to testere.
3. **Faller nettet idet et tilbud lagres, kan det bli to like tilbud** (T-0093). Oppdrag har vern mot dette, tilbud ikke.
4. **Gårds- og bruksnummer med null foran (077) blir ikke vasket før KI** når de skrives uten null (T-0094). Bare den falske KI-tjenesten er på, så ingenting har gått ut.
5. **Postnummer og sted må skrives på nytt i «Eiendom»** og lagres to ganger (T-0105).

I tillegg 16 små ting, blant annet at ordet «ordre» står igjen noen steder, at egenerklæringen ikke kan ses på oppdraget, og at arbeidskøen åpner på en tom fane.

## Tall
| Nye funn | Åpne | Lukket |
|---|---|---|
| 21 (0 alvorlige, 5 middels, 16 små) | 101 (0 alvorlige, 28 middels, 73 små) | 1 |

En uavhengig kontrollør gjenskapte de middels funnene og prøvde T-0050 på nytt.

**Ikke bekreftet som nye:** to funn om dokumentene var allerede meldt (T-0008 og T-0024). Testerne så at T-0031 og T-0075 ser rettet ut; de lukkes når de er meldt rettet og prøvd.

**Til deg:** ingen nye forslag og ingen nye spørsmål. Elleve nye rader i listen over dyre beslutninger (`docs/agenter/testlag/beslutninger-til-staale.md`), nå gått gjennom til A379. To av dem gjelder personvern: at gammel og ny adresse og bestiller lagres i 10 år når bestillingen på oppdraget endres, og sperren mot fødselsnummer.

**Rutinene** «EzProp hovedløkke» og «EzProp nattløkke» er sjekket og er begge slått på. Ingen varsel sendt.

**Om testlaget selv:** testbrukerne manglet kontor og admin, testdataene for arbeidshverdagen lå ikke i Byggcon lokalt, og KI er av i Byggcon lokalt. Derfor ble forhåndsvalgt kontor, admin-skjermene og KI-kortet i nettleseren ikke prøvd denne gangen.

## De tre viktigste tingene
1. **Arealtypen skal stå som takstmannen valgte** når romtypen byttes (T-0092).
2. **Oppdraget skal si fra når bestilling og eiendom har ulik adresse** (T-0106), så feil adresse ikke havner i rapporten.
3. **Vasken før KI må ta alle skrivemåter av matrikkel og navn** (T-0094, T-0110) før ekte KI slås på.

Sist kjørt på commit: 2dc573c0
Dato: 17.11.2026
