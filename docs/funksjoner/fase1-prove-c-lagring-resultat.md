# Prøve C – lagring i Safari: protokoll og resultat

- **Oppgavekort:** `docs/funksjoner/fase1-prove-c-lagring.md`. Testplan: `docs/funksjoner/fase1-prove-c-lagring-testplan.md`.
- **Plan:** `docs/07-utviklingsplan.md` fase 1, prøve C (tabellen «Plan for prøvene» i `docs/funksjoner/fase1-testskjema.md`).
- **Status:** mal, ikke kjørt.
- **Fylles ut av:** Ståle, på ekte iPad, når han er tilbake.
- **Dato kjørt:** ____________ (C3 går over minst 7 dager: skriv startdato og sluttdato der).
- **Støtter hovedmål:** **Færre reklamasjoner.** Prøven viser at det takstmannen har registrert på stedet, ligger trygt på iPaden til det er synket: etter omstart, etter 7 dager uten bruk og når plassen er brukt opp. Ingenting skal forsvinne uten at han får beskjed. Resultatet er også grunnlaget for valget av synkløsning i ADR-en.

**Ekte omstart, 7 dager uten bruk og full plass kan ikke testes automatisk i nettleseren. Derfor gjøres de her på ekte iPad.**

Det som kan testes automatisk (målingen, varselet om lite plass, meldingen når lagring feiler, og at data overlever at siden lukkes), er allerede dekket av testene i `e2e/fase-1-prove-c-lagring.spec.ts`.

## Før du starter

Bare oppdiktede data. Ingen ekte adresser, navn eller bilder av ekte boliger i skjemaet.

| Oppsett | Fyll ut | OK |
|---|---|---|
| iPad-modell (Innstillinger → Generelt → Om → Modellnavn) | | [ ] |
| iPadOS-versjon (Innstillinger → Generelt → Om → iPadOS-versjon) | | [ ] |
| Safari-versjon (følger iPadOS-versjonen) | | [ ] |
| Ledig plass på iPaden før prøven (Innstillinger → Generelt → iPad-lagring, tallet øverst) | ______ GB ledig av ______ GB | [ ] |
| Appen er lagt på hjemskjermen (i Safari: Del → Legg til på Hjem-skjerm), og åpnes **fra hjemskjermen** | ja / nei | [ ] |
| Versjon i `/api/helse` (må være den som har prøve C eller nyere) | | [ ] |
| Stedstjenester for Safari er slått av (Innstillinger → Personvern → Stedstjenester → Safari → Aldri) | ja / nei | [ ] |

**Slik bytter du kandidat:** åpne listen «Testskjema» med nett, trykk på «PowerSync», «ElectricSQL» eller «Egenbygd» under «Synkløsning». Siden lastes på nytt. Trykk «Nytt testskjema» og åpne det, så ligger appen og skjemaet klart på iPaden før du slår på flymodus.

**Slik ser du at noe er synket:** slå av flymodus og vent til linjen øverst i skjemaet viser «Alt er lagret».

Hver del under har én tabell per kandidat. Kryss av **én** av bestått / delvis / ikke bestått, og skriv i «Merknad» hva som skjedde hvis det ikke var bestått.

## C1 Plass

Ingen egen runde med bilder. Du leser bare tallene i boksen «Lagring på denne iPaden» på listen `/prove/testskjema` (under «Synkløsning») **før** og **etter** de 200 bildene i prøve A. Å åpne listen på nytt måler på nytt.

1. Før prøve A: åpne listen «Testskjema» og les boksen. Skriv tallene i kolonnen «Før».
2. Kjør prøve A som vanlig (200 bilder).
3. Etter prøve A: åpne listen på nytt (eller dra ned for å laste siden på nytt). Skriv tallene i kolonnen «Etter».

Tallene i boksen er: **brukt plass** (MB), **plassen appen får** (MB) og **varig lagring** (ja / nei / ikke støttet).

**Bestått når:** boksen viser tall både før og etter, brukt plass har økt etter bildene, og varig lagring er «ja». Delvis: tallene vises, men varig lagring er «nei» eller «ikke støttet». Ikke bestått: boksen viser ingen tall.

### PowerSync

| Måling | Før | Etter |
|---|---|---|
| Brukt plass (MB) | | |
| Plassen appen får (MB) | | |
| Varig lagring | | |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

### ElectricSQL

