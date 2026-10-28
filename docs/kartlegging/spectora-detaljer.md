# Spectora i detalj: innstillinger og små funksjoner

Sist oppdatert: 24.10.2026
Status: Observasjon, ikke godkjent.
Kilde: En Claude-hjelpeagent i Spectoras prøvekonto natt til 24.10.2026: innstillinger, inspeksjonsside, V9-editoren, malinnstillinger, nettrapport og PDF. V10-editoren og iPad-appen kunne ikke åpnes fordi prøvekontoen er utløpt. De er beskrevet ut fra hjelpesider og koden som lastes i nettleseren. Supplerer `spectora-test.md` og `spectora-advanced-automatisering.md`.

## Detaljer EzProp bør ha

**Oppdrag og rapport**

| Detalj | Pri |
|---|---|
| **Status for rapportlåsen:** sjekkliste over hva som må til før kunden får rapporten (signert avtale, betaling eller garanti fra megler) | Høy |
| **Logg over hvem som har sett rapporten:** tidspunkt, IP og hvem, og merket «sett av kjøper/megler» | Høy |
| **Angre sletting / papirkurv** for rapporter, oppdrag og maler | Høy |
| **Kopiere oppdrag eller rapport** (ny rapport på samme bolig eller ny seksjon) | Høy |
| **Dialogen forklarer hva som skjer automatisk** før bekreftelse, f.eks. «påminnelser flyttes, ny bekreftelse sendes» | Høy |
| **Eiendomsdata kan overstyres**, og det vises at de er overstyrt | Høy |
| Merker på rapportkortet: status, dato, mal og takstmann | Middels |
| Lagre en god rapport som mal | Middels |
| Manuell e-post der man må velge transaksjon eller markedsføring | Middels |

**Editor**

| Detalj | Pri |
|---|---|
| Søk i kommentarer og fraser (Ctrl+K), med tydelig tomtilstand | Høy |
| Alt som hører til ett avvik på samme kort: kategori, sted, fagperson, kostnad, bilde | Høy |
| Ikoner per punkt: dupliser, flytt, slett, endre navn, lagre tilbake til mal, flagg | Høy |
| **Automatisk tekst ved TGIU**, f.eks. «Ikke undersøkt fordi …». TGIU teller som ferdig i fremdriften. | Høy |
| Valg av hvilken fane som vises først, og flaggede kommentarer øverst | Middels |

**Maler**

| Detalj | Pri |
|---|---|
| **Endringer i mal gjelder bare nye rapporter.** Rapporten låses til malversjonen den ble startet med. | Høy |
| **Dele og klone mal** med andre takstmenn eller selskaper | Høy |
| PDF-valg: innholdsfortegnelse med lenker, avvik først, ny side per seksjon, ikke dele kommentar over to sider, egen bunntekst, signatur | Høy |
| Sorter fraser etter «mest brukt», og import/eksport til regneark | Middels |
| Sammendrags-PDF med antall per TG | Middels |

**Nettrapport for kunden**

| Detalj | Pri |
|---|---|
| Venstremeny med antall avvik per seksjon, og klikkbare oppsummeringsbobler | Høy |
| Filter (full rapport, sammendrag, per TG) med tydelig varsel «du ser ikke hele rapporten» | Høy |
| Ferdig lagret PDF som kan lages på nytt etter retting | Høy |
| Avvikene som kopierbar tekst for megler og kjøper | Middels |
| God mobilvisning (Spectoras forside blir rotete) | Høy |

**Dashbord, kalender og konto**

| Detalj | Pri |
|---|---|
| Globalt søk, også på kundenavn | Høy |
| **Bytte rolle eller selskap uten å logge ut** (samarbeid mellom selskaper) | Høy |
| Tofaktorinnlogging med sperre etter gjentatte feil | Høy |
| **Det som er signert, fryses.** Senere endringer i innstillinger påvirker ikke signerte avtaler. | Høy |
| Egen tekst når man holder pekeren over en avtale i kalenderen | Middels |
| Kart med kjørerute for dagen | Middels |
| Varselinnstillinger per kategori og kanal | Middels |
| Varsel når en mal brukes av aktive tjenester og forsøkes slettet | Middels |
| Hurtigfilter i oppdragslisten (i dag, i morgen, ubekreftede) og valg av kolonner | Middels |

## Ting som gjør befaring på iPad lettere

- **Synkronisering:**
  - Automatisk, ca. 3 sekunder etter at noe er skrevet inn, når det er nett.
  - Uten nett lagres alt lokalt, og appen prøver igjen med stadig lengre pauser.
  - Brukeren får varsel om data som ikke er synkronisert.
- **Endringer per del** (punkt, kommentar, bilde). Da kan to personer jobbe samtidig, for eksempel én på taket og én inne.
- **Trygg oppstart uten nett:** Selv om innloggingen har gått ut, kan takstmannen åpne siste rapport. Beskjeden er «dataene dine er trygge».
- **Tydelige feilmeldinger ved lagring.**
- **Serie-kamera:** mange bilder etter hverandre, med innstillinger som huskes. Tegneverktøyet kan åpnes automatisk etter hvert avviksbilde.
- **Bevisbilder:** kan lagres i iPadens bildealbum merket med adressen.
- **HEIC-bilder:** EzProp bør konvertere automatisk (Spectora støtter dem ikke).
- **Søk som tåler skrivefeil**, med «bare de mest brukte». Nyttig med hansker.
- **Stedsmerker i tre grupper:** etasje, himmelretning og rom.
- **Fremdriftsmåler** og krav om fullført før publisering.
- **Lys eller mørk visning, og fem tekststørrelser.**
- **Bekreftelse før et bilde slettes.**
- **Feilsøking:** «nullstill», «send feilsøkingsinfo» og «hent serverversjon». Bygges, men skal sjelden trengs.

## Svakheter i Spectora vi skal unngå

- **Tid:** Klokkeslett vises ulikt i kalender og liste (tidssonefeil).
- **PDF:** Interne ID-er står i teksten, og tomme seksjoner gir egne sider (ett avvik ble 19 sider).
- **Kart:** Kartfeil vises på forsiden.
- **Versjoner:** Bytte mellom V9 og V10 laget en tom rapport og slettet originalen. Vi skal ha én datamodell.
- **Valuta:** Bare dollar, ingen kroner.

## Endret i prøvekontoen

- Testinspeksjonen (Testveien 1) er nå i V10 med den opprinnelige rapporten gjenopprettet. Den kan ikke redigeres fordi kontoen er utløpt.
- En tom kopi ble opprettet og slettet.
- Ingen e-post, betaling eller tilkoblinger.
