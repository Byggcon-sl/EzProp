# Funksjon: Tidsmåling per oppdrag og fase

- **Fase:** 2a – Rapporten på PC (punktet «Tidsmåling per rapport fra første ekte rapport» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/work-sessions`), oppdragssidene `/oppdrag/[id]` og `/oppdrag/[id]/bygninger`, ny side `/statistikk/tid`
- **Branch:** `fase2a-tidsmaling` (bygger på `main`)
- **Status:** klar til bygging (06.11.2026, prosjektleder; rettet etter forenkler og test-leder samme dag)
- **Dato:** 06.11.2026
- **Støtter hovedmål:** Tid: dette er målestokken for hovedmålet «50 % mindre tid». Uten den kan ingen si om EzProp sparer tid mot IVIT. Reklamasjoner: ikke direkte. KI først: se under.

## Problem
Hovedmålet er 50 % mindre tid per rapport, målt mot IVIT (Ståle 28.10.2026). Hendelsesloggen gir tidspunkter, men ikke hvor lenge noen faktisk har jobbet (domenemodellen 4.13). Ståle har målt tiden i IVIT for hånd på 10 oppdrag. Lar vi være, har vi ingen tall å sammenligne med når betaen starter, og første ekte rapporter går tapt som måling.

## KI først
Ikke KI, men automatikk: tiden måles uten at takstmannen gjør noe. Takstmannen fører ingen timer. Senere kan KI bruke tallene til å vise hvor tiden går (for eksempel at kontorarbeidet tar mest tid), men det er ikke med nå.

## Brukerhistorier
- Som **takstmann** vil jeg **at tiden måles av seg selv mens jeg jobber i oppdraget** slik at **jeg slipper å føre timer**.
- Som **leder** vil jeg **se samlet tid per fase for ferdige oppdrag, ved siden av nullpunktet fra IVIT** slik at **jeg ser om vi nærmer oss målet**.
- Som **admin** vil jeg **legge inn nullpunktet fra IVIT og kunne slå målingen av** slik at **sammenligningen blir riktig og vi kan stoppe målingen om de ansatte ønsker det**.

## Omfang
**Med:**
1. **Tabell `work_sessions`** (migrering `0022_tidsmaling.sql` via `pnpm db:generate`):
   - `id`, `organization_id`, `assignment_id` (påkrevd, sammensatt fremmednøkkel `(organization_id, assignment_id)` → `assignments`), `employee_id` (påkrevd, sammensatt fremmednøkkel `(organization_id, employee_id)` → `employees`), `phase` (tekst, CHECK `preparation`, `inspection`, `office`, `delivery`), `started_at`, `ended_at` (påkrevd, CHECK `ended_at >= started_at`), `created_at`, `updated_at`, `deleted_at`.
   - Indeks `(organization_id, assignment_id, employee_id, ended_at)` for oppslaget i punkt 3 og summeringen i punkt 5.
   - Ingen kolonne `source`: den ville bare hatt én verdi. Den legges til med en migrering når manuell føring kommer.
   - Ingen funksjon i koden sletter økter permanent. Retting gjøres senere med `deleted_at`.
   - `report_id` og `device_id` legges ikke inn ennå: tabellene `reports` og `devices` finnes ikke (A120).
2. **Fasen regnes ut fra oppdraget** i en ren funksjon `phaseForAssignment({ status, inspectionAt }, now)` (A119):
   - `ordered` → `preparation`.
   - `in_progress`: befaringsdato tom eller senere enn dagen i dag (Oslo-tid, `todayInOslo`) → `preparation`; samme dag som befaringen → `inspection`; etter befaringsdagen → `office`.
   - `completed` og `invoiced` → `delivery`.
   - Statusendring og endret befaringsdato gir dermed ny fase ved neste aktivitet. Det er slik økten følger statusendringene.
   - Følge: en økt på befaringsdagen som fortsetter over midnatt (Oslo-tid), blir en ny økt i fasen `office` ved første aktivitet etter midnatt, fordi fasen endres.
3. **Automatisk registrering** `recordWorkActivity(actor, organizationId, assignmentId, now = new Date())` i `src/core/work-sessions`:
   - Tilgang `organization.read` via `requireOrganizationAccess`. Oppdraget hentes med `grant.organizationId`; finnes det ikke, eller er det kansellert (slettet), gir det `NotFoundError` / ingen økt.
   - Gjør ingenting når innstillingen `time_tracking.enabled` i `organizations.settings` er av (A121). Standard: på.
   - I én transaksjon med oppdragsraden låst (`FOR UPDATE`): finn den ansattes siste økt på oppdraget som ikke er slettet. Er `ended_at` høyst 10 minutter før `now` og fasen er den samme → sett `ended_at = now`. Ellers → ny rad med `started_at = ended_at = now`. En slettet økt forlenges aldri; er den siste økten slettet, lages en ny.
   - `organizationId` brukes bare i tilgangssjekken. Alle spørringer filtrerer på `grant.organizationId`.
   - Pausen på 10 minutter er en konstant i kjernen (`IDLE_GAP_MINUTES = 10`), domenemodellen 4.13.
   - Ingen hendelse og ingen revisjonslogg per aktivitet (for mye støy).
4. **Måleren på siden:** en liten klientkomponent `WorkSessionTracker` på `/oppdrag/[id]` og `/oppdrag/[id]/bygninger`. Den kaller serverhandlingen `recordWorkActivityAction(assignmentId)` (ingen ny API-rute). Handlingen henter aktøren fra sesjonen og organisasjonen fra den innloggede ansatte, og sender videre til `recordWorkActivity`; organisasjonen tas aldri fra adressen eller skjemaet. Ingen synlig del på skjermen. Feil i kallet vises ikke og stopper ikke siden.
   - Når det sendes, avgjøres av en ren funksjon `shouldSendActivity({ lastSentAt, lastActivityAt, visible, now })`: første kall sendes når siden åpnes; deretter høyst ett kall per 60 sekunder, bare når fanen er synlig og det har vært tastatur-, mus- eller berøringsaktivitet siden forrige kall. Komponenten bruker bare denne funksjonen.
5. **Samlet visning `/statistikk/tid`** for leder og admin (ny rettighet `statistics.read`, gis til `manager`; admin har alle):
   - `getTimeStatistics(actor, organizationId)` summerer `ended_at - started_at` for økter som ikke er slettet, på oppdrag som ikke er slettet og har status `completed` eller `invoiced` (A122), gruppert **bare per fase**. Ingen periode og ingen datofelt i betaen. Ingen gruppering eller filter på ansatt, og `employee_id` returneres aldri (arbeidsmiljøloven kapittel 9, `docs/06-arkitektur.md`).
   - **Utregning (A124):**
     - *Oppdrag som telles* = ferdige eller fakturerte oppdrag med minst én økt som ikke er slettet (i hvilken som helst fase). Oppdrag uten økter (laget før målingen eller med målingen av) telles ikke, ellers trekker de snittet ned.
     - *Snitt per fase* = sum sekunder i fasen for oppdragene som telles, delt på *antall oppdrag som telles* (samme tall for alle faser). Et oppdrag uten økt i en fase bidrar med 0 i den fasen.
     - *Totalt* = sum sekunder i alle faser delt på antall oppdrag som telles. Siden nevneren er den samme, er dette lik summen av snittene per fase.
     - Minutter avrundes til nærmeste hele minutt først ved visning; utregningen gjøres i sekunder.
     - *Forskjell* = (snitt − nullpunkt) / nullpunkt × 100, avrundet til helt tall, med fortegn (minus = mindre tid enn i IVIT). Mangler nullpunktet, eller er det 0, vises «–» (ingen deling på 0). Totalt-nullpunktet er summen av de fire fasene.
     - Ingen oppdrag som telles: tabellen viser «Ingen ferdige oppdrag med målt tid ennå.» og ingen tall.
   - Tabell: fase, snitt minutter per oppdrag, nullpunktet fra IVIT og forskjell i prosent. Rad «Totalt». Antall oppdrag som telles står én gang over tabellen.
   - Tekst over tabellen: «Tiden måles automatisk mens oppdraget er åpent. Tallene vises bare samlet, aldri per person.»
   - Lenke i menyen bare for dem som har `statistics.read`.
6. **Nullpunktet, det enkleste som virker (A123):** admin legger inn minutter per fase fra IVIT og kilde (fritekst, høyst 200 tegn, for eksempel «Ståles måling i IVIT, 10 oppdrag») i et lite skjema på samme side. Antall oppdrag skrives i kilden; det er ikke eget felt. Lagres i `organizations.settings` under nøkkelen `time_tracking.baseline` (Zod: heltall 0–10 000 per fase, kilde 0–200 tegn). Samme skjema har bryteren «Mål tid» (nøkkelen `time_tracking.enabled`) med teksten «Slå av hvis de ansatte ikke ønsker måling (arbeidsmiljøloven kapittel 9).» Begge krever `organization.manage`.
   - **Lagringen slår sammen, den overskriver ikke.** Bare nøklene `time_tracking.enabled` og `time_tracking.baseline` endres (for eksempel med `settings || jsonb_build_object(...)` i én spørring). Alle andre nøkler, særlig `access.inspectors_edit_all`, beholdes uendret. Dette er et krav fordi en overskriving ville endret tilgangen uten at noen ser det.
   - Revisjonslogg `organization.settings` med feltnavnene som ble endret, slik det allerede gjøres for innstillinger.
   - Leses med `readTimeTrackingEnabled(organizationId, settings)` etter samme mønster som `readInspectorsEditAll`: mangler nøkkelen eller er verdien ikke boolsk, er målingen på.
7. **Tester** (testskriver). Alle tester som avhenger av tid, sender inn fast `now`.
   - **Enhet:**
     - `phaseForAssignment` i alle tilfellene i punkt 2: alle fire statuser; `in_progress` med befaring i går, i dag, i morgen og tom; befaring rett før og rett etter midnatt Oslo-tid.
     - `shouldSendActivity`: første kall sendes; nytt kall før 60 s sendes ikke; etter 60 s med aktivitet sendes; etter 60 s uten aktivitet sendes ikke; skjult fane sendes ikke.
     - Nullpunktskjemaet: minutter −1 / 0 / 10 000 / 10 001 og desimaltall; kilde på 200 og 201 tegn.
     - Utregningen i statistikken (ren funksjon): snitt, totalt, forskjell med fortegn, «–» når nullpunktet mangler eller er 0, og tomt resultat.
   - **Kjernen (`recordWorkActivity`):** første aktivitet lager økt; aktivitet etter 9 min 59 s forlenger; etter 10 min 1 s lager ny økt; ny fase etter statusendring lager ny økt selv innen 10 minutter; økt på befaringsdagen som fortsetter over midnatt Oslo-tid gir ny økt i `office`; er siste økt slettet, lages en ny i stedet for å forlenge den slettede; to ansatte på samme oppdrag får hver sin økt; to samtidige kall via to ulike databaseforbindelser (`Promise.all`) gir én økt (låsen); måling av gir ingen rad; nøkkelen mangler gir måling på; kansellert oppdrag gir ingen rad.
   - **Serverhandlingen:** uten innlogging avvises den og ingen rad lages; oppdrags-id fra en annen organisasjon gir ingen rad; organisasjonen kommer fra `grant.organizationId` (test der adressen eller argumentet peker på en annen organisasjon).
   - **Statistikk:** fasitsvar med oppdiktede økter etter reglene i A124; oppdrag som ikke er ferdige telles ikke; slettede økter og slettede oppdrag telles ikke; svaret har ingen felt om den ansatte (sjekk nøklene i svaret); takstmann og kontor får `AccessDeniedError`; leder og admin får lov, også admin med bare adminrollen (regel 11).
   - **Innstillinger:** bare admin kan lagre nullpunkt og bryter (leder, takstmann og kontor får `AccessDeniedError`); lagring endrer bare `time_tracking.*` og beholder alle andre nøkler, særlig `access.inspectors_edit_all` (sett `false` først og sjekk at den fortsatt er `false`); revisjonslogg skrives med feltnavn.
   - **Rettighet:** rettighetsmatrisen i `src/core/access/guards.test.ts` oppdateres med `statistics.read` (leder og admin ja, takstmann og kontor nei). `statistics.read` kan ikke gis som enkeltrettighet (A21): en slik rad gir ingen rettighet (test). Menylenken testes for alle fire rollene.
   - **Tenant-isolasjon:**
     - `recordWorkActivity`: `expectTenantIsolation` der `query` leser øktene til den innloggede organisasjonen. I tillegg: oppdrags-id fra en annen organisasjon gir `NotFoundError` og ingen ny rad.
     - `getTimeStatistics`: `expectTenantIsolation` der `query` er en intern testhjelper som gir id-ene til oppdragene som telles. I tillegg en tallprøve: organisasjon A har 30 minutter, B har 90, og A ser bare 30.
     - Lagring av innstillingene: `expectTenantIsolation` på organisasjonsraden som endres.
     - `work_sessions` føres i `tests/tenant-tables.ts` med radbygger, og `createWorkSession` legges i `tests/factories.ts`.
     - Fremmednøkkeltest: databasen nekter både `assignment_id` og `employee_id` fra en annen organisasjon.
   - **Myk sletting:** ingen eksportert funksjon sletter rader i `work_sessions` permanent (test som i de andre modulene).
   - **e2e** (PC og iPad-størrelse), `e2e/fase-2a-tidsmaling.spec.ts`, uten eget testhjelper-endepunkt:
     1. Takstmann åpner et oppdrag og er aktiv; leder setter oppdraget til ferdig; `/statistikk/tid` viser 1 oppdrag og ingen navn på personer.
     2. Admin slår målingen av; takstmann åpner et annet oppdrag; leder setter det til ferdig; statistikken viser fortsatt 1 oppdrag.
     3. Takstmann ser ikke menylenken og får «ingen tilgang» på `/statistikk/tid`.
     4. Admin lagrer nullpunkt og ser forskjellen i prosent.
8. **Dokumenter og versjon:** `docs/05-domenemodell.md` (4.13 «Bygget i fase 2a»: `work_sessions` uten `report_id`/`device_id`, `baseline_metrics` erstattet av innstillingen inntil videre; endringsloggen), ordlisten (`work session`, `phaseForAssignment`, `statistics.read`, `time_tracking.enabled`, `time_tracking.baseline`), rettighetsmatrisen (`statistics.read` for leder og admin), `docs/personvern/intern-personvernerklaering.md` avsnittet om tidsmåling (hva som lagres, at det vises samlet, bryteren, og at «samlet» i betaen i praksis er tallene til én person), planen krysses av, `package.json` 0.3.5 → 0.3.6, A119–A124 i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**
- Tabellen `baseline_metrics` og import av nullpunkt fra fil. Nullpunktet er fire tall og en kilde i innstillingene til tabellen trengs (også for reklamasjoner).
- Visning, filter eller eksport per person, og «min egen tid». Krever enighet med de ansatte (arbeidsmiljøloven kapittel 9).
- Manuell føring eller retting av økter, kolonnen `source`, og skjerm for å se enkeltøkter.
- Periodefilter og datofelt på statistikken. Kommer når datamengden krever det.
- Antall oppdrag som eget felt i nullpunktet (står i kilden).
- Egen API-rute for aktivitet og testhjelper-endepunkt for e2e.
- `report_id` og `device_id` (kommer når rapporter og enheter finnes), måling på iPad og uten nett (fase 2b).
- Fordeling per rapporttype (bare én rapporttype finnes). Kolonnen kommer med rapportene.
- Måling på andre sider enn oppdragssiden og bygningssiden (ordre, kontakter, arbeidskø). Rapportsidene får måleren når de bygges.
- Fase «levering» fra publisering eller sending (finnes ikke ennå). Til da er levering = status ferdig eller fakturert (A119).
- Grafer, KI-analyse av tiden og varsler.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Ingenting (tiden måles) | – |
| kontor | Ingenting (tiden måles) | – |
| leder | `/statistikk/tid`, bare samlet per fase | – |
| admin | `/statistikk/tid` | Nullpunkt og bryteren «Mål tid» |

Alle som har `organization.read` og åpner et oppdrag, får tiden målt når bryteren er på. `statistics.read` følger bare rollene leder og admin og kan ikke gis enkeltvis (A21).

## Data
- Ny tabell `work_sessions` (punkt 1), med organisasjons-ID, myk sletting og tenant-test.
- Nye nøkler i `organizations.settings`: `time_tracking.enabled` (boolsk, standard på) og `time_tracking.baseline` (`{ preparation, inspection, office, delivery, source }`). Lagringen slår sammen med de andre nøklene.
- Ny rettighet `statistics.read`.
- Faste koder: fasene `preparation`, `inspection`, `office`, `delivery`.

## Skjermer
- Oppdragssiden og bygningssiden: ingen endring som synes.
- `/statistikk/tid`: én tabell. For admin et lite skjema under tabellen. PC og iPad-størrelse.
- Trykk for takstmannen: 0 (før: føre tid for hånd, slik Ståle gjør i IVIT).

## Regler
Ingen TG-regler. Faseregelen (punkt 2) er en ren funksjon med testsaker.

## Akseptkriterier
- [ ] Åpner en takstmann et oppdrag og jobber i det, lagres en økt med riktig fase uten at takstmannen gjør noe.
- [ ] Pause over 10 minutter eller ny fase gir ny økt; aktivitet innen 10 minutter forlenger økten.
- [ ] Fasen følger status og befaringsdato etter regelen i punkt 2.
- [ ] Leder og admin ser snitt minutter per fase for ferdige oppdrag, regnet etter A124, og nullpunktet med forskjell i prosent («–» når nullpunktet mangler eller er 0). Ingenting vises per person.
- [ ] Lagring av nullpunkt og bryter endrer bare `time_tracking.*`; `access.inspectors_edit_all` og andre nøkler beholdes (test).
- [ ] Admin med bare adminrollen ser statistikken; `statistics.read` kan ikke gis enkeltvis (test).
- [ ] Takstmann og kontor ser ikke statistikken (test og e2e).
- [ ] Admin kan lagre nullpunktet og slå målingen av; av betyr at ingen nye økter lagres (test og e2e).
- [ ] Økter slettes aldri permanent (`deleted_at`).
- [ ] Bruker i annen organisasjon får ikke tilgang (test), og `work_sessions` står i `tests/tenant-tables.ts`.
- [ ] Virker på iPad-størrelse (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A119** Fasen regnes ut fra status og befaringsdato (punkt 2), ikke valgt av takstmannen. Grunn: null trykk (tidsmålet), og befaring på PC skjer ikke i fase 2a. Kilde: domenemodellen 4.13, hovedmål 28.10.2026, statusflyten (A74–A77). Endres i `phaseForAssignment`; levering flyttes til publisering når den finnes.
- **A120** `report_id` og `device_id` venter til tabellene finnes; økten knyttes til oppdraget. Kilde: domenemodellen 4.13. Endres med en migrering som legger til kolonnene.
- **A121** Målingen er på som standard, med bryter for admin. Grunn: bare Ståle bruker systemet i betaen og er med i målingen (svar 27, 27.10.2026), og tallene vises bare samlet (`docs/06-arkitektur.md`). Merknad: med én takstmann er «samlet» i praksis tallene til én person; det står i personvernerklæringen, og det trengs ingen sperre nå. Før flere tas med, drøfter Ståle målingen med de ansatte. Endres med bryteren.
- **A122** Statistikken teller bare ferdige og fakturerte oppdrag. Ingen periode i betaen. Kilde: A74–A77. Endres i `getTimeStatistics`; periode legges til når datamengden krever det.
- **A123** Nullpunktet lagres som innstilling (minutter per fase og kilde; antall oppdrag skrives i kilden) og ikke i tabellen `baseline_metrics` ennå. Grunn: «det enkleste som trengs for sammenligning»; tabellen kommer når nullpunktet for reklamasjoner også skal inn. Kilde: domenemodellen 4.13, LES-MEG-kartlegging (Ståles måling i IVIT, 10 oppdrag).

- **A124** Utregning av statistikken: snitt per fase og totalt deles på antall ferdige oppdrag med minst én målt økt, slik at totalt = summen av fasene; forskjell mot nullpunktet i prosent, «–» når nullpunktet mangler eller er 0. Grunn: ett fasitsvar for testen, og oppdrag uten måling skal ikke trekke snittet ned. Kilde: hovedmål 28.10.2026 (tid per rapport mot IVIT). Endres i den rene utregningsfunksjonen.

## Avgjort ved uenighet (prosjektleder, 06.11.2026)
- **Forenkler, alle fem kutt tas:** periodefilter, kolonnen `source`, egen API-rute, `sampleSize` og testhjelper i e2e fjernes. Grunn: få oppdrag og én bruker i betaen; alt kan legges til senere med en liten endring.
- **Test-leder, punktene om periode (Oslo-tid, «til» før «fra») og grensene for antall** faller bort fordi perioden og antallet er kuttet. Alle andre punkter fra test-leder er tatt inn: utregning (A124), tenant-testene, serverhandlingen, sammenslått lagring av innstillinger, rettigheten og regel 11, de manglende kjernetestene, én e2e-vei med målingen av, og merknaden om personvern til A121.

## Åpne spørsmål
- Ståle har tallene fra sin måling i IVIT (10 oppdrag). De legges inn i skjemaet når han er tilbake (føres under «Trenger Ståle når han er tilbake»).
- Drøfting med de ansatte før flere enn Ståle måles (står allerede i `docs/06-arkitektur.md`).