| Måling | Før | Etter |
|---|---|---|
| Brukt plass (MB) | | |
| Plassen appen får (MB) | | |
| Varig lagring | | |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

### Egenbygd

| Måling | Før | Etter |
|---|---|---|
| Brukt plass (MB) | | |
| Plassen appen får (MB) | | |
| Varig lagring | | |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

## C2 Omstart

Gjøres for hver kandidat.

1. Velg kandidaten, trykk «Nytt testskjema» og åpne det (med nett).
2. Slå på flymodus. Linjen øverst viser «Uten nett».
3. Fyll ut alle feltene og ta 20 bilder i bildefeltene, ett og ett.
4. Lukk appen helt: sveip opp fra bunnen og hold, og sveip appen opp og bort.
5. Start iPaden på nytt: hold inne toppknappen og en volumknapp, dra «slå av», og slå den på igjen.
6. Lås opp, la flymodus stå på, og åpne appen fra hjemskjermen. Åpne samme testskjema.
7. Sjekk at alle svarene og alle 20 bildene står der.
8. Slå av flymodus og vent på «Alt er lagret». Sjekk på PC at alt kom fram.

**Bestått når:** alt står der etter omstart, og alt kom fram til serveren. Delvis: noe mangler, men appen sa fra om det. Ikke bestått: noe mangler uten at det kom en melding.

### PowerSync

| Sjekk | Tall / observasjon |
|---|---|
| Svar som står der etter omstart (av alle) | |
| Bilder som står der etter omstart (av 20) | |
| Alt kom fram til serveren | ja / nei |
| Kom det en melding om noe som ikke var lagret? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

### ElectricSQL

| Sjekk | Tall / observasjon |
|---|---|
| Svar som står der etter omstart (av alle) | |
| Bilder som står der etter omstart (av 20) | |
| Alt kom fram til serveren | ja / nei |
| Kom det en melding om noe som ikke var lagret? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

### Egenbygd

| Sjekk | Tall / observasjon |
|---|---|
| Svar som står der etter omstart (av alle) | |
| Bilder som står der etter omstart (av 20) | |
| Alt kom fram til serveren | ja / nei |
| Kom det en melding om noe som ikke var lagret? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

## C3 7 dager uten bruk

Alle tre kandidatene kjøres **samtidig**, ikke tre runder etter hverandre.

1. Samme dag: for hver av de tre kandidatene, lag et nytt testskjema og fyll det ut **i flymodus** (noen svar og 5 bilder holder). Ikke slå av flymodus før alle tre er fylt ut, så ingenting rekker å synke.
2. Lukk appen helt. Nå kan du slå av flymodus og bruke iPaden til annet.
3. **Ikke åpne appen** på 7 dager. Nettet kan være på.
4. Etter 7 dager: slå på flymodus **før** du åpner appen. Åpne appen fra hjemskjermen.
5. Velg hver kandidat etter tur og åpne testskjemaet du fylte ut. Sjekk at alt står der.
6. Slå av flymodus, vent på «Alt er lagret», og sjekk på PC at alt kom fram.

Går det ikke å kjøre alle tre, holder det med PowerSync (standardkandidaten).

**Valgfritt:** samme prøve i vanlig Safari (ikke fra hjemskjermen). Planen sier allerede at appen må ligge på hjemskjermen, så dette er bare til informasjon. Skriv resultatet i «Merknad».

| | Dato |
|---|---|
| Fylt ut | |
| Åpnet igjen | |
| Antall dager uten bruk | |

**Bestått når:** alt står der etter 7 dager og kom fram til serveren. Delvis: noe mangler, men appen sa fra om det. Ikke bestått: noe mangler uten at det kom en melding.

### PowerSync

| Sjekk | Tall / observasjon |
|---|---|
| Svar som står der (av alle) | |
| Bilder som står der (av 5) | |
| Alt kom fram til serveren | ja / nei |
| Varig lagring i boksen på listen | ja / nei / ikke støttet |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

### ElectricSQL

| Sjekk | Tall / observasjon |
|---|---|
| Svar som står der (av alle) | |
| Bilder som står der (av 5) | |
| Alt kom fram til serveren | ja / nei |
| Varig lagring i boksen på listen | ja / nei / ikke støttet |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### Egenbygd

| Sjekk | Tall / observasjon |
|---|---|
| Svar som står der (av alle) | |
| Bilder som står der (av 5) | |
| Alt kom fram til serveren | ja / nei |
| Varig lagring i boksen på listen | ja / nei / ikke støttet |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

