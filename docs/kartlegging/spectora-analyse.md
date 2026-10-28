# Spectora – hva kan Byggcon lære?

Sist oppdatert: 22.10.2026
Status: Utkast – ikke godkjent.
Kilde: Spectoras offentlige hjelpesenter https://support.spectora.com/en/. Lest av en Claude-hjelpeagent 22.10.2026 (ca. 70 artikler i sin helhet, artikkellister i alle viktige kategorier). Artikkel-ID-er står i parentes (`/12345` = https://support.spectora.com/en/articles/12345). Selve appen er ikke testet ennå. Ståle har innlogging, og det kan gjøres senere.

**Bakgrunn:** Ståle mener Spectora er mye bedre enn IVIT på CRM, kundedata, smarte funksjoner og bruk av KI. Vi bruker Spectora som inspirasjon for disse delene, og IVIT/NS 3600 for selve rapportinnholdet. [Kilde: Ståle 22.10.2026]

**Merk:**
- «Trolig ikke i IVIT» er agentens vurdering og må bekreftes.
- Agenten skrev at forskriften har faste kostnadsintervaller (under 10 000 / 10–50 000 / 50–150 000 / 150–300 000 / over 300 000 kr). Det fant vi **ikke** i forskriften (lest 22.10.2026), som bare krever et «sjablonmessig anslag» ved TG3. Påstanden er ikke bekreftet. Se åpne spørsmål.

## 1. Moduler og arbeidsflyt

1. **Bestilling:**
   - Booking-side for kunde eller megler, der tjeneste, adresse og tid velges (/5739524).
   - Pris og varighet regnes ut automatisk etter areal, byggeår, sted og egne felt (/2426757).
   - Areal og byggeår hentes fra offentlige registre (/11534626). Tilsvarende hos oss: matrikkelen.
2. **Avtale og betaling før befaring:** Oppdragsavtale signeres elektronisk i kundeportalen og fylles ut automatisk (/8695081). Rapporten er låst til avtale og betaling er i orden (/3854452).
3. **Mal:**
   - Tre nivåer: seksjon → punkt → kommentar. Kommentaren er av typen informasjon, begrensning eller avvik (/2410690).
   - Import fra regneark (/6198400) og delt malbank (/2678922).
4. **App:**
   - Fungerer uten nett, og synker automatisk eller manuelt (/1823269, /6203753).
   - Flere takstfolk kan jobbe i samme rapport (/5572613).
   - Bildeannotering, video, 360-bilder, flagg og huskelapper.
5. **Rapportbygging på PC:** søk og bildesenter der bilder dras til riktig sted (/11145942, /11428169).
6. **Kvalitetskontroll:** Rapporten kan ikke publiseres før alt er utfylt (/3698031). Det finnes godkjenningskø for de som ikke har publiseringsrett (/3488645, /9732590).
7. **Levering:**
   - Nettrapport og PDF i kundeportalen (/6245789).
   - Logg over hvem som har åpnet rapporten (/2426698).
   - Reparasjonsliste (/2155740) og etterkontroll (/4802184).
8. **CRM og megler:**
   - Kontaktregister med automatiske merkelapper (/8067074).
   - Rapporter om meglere: nye, inaktive og de som gir mest omsetning (/6272903).
   - SMS og anmeldelser.
9. **Team og administrasjon:** roller og rettigheter (/3488645), endringslogg (/6226657), oppgaver (/8107198), utstyr og hvem som kan utføre hvilke tjenester (/2940397).
10. **Integrasjoner:** regnskap, kalender, Zapier, åpent API og webhooks, og en KI-kobling (MCP) som bare kan lese (/15468008).

## 2. Funksjoner som passer i Norge

