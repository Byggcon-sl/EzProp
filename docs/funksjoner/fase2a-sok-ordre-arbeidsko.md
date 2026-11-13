# Funksjon: Søk i ordrelisten og i arbeidskøen (T2)

- **Fase:** 2a (punkt fra Ståles svar 12.11.2026, T2: «Ja, nå»)
- **Modul:** kjerne (`src/core/orders`, `src/core/assignments`, felles søkehjelper i `src/shared/lib`)
- **Branch:** `sok-ordre-arbeidsko` (bygger på main)
- **Status:** klar til bygging (13.11.2026, prosjektleder, etter gjennomgang av forenkler, arkitekt, ux og test-leder; fortsettelsen gjennomgått av sikkerhet-personvern og test-leder samme dag)
- **Støtter hovedmål:** De ansatte: kontoret finner ordren eller oppdraget med ett søk når megleren ringer, uansett om de husker adressen, nummeret, megleren eller gnr/bnr. / KI i bunnen: søket bruker de samme strukturerte feltene som KI skal bruke senere, og søketeksten sendes aldri til KI. / Reklamasjoner: mindre fare for at kontoret retter eller svarer på feil oppdrag (matrikkel sammenlignes del for del, og raden viser meglerens ordrenummer).

## Problem
Ordrelisten (`/ordre`) har ikke søk og viser alle ordrer uten grense. Med ca. 2000 ordre i året blir den fort uoversiktlig og treg, og iPaden har ikke Ctrl+F. Arbeidskøen søker bare på oppdragsnummer og adresse, så kontoret finner ikke oppdraget når megleren oppgir sitt eget ordrenummer, sitt navn eller matrikkelen. Lar vi være, må kontoret bla eller gå via andre sider, og det er lett å velge feil oppdrag. IVIT har søk på oppdragsnummer, adresse og matrikkel; vi blir like gode og finner i tillegg megler, ordrenummer og partsnavn.

## KI i bunnen
- KI gjør ingenting i selve søket nå. Søket er en fast spørring i databasen, virker likt hver gang og trenger ikke KI. Søk med vanlig språk og «globalt søk» hører til «Søk og arkiv» i en senere fase.
- Søketeksten kan inneholde navn, adresse og matrikkel. Den sendes **aldri** til KI, logges ikke i `ai_usage_log`, skrives ikke i revisjonsloggen eller hendelser, og logges ikke med `console` på serveren.
- Søket bare leser. Ingen nye data lagres.

## Brukerhistorier
- Som **kontor** vil jeg **søke i ordrelisten på adresse, megler, meglerens ordrenummer eller gnr/bnr** slik at **jeg finner ordren mens megleren er i telefonen**.
- Som **takstmann** vil jeg **søke i arbeidskøen på det samme** slik at **jeg finner oppdraget uten å bla**.
- Som **kontor eller leder** vil jeg **se at søket har treff i en annen fane** slik at **jeg ikke tror oppdraget mangler** (T-0029).

## Flyt
- Ordrelisten (PC og iPad): Ordre → skriv i søkefeltet → Enter/Søk → trykk raden → ordresiden.
- Arbeidskøen, kontoret: Arbeidskø (starter på «Alle») → skriv → Enter → treff i fanen? ja: trykk kortet / nei: «Treff i: Ferdig (1)» → trykk lenken → trykk kortet.
- Trykk og tid: ordrelisten før ca. 30–90 s med blaing, etter skriving + 2 trykk (ca. 5–10 s). Arbeidskøen før 3–6 trykk og ofte «ingen oppdrag» (T-0029), etter skriving + 2 trykk, eller 3 hvis treffet ligger i en annen fane.
- Uten nett: ordrelisten og arbeidskøen hentes fra serveren, så søket trenger nett. Befaringen og synken berøres ikke, ingen data kan gå tapt. Står i testrapporten.

