# ADR 0010 – Søk uten egne søkeindekser foreløpig

Dato: 13.11.2026. Status: vedtatt av agentene i autonom modus (føres i `docs/09-apne-sporsmal.md` fra A254, se oppgavekortet); Ståle kan endre. Oppgavekort: `docs/funksjoner/fase2a-sok-ordre-arbeidsko.md` (T2, Ståle 12.11.2026). Avgjør nattløkkens punkt 5 (indeks for `ILIKE '%tekst%'`) og punkt 6 (sidegrense på ordrelisten) fra 13.11.2026.

Støtter hovedmålene: **de ansatte** (kontoret finner ordren eller oppdraget med ett søk mens megleren er i telefonen, og listen blir ikke treg når den vokser), **færre reklamasjoner** (matrikkel sammenlignes del for del, så kontoret ikke havner på feil oppdrag) og **KI i bunnen** (søket bruker de samme strukturerte feltene som KI skal bruke senere; søketeksten sendes aldri til KI).

## Beslutninger

1. **Søket bruker `ILIKE '%tekst%'` som i dag. Ingen pg_trgm, ingen fulltekst, ingen nye indekser og ingen migrering nå.** Gjelder ordrelisten, arbeidskøen og kontakt- og firmasøket.
2. **Søkevilkåret for ordre og oppdrag står ett sted:** `src/core/assignments/search.ts` (`orderFieldsMatch`, `assignmentFieldsMatch`, `parseCadastralQuery`). Ordrelisten og arbeidskøen bruker de samme funksjonene og finner derfor det samme. Filen ligger i `core/assignments` fordi `core/orders` allerede importerer derfra; ingen import går motsatt vei.
3. **Mønsteret lages ett sted:** `likePattern` i `src/shared/lib/like-pattern.ts` (ren strengfunksjon: trimmer, kutter ved `SEARCH_QUERY_MAX_LENGTH` = 100 tegn, escaper `\`, `%` og `_`). Den erstatter `searchPattern` i kontaktsøket og den lokale hjelperen i arbeidskøen.
4. **Undertabeller hentes bare med `EXISTS`**, aldri med join. Hver `EXISTS` filtrerer selv på `grant.organizationId` og `deleted_at is null` og kobler på id. Det gir ingen doble rader og ingen treff på tvers av organisasjoner, heller ikke når en rad i en annen organisasjon peker på samme id.
5. **Matrikkel er likhet per del, ikke delvis tekst.** Ser søket ut som `gnr/bnr[/fnr[/snr]]`, legges det til en egen gren der delene må være like etter trimming. «12/34» finner 12/34 og 12/34/0/5, men ikke 112/34. Tomt festenummer regnes som 0. Ordren har ikke festenummer, så `fnr` sammenlignes bare mot `cadastral_units`. Ingen ny kolonne.
6. **Ordrelisten får grense:** `ORDER_LIST_LIMIT` = 50 rader, sortert `received_at desc, id desc` (indeksen `orders_organization_id_received_at_idx`). `listOrders` gir `{ items, total }`, og `total` telles med samme WHERE. Ingen «neste side»; søket er veien til eldre ordre. Grensesnittet står i `src/core/orders/list.ts`.
7. **Søketeksten er personopplysninger** (navn, adresse, matrikkel). Den sendes aldri til KI, og skrives ikke i `ai_usage_log`, revisjonsloggen, hendelsene eller serverloggen. Søket bare leser.

## Begrunnelse

- **Mengden er liten.** Byggcon har rundt 2000 ordre i året, altså rundt 20 000 på ti år. Det er lite for PostgreSQL, også når hver rad må leses.
- **Spørringen er alltid avgrenset på organisasjon** med indeks, og undertabellene har allerede indeks på `(organization_id, fremmednøkkel)`: `assignment_parties (organization_id, assignment_id)`, `cadastral_units (organization_id, property_id)`, `orders (organization_id, assignment_id)` og `properties (organization_id, id)`. Hver `EXISTS` er derfor et indeksoppslag per rad.
- **Det enkleste som virker** (regel 1). En søkeindeks koster drift og en migrering, og gir ingenting de ansatte merker med dagens mengde.

## Det vi vet at dette koster

- `ILIKE '%tekst%'` mot `orders`, `assignments`, `properties` og `assignment_parties` kan ikke bruke en vanlig indeks. Databasen leser alle radene i organisasjonen og sammenligner tekst.
- `OR` mellom flere `EXISTS` kjøres per rad: opptil tre oppslag i undertabeller for hver ordre eller hvert oppdrag som ikke allerede har treff.
- Tellingen (`total`, og antall per fane i arbeidskøen) leser alle organisasjonens rader som passer, uansett grensen på 50. Grensen sparer overføring og visning, ikke lesing.
- Uten søk bruker ordrelisten indeksen på `(organization_id, received_at)` og stopper etter 50 rader. Tellingen leser fortsatt alle.
- Tiden er ikke målt på 20 000 rader. Det er bevisst utelatt nå (oppgavekortet, «Avgjort ved uenighet»).

## Når vi bytter

- Når testlaget eller de ansatte melder at søket er tregt. Rettesnor: over 200 ms for søket i databasen.
- Senest når «Søk og arkiv» bygges (globalt søk, søk som tåler skrivefeil).

Første steg da er pg_trgm med GIN-indekser på de tekstfeltene som søkes mest. Søkevilkåret står ett sted (punkt 2 og 3), så byttet rører ikke skjermene.

## Forkastet

- **pg_trgm med GIN-indekser nå:** utvidelsen må tillates i `azure.extensions` på databasen i Azure (drift, Ståle), og vi trenger en migrering og en indeks per søkt kolonne på fire tabeller. Indeksene må holdes ved like ved hver skriving. Ingen merkbar gevinst med dagens mengde.
- **Fulltekst med `tsvector`:** finner hele ord, ikke deler av ord og tall. «Storg» finner da ikke «Storgata», og en del av et oppdragsnummer gir ikke treff. Norsk ordbok og en vedlikeholdt kolonne kommer i tillegg.
- **Egen søkekolonne** (all tekst samlet på ordren eller oppdraget): må holdes lik kildene ved hver endring av part, eiendom og matrikkel. To sannheter, og en ny kilde til feil treff.
- **Matrikkel som delvis tekst:** «12/34» ville også funnet 112/34 og 12/345. Feil oppdrag er verre enn ingen treff.
- **Ny kolonne `fnr` på `orders`:** ordren er bestillingen slik den kom inn; festenummeret står på eiendommen.
- **Bla-sider i ordrelisten:** flere trykk og mer kode enn ett søk. Kan legges til senere uten å endre dataene.
- **Søk på e-post og telefon til parter:** personopplysninger som ikke trengs for å finne oppdraget.
- **Søkebibliotek eller egen søketjeneste:** ny avhengighet og data ut av databasen, uten behov.

## Følger

- Ingen migrering og ingen ny avhengighet.
- `listAgreements` og sertifiseringslistene har fortsatt ingen grense. De er små; egen oppgave ved behov.
- Indeksen `assignment_team_members (organization_id, employee_id)` for «Mine» (nattløkkens punkt 1) er ikke med; den legges til når spørringen trenger det.
- **Lett å endre:** alt i denne ADR-en. Indekser kan legges til, grensen kan flyttes og søkefelt kan legges til uten å endre lagrede data. Ingen faste koder er laget.