| Funksjon | Bruk hos Byggcon | Nytte |
|---|---|---|
| Kommentartyper: informasjon / begrensning / avvik (/2410690) | Beskrivelse / ikke undersøkt / TG-avvik med årsak, konsekvens og tiltak | Høy |
| Egne vurderingsskalaer med farge og oversiktstabell (/1757562) | TG0–TG3 og TGIU, med TG-oversikt per rom. Låses strengere enn hos Spectora. | Høy |
| Svartyper: avkrysning, flervalg, tall, intervall, dato, signatur (/5921294) | Materialvalg, alder, fuktmåling, areal | Høy |
| Valgfrie seksjoner (/1585151) | Vi går lenger: hvis–så-regler fra romtype og materiale | Høy |
| Kostnadsanslag per avvik (/3697326) | Påkrevd ved TG3 | Høy |
| Krav om fullført før publisering (/3698031) | Forskriftskrav som stopper levering | Høy |
| Offline-app med synk (/1823269) | iPad på befaring | Høy |
| Bildeannotering med farge etter alvorlighet (/1563692) | Fargen følger TG | Høy |
| Lagre tekst i malen fra rapporten, sortere etter mest brukt (/3811466, /6666155) | Frasebank som vokser, men med godkjenning | Høy |
| Godkjenningskø (/9732590) | Sidemannskontroll (vi bygger med logg over hvem som godkjente) | Høy |
| Visningslogg (/2426698) | Dokumenterer at rapporten er levert og lest. Trolig ikke i IVIT. | Høy |
| Kundeportal (/6245789) | Selger: signere oppdrag, fylle ut egenerklæring, se og kommentere utkast, få faktura. Megler: hente rapport. | Høy |
| Automatiske meldinger med regler (/8913137) | Bekreftelse, påminnelse om egenerklæring, utkast klart, levert, purring | Høy |
| Endringslogg (/6226657) | Vi bør også logge endringer i rapportteksten. Det gjør ikke Spectora. | Høy |
| API og webhooks (/15468008) | eAccounting, levering til megler | Høy |
| Flere takstfolk i samme rapport (/5572613) | Store boliger, opplæring | Middels |
| Stedsmerker, flagg og huskelapper (/2141790, /9457449, /1922349) | «Bad 2. etg.», «må fullføres på kontoret», NS 3600-krav per rom | Middels |
| Etterkontroll (/4802184) | Oppfølging etter utbedring, oppdatering av rapport eldre enn 12 måneder | Middels |
| Oppgaver og statistikk (/8107198, /6272903) | Purringer, omsetning per megler og takstmann, andel TG3 | Middels |
| Bildesenter på PC (/11428169) | Raskere ferdigstilling | Middels |
| Video og 360-bilder (/9353717, /3944237) | Sluk, fall, oversikt over våtrom | Lav til middels |

## 3. Smarte funksjoner

- **Regelstyrte meldinger** (/8913137, /5412959): hendelse + og/eller-betingelser → e-post, SMS eller webhook, med status og forklaring. Datoer kan også utløse meldinger, for eksempel «ett år etter befaring» (/6841037).
- **Rapporten bygges før befaringen** (/9640467). Hos oss kan den forhåndsutfylles fra matrikkel, tidligere rapport og egenerklæring.
- **Signaturfelt i rapporten** (/2441556).
- **Reparasjonsliste for kjøper** (/2155740): ikke som forhandlingsverktøy fra takstmannen. Det kan svekke uavhengigheten.
- **Dashbord og dataeksport** (/6048111, /7150871).

## 4. KI i Spectora

| Funksjon | Hva | Begrensninger |
|---|---|---|
| AI Comment Assist (/13907458) | Kort stikkord → forslag til tittel, valg og tekst i ulik lengde | Krever nett. Brukerne klager over for lange tekster med mange forbehold, og over at funksjonen ikke kan slås av. |
| Match (/15088862, tidlig tilgang) | Takstmannen snakker og tar bilder. KI-en gjør tale om til tekst og finner riktig kommentar i malen. Ingenting kommer inn uten godkjenning. Virker offline med kø. | Leverandøren oppgir ca. 25 % sparte tid. Bilder knyttes ikke automatisk til funn. |
| AI Message Assist (/13518824) | Skriver e-post og SMS | Tidlig tilgang |
| MCP-kobling og arbeidsflyter (/15468008, /15467882) | KI-assistent som leser driftsdata: ukesjekk, dagsbrief, meglere som har falt fra | Kan bare lese. Rapportinnhold er ikke tilgjengelig. |