## C4 Full plass

Gjøres for hver kandidat. Dette tar tid og fyller iPaden. Kjør den sist.

**Merk:** synk frigjør ikke plass på iPaden i prøven. Bildene blir liggende på iPaden også etter at de er synket. Lokal rydding kommer i fase 2b. For å få plassen tilbake etter prøven, **etter** at du har sjekket at alt er på serveren: hold fingeren på appen på hjemskjermen, trykk «Slett bokmerke», og legg den til på hjemskjermen på nytt fra Safari. Skriv i «Merknad» om plassen kom tilbake (se iPad-lagring).

1. Velg kandidaten, lag et nytt testskjema og åpne det (med nett).
2. Slå på flymodus.
3. Ta bilder i bildefeltene, ett og ett. Tell bildene (telleren under bildefeltet hjelper).
4. Når meldingen **«Lite plass igjen på iPaden. Synk med nett så snart du kan.»** kommer øverst: skriv ned antall bilder.
5. Fortsett å ta bilder til lagringen feiler. Da skal det komme en melding øverst om at bildet ikke ble lagret, og at plassen er brukt opp. Skriv ned antall bilder og hva meldingen sa (uten svar eller bilder).
6. Slå av flymodus og vent på «Alt er lagret».
7. Sjekk på PC at alt som ble lagret før feilen, kom fram. Bildet som feilet skal ikke være der, men det skal ha kommet en melding om det.

**Bestått når:** varselet kom før lagringen feilet, meldingen kom ved feilen, og alt som ble lagret før feilen kom fram. Ingenting mangler uten at det kom en melding. Delvis: meldingen kom, men varselet om lite plass kom ikke først. Ikke bestått: noe mangler uten melding, eller appen stoppet uten å si fra.

### PowerSync

| Sjekk | Tall / observasjon |
|---|---|
| Antall bilder da «Lite plass igjen» kom | |
| Antall bilder da lagringen feilet | |
| Kom meldingen om at bildet ikke ble lagret? Hva sto det? | |
| Alt lagret før feilen kom fram til serveren | ja / nei |
| Mangler noe uten at det kom en melding? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

### ElectricSQL

| Sjekk | Tall / observasjon |
|---|---|
| Antall bilder da «Lite plass igjen» kom | |
| Antall bilder da lagringen feilet | |
| Kom meldingen om at bildet ikke ble lagret? Hva sto det? | |
| Alt lagret før feilen kom fram til serveren | ja / nei |
| Mangler noe uten at det kom en melding? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

### Egenbygd

| Sjekk | Tall / observasjon |
|---|---|
| Antall bilder da «Lite plass igjen» kom | |
| Antall bilder da lagringen feilet | |
| Kom meldingen om at bildet ikke ble lagret? Hva sto det? | |
| Alt lagret før feilen kom fram til serveren | ja / nei |
| Mangler noe uten at det kom en melding? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] |
|---|---|
| Merknad | |

## Oppsummering

| Kandidat | C1 Plass | C2 Omstart | C3 7 dager | C4 Full | Prøve C samlet |
|---|---|---|---|---|---|
| PowerSync | | | | | |
| ElectricSQL | | | | | |
| Egenbygd | | | | | |

Prøve C samlet er bestått bare når C2, C3 og C4 er bestått. C1 er en måling; «delvis» der stopper ikke kandidaten, men skal nevnes.

**Det som ikke virket:**
-

## Hva resultatet betyr for ADR-en

- Prøve C er en **må**-prøve. En kandidat som ikke består C, er ute (kriteriet «Virker prøvene» i `docs/funksjoner/fase1-testskjema.md`).
- Består flere kandidater, avgjøres valget av de andre kriteriene (arbeid, drift i EU/EØS, pris, modenhet). Tallene fra C1 og C4 (plass og antall bilder før varsel og feil) føres i ADR-en, fordi de sier hvor mange befaringer som kan ligge på iPaden før synk.
- Er varig lagring «nei» eller «ikke støttet» for alle, eller mister alle data etter 7 dager, holder ikke nettleser på iPad slik planen er nå. Da skrives det i ADR-en, og risikoen i `docs/07-utviklingsplan.md` tas opp på nytt.
- Antall bilder ved full plass er grunnlag for regelen om hvor mange oppdrag som kan ligge lokalt, og for lokal rydding i fase 2b.

**Vurdering:** ____________. Begrunnelse:
