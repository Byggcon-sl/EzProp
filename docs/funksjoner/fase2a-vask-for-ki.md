# Funksjon: Vask før KI

- **Fase:** 2a-1 KI-grunnmuren
- **Modul:** kjerne (`src/core/ai`, mønstrene i `src/shared/lib`)
- **Status:** utkast
- **Branch:** `fase2a-vask-for-ki` (bygger på `main`)
- **Dato:** 11.11.2026
- **Planpunkt:** «Vask før KI: navn, e-post, telefon, adresse og matrikkel fjernes før noe sendes. Med test.» (`docs/07-utviklingsplan.md`, 2a-1)
- **Grunnlag:** ADR 0006 del 5, 6 og 11; småfunn ad-1, ad-3, ad-4 og ad-7 (`docs/agenter/arkiv/tilstand-til-2026-11-10.md` linje 59); småfunnene om mål-id og `getSuggestionStatus` (`docs/agenter/tilstand.md`).
- **Støtter hovedmål:** KI i bunnen: vasken er en del av grunnmuren, så hver KI-funksjon som kommer i 2a-2 og 2a-3 får den uten å gjøre noe selv. / De ansatte: takstmannen kan skrive fritt i notater og tekster uten å tenke på hva som går til KI; persondata sendes aldri (regel 14). / Reklamasjoner: indirekte, ved at KI-funksjonene kan slås på tryggere og brukes mer.

## Problem
I dag stopper `src/core/ai` bare felt som ikke står på tillatt-listen. Fritekst på tillatt-listen (avvikstekst, notater, premisser) kan likevel inneholde navn, telefon, e-post, adresse og gnr/bnr, og den går rett til leverandøren. Uten vask kan ingen ekte leverandør slås på (S8), og 2a-2 kan ikke bruke KI på avviksteksten. Loggens telefonmønster fanger heller ikke åtte sifre skrevet sammen (ad-4).

## KI i bunnen
- **Hva KI gjør:** ingenting nytt for den ansatte. Vasken er grunnmur: den kjører på serveren i `requestSuggestion`, rett før leverandørkallet, på **alle** tekstverdier som sendes, også til den falske leverandøren. Ingen KI-funksjon kan gå utenom, fordi vasken ligger i den eneste veien til leverandøren.
- **Data som lagres for KI:** bare antall vaskede treff i `ai_usage_log` (ny kolonne, heltall). Aldri verdiene, aldri hvilke ord som ble byttet.
- **Alt gjennom `src/core/ai`:** ja. Kjente verdier hentes av modulen selv fra databasen, filtrert på `grant.organizationId`. Kalleren kan ikke sende dem inn og kan ikke glemme dem.

## Brukerhistorier
- Som **takstmann** vil jeg **skrive notater slik jeg pleier** slik at **navn og adresser til kunden aldri sendes til KI, uten at jeg må tenke på det**.
- Som **leder** vil jeg **se i loggen at vasken har virket (antall treff)** slik at **jeg kan svare kunder og Datatilsynet på hva som sendes**.
- Som **admin** vil jeg **at en forespørsel som er sperret, står i loggen med eget utfall** slik at **jeg kan skille den fra at KI er slått av**.

## Omfang
**Med:**
1. **Mønstrene ett sted:** `src/shared/lib/pii-patterns.ts` (navn velges av utvikler). Brukes av vasken **og** av loggeren (`src/shared/lib/logger.ts`), så de ikke kopieres (ADR 0006 del 6), og loggeren blir like streng som vasken (ad-4). Mønstre:
   - e-post;
   - telefon: åtte sifre skrevet sammen, gruppert (3-2-3, 2-2-2-2, 4-4), med `+47` eller `0047` foran, med mellomrom eller bindestrek;
   - fødselsnummer: elleve sifre, også med mellomrom etter de seks første (ingen kontrollsiffersjekk: heller for mye enn for lite);
   - organisasjonsnummer: ni sifre, også `123 456 789` og `NO 123456789 MVA`;
   - matrikkel: `gnr`/`bnr`/`fnr`/`snr` med tall (også `gnr. 12 bnr. 34`, `g.nr`, `gbnr 12/34`, `12/34/0/5` når et matrikkelord står foran);
   - adresse: gatenavn med vanlige endelser (`-veien`, `-vegen`, `-vei`, `-veg`, `-gata`, `-gate`, `-gaten`, `-plassen`, `-bakken`, `-stien`, `-allé` o.l.) fulgt av husnummer og eventuell bokstav, og postnummer med poststed (`8006 Bodø`).
   - Rekkefølge: fødselsnummer før organisasjonsnummer før telefon, så lange tall ikke deles feil.
2. **Kjente verdier for oppdraget (ad-3):** `src/core/ai` henter selv, når `assignmentId` er satt, og bare i organisasjonen til `grant`:
   - navn, firmanavn, e-post og telefon på partene (`assignment_parties`) og kontaktene/firmaene de peker på (`contacts`, `firms`);
   - navn på ansatte på oppdraget (`assignment_team_members` → `employees.name`);
   - adressen (`orders.address_text`, `properties.address`, `postal_code`, `city`);
   - matrikkel (`orders.gnr/bnr/snr`, `cadastral_units.gnr/bnr/fnr/snr/share_number`);
   - borettslag og sameie: `cadastral_units.association_name`, `association_org_number`, `orders.housing_association_name`, `common_areas.managing_agent`, `orders.ordered_by_text`.
   - Navn deles i ord, og hvert ord på minst tre tegn vaskes for seg (fornavn alene, etternavn alene). Verdier under tre tegn hoppes over. Treff er hele ord, uten hensyn til store og små bokstaver.
3. **Plassholdere** (ADR 0006 del 6): `[navn]`, `[e-post]`, `[telefon]`, `[adresse]`, `[matrikkel]`, `[fødselsnummer]`, `[organisasjonsnummer]`. Kjente verdier vaskes før mønstrene.
4. **Vasken i `requestSuggestion`:** rett før leverandørkallet, på alle verdier i `fields`. Den falske leverandøren får bare vasket tekst. Antall treff (summen) lagres i ny kolonne `ai_usage_log.redacted_count` (heltall, ikke tom, standard 0). Migrering `0027_*`.
5. **Eget utfall for sperret forespørsel (ad-1):** nytt utfall `blocked` i `ai_usage_log`. Gjelder i dag: fritekst uten oppdrag mot ekte leverandør, og måltyper som bare godtas med falsk leverandør (`ai_trial`, se punkt 6). Rad skrives, leverandøren kalles ikke, `output_text` og `status` er tomme. Svaret til kalleren er `{ kind: "blocked" }`; prøvesiden viser samme tekst som når KI er av (ingen ny skjerm). «KI er av» gir fortsatt ingen rad. ADR 0006 del 5, 6 og 11 rettes i samme PR.
6. **Mål-id-en kontrolleres mot organisasjonen:** måltypen `answer` kan ikke kontrolleres før tabellen `answers` finnes (2a-2). Til da behandles `answer` som `ai_trial`: godtas bare med falsk leverandør, ellers `blocked`. Kontrollen skrives som én funksjon i `src/core/ai` (oppslag per måltype) som 2a-2 fyller ut for `answer`.
7. **«Aldri»-kolonnene som data og kontroll (ad-7):** listen fra ADR 0006 del 6 legges som data i `src/core/ai` og utvides med `assignment_team_members.handed_over_reason`, `certifications.certificate_number` og `assignments.number`. Hver funksjonsdefinisjon sier hvilken kolonne hver feltkode på tillatt-listen henter fra (`fieldSources`, eller `free_text` for tekst skrevet av den ansatte). En test feiler hvis en feltkode henter fra en «aldri»-kolonne, eller mangler kilde. Endring i tillatt-listen eller «aldri»-listen krever gjennomgang av sikkerhet-personvern i PR-en (står i kommentaren over listene).
8. **`getSuggestionStatus` (småfunn):** rettigheten sjekkes før raden leses. Den ansatte må ha minst én av rettighetene som en KI-funksjon krever; etter oppslaget sjekkes rettigheten for funksjonen på raden som i dag. Svaret er fortsatt `null` for alt som ikke kan vises.

**Ikke med (bevisst utelatt):**
- Vask av svaret fra KI (forslaget vises bare for den ansatte og lagres i loggen som i dag).
- Vask av `candidates` (ingen funksjon bruker kandidater ennå; vasken skrives så den kan ta dem når de kommer).
- Tale og bilde (fase 2b, spørsmål 55).
- Fritekst uten oppdrag til ekte leverandør (e-post til ordreforslag): forblir `blocked` til Ståle har svart på spørsmål 58.
- Navnelister (vanlige fornavn/etternavn) eller KI-basert gjenkjenning av navn. Vi vasker kjente verdier og mønstre, og godtar restrisikoen som står i ADR 0006 del 6.
- Tabellen `answers` og kontroll av `answer`-id-en mot den (2a-2).
- Skjerm for antall vaskede treff, eller samlede tall for leder (ad-8, senere).
- Ny skjerm eller ny tekst på prøvesiden.
- Anthropic-adapteren (eget punkt, beslutningsnotatet).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Eget forslag og status som i dag | Ingen endring |
| kontor | Som i dag | Ingen endring |
| leder | Som i dag | Ingen endring |
| admin | Som i dag | Ingen endring |

Ingen ny rettighet. Oppslagene etter kjente verdier filtrerer på `grant.organizationId` og har `expectTenantIsolation`.

## Data
- `ai_usage_log.redacted_count` (heltall, ikke tom, standard 0, sjekk `>= 0`).
- `AI_OUTCOMES` får `blocked`. Sjekkene i tabellen oppdateres: `blocked` har tom `status`, `output_text` og `error_code`.
- Migrering `0027_*` (bare nye verdier og kolonne, ingenting slettes).
- `docs/05-domenemodell.md`: kolonnen, utfallet og ordlisten (`redaction` = vask, `redacted_count`, `blocked`, `never_fields`, `field_sources`).
- Ingen nye faste koder utenom utfallet `blocked`.

## Skjermer
Ingen nye. Prøvesiden `/prove/ki` viser «KI er ikke tilgjengelig» også ved `blocked`.

## Regler
Ingen fagregler. Vasken er kode med testsaker (oppdiktede eksempler, ett per mønster og per kjent verdi).

## Akseptkriterier
- [ ] Hvert mønster har tester med oppdiktede eksempler som skal vaskes, og eksempler som ikke skal vaskes (mål som `1200 mm`, årstall, `TG 2`, `2 x 4`, datoer).
- [ ] Telefon fanges som `12345678`, `123 45 678`, `12 34 56 78`, `+4712345678`, `+47 123 45 678` og `0047 12345678`.
- [ ] Fødselsnummer, organisasjonsnummer, e-post, gnr/bnr/fnr/snr og adresse med postnummer fanges.
- [ ] Hver kjent verdi i punkt 2 under «Med» vaskes (én test per kolonne), også fornavn og etternavn alene og med annen skrift (store/små bokstaver).
- [ ] Test: den falske leverandøren får aldri se noen av verdiene (alle mønstre og kjente verdier i samme tekst).
- [ ] `ai_usage_log.redacted_count` viser antall treff; verken loggen, `input_summary` eller `logger` inneholder verdiene.
- [ ] Loggeren bruker de samme mønstrene (test: åtte sifre sammen, fødselsnummer og organisasjonsnummer i en feilmelding vaskes).
- [ ] Sperret forespørsel gir rad med utfall `blocked`, uten leverandørkall; «KI er av» gir fortsatt ingen rad.
- [ ] Måltypen `answer` med ekte leverandør gir `blocked`.
- [ ] Testen for «aldri»-kolonnene feiler hvis en feltkode henter fra en «aldri»-kolonne eller mangler kilde; listen har de tre nye kolonnene.
- [ ] `getSuggestionStatus` leser ikke raden når den ansatte mangler alle KI-rettigheter (test).
- [ ] Bruker i annen organisasjon får ikke tilgang, og kjente verdier fra en annen organisasjons oppdrag brukes aldri (`expectTenantIsolation` på oppslaget).
- [ ] Prøvesiden virker som før på PC og iPad-størrelse (eksisterende e2e grønn).
- [ ] KI-forslag kan fortsatt godtas, endres og avvises, og logges (eksisterende tester mot falsk leverandør grønne).
- [ ] ADR 0006 del 5, 6 og 11 er rettet for `blocked`, `redacted_count`, de kjente verdiene og den utvidede «aldri»-listen.
- [ ] Versjon 0.5.4 → 0.5.5. Lint, typesjekk, Vitest og e2e grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A169** Ett sett mønstre i `src/shared/lib`, brukt av både vasken og loggeren. Loggeren blir strengere. Kilde: ADR 0006 del 6, ad-4. **Lett å endre.**
- **A170** Mønstrene vasker heller for mye enn for lite (ingen kontrollsiffersjekk; åtte sifre sammen regnes som telefon). Kilde: regel 14, ADR 0006 del 6 «restrisiko». **Lett å endre.**
- **A171** Nytt utfall `blocked` i `ai_usage_log` for sperret forespørsel, skilt fra «KI er av» (ingen rad). Kilde: ad-1. **Dyrt å endre** (verdi i data som oppbevares i 10 år).
- **A172** Bare summen av vaskede treff lagres (`redacted_count`), ikke fordelt per type. Det enkleste som viser at vasken virker. **Lett å endre.**
- **A173** Måltypen `answer` godtas bare med falsk leverandør til `answers` finnes i 2a-2, fordi mål-id-en ikke kan kontrolleres mot organisasjonen ennå. **Lett å endre.**
- **A174** Kjente verdier: navn deles i ord, ord under tre tegn hoppes over, treff på hele ord uten hensyn til store og små bokstaver. **Lett å endre.**
- **A175** Endring i tillatt-listen eller «aldri»-listen krever gjennomgang av sikkerhet-personvern i PR-en (svar på «hvem godkjenner listen» i ad-7). **Lett å endre.**

## Roller
- **ki-ansvarlig:** sjekker at vasken ligger i den eneste veien til leverandøren, utfallet `blocked` og rettingen av ADR 0006.
- **sikkerhet-personvern:** gjennomgår mønstrene, de kjente verdiene, «aldri»-listen og tenant-isolasjonen.
- **utvikler:** to biter i parallell: (a) mønstrene i `src/shared/lib` og loggeren; (b) kjente verdier, vasken i `requestSuggestion`, migreringen, `blocked`, «aldri»-kontrollen og `getSuggestionStatus`.
- **testskriver:** testene i akseptkriteriene, parallelt med utvikleren.

Ikke med: arkitekt (ADR 0006 finnes), ux og ui (ingen ny skjerm), fagansvarlig (ingen fagtekst).

## Åpne spørsmål
- Ingen nye. Spørsmål 55 (tale og bilde) og 58 (fritekst uten oppdrag) står fortsatt.