## Omfang
**Med:**
1. **Felles søkehjelper** `src/shared/lib/like-pattern.ts` (ren strengfunksjon, ingen Drizzle):
   - `export const SEARCH_QUERY_MAX_LENGTH = 100;`
   - `export function likePattern(query: string | null | undefined): string | null` – trimmer, kutter til 100 tegn, escaper `\`, `%` og `_`, tom tekst gir `null`.
   - Erstatter `searchPattern` og `MAX_QUERY_LENGTH` i `src/core/contacts/search.ts`, den lokale `likePattern` i `work-queue.ts` og `WORK_QUEUE_QUERY_MAX_LENGTH`. `matchesAny` (Drizzle) blir i kjernen. Kontaktsøket finner det samme som før.
2. **Søkevilkåret står ett sted:** ny fil `src/core/assignments/search.ts` (ikke i `core/orders`, fordi `core/orders` allerede importerer fra `core/assignments`; ingen import motsatt vei).
   - `export function parseCadastralQuery(query: string): { gnr: string; bnr: string; fnr?: string; snr?: string } | null` – ren funksjon. Godtar `tall/tall[/tall[/tall]]`, mellomrom rundt «/» tåles. Alt annet gir `null` (ingen krasj på «12/», «abc»).
   - `export function orderFieldsMatch(query: string): SQL | undefined` – kolonnene på `orders`: `address_text`, `external_ref`, `ordered_by_text`, og matrikkel.
   - `export function assignmentFieldsMatch(organizationId: string, query: string): SQL | undefined` – korrelerer på `assignments.id`: `assignments.number`, eiendommens `properties.address`, `assignment_parties.name` og `firm_name`, og `cadastral_units`.
   - Alle undertabeller hentes med `EXISTS`. Hver `EXISTS` har organisasjon (`grant.organizationId`), `deleted_at is null` og kobling på id. Ingen doble rader.
   - Begge listene har `assignments` i spørringen (arbeidskøen i FROM, ordrelisten som LEFT JOIN), så samme vilkår brukes begge steder. Arbeidskøen når ordren med `EXISTS` på samme kobling som `orderAddress` i dag (`orders.id = assignments.order_id or orders.assignment_id = assignments.id`).
3. **Søkefeltene** (ett felt, `?q=`, delvis treff uten forskjell på store og små bokstaver):
   - adresse: `orders.address_text` og `properties.address`
   - oppdragsnummer: `assignments.number`
   - ordrenummer (meglerens referanse): `orders.external_ref`
   - oppdragsgiver og parter: `orders.ordered_by_text`, `assignment_parties.name` og `firm_name`
   - **matrikkel, likhet per del (ikke delvis tekst):** ser søket ut som matrikkel (`parseCadastralQuery` gir svar), legges det til en egen OR-gren der `gnr` og `bnr` må være like (trimmet), og `fnr`/`snr` bare sammenlignes når de er oppgitt. Tomt `fnr` regnes som 0 (`coalesce(nullif(trim(fnr), ''), '0')`). Ordren har bare `gnr`, `bnr`, `snr` (ingen `fnr`); på ordren sammenlignes `gnr`, `bnr` og eventuelt `snr`, og `fnr` bare mot `cadastral_units`. Ingen ny kolonne. «12/34» finner 12/34 og 12/34/0/5, men **ikke** 112/34 eller 12/345. Tekstsøket på de andre feltene går som før i tillegg.
4. **Ordrelisten (`/ordre`):**
   - `listOrders(actor, organizationId, options?: { query?: string | null }): Promise<{ items: OrderListItem[]; total: number }>`. `total` telles med samme WHERE som listen. `ORDER_LIST_LIMIT = 50` står i `src/core/orders`. Sortering `received_at desc, id desc` (indeksen `orders_organization_id_received_at_idx`). Kalleren i `src/app/(ansatt)/ordre/page.tsx` og testene i `src/core/orders/orders.test.ts` følger.
   - Søkefelt med `SearchBox`, etikett/plassholder «Søk på adresse, nummer, megler eller gnr/bnr». Ingen autofokus (tastaturet skal ikke sprette opp på iPad). Lenken «Tøm søk» når det er søkt.
   - Er det flere enn 50: «Viser 50 av N. Bruk søket for å finne flere.» Tom liste med søk: «Ingen ordre passer søket.»
   - Raden viser meglerens ordrenummer (`external_ref`) når det finnes, slik at kontoret ser at det har funnet riktig ordre. Feltet finnes allerede. Utseendet avgjør ui-designer.
   - Kansellert oppdrag: ordren står fortsatt i listen (som i dag), og søk på oppdragsnummer, parter og eiendom finner den også når oppdraget er kansellert. Ellers «mangler» den for kontoret. Slettede parter og slettet matrikkel gir aldri treff. Hvordan «kansellert» vises, er T-0031 (ikke med).
5. **Arbeidskøen:** samme vilkår via `assignmentFieldsMatch` og `orderFieldsMatch` i `workQueueWhere`. Tellingene per fane følger søket som i dag. Arbeidskøen viser aldri kansellerte, som i dag. Plassholderen byttes til samme tekst som i ordrelisten.
6. **T-0029 (lite, arbeidskø):**
   - (a) Er fanen tom og andre faner har treff: «Ingen treff i denne fanen. Treff i: Ferdig (1).» Lenkene lages med `queueHref` og tar med `q` og `mine`. Hver lenke er minst 44 pt høy (`min-h-11`), som fanene.
   - (b) Standardvalg Mine/Alle: `parseWorkQueueParams(params, { defaultMineOnly: boolean })` (fortsatt ren funksjon uten roller). `defaultMineOnly(roles)` i `src/core/assignments` er sann når den ansatte har takstmann-rollen. Rollene kommer fra tilgangssjekken (`grant`), aldri fra adressen. Takstmann + leder gir «Mine». Kontor, leder og admin uten takstmann-rolle får «Alle». Standarden gjelder bare når `mine` mangler; `mine=0` og `mine=1` overstyrer alltid. Tellingene per fane følger samme valg.
   - `queueHref` og det skjulte feltet i søkeskjemaet (`queue-toolbar.tsx`) skriver **alltid** `mine=1` eller `mine=0`, slik at kontoret ikke mister «Mine» når det søker eller bytter fane.
   - Den eksisterende testen «mine mangler gir Mine» i `work-queue-params.test.ts` endres, den slettes ikke.
7. **Nattløkkens punkt 3 (fokusringen):** regelen `[tabindex="-1"]:focus { outline: none }` i `src/app/globals.css` avgrenses til `#hovedinnhold`. Kortet i arbeidskøen får synlig fjord-ring når siden hopper tilbake til det etter lagret notat. Da får også `form-parts.tsx` (l. 50), `claim-form.tsx` (l. 255), `contact-picker.tsx` (l. 104) og `remove-merge-actions.tsx` (l. 84) ring når de får fokus fra kode. Prosjektleder avgjør: det er ønsket (tastaturbrukeren skal se hvor fokus er; WCAG 2.4.7). Ux ser over de fire stedene under byggingen.
8. **Nattløkkens punkt 5 (indeks for `ILIKE '%tekst%'`): ADR 0010 «Søk uten egne søkeindekser foreløpig».** Beslutning: beholde `ILIKE`, ingen pg_trgm nå. ADR-en har med:
   - begrunnelse: ca. 2000 ordre i året (20 000 på ti år) er lite for PostgreSQL; spørringen er alltid avgrenset på organisasjon med indeks; undertabellene har allerede indeks på (organization_id, fremmednøkkel);
   - at `ILIKE '%tekst%'` mot `orders` og undertabellene ikke kan bruke vanlig indeks, at OR mellom flere `EXISTS` kjøres per rad, og at tellingen leser alle organisasjonens rader uansett grensen på 50;
   - forkastet: pg_trgm med GIN, fulltekst med tsvector, egen søkekolonne. pg_trgm krever tillatelse i `azure.extensions` (drift, Ståle) pluss en migrering;
   - når vi bytter: når testlaget eller de ansatte melder at søket er tregt (rettesnor: over 200 ms), eller senest ved «Søk og arkiv».
   Ført som «lett å endre».
9. **Nattløkkens punkt 6 (sidegrense):** ordrelisten får grensen i punkt 4. `listAgreements` og sertifiseringslistene er ikke med (små lister, egen oppgave ved behov).
10. Versjon: neste ledige patch etter main ved merge (branchen står på 0.10.7). Beslutninger føres i `docs/09-apne-sporsmal.md` («Avgjort av agentene …») fra **A256** (main bruker A249–A255; se «Fortsettelse» punkt 2). Ordlisten (avsnitt 8): «Matrikkelsøk» = `parseCadastralQuery` og «Grense i ordrelisten» = `ORDER_LIST_LIMIT`. Nattløkkens punkt 3, 5 og 6 merkes ryddet i tilstandsfilen.

**Ikke med (bevisst utelatt):**
- Rette en ordre etter lagring (T1) og T-0031 («kansellert» i ordrelisten). Det gjøres på branchen `rette-ordre-etter-lagring`. Ikke rør `updateOrder`, ordresiden eller ordreskjemaet. T1 rører også `ordre/page.tsx` og `orders.test.ts`: main flettes inn og konflikter løses før merge.
- Ny kolonne `fnr` på `orders`, nye indekser, migreringer, pg_trgm og søk som tåler skrivefeil.
- Ny måling med `EXPLAIN ANALYZE` på 20 000 oppdiktede ordre i nattløkken (krever ny testdatagenerator og ny fast jobb; ikke nødvendig for akseptkriteriene).
- Globalt søk, søk i kontakter/firma utover den felles hjelperen, lagrede filtre, eksport («Søk og arkiv», senere fase).
- Søk på e-post og telefon til parter (personopplysninger som ikke trengs for å finne oppdraget).
- Bla-sider («neste side») i ordrelisten. Søket er veien til eldre ordre.
- Sidegrense på `listAgreements` og sertifiseringslistene.
- Varsel om dublett (T3), flere rom (T4).
- T-0009, T-0027 (oppdragssiden) og T-0030 (kontakter): andre områder.
- KI i søket. Ingen ny avhengighet.

