# Kartlegging: alle kontrollpunkter i IVIT (tilstandsrapport bolig)

Sist oppdatert: 25.10.2026 (antall rettet og avsnitt 8 oppdatert)
Første versjon: 23.10.2026
Status: Utkast – observasjon i IVIT, ikke godkjent.
Kilde: Testrapport i IVIT (mal «NS3600 2025 – Generell»), enebolig. Testet automatisk natt til 23.10.2026: alle valg og alle «Ja»-svar på de faste kontrollpunktene + kjøkken. Taktekking og bad står i `kravdokument.md` og `kartlegging-bad.md`. IVITs tekster er ikke kopiert. Her står tema og TG.

**Antall faste kontrollpunkter per bygning: 40.** Talt i tabellene under: 10 utvendig (avsnitt 2), 11 innvendig (avsnitt 3), 10 tekniske installasjoner (avsnitt 5) og 9 tomteforhold (avsnitt 6). Listen i `kravdokument.md` 2.6 a har de samme 40. *Rettet 25.10.2026: Her sto tidligere 37, og i `kravdokument.md` sto det 47.* I tillegg kommer de romstyrte punktene (avsnitt 4).

Forklaring:
- **TG2 / TG3:** TG som settes automatisk ved «Ja».
- **Velg:** Takstmannen velger mellom TG2- og TG3-variant.
- **HMS:** Spørsmålet gir HMS-avvik uten TG.
- **TGIU:** Gir «ikke undersøkt».
- **Obl.:** Om IVIT selv merker punktet som obligatorisk etter forskriften.

## 1. Viktigste funn på tvers

1. **IVIT skiller selv mellom obligatoriske og frivillige punkter.** Mange punkter har en merknad om at punktet ikke er obligatorisk etter forskriften, men bør fylles ut ved åpenbare avvik («profesjonsansvar»). Det stemmer med Byggcons prinsipp: **forskriften bestemmer hva som skal undersøkes.** [Ståle 22.10.2026] Vårt system bør ha et felt per kontrollpunkt for obligatorisk etter forskriften (med §) eller frivillig.
2. **Materialvalg viser riktig aldersspørsmål, men alder brukes ikke automatisk.**
   - Rør, septiktank og varmepumper: når materialet velges, kommer aldersspørsmålet med levetiden fra NS 3600 tillegg C. Eksempler: PVC-avløp «eldre enn 35 år?», glødde kobberrør «eldre enn 15 år?», septiktank i stål «eldre enn 25 år?».
   - Andre aldersspørsmål står fast uten materialvalg: bereder over 20 år, isolerglass over 35 år, drenering over 30 år eller før 2000, vanntett sjikt over 18 år.
   - **Takstmannen må svare ja/nei selv**, selv om alderen er registrert i samme skjema.
   - **Vårt system:** Materiale + år → TG2-forslag automatisk, med kilde (tabell C.x). Ståles idé, og den viktigste forbedringen vi har funnet.
3. **Målinger er ja/nei, ikke tall.**
   - Eksempler: etasjeskiller «lokal høydeforskjell over 15 mm?», «nivåforskjell over 25 mm?», «total over 30 mm?», vinduer «flere enn 3 punkterte ruter?» og rekkverk «under 0,90 m?».
   - **Vårt system:** Takstmannen skriver inn tallet (mm, antall, høyde). Systemet setter avvik og TG-forslag selv og viser målingen i rapporten.
4. **Rekkverk, trapper, pipe, snøfangere, el, brann, radon og skred/flom er bare HMS.** Spørsmålene gir ingen TG. Det stemmer med forskriften (§ 2-13, § 2-18, § 2-21) og NS 3600:2025+AC.
5. **Mange avvik har både TG2- og TG3-variant.** Takstmannen velger etter alvorlighet. Vi bør beholde det.
6. **Snødekke gir egne TGIU-spørsmål** på tak, balkong, terrasse, forstøtningsmurer og terreng.
7. **Mange punkter viser til hverandre.** Eksempel: «Punktet må ses i sammenheng med Fuktsikring og drenering». Vi kan lenke punktene sammen i appen.
8. **Valg uten virkning.** Flere valg har ingen synlig effekt, for eksempel type etasjeskiller, trappetype, oljetanktype, gulvtype i våtrom og taktype. De brukes trolig bare som beskrivelse i rapporten.

## 2. Utvendig

| Kontrollpunkt | Valg (og hva de utløser) | Avvik ved «Ja» |
|---|---|---|
| Taktekking | Se `kravdokument.md` 2.6 c–d | 12 + opptil 3 |
| Nedløp, beslag og skorsteiner over tak | – | HMS: snøfangere, adkomst for feier. TG3: ustabil skorstein. TG2: lav skorstein, beslag/gjennomføringer, vann fra nedløp ved grunnmur, beskyttelse under utstyr på tak (solceller osv.). Velg: skader på skorstein/beslag. |
| Takkonstruksjon/loft | Taktype (saltak, flatt, valmet, halvvalmet, pult, mansard), konstruksjon (A- eller W-takstoler, sperrer, stål) | TG3: svekkelser/nedbøyning, fukt/råte, ingen lufting. TG2: fuktskjolder, dårlig lufting, beslag, punktert dampsperre, kondensisolering, loft ikke tilgjengelig og uten dokumentasjon. Velg: skadegjørere. |
| Yttervegger | Konstruksjon: tre ukjent / bindingsverk / tømmer → +1 (fukt/råte i veggen). Betong / mur → +3 (sprekker, brannsikring av isolerte elementer, armeringskorrosjon). | TG3: konstruksjonsskade, uegnet materiale. TG2: lufting nederst på kledning, gnagesikring, skråriss, forhold som gir kortere levetid. Velg: skader på yttervegg. |
| Vinduer og takvinduer | – | TG3: flere enn 3 punkterte ruter. TG2: opptil 3 punkterte, tunge å åpne, kondens, værslitte karmer, isolerglass over 35 år. Velg: råte/store skader, innsetting. |
| Ytterdører | – | TG3: råte/store skader. TG2: innsetting, utett, værslitt, tunge, kondens. Velg: punkterte glass. |
| Balkonger, verandaer, takterrasser | – | HMS: rekkverk mangler, åpninger, høyde. TG3: innfesting, store skader, understøttelse. TG2: nedbøyning, vanntett sjikt over 18 år, sluk, overflateskader, setninger. Velg: tettesjikt, fall, lufting, fukt/råte. TGIU: snødekt. |
| Terrasser og plattinger | – | TG3: store skader. TGIU: snødekt. HMS: rekkverk. Velg: fukt/råte. |
| Utvendige trapper | – | Bare HMS: rekkverkshøyde under 0,90 m, åpninger, mangler rekkverk, dårlig funksjon, løst rekkverk, stående vann/is |
| Andre utvendige forhold (frivillig) | – | TG2: mangler tilstandsrapport eller vedlikeholdsplan for fellesdeler, eller den er uegnet. HMS. |

## 3. Innvendig

| Kontrollpunkt | Obl. | Valg | Avvik ved «Ja» |
|---|---|---|---|
| Overflater – gulv | Bare kjøkken, våtrom og rom under terreng (merket av IVIT) | – | TG3: fuktskadet bakenforliggende konstruksjon. TG2: bom + riss, knirk, slitasje utover alder. Velg: omfattende skader, sopp/mugg, setninger, riss/svelling. |
| Overflater – vegger og himlinger | Bare våtrom og rom under terreng | – | Som gulv, pluss heksesot (TG2) |
| Etasjeskiller og bærende konstruksjoner | Frivillig | Type (trebjelkelag, betong, porebetong, elementer, lettbetong, lettklinker, stål …) | TG3: store nedbøyninger. TG2: merkbare skjevheter (angi måling), lokal over 15 mm, mellom rom over 25 mm, total over 30 mm, endret bæresystem uten dokumentasjon. Velg: sprekk mellom list og gulv. |
| Pipe/skorstein og ildsted | – | – | Bare HMS (9 spm.): brennbart nær sotluke, plate under feieluke, sprekker, synlige pipevanger, avstand til brennbart, plate foran ildsted, fyringsforbud, fundament, tilsynsrapport |
| Rom under terreng | Ja (§ 2-15) | **Hulltaking**: foretatt → +2 (fukt/råte, høyt fuktnivå); ikke foretatt → +5 (fukt i gulv, råte i treverk, fukt i innforede vegger, eier sa nei, ikke nødvendig/mulig) | TG3: synlig vann. TG2: fuktskjolder, riss, støvkondens, konstruksjon med skaderisiko, knirk. Velg: setninger, jordtrykk, sopp, skadedyr. |
| Krypkjeller | Ja (§ 2-14) | Type (under trebjelkelag, under betongdekke) | TGIU: verken utvendig eller innvendig tilgang. **TG2: bare utvendig tilgang** (stemmer med TG-vilkåret i NS 3600). TG3: råte/sopp. TG2: fuktnivå, avskalling. Velg: ventilasjon. |
| Innvendige trapper | – | Trappetype | Bare HMS: åpninger over 10 cm, rekkverk under 0,90 m, opptrinn, håndløper, rekkverk mangler, løst rekkverk, bratt/smal |
| Innvendige dører | Frivillig | – | TG3: betydelige skader. TG2: montering, synlige skader. |
| Skadedyr og fuktkrevende insekter | Frivillig generelt, obligatorisk for enkelte deler | – | TG3: vesentlig svekkelse. TG2: egne funn av insekter, begrenset skade, inntrekksveier for gnagere. Velg: eiers opplysninger, spor/skader. |
| Radon | – | – | Bare HMS: målt over 200 Bq, ikke målt og ingen radonsperre, sperre uten dokumentasjon. (Byggcon bruker tiltaksgrensen 100 Bq/m³ fra NS 3600, LES-MEG 23.10.2026.) |
| Andre innvendige forhold | Frivillig | – | Velg / HMS |

## 4. Rom (styrt av romtype)

| Rom | Kontrollpunkt | Avvik ved «Ja» |
|---|---|---|
| Våtrom | 8 punkter | Se `kartlegging-bad.md` |
| Kjøkken | Overflater og innredning | TG2: fuktindikator ved hvitevarer, utetthet ved rør, fuktskjolder på gulv, knirk, **mangler lekkasjedeteksjon (arbeid etter 1.7.2010)**. TG3: omfattende skader. Komfyrvakt etter 1.7.2010 er HMS. |
| Kjøkken | Avtrekk (frivillig) | Valg: ventilator ut / kullfilter / naturlig / ingen / balansert / mekanisk / sentralt. TG3: manglende/defekt avtrekk, **gassbluss under 65 cm fra hette**, rommet uten ventilasjon. TG2: svakt forsert avtrekk, dårlig tilluft, bare kullfilter. |
| Toalettrom | 3 punkter | Overflater, sanitærutstyr, avtrekk |
| Badstue, fyrrom, kjølerom | 2 punkter | Overflater og konstruksjon, teknisk anlegg |

## 5. Tekniske installasjoner

| Kontrollpunkt | Valg (og hva de utløser) | Avvik ved «Ja» |
|---|---|---|
| Innvendige vannledninger | Rør-i-rør: besiktiget i rørskap → +1 (lekkasjevann i skap ikke ledet til sluk / ingen vannstopp) | TG3: lekkasje. TG2: ufagmessig, kondens/drypp. Velg: hovedstoppekran mangler eller er utilgjengelig, liten vannmengde. |
| Innvendige avløpsrør | – | TG3: skader/utettheter. TG2: lufting, stakemulighet, lukt, ufagmessig, tilbakeslag i servant og i sluk. Velg: dårlig avrenning ved samtidig tapping. |
| Ventilasjon | Type: balansert → +2 (fukt/mugg i filter, svak ventilasjon); mekanisk / naturlig / annet → +2 (avvik fra krav på byggetidspunktet, svak ventilasjon) | TG3: store avvik. TG2: alder (usikker fremtidig funksjon), røyklukt ved bruk av ildsted |
| Varmesentral | Anlegg: luft-luft, væske-vann, luft-vann varmepumpe → +1 aldersspørsmål hver. Oljefyr → +1 (ikke tilpasset bioolje). Også fjernvarme, pellets, gass, el-kjel. | TG3: skader/lekkasje. TG2: ingen service siste 2 år, lukt, korrosjon. Velg: brannsikring, dokumentasjon av brannsikring. |
| Varmtvannsbereder | Størrelse (120/200/300 l, sentral) | TG3: defekt, lekkasje. TG2: fundament, el-tilkobling, avrenning, **eldre enn 20 år**, ikke tilgjengelig. HMS: brunsvidd plugg. |
| Vannbåren varme | – | TG3: lekkasje, fordelerskap. TG2: trege ventiler, funksjonsfeil, alder (tabell C.5) |
| Andre VVS-installasjoner | – | TG2: alder |
| Elektrisk anlegg | El-tilsyn: siste 5 år → +1 (avvik i tilsynsrapport som ikke er utbedret). Over 5 år, eller gjennomgått likevel → +6 (sikringer løser ut, brann/varmgang, kursfortegnelse, termiske skader, kabler, tetting i sikringsskap). Samsvarserklæring: anlegg eller endring etter 1.1.1999 → +2 (mangler, mangelfull). | **Ingen TG** – bare HMS / behov for kontroll av elektriker (§ 2-18) |
| Branntekniske forhold | – | Bare HMS: branncelle, rømningsvei mangler / har mangler, røykvarsler, slukkeutstyr |
| Andre installasjoner | – | TG2: avvik utover slitasje. HMS. |

## 6. Tomteforhold

| Kontrollpunkt | Valg (og hva de utløser) | Avvik ved «Ja» |
|---|---|---|
| Byggegrunn | Løsmasser, leire, fjell, sprengstein, ukjent | **Ingen spørsmål og ingen TG** – bare beskrivelse |
| Fuktsikring og drenering | – | TG2: eldre enn 30 år, lagt før 2000, mangler fuktsikring, forhøyet fukt. TG3: omfattende fuktinntrengning, utfelling. Velg: skade eller svikt, symptomer. |
| Grunnmur og fundamenter | Grunnmur (lettklinker, betong, betongstein, naturstein, isolerte elementer), fundament (stripefundament, såle, plate, søyler) | TG3: utsiging av masser, setningsskader, store skader. TG2: sprekker, horisontalriss (jordtrykk), skråriss (setninger). HMS: brannsikring av isolerte elementer. |
| Forstøtningsmurer | Type | TG3: store sprekker. TG2: små sprekker. TGIU: snødekt. HMS: rekkverk mangler. |
| Terrengforhold | – | HMS: rasfare, flom, kvikkleire (NVE / kommuneplan). TG3: vann ledes inn mot grunnmur. TG2: for lite fall ut, stående vann. TGIU: snødekt. Velg: flatt terreng eller fall inn mot mur. |
| Utvendige vann- og avløpsledninger | **Avløp** (PVC, PP, ABS, støpejern før/etter 1990, betong før/etter 1990, tegl, relining med/uten strømpe, ukjent) → +1 aldersspørsmål med levetid fra tabell C.5. **Vann** (PE, glødd kobber, kobber med skjøter, rustfritt, galvanisert, ukjent) → +1 aldersspørsmål. **Privat brønn** → +2 (dokumentasjon på vannkvalitet, dårlig vannkvalitet). Tilknytning avløp: offentlig, septik/slamavskiller til nett eller grøft, ikke innlagt. | TG3: lekkasje på avløp, lekkasje på vann, rør synlige ute (frostfare). TG2: ingen stakekum, trykkfall, ingen utvendig stoppekran. Velg: svekket avløp (eiers opplysninger). |
| Septiktank | Type (stål, glassfiber, betong, armert plast, ukjent) → +1 aldersspørsmål (25/35/25/35 år) | TG3: pålegg om utbedring, funksjonssvikt. TG2: avvik ved tømming, svekkelse. |
| Oljetank | Type | TG3: krav om sanering, ikke klar for bioolje. TG2: mangler dokumentasjon på sanering, mangler lekkasjesikring, alder (tabell C.7). |
| Andre tomteforhold | – | HMS / velg |

## 7. Forslag til datamodell (kontrollpunkt)

```
Kontrollpunkt
  id, navn, gruppe (utvendig/innvendig/rom/teknisk/tomt), rekkefølge
  obligatorisk: ja/nei + forskrift-§ (f.eks. § 2-15)
  romtyper (hvis romstyrt), boligtyper
  gir_tg: ja/nei   (nei = bare HMS/beskrivelse: el, brann, trapper, pipe, radon, byggegrunn)
  lenker til andre punkter («ses i sammenheng med»)
  Valggrupper[]: navn, enkelt/flervalg, alternativer[] (med materialkode for levetid)
  Målefelt[]: type (mm, antall, %, Bq), terskler → avvik
  Avviksspørsmål[]:
    tekst (Byggcons egen), vises_når (alltid | valg X | målt verdi > terskel | alder > levetid)
    utfall[]: TG (2/3/IU) eller HMS, avvikstekst, konsekvens/tiltak, kostnad påkrevd (TG3)
Levetid (tabell C): materialkode, år med/uten dokumentasjon, kilde, NS-utgave
```

*Merk 25.10.2026: Datamodellen skal samles i ett dokument (`datamodell.md`, se «Neste steg» i `LES-MEG.md`). Forslaget over er ett av grunnlagene.*

## 8. Det som gjenstår å kartlegge

Oppdatert 25.10.2026 mot det som er kartlagt senere i `kartlegging-rapport-og-oppdrag.md` (23.10.2026) og `ivit-detaljer.md` (24.10.2026).

**Kartlagt senere:**
- [x] Bygninger-fanene Etasjer, Tilbygg/modernisering og Lovlighet – `kartlegging-rapport-og-oppdrag.md` avsnitt 2
- [x] Rapportdelene Eiendomsdata, Opplysninger om eiendommen, Kort sammendrag, Oppsummering, Årlige kostnader, Teknisk verdi, Markedsverdi og Forutsetninger – samme fil, avsnitt 1
- [x] Verktøylinjen i rapporten (kopier data, notater, validering, rapportutkast, innstillinger) – samme fil, avsnitt 3
- [x] Rapportutkast som PDF (14 sider) – samme fil, avsnitt 4
- [x] Oppdragsfanene Oversikt, Dokumenter, Notater, Befaringer, Faktura, Ordrebekreftelse, Bilder, Deling og Revisjoner – samme fil, avsnitt 5
- [x] Hovedmenyen, arkivfiltre, rapporttyper og oppdragssteg – samme fil, avsnitt 6
- [x] Innstillinger, kunder, kalender, varsler, integrasjoner og admin.ivit.no – `ivit-detaljer.md`
- [x] IVITs iPad-app: Ståle bekrefter at befaringsbildet er helt likt nettversjonen. Kartleggingen fra nettleseren dekker derfor appen (LES-MEG 25.10.2026, svar nr. 19).

**Gjenstår:**
- [ ] **Garasje:** Den er en egen bygning med egne opplysninger (`kartlegging-rapport-og-oppdrag.md` avsnitt 2). Om den får egen sjekkliste, er ikke kartlagt.
- [ ] **Leilighet:** eierform (selveier, aksje, andel) er sett i Innstillinger, og punktet om fellesdeler under «Andre utvendige forhold». Hvordan sjekklisten endres for leilighet, er ikke kartlagt. Eierform og fellesdeler skal være med fra start (LES-MEG 25.10.2026).
- [ ] **Endelig rapport og levering til megler:** ikke trykket på, fordi det koster penger. Hva megleren faktisk mottar, er ikke sett. [Sidemannskontroll del 2, P43]
- [ ] **Ordre-fanen og Godkjenninger-fanen** med innhold: ikke åpnet. [Sidemannskontroll del 1, F1, og del 2, P43]
- [ ] **Revisjoner:** hvordan en ny versjon ser ut i PDF-en. [Sidemannskontroll del 1, F1]
- [ ] **Rapporttyper:** hvilke av IVITs rapporttyper Byggcon bruker, og hvor mange per år. Ståle sier at det for det meste er tilstandsrapport (LES-MEG 25.10.2026, svar nr. 26). [Sidemannskontroll del 1, F1]

## Endringslogg

| Dato | Endring | Kilde |
|---|---|---|
| 23.10.2026 | Første versjon | Observasjon i IVIT |
| 25.10.2026 | Antall faste kontrollpunkter rettet til 40 (talt i tabellene i avsnitt 2, 3, 5 og 6). Tidligere sto det 37 her og 47 i `kravdokument.md`. | Sidemannskontroll del 1, motsigelsestabellen |
| 25.10.2026 | Avsnitt 8 oppdatert: det som er kartlagt senere er krysset av, og det som fortsatt mangler er lagt til. | Sidemannskontroll del 1, F1, og del 2, P43. `kartlegging-rapport-og-oppdrag.md`, `ivit-detaljer.md`. LES-MEG 25.10.2026 |
| 25.10.2026 | Radon: merknad om at Byggcon bruker 100 Bq/m³. Merknad om at datamodellen skal samles i ett dokument. | LES-MEG 23.10 og 25.10.2026 |
