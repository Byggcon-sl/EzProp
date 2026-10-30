# Prøve D – bilder: protokoll og resultat

- **Oppgavekort:** `docs/funksjoner/fase1-prove-d-bilder.md`. Testplan: `docs/funksjoner/fase1-prove-d-bilder-testplan.md`.
- **Plan:** `docs/07-utviklingsplan.md` fase 1, prøve D (tabellen «Plan for prøvene» i `docs/funksjoner/fase1-testskjema.md`).
- **Status:** mal, ikke kjørt.
- **Fylles ut av:** Ståle, på ekte iPad, når han er tilbake.
- **Dato kjørt:** ____________
- **Støtter hovedmål:** **Færre reklamasjoner.** Bildet er beviset hvis kunden klager. Prøven viser at bildene står riktig vei, og at originalen kommer fram til serveren uendret (samme fingeravtrykk på iPad og server), også når nettet blir borte midt i. Takstmannen gjør ingenting med bildene selv (mål: tid). KI er ikke med i denne prøven.

**Ekte HEIC fra kameraet, rotering av ekte bilder, brudd på ekte nett og tiden for 20 bilder kan ikke testes automatisk i nettleseren. Derfor gjøres de her på ekte iPad.**

Det som kan testes automatisk, er allerede dekket av testene i `e2e/fase-1-prove-d-bilder.spec.ts`: at kopien står riktig vei, er JPEG uten posisjon og er høyst 2000 punkter, at et bilde som ble avbrutt kommer fram én gang, og at en fil nettleseren ikke kan lese, likevel lastes opp.

## Ord som brukes her

- **Originalen** er bildet slik kameraet lagret det. Den lastes opp uendret.
- **Kopien** (visningskopien) lager iPaden selv: mindre, rettet riktig vei, alltid JPEG og uten posisjon (GPS). Det er den du ser med «Vis fra serveren».
- **Fingeravtrykket** er en kontrollsum av filen. iPaden sletter sin egen kopi av originalen først når serveren har svart med samme fingeravtrykk. Du ser det ikke selv. Det du ser, er at synkstatusen går til 0 bilder.

## Før du starter

**Ta bare bilder av nøytrale ting, ingen personer, ingen kunders boliger, ingen dokumenter eller skjermer med navn.**

| Oppsett | Fyll ut | OK |
|---|---|---|
| iPad-modell (Innstillinger → Generelt → Om → Modellnavn) | | [ ] |
| iPadOS-versjon (Innstillinger → Generelt → Om → iPadOS-versjon) | | [ ] |
| Safari-versjon (følger iPadOS-versjonen) | | [ ] |
| Kameraet tar bilder i «Høy effektivitet» (HEIC) (Innstillinger → Kamera → Formater → Høy effektivitet) | ja / nei | [ ] |
| Stedstjenester for Safari er slått av (Innstillinger → Personvern og sikkerhet → Stedstjenester → Safari-nettsteder → Aldri) | ja / nei | [ ] |
| Appen er lagt på hjemskjermen og åpnes **fra hjemskjermen** | ja / nei | [ ] |
| Versjon i `/api/helse` (må være 0.2.23 eller nyere) | | [ ] |

**Slik bytter du kandidat:** åpne listen «Testskjema» med nett, trykk på «Egenbygd», «PowerSync» eller «ElectricSQL» under «Synkløsning». Siden lastes på nytt. Trykk «Nytt testskjema» og åpne det, så ligger appen og skjemaet klart på iPaden før du slår på flymodus.

**Egenbygd kan kjøres med en gang.** PowerSync og ElectricSQL trenger at synktjenestene i testmiljøet er slått på (spørsmål nr. 12). Er de av, krysser du «Ikke kjørt» for dem. Bildekøen er den samme for alle tre, så Egenbygd alene sier mest.

**Slik ser du at bildene er lastet opp:** slå av flymodus og vent til synkstatusen øverst i skjemaet ikke lenger viser bilder som venter («Alt er lagret», eller «Venter: …, 0 bilder»).