## Tilgang
| Rolle | Se og søke | Standard i arbeidskøen | Endre |
|---|---|---|---|
| takstmann | ja (`organization.read`) | Mine | ingen endring |
| kontor | ja | Alle | ingen endring |
| leder | ja | Alle (Mine hvis også takstmann) | ingen endring |
| admin | ja | Alle (Mine hvis også takstmann) | ingen endring |

All filtrering på `grant.organizationId`. Søket gir aldri treff fra en annen organisasjon, heller ikke via parter, eiendom eller matrikkel med samme tekst. Admin stenges ikke ute.

## Data
Ingen nye tabeller, felt, indekser eller migreringer. Ingen nye faste koder.

## Skjermer
- **Ordrelisten (PC og iPad):** søkefelt øverst under overskriften, «Søk»-knapp, «Tøm søk» etter søk. Raden viser ordrenummeret når det finnes. Hovedhandling: finne og åpne ordren.
- **Arbeidskøen:** samme søkefelt og tekst som ordrelisten. Tom fane med treff andre steder viser lenker til fanene (1 trykk).

## Regler
Ingen fagregler. Søkeregelen (felter og matrikkelformat) testes med enhetstester.

## Akseptkriterier
- [ ] `likePattern`: trimmer, kutter ved 100 tegn, escaper `%`, `_` og `\`; tom tekst gir intet filter. Kontaktsøkets tester er fortsatt grønne (enhetstest).
- [ ] `parseCadastralQuery`: «12/34», «12 / 34», «12/34/0/5» tolkes; «12/», «abc» gir `null` (enhetstest).
- [ ] Ordrelisten finner på adresse (ordre og eiendom), oppdragsnummer, ordrenummer, oppdragsgiver, partsnavn, partens firma og matrikkel fra ordren og fra `cadastral_units`. Store og små bokstaver gir samme treff. Ingen doble rader når to parter treffer (test per felt).
- [ ] «12/34» finner 12/34 og 12/34/0/5, men ikke 112/34 eller 12/345 (test).
- [ ] Arbeidskøen finner på de samme feltene, og tellingene per fane og «treff i andre faner» stemmer med søket (test).
- [ ] `%`, `_` og `\` gir ikke treff på alt. E-post og telefon gir ikke treff (test).
- [ ] Slettet part, slettet matrikkel, slettet eiendom og slettet ordre gir ikke treff. Ordre med kansellert oppdrag finnes i ordrelisten, ikke i arbeidskøen (test).
- [ ] Tenant-isolasjon: `expectTenantIsolation` for `listOrders` med søk og for arbeidskøen med søk, der `seed` legger **samme tekst i A og B** i hvert søkefelt (adresse, ordrenummer, partsnavn, firma, matrikkel, `ordered_by_text`). Egen test der en part, eiendom eller matrikkel i B peker på et oppdrag i A uten å gi treff i A. Ansatt i annen organisasjon får `AccessDeniedError`.
- [ ] Takstmann, kontor, leder og admin kan alle søke. Standardvalget per rolle (takstmann, kontor, leder, admin, takstmann + leder) er testet, og `mine=0`/`mine=1` overstyrer (test).
- [ ] Ordrelisten viser høyst 50 rader, nyeste først, `total` stemmer, og meldingen «Viser 50 av N …» vises når det er flere (test).
- [ ] Søket lager ingen nye rader i `audit_log`, hendelsene eller `ai_usage_log`. Én test som kjører både et søk i ordrelisten og et søk i arbeidskøen. At `q` ikke logges i koden, sjekkes ved kodegjennomgang (grep etter `console`, `logger` og hendelser med `q`/`query`).
- [ ] Databasefeil på `/ordre` og `/arbeidskoe` (ikke `AccessDeniedError`) fanges på siden, logges med `logger` med bare `route`, `userId` og `errorName`, og den ansatte ser en vanlig feilmelding. Én test viser at loggen ikke inneholder søketeksten (fortsettelse punkt 3d).
- [ ] `selectOrder` er ikke lenger en åpen eksport som tar `organizationId`: den tar `grant` fra `requireOrganizationAccess`, eller ligger i en intern fil og eksporteres ikke fra `src/core/orders/index.ts`. Testen viser det, og at `getOrder` og `updateOrder` fortsatt gir `AccessDeniedError` for en ansatt i en annen organisasjon (fortsettelse punkt 3a).
- [ ] Kontakt- og firmanavn i ordrehistorikken hentes med en ny funksjon i `src/core/contacts`, filtrert på `grant.organizationId` og `deleted_at is null`. `history.ts` importerer ikke lenger `contacts` eller `firms` fra `@/db/schema`. Testfilen til funksjonen har `expectTenantIsolation`: kontakter og firma med samme navn i B vises ikke i As historikk. Slettet kontakt eller firma vises som `REMOVED_CONTACT_LABEL` eller `REMOVED_FIRM_LABEL`, som før (fortsettelse punkt 3b).
- [ ] Etter at main er flettet inn står alle T1-testene fra PR #184 (`updateOrder`, `history.ts`, e2e for å rette en ordre) igjen og er grønne. Ingen er slettet eller hoppet over. `orders.test.ts` har både T1-testene og `listOrders` med grense og total. Ubrukte eksporter fjernet fra `index.ts`, sjekket med `pnpm typecheck` og `pnpm lint`.
- [ ] `docs/09-apne-sporsmal.md` har én linje om at søketeksten blir liggende i nettleserhistorikken på delte iPader, og at det vurderes sammen med sperring av mistet iPad (fase 2b / «Minimum før ekte data»).
- [ ] E2e (én felles spesifikasjon på iPad-størrelse og PC): søk i ordrelisten og åpne ordren; «Ingen ordre passer søket.»; søk i arbeidskøen; tom fane viser «Treff i: …» med lenke som virker; kontoret starter på «Alle», velger «Mine», søker og bytter fane, og «Mine» står fortsatt.
- [ ] Fokusringen: i den eksisterende e2e-testen for arbeidskøen har kortet synlig ring etter lagret notat (beregnet `outline`), og `#hovedinnhold` har fortsatt ingen ring etter hopplenken.
- [ ] T-0029 settes til «rettet» med PR-nummeret.
- [ ] ADR 0010 finnes, og nattløkkens punkt 3, 5 og 6 er merket ryddet i tilstandsfilen.
- [ ] `pnpm lint`, `typecheck`, `test` og `test:e2e` grønne. Versjonen er økt.

