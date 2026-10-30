# Prøve F – innlogging som har gått ut: protokoll og resultat

- **Oppgavekort:** `docs/funksjoner/fase1-prove-f-innlogging.md`. Testplan: `docs/funksjoner/fase1-prove-f-innlogging-testplan.md`.
- **Plan:** `docs/07-utviklingsplan.md` fase 1, prøve F (tabellen «Plan for prøvene» i `docs/funksjoner/fase1-testskjema.md`).
- **Status:** mal, ikke kjørt.
- **Fylles ut av:** Ståle, på ekte iPad, når han er tilbake.
- **Dato kjørt:** ____________
- **Støtter hovedmål:**
  - **Færre reklamasjoner (hovedsak):** det takstmannen har registrert uten nett, skal ikke gå tapt fordi innloggingen gikk ut. Svar og bilder ligger på iPaden til han har logget inn igjen, og sendes da uten tap.
  - **Mindre tid:** takstmannen kan fortsette befaringen uten nett, og kommer rett tilbake til skjemaet etter ny innlogging.
  - Resultatet tas med i sammenligningen av kandidatene og i ADR-en for synkløsningen.

**Ekte iPad, hjemskjerm-appen, flymodus og innlogging med kode på e-post kan ikke testes automatisk. Derfor gjøres de her.**

Det som kan testes automatisk (at skjemaet åpnes og fylles ut uten nett med utløpt innlogging, meldingen «Logg inn på nytt for å sende», at man kommer tilbake til skjemaet etter innlogging, og at alt kommer fram på serveren), er allerede dekket av testene i `e2e/fase-1-prove-f-innlogging.spec.ts`, på PC- og iPad-størrelse.

## Før du starter

Bare oppdiktede data. Ingen ekte adresser, navn eller bilder av ekte boliger i skjemaet.

| Oppsett | Fyll ut | OK |
|---|---|---|
| iPad-modell (Innstillinger → Generelt → Om → Modellnavn) | | [ ] |
| iPadOS-versjon (Innstillinger → Generelt → Om → iPadOS-versjon) | | [ ] |
| Safari-versjon (følger iPadOS-versjonen) | | [ ] |
| Appen er lagt på hjemskjermen (i Safari: Del → Legg til på Hjem-skjerm), og åpnes **fra hjemskjermen** | ja / nei | [ ] |
| Versjon i `/api/helse` (må være den som har prøve F eller nyere) | | [ ] |
| Kandidat for denne runden (PowerSync / ElectricSQL / Egenbygd) | | [ ] |
| Mail-appen på iPaden er satt opp med e-posten du logger inn med, så du får koden der | ja / nei | [ ] |
| En PC med nett og innlogging, for å sjekke svarene og bildene i F4 | ja / nei | [ ] |

**Slik bytter du kandidat:** åpne listen «Testskjema» med nett, trykk på «PowerSync», «ElectricSQL» eller «Egenbygd» under «Synkløsning». Siden lastes på nytt. Trykk «Nytt testskjema». Gjør så alle trinnene under for den kandidaten, fra «Slik settes innloggingen som utløpt».

**Slik ser du at noe er synket:** linjen øverst i skjemaet viser «Alt er lagret».

## Slik settes innloggingen som utløpt

Innloggingen varer i 30 dager. Vi kan ikke vente så lenge. I stedet logger du ut før du slår på flymodus. Serveren ser da det samme som når innloggingen har gått ut: den har ingen gyldig innlogging for iPaden. Det er bestemt i `docs/09-apne-sporsmal.md` (A6).

**Viktig:** du må ha åpnet **både listen «Testskjema» og skjemaet** med nett **før** du logger ut. Ellers har ikke appen dem lagret, og de kan ikke åpnes uten nett.

1. [ ] Med nett: åpne appen fra hjemskjermen og logg inn.
2. [ ] Åpne listen «Testskjema» (`/prove/testskjema`). Vent til den er ferdig lastet.
3. [ ] Åpne testskjemaet du skal bruke. Vent til linjen øverst viser «Alt er lagret».
4. [ ] Gå til arbeidskøen og trykk «Logg ut» (fortsatt med nett).
5. [ ] Slå på flymodus (dra ned fra øverste høyre hjørne, trykk på flyet). Sjekk at wifi også er av.
6. [ ] Lukk appen helt (sveip opp fra bunnen og hold, sveip appen bort).
7. [ ] Åpne appen fra hjemskjermen, og så skjemaet (gå via listen «Testskjema» hvis appen ikke åpner skjemaet direkte).

