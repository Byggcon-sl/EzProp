# Funksjon: Vask før KI

- **Fase:** 2a-1 KI-grunnmuren
- **Modul:** kjerne (`src/core/ai`, mønstrene i `src/shared/lib`)
- **Status:** klar for bygging (rettet etter forhåndsvurdering 11.11.2026)
- **Branch:** `fase2a-vask-for-ki` (bygger på `main`)
- **Dato:** 11.11.2026
- **Planpunkt:** «Vask før KI: navn, e-post, telefon, adresse og matrikkel fjernes før noe sendes. Med test.» (`docs/07-utviklingsplan.md`, 2a-1)
- **Grunnlag:** ADR 0006 del 5, 6 og 11; småfunn ad-1, ad-3, ad-4 og ad-7 (`docs/agenter/arkiv/tilstand-til-2026-11-10.md` linje 59); småfunnene om mål-id og `getSuggestionStatus` (`docs/agenter/tilstand.md`); forhåndsvurdering fra forenkler, ki-ansvarlig, sikkerhet-personvern og test-leder (11.11.2026, se «Avgjort ved forhåndsvurderingen»).
- **Støtter hovedmål:** KI i bunnen: vasken er en del av grunnmuren, så hver KI-funksjon som kommer i 2a-2 og 2a-3 får den uten å gjøre noe selv. / De ansatte: takstmannen kan skrive fritt i notater og tekster uten å tenke på hva som går til KI; persondata sendes aldri (regel 14). / Reklamasjoner: indirekte, ved at KI-funksjonene kan slås på tryggere og brukes mer.

## Problem
I dag stopper `src/core/ai` bare felt som ikke står på tillatt-listen. Fritekst på tillatt-listen (avvikstekst, notater, premisser) kan likevel inneholde navn, telefon, e-post, adresse og gnr/bnr, og den går rett til leverandøren. Uten vask kan ingen ekte leverandør slås på (S8), og 2a-2 kan ikke bruke KI på avviksteksten. Loggens telefonmønster fanger heller ikke åtte sifre skrevet sammen (ad-4).

## KI i bunnen
- **Hva KI gjør:** ingenting nytt for den ansatte. Vasken er grunnmur: den kjører på serveren i `requestSuggestion`, rett før leverandørkallet, på **alle** tekstverdier som sendes, også til den falske leverandøren. Ingen KI-funksjon kan gå utenom, fordi vasken ligger i den eneste veien til leverandøren (i dag kaller bare `src/core/ai/request-suggestion.ts` `provider.complete`).
- **Data som lagres for KI:** bare antall vaskede treff i `ai_usage_log` (ny kolonne, heltall). Aldri verdiene, aldri hvilke ord som ble byttet.
- **Alt gjennom `src/core/ai`:** ja. Kjente verdier hentes av modulen selv fra databasen, filtrert på `grant.organizationId`. Kalleren kan ikke sende dem inn og kan ikke glemme dem.
- **Kostnad:** 0 kr. Alt kjører mot den falske leverandøren.

## Brukerhistorier
- Som **takstmann** vil jeg **skrive notater slik jeg pleier** slik at **navn og adresser til kunden aldri sendes til KI, uten at jeg må tenke på det**.
- Som **leder** vil jeg **at det står i loggen at vasken har virket (antall treff)** slik at **vi kan svare kunder og Datatilsynet på hva som sendes**.
- Som **admin** vil jeg **at en forespørsel som er sperret, står i loggen med eget utfall** slik at **jeg kan skille den fra at KI er slått av**.

## Omfang
**Med:**

1. **Mønstrene ett sted:** `src/shared/lib/pii-patterns.ts`. Brukes av vasken **og** av loggeren (`src/shared/lib/logger.ts`), så de ikke kopieres (ADR 0006 del 6), og loggeren blir like streng som vasken (ad-4). Mønstre:
   - e-post;
   - telefon: åtte sifre skrevet sammen, gruppert (3-2-3, 2-2-2-2, 4-4), med `+47` eller `0047` foran, med mellomrom, bindestrek eller punktum mellom gruppene;
   - fødselsnummer: elleve sifre, også med mellomrom etter de seks første (ingen kontrollsiffersjekk: heller for mye enn for lite);
   - organisasjonsnummer: ni sifre, også `123 456 789` og `NO 123456789 MVA`;
   - kontonummer: elleve sifre gruppert 4-2-5 med punktum eller mellomrom (`1234.56.78901`, `1234 56 78901`);
   - matrikkel: `gnr`/`bnr`/`fnr`/`snr` med tall (også `gnr. 12 bnr. 34`, `g.nr`, `gbnr 12/34`, `12/34/0/5` når et matrikkelord står foran). `12/34` uten matrikkelord vaskes ikke av mønsteret (men av kjente verdier, punkt 2);
   - adresse: gatenavn med endelsene `-veien`, `-vegen`, `-vei`, `-veg`, `-gata`, `-gate`, `-gaten`, `-plassen`, `-bakken`, `-stien`, `-allé` (bare disse), fulgt av husnummer og eventuell bokstav; og postnummer med poststed (`8006 Bodø`). Mønsteret er en ekstra sikring, ikke full adressegjenkjenning; oppdragets egen adresse fanges som kjent verdi. Adressemønsteret brukes ikke i loggeren.
   - Rekkefølge: fødselsnummer og kontonummer før organisasjonsnummer før telefon, så lange tall ikke deles feil. I loggeren vaskes Azure-nøkler, `client_secret` og Bearer først, som i dag.
   - **Ordgrenser med Unicode:** aldri `\b`. Grensene skrives som `(?<![\p{L}\p{N}])` … `(?![\p{L}\p{N}])` med flagget `u`, så æ, ø og å regnes som bokstaver. Tallmønstrene treffer ikke inne i en UUID eller et lengre tall (grensen tar også med heksadesimale tegn og bindestrek inntil sifrene der det trengs). Teksten normaliseres til NFC før vask.
   - **Lineære mønstre:** ingen nøstede gjentakelser. Mønstrene kjøres på opptil 50 000 tegn og på hver logglinje.
2. **Kjente verdier for oppdraget (ad-3):** `src/core/ai` henter selv, når `assignmentId` er satt, og bare i organisasjonen til `grant`:
   - navn, firmanavn, e-post, telefon og organisasjonsnummer på partene (`assignment_parties`) og kontaktene/firmaene de peker på (`contacts`, `firms`, med `firms.org_number`);
   - bestilleren: `orders.ordered_by_contact_id` og `orders.ordered_by_firm_id` (kontakten og firmaet, med samme felt som over) og `orders.ordered_by_text`;
   - navn på ansatte på oppdraget (`assignment_team_members` → `employees.name`);
   - adressen (`orders.address_text`, `properties.address`, `postal_code`, `city`, `municipality_name`);
   - matrikkel (`orders.gnr/bnr/snr`, `cadastral_units.gnr/bnr/fnr/snr/share_number`, `properties.municipality_number`);
   - borettslag og sameie: `cadastral_units.association_name`, `association_org_number`, `orders.housing_association_name`, `common_areas.managing_agent`.
   - **Mykt slettede rader tas med.** Oppslaget filtrerer **ikke** på `deleted_at` for parter, kontakter, firma, teammedlemmer, matrikkel og fellesareal: en part som er fjernet fra oppdraget, står ofte fortsatt i notatene (heller for mye enn for lite, A170). Organisasjonsfilteret står alltid.
   - **Slik matches verdiene (A174):**
     - Personnavn (parter, kontakter, ansatte): hele navnet som frase uansett lengde (også «Bo Li»), og i tillegg hvert ord på minst tre tegn for seg (fornavn alene, etternavn alene). Navn deles på mellomrom og bindestrek («Anne-Lise» gir «Anne-Lise», «Anne» og «Lise»). Et navneord treffer også med genitiv `-s` eller `'s` («Hansens bad»).
     - Firmanavn, borettslag, sameie, `managing_agent` og `ordered_by_text`: bare som hel frase (med genitiv), ikke ord for ord, så fagord som «Tak», «Bygg» og «Eiendom» i «Bygg og Tak AS» ikke vaskes bort.
     - Adresse: hele strengen, gatenavn + nummer, gatenavnet alene («i Storgata»), og poststed for seg. Postnummer vaskes bare sammen med poststed eller som del av hele adressen.
     - Matrikkel: bare som kombinasjon (`12/34`, `12/34/0/5`, `1804-12/34`, «gnr 12», «bnr 34», «andelsnummer 5»), aldri som enkelttall i løpende tekst, så mål som «123 mm» står urørt.
     - E-post, telefon og organisasjonsnummer: som de står, og telefon også uten mellomrom.
     - Treff uten hensyn til store og små bokstaver, med Unicode-grenser som i punkt 1. Verdiene escapes før de blir mønster (de er skrevet av brukere: «A/S», «(Ola)», «Bygg & Co», «St.»). Lengste verdi vaskes først.
   - **Kjente verdier lever bare i minnet under det ene kallet:** ingen mellomlagring på modulnivå, aldri i `logger`, feilmeldinger, `input_summary`, `audit_log` eller svaret til kalleren.
3. **Plassholdere** (ADR 0006 del 6): `[navn]`, `[e-post]`, `[telefon]`, `[adresse]`, `[matrikkel]`, `[fødselsnummer]`, `[organisasjonsnummer]`, `[kontonummer]`. Kjente verdier vaskes før mønstrene. En verdi som er både kjent verdi og treffer et mønster (partens telefon), telles én gang.
4. **Vasken i `requestSuggestion`:**
   - Rekkefølgen blir: rettighet → tillatt-liste → oppdraget → samme `requestId` → «KI er av» (ingen rad) → sperret (`blocked`-rad) → oppslag av kjente verdier → vask → leverandørkall. Oppslaget kjøres altså først når forespørselen verken er `disabled` eller `blocked` (dataminimering).
   - Vasken kjøres på alle verdier i `fields`. Leverandøren (også den falske) får bare vasket tekst.
   - **Feil i vasken stenger:** kaster oppslaget eller vasken, kalles leverandøren aldri, og usvasket tekst sendes aldri. Feilen går ut som i dag ved uventet feil (ingen `ok`-rad).
   - Antall treff (summen) lagres i ny kolonne `ai_usage_log.redacted_count` (heltall, ikke tom, standard 0, `>= 0`). Migrering `0027_*`. `redacted_count` står ikke i svaret fra `requestSuggestion`, bare i raden.
   - `input_summary` regnes av den **vaskede** teksten, det som faktisk ble sendt. Skrives i ADR 0006 del 5.
5. **Eget utfall for sperret forespørsel (ad-1):** nytt utfall `blocked` i `ai_usage_log`.
   - Gjelder i dag: (a) fritekst uten oppdrag mot ekte leverandør, det vil si `assignmentId` er null og målet er ikke `ai_trial`; (b) måltypene `ai_trial` og `answer` mot ekte leverandør (punkt 6).
   - Raden skrives etter rettighetssjekken, leverandøren kalles ikke, `output_text`, `status` og `error_code` er tomme, tokens, kostnad og `redacted_count` er 0.
   - Svaret til kalleren er `{ kind: "blocked" }`. Samme `requestId` på nytt gir `blocked` igjen fra `toSuggestionResult`, uten ny rad og uten kall.
   - En sperret forespørsel avviser ikke forrige åpne forslag på samme mål.
   - `recordDecision`, `checkAiTextApproved` og `getSuggestionStatus` godtar aldri en `blocked`-rad.
   - Prøvesiden viser samme tekst som når KI er av («KI er av.», ingen ny skjerm og ingen ny tekst). Server-handlingen på prøvesiden gjør `blocked` om til samme svar som `disabled`. «KI er av» gir fortsatt ingen rad. ADR 0006 del 5, 6 og 11 rettes i samme PR.
6. **Mål-id-en:** måltypen `answer` kan ikke kontrolleres før tabellen `answers` finnes (2a-2). Til da behandles `answer` som `ai_trial` i vakten som finnes: godtas bare med falsk leverandør, ellers `blocked`. Ingen ny struktur per måltype nå (bygges i 2a-2). ADR 0006 del 6 sier allerede at `src/core/ai` selv skal finne oppdraget fra målet og avvise hvis det ikke stemmer med `assignmentId`; det gjøres i 2a-2 når `answers` finnes.
7. **«Aldri»-kolonnene som data og kontroll (ad-7):** listen fra ADR 0006 del 6 legges som data i `src/core/ai` og utvides med `assignment_team_members.handed_over_reason`, `certifications.certificate_number` og `assignments.number`. Hver funksjonsdefinisjon sier hvilken kolonne hver feltkode på tillatt-listen henter fra (`fieldSources`, eller `free_text` for tekst skrevet av den ansatte). En test feiler hvis en feltkode henter fra en «aldri»-kolonne eller mangler kilde. Testen har en fast kopi av minimumslisten (som i dag i `src/core/ai/features/`), så en kolonne ikke kan fjernes fra både kode og kontroll i samme endring uten rød test. Endring i tillatt-listen eller «aldri»-listen krever gjennomgang av sikkerhet-personvern i PR-en (står i kommentaren over listene).
8. **`getSuggestionStatus` (småfunn):** rettigheten sjekkes før raden leses. Den ansatte må ha minst én av rettighetene som en KI-funksjon krever; etter oppslaget sjekkes rettigheten for funksjonen på raden som i dag. Svaret er fortsatt `null` for alt som ikke kan vises.

**Ikke med (bevisst utelatt):**
- Vask av svaret fra KI (forslaget vises bare for den ansatte og lagres i loggen som i dag).
- Tilbakebytting av plassholdere i forslaget. Forslaget kommer tilbake med `[navn]` o.l., og den ansatte ser det før hen bruker det. Om plassholderne skal byttes tilbake, avgjøres senest med språkvask på avviksteksten i 2a-2; i så fall ligger koblingen bare i minnet under kallet og lagres aldri.
- Vask av `candidates`. `src/core/ai/request.ts` avviser allerede kandidater med innhold, og den sperren er nok til en funksjon trenger dem.
- Tale og bilde (fase 2b, spørsmål 55).
- Fritekst uten oppdrag til ekte leverandør (e-post til ordreforslag): forblir `blocked` til Ståle har svart på spørsmål 58.
- Navnelister (vanlige fornavn/etternavn) eller KI-basert gjenkjenning av navn. Vi vasker kjente verdier og mønstre, og godtar restrisikoen som står i ADR 0006 del 6.
- Tabellen `answers` og kontroll av `answer`-id-en og oppdraget mot den (2a-2).
- Skjerm for antall vaskede treff, eller samlede tall for leder (ad-8, senere). Ingen visning, liste eller spørring av `redacted_count` eller `blocked` per ansatt (arbeidsmiljøloven kap. 9, spørsmål 57).
- Ny skjerm eller ny tekst på prøvesiden.
- Anthropic-adapteren (eget punkt, beslutningsnotatet).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Eget forslag og status som i dag | Ingen endring |
| kontor | Som i dag | Ingen endring |
| leder | Som i dag | Ingen endring |
| admin | Som i dag (får vasket forslag, ikke `blocked`, når forespørselen er gyldig) | Ingen endring |

Ingen ny rettighet. Oppslaget etter kjente verdier filtrerer på `grant.organizationId` og har `expectTenantIsolation`.

## Data
- `ai_usage_log.redacted_count` (heltall, ikke tom, standard 0, sjekk `>= 0`). Gamle rader får 0.
- `AI_OUTCOMES` får `blocked`. Sjekkene i tabellen oppdateres: `blocked` har tom `status`, `output_text` og `error_code`.
- Migrering `0027_*` (bare ny verdi og kolonne, ingenting slettes).
- `docs/05-domenemodell.md`: kolonnen, utfallet og ordlisten (`redaction` = vask, `redacted_count`, `blocked`). `never_fields` og `field_sources` er interne konstanter i koden og føres ikke i ordlisten.
- Ingen nye faste koder utenom utfallet `blocked`.

## Skjermer
Ingen nye. Prøvesiden `/prove/ki` viser «KI er av.» også ved `blocked` (samme tekst som når KI er av).

## Regler
Ingen fagregler. Vasken er kode med testsaker (oppdiktede eksempler).

## Akseptkriterier
**Mønstrene** (`src/shared/lib/pii-patterns.test.ts`):
- [ ] Én blokk per mønster med oppdiktede eksempler som skal vaskes. Telefon fanges som `12345678`, `123 45 678`, `12 34 56 78`, `1234 5678`, `123-45-678`, `12.34.56.78`, `+4712345678`, `+47 123 45 678` og `0047 12345678`. Fødselsnummer med og uten mellomrom, organisasjonsnummer i tre former, kontonummer i to former, e-post, gnr/bnr/fnr/snr (`gnr. 12 bnr. 34`, `g.nr`, `gbnr 12/34`, `12/34/0/5` med matrikkelord) og adresse med husnummer, bokstav og «8006 Bodø».
- [ ] Elleve sifre blir `[fødselsnummer]`, ikke telefon pluss rest.
- [ ] Står urørt: `1200 mm`, `48x98`, `TG 2`, `2 x 4`, `0,25`, årstallet `1985`, datoene `11.11.2026` og `2026-11-11`, ISO-tid, UUID-er (også med bare sifre i første gruppe), `kr 4 500 000`, `12/34` uten matrikkelord, postnummer uten poststed, «ved bakken», «langs stien» (gatenavn uten nummer).
- [ ] Kjent overvask dokumentert i test: to årstall etter hverandre («1985 2010») blir `[telefon]` (A170).
- [ ] Ytelse: 50 000 tegn med mange sifre og mellomrom vaskes under en fast tidsgrense (500 ms).

**Loggeren** (`src/shared/lib/logger.test.ts`):
- [ ] Bruker de samme mønstrene: åtte sifre sammen, fødselsnummer og organisasjonsnummer i en feilmelding vaskes.
- [ ] UUID (`usageId`, `ref`), ISO-tid og feilkoder står urørt. Azure-nøkler, `client_secret` og Bearer vaskes fortsatt.

**Vasken i `src/core/ai`** (enhet):
- [ ] Kjente verdier vaskes før mønstrene; treff uten hensyn til store og små bokstaver; ord under tre tegn hoppes over, men hele navnet som frase vaskes («Bo Li»).
- [ ] Æ, ø og å først og sist i ordet («Åse Ødegård», «Bjørnø», «Sjøgata»), bindestrek («Anne-Lise»), genitiv («Hansens», «Anne-Lises») og verdier med regex-tegn («Bygg & Co A/S», «(Nord)», «St.»): ingen unntak, og verdien vaskes.
- [ ] Firmanavn vaskes som hel frase: «Bygg og Tak AS» vaskes, men «tak» og «bygg» alene i teksten står urørt.
- [ ] Adresse: hel streng, gatenavn alene, gatenavn + nummer og poststed vaskes hver for seg. Matrikkel som `12/34`, `1804-12/34` og «gnr 12» vaskes, men «123 mm» står urørt.
- [ ] Plassholderne er nøyaktig de åtte i punkt 3, og antall treff stemmer (en telefon som er både kjent verdi og mønster telles én gang).
- [ ] **Testsett med fasit:** `src/core/ai/redaction-cases.ts` med 30–50 oppdiktede notater og avvikstekster med fasit. Testen krever 0 treff som vasken går glipp av, og rapporterer antall ord som vaskes unødig.

**Integrasjon mot testdatabasen** (i de eksisterende filene, f.eks. `request-suggestion.test.ts`):
- [ ] Hver kjent verdi i punkt 2 vaskes: én tabelldrevet test med én rad per kolonne, også fornavn og etternavn alene og med annen skrift.
- [ ] Verdier fra mykt slettede parter, kontakter og teammedlemmer vaskes.
- [ ] En spion-leverandør får alle mønstre og kjente verdier i samme tekst, og ingen av verdiene finnes i ledeteksten.
- [ ] `redacted_count` stemmer; verken raden (`input_summary`, `source_fields`, `target_ref`), loggeren (fanget) eller svaret til kalleren inneholder verdiene. `input_summary` er regnet av vasket tekst.
- [ ] Feiler oppslaget av kjente verdier (eller vasken), kalles leverandøren ikke, og ingen `ok`-rad skrives.
- [ ] `blocked` for `answer` og `ai_trial` med ekte leverandør, og for fritekst uten oppdrag (`assignmentId` null, mål ikke `ai_trial`) med ekte leverandør: rad med `blocked`, tokens, kostnad og `redacted_count` 0, intet kall, forrige åpne forslag står, samme `requestId` på nytt gir `blocked` uten ny rad, og `recordDecision`, `checkAiTextApproved` og `getSuggestionStatus` godtar ikke raden.
- [ ] «KI er av» gir fortsatt ingen rad. `ai_trial` med falsk leverandør virker som før.
- [ ] Migrering 0027: `redacted_count` har standard 0 og avviser negative tall; databasen avviser `blocked` med `status`, `output_text` eller `error_code` satt.

**Tilgang og tenant-isolasjon:**
- [ ] `expectTenantIsolation` på oppslaget etter kjente verdier.
- [ ] Navnet på en part i organisasjon B står i teksten fra organisasjon A og vaskes ikke av kjente verdier (bevis for at B sine verdier aldri brukes).
- [ ] Organisasjon A sitt oppdrag i en forespørsel fra organisasjon B avvises.
- [ ] Takstmann, kontor, leder og admin får samme svar som før; admin får vasket forslag, ikke `blocked`, når forespørselen er gyldig.
- [ ] `getSuggestionStatus`: uten noen KI-rettighet leses ikke raden. Beviset er en spion på `db.select` eller telling av spørringer, ikke bare at svaret er `null`. Rettigheten på raden sjekkes som før, og mykt slettede rader gir `null`.

**Statiske tester:**
- [ ] Hver feltkode på tillatt-listen har `fieldSources`; testen blir rød for en falsk definisjon som peker på en «aldri»-kolonne eller mangler kilde; «aldri»-listen har de tre nye kolonnene og en fast kopi av minimumslisten.
- [ ] Leverandørkallet skjer etter vasken i `requestSuggestion`, og ingen andre filer kaller `provider.complete`.

**Resten:**
- [ ] `blocked` gir samme svar på prøvesiden som når KI er av («KI er av.»). Dekkes i `src/app/(ansatt)/prove/ki/actions.test.ts` (det finnes ingen komponenttest `.test.tsx` for siden). Eksisterende e2e for `/prove/ki` på PC og iPad-størrelse er grønne.
- [ ] KI-forslag kan fortsatt godtas, endres og avvises, og logges (eksisterende tester mot falsk leverandør grønne).
- [ ] ADR 0006 del 5, 6 og 11 er rettet for `blocked`, `redacted_count`, `input_summary` etter vask, de kjente verdiene, restrisikoen (to-bokstavsnavn, firmanavn bare som frase) og den utvidede «aldri»-listen.
- [ ] Ingen nye `*-testplan.test.ts`: testene legges i de filene som finnes for området.
- [ ] Versjon 0.5.4 → 0.5.5. Lint, typesjekk, Vitest og e2e grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A169** Ett sett mønstre i `src/shared/lib`, brukt av både vasken og loggeren. Loggeren blir strengere, men UUID-er og tider står urørt. Kilde: ADR 0006 del 6, ad-4. **Lett å endre.**
- **A170** Mønstrene og de kjente verdiene vasker heller for mye enn for lite: ingen kontrollsiffersjekk, åtte sifre sammen og to årstall etter hverandre regnes som telefon, og mykt slettede parter, kontakter og teammedlemmer tas med. Kilde: regel 14, ADR 0006 del 6 «restrisiko». **Lett å endre.**
- **A171** Nytt utfall `blocked` i `ai_usage_log` for sperret forespørsel, skilt fra «KI er av» (ingen rad). Kilde: ad-1. **Dyrt å endre** (verdi i data som oppbevares i 10 år).
- **A172** Bare summen av vaskede treff lagres (`redacted_count`), ikke fordelt per type. `input_summary` regnes av vasket tekst. **Lett å endre.**
- **A173** Måltypen `answer` godtas bare med falsk leverandør til `answers` finnes i 2a-2, fordi mål-id-en ikke kan kontrolleres mot organisasjonen ennå. **Lett å endre.**
- **A174** Kjente verdier: personnavn som hel frase og hvert ord på minst tre tegn (med bindestrek og genitiv); firmanavn, borettslag, sameie, forretningsfører og bestillerteksten bare som hel frase; matrikkel bare som kombinasjon; Unicode-grenser. Restrisiko: to-bokstavsnavn alene («Bo») og deler av firmanavn vaskes ikke. **Lett å endre.**
- **A175** Endring i tillatt-listen eller «aldri»-listen krever gjennomgang av sikkerhet-personvern i PR-en (svar på «hvem godkjenner listen» i ad-7). **Lett å endre.**
- **A176** Feil i vasken eller oppslaget stenger: leverandøren kalles aldri med usvasket tekst. **Lett å endre.**
- **A177** Kontonummer er et eget mønster med plassholderen `[kontonummer]`. **Lett å endre.**
- **A178** Plassholderne byttes ikke tilbake i forslaget i 2a-1; spørsmålet avgjøres senest med språkvask i 2a-2. **Lett å endre.**

## Avgjort ved forhåndsvurderingen (11.11.2026)
- **Kontroll per måltype (sikkerhet-personvern 9 mot forenkler 1):** forenkler får rett. Ingen funksjon med oppslag per måltype nå; `answer` er `blocked` mot ekte leverandør, så det finnes ingen risiko før `answers` kommer i 2a-2. Kravet om at kontrollen også skal gi oppdraget, står i ADR 0006 del 6 og gjøres da.
- **Hel frase mot ord for ord (ki-ansvarlig 2 mot sikkerhet-personvern 12):** begge tas med. Personnavn vaskes både som frase og ord for ord; firmanavn bare som frase, for å ikke ødelegge faggrunnlaget for KI.
- **Én test per kolonne (test-leder mot forenkler 4):** én tabelldrevet test med én rad per kolonne. Samme dekning, mindre kode, ingen ny testplanfil.
- **Adressemønsteret:** kort, fast liste over endelser (forenkler 3) og egne saker som ikke skal vaskes.
- **Mykt slettede rader og feil som stenger:** alle tre vurderinger var enige; tatt inn.
- **Ordlisten:** `never_fields` og `field_sources` holdes utenfor (forenkler 5).

## Roller
- **ki-ansvarlig:** sjekker at vasken ligger i den eneste veien til leverandøren, utfallet `blocked`, testsettet med fasit og rettingen av ADR 0006.
- **sikkerhet-personvern:** gjennomgår mønstrene, de kjente verdiene, «aldri»-listen og tenant-isolasjonen.
- **utvikler:** to biter i parallell: (a) mønstrene i `src/shared/lib` og loggeren; (b) kjente verdier, vasken i `requestSuggestion`, migreringen, `blocked`, «aldri»-kontrollen og `getSuggestionStatus`.
- **testskriver:** testene i akseptkriteriene, parallelt med utvikleren, i de eksisterende testfilene.

Ikke med: arkitekt (ADR 0006 finnes), ux og ui (ingen ny skjerm), fagansvarlig (ingen fagtekst).

## Signaturavvik (bit D, 11.11.2026)
- «Aldri»-listen er `NEVER_FIELDS` i `src/core/ai/never-fields.ts`, med kontrollfunksjonen `fieldSourceViolations(definition): string[]` og konstanten `FREE_TEXT_SOURCE = "free_text"`. Ingen av dem eksporteres fra `@/core/ai` (bare tester i modulen bruker dem).
- `fieldSourceViolations` gir også feil for en kilde som verken er `free_text` eller `tabell.kolonne`.

## Åpne spørsmål
- Ingen nye til Ståle. Spørsmål 54–58 står fortsatt og må være besvart før ekte leverandør brukes med ekte data.