Spectora har **ikke** KI for bildeanalyse, sammendrag eller kvalitetskontroll av rapporten. Her kan Byggcon være først.

**KI-forslag for Byggcon:**
1. **Tekstforslag til årsak, konsekvens og tiltak:**
   - Bygger på Byggcons godkjente frasebank, og tar hensyn til bygningsdel, materiale, alder, levetid og målinger.
   - Foreslår også TG, med begrunnelse.
   - Korte tekster, og takstmannen bestemmer alltid.
2. **Tale til tekst offline:** norsk fagordliste (membran, sluk, fallforhold …), koblet mot sjekkpunkter og fraser.
3. **Bildeanalyse:** foreslår bygningsdel, og varsler om manglende bilde ved TG2/TG3 eller når hulltaking mangler.
4. **Kvalitetskontroll før levering:**
   - Regler: TG3 uten kostnad, manglende årsak/konsekvens/tiltak, levetid mot alder.
   - KI-sjekk: motstrid mellom tekst og TG, avvik fra egenerklæringen, uklart språk.
   - Gir én liste til sidemannskontrollen. Kobles til skillen `byggcon:sidemannskontroll`.
5. **Utkast til sammendrag** for megler og kjøper.
6. **Personvern:** behandling i EU/EØS, databehandleravtale, og mulig å slå av.

## 5. Passer ikke i Norge

- Amerikanske delstatsskjemaer og lisensregler.
- Stripe, ACH og betaling ved oppgjør (Pay at Close). Hos oss: faktura via eAccounting, eventuelt Vipps.
- Amerikanske registerdata og kvadratfot.
- Mersalg av forsikring og garanti, og håndverkertilbud. Det kan svekke uavhengigheten.
- Den amerikanske meglermodellen der megler er lead-kilde. Forskriften § 1-3 krever uavhengighet.
- Amerikanske SMS-regler.

## 6. Topp 10 for Byggcons system

1. **Regelstyrt kontroll før levering** (forskrift og NS 3600) og sidemannskontroll med logg.
2. **Dynamiske sjekklister:** hvis–så-regler for rom, materiale og alder, og TG-forslag fra levetidstabellen.
3. **Robust offline på iPad:** synkstatus, og flere takstfolk i samme rapport.
4. **Frasebank som lærer:** lagre fra rapporten, mest brukt øverst, og godkjenning før en frase blir felles.
5. **KI-tekstforslag** fra egen frasebank (korte tekster, kan slås av).
6. **Tale til tekst offline**, koblet mot sjekkpunktene.
7. **Kundeportal for selger og megler:** egenerklæring, utkast, signering og visningslogg.
8. **Automatiske meldinger** med regler.
9. **Bilder:** annotering i TG-farge, stedsmerker, bildesenter, varsel om manglende bilder.
10. **Logg og integrasjoner:** full endringslogg, etterkontroll, API/webhooks (eAccounting, megler) og statistikk.

## 7. Åpne spørsmål

- **Kostnadsintervaller:** Hvilke skal vi bruke? IVIT bruker under 20 000 / 20–100 000 / 100–200 000 / 200–500 000 / over 500 000 kr. Agenten påsto at forskriften har andre intervaller, men det er ikke bekreftet. Sjekk veiledningen fra Direktoratet for byggkvalitet.
- **Test av appen:** Skal vi teste selve Spectora-appen med Ståles innlogging (CRM, portal, malredigering)?
