# EzProp – funksjoner å strekke seg etter: det ingen har i dag, og noen «moonshots»

Status: **Arbeidsdokument – ikke godkjent**
Sist oppdatert: 25.10.2026 (natt)
Laget av: Claude, på oppdrag fra Ståle: «funksjoner vi kan strekke oss etter – finnes ikke i dag – moonshot-ideer vi ikke har tenkt på».
Hører sammen med: `funksjonskart-ezprop-2026-10-25.md` (v2, det som må være med) og `funksjonalitet-ki-og-fremtid-2026-10-25.md` (KI og horisonter). Dette dokumentet går **lenger**: bare ting som ikke finnes i IVIT, Spectora eller SmartTakst, og som ingen av de tidligere dokumentene har.

**Rammer:** intern bruk; KI lager utkast, takstmannen bestemmer, KI setter aldri TG; data i EU/EØS; uavhengighet etter forskriften § 1-3. Der en idé krever at en beslutning endres (f.eks. «alt i nettleseren»), står det.

**Slik er hver idé vurdert:**
- **Ny?** Finnes den hos IVIT, Spectora eller SmartTakst? (Alle ideene her: nei.)
- **Verdi** for Byggcon (1–5): tid spart, kvalitet, færre reklamasjoner, bedre produkt, bedre styring.
- **Vanskelighet** (1–5): 1 = regler på data som finnes; 5 = ny maskinvare eller ny avtale med eksterne.
- **Krok:** hva som må inn i datamodellen nå for at ideen ikke blir dyr senere.

---

## 0. Det store bildet: hva gjør 2000 rapporter i året til noe mer enn 2000 PDF-er?

Alle tre systemene i kartleggingen stopper når PDF-en er sendt. Ingen av dem **lærer av hva som skjedde etterpå**: om kjøper reklamerte, om avviket ble dyrere enn anslått, om TG2 på drenering ble en vannskade tre år senere. Byggcon får dette å vite – gjennom reklamasjoner, Fremtind, meglerne og neste takst av samme bolig – men i dag forsvinner kunnskapen i e-poster og hoder.

**Den største ideen i dette dokumentet er derfor ikke én funksjon, men en sløyfe:** rapport → det som skjedde etterpå → tilbake til reglene, frasene, kostnadsintervallene og opplæringen. Ideene i del 1 (lukket sløyfe) er de som gjør EzProp til noe ingen takstfirma har, og de koster lite fordi dataene finnes.

---

## 1. Lukket sløyfe – lære av det som skjer etter levering

| # | Idé | Hva det er | Verdi | Vansk. | Krok |
|---|---|---|---|---|---|
| S1 | **Reklamasjoner og utfall kobles til punktet** | Når en reklamasjon eller et forsikringskrav kommer, registreres det på rapporten *og* på det konkrete kontrollpunktet/avviket: hva ble påstått, hva ble utfallet (avvist, medhold, forlik, beløp). Etter 2–3 år vet Byggcon hvilke punkter, formuleringer og TG-valg som faktisk gir sakene. | 5 | 1 | `claims` (report_id, checkpoint_key, deviation_id, type, outcome, amount, dates) |
| S2 | **Robusthet før publisering** | Før publisering regner systemet ut hvor «utsatt» rapporten er, ut fra S1-historikken: avvik uten bilde på punkter som ofte gir saker, TGIU uten alternativ kontroll, kostnad i nederste intervall på punkter som historisk ble dyre. Vises bare internt, som forslag: «Legg til bilde av sluk – punktet er med i 40 % av sakene.» Aldri TG. | 5 | 2 | S1 + `publish_check_results` med `check_code = robustness_hint` |
| S3 | **Kostnadsbank som lærer** | Faktiske utbedringskostnader (fra reklamasjoner, fra neste takst av samme bolig, fra Optiplans vedlikeholdsplaner, frivillig fra kjøpere ett år etter) lagres anonymt per avvikstype og region. Kostnadsintervallene i malen kalibreres mot virkeligheten, ikke mot bransjetekst. | 4 | 2 | `cost_observations` (deviation_type, region, amount, source, year) |
| S4 | **Ettårs-sløyfen** | Ett år etter levering får kjøper (via megler) og selger en kort e-post: «Stemte rapporten? Har noe dukket opp?» Svar lagres mot rapporten. Gir S1-data uten at det må bli en sak, og er samtidig god kundepleie. | 4 | 1 | Hendelsen `report.validity_expiring` finnes; `followup_responses` |
| S5 | **Tilstandskurve per bygningsdel** | Med flere Byggcon-rapporter på samme bolig og tusenvis på like boliger (byggeår, type, region) kan systemet vise takstmannen: «Drenering fra 1978 i Bodø: 70 % av våre rapporter gir TG2 eller TG3.» Ikke et forslag til TG, men kontekst. Senere: forventet vedlikeholdskalender til kjøper, basert på data, ikke på synsing. | 4 | 3 | Alt finnes; krever nok data (2–3 år) |
| S6 | **Neste takst sammenligner automatisk** | Ny rapport på en bolig Byggcon har taksert før: systemet viser hvert punkt side om side med forrige og markerer forverring/forbedring, og spør om tiltakene ble gjort. Gir både bedre rapport og S3-data. | 4 | 1 | `copied_from_report_id` finnes |

**Hvorfor ingen har det:** IVIT, Spectora og SmartTakst selger rapportverktøy til mange firma og ser aldri utfallet. Byggcon ser utfallet selv. Det er Byggcons eneste varige fortrinn, og det krever bare at det registreres.

---

## 2. Befaringen – gjøre takstmannen bedre, ikke bare raskere

| # | Idé | Hva det er | Verdi | Vansk. | Krok |
|---|---|---|---|---|---|
| B1 | **Briefing før befaring** | Kvelden før: ett ark per bolig, automatisk: forrige Byggcon-rapport, Optiplan-data for sameiet, NGU radon, NVE flom/skred, byggeår og typiske svakheter for boligtypen (S5), dokumenter selger har lastet opp, info fra megler, kjøretid. «Dette bør du se ekstra på.» | 5 | 2 | Alt i modellen + ekstern data; `briefing` generert som hendelse |
| B2 | **Selgers forbefaring** | Selger får en guidet lenke før befaring: ta bilde av sikringsskap, sluk, under vasken, loftsluke, krypkjellerluke. Bildene ligger klare på punktene når takstmannen kommer. Færre TGIU (eier har alt åpnet adkomst), kortere befaring, og selger er forberedt på hulltaking. | 4 | 3 | Selgerportal (H9) + `photos.source = seller` |
| B3 | **Utstyrsregister med kalibrering** | Fuktmålere, lasermålere og termokamera registreres per takstmann med kalibreringsdato. Måleverdier merkes med instrumentet. Går kalibreringen ut, varsles det, og målingen merkes i rapporten. Viktig i reklamasjonssaker («hvilket instrument, kalibrert når?»). Ingen har det. | 3 | 1 | `instruments`, `measurement.instrument_id` |
| B4 | **Bevisbilder med kjede** | Hvert bilde får fingeravtrykk, tidspunkt, enhet og takstmann i det det tas, og lagres uendret (markering er eget lag). Rapporten kan dokumentere at bildet er tatt på befaringen og ikke endret. (Standarden C2PA «content credentials» kan brukes når den er moden.) Gir Byggcon et bevisfortrinn ingen takstfirma har. | 4 | 2 | `photos.sha256`, `taken_at`, `device_id` finnes; legg til `capture_attestation` |
| B5 | **Snakkende sjekkliste** | Takstmannen har ørepropp. Appen leser neste punkt høyt og tar imot svar og diktat. Hendene er frie til stige, lommelykt og måler. Bygger på tale til tekst (kjøpt tjeneste) pluss talesyntese. | 4 | 3 | KI trinn 2; ingen ny tabell |
| B6 | **Skyggemodus for nye takstmenn** | Ny ansatt gjør befaringen på egen iPad parallelt med senior. Etterpå viser systemet punkt for punkt hvor de vurderte ulikt. Opplæring med data, ikke med «sånn gjør vi det». | 4 | 2 | To rapporter på samme oppdrag med `training = true` og sammenligningsvisning |
| B7 | **Kalibreringsquiz** | Én gang i måneden får alle takstmenn de samme 10 bildene/situasjonene (fra kalibreringsbiblioteket) og setter TG. Spredningen vises anonymt for fagrådet. Praksis blir lik over fem kontorer. | 4 | 1 | `reference_photos` (krok fra forrige dokument) + `calibration_rounds` |
| B8 | **Drone for tak og fasade** | Snødekt eller bratt tak gir TGIU i dag. En liten drone (med nødvendig tillatelse) gir bilder som knyttes til takpunktene. Ikke erstatning for inspeksjon, men færre TGIU og bedre bilder. | 3 | 5 | Bare `photos.source = drone`. Krever regelverk (luftfart) og opplæring |
| B9 | **Fuktkart** | Fuktmålinger med posisjon i rommet tegnes inn på en enkel romskisse og vises som kart i rapporten. Krever at rommet har geometri (plantegning eller LiDAR). | 3 | 4 | `rooms.geometry`, `measurement.position` |

**Strider med beslutning:** B8 og B9 (og LiDAR) peker mot et tynt native skall rundt nettappen. B1–B7 går i nettleseren.

---

## 3. Produktet – rapporten som kjøper, selger og megler faktisk vil ha

| # | Idé | Hva det er | Verdi | Vansk. | Krok |
|---|---|---|---|---|---|
| P1 | **Rapporten som lag** | Samme data vises i tre lag: (1) 1 side for den som har 2 minutter (TG-oversikt, de 5 viktigste avvikene, sum anslått kostnad), (2) nettrapport med filter, (3) full PDF. I dag må alle lese 40 sider. Lagene er ikke tre rapporter, men tre visninger av én datamodell. | 5 | 2 | `report_releases.snapshot` finnes; nettrapport (H9) |
| P2 | **Rapporten som 90-sekunders video** | Automatisk generert gjennomgang for kjøper: bilder fra rapporten, TG-farger og en nøytral opplest tekst (talesyntese) av sammendraget. Ingen nye vurderinger, bare rapporten i et format folk faktisk åpner. | 3 | 3 | Sammendrag + bilder finnes |
| P3 | **Spør rapporten** | Kjøper kan stille spørsmål til en KI som bare svarer fra rapportens innhold («hva betyr TG2 på drenering for meg?»), med tydelig merking og uten nye vurderinger. Krever juridisk avklaring (§ 1-3, ansvar). | 4 | 3 | Nettrapport; `ai_usage_log` |
| P4 | **Vedlikeholdskalender fra rapporten** | Ut fra TG2/TG3, levetider og S3-kostnadsbank: en nøytral tidslinje «hva bør gjøres når, og omtrent hva koster det». Ikke prutteliste (uavhengighet), men planlegging. Kobling til Optiplan for den som senere vil ha vedlikeholdsplan. | 4 | 2 | Alt finnes |
| P5 | **Gyldighet som levende lenke** | QR-kode i PDF (SmartTakst har siden, men ikke dette): lenken viser alltid *siste* versjon, varsler hvis rapporten er utgått, og lar megler be om fornyet rapport med ett klikk. Rapporten blir et levende dokument i stedet for en PDF som sirkulerer i gamle versjoner. | 4 | 2 | `report_releases.valid_until` finnes |
| P6 | **Megler-dashbord** | Megleren ser sine oppdrag hos Byggcon: status, leveringstid, siste rapporter, og kan bestille, flytte befaring og laste ned. Byggcon ser hvem som bruker det. Ingen av de tre gir megleren dette for *takstfirmaet*. | 4 | 3 | Rollen `broker` finnes; selgerportal-infrastruktur |
| P7 | **Energiattest-utkast fra rapporten** | Rapporten inneholder allerede det meste Enova trenger (byggeår, areal, vinduer, isolasjon, oppvarming, ventilasjon). Et utkast til energiattest lages automatisk og sendes inn når takstmannen godkjenner. IVIT har energimerking som betalt tillegg uten denne koblingen. | 3 | 3 | Mapping fra kontrollpunkter til Enova-felt; avtale med Enova API |

---

## 4. Organisasjonen – styre med data

| # | Idé | Hva det er | Verdi | Vansk. | Krok |
|---|---|---|---|---|---|
| O1 | **Kost per rapport, ekte** | Tid fra hendelsene (befaring startet/avsluttet, rapport åpnet/publisert), kilometer fra adresse, KI-kostnad fra loggen, sidemannstid. Lønnsomhet per rapporttype, per megler, per kontor. Ingen av systemene regner kostnad, bare omsetning. | 5 | 1 | `events`, `ai_usage_log.cost`, kjørelengde |
| O2 | **Samme-dag-rapport som mål** | Alt i del 1–3 peker mot ett produktmål: rapporten publiseres samme dag som befaringen for standardboliger. Måles per takstmann og kontor. Det er et mål ingen i bransjen setter høyt. | 4 | – | Måles med hendelser |
| O3 | **Fagrådets ukesbrev, automatisk** | Hver mandag: nye fraser som er lagt til, avvik der TG-forslag ble avvist og hvorfor, punkter med størst spredning mellom takstmenn, sperrer som ble overstyrt, reklamasjoner (S1). Fagrådet styrer med fakta. | 4 | 1 | Alt finnes |
| O4 | **Tilfeldig stikkprøve** | I tillegg til sidemann per ansatt: systemet trekker 5 % av alle rapporter til uanmeldt sidemannskontroll etter levering. Som revisjon. Gir kvalitetstall for hele firmaet, ikke bare for nye. | 3 | 1 | `peer_reviews.required_reason = random_sample` |
| O5 | **Kapasitet som forutsier** | Ut fra ordre inn, sesong, meglernes mønster og befaringslengde per boligtype (fra hendelsene): forventet belegg per kontor neste 4 uker, og hvor det lønner seg å låne takstmann mellom selskapene. | 3 | 3 | Kalender (H1) + hendelser |
| O6 | **Byggcon som datakilde** | Anonymisert statistikk fra 2000 rapporter i året (TG-fordeling per boligtype, byggeår, region) kan deles med SSB, DiBK, Standard Norge eller Fremtind – eller publiseres som «Boligtilstanden i Nord-Norge». Faglig tyngde og omdømme, og innflytelse på neste NS 3600. | 3 | 2 | Eksport med anonymisering; bruksvilkår |

---

## 5. Regelverk og fag – standarden som levende data

| # | Idé | Hva det er | Verdi | Vansk. | Krok |
|---|---|---|---|---|---|
| R1 | **Regler med forventet utfall** | Hver regel i malen får over tid et tall: hvor ofte takstmannen godtar forslaget. Regler som avvises ofte, flagges til fagrådet: enten er regelen feil, eller så trengs opplæring. Standarden blir Byggcons egen, kalibrerte versjon – innenfor NS 3600. | 4 | 1 | `deviations.suggestion_status` finnes |
| R2 | **Forskrifts- og standardvakt med konsekvensanalyse** | Når forskriften eller NS 3600 endres, viser systemet ikke bare «det er en endring», men hvilke kontrollpunkter, regler, fraser og rapporter under arbeid som berøres, og foreslår en ny malversjon med testtilfeller. | 3 | 3 | `template_versions.regulation_version`, `ns_edition` |
| R3 | **Kriterier som alle kan se** | Hvert TG-forslag viser i appen nøyaktig hvilket kriterium som utløste det (alder, måling, materiale) – kilden ligger i bakgrunnen i rapporten (beslutning), men er synlig for takstmannen. Over tid blir dette Byggcons egen lærebok i NS 3600, generert fra praksis. | 3 | 1 | `rules.message`, `source_ref` finnes |

---

## 6. Fem moonshots jeg ville valgt

Hvis Byggcon skal strekke seg etter noe de neste tre årene, er dette de fem som gir mest, bygger på hverandre og koster minst i forhold til verdien:

1. **Den lukkede sløyfen (S1 + S4 + S6).** Registrer reklamasjoner og utfall på punktet, spør kjøper og selger etter ett år, sammenlign automatisk ved neste takst. Koster nesten ingenting. Om tre år vet Byggcon noe ingen andre vet.
2. **Robusthet og kalibrering (S2 + B7 + R1 + O3).** Bruk sløyfen til å gjøre hver rapport sterkere før den går ut, og hver takstmann likere de andre. Dette er «kvalitet som system», ikke som rutine.
3. **Briefing og forbefaring (B1 + B2).** Takstmannen kommer forberedt, selger har åpnet luker og tatt bilder, og TGIU går ned. Det er produktløft og tidsbesparelse i samme grep.
4. **Rapporten som lag med levende gyldighet (P1 + P5 + P6).** Én datamodell, tre visninger, én lenke som alltid er oppdatert, og megleren som ser sine oppdrag. Dette er det kjøper og megler faktisk merker.
5. **Kost per rapport og samme-dag-rapport (O1 + O2).** Det eneste målet som binder alt sammen: raskere, billigere, like trygt.

Alt annet (video, spør rapporten, drone, fuktkart, energiattest, datakilde) er verdt å ha i bakhodet, men bør vente til de fem over virker.

---

## 7. Det som må inn i datamodellen nå

| Krok | For | Hva |
|---|---|---|
| `claims` | S1, S2 | Reklamasjon/sak koblet til rapport, punkt og avvik, med utfall og beløp |
| `followup_responses` | S4 | Svar fra kjøper/selger ett år etter |
| `cost_observations` | S3, P4 | Faktiske kostnader per avvikstype og region, anonymt |
| `instruments` + `measurement.instrument_id` | B3 | Utstyr med kalibrering |
| `photos.capture_attestation`, `photos.source` | B4, B2, B8 | Bevisbilder; selger/drone som kilde |
| `reports.training`, sammenligningsvisning | B6 | Skyggemodus |
| `calibration_rounds` | B7 | Månedlig quiz |
| `peer_reviews.required_reason` | O4 | Stikkprøve |
| `events` med varighet | O1, O2 | Tid per fase regnes fra hendelsene (finnes) |

Alle krokene er små. Det viktigste er at `events`, `deviations.suggestion_status`, `publish_check_results` og `report_releases.snapshot` allerede er i modellen – sløyfen bygger på dem.

---

## 8. Spørsmål til Ståle

1. **Den lukkede sløyfen:** Vil du at reklamasjoner og utfall skal registreres i EzProp fra dag én (S1)? Det er den ene ideen som bør bestemmes nå, fordi den er gratis å ta med og dyr å ettermontere.
2. **Ettårs-sløyfen (S4):** Er det greit å kontakte kjøper via megler ett år etter? Det er både læring og markedsføring.
3. **Selgers forbefaring (B2):** Tror du selgere vil gjøre det? (Erfaringen fra «hva de bør finne fram» i velkomst-e-posten vil vise det.)
4. **Samme-dag-rapport (O2):** Er det et mål du vil sette, eller er det urealistisk med dagens befaringer?
5. **Byggcon som datakilde (O6):** Er det interessant, eller skal dataene holdes helt internt?
6. Hvilke tre av ideene vil du ha med i «Målgang» som strekkmål?

*Det som bestemmes, fører jeg inn i `LES-MEG.md` (Målgang), `datamodell.md` (krokene) og `utviklingsplan.md` («Senere»).*