**Slik ser du et bilde fra serveren:** trykk «Vis fra serveren» ved filnavnet under bildefeltet. Bildet åpnes i en ny fane. Svarer den «Bildet er ikke lastet opp ennå.», har serveren ikke kopien.

Hver del under har én tabell per kandidat. Kryss av **én** av bestått / delvis / ikke bestått / ikke kjørt, og skriv i «Merknad» hva som skjedde hvis det ikke var bestått.

## D1 Rotering

1. Velg kandidaten, lag et nytt testskjema og åpne det (med nett).
2. Ta 5 bilder med iPaden **liggende** og 5 med iPaden **stående**, i bildefeltene. Ta noen av dem med iPaden **opp ned** (både liggende og stående).
3. Vent til bildene er lastet opp (synkstatusen viser 0 bilder).
4. Trykk «Vis fra serveren» for hvert bilde. Sjekk at det står riktig vei, slik du så det da du tok det.

**Bestått når:** alle bildene står riktig vei fra serveren. Delvis: de fleste står riktig, men noen (for eksempel de opp ned) står feil. Skriv hvilke i «Merknad». Ikke bestått: bildene står gjennomgående feil vei.

### Egenbygd

| Sjekk | Tall / observasjon |
|---|---|
| Liggende bilder som står riktig vei i «Vis fra serveren» (av 5) |  |
| Stående bilder som står riktig vei i «Vis fra serveren» (av 5) |  |
| Bilder tatt med iPaden opp ned som står riktig vei | ___ av ___ |
| Står bildene riktig vei med «Vis fra serveren» på PC også? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### PowerSync

| Sjekk | Tall / observasjon |
|---|---|
| Liggende bilder som står riktig vei i «Vis fra serveren» (av 5) |  |
| Stående bilder som står riktig vei i «Vis fra serveren» (av 5) |  |
| Bilder tatt med iPaden opp ned som står riktig vei | ___ av ___ |
| Står bildene riktig vei med «Vis fra serveren» på PC også? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### ElectricSQL

| Sjekk | Tall / observasjon |
|---|---|
| Liggende bilder som står riktig vei i «Vis fra serveren» (av 5) |  |
| Stående bilder som står riktig vei i «Vis fra serveren» (av 5) |  |
| Bilder tatt med iPaden opp ned som står riktig vei | ___ av ___ |
| Står bildene riktig vei med «Vis fra serveren» på PC også? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

## D2 HEIC og JPEG

Kameraet lagrer i HEIC når «Høy effektivitet» er på. Safari kan selv gjøre HEIC om til JPEG når bildet velges. Begge deler er greit. Vi vil bare vite hva som skjer.

1. Bruk 3 av bildene fra D1.
2. **Filtype på originalen:** se på filnavnet i listen under bildefeltet. Skriv om det slutter på .HEIC, .jpg eller noe annet.
3. **Størrelse på originalen:** i appen Bilder på iPaden, åpne bildet og sveip opp (eller trykk «i»). Der står størrelsen og formatet (HEIF eller JPEG). Skriv størrelsen i MB.
4. **Størrelse på kopien:** på PC, åpne samme testskjema, trykk «Vis fra serveren» og lagre bildet (høyreklikk → «Lagre bilde som»). Se størrelsen i Finder (velg filen og trykk Cmd+I). Skriv størrelsen i MB, og sjekk at filen er JPEG (.jpg).

**Bestått når:** kopien er JPEG for alle tre og mindre enn originalen (forventet under 1 MB). Delvis: kopien er JPEG, men like stor eller større enn originalen. Ikke bestått: «Vis fra serveren» viser ikke bildet.

### Egenbygd

| Sjekk | Tall / observasjon |
|---|---|
| Filnavnet på originalen i listen slutter på (.HEIC, .jpg eller annet) |  |
| Bilde 1: størrelse original (MB) / kopi (MB) |  /  |
| Bilde 2: størrelse original (MB) / kopi (MB) |  /  |
| Bilde 3: størrelse original (MB) / kopi (MB) |  /  |
| Er kopien JPEG for alle tre (filen fra «Vis fra serveren» er .jpg)? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### PowerSync

| Sjekk | Tall / observasjon |
|---|---|
| Filnavnet på originalen i listen slutter på (.HEIC, .jpg eller annet) |  |
| Bilde 1: størrelse original (MB) / kopi (MB) |  /  |
| Bilde 2: størrelse original (MB) / kopi (MB) |  /  |
| Bilde 3: størrelse original (MB) / kopi (MB) |  /  |
| Er kopien JPEG for alle tre (filen fra «Vis fra serveren» er .jpg)? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### ElectricSQL

| Sjekk | Tall / observasjon |
|---|---|
| Filnavnet på originalen i listen slutter på (.HEIC, .jpg eller annet) |  |
| Bilde 1: størrelse original (MB) / kopi (MB) |  /  |
| Bilde 2: størrelse original (MB) / kopi (MB) |  /  |
| Bilde 3: størrelse original (MB) / kopi (MB) |  /  |
| Er kopien JPEG for alle tre (filen fra «Vis fra serveren» er .jpg)? | ja / nei |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

## D3 Brudd

1. Velg kandidaten, lag et nytt testskjema og åpne det (med nett).
2. Slå på flymodus.
3. Ta 20 bilder i bildefeltene, ett og ett.
4. Slå av flymodus (nettet på). Vent noen sekunder, til de første bildene begynner å gå.
5. Slå på flymodus igjen midt i opplastingen. Vent litt.
6. Slå av flymodus igjen, og la appen ligge åpen til synkstatusen viser 0 bilder.
7. På PC: åpne samme testskjema og tell bildene i listen. Sjekk at ingen mangler, og at ingen står to ganger.

**Bestått når:** synkstatusen går til 0 bilder, og alle 20 står på PC én gang hver. Delvis: alt kom fram, men det trengtes «Synk nå», eller det kom en feilmelding som løste seg selv. Ikke bestått: bilder mangler eller står to ganger.

### Egenbygd

| Sjekk | Tall / observasjon |
|---|---|
| Bilder tatt i flymodus | 20 |
| Gikk synkstatusen til «0 bilder» til slutt? | ja / nei |
| Bilder i listen på PC (av 20) |  |
| Bilder som mangler på PC |  |
| Bilder som står to ganger på PC |  |
| Kom det en feilmelding underveis? Hva sto det? |  |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### PowerSync

| Sjekk | Tall / observasjon |
|---|---|
| Bilder tatt i flymodus | 20 |
| Gikk synkstatusen til «0 bilder» til slutt? | ja / nei |
| Bilder i listen på PC (av 20) |  |
| Bilder som mangler på PC |  |
| Bilder som står to ganger på PC |  |
| Kom det en feilmelding underveis? Hva sto det? |  |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### ElectricSQL

| Sjekk | Tall / observasjon |
|---|---|
| Bilder tatt i flymodus | 20 |
| Gikk synkstatusen til «0 bilder» til slutt? | ja / nei |
| Bilder i listen på PC (av 20) |  |
| Bilder som mangler på PC |  |
| Bilder som står to ganger på PC |  |
| Kom det en feilmelding underveis? Hva sto det? |  |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

## D4 Fingeravtrykk

Bruk testskjemaet fra D3, når alt er lastet opp.

1. Sjekk at synkstatusen viser 0 bilder som venter. iPaden sletter bare sin egen kopi når serveren har svart med samme fingeravtrykk, så 0 betyr at alle originalene kom fram uendret.
2. Trykk «Vis fra serveren» for hvert av de 20 bildene. Tell hvor mange som svarer «Bildet er ikke lastet opp ennå.».

Tallet i punkt 2 **bør være 0**. Er det over 0, mangler de bildene kopi på serveren: iPaden klarte ikke å lage den, eller serveren avviste den (se A10 i `docs/09-apne-sporsmal.md`). Originalen er likevel trygg. Det er et funn for ADR-en, ikke en feil du må rette.

**Bestått når:** 0 bilder venter, og 0 bilder mangler kopi. Delvis: 0 bilder venter, men noen mangler kopi. Ikke bestått: bilder blir stående og vente.

