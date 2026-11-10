# Testlaget

Sist oppdatert: 10.11.2026
[Kilde: Ståle i chat 10.11.2026: «Siden jeg er flaskehalsen, sett på underagenter som tester systemet og validerer. Lag et autonomt system med flere agenter som har forskjellige roller, de tester og validerer samt kommer med tilbakemeldinger, som kan være feilrettinger eller forbedringer.»]

## Hva det er

Testlaget er agenter som bruker EzProp slik de ansatte kommer til å bruke det, hver med sin rolle. De prøver det som er bygget og merget, slik at Ståle ikke må teste hver leveranse selv. Det de finner, blir retteoppgaver, forbedringer eller forslag.

Testlaget er løkke G i `docs/11-agentlaget.md`. Arbeidsflyten er `.claude/workflows/testlag.js`.

## Rollene

| Rolle | Hvem den er | Ser etter |
|---|---|---|
| `test-takstmann` | Erfaren takstingeniør med dårlig tid, på iPad og PC | Hele arbeidsflyten, antall trykk, det som er tungvint, om KI-forslagene hjelper |
| `test-kontor` | Kontoret og lederen på PC | Ordre, oppdrag, parter, avtaler, status, admin, statistikk, og at hver rolle bare ser sitt |
| `test-ny-ansatt` | Nyansatt uten opplæring | Om skjermer, tekster og feilmeldinger er til å forstå. Klarspråk og universell utforming. |
| `test-fag` | Fagkontrolløren, en streng sidemann | Mal, TG-regler, grenser, sperrer, avvikstekster og PDF mot forskriften og Ståles beslutninger |
| `test-ki` | KI-kontrolløren | At KI ligger i bunnen: forslag, logg, vask av persondata, aldri TG, aldri sending. Treffprosent mot evalueringssettene. |
| `test-robusthet` | Den som prøver å ødelegge | Uten nett, dobbelttrykk, to faner, utløpt innlogging, feil rolle, annen organisasjon, personvern |
| `test-dokumentvakt` | Den som passer på dokumentene | At planen, beslutningene, datamodellen og koden stemmer overens |
| `funn-kontrollor` | Uavhengig etterprøver | Gjenskaper hvert funn selv før det blir en oppgave, og prøver på nytt det som er meldt rettet |
| `kvalitetsleder` | Samler og sorterer | Funnfiler, forslag, og rapporten til Ståle |

Alle rollene står i `.claude/agents/`.

## Slik går en kjøring

1. **Klargjør.** Appen bygges fra main, databasen fylles med de fire testoppdragene, og det lages testbrukere. Testlaget finner ut hva som er nytt siden forrige kjøring.
2. **Test.** Testerne prøver hver for seg, samtidig. De ser ikke hverandres arbeid.
3. **Etterprøv.** En kontrollør som ikke har sett hvordan funnet ble gjort, gjenskaper hvert alvorlige og middels funn. Det som ikke kan gjenskapes, blir ikke en oppgave. Funn som er meldt rettet, prøves på nytt.
4. **Sorter.** Kvalitetslederen lager funnfiler, legger ideer som forslag til Ståle, og skriver rapporten. Alt leveres i én PR.

**Hvor ofte:** hver natt prøves det som er nytt siden sist. Er ingenting nytt, avslutter kjøringen med en gang. Natt til søndag kjøres alt, med alle rollene.

## Hva som skjer med et funn

| Slags funn | Hva som skjer |
|---|---|
| **Feil, alvorlig** | Rettes av agentlaget før neste nye punkt i planen (høyst tre per kjøring). Testlaget prøver den på nytt etterpå. |
| **Feil, middels eller liten** | Tas sammen med neste oppgave i samme område |
| **Forbedring** innenfor det planen dekker | Tas sammen med neste oppgave i samme område |
| **Idé** (ny funksjon) | Blir et forslag i `docs/09-apne-sporsmal.md`. Bygges ikke før Ståle har sagt ja. |
| **Spørsmål til fagrådet** | Legges i `docs/09-apne-sporsmal.md` |
| **Ikke gjenskapt** | Nevnes i rapporten. Blir ikke en oppgave. |
| **Rettet tre ganger uten å bli bekreftet** | Flyttes til «Trenger Ståle» i `docs/agenter/tilstand.md` |

Alvorlig betyr: data går tapt, en feil kan havne i en rapport og gi reklamasjon, brudd på tilgang eller personvern, eller noe den ansatte ikke kommer forbi.

## Filene

| Fil | Innhold |
|---|---|
| `rapport.md` | **Rapporten til Ståle.** Skrives på nytt hver kjøring: hva som er prøvd, hva som virker, hva som ikke virker, og de tre viktigste tingene. Høyst én side. |
| `funn/T-0001-kort-navn.md` | Én fil per funn, etter `mal-funn.md`. Status: ny → rettet → lukket. |
| `funn/lukket/` | Funn som er rettet og bekreftet |
| `beslutninger-til-staale.md` | Agentenes beslutninger som er dyre å endre. Lages av dokumentvakten i første kjøring. |
| `mal-funn.md` | Malen for en funnfil |

## Grenser

- Testlaget endrer aldri produktkode, tester eller dokumenter. Bare kvalitetslederen skriver, og bare i `docs/agenter/testlag/`, `docs/09-apne-sporsmal.md` og avsnittet «Oppgaver fra testlaget» i tilstandsfilen.
- Bare den lokale appen og den lokale databasen, med oppdiktede data. Aldri testmiljøet i Azure, aldri ekte kundedata, aldri IVIT, Spectora eller SmartTakst, og ingen e-post eller SMS ut.
- Testlaget bestemmer ikke fag og legger ikke nye funksjoner i planen. Det gjør Ståle.
- Testlaget prøver i Chromium i iPad-størrelse. Det erstatter ikke prøvene på ekte iPad (S2 i planen).
- Ingen varsler til Ståle mens autonom modus er på. Ett unntak: finner testlag-rutinen at hovedløkken eller nattløkken er slått av, sender den ett varsel, fordi utviklingen da står stille uten at noen ser det.

## Kjøre for hånd

Be prosjektlederen kjøre arbeidsflyten `testlag` med `{ "date": "<ÅÅÅÅ-MM-DD>", "scope": "alt" }`. Bare noen roller: legg til `"roles": ["test-fag", "test-ki"]`.
