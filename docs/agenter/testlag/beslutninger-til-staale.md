# Beslutninger som er dyre å endre

Sist oppdatert: 18.11.2026 (testlaget, dokumentvakten og kvalitetslederen)

Mens Ståle var borte, har agentene tatt mange beslutninger (A1 og oppover; noen nummer er ikke brukt). Listen her er gått gjennom til og med A430 (17.11.2026: A292–A308, A315–A328 og A360–A379; 18.11.2026: de som er merket dyre i A345–A357 og A380–A430). De står i `docs/09-apne-sporsmal.md`, tabellen «Avgjort av agentene mens Ståle var borte». **De fleste er lette å endre.** Her er bare de som blir dyre å endre senere, fordi data må flyttes, fordi de står på rapportene, eller fordi de gjelder personvern og sikkerhet. Det er disse Ståle bør lese først.

Alle beslutninger som ikke står her, er lette å endre.

## KI og personvern

| Nr | Hva er bestemt | Hvorfor det er dyrt å endre |
|---|---|---|
| A148 | Forslag fra KI og loggen over KI-bruk ligger i én og samme tabell. | Skal de deles senere, må data flyttes. |
| A150 | Det som sendes til KI, styres av en liste over felt som er lov per funksjon. | Gjelder personvern. Et bytte krever ny vurdering. |
| A151 | Instruksene til KI har versjonsnummer og ligger ett sted i kjernen. | Alle KI-funksjoner bygger på dette. |
| A154 | En KI-funksjon slås ikke på før den treffer 90 % av eksemplene, og 100 % av dem som må treffe. | Avgjør hva KI får lov til å bidra med i rapporten. |
| A157 | Loggen over KI-bruk regnes som personopplysninger og lagres i 10 år, også forslag som ble avvist. KI har ingen verktøy. | Gjelder personvern. Ståle svarte 12.11.2026 (K7, spørsmål 56): oppbevaringstiden blir en innstilling, 10 år som standard. Bygget 13.11.2026, se A272–A275. |
| A252 | Når en ordre endres, får revisjonsloggen gammel og ny verdi per felt (blant annet adresse, matrikkel og bestiller). | Gjelder personvern. Revisjonsloggen ryddes aldri, så en feil adresse eller et feil navn står i 10 år, og innsyn, retting og sletting må dekke loggen. Se spørsmål 79. |
| A272, A273 | Avviste KI-forslag får en dato for hvor lenge de minst oppbevares, regnet ut fra innstillingen da de ble avvist. En endring av innstillingen virker bare fremover. | Gjelder personvern. Datoen står per rad, så en annen regel senere krever at alle radene regnes om. Står som «Lett å endre» i spørsmålsfilen (funn T-0082). Se spørsmål 81. |
| A171 | Nytt utfall «sperret» i loggen over KI-bruk, for forespørsler som ikke kan sendes til leverandøren. | Fast kode som lagres i data i 10 år. |
| A299 | Sperren mot elleve sifre (mulig fødselsnummer) gjelder alle fritekstfelt i bestillingen, både for tilbud og oppdrag. | Gjelder personvern. Gammel og ny verdi står i revisjonsloggen i 10 år, så det som slipper forbi sperren, blir stående. Står som «Lett å endre» i spørsmålsfilen (funn T-0101). |
| A292, A293 (logg) | Når bestillingen på oppdraget endres, lagres gammel og ny verdi (adresse, matrikkel, bestiller) i revisjonsloggen, på samme måte som for tilbud (A252). | Gjelder personvern, og nå hovedveien, ikke bare tilbud. Revisjonsloggen ryddes aldri. DPIA-punktet i planen nevner bare ordre (funn T-0098). |

## Sikkerhet og tilgang

| Nr | Hva er bestemt | Hvorfor det er dyrt å endre |
|---|---|---|
| A19 | Den som kan publisere, kan også overstyre sperrene fra forskriften. | Skal det skilles senere, må rettighetene deles. |
| A21 | Hvilke rettigheter som kan gis til én og én ansatt. | Grunnmur for all tilgang. |
| A29 | Uten gyldig sertifisering kan man ikke publisere, heller ikke leder og admin. | Avgjør hvem som kan levere rapporter. |
| A35 | Innlogging sperres etter 5 feil på 15 minutter per e-post. | Kjent svakhet: hvem som helst kan holde admin sperret ute en stund. |
| A36, A38 | Innloggingsforsøk lagres uten navn og organisasjon, og er unntatt tiårsregelen og myk sletting. | Unntak fra to faste regler. |
| A43 | Alle ansatte kan hente alle filer i organisasjonen (bilder, egenerklæringer). | Gjelder personvern. Å stramme inn senere krever ny tilgangsmodell for filer. |
| A49 | Nøkkelboksen for hemmeligheter bruker sin egen tilgangsstyring. | Påvirker oppsettet i Azure. |
| A58 | Loggen over hendelser ryddes aldri. | Vokser over tid, og gjelder personvern. |
| A64 | Grunnen ved bytte i teamet er fritekst. | Risiko for at noen skriver helseopplysninger der. |
| A121 | Tidsmåling er på som standard. I betaen er tallene i praksis per person. | Arbeidsmiljøloven kapittel 9. Bør drøftes med de ansatte (se også funn T-0012). |
| A193 | Koblingen til KI-leverandøren kan bare bruke én felles nøkkel, lik for alle organisasjoner. | Gjelder sikkerhet. Før selskap nummer to får KI, trengs egen nøkkel per organisasjon. |
| A216 | Microsoft-kontoen kobles til den ansatte på e-post første gang, deretter på Microsofts egen id. | Gjelder sikkerhet. Står lett i listen, men å endre koblingen etter at kontoene er i bruk krever opprydding. |
| A217 | Engangskoden sjekker ikke selv at den ansatte er aktiv. Tilgangen stopper likevel i tilgangssjekken. | Gjelder sikkerhet. Kontrollert av testlaget 13.11.2026: en deaktivert ansatt kommer ikke inn. Testlaget 18.11.2026: en som har sluttet, får likevel en innlogging, og etter «Angre sluttet» gir den full tilgang uten ny innlogging. Strider mot domenemodellen («Personen kan ikke logge inn»), se funn T-0118. |
| A223 | Signaturen på ID-tokenet fra Microsoft sjekkes ikke (tokenet hentes rett fra Microsoft over kryptert forbindelse). | Gjelder sikkerhet. Bør vurderes på nytt før ekte data. |
| A302 | Før testdata skrives, må miljøet være utvikling eller test, og databasen må være lokal eller nøyaktig testdatabasen. | Er sperren mot oppdiktede data i produksjon. |
| A303 | Testdataene ligger i Byggcon-organisasjonen i testmiljøet, ved siden av det de ansatte prøver. Testdatabasen kan derfor aldri løftes til produksjon. | Produksjon må starte med tom database. Ståle må bekrefte før ekte data (spørsmål 82). |
| A346 | Serveren regner ut regelforslaget selv. Klienten sender bare hvilken regel og hvilken beslutning. | Gjelder sikkerhet. Loggen som skal forklare TG ved en reklamasjon, kan ellers forfalskes. Alle beslutninger på badet bygger på dette. |
| A419 | Unntak fra myk sletting: tellere for innloggingssperren, engangskoder og gamle økter slettes for godt hver natt. | Gjelder personvern og regel 3 i CLAUDE.md. Det som er slettet, kan ikke hentes tilbake, og CLAUDE.md nevner ikke unntaket. Se spørsmål 88 (17.11.2026) om innloggingshistorikk. |
| A426 | Økter hører til brukeren, ikke organisasjonen. «Logg ut av alle enheter» fra admin i én organisasjon logger ut personen også i en annen. | Gjelder sikkerhet. Krever organisasjon på økten for å endres. Står som «ufarlig i dag: én organisasjon», men testmiljøet har alt to organisasjoner, og første admin er i begge. Må avgjøres før organisasjon nummer to. |

## Datamodell og faste koder

| Nr | Hva er bestemt | Hvorfor det er dyrt å endre |
|---|---|---|
| A52 | Oppdragsnummer ÅÅÅÅ-NNNNN, én serie per organisasjon og år. | Står på rapportene. |
| A57, A130 | Prøvedata ligger i en egen prøveorganisasjon. | Sletteregelen bygger på det. |
| A60 | Fem roller for parter og tre valg for hvem som mottar rapporten, uten «oppdragsgiver». | Faste koder i data. |
| A61 | Én aktiv person per rolle i teamet. | Låst i databasen. |
| A70 | Hvert oppdrag får sin egen eiendom. | Historikk per bolig blir dyrere senere. |
| A71, A94 | Fellesdeler, bygninger, etasjer og rom hører til oppdraget. Koblingen til rapporten kommer senere. | Data må flyttes når rapportene kommer. |
| A79 | Organisasjonsnummer er valgfritt, men unikt når det er fylt ut. | Låst i databasen. |
| A80 | Faste koder for hvor en kontakt kommer fra. | Faste koder i data. |
| A85 | Partene på oppdraget er et øyeblikksbilde av kontakten. | Endring i kontakten slår ikke gjennom på gamle oppdrag. |
| A115 | Rapportprofilen er en tekstkode, ikke en kobling. | Må gjøres om hvis profiler skal redigeres. |
| A125 | Reklamasjonssaken knyttes til oppdraget, ikke til rapporten. | Data må flyttes hvis det endres. |
| A128 | Bygningsdel på reklamasjonen er fritekst. | Tall per bygningsdel (reklamasjonsmålet og S4) krever opprydding senere. |
| A136, A137, A141 | Hvordan faste koder i malen arkiveres og kjennes igjen. | Grunnmur for regneark og regler (regel 6). |
| A142 | Standardtiltak, vilkår i regler og testsaker har ingen fast kode og erstattes samlet. | Grunnmur for malen. |
| A27 | Roller tas bort med myk sletting. | Låst i databasen. |
| A30 | Ett område for sertifisering: tilstandsrapport. | Flere områder krever endring i data. |
| A200 | Merket «utkast, ikke godkjent av fagrådet» står per utfall og per tiltak. | Kolonne i databasen. Godkjenning gir ny malversjon. |
| A202 | Badet har åtte kontrollpunkter; målingene ved hulltaking er enkeltfelt til 2a-3. | Faste koder. De arkiveres og erstattes i 2a-3. |
| A208 | Fall i mm per meter med fortegn, og eget valg for enhet på fuktmålingen. | Faste koder og tall som lagres i rapportene. |
| A210 | Skadet vinyl og sprekker i sanitærutstyr gir valget TG2 eller TG3. | Fast utfallskode i malen. |
| A211 | Høyden ved terskel er et felt under vanntett sjikt, membran og sluk. | Fast feltkode. |
| A212 | Byggeåret for våtrommet betyr året sjiktet ble lagt. | Fast betydning av en kode (regel 6). Aldersreglene bygger på det. |
| A230 | Nytt utfall «sjikt over levetid» (TG2). | Fast utfallskode. |
| A231 | Regelmotoren ligger i kjernen som rene funksjoner med faste svarkoder (ADR 0009). | Grunnmur for alle regler på iPad og server. |
| A232 | Testsakene har tre svar (slår til, slår ikke til, ikke vurdert), som erstatter det gamle ja/nei. | Kolonne i databasen. |
| A234 | TG0 er et eget formål for regler, ikke et utfall. | Fast kode i regeldata. |
| A235 | Arealtypen «Ikke del av BRA» er en egen kode. | Fast kode i data. Påvirker areal, en vanlig grunn til reklamasjon. |
| A237 | «Under grensen» er samme terskel snudd, ikke en egen terskel. | Mønster for alle terskelregler. |
| A280, A283 | Fire ferdige romsett med faste koder, og kilden til nye rom (`manual` eller `preset` med settkoden) lagres i revisjonsloggen. | Kodene står i revisjonsloggen i 10 år og kan ikke endres, bare arkiveres (regel 6). Står som «Lett å endre» i spørsmålsfilen (funn T-0082). |
| A292, A293 | Oppdraget eier bestillingsopplysningene (adresse, matrikkel, bestiller, meglerens ordrenummer, borettslag, mottatt, kilde). De ble kopiert fra ordren, og ordren beholder sin kopi. | Datamodell og ni steder som leser den. Flyttingen har kjørt mot data. |
| A296 | Adresse og mottatt-tid er påkrevd på oppdraget. | Regel i databasen. |
| A298 | Engangsnøkkel mot dobbel lagring, unik per organisasjon. | Kolonne og unik indeks. Står som «Lett å endre» i spørsmålsfilen (funn T-0101). |
| A318 | «Ordre» heter «Tilbud» bare på skjermen. Tabellen, modulen og kodene i hendelser og logg heter fortsatt «order». | Kodene står i hendelser og revisjonslogg i 10 år. |
| A319 | Tilbudet har påkrevd «Gyldig til». Gamle ordre fikk mottatt-dato pluss 30 dager. | Regel i databasen og utfylte data. |
| A320 | «Utløpt» lagres ikke som status, men regnes ut fra datoen. | Datamodell. All statistikk på utløpte tilbud må regnes med dato. |
| A361 | Fem faste grunner for avslag på tilbud (pris, tidspunkt, valgte en annen, kunden trakk seg, annet). Gamle avslag fikk «annet». Endrer A323. | Faste koder i data (regel 6), og de står i hendelsen for avslag. |
| A345 | Beslutninger om regelforslag (godta, endre, avvis) lagres bare som nye rader i en egen tabell. Avviket peker bare på regelen. | Er grunnlaget for å forklare TG ved reklamasjon i 10 år. Testlaget 18.11.2026: TG kan endres på avviket uten ny rad (funn T-0113). |
| A347 | Lagring per felt med «verdien klienten så», slik at to som skriver samtidig får beskjed per felt. | Er grunnlaget for synken uten nett i fase 2b. Endres det, må synken bygges om. |
| A350, A356 | Faste koder for hva KI kan skrive i (avviksteksten heter `deviation_text`, feltsvar `field_answer`, TGIU-teksten `tgiu_detail`). | Faste koder i data og i loggen over KI-bruk (regel 6). Dokumentene bruker fortsatt den gamle koden noen steder (funn T-0124). |
| A351 | Alt under rapporten peker på forelderen med tre kolonner (organisasjon, rapport og forelder). | Datamodell. Endres med migrering av alle tabellene i badet. |
| A352 | Unike nøkler med tomme kolonner løses med en egen indeks. | Datamodell. Endres med ny indeks på tabeller med data. |
| A353 | Et avvik er enten TG-avvik eller HMS-avvik, og TG står i eget felt. | Fast kode i data. |
| A355 | Merket om at KI har skrevet en tekst, står bare i loggen over KI-bruk, ikke på avviket. | Avgjør hvordan publiseringssperren og «KI i veien» finner KI-tekst. Krever migrering å endre. |
| A357 | Hvor teksten kommer fra (fra malen, endret eller fri), sier aldri om KI eller frase ble brukt. | Fast kode i data. KI-opphav står bare i loggen over KI-bruk (A355). |

## Fag

| Nr | Hva er bestemt | Hvorfor det er dyrt å endre |
|---|---|---|
| A65–A67 | Utstedende selskap settes automatisk fra ansvarlig takstmann, og kan ikke overstyres. | Avgjør hvilket selskap som står ansvarlig for rapporten. |
| A69 | Fire eierformer, uten obligasjonsleilighet. | Faste koder i data. |
| A72 | Når fellesdeler gjelder. | Påvirker innholdet i rapporten. |
| A95 | 33 romtyper som faste koder (utkast). | Faste koder i data (se funn T-0016 om kryperom). |
| A96 | Areal per etasje, BRA som sum, og koder for målemetode. | Areal er en vanlig grunn til reklamasjon. |
| A97 | Forslaget om «under terreng» styrer kravet om hulltaking. | Påvirker TG i våtrom og kjeller (se funn T-0010). |
| A118 | Teksten om forutsetninger logges uten innhold. | Sporbarhet ved reklamasjon. |
| A225 | Fuktgrensen ved hulltaking er 15 vekt-% i treverk. | Avgjør TG-forslag i alle bad. Ikke kontrollert mot NS 3600:2025 (F3). Tallet er lett å endre, men Ståle bør se det. |
| A227, A228 | Hva «med dokumentasjon» betyr i levetidstrinnene, og hva ukjent membrantype gir. | Avgjør TG-forslag på alder. |
| A238 | TG0-forslag bare ved «utført uten funn», og 0 vekt-% regnes som en måling. | Avgjør TG0 i rapporten. Se spørsmål 77 (a) og (e). |
| A289 | Varsel om like kontakter og firma ble ikke bygget sammen med varselet om like ordre, fordi agentene mente Ståle ikke hadde sagt ja. | Ståle sa ja 12.11.2026 (forslag 62, T3). Beslutningen utelater noe han har bestemt (funn T-0072). Doble kontakter kan gi rapport til feil person. |
| A380 | Fem faste grunner når takstmannen endrer eller avviser et regelforslag (dokumentasjon finnes, synlig skade, målt på nytt, alderen kjent på annen måte, annet). | Faste koder i data i 10 år. Testlaget 18.11.2026: grunnene er like for alle regler og passer dårlig for TGIU-regelen om hulltaking (spørsmål 104 f). |

## Til vurdering

- Navn på KI-modeller står i noen dokumenter i `docs/`. Regelen i CLAUDE.md gjelder bare commits, PR-er og kode, så det er ikke meldt som feil. Ståle kan vurdere om regelen skal gjelde dokumentene også.