### Egenbygd

| Sjekk | Tall / observasjon |
|---|---|
| Bilder som venter i synkstatusen når alt er ferdig (bør være 0) |  |
| Bilder der «Vis fra serveren» svarer «Bildet er ikke lastet opp ennå.» (bør være 0) | ___ av 20 |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### PowerSync

| Sjekk | Tall / observasjon |
|---|---|
| Bilder som venter i synkstatusen når alt er ferdig (bør være 0) |  |
| Bilder der «Vis fra serveren» svarer «Bildet er ikke lastet opp ennå.» (bør være 0) | ___ av 20 |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### ElectricSQL

| Sjekk | Tall / observasjon |
|---|---|
| Bilder som venter i synkstatusen når alt er ferdig (bør være 0) |  |
| Bilder der «Vis fra serveren» svarer «Bildet er ikke lastet opp ennå.» (bør være 0) | ___ av 20 |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

## D5 Tid

Mål tiden i D3: fra du slår av flymodus siste gang til synkstatusen viser 0 bilder, for de 20 bildene.

**Ingen grense i prøven.** Tallet føres i ADR-en. Tar det mer enn noen minutter på godt nett, er det et funn. Et bilde som ble avbrutt, sendes på nytt i sin helhet (A9), og opplasting i biter kan vurderes i fase 2a.

### Egenbygd

| Sjekk | Tall / observasjon |
|---|---|
| Klokkeslett flymodus av (siste gang) |  |
| Klokkeslett synkstatusen viste «0 bilder» |  |
| Tid for 20 bilder (minutter og sekunder) |  |
| Nett (wifi eller mobilnett, og omtrent hvor godt) |  |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### PowerSync

| Sjekk | Tall / observasjon |
|---|---|
| Klokkeslett flymodus av (siste gang) |  |
| Klokkeslett synkstatusen viste «0 bilder» |  |
| Tid for 20 bilder (minutter og sekunder) |  |
| Nett (wifi eller mobilnett, og omtrent hvor godt) |  |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

### ElectricSQL

| Sjekk | Tall / observasjon |
|---|---|
| Klokkeslett flymodus av (siste gang) |  |
| Klokkeslett synkstatusen viste «0 bilder» |  |
| Tid for 20 bilder (minutter og sekunder) |  |
| Nett (wifi eller mobilnett, og omtrent hvor godt) |  |

| Resultat | Bestått [ ] · Delvis [ ] · Ikke bestått [ ] · Ikke kjørt [ ] |
|---|---|
| Merknad | |

## Etter prøven

- [ ] Testbildene ryddes på testserveren (myk sletting, eller tømming av mappen for prøvebilder i testmiljøet). Står også under «Trenger Ståle når han er tilbake» i `docs/agenter/tilstand.md`.
- [ ] Stedstjenester for Safari kan slås på igjen hvis du vil.

## Oppsummering

| Kandidat | D1 Rotering | D2 HEIC og JPEG | D3 Brudd | D4 Fingeravtrykk | D5 Tid (20 bilder) | Prøve D samlet |
|---|---|---|---|---|---|---|
| Egenbygd | | | | | | |
| PowerSync | | | | | | |
| ElectricSQL | | | | | | |

Prøve D samlet er bestått bare når D1, D3 og D4 er bestått. D2 og D5 er målinger; «delvis» der stopper ikke kandidaten, men skal nevnes.

**Det som ikke virket:**
-

## Hva resultatet betyr for ADR-en

- Bildekøen er lik for alle tre kandidatene, så et funn her gjelder som regel alle. Er det forskjell mellom kandidatene, skal det stå i «Merknad».
- Står bildene feil vei (D1), eller lager ikke Safari kopien (D2, D4), må laging av kopien bygges annerledes i fase 2a. Det skrives i ADR-en.
- Mangler bilder eller står de doble etter brudd (D3), holder ikke bildekøen slik den er. Da tas det opp på nytt før fase 2a.
- Tiden i D5 avgjør om opplasting i biter trengs (A9).

**Vurdering:** ____________. Begrunnelse:
