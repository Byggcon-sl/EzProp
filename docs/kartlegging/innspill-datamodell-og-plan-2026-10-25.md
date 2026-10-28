# Innspill til datamodell og utviklingsplan for EzProp

Status: **Arbeidsdokument – ikke godkjent**
Sist oppdatert: 25.10.2026 (sen kveld)
Laget av: Claude, på oppdrag fra Ståle («gjør en vurdering av hva vi bør tenke på eller ha med, innspill på planen»).
Gjelder: `datamodell.md` og `utviklingsplan.md` (begge utkast 25.10.2026), lest mot `LES-MEG.md` (med «Målgang»), `svar-fra-stale-2026-10-25.md`, sidemannskontrollen del 1 og 2, NS 3600:2025+AC:2026 og forskriften.

**Slik brukes dokumentet:** Hvert innspill har et nummer, en vurdering (**Må** = bør avklares før det bygges, **Bør** = tas med i planen, **Kan** = forbedring), et forslag og en rute `[ ]` som krysses av når Ståle har tatt stilling. Svar gjerne rett i dokumentet, under hvert punkt, med dato. Det som blir bestemt, føres inn i `LES-MEG.md`, `datamodell.md` eller `utviklingsplan.md`.

---

## 0. Helhetsvurdering

Datamodellen og planen er **godt gjennomarbeidet** og henger sammen med beslutningene. De største grepene er riktige: én malmotor for systemmaler og egne maler, TG på avviket, rapport låst til malversjon, regler som data med testtilfeller, hendelser som logg og motor, organisasjons-ID på alt, og at risikoen uten nett prøves først. Sporbarhetstabellen (200 funn → fase) gjør det lett å se at ingenting er glemt uten grunn.

Det jeg vil at dere tenker gjennom, faller i fire grupper:

1. **Ting som er modellert på to måter** og må bli én (TGIU, befaring, «hvor et svar hører hjemme»).
2. **Ting som mangler** i modellen (flere befaringer, enheter/iPader, varsler, nummerserier, signering ved utgivelse, levetider med flere trinn).
3. **Rekkefølge og omfang i planen** – særlig at betaen vil håndtere ekte kundedata lenge før personvern og sikkerhetskopi kommer i fase 4, at fase 2 er svært stor, og at fagrådet er flaskehals.
4. **Praktiske ting som stopper bruk hvis de glemmes** – PDF-størrelse i e-post, oppdragsnummer uten nett, låste iPader, PDF-motor.

Topp 10 å ta stilling til først: **D1, D2, D3, D6, D9, P1, P2, P3, P5, P8.**

---

## 1. Innspill til datamodellen (D)

### D1 – Må. TGIU er modellert to steder. `[ ]`
I dag kan TGIU settes både som `checkpoint_results.tg_direct = IU` og som et avvik med `deviations.kind = tgiu` (med `tgiu_details`). To veier gir ulik praksis mellom takstmenn, ulik PDF og vanskeligere regler.
**Forslag:** Én vei. TGIU er «ikke undersøkt», ikke et avvik. Legg `tgiu_details` på `checkpoint_results` (ett sett per punkt) og ta `tgiu` ut av `deviations.kind`. Et punkt kan da være TGIU *og* ha et HMS-avvik (f.eks. loft uten adkomst der snøfanger likevel mangler), men ikke TGIU og TG2 samtidig. Regelen «hulltaking nektet → TGIU» blir da `suggest_tgiu` på punktet, ikke et utfall.

### D2 – Må. Én befaring per rapport holder ikke. `[ ]`
`inspections` er 1:1 med rapporten. I praksis: snødekt tak på første befaring gir TGIU, og takstmannen kommer tilbake. Eller megler ber om tilleggsbefaring av garasje. Hver befaring har egen dato, forhold og tilstedeværende, og TGIU-begrunnelsen kan bli borte ved andre befaring.
**Forslag:** `inspections` blir 1:n med `kind` = `main` (hovedbefaring), `supplementary` (tilleggsbefaring), `reinspection` (etterkontroll). `reports.inspection_date` (til gyldighet og malversjon) settes fra hovedbefaringen. Hvert `checkpoint_result` kan peke på hvilken befaring det ble vurdert i.

### D3 – Må. «Hvor hører svaret hjemme» må være felter, ikke en tekststreng. `[ ]`
`field_answers.instance_key` skal si om svaret gjelder bygningen, rommet eller kontrollpunktet. En fri tekstnøkkel er vanskelig å spørre på, lett å skrive feil, og gir problemer ved kopiering mellom rapporter og ved synk.
**Forslag:** Erstatt med tre valgfrie fremmednøkler: `report_building_id`, `room_id`, `checkpoint_result_id`, pluss `repeat_index` for seksjoner som gjentas uten rom. Unik nøkkel: (`report_id`, `element_id`, de tre ID-ene, `repeat_index`).

### D4 – Bør. Levetidstabellen trenger flere trinn enn «med/uten dokumentasjon». `[ ]`
NS 3600 tillegg C har for flere komponenter mer enn én grense: f.eks. «før 2000 → TG3», «2000–2009 → TG2 uten dokumentasjon», og noen komponenter har egne regler for nyere og eldre løsninger. `special_rule` som fritekst kan ikke kjøres av regelmotoren.
**Forslag:** `lifespan_entries` får i stedet rader per trinn: `material_code`, `from_year`/`to_year` (eller `min_age`), `documentation` (`with`/`without`/`any`), `outcome_kind` (`tg2`/`tg3`), `source_ref`. Da er «før 2000 gir TG3» en vanlig rad, og fagrådet kan lese tabellen som den står i standarden.

### D5 – Bør. Legg til betingelsestyper som trengs fra start. `[ ]`
Listen i 4.5 mangler: `snow_covered` (fra befaringen → foreslå TGIU på utvendige punkter), `building_type` (garasje får færre punkter), `checkpoint_tg` (regel som leser TG på et annet punkt, f.eks. krypkjeller TG3 → spørsmål under drenering), `photo_missing` (advarsel når avvik mangler bilde), `tgiu_set` (når punktet er TGIU, vis TGIU-feltene og krev dem). Og `validate`-regler trenger `target` på samme måte som `show`.

### D6 – Må. Sperre nr. 1 må ta hensyn til «gjelder ikke» og «gir ikke TG». `[ ]`
`mandatory_without_tg` må ikke slå til for punkter med `not_applicable = true` (ingen krypkjeller), for punkter med `gives_tg = false` (el, radon, rekkverk), eller for leilighet der `applies_to_unit = common` og fellesdelene ikke er vurdert. Og «gjelder ikke» på et obligatorisk punkt må kreve en kort begrunnelse, ellers blir det en bakdør.
**Forslag:** `checkpoint_results.not_applicable_reason` (påkrevd når `mandatory = true`), og sperren skrives som: obligatorisk, gir TG, ikke «gjelder ikke», og hverken `tg_direct` eller avvik med TG.

### D7 – Bør. Kriteriet «manglende dokumentasjon» mangler i årsakslisten. `[ ]`
`cause_criterion` har symptom, alder, vesentlig avvik, funksjonssvikt, fare, annet. NS 3600 gir TG2 også der dokumentasjon mangler (f.eks. våtrom uten dokumentert utførelse, el-anlegg uten samsvarserklæring der det kreves). Legg til `missing_documentation`. Det gjør også statistikken over «hvorfor TG2» mer nyttig.

### D8 – Bør. Utgivelsen bør bære med seg hvem som signerte og med hvilken sertifisering. `[ ]`
`report_releases` har `released_by`. Ved reklamasjon om fem år må det kunne vises at ansvarlig var sertifisert på utstedelsesdagen, og hvem som var medansvarlig.
**Forslag:** `report_releases.signed_by_employee_id`, `co_signed_by_employee_id`, `certification_id` (den som gjaldt), `company_id` og `report_profile_version` – alt som «øyeblikksbilde», i tillegg til `snapshot`.

### D9 – Må. Oppdragsnummer og andre løpenumre kan ikke lages uten nett. `[ ]`
Fortløpende numre krever serveren. Det er greit, fordi ordre og oppdrag opprettes på kontoret med nett, men det må sies tydelig, og det trengs en tabell `number_sequences` (`scope`, `prefix`, `next_value`) med lås, så to kontorer ikke får samme nummer. Rapport-ID-er (UUID v7) er fine uten nett.
**Forslag til format** (støtter Claudes forslag): `2026-00123` for hele organisasjonen. Skade-Bodø sitt femsifrede saksnummer (fra `99-apne-sporsmal.md`) kan ligge som `external_ref`.