Kom du til innloggingssiden i stedet for listen eller skjemaet, skriv det under F1. Det teller som ikke bestått.

## F1 Åpne uten nett

Etter trinn 7 over.

**Bestått når:** skjemaet åpnes uten nett, alt som var fylt ut før står der, og linjen øverst viser «Uten nett» (ingen melding om innlogging). Delvis: skjemaet åpnes, men noe mangler eller ser feil ut. Ikke bestått: skjemaet åpnes ikke, eller du havner på innloggingssiden.

## F2 Fylle ut uten nett

1. [ ] Fyll ut alle feltene i skjemaet.
2. [ ] Ta 10 bilder i skjemaet.
3. [ ] Lukk appen helt (sveip den bort).
4. [ ] Åpne appen fra hjemskjermen og skjemaet igjen.
5. [ ] Sjekk at alle svar og alle 10 bilder står der.

**Bestått når:** alt du fylte ut og alle 10 bildene står der etter at appen er lukket og åpnet igjen. Delvis: noe mangler, men du fikk beskjed om det. Ikke bestått: noe mangler uten beskjed, eller skjemaet kan ikke fylles ut.

## F3 Nettet kommer

1. [ ] Ha skjemaet åpent. Start stoppeklokke og slå av flymodus samtidig.
2. [ ] Vent på meldingen «Logg inn på nytt for å sende. Alt er lagret på iPaden.» med knappen «Logg inn».
3. [ ] Kommer den ikke innen ca. 10 sekunder: trykk «Synk nå», og noter at du måtte gjøre det.
4. [ ] Sjekk at «Synk nå» er borte mens «Logg inn» vises, og at knappen er like stor og står på samme plass.

**Bestått når:** meldingen kommer av seg selv innen ca. 10 sekunder. Delvis: den kommer først etter «Synk nå», eller etter mer enn 10 sekunder. Ikke bestått: den kommer ikke, eller appen sier «Alt er lagret» uten at noe er sendt.

## F4 Logg inn og synk

1. [ ] Start stoppeklokke og trykk «Logg inn».
2. [ ] Skriv e-posten og be om kode.
3. [ ] Gå til Mail, finn koden, og gå tilbake til appen.
4. [ ] Skriv inn koden.
5. [ ] Sjekk at du kommer rett tilbake til **samme skjema** (ikke arbeidskøen).
6. [ ] Vent til linjen øverst viser «Alt er lagret». Stopp klokka.
7. [ ] På PC: åpne samme testskjema. Sjekk at alle svar og alle 10 bildene er der.

**Gikk til Mail og tilbake: sto siden fortsatt på kodefeltet?** ja [ ] / nei [ ]

Svarer du nei (siden var lastet på nytt, og du måtte skrive e-posten og be om ny kode), føres det i `docs/09-apne-sporsmal.md`. Forslag til løsning: innloggingssiden husker steget i `sessionStorage`. Vi bygger ikke noe for det nå.

**Bestått når:** du kommer tilbake til samme skjema, «Alt er lagret» vises, og alle svar og alle 10 bildene er der på PC. Delvis: alt kom fram, men du havnet i arbeidskøen, eller du måtte trykke «Synk nå». Ikke bestått: noe mangler på PC.

## Resultat per kandidat

Kryss av **én** av bestått / delvis / ikke bestått per del, og skriv i «Merknad» hva som skjedde hvis det ikke var bestått.

### PowerSync

| Del | Bestått | Delvis | Ikke bestått | Merknad |
|---|---|---|---|---|
| F1 Åpne uten nett | [ ] | [ ] | [ ] | |
| F2 Fylle ut uten nett | [ ] | [ ] | [ ] | |
| F3 Nettet kommer | [ ] | [ ] | [ ] | |
| F4 Logg inn og synk | [ ] | [ ] | [ ] | |

