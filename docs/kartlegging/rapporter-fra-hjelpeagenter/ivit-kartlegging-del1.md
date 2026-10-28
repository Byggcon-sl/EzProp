# Spectora i detalj: innstillinger og små funksjoner

Kort fortalt: jeg har gått gjennom alle innstillingene, inspeksjonssiden, V9-editoren, malinnstillingene, nettrapporten og PDF-en. **V10-editoren fikk jeg ikke åpnet.** Kontoen er utløpt («Your inspector account is not active»), og V10 sender meg da til en feilside. V10 og iPad-appen er derfor beskrevet ut fra Spectoras hjelpesider og koden som lastes i nettleseren. Jeg tar ikke med det som allerede står i `spectora-test.md` og `spectora-advanced-automatisering.md`.

## 1. Konkrete detaljer og innstillinger

**Oppdrag og rapportkort (inspeksjonssiden)**

1. **Status for rapportlåsen.** Hvor: inspeksjonssiden → Reports → knappen «Unlocked». Den forklarer hvorfor rapporten er åpen: betalt, avtale signert, rapport åpnet for visning. Kunden ser altså nøyaktig hva som mangler før rapporten blir tilgjengelig. *EzProp: høy.* Vis en sjekkliste for hva som må til før kunden får rapporten, for eksempel signert oppdragsavtale og betaling eller garanti fra megler.
2. **Logg over hvem som har sett rapporten.** Hvor: rapportkortet → «View Log». Loggen viser tidspunkt, IP-adresse og hvem (for eksempel «Kari Kjoper (Buyer)»). Kortet har også merkene «Report Viewed» og «Buyer viewed on 10/22/2026». *EzProp: høy.* Det er nyttig ved reklamasjoner, og når man vil vite om megler har åpnet rapporten.
3. **Angre sletting.** Hvor: «Undelete» finnes for rapporter, oppdrag (i oppdragslisten) og maler («Undelete a Template»). *EzProp: høy.* Det passer med regelen om at ingenting slettes permanent. Vi bør ha en egen «papirkurv» per oppdrag.
4. **Merker på rapportkortet.** Kortet viser versjon (V9/V10), visningsstatus, dato for når rapporten ble bygd, mal og takstmann. *EzProp: middels.* Ett blikk viser hvor langt rapporten har kommet.
5. **«Reorder / Copy» og «Copy report».** Hvor: MORE-menyen og rapportkortet. Man kan bestille nytt oppdrag på samme eiendom eller kopiere en rapport. *EzProp: høy.* Det passer til ny tilstandsrapport på samme bolig, eller til en ny seksjon i samme borettslag.
6. **«Save as Template» fra en ferdig rapport.** En god rapport kan gjøres om til mal. *EzProp: middels.*
7. **Dialogen for å flytte befaringen forklarer konsekvensen.** Den sier at alle påminnelser flyttes automatisk og at det sendes bekreftelse på ny tid, men ikke hvis bare varigheten endres. *EzProp: høy.* Si alltid hva som skjer automatisk før brukeren bekrefter.
8. **Eiendomsdata som kan rettes.** Hvor: MORE → Property Details. Feltene er byggeår, areal, tomt, fundament, soverom, bad, parkering og koordinater. Det finnes også en lenke for å slå av automatisk oppslag hvis dataene er feil. *EzProp: høy.* Data fra matrikkelen må kunne overstyres, og det skal synes at de er overstyrt.
9. **Manuell e-post der man må velge type.** Hvor: MORE → Share. Man må velge «transaksjon» eller «markedsføring» før sending, og det er forklart hva typene betyr. *EzProp: middels.*
10. **Ekstra valg for takstmann på oppdraget.** «Make Invisible» skjuler en takstmann for kunden, og «Mark As Requested» merker at kunden ba om nettopp denne takstmannen. *EzProp: lav.*
11. **Advarsel når en rapport slettes.** Teksten ber brukeren kjøre «Reset To Server Version» i mobilappen etterpå. *EzProp: lærdom.* Brukeren skal aldri måtte gjøre noe manuelt for å synkronisere etter en sletting.

**Rapporteditor (V9 på nett)**

12. **Søk i kommentarer.** Hvor: søkefeltet «search for comments» øverst, eller Ctrl+K i V10. Ingen treff gir en tydelig tomtilstand: «Sorry, it looks like we can't find anything». *EzProp: høy.*
13. **Ikonrad på hvert avvik.** Den har kategoriknapper med symboler (skiftenøkkel, minus, varseltrekant), sted med blyant for fritekst og hurtigvalg, en nedtrekksliste for anbefalt fagperson, avkrysning for «Provide Cost Estimate» med min–maks, og «+ PHOTO/VIDEO». Avkrysset kommentar blir rød med hake, og punktet får grønn hake i venstremenyen. *EzProp: høy.* Alt som hører til ett avvik bør ligge på samme kort.
14. **Ikoner per punkt og seksjon.** Dupliser, flytt (tre-ikon), slett, endre navn, lagre tilbake til malen (diskett), flagg og endre rekkefølge. *EzProp: høy.*
15. **Valg av første fane i V10.** Takstmannen velger om avvik, info eller begrensninger vises først, og kan få flaggede kommentarer øverst. Det finnes også et valg om å skjule menyen (fullskjerm). *EzProp: middels.*

**Maler**

16. **«Classic Ratings»** (Template Settings → Item Ratings). Dette er den smarteste tidsbesparelsen:
    - Valgene henger sammen: trykker man «NI», fjernes «IN».
    - Kommentarer vises og skjules ut fra vurderingen.
    - «Ikke undersøkt» eller «ikke til stede» teller som fullført i fremdriften.
    - Det lages en begrensningskommentar automatisk, for eksempel «Microwave not present».

    *EzProp: høy.* TGIU bør automatisk gi en ferdig formulering om hvorfor noe ikke er undersøkt.
17. **Malverktøy.** Alfabetisk sortering, sortering av avvik etter mest brukt, og «fjern alle anbefalinger om fagperson». *EzProp: middels.*
18. **Kopiere malinnstillinger mellom maler, og dele mal med en annen takstmann eller et annet firma** (malen klones). *EzProp: høy.* Dette er nøkkelen for samarbeid mellom flere selskaper.
19. **Fem måter å lage mal på.** Fra malbiblioteket, fra tom mal, ved kloning, ved import fra et annet program, og fra regneark (.xls/.xlsx). *EzProp: middels.*
20. **«Changes to these settings only affect future reports».** Rapporter som er påbegynt, endres ikke. *EzProp: høy.* Malen bør ha versjoner, og en rapport bør låses til malversjonen den ble startet med.
21. **PDF-valg** (Template Settings → Display Options):
    - innholdsfortegnelse med klikkbare lenker
    - avviksliste først med lenker
    - hver seksjon på ny side
    - om en kommentar kan deles over to sider
    - egen bunntekst
    - «Minimize Whitespace» (korte og lange kommentarer skilles)
    - telling av «Items Inspected»
    - signatur

    *EzProp: høy.*
22. **Sammendrags-PDF.** Den kan vise antall per kategori i fargede bobler, og finnes som ren tekst uten bilder. Ordet for avvik kan også velges («Defect Label»). *EzProp: middels.*

**Nettrapport og PDF (det kunden ser)**

23. **Venstremeny med antall avvik per seksjon.** Taket viste for eksempel en blå «1». Oppsummeringsboblene øverst («1 TG2 Vesentlig avvik») er klikkbare. *EzProp: høy.*
24. **Filterknapper.** Full rapport, Sammendrag og én knapp per kategori. Når filteret er på, vises «You're currently not viewing the full report – VIEW FULL REPORT». *EzProp: høy.* Brukeren skal aldri tro at han ser alt når et filter er på.
25. **PDF-menyen i nettrapporten.** Den har valgene Summary, Full Report og «Refresh PDFs». PDF-en ligger ferdig lagret, og kan lages på nytt etter retting. *EzProp: høy.* Passer med levende rapport (ADR 0006).
26. **«Observations Copy-and-Paste Text»** (under Report Tools). Alle avvik vises som kopierbar tekst med nummer, sted og «SELECT ALL», og med merknaden «not meant to be final». *EzProp: middels.* Megler og kjøper kan lime teksten inn i egne dokumenter.
27. **«Share with your agent»** i rapporten. Kjøperen legger selv til sin megler. *EzProp: middels.* Hos oss styrer megler kjøperens tilgang.
28. **«Make A Sample Report».** Rapporten blir en offentlig eksempelrapport på firmaprofilen. *EzProp: lav.*
29. **Mobilvisning av nettrapporten.** Den har hamburgermeny og ikonknapper for full rapport, sammendrag, kategori og PDF. Det virker, men forsiden blir rotete (se svakheter nedenfor). *EzProp: høy* å gjøre bedre.

**Dashbord, kalender, varsler og konto**

30. **Egen tekst når man holder pekeren over en avtale i kalenderen.** Hvor: Settings → Calendar Options. Teksten bygges med plassholdere (adresse, areal, byggeår, kunde, megler, pris, notater) og kan bruke egne bestillingsfelt (`{{CUSTOM_FIELD_…}}`). *EzProp: middels.*
31. **Kart med kjørerute for dagen.** Visningen «I dag» har startadresse og arbeidsdag fra–til. Man kan også velge hvor mange uker eller dager bakover kalenderen viser. *EzProp: middels.*
32. **Varselinnstillinger per kategori.** Kategoriene er betaling, booking, abonnement, kommunikasjon og integrasjoner, og hver kan gå på e-post, i appen eller begge. Eksempler: betaling mottatt, kunden ber om tilleggstjeneste, e-post kom ikke fram, SMS feilet, kontaktimport ferdig, Google Drive mistet tilgang. *EzProp: middels.*
33. **Varsel når en mal eller avtale slettes mens tjenester bruker den.** *EzProp: middels.* Det beskytter mot «tomme» bestillinger.
34. **Varselsenter på dashbordet.** Det har faner (firma/oppdrag), «Show Dismissed» og sortering. *EzProp: lav.*
35. **Globalt søk.** Søkefeltet finner oppdrag ut fra navn på kunden («Kari» ga Testveien 1). *EzProp: høy.*
36. **«Change Role».** En bruker med flere roller eller selskaper bytter visning uten å logge ut. Organisasjonsverktøyet deler maler, avtaler og automatiseringer mellom selskaper. *EzProp: høy.* Dette er kjernen i samarbeid mellom flere selskaper.
37. **Oppdragslisten.** Den har hurtigfilter (i går, i dag, i morgen, framtidige, ubekreftede, pågående), «Customize Columns», eksport og «Undelete Inspections». *EzProp: middels.*
38. **Tofaktorinnlogging** som låser kontoen i 15 minutter etter 8 feil koder. *EzProp: høy.*
39. **Avtaleinnstillingen «Hide inspector name and photo».** Den gjelder bare avtaler som ikke er signert. Signerte avtaler beholder innstillingen de hadde da de ble signert. *EzProp: middels.* Prinsippet er viktig: det som er signert, fryses.
40. **Lokalisering.**
    - Det advares om at bytte av tidssone endrer alle oppdragstider.
    - Landkode for SMS kan velges.
    - Feltet «County» kan slås av eller få et annet navn.

    *EzProp: middels.*
41. **Hjelp når man holder pekeren over hver plassholder** («The client's name (i.e. 'John Smith')»). Notatfeltet på takstmannen kan brukes som plassholderen `{{INSPECTOR_NOTES}}` i avtaler og kommentarer. *EzProp: middels.*

**Svakheter vi bør unngå (sett i testen)**

- **Klokkeslettet vises forskjellig.** Oppdraget står som 8:00 i kalenderen, men 02:00 pm i oppdragslisten og søket. Det er en tidssonefeil.
- **PDF-en har feil og mye luft.** Den skriver interne ID-er («section-Njk4OTY5…») under hver seksjonstittel. Tomme seksjoner får hver sin side, så ett avvik ble til 19 sider.
- **Kartfeil på forsiden.** «The specified location could not be found» legger seg over adressen på forsiden og i mobilvisningen.
- **Data forsvinner ved bytte av versjon.** Bytte fra V10 tilbake til V9 tok ikke med noe. Det ble laget en tom rapport, og originalen ble slettet (den kunne gjenopprettes). EzProp bør ha én datamodell uten versjonsbytte.
- **Ingen kroner.** Kostnadsestimatet vises bare i dollar.

## 2. Ting som gjør iPad- og mobilbefaring lettere

Kilde: Spectoras hjelpesider om V10-appen og koden til V10-editoren på nett (editor-next.spectora.com).

- **Synkronisering:**
  - Den kan gå automatisk eller manuelt.
  - Med nett sendes data cirka 3 sekunder etter at det er skrevet inn.
  - Uten nett lagres alt lokalt («sync status»), og sendes når appen er åpen og har nett.
  - Appen prøver igjen med stadig lengre pauser.
  - Brukeren får varsel om data som ikke er synkronisert.
  - *EzProp: høy.* Automatisk som standard, og alltid synlig status: «3 endringer venter».
- **Endringssett per del.** Hver endring på seksjon, punkt, kommentar, bilde og rapport lagres som en egen endring. Dermed kan to takstmenn jobbe samtidig, for eksempel én med telefon på taket og én med iPad inne, og arbeidet flettes sammen. Spectora anbefaler at de tar hver sine seksjoner. *EzProp: høy.* Samme person kan være innlogget på to enheter.
- **Lokal database i nettleseren med trygg oppstart uten nett.** Editoren lagrer lokalt og tar et øyeblikksbilde av rapporten («Creating a local snapshot…»). Uten nett åpnes den med «Open last report» og meldingen «Your saved data is safe. Reconnect to sign in again». *EzProp: høy.* Når innloggingen har gått ut, må takstmannen fortsatt kunne jobbe uten nett.
- **Tydelige feilmeldinger ved lagring:** «Save failed. Try again in 30 seconds», «Failed to sync local changes». *EzProp: høy.*
- **Serie-kamera («Rapid Fire»).** Det tar mange bilder etter hverandre. Bildeformat, blits, zoom og rutenett kan stilles inn, og det huskes til neste gang. Fra galleriet kan man legge til mer enn 15 bilder om gangen. *EzProp: høy.*
- **Tegning på bilder.** Etter hvert bilde kan tegneverktøyet åpnes automatisk, for alle bilder eller bare avviksbilder. Det har piler, sirkler og tekst, og bilder kan roteres. *EzProp: høy.*
- **Lagring i iPadens bildealbum.** Bildene kan lagres der, merket med adressen. Det gir «bevisbilder» som ikke kommer i rapporten. Bilder med tegning kan også lagres der. *EzProp: middels.*
- **HEIC-bilder støttes ikke** hos Spectora. Brukeren må endre kamerainnstillingen selv. *EzProp:* konverter automatisk.
- **Søkeinnstillinger i appen.**
  - søk i titler eller i titler og tekst
  - alltid søk i hele rapporten
  - vis bare de 20, 50 eller 100 mest brukte
  - glidebryter for hvor mange skrivefeil søket tåler

  *EzProp: høy* (særlig toleranse for skrivefeil med hansker på).
- **Færre trykk med «Classic Ratings».** Valgene henger sammen, og det lages automatisk kommentar når noe ikke er undersøkt eller ikke finnes (se punkt 16).
- **Hurtigmerker for sted i tre grupper.** Etasje, himmelretning og rom, pluss fritekst. *EzProp: høy.* Bruk norske standardlister.
- **Fremdriftsmåler og krav om fullført før publisering.** Et punkt teller som ferdig når det er vurdert. *EzProp: høy.*
- **Tilpasning av visningen.** Lys, mørk eller systemtema, og fem tekststørrelser. Mørk modus er nyttig på loft og i kjeller. *EzProp: middels.*
- **Feilsøking i appen.** Den har «Reset app memory», «Send debug information» og «Reset to server version». *EzProp: middels.* Bygg det, men gjør det sjelden nødvendig.
- **Bekreftelse før et bilde slettes** («Are you sure? Image will be deleted»). *EzProp: høy.*

## 3. Hva jeg endret i kontoen

- **Testinspeksjonen (Testveien 1) er nå V10 i stedet for V9.**
  - Den ble først gjort om til V10 for å prøve V10-editoren. Det gikk ikke, fordi kontoen er utløpt.
  - Så ble den gjort om tilbake til V9. Da laget Spectora en tom V9-rapport og slettet den opprinnelige rapporten.
  - Jeg gjorde den om til V10 igjen, hentet tilbake den opprinnelige rapporten (3cd288f9) med «Undelete» og slettet den tomme kopien (den kan fortsatt hentes tilbake).
  - Jeg har kontrollert i nettrapporten at TG2-avviket, stedet «Sørvendt takflate» og kostnaden 15 000–30 000 er med.
  - **Følgen:** Rapporten kan ikke redigeres nå. Den er V10, og V10-editoren er sperret fordi kontoen er utløpt. Et nytt bytte til V9 ville igjen gitt en tom rapport.
- **Det ble opprettet og slettet én tom rapport (44ec1475).** Den ligger under «Undelete».
- **Ingen innstillinger er endret med vilje.** Jeg åpnet seksjoner, dialogvinduer for å flytte befaringen, eiendomsdata og deling, og kalendertekst, men lukket dem uten å lagre.
- **Ikke gjort:**
  - ingen e-post eller SMS sendt
  - ingen betaling, abonnement eller Advanced-prøve
  - ingen tilkoblinger
  - ingen endring av passord eller e-post
  - ny innlogging var ikke nødvendig
- **Lokale filer** (bare i scratchpad):
  - skript og skjermbilder i `/tmp/claude-0/-home-user/b66b5c74-17a0-5297-937a-387efe6ff0c0/scratchpad/spectora/detaljer/`
  - rapport-PDF og sammendrag i `/tmp/claude-0/-home-user/b66b5c74-17a0-5297-937a-387efe6ff0c0/scratchpad/spectora/detaljer/pdf/`
  - hjelpeartikler om V10 i `/tmp/claude-0/-home-user/b66b5c74-17a0-5297-937a-387efe6ff0c0/scratchpad/spectora/detaljer/docs/`