### D10 – Bør. Enheter (iPader) må finnes i modellen. `[ ]`
Synk, konfliktlogg, revisjonslogg og «fjern oppdraget etter 14 dager» refererer alle til en enhet, men det finnes ingen `devices`-tabell. Den trengs også for å kunne **sperre en mistet iPad** (den har personopplysninger og bilder lokalt).
**Forslag:** `devices` (`employee_id`, `name`, `platform`, `last_seen_at`, `last_sync_at`, `blocked_at`). Ved `blocked_at` nekter serveren synk, og appen sletter lokale data neste gang den får nett.

### D11 – Bør. Varsler trenger en tabell. `[ ]`
Fase 3 har «varsler som arbeidsliste med lest/ulest». Det finnes ingen `notifications` (`employee_id`, `type`, `entity`, `read_at`, `snoozed_until`) og ingen `notification_preferences` per type. Lett å legge til nå, før hendelsesmotoren skrives.

### D12 – Bør. Oppsummering per bygningsdel bør være lagret, ikke bare beregnet. `[ ]`
Rapporten skal ha en kort tekst per bygningsdel og et sammendrag. Planen sier «generer alltid, la takstmannen redigere en kopi». Da trengs `report_section_summaries` (`report_id`, `section_key`, `generated_text`, `edited_text`, `edited_by`). Uten det kan ikke takstmannens redigering overleve en ny generering.

### D13 – Kan. Sidemannens kommentarer bør feste seg til en feltversjon. `[ ]`
`peer_review_comments.target_ref` peker på et sted. Hvis teksten endres etter kommentaren, bør kommentaren vise hva som stod da. Legg til `field_clock_at_comment` eller en liten kopi av teksten.

### D14 – Bør. Bilder: fjern GPS-posisjon før PDF, og bestem bildegrense. `[ ]`
Bilder fra iPad har GPS i EXIF. I PDF-en skal den ikke være med (personvern og avsløring av takstmannens bevegelser). `display_file_id` lages uten EXIF-GPS. Sett også en myk grense per rapport (f.eks. advarsel ved 80 bilder), så PDF-ene holder seg små (se P8).

### D15 – Kan. Eierform og boligtype. `[ ]`
Svar på spørsmål 6 i datamodellen, som faglig innspill: `ownership_form` bør være `freehold` (selveiet, egen matrikkelenhet), `section` (eierseksjon i sameie), `cooperative` (borettslagsandel), `share` (aksjeleilighet). Boligtypelisten bør også ha `apartment_in_house` (leilighet i tomannsbolig/flermannsbolig uten sameie) fordi fellesdeler da håndteres annerledes, og `farm` (våningshus) hvis Byggcon tar landbruk.

### D16 – Kan. `assignment.status = delivered` bør settes av «rapport sendt», ikke «rapport publisert». `[ ]`
En publisert rapport som ligger i køen og ikke er sendt ennå, er ikke levert. Små ting, men det styrer hva kontoret ser i listene.

### D17 – Kan. Kontakter: felt for samtykke og kilde. `[ ]`
`contacts` bør ha `source` (fra ordre, lagt inn for hånd, fra meglersystem senere) og `marketing_consent` (nei som standard, ikke brukt nå). Det er billig nå og dekker personvernkravet om å vite hvor opplysningene kom fra.

### D18 – Kan. `users` felles med Optiplan: avgjør før fase 0 om `employees.user_id` kan være tomt. `[ ]`
Ansatte som sluttet før EzProp kom, må kunne stå på gamle rapporter (import fra IVIT senere) uten innlogging. Tillat `user_id` tomt, med `deactivated_at` satt.

---

## 2. Innspill til utviklingsplanen (P)

### P1 – Må. Betaen bruker ekte kundedata lenge før fase 4. `[ ]`
Fase 2 lager tilstandsrapporter «ved siden av IVIT» med ekte adresser, selgere, bilder og egenerklæringer. Personvern, sikkerhetskopi, oppbevaring, EU/EØS-hosting og databehandleravtaler ligger i fase 4. Det er to faser for sent for det grunnleggende.
**Forslag:** Legg en kort liste **«Minimum før ekte data»** inn i slutten av fase 0 / starten av fase 2: hosting i EU/EØS med HTTPS, daglig sikkerhetskopi med én prøvd gjenoppretting, databehandleravtale med drifts- og fillagringsleverandør, tilgang bare for ansatte, enkel personvernerklæring internt, og regel for sletting av betadata som ikke skal beholdes. Full personvernpakke (protokoll, DPIA for KI, opplæring) kan fortsatt ligge i fase 4.

### P2 – Må. Fase 2 er for stor til én fase. `[ ]`
61 funn, hele malmotoren, regelmotoren, befaring på iPad, avvikskort, PDF, publisering, fraser, bilder og kontakter. Hvis alt må være ferdig før noen kan prøve, går det måneder uten tilbakemelding fra takstmennene og fagrådet.
**Forslag:** Del i **2a** og **2b**:
- **2a – Rapporten på PC:** malmotor, regneark inn/ut, regler med tester, avvikskort, TGIU, dokumentasjon, fraser, publisering med sperre, PDF. Ingen iPad, ingen offline. *Ferdig når:* fagrådet kan gå gjennom malen og reglene i et ekte skjermbilde og godkjenne tekstene der, og Ståle godtar en PDF.
- **2b – Befaringen på iPad:** to visninger, bilder, offline med løsningen fra fase 1, synkstatus. *Ferdig når:* to takstmenn har gjort hver sin rapport ved siden av IVIT.
Fagrådets godkjenning (som i dag er en risiko) blir da en del av 2a, ikke en forutsetning utenfor planen.

### P3 – Må. Fagrådet må få navn, takt og en konkret arbeidsliste. `[ ]`
Planen sier «fagrådet godkjenner tekster, terskler og regler» og kaller det en risiko. Det finnes ingen oppgave for det.
**Forslag:** Egen oppgave «Fagråd – runde 1» parallelt med fase 0: hvem sitter i fagrådet, hvor ofte de møtes, og tre leveranser: (1) tersklene i terskeltabellen med NS-punkt verifisert (R8), (2) de 10 prøveeksemplene godkjent, (3) listen over kontrollpunkter for leilighet og fellesdeler (A.4). Uten (3) kan ikke 60 % av rapportene lages i betaen.

### P4 – Bør. Ta med måling fra IVIT nå, før betaen. `[ ]`
Pilotmålene sammenligner med IVIT («tid per befaring som IVIT eller kortere»). Det finnes ingen IVIT-tall. Be to takstmenn notere tid per befaring og tid til levert rapport på 10 oppdrag i IVIT de neste ukene. Det koster ingenting og gir en ekte baseline.

### P5 – Må. Velg PDF-motor som egen ADR i fase 2a, og sett størrelsesmål. `[ ]`
PDF er leveransen. Krav: stående og liggende, profiler, bilder med markering, innholdsfortegnelse, norsk orddeling, reproduserbar. Ingen oppgave i planen velger motor (HTML→PDF på server er antydet). Det bør være en ADR med testutskrift av en rapport med 50 bilder.

### P6 – Bør. Oppgave for enhetene: iPad-oppsett og sperring. `[ ]`
Betaen setter personopplysninger og bilder lokalt på iPader. Det trengs: kode/Face ID påkrevd, appen på hjemskjermen, mulighet til å sperre enheten (D10), og helst Intune eller tilsvarende (Byggcon har Microsoft 365). Legg det i fase 2b, og nevn det i «Minimum før ekte data».

### P7 – Bør. eAccounting-prøven: ja, i fase 0–1. `[ ]`
Støtter forslaget i planens åpne spørsmål 4. Fire kall i sandbox (kunde uten dublett, fakturautkast, status, kreditnota) som egen liten oppgave. Grunnen: det avgjør om «ingen dubletter» og «status tilbake som hendelser» faktisk er mulig, og det påvirker `external_references`.

### P8 – Må. PDF i e-post: størrelse. `[ ]`
Rutine 4 og 5 sender rapporten som vedlegg. 50 bilder à 0,5 MB gir en PDF på 15–25 MB. Microsoft 365 godtar 25 MB som standard, men mange meglerkontorer avviser vedlegg over 10 MB, og e-post til selger kan stoppe hos vanlige leverandører.
**Forslag:** Mål om **PDF under 8 MB** (bilder i PDF-en nedskalert til ca. 1200 punkter lengste side, komprimert JPEG), og en regel i køen: over 8 MB → send lenke i stedet (krever gyldighetsside, som da flyttes fram) eller del i to e-poster. Dette bør testes i fase 2a, ikke oppdages i piloten.

### P9 – Bør. Sende rapport automatisk ved publisering: «Send»-knapp i betaen, automatisk i piloten. `[ ]`
Svar på datamodellens spørsmål 10a. I betaen skal ingenting gå ut uten at noen trykker, fordi feil i mottakere eller PDF er sannsynlige. I piloten slås automatikken på per selskap når køen har vist seg pålitelig.

### P10 – Bør. «Minst mulig i fase 0» – og en liten rekkefølgeendring. `[ ]`
Fase 0 har 16 punkter, inkludert grunnlayout og admin-sider. Fase 1 (prøven uten nett) er viktigst. Forslag: oppgave 1–2 (repo, database) og oppgave 3–7 (prøven) først, deretter resten av fase 0. Det står allerede som note, men planen bør vise rekkefølgen tydelig: **0a (repo + db) → 1 (prøve) → 0b (innlogging, organisasjon, roller, layout) → 2a → 2b**.

### P11 – Bør. Testdata og testmiljø som egen oppgave. `[ ]`
P44 i sidemannskontrollen foreslo ett anonymisert oppdrag per boligtype. Planen nevner testskjema i fase 1, men ikke testdata for fase 2. Lag fire testoppdrag (enebolig med garasje, leilighet i sameie, borettslagsleilighet, fritidsbolig) som ligger i repoet som «seed», med bilder uten personer. De brukes i «Prøv malen», i regeltester og i demoer.

### P12 – Bør. Hemmeligheter og sikkerhet som punkter i fase 0, ikke fase 4. `[ ]`
`secret_ref` i modellen forutsetter en nøkkelboks (Azure Key Vault). Det, pluss sperre etter gjentatte innloggingsfeil, bør være i fase 0 (det er samme oppsett som Optiplan). Tofaktor kan fortsatt vente.

### P13 – Kan. Malbyggeren (fase 5): PDF for egne maler er den vanskelige delen. `[ ]`
Å lage feltene er enkelt; å få en pen PDF fra en mal ingen utvikler har sett, er vanskelig. Planen bør si at egne maler får én generisk PDF-layout (seksjon → felt → svar, bilder i rutenett) og at systemmaler har spesialdesignet layout. Hvis takstmennene vil ha mer, er det en ny fase.

### P14 – Kan. Overgangen fra IVIT: lag listen «omveier til IVIT» fra første betarapport. `[ ]`
Planen måler «omveier til IVIT» i piloten. Start listen i betaen. Alt takstmannen måtte gjøre i IVIT likevel (ordrebekreftelse, verditakst, meglerlevering, kalender) føres opp. Det er den ærligste fremdriftsmåleren mot målgang-hovedmålet.

### P15 – Kan. Sett en enkel «beslutningsfrist» per fase for Ståle. `[ ]`
Ingen tidsplan er greit. Men hver fase bør slutte med «Ståle svarer på X spørsmål innen demoen», slik at godkjenningene ikke hoper seg opp. Kapasitet hos Ståle står som risiko; dette er tiltaket.

---

## 3. Svar på de åpne spørsmålene i `datamodell.md` (faglige innspill, Ståle avgjør)