| Måling | Svar |
|---|---|
| F3: sekunder fra flymodus av til meldingen | |
| F3: måtte trykke «Synk nå» | ja / nei |
| F4: sekunder fra «Logg inn» til «Alt er lagret» | |
| F4: sto siden på kodefeltet etter Mail | ja / nei |
| F4: alle svar og 10 bilder på PC | ja / nei |

### ElectricSQL

| Del | Bestått | Delvis | Ikke bestått | Merknad |
|---|---|---|---|---|
| F1 Åpne uten nett | [ ] | [ ] | [ ] | |
| F2 Fylle ut uten nett | [ ] | [ ] | [ ] | |
| F3 Nettet kommer | [ ] | [ ] | [ ] | |
| F4 Logg inn og synk | [ ] | [ ] | [ ] | |

| Måling | Svar |
|---|---|
| F3: sekunder fra flymodus av til meldingen | |
| F3: måtte trykke «Synk nå» | ja / nei |
| F4: sekunder fra «Logg inn» til «Alt er lagret» | |
| F4: sto siden på kodefeltet etter Mail | ja / nei |
| F4: alle svar og 10 bilder på PC | ja / nei |

### Egenbygd

| Del | Bestått | Delvis | Ikke bestått | Merknad |
|---|---|---|---|---|
| F1 Åpne uten nett | [ ] | [ ] | [ ] | |
| F2 Fylle ut uten nett | [ ] | [ ] | [ ] | |
| F3 Nettet kommer | [ ] | [ ] | [ ] | |
| F4 Logg inn og synk | [ ] | [ ] | [ ] | |

| Måling | Svar |
|---|---|
| F3: sekunder fra flymodus av til meldingen | |
| F3: måtte trykke «Synk nå» | ja / nei |
| F4: sekunder fra «Logg inn» til «Alt er lagret» | |
| F4: sto siden på kodefeltet etter Mail | ja / nei |
| F4: alle svar og 10 bilder på PC | ja / nei |

## Oppsummering

| Kandidat | F1 Åpne | F2 Fylle ut | F3 Nettet kommer | F4 Logg inn og synk | Prøve F samlet |
|---|---|---|---|---|---|
| PowerSync | | | | | |
| ElectricSQL | | | | | |
| Egenbygd | | | | | |

Prøve F samlet er bestått bare når F1, F2 og F4 er bestått. F3 «delvis» (meldingen kom først etter «Synk nå») stopper ikke kandidaten, men skal nevnes.

**Det som ikke virket:**
-

## Merknader

- **Ekte utløp etter 30 dager kan ikke testes direkte.** Vi bruker «Logg ut» før flymodus (A6). Serveren ser det samme: ingen gyldig innlogging. De automatiske testene dekker også tilfellet der innloggingen er gått ut på serveren, men nettleseren fortsatt har den gamle.
- **PowerSync:** tilgangen PowerSync bruker for å hente data, kan gjelde i opptil én time etter at innloggingen er borte. Det gjelder bare henting av data til iPaden, ikke sending. Alt som sendes, går gjennom våre egne sider på serveren, som sjekker innloggingen hver gang. Dette endres ikke i prøven, men tas med i ADR-en.
- Det vises bevisst ingen melding om innlogging mens appen er uten nett. Appen kan ikke vite om innloggingen har gått ut før den får kontakt med serveren (A5).

## Hva resultatet betyr for ADR-en

- Prøve F er en **må**-prøve for reklamasjoner: en kandidat som mister svar eller bilder når innloggingen har gått ut (F2 eller F4 ikke bestått), er ute (kriteriet «Virker prøvene» i `docs/funksjoner/fase1-testskjema.md`).
- Meldingen og «Logg inn» ligger i skjermlaget og er lik for alle kandidatene. Forskjeller i F3 og F4 kommer derfor av hvordan kandidaten sender køen etter innlogging. Tidene fra F3 og F4 føres i ADR-en.
- Svarer F4 nei på kodefeltet, gjelder det alle kandidatene. Det føres i `docs/09-apne-sporsmal.md`, ikke i ADR-en.

**Vurdering:** ____________. Begrunnelse:
