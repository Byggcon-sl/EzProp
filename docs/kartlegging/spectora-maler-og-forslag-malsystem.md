# Spectora: malsystemet, og forslag til malsystem i EzProp

Sist oppdatert: 24.10.2026
Status: Utkast – ikke godkjent.
Kilde: En Claude-hjelpeagent i Spectoras prøvekonto 24.10.2026. Den brukte skjermen og dataene nettleseren henter i bakgrunnen, og laget en testmal for våtrom, også via regneark-import.

## 1. Slik er malene bygd i Spectora

**Tre nivåer:** seksjon → punkt → kommentar, redigert i tre kolonner med automatisk lagring.

- **Seksjon:**
  - navn og ikon
  - alltid med, eller valgfri (grå, legges til per rapport)
  - «Standards of Practice»: standardtekst i en egen fane i rapporten
  - påminnelser til takstmannen i appen
- **Punkt:**
  - alltid med eller valgfritt
  - «Info Item»: bare beskrivelse, uten vurdering
  - påminnelser
- **Kommentar** i tre grupper: informasjon, begrensning og avvik (navnet kan endres, f.eks. «Avvik»). Kortet har:
  - **sju svartyper:** ja/nei, flervalg, dato, tall, tallintervall, signatur og tekst
  - valg og standardvalg
  - **enheter** per tallfelt (f.eks. mm/m og % RF) og standardverdi
  - **standardsted** fra firmaets stedsmerker (etasje, himmelretning, rom)
  - standardtekst med formatering, lenker, bilder og tabeller
  - opptil 10 **standardbilder**
  - «avkrysset fra start»
- **Avvik i tillegg:**
  - kategori (1–3 nivåer)
  - anbefalt fagperson (fast amerikansk liste)
  - **kostnad min–maks** (bare dollar)
  - **bruksteller** («mest brukt»)
- **Vurderinger:**
  - **Classic:** IN/NI/NP. Vurderingene henger sammen med kommentarene. NI/NP gir automatisk tekst om begrensning og teller som ferdig.
  - **Custom:** egne vurderinger med navn, forkortelse og farge, men uten kobling til kommentarene.
- **Vedlegg per mal:** en fil som legges ved hver rapport.

## 2. Styrker, og vurdering for EzProp

| Detalj | EzProp |
|---|---|
| Tre kolonner med alt redigert på samme sted og automatisk lagring | Høy |
| Kommentarkortet har alle felt på ett sted | Høy |
| Sju svartyper, også intervall, dato og signatur | Høy |
| Enheter per tallfelt, og standardverdier og standardvalg | Høy |
| Valgfrie seksjoner og punkter (styres av rom hos oss) | Høy |
| «Info Item» for punkter som bare beskriver (f.eks. byggegrunn) | Høy |
| Egne vurderinger med farge, vist som rutenett i rapporten | Høy |
| Påminnelser per seksjon og punkt i appen | Høy |
| Standardtekst per seksjon (hos oss: kontrollnivå og forutsetninger per bygningsdel) | Høy |
| Standardsted med hurtigknapper | Høy |
| Kostnad per avvik som standard | Høy (i kroner, med Byggcons intervaller) |
| Bruksteller og «mest brukt» | Høy |
| Velge flere kommentarer og kopiere eller flytte dem, også til en annen mal | Høy |
| **Eksport og import med regneark** (42 kolonner, testet begge veier – testmalen ble laget på sekunder) | Høy |
| «Generer eller rediger med KI» der brukeren velger hvilke felt som skal brukes | Høy (på norsk) |
| «Endringer gjelder bare nye rapporter» står tydelig | Høy |
| Papirkurv for seksjoner, punkter og maler | Høy |
| Automatisk tekst ved «ikke undersøkt» (hos oss TGIU) | Høy |
| Låser på seksjon, punkt og kommentar (finnes bare for Spectoras egne administratorer) | Høy (for vår fagansvarlige) |
| Standardbilder per kommentar (forklarende skisser) | Middels |
| Duplisere og flytte, og kopiere malinnstillinger | Middels |
| Import fra andre program (HomeGauge, Home Inspector Pro, InspectIT) | Middels (import fra IVIT) |
| Malbibliotek med forhåndsvisning, og deling av mal (kopi) | Middels |

**Regnearkformatet:** én rad per kommentar. Kolonnene er:
- seksjon, punkt, kommentar og tekst
- type og kategori
- valg og enheter
- fagperson og rekkefølge
- svartype og standardverdier
- sted og kostnad min–maks
- låst
- standardbilder

**Mangler i eksporten:** vurderinger, malinnstillinger, standardtekster og påminnelser.

## 3. Begrensninger i Spectora

1. **Ingen betingelser.** «Materiale = X → vis spørsmål Y» finnes ikke.
2. **Ingen regler.** Tall, år og alder gir aldri forslag til avvik eller TG, og tallfelt har ingen grenser.
3. **Vurdering og avvik er ikke koblet.** TG må legges inn to ganger, og ingenting hindrer TG0 på et punkt med TG3-avvik.
4. **Høyst tre avvikskategorier.** HMS kan ikke bli en egen type.
5. **Årsak, konsekvens og tiltak er ikke egne felt.** Alt er én fritekst.
6. **Kostnad bare i dollar**, uten faste intervaller.
7. **Ingen obligatoriske felt**, og ingen kobling til forskriften.
8. **Ingen versjoner, historikk eller forskjellsvisning.**
9. **Sletting av en kommentar skjer med en gang, uten bekreftelse eller angre.**
10. **Deling er bare kopi.** Det finnes ingen felles mal med arv og oppdateringer.
11. **Ingen godkjenning av endringer.**
12. **Engelsk oppsett og amerikansk fagpersonliste.** KI-en skriver engelsk.

## 4. Tilpasning til norsk marked

[Ramme fra Ståle 24.10.2026: megler engasjerer før salget, og det er ingen betaling i systemet.]

Spectoras maler er laget for en kjøper som bestiller etter kjøpet, og avvikene brukes som grunnlag for å kreve prisavslag.

**I EzProp:**
- Ingen tekster om betaling, krav om prisavslag eller «reparasjonsforespørsel».
- Sammendraget skrives nøytralt for selger og kjøper via megler.
- Kostnad er et sjablonmessig anslag (forskriften § 2-22), ikke et forhandlingskrav.
- Faste tekster kommer fra forskriften og NS 3600 i stedet for amerikanske «Standards of Practice».

## 5. Forslag: malsystemet i EzProp

**Prinsipp:**
- Behold det Spectora gjør godt: rask redigering, alt på ett kort, regneark, «mest brukt», flytte og kopiere.
- Legg til regler, versjoner, arv og godkjenning.

**Datamodell (forenklet):**
```
Malfamilie      «Tilstandsrapport bolig», eier = Byggcons fagansvarlig
Malversjon      versjonsnr, NS-utgave, forskriftsversjon, status (utkast/til godkjenning/godkjent/utgått),
                gyldig fra, laget av, godkjent av, endringsnotat
Overlegg        per selskap eller oppdragsgiveravtale (f.eks. Fremtind): tillegg og innstramminger,
                arver resten, kan ikke fjerne låste punkter
Seksjon         bygningsdel/rom, romtyper, standardtekst (kontrollnivå), påminnelse
Kontrollpunkt   obligatorisk + §, gir TG (ja/nei), boligtyper, «ses i sammenheng med», låst
Felt            type, enhet, gyldig område, obligatorisk, standardverdi, materialkode per valg, vises når …
Avviksspørsmål  tekst, vises når (alltid | felt = X | tall > grense | alder > levetid)
Utfall          TG2/TG3/TGIU/HMS, avvikstekst, årsak, konsekvens, tiltak, kostnadsintervall i kroner, kilde
Regel           hvis <uttrykk> → foreslå utfall med begrunnelse; takstmann bekrefter eller avviser
Levetid         materialkode, år med/uten dokumentasjon, NS-utgave
Frase           kontrollpunkt og felt, eiernivå (felles/selskap/person), bruksteller, status
Rapport         låst til malversjon og overlegg ved oppstart
```

**Viktige regler:**
- **TG er én egenskap per avvik.** TG for kontrollpunktet regnes ut som høyeste utfall.
- **Betingelser og regler** bygges i et skjema av fagansvarlig, ikke i kode. Eksempler:
  - fall under grensen → foreslå TG2
  - banemembran → vis eget spørsmål
  - byggeår + levetid → foreslå TG2
- **En rapport låses til malversjonen den ble startet med.** Rapporter som ikke er publisert, får tilbud om å oppgradere og kan se forskjellen. Publiserte rapporter endres aldri av en mal.
- **Én felles kjernemal for de tre selskapene**, eid av fagansvarlig. Selskaper og oppdragsgiveravtaler har overlegg som arver kjernen.
- **Ingen permanent sletting.** Sletting krever bekreftelse og kan angres.

**Redigeringsflyt for fagansvarlig:**
1. «Ny versjon» lager et utkast fra gjeldende versjon.
2. Redigering i tre kolonner. Kortet har fanene «Felt», «Spørsmål og utfall», «Regler» og «Fraser».
3. **«Prøv malen»:** testskjema som viser hvilke spørsmål og TG-forslag som kommer.
4. **Automatisk kontroll:** obligatoriske punkter etter forskriften finnes, TG3 har kostnad, og ingen regler peker på slettede felt.
5. **Send til godkjenning** med forskjellsvisning og endringsnotat. En annen person godkjenner.
6. **Publiser** med «gyldig fra» og NS-utgave. Overlegg som rammes, flagges.
7. **Regneark inn og ut med stabile ID-er**, også for innstillinger, regler og vurderinger.
8. **Forslag fra takstmenn:** De kan foreslå nye fraser fra rapporten («lagre til mal»), og fagansvarlig godkjenner.

## 6. Opprettet i prøvekontoen

- **Testmalen** «EzProp TEST - Vatrom (Claude)», med materialvalg, målefelt, TG0–TGIU og to avvik med kostnad.
- **Malen** «Imported from XLS – 10/24/2026», laget av testregnearket.
- **Én eksport til regneark.**
- **Ingen andre endringer.** Testmalene kan slettes senere.