## Avgjort ved uenighet (prosjektleder)
- **Måling i nattløkken (forenkler mot test-leder):** ingen ny `EXPLAIN ANALYZE`-linje på 20 000 ordre nå. Den krever ny testdatagenerator og ny fast jobb, og ingen akseptkriterier trenger den. ADR 0010 har en tydelig regel for når vi bytter (melding om tregt søk, rettesnor 200 ms, senest ved «Søk og arkiv»). Det enkleste som virker.
- **Ordlisten (forenkler mot arkitekt):** bare de to navnene som svarer til ord de ansatte bruker («matrikkelsøk», «grense i ordrelisten»). `likePattern` og `SEARCH_QUERY_MAX_LENGTH` er rene tekniske hjelpere og tas ikke med.
- **Loggtest:** én test for alle tre loggene (forenkler og test-leder er enige). Søket bare leser.
- **E2e:** én felles spesifikasjon for begge listene; fokusringen i den eksisterende arbeidskø-testen. E2e-tiden er allerede et problem (nattløkkens punkt 14). Ingen egen test med over 50 ordre i e2e; grensen dekkes av integrasjonstesten.
- **Kansellert oppdrag i ordrelisten:** finnes ved søk (arkitektens forslag), fordi ordren står i listen uansett og kontoret ellers tror den mangler.
- **Fokusring på fire andre elementer:** ønsket, se omfang punkt 7.
- **HTTP-loggen i Azure (sikkerhet-personvern foreslo å slå den av eller føre den i planen):** føres under «Minimum før ekte data», ikke slått av i T2. Dataene i testmiljøet er oppdiktet, loggen er nyttig ved feilsøking i testmiljøet, og en endring i infra må rulles ut av Ståle. Det samme gjelder `/kontakter`, `/firma` og dagens arbeidskø, så det hører hjemme i en samlet sjekk før ekte data. Lett å endre (A263).
- **Feilfangst på listesidene:** tas med i T2 (liten, to sider, samme mønster som `kontakter/actions.ts`). Søket legger fritekst med navn inn i spørringen, så det hører til denne oppgaven.
- **Test-leder krevde akseptkriterier for småfunnene og flettingen:** godtatt i sin helhet. `selectOrder` og navneoppslaget gjelder tilgang og tenant-isolasjon og regnes som alvorlige; PR-en merges ikke uten dem.

## Åpne spørsmål
- Ingen som stopper. Beslutningene (ADR 0010, grense 50, «Alle» som standard uten takstmann-rolle, matrikkel per del, kansellert finnes ved søk, ingen søk på e-post/telefon) føres som «lett å endre» i `docs/09-apne-sporsmal.md` som A256–A262, og HTTP-loggen som A263.

## Roller
arkitekt (ADR 0010, `search.ts`, spørringen), ux (søkefelt, tom fane, fokusring), sikkerhet-personvern (tenant-isolasjon i undertabellene, søketekst i adressen og loggene), utvikler og testskriver i parallell. KI-rollen sjekker bare at søketeksten ikke går til KI.

Bitene som kan bygges hver for seg:
- A: `like-pattern.ts` + `src/core/assignments/search.ts` (med `parseCadastralQuery`) + `listOrders` med grense og total + ordrelisten.
- B: arbeidskøen bruker `search.ts` + T-0029 (a og b, `queueHref`, søkeskjemaet).
- C: fokusringen + ADR 0010 + tilstandsfilen.
B bygger på `search.ts` fra A; lag den først (grensesnittet over er fast), så kan A og B gå parallelt.

## Fortsettelse 13.11.2026 kl. 07 UTC (prosjektleder)
Branchen ble bygget fra main før PR #184 (T1) var merget, og står uten PR (siste commit 05:36 UTC). Denne kjøringen overtar den. Gjenstår:
1. **Flett inn main** (PR #184 og #185). Konflikter ventes i `src/core/orders/orders.ts`, `orders.test.ts`, `src/core/orders/index.ts`, `src/app/(ansatt)/ordre/page.tsx`, `ordre/actions.ts`, `ordre/[id]/page.tsx`, `package.json`, `docs/09-apne-sporsmal.md` og tilstandsfilen. Alt fra T1 (`updateOrder`, `history.ts`, skjemaet for endring, e2e for rette ordre) skal stå igjen etter flettingen.
2. **A-numrene flyttes:** main bruker A249–A255 (T1). Branchens A254–A260 blir **A256–A262**, også i ADR 0010, oppgavekortet og testplanen.
3. **Småfunn fra PR #184 i samme område (tas med nå):**
   - `selectOrder` skal ikke være en åpen eksport uten tilgangssjekk. Den tar `grant` (fra `requireOrganizationAccess`) i stedet for `organizationId`, eller flyttes til en intern fil som bare `getOrder` og `updateOrder` bruker.
   - `listOrderHistory` henter kontakt- og firmanavn gjennom en funksjon i `src/core/contacts` (filtrert på organisasjon og `deleted_at is null`), ikke med egne spørringer mot `contacts`/`firms` i `src/core/orders`. Test for tenant-isolasjon følger med.
   - Ubrukte eksporter i `src/core/orders/index.ts` fjernes.
   - **(d, fra sikkerhet-personvern)** `/ordre` og `/arbeidskoe` fanger feil fra `listOrders`/`listWorkQueue` som ikke er `AccessDeniedError`, logger bare `route`, `userId` og `errorName` med `logger` (som i `kontakter/actions.ts`) og viser en vanlig feilmelding («Kunne ikke hente listen. Prøv igjen.»). Ellers kan Drizzle-feilen skrive `%søketekst%` rått til applikasjonsloggen.
   - **(e, fra sikkerhet-personvern)** HTTP-loggen i Azure (`infra/azure/main.bicep`, `httpLogs.fileSystem`) skriver hele adressen med `?q=`. Infra endres ikke i T2. Det føres som eget punkt under «Minimum før ekte data» i planen (én linje i `docs/plan/endringslogg.md`), og ADR 0010 punkt 7 og dette kortet rettes til: «søketeksten skrives ikke i applikasjonsloggen; HTTP-loggen i testmiljøet har adressen i 3 dager og slås av før ekte data». Beslutningen føres som A263 («lett å endre»).
   - **(f)** Én linje i `docs/09-apne-sporsmal.md`: søketeksten i nettleserhistorikken på delte iPader godtas nå og vurderes sammen med sperring av mistet iPad.
   - Resten av småfunnene fra #184 (firmalinjen i «Endringer», `valueText`, `readFields`/`readValues`, TypeError som «uten nett») tas med neste oppgave i ordreskjemaet.
4. Versjon: neste patch etter main (main står på 0.10.9 eller høyere ved fletting).
5. `pnpm lint`, `typecheck`, `test`, `test:e2e` grønne, så PR mot `main` og merge med skriptet.

Roller for resten: utvikler (fletting, småfunn a–f) og testskriver i parallell (tester for `selectOrder`, navneoppslaget, feilfangsten på listesidene, loggtesten med begge listene, og at T1-testene står), sikkerhet-personvern i gjennomgangen (tilgang i undertabeller, `q` logges ikke). Arkitekt og ux har alt sagt sitt; trengs ikke på nytt. KI-ansvarlig: bare sjekk at søketeksten ikke går til KI.
