# Analyse: IVIT-tilstandsrapport for leilighet (eksempel fra Ståle)

**Dato:** 27.10.2026. **Laget av:** Claude for Ståle Limstrand.
**Kilde:** En ekte rapport fra Byggcon Nord (borettslagsandel, 2. etasje, byggeår 2006, BRA 64 m², 21 sider, versjon 2), lastet opp av Ståle i chat 27.10.2026.
**Personvern:** Adresse, navn, oppdragsnummer, andelsnummer og målernummer er bevisst **ikke** tatt med her.

## 1. Slik er rapporten bygget opp (21 sider)

| Side | Del | Merknad for EzProp |
|---|---|---|
| 1 | Forside: boligtype, kommune, gnr/bnr, andelsnr., markedsverdi, BRA/BRA-i, befaringsdato, rapportdato, oppdragsnr., takstingeniør, QR-kode, energimerke, gyldighet ett år | Markedsverdi står på forsiden |
| 2 | Om firmaet, rapportansvarlig med bilde og signatur, NITO-logo | Firmatekst er utdatert («17 ansatte», kunnskapsbasen sier 16). Firmatekst bør hentes fra én kilde. |
| 3–4 | Fast tekst «Dette trenger du å vite» med TG-forklaring og kostnadsintervaller | IVITs tekst (© iVerdi). EzProp må ha egen tekst. |
| 5 | Beskrivelse av eiendommen, markedsvurdering, lovlighet | Lovlighet står både her og på side 18 (dobbelt) |
| 6 | Sammendrag: TG-fordeling (16 TG1, 1 TG0, 1 TG2), avvik og HMS-punkter | Bra og kort. Bør beholdes. |
| 7 | Energimerking | |
| 8–13 | Tilstandsdelen: Utvendig (vinduer, dører, balkong med rekkverkshøyde), Innvendig (overflater, etasjeskiller, radon, dører), Våtrom/Bad (generelt, overflater, gulv med målt høydeforskjell, membran TG2, sanitær, ventilasjon, tilliggende konstruksjoner med hulltaking), Kjøkken, Tekniske installasjoner (vann, avløp, ventilasjon, bereder, el), HMS | Hvert punkt: Beskrivelse → Vurdering av avvik → Konsekvens/tiltak → bilde |
| 14 | Konklusjon og markedsvurdering: formål «Salg», BRA, markedsverdi, teknisk verdi, fradrag for fellesgjeld | **Verdivurdering er en del av leilighetsrapporten** |
| 15 | Sammenlignbare salg (8 salg fra Eiendomsverdi, med fellesgjeld og m²-pris) | |
| 16 | Beregninger: årlige kostnader (felleskostnader), teknisk verdi (byggekostnad − fradrag), tomteverdi, sum | |
| 17 | Fast forklaring om areal, bruksendring og brannceller | |
| 18 | Arealtabell per etasje (BRA-i, BRA-e, BRA-b, TBA) og romfordeling, lovlighet, håndverkstjenester siste 5 år | |
| 19 | Befarings- og eiendomsopplysninger: hvem var til stede, matrikkeldata, andelsobjekt (borettslag, org.nr., leil.nr., forretningsfører, eier), andel fellesgjeld med dato, adkomst, vann, avløp. Kilder og vedlegg. | Forretningsfører står tom |
| 20 | Revisjoner: versjon 1 og 2 samme dato, uten kommentar | |
| 21 | Forutsetninger (fast tekst) | |

## 2. Det viktigste funnet

> **Merknad 27.10.2026 (Ståle, i chat):** «De færreste tilstandsrapportene har verdi.» Verdidelen er derfor **ikke nødvendig for å ta EzProp i bruk**. Den blir liggende i «Senere» sammen med de andre malene. Det som står under om at verdidelen må være med i første produksjonsversjon, gjelder ikke lenger. Se `svar-fra-stale-2026-10-27.md`, spørsmål 18.

**Leilighetsrapporten er en tilstandsrapport og en verdivurdering i ett** (markedsverdi, teknisk verdi, tomteverdi, fellesgjeld, felleskostnader og sammenlignbare salg, sidene 1, 5 og 14–16).

I utviklingsplanen ligger verditakst og markedsverdi under «Senere» (funksjonskart H10). Datamodellen har ikke felt for markedsverdi, teknisk verdi, tomteverdi, fellesgjeld eller sammenlignbare salg.

Leiligheter er omtrent 60 % av rapportene. Hvis de fleste av dem leveres med markedsverdi, må verdidelen være med i første produksjonsversjon. Ellers må takstmennene fortsatt bruke IVIT til de fleste oppdragene.

**Forslag:** En egen **verdidel** som tillegg til tilstandsrapporten, med:
- formål (salg, refinansiering m.m.)
- markedsverdi med og uten fellesgjeld
- teknisk verdi: byggekostnad, fradrag og sum
- tomteverdi
- felleskostnader per år
- fellesgjeld med dato og kilde
- sammenlignbare salg, ført for hånd i starten og hentet fra Eiendomsverdi senere
- begrunnelse i fritekst

Dette er et fast beregningsoppsett i kode, ikke noe malbyggeren lager. Spørsmål 6 i planen (rapporttyper og verditakst) blir dermed viktig.

## 3. Feil og svakheter som EzProp bør hindre (forslag til regler)

1. **Ventilasjon motsier seg selv.** Bad og kjøkken sier «mekanisk avtrekk, felles for kjøkken og våtrom». Under Tekniske installasjoner står det «naturlig ventilasjon med ventiler i vindu». *Regel:* varsel når samme anlegg er beskrevet ulikt to steder. Eventuelt kan ventilasjon registreres ett sted og vises flere steder.
2. **Samme tekst står to ganger.** El-avvikene står først under Elektrisk anlegg og så ord for ord under HMS. Sammen med radon blir HMS-delen lang og gjentagende. *Forslag:* HMS-delen viser en kort liste med lenke til punktet, ikke hele teksten på nytt.
3. **Det er uklart hva verdiene betyr.** Forsiden sier markedsverdi 2,5 mill. Andre steder står 3,5 mill. («markedsverdi uten fradrag» og «teknisk verdi andelsbolig»), mens «sum teknisk verdi bygninger» er 2,6 mill. Tallene er regnet riktig, men navnene kan forvirre en kjøper. *Forslag:* faste, klare navn, for eksempel «Markedsverdi (andel)» og «Totalpris inkl. fellesgjeld». Hvert tall forklares der det står.
4. **TG0 på «tilliggende konstruksjoner våtrom» i et 20 år gammelt bad**, samtidig som membranen får TG2 fordi den er over 15 år. TG0 betyr normalt «ingen avvik og under halvparten av forventet levetid». *Spørsmål til fagrådet:* skal TG0 sperres her? En regel kan foreslå TG1 når rommet er eldre enn halvparten av levetiden. (Føres som åpent spørsmål. Ikke bestemt.)
5. **Radon for leilighet i 2. etasje.** Teksten sier at det ikke er gjort målinger og at bygget ikke har radonsperre. *Spørsmål til fagrådet:* skal radon-HMS slås av eller tones ned for boenheter som ikke ligger mot grunnen? Er «ikke utført med radonsperre» noe takstmannen har sett, eller er det en antakelse? (Språkregel: ingen gjetteord.)
6. **Forretningsfører er tom**, og kilden for fellesgjeld er ikke oppgitt under «Kilder og vedlegg». *Regel:* For borettslag og sameie er forretningsfører og kilde for fellesgjeld påkrevd før publisering, eller må begrunnes.
7. **Revisjoner uten kommentar.** Versjon 1 og 2 har samme dato og ingen forklaring. *Regel:* Ny versjon krever en kort kommentar om hva som er endret, og den vises i rapporten.
8. **Sideskift.** Overskriften «Konsekvens/tiltak» står alene nederst på en side, og teksten fortsetter på neste. Bildet kommer etter tiltakene. Tabellhodet «SALGSDATO» er brutt over to linjer. *PDF-profil:* Overskriften skal holdes sammen med teksten under, og tabellkolonnene skal ha faste bredder.
9. **Skrivefeil i fritekst** («hopvedsak»). *Forslag:* stavekontroll ved publisering. Dette er allerede planlagt i sjekken før publisering.
10. **Firmatekst og antall ansatte** ligger i en egen fast tekst som ingen har oppdatert. *Forslag:* firmatekst hentes fra innstillingene til selskapet.

