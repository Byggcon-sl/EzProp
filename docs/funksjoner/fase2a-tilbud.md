# Funksjon: Tilbud i stedet for ordre

- **Fase:** 2a (prioritert av Ståle 13.11.2026: «rett på oppdrag, tilbud ved behov»)
- **Modul:** kjerne (`src/core/orders`, `src/core/assignments`), skjermene under `src/app/(ansatt)/`
- **Status:** utkast
- **Branch:** `tilbud-i-stedet-for-ordre` (bygger på main, der «Nytt oppdrag», PR #209 og ADR 0011, er merget)
- **Støtter hovedmål:**
  - **De ansatte:** menyen viser det kontoret gjør 98–99 av 100 ganger (Nytt oppdrag, Arbeidskø). Tilbud ligger lenger ned, og et tilbud blir oppdrag med ett trykk uten avskrift.
  - **KI i bunnen:** tilbudet har de samme strukturerte bestillingsfeltene som oppdraget, med kilde (`source`) og en tydelig status. Kroken «e-post blir oppdragsforslag eller tilbud» (planpunktet «KI: e-post blir oppdragsforslag») kan da lage et tilbudsutkast uten ny datamodell.
  - **Færre reklamasjoner:** alt fylles inn fra tilbudet, så adresse, matrikkel og bestiller skrives ikke inn på nytt (færre skrivefeil). Åpne tilbud er fortsatt med i dublettvarselet.

## Problem

Ståle 13.11.2026: «Det er svært sjelden vi oppretter ordre, men stort sett går vi rett på oppdrag. [...] Tilbud vil fungere som ett tilbud/lead, som deretter kan konverteres til oppdrag. Men det trenger ikke være "fremst" i løsningen.» I dag heter dette «Ordre», står høyt i menyen og har ingen utløpsdato. Kontoret får et begrep og et menypunkt de nesten aldri bruker, og en mulig jobb som aldri ble noe, blir stående som «Mottatt» for alltid.

## KI i bunnen

- **Ingen KI-kall i denne oppgaven.** Det er ingenting å foreslå her ennå: tilbudet lages for hånd, og «Gjør om til oppdrag» kopierer feltene uten å gjette.
- **Data som lagres for KI senere:** de samme bestillingsfeltene som oppdraget (ADR 0011), `source` (`manual` nå, `email` når KI lager utkast fra e-post), status, `valid_until` og avslagsgrunn. Statusendringene logges som hendelser (`order.converted`, `order.rejected`), slik at KI og statistikk senere kan se hvor mange tilbud som blir oppdrag.
- **Vern:** avslagsgrunnen og bestillingsfeltene er fritekst og står allerede i `NEVER_FIELDS` / sperren mot elleve sifre (A299). Ingen nye fritekstfelt. Alt KI senere gjør her, går gjennom `src/core/ai`.

## Brukerhistorier

- Som **kontor** vil jeg **gå rett på «Nytt oppdrag»** og bare sjelden lage et tilbud, slik at menyen ikke viser noe jeg nesten aldri bruker øverst.
- Som **kontor** vil jeg **gjøre et tilbud om til oppdrag med ett trykk**, slik at jeg slipper å skrive adresse, matrikkel og bestiller på nytt.
- Som **kontor** vil jeg **avslå et tilbud med grunn**, slik at vi ser hvorfor jobben ikke ble noe.
- Som **leder** vil jeg **se at gamle tilbud er utløpt**, slik at listen over åpne tilbud bare viser det som fortsatt kan bli jobb.
- Som **takstmann** vil jeg **ikke se tilbud i arbeidskøen**, fordi de ikke er arbeid ennå.

## Omfang

**Med:**

1. **ADR 0012 «Tilbud»** (arkitekt): navn og datamodell. Retning fra prosjektlederen (A318–A324, lett å endre unntatt A319/A320):
   - Tabellen `orders`, modulen `src/core/orders`, hendelses- og revisjonskodene (`order.created`, `order.rejected`, `order.converted`, `entityType: "order"`) og statuskodene **beholdes**. «Tilbud» er navnet i grensesnittet. Koden `received` betyr fortsatt «ikke behandlet ennå» og vises som «Åpent»; `rejected` vises som «Avslått». Ingen kode får ny betydning, så ingen arkivering trengs (regel 6). Ordlisten i `docs/05-domenemodell.md` avsnitt 8 får `order` = tilbud (grensesnitt).
   - **Ny kolonne `valid_until`** (dato, påkrevd etter migreringen). Nye tilbud får i dag + 30 dager som forslag i skjemaet; kan endres.
   - **«Utløpt» lagres ikke som status.** Et tilbud er utløpt når status er `received` og `valid_until` er før dagens dato (norsk tid). Regelen står ett sted i kjernen (ren funksjon + SQL-uttrykk med paritetstest). Ingen bakgrunnsjobb, og et tilbud som får ny dato er åpent igjen. Arkitekten kan velge lagret status `expired` i ADR-en hvis det gir en klart bedre løsning; da må CHECK-regelen utvides og en jobb finnes.
2. **Migrering 0035** som tåler ekte data: legger til `valid_until`; eksisterende rader får `received_at` (norsk dato) + 30 dager; så `NOT NULL`. Ingen rader slettes eller får ny status, `row_version` og `updated_at` røres ikke. Prøves mot en database med åpne, avviste, gjort-om og mykt slettede ordre.
3. **Skjermene omdøpt:** `/ordre` → `/tilbud`, `/ordre/ny` → `/tilbud/ny`, `/ordre/[id]` → `/tilbud/[id]`. Gamle adresser sender varig videre (308) til de nye, så bokmerker og lenker virker. All tekst på skjermene, feilmeldinger, historikk og hendelsestekster sier «tilbud», «Åpent», «Avslått», «Utløpt», «Gjort om til oppdrag». Lenker fra oppdraget, søket og dublettvarselet peker til `/tilbud/...`.
4. **Menyen:** «Tilbud» flyttes under «Kontakter» og «Firma» (rett over «Statistikk»). «Nytt tilbud» er en knapp på tilbudslisten, ikke i menyen.
5. **Tilbudslisten:** standardvisning «Åpne» (åpne, ikke utløpt). Filter for «Utløpt», «Avslått», «Gjort om til oppdrag» og «Alle». Gyldig til-dato vises i listen. Søket fra T2 virker som før.
6. **«Gjør om til oppdrag» med ett trykk** på tilbudssiden (også når tilbudet er utløpt): kontoret er forhåndsvalgt (den ansattes kontor, A295). Har den ansatte et kontor, er det bare én knapp; kontorvalget vises bare når det ikke finnes et forhåndsvalg. Etter lagring sendes brukeren rett til det nye oppdraget. `convertOrderToAssignment` kopierer feltene som før (ADR 0011 punkt 3).
7. **Avslå med grunn:** som `rejectOrder` i dag (påkrevd grunn), knappen heter «Avslå tilbud». Kan gjøres på åpent og utløpt tilbud.
8. **Endre gyldig til-dato** på åpent eller utløpt tilbud (ny feltkode `valid_until` i listen over felt som kan endres på tilbudet, med historikk som de andre feltene). Feltet er bare på tilbudet, ikke i felleslisten for oppdraget.
9. **Tilbud teller ikke i arbeidskøen:** arbeidskøen leser bare `assignments` i dag; en test låser det (et åpent tilbud gir verken rad eller telling).
10. **Små funn i samme område** (tas med fordi skjermene uansett skrives om): T-0031 (listen viser ikke at oppdraget er kansellert), T-0075 (teksten om bestiller på oppdraget stemmer ikke) og T-0089-delen som gjelder «Lagret.» på endre-skjemaet for ordre. Settes til «rettet» med PR-nummer.
11. **Testdataene** (`pnpm db:seed:testdata`): et par oppdiktede tilbud med ulik status, også ett utløpt.
12. **Docs:** ADR 0012, `docs/05-domenemodell.md` 4.3 og ordlisten, `docs/02-roller-og-tilgang.md` hvis teksten nevner ordre, planen og tilstandsfilen.

**Ikke med (bevisst utelatt):**

- Pris, prisliste, tilbuds-PDF og sending til kunde (planpunktet «Tilbud med pris», fase 3b). `valid_until` lages nå og brukes der.
- Faste koder for avslagsgrunn (pris, tid, valgte annen …). Grunnen er fritekst som i dag. Forslag i `docs/09-apne-sporsmal.md`.
- Omdøping av tabellen, modulen, kolonner eller hendelseskoder i koden (dyrt og risikabelt mot ekte data, ingen gevinst for de ansatte).
- Bakgrunnsjobb eller varsel når et tilbud går ut på dato.
- KI som lager tilbud fra e-post (eget planpunkt).
- Bestillingsskjema for meglere (fase 3b).
- Lenke «Lag tilbud i stedet» fra «Nytt oppdrag»-skjemaet (kan foreslås av ux, bygges ikke uten at det står i planen).

## Tilgang

Som for ordre i dag; ingen nye rettigheter.

| Rolle | Se | Endre (lage, endre, gjøre om, avslå) |
|---|---|---|
| takstmann | ja (alle i organisasjonen) | ja (`assignment.edit`) |
| kontor | ja | ja (`assignment.edit`) |
| leder | ja | ja |
| admin | ja | ja (stenges aldri ute) |

Alle spørringer filtrerer på `grant.organizationId`. Annen organisasjon får verken liste, side, endring, omgjøring eller avslag (`expectTenantIsolation`). Gammel adresse `/ordre/<id>` for et tilbud i en annen organisasjon gir samme «ikke funnet» som i dag.

## Data

- `orders.valid_until` (date, not null etter migrering 0035). Ingen ny tabell; `tests/tenant-tables.ts` er uendret.
- Statuskoder uendret: `received`, `converted`, `rejected`. «Utløpt» er avledet (A320).
- Ny feltkode `valid_until` i listen over felt som kan endres på tilbudet (bare der).
- `docs/05-domenemodell.md` 4.3: `orders` = tilbud, `valid_until`, utløpsregelen.

## Skjermer

PC og iPad (samme skjermer).

- **Meny:** «Tilbud» nederst blant arbeidspunktene. Før: «Ordre» som punkt 3. Etter: punkt 5.
- **Tilbudslisten** (`/tilbud`): hovedhandling «Nytt tilbud». Standard «Åpne».
- **Nytt tilbud** (`/tilbud/ny`): samme felt som før + «Gyldig til» (forhåndsutfylt).
- **Tilbudet** (`/tilbud/[id]`): hovedhandling «Gjør om til oppdrag». Trykk før: velg kontor + knapp (2). Etter: 1 trykk når kontoret er forhåndsvalgt, og brukeren havner på oppdraget. Sekundært: «Avslå tilbud» (grunn påkrevd), endre felt og gyldig til-dato.

## Regler

Utløpsregelen er ikke en fagregel, men står som ren funksjon med testsaker: åpent og `valid_until` i går → utløpt; i dag → ikke utløpt; avslått eller gjort om → aldri utløpt; dato rundt midnatt i norsk tid (sommer og vinter).

## Akseptkriterier

- [ ] ADR 0012 vedtatt: navn i grensesnitt, koder og tabell beholdt, `valid_until`, utløp avledet.
- [ ] Migrering 0035 kjører mot en database med ekte-lignende ordre (åpne, avviste, gjort om, mykt slettede), og ingen rader mister data eller får ny status.
- [ ] Menyen viser «Tilbud» under «Firma», ikke «Ordre». Ingen synlig tekst sier «ordre» om dette (unntak: «meglerens ordrenummer»).
- [ ] `/ordre`, `/ordre/ny` og `/ordre/<id>` sender videre til `/tilbud/...`.
- [ ] «Gjør om til oppdrag» med forhåndsvalgt kontor er ett trykk, fyller alle bestillingsfeltene på oppdraget og åpner oppdraget.
- [ ] Avslå krever grunn; avslått tilbud kan ikke gjøres om.
- [ ] Åpent tilbud med passert `valid_until` vises som «Utløpt», er ute av standardlisten og kan få ny dato, gjøres om eller avslås.
- [ ] Et åpent tilbud gir verken rad eller telling i arbeidskøen (test).
- [ ] Dublettvarselet virker som før for åpne tilbud.
- [ ] Bruker i annen organisasjon får ikke tilgang til liste, side, endring, omgjøring eller avslag (test med `expectTenantIsolation`).
- [ ] Virker på iPad-størrelse (e2e: lage tilbud, gjøre om med ett trykk, avslå).
- [ ] Ingen KI-forslag her; vernet for fritekstfeltene er uendret (test i `NEVER_FIELDS` står).
- [ ] T-0031, T-0075 og «Lagret.»-delen av T-0089 rettet.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjon økt (minor).

## Åpne spørsmål

Avgjort av prosjektlederen i autonom modus (A318–A324 i `docs/09-apne-sporsmal.md`). Forslag til Ståle: faste koder for avslagsgrunn.