| Nr | Spørsmål | Innspill |
|---|---|---|
| 1 | Felles innlogging | Én innlogging, én `users`-tabell eid av Optiplan, EzProp har `employees` med `user_id`. Avtal at endringer i `users` krever enighet mellom begge repoer. |
| 2 | Originalbilder | Behold originaler i 2 år, komprimert i 10. Men: originalen er beviset ved tvist om hva bildet viste. Vurder «original i 10 år bare for bilder som er brukt i et avvik» (typisk 10–20 av 50). Det halverer kostnaden og beholder det som teller. |
| 3 | Sidemannskontroll ved publisering | Advarsel, ikke sperre. Men advarselen bør være synlig for leder i statistikk (hvor ofte publiseres det uten gjennomført kontroll der kravet er satt). |
| 4 | Hva sidemannen gjør | Kommenterer og godkjenner. Ikke rette selv. Unntak: skrivefeil kan rettes med «rettet av sidemann» i loggen – ellers blir små ting tungvint. |
| 5 | Statusliste | OK. Legg til `revised` som underlys av `delivered` (ny versjon er sendt) hvis kontoret skal se det i listen. Og se D16. |
| 6 | Eierform/boligtype | Se D15. |
| 7 | Hvem ser alle oppdrag | Ja, alle ser alle. Men kontakters e-post og telefon bør bare vises for teamet og kontoret (minimering). |
| 8 | Fakturering | Kontor, leder, admin. Takstmenn kan få rettigheten. Enig. |
| 9 | Oppdragsnummer | `2026-00123`. Se D9. |
| 10a | Automatisk sending | «Send»-knapp i beta, automatisk i pilot. Se P9. |
| 10b | Påminnelse dagen før | Kl. 12 til selger, kopi til takstmann. |
| 10c | Spørreundersøkelse | Microsoft Forms (finnes alt), 3 dager etter sending av rapport, ikke etter publisering. Lagre bare lenken og «sendt», ikke svarene. |
| 10d | Rettet rapport | Ikke automatisk. Oppgave til kontoret. Enig. |
| 11 | «Handling»-fraser | Importer som tiltak, og merk dem `needs_split = true`. Vis et lite merke i frasevelgeren til de er delt. Da forsvinner ikke jobben i mengden. |
| 12 | Gyldig til | Forskriften § 1-6 regner fra rapportdato (utgivelse), ikke befaringsdato. NS 3600 bruker befaringsdato for hvilken utgave som gjelder. Forslag: `valid_until` = ett år fra **første utgivelse**, og advarsel hvis befaring og utgivelse er mer enn 30 dager fra hverandre. Dette bør sjekkes mot forskriftsteksten før det låses. |
| 13 | Oppdrag på iPaden | 14 dager, og aldri før alt er lastet opp og bekreftet. Enig. |
| 14 | Regler i egne maler | Bare felt og enkle «vis når». Enig. |
| 15 | Kostnadsintervaller | Behold IVITs fem i betaen. Fagrådet vurderer etter piloten, med data fra `suggestion_status`. |

---

## 4. Sjekkliste før fase 0 starter

- [ ] D1, D2, D3, D6, D9 er avgjort og ført inn i `datamodell.md`
- [ ] «Minimum før ekte data» (P1) er skrevet inn i planen
- [ ] Fase 2 er delt i 2a og 2b (P2), og rekkefølgen 0a → 1 → 0b → 2a → 2b står i planen (P10)
- [ ] Fagrådet har navn, takt og tre første leveranser (P3)
- [ ] To takstmenn noterer tid i IVIT på 10 oppdrag (P4)
- [ ] PDF-størrelse har et mål, og PDF-motor skal velges som ADR (P5, P8)
- [ ] eAccounting-prøven er en egen oppgave i fase 0–1 (P7)
- [ ] De åpne spørsmålene i `datamodell.md` avsnitt 9 er besvart
- [ ] `LES-MEG.md` er oppdatert med det som ble bestemt

---

## 5. Det som er bra og bør beholdes

- **Én malmotor** med `template_elements` for alle maler, og kontrollpunkter bare for systemmaler. Riktig avveining mellom malbyggeren (fase 5) og tilstandsrapporten.
- **TG på avviket** og `tg_computed` på punktet. Det fjerner Spectoras svakhet og gir riktig PDF.
- **Regler som data med lite, fast sett betingelser, faste koder og testtilfeller**, og regelmotoren som én kodepakke for iPad og server. Dette er den viktigste tekniske beslutningen, og den er riktig.
- **Fraser utenfor malversjonen** med kobling til faste koder. Løser «åpent for alle» og «låst rapport» samtidig.
- **Bygninger og rom per rapport**, ikke per eiendom. Riktig for reklamasjon.
- **Utgivelser med snapshot, PDF og fingeravtrykk**, opprinnelig dato ved retting, `retain_until` som ikke kan overstyres.
- **Sperre med overstyring per kontroll og per versjon.** Nøyaktig det Ståle bestemte, og sporbart.
- **Hendelser som både logg og motor**, kø med «hvorfor» i klarspråk, og seks ferdige oppskrifter som data.
- **Tilkoblinger med `secret_ref`** og `external_references` mot dubletter.
- **Planens form:** faser med «ferdig når», demo per fase, én oppgave per tråd, sporbarhet for alle funn, og at risikoen uten nett prøves før noe annet bygges.

---

*Svar gjerne per punkt: «D1 enig», «P2 uenig – vi tar hele fase 2 fordi …». Det som bestemmes, fører jeg inn i LES-MEG, datamodellen og planen når du sier fra.*