## 4. Det som fungerer godt og bør tas med

- **Sammendraget på én side** med TG-fordeling, avvik og HMS. Lett for kjøper og megler.
- **Målte verdier i teksten:** rekkverkshøyde 106 cm og høydeforskjell 13 mm ved terskel. Dette passer med feltene for målinger i malmotoren.
- **Bilde av fuktmåler i hulltakingen** som dokumentasjon. Dette passer med tabellen for hulltakingsmålinger.
- **Arealtabell per etasje og romfordeling** med BRA-i, BRA-e, BRA-b og TBA. Utebod i 1. etasje er BRA-e.
- **Andelsobjekt-blokken** (borettslag, org.nr., leil.nr., andelsnr., forretningsfører, fellesgjeld med dato). Den passer nesten rett inn i `common_areas` og eiendomsfeltene i datamodellen. Det som mangler er fellesgjeld med dato og kilde, og felleskostnader.
- **DLE-opplysninger** (siste el-kontroll med dato og merknad) brukt som grunnlag for el-vurderingen.
- **«Til stede»-listen med roller** på befaringen.
- **Gyldighet ett år** står tydelig på forsiden.

## 5. Det rapporten ikke har

- **Ingen egen del for fellesdeler.** Rapporten omtaler bare boenheten. Fellesareal nevnes bare i forbifarten (stakeluke i krypkjeller, bod i fellesanlegg). Datamodellen har allerede `common_areas` med «er fellesdelene vurdert». Det gjør det tydelig hva som ikke er undersøkt.
- **Ingen egne punkter for røykvarsler og slukkeutstyr**, selv om HMS-teksten sier at de vurderes. *Spørsmål til fagrådet:* skal de være egne punkter i leilighetsmalen?
- **Ingen opplysninger fra borettslaget**, for eksempel vedlikeholdsplan, planlagte felles tiltak eller tilstandsrapport for bygget. Det henger sammen med Optiplan. Senere kan EzProp hente dette fra Optiplan, med samtykke fra styret.

## 6. Forslag til endringer i plan og datamodell (må godkjennes av Ståle)

1. **Verdidel for leilighet/andel** (se punkt 2): flyttes fra «Senere» til fase 2a eller 4, avhengig av svaret på spørsmål 6.
2. **Nye felt:**
   - `shared_debt` (fellesgjeld) med dato og kilde
   - `common_costs` (felleskostnader per år)
   - `market_value`, `technical_value`, `plot_value` (i verdidelen)
   - `comparable_sales` (sammenlignbare salg)
   - `purpose` (formål med rapporten)
3. **Nye regler i sjekken før publisering:** ventilasjon beskrevet ulikt, forretningsfører og fellesgjeld påkrevd for borettslag og sameie, kommentar påkrevd ved ny versjon.
4. **PDF-profil:** HMS-delen viser bare henvisninger, overskrifter holdes sammen med teksten, og lovlighet står ett sted.
5. **Spørsmål til fagrådet:** TG0 på gamle våtrom, radon over bakkeplan, og røykvarsler og slukkeutstyr som egne punkter.
