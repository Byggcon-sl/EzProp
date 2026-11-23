# Testplan: Godtatt forslag og avvik henger alltid sammen (rett T-0113, T-0115, T-0116, T-0117)

- **Oppgavekort:** `docs/agenter/oppgaver/rett-forslag-og-avvik.md`
- **Funn:** `docs/agenter/testlag/funn/T-0113-…`, `T-0115-…`, `T-0116-…`, `T-0117-…`
- **Støtter hovedmål:** færre reklamasjoner (TG3 faller aldri stille ut, ett avvik per forslag, hver TG-endring har grunn i loggen), de ansatte («Å se over» viser bare ekte advarsler og kan bli tom, to vinduer gir ikke dobbelt arbeid), KI i bunnen (beslutningsloggen blir sann og brukbar som grunnlag senere; ingen KI-kall her, og KI setter aldri TG).

Testdata er oppdiktet. Alle e2e-tester kjøres i prosjektene `pc` og `ipad`. Test-id-ene har forkortelsen **FA** og står først i testnavnet, slik at rapporten kan krysse dem mot akseptkriteriene.

Merknad til utvikler: funksjonen heter `removeDeviation` i koden (kortet sier `deleteDeviation`). Avvik gjenopprettes bare gjennom `restoreDeviation` (papirkurven i `src/core/buildings/trash.ts` rører ikke avvik). Finnes det likevel en annen vei som gjenoppretter avvik, skal den ha samme test som FA-I8.

## 1. Rene tabelltester (`src/core/reports/logic/`)

### 1a. `effective-decision.test.ts` (ny) – `isEffectiveDecision`
Sakene er data i en tabell (beslutning, `madeDeviation`, `deviationId`, `chosenTg`, `tgDirect`, forventet).
- FA-L1 `accepted` med levende avvik er gjeldende.
- FA-L2 `accepted` og `changed` med `madeDeviation: true` og `deviationId: null` (mykt slettet) er ikke gjeldende.
- FA-L3 `rejected` er alltid gjeldende (med og uten `tgDirect`).
- FA-L4 `accepted` uten avvik med `chosenTg` 0, 1 og IU er gjeldende bare når `tgDirect` er lik; `tgDirect` `null` eller annen verdi gir ikke gjeldende.
- FA-L5 siste rad vinner: hjelperen som velger siste rad per regel og punkt gir `accepted → changed → accepted` = siste `accepted`; eldre rader vurderes aldri, heller ikke når den siste ikke er gjeldende (eldre gjeldende rad «gjenoppstår» ikke).
- FA-L6 ren funksjon: ingen import fra `@/db`, `@/core/ai` eller nettleser-API (statisk sjekk), slik at den kan kjøre på iPaden.

### 1b. Regel for `accepted` mot `changed` (ny fil i `logic/`, tabelltest)
- FA-L7 samme utfall og fast TG lik utfallets → `accepted`, ingen grunn.
- FA-L8 utfallet «velg TG2 eller TG3» med TG2, TG3 og tom TG → `accepted`.
- FA-L9 samme utfall, annen TG (TG3 → TG2, TG3 → TG1, TG3 → tom) → `changed`, grunn kreves.
- FA-L10 annet utfall enn forslagets (også med samme TG) → `changed`.
- FA-L11 `changed` kjøres gjennom `checkOverrideReason`: uten kode → `override_reason`; «Annet» uten tekst → feil; kode som tillater tom tekst → godtatt. Bare koder fra A380.

### 1c. `warnings.test.ts` (utvid)
- FA-L12 `suggestion_no_longer_applies` kommer ikke når avviket fra beslutningen er slettet (T-0115).
- FA-L13 godtatt TG0 uten avvik, regelen slår ikke lenger til, `tgDirect` fortsatt 0 → advarsel med teksten «Forslaget gjelder ikke lenger. Punktet har fortsatt TG0 fra forslaget. Sjekk at graden stemmer.»; samme for TGIU («TGIU»). Er `tgDirect` endret → ingen advarsel.
- FA-L14 utfallsforslag med levende avvik og regelen slår ikke til → teksten som i dag (uendret, sjekk eksakt tekst).
- FA-L15 «Å se over» blir tom: punkt der alt er løst gir tom liste.
- FA-L16 `open_suggestion_on_done_checkpoint`: ferdig punkt, åpent TG3-forslag → advarsel med «Punktet er ferdig, men forslaget om TG3 er ikke avgjort.»
- FA-L17 samme når punktet har et annet avvik med TG1 og med TG2 (TG fra før stopper ikke advarselen).
- FA-L18 åpent forslag på punkt som ikke er ferdig → ingen advarsel.
- FA-L19 åpent TGIU-forslag på ferdig punkt → bare `tgiu_suggested_not_set`, aldri `open_suggestion_on_done_checkpoint` (ingen dobbel advarsel).
- FA-L20 åpent TG0-forslag på ferdig punkt → advarsel med TG0.
- FA-L21 forslag med gjeldende beslutning (godtatt, endret, avvist) → ingen advarsel.
- FA-L22 ingen av advarslene er sperre (feltet for sperre er usant; publiseringssjekken teller dem ikke).
- FA-L23 sortering i «Å se over»: TG3-forslag står foran TG2 og TG0.

### 1d. `codes.test.ts`, `labels.test.ts`, `warning-fix.test.ts` (utvid)
- FA-L24 `open_suggestion_on_done_checkpoint` står **sist** i `CHECKPOINT_WARNING_CODES`; rekkefølgen av de gamle kodene er uendret (fast kode, regel 6).
- FA-L25 koden har norsk tekst i `labels.ts`, uten gjetteord («antas», «trolig») og uten `{`.
- FA-L26 handlingen i `warning-fix.ts` er `scroll_to_suggestion`.
- FA-L27 meldingstekstene (tabellen «Faste tekster» i kortet) sjekkes eksakt: «Avviket er fjernet. Forslaget om TG3 er åpent igjen.», «Forslaget er åpent igjen.» (velg TG2 eller TG3), «Godtatt i et annet vindu kl. 10.42: TG3», «Endret i et annet vindu kl. 10.42: TG2», «Avvist i et annet vindu kl. 10.42», «Forslaget er avgjort på nytt etter at avviket ble fjernet. Avviket hentes ikke tilbake.», «Velg en grunn for å endre TG fra forslaget.» Klokkeslettet er norsk tid (Europe/Oslo), også over sommertid/vintertid.

### 1e. Klientlagring (`field-save-store.test.ts` / `room-model.test.ts`, utvid)
- FA-L28 svaret `already_decided` regnes som ferdig: ingen ny runde, ingen «Ikke lagret», kortet får `refresh`.
- FA-L29 svaret `override_reason` for `tg` vises ikke som «Ikke lagret – prøv igjen» i en løkke; TG settes tilbake til lagret verdi.

## 2. Integrasjon mot testdatabasen

Filer: `src/core/reports/suggestions.test.ts`, `deviations.test.ts`, `save-field.test.ts`, `access.test.ts`, `logging.test.ts`, `reports.test.ts` (tenant), og `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/actions.test.ts` for de nye serverhandlingene.

### 2a. T-0117 og A494: fjernet avvik og «Angre»
- FA-I1 godta TG3, `removeDeviation`: svaret har `refresh`; i den forslaget er åpent (`latestDecision: null`), `CheckpointState.decisions` er tom for regelen, og antall rader i `rule_suggestion_decisions` er uendret.
- FA-I2 `restoreDeviation` etterpå: forslaget er godtatt igjen, samme avvik-id og samme beslutningsrad.
- FA-I3 godta, fjern, godta på nytt, `restoreDeviation` på det gamle → `newer_decision`; ett levende avvik, det gamle står slettet, ingen nye rader.
- FA-I4 det samme når forslaget er avvist mellom fjern og gjenopprett → `newer_decision`, ingen avvik.
- FA-I5 det samme når forslaget er endret (`changed`) i mellomtiden → `newer_decision`.
- FA-I6 avvik som ikke kom fra forslag gjenopprettes som før (eksisterende tester grønne).
- FA-I7 gjenopprettet avvik fra forslag der regelen ikke lenger slår til → `suggestion_no_longer_applies` med teksten for avvik.
- FA-I8 alle veier som gjenoppretter avvik (se merknad øverst) gir `newer_decision` i samme tilfelle.

### 2b. T-0116 og A493: ett avvik per forslag
- FA-I9 Godta → Endre, Godta → Avvis, Avvis → Godta, Endre → Godta (med nye beslutnings-id-er): andre kall gir `already_decided` med riktig `decision`, `chosenTg`, `decidedAt` (ISO) og `refresh`; høyst ett levende avvik og én ny rad.
- FA-I10 det samme for TG0- og TGIU-forslag (`tgDirect` endres ikke av det andre kallet).
- FA-I11 samme beslutnings-id to ganger → samme `saved`-svar, ingen ny rad (som i dag, B4.31).
- FA-I12 regelen slår ikke til → `no_longer_applies` kommer før `already_decided` (rekkefølgen b før c).
- FA-I13 **to samtidige kall** (Godta og Endre) på to egne tilkoblinger fra en egen `pg`-pool, startet med `Promise.all` og en sperre som sikrer at begge er i gang: nøyaktig ett levende avvik, én beslutningsrad, det ene svaret `saved`, det andre `already_decided`. Kjøres 10 ganger i løkke for å fange tilfeldig rekkefølge. Grønn med dagens lås i `withRoomWrite`.
- FA-I14 `alreadyAccepted` finnes ikke lenger i `src/core/reports/` (statisk).
- FA-I15 A493-følgen: godtatt forslag, regelen gir senere et annet forslag, avviket beholdes → nytt forslag gir `already_decided`; etter «Fjern avviket» kan det nye forslaget godtas. Fortsatt ett avvik per regel og punkt.

### 2c. T-0113 og A490: TG-bytte med grunn
- FA-I16 `saveField` med `tg` på avvik fra godtatt forslag → `override_reason`; avviket, `checkpoint_results`, beslutningstabellen og revisjonsloggen er uendret (sammenlign rader og `updated_at`).
- FA-I17 `saveField` med `tg` på avvik uten forslag → lagres uten grunn som før.
- FA-I18 `saveField` med andre felt enn `tg` på avvik fra forslag (tekst, kostnad) lagres som før uten grunn og uten ny beslutningsrad.
- FA-I19 `changeSuggestedDeviationTg` uten grunn (TG3 → TG2) → `override_reason`; verken avvik eller rad lagret.
- FA-I20 med grunn → `saved`; ny rad `changed`, samme `deviation_id`, `chosen_outcome_key` = avvikets utfall, og `suggestion`, `reasons`, `lifespan_set_key`, `threshold_set_key`, `inspection_year` er like den erstattede raden (reglene kjøres ikke på nytt, også når regelen ikke lenger slår til). Avvik og rad er lagret i samme transaksjon: tving feil etter avviksoppdateringen (spion) → ingen av delene lagret.
- FA-I21 bytte tilbake TG2 → TG3 uten grunn → ny rad `accepted`.
- FA-I22 «velg TG2 eller TG3»: bytte mellom TG2, TG3 og tom gir `accepted` uten grunn.
- FA-I23 samme `id` to ganger → samme svar, ingen ny rad.
- FA-I24 `base` ulik lagret TG → `conflict` med `current`, ingenting lagret.
- FA-I25 ugyldig input (ikke-UUID, ukjent grunnkode, TG utenfor lov) → valideringsfeil med norsk melding, ingenting lagret.
- FA-I26 fag: byggeår 1995, sjikt «Folie», årstall tomt: godta TG3, bytt til TG2 uten grunn → `override_reason`; med grunn → rad `changed` med forslag TG3 og valgt TG2. Rommets visning: «Forslag TG3, endret til TG2: <grunnens norske tekst>», aldri friteksten.
- FA-I27 TG3 → TG2 gir `texts_written_for_other_tg`; TG2 → TG3 gir `tg3_missing_cost`. «Endre» til TG2 gir ikke tiltakstekst for TG3 (avvikets tiltak er bør-tekst).

### 2d. A495 og A492: TG direkte og åpne forslag
- FA-I28 (a) hulltaking nektet, godta TGIU, sett TG2 med `setTgDirect`/`saveField` → TGIU-forslaget åpent, `tgiu_suggested_not_set` på ferdig punkt, ingen «gjelder ikke lenger», ingen ny beslutningsrad.
- FA-I29 (b) godtatt TG0 (tilliggende konstruksjoner), endre TG på punktet → forslaget åpent, `open_suggestion_on_done_checkpoint` når punktet merkes ferdig.
- FA-I30 godtatt TG3 og et annet TG2-avvik på samme punkt, fjern TG3-avviket, merk ferdig → `open_suggestion_on_done_checkpoint`; «Ferdig» sperres ikke.
- FA-I31 T-0115: godta TG3, bytt til «Ikke utført», godta TGIU med «Fjern avvikene med TG og sett TGIU» → ingen `suggestion_no_longer_applies`; når alt er fylt ut er advarselslisten tom.

### 2e. Tilgang (`access.test.ts`, `actions.test.ts`)
- FA-I32 tilgangsmatrisen for `changeSuggestedDeviationTg`, `decideSuggestion` (`already_decided`) og `restoreDeviation` (`newer_decision`): takstmann (med `access.inspectors_edit_all` på) og leder får lagre; takstmann med innstillingen av får nei; kontor som i dag (lese, ikke endre); ansatt uten rolle får nei.
- FA-I33 admin uten andre roller bytter TG med grunn når takstmenn er sperret (regel 11).
- FA-I34 reklamasjonssak: bare leder og admin kan bytte TG; takstmann får nei.
- FA-I35 myk slettet ansatt får nei.
- FA-I36 B5.7 står: ingen nye rettigheter i `src/core/access`.
- FA-I37 serverhandlingene henter organisasjonen fra tilgangssjekken; logget ut gir `signedOut`, og kjernen kalles ikke.

### 2f. Tenant-isolasjon (`reports.test.ts`, ett `expectTenantIsolation` per ny eller endret spørring)
- FA-T1 gjeldende beslutning (spørringen i `room-view.ts` som henter beslutninger med avvikets `deleted_at`).
- FA-T2 `decideSuggestion` med `already_decided`-oppslaget.
- FA-T3 `changeSuggestedDeviationTg` (oppslag av avvik og gjeldende rad).
- FA-T4 `saveField` for `tg` med forslagssjekken.
- FA-T5 `restoreDeviation` med oppslaget etter nyere beslutning.
- FA-T6 ingen lekkasje i svaret: bruker i A med avvik-id, regel-id eller beslutnings-id fra B får samme svar som for en id som ikke finnes (aldri `already_decided`, `newer_decision`, `conflict` eller `override_reason`), og radene i B er uendret (verdier og `updated_at`).
- FA-T7 `tests/tenant-isolation-all-tables.test.ts` er grønn (ingen ny tabell ventes).

### 2g. Logg, personvern og KI
- FA-I38 revisjonsloggen for TG-bytte har bare koder, id-er og TG; en oppdiktet fritekstmarkør i `overrideReason` finnes ikke i revisjonsloggen eller applikasjonsloggen (spion), men står i beslutningsraden.
- FA-I39 ingen kall til `src/core/ai` (spion på modulen) og ingen nye rader i `ai_usage_log` ved Godta, Endre, Avvis, `already_decided`, TG-bytte og gjenoppretting. B4.28 (statisk: `src/core/reports` importerer ikke `src/core/ai`) står.
- FA-I40 B4.14 står: ingen regel setter TG; TG endres bare av handling fra den ansatte.
- FA-I41 B4.28 står: ingen `delete` i `src/core/reports`; fjernet avvik er mykt slettet.

## 3. Regeltester (testsaker som data)
Ingen nye fagregler, terskler eller tekster. Eksisterende testsaker for reglene i badet kjøres uendret og skal være grønne (`pnpm test`). FA-I26, FA-I28 og FA-I29 bruker de samme regelsakene (folie 1995, hulltaking nektet, tilliggende konstruksjoner) som scenario og viser at regelsvaret i den nye raden er kopiert, ikke beregnet på nytt.

## 4. e2e (Playwright, `pc` og `ipad`)
Ny fil `e2e/fase-2a-rett-forslag-og-avvik.spec.ts`. Bruk hjelperne i `e2e/helpers.ts` og oppsettet fra `e2e/fase-2a-badet-pc.spec.ts`.
- FA-E1 T-0117: godta TG3, «Fjern avviket»: forslagskortet viser «Godta», «Endre» og «Avvis» straks uten punktbytte eller omlasting; meldingen «Avviket er fjernet. Forslaget om TG3 er åpent igjen.» har `role="status"`; «Angre» gir «Godtatt» igjen. Etter punktbytte og tilbake er knappene der fortsatt.
- FA-E2 T-0113: velg TG2 på avvik fra godtatt TG3: grunnene vises som knapper rett under TG-raden, fokus flyttes dit, TG vises ikke som lagret; «Avbryt» setter TG3 tilbake og fokus tilbake til TG-valget, og ingenting er lagret (tell kall til handlingen). Med grunn: kortet viser «Forslag TG3, endret til TG2: <grunn>», også etter omlasting. Velg TG3 igjen: ingen grunn spørres.
- FA-E3 T-0116: to sider i samme kontekst på samme bad; Godta i A, Endre i B → B viser «Godtatt i et annet vindu kl. HH.MM: TG3», kortet i B oppdateres, og bare ett avvik vises i begge etter omlasting. Samme med Avvis i B.
- FA-E4 «Å se over»: fjern TG3-avviket, merk ferdig → advarselen med TG3, kort grunn og Godta/Endre/Avvis; Godta fra listen → listen blir tom og telleren viser 0. TG3 står øverst når det finnes flere.
- FA-E5 T-0115: etter «Fjern avvikene med TG og sett TGIU» og alt fylt ut står ingen «Forslaget gjelder ikke lenger», og «Å se over» er tom.
- FA-E6 `newer_decision`: fjern, godta på nytt, «Angre» → meldingen «Forslaget er avgjort på nytt …» med lenke til forslaget; ett avvik.
- FA-E7 iPad-størrelse: grunnknappene og forslagsknappene i «Å se over» er minst 44 px høye, ingen vannrett rulling, alt virker med trykk.
- FA-E8 axe uten feil på grunnvalget, forslagskortet etter «Fjern avviket» og «Å se over» med åpent forslag; grunnvalget har etikett/gruppe-navn.
- FA-E9 tastatur: grunnvalget kan nås og velges med Tab og Enter/mellomrom; Escape eller «Avbryt» gir TG tilbake.
- FA-E10 uten nett: velges TG med grunn mens nettet er borte, vises tydelig norsk melding og ingenting står som lagret; ingen rapportdata i `localStorage`/IndexedDB (som B6.8). Kø uten nett for handlingen er utenfor omfanget (2b).
- Eksisterende B6-tester (særlig B6.1, B6.2, B6.4, B6.9, B6.11, B6.13, B6.13c, B6.14) er grønne uendret, eller endret bare der kortet bevisst endrer oppførsel, med begrunnelse i PR-en.

## 5. Kryss mot akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| T-0117 åpent forslag straks, «Angre» | FA-I1, FA-I2, FA-E1 |
| Åpent forslag på ferdig punkt | FA-L16–L23, FA-I29, FA-I30, FA-E4 |
| T-0115 | FA-L12–L15, FA-I31, FA-E5 |
| T-0116 og samtidige kall | FA-I9–I13, FA-L28, FA-E3 |
| `newer_decision` | FA-I3–I5, FA-I8, FA-E6 |
| T-0113 grunn, `changed`, tilbake gir `accepted` | FA-L7–L11, FA-I16, FA-I19–I26, FA-E2 |
| Tekster og kostnad følger TG | FA-I27 |
| Avvik uten forslag uendret | FA-I6, FA-I17 |
| A495 | FA-L4, FA-I28, FA-I29 |
| KI setter aldri TG | FA-I39, FA-I40 |
| Tenant og admin | FA-T1–T7, FA-I33 |
| iPad og universell utforming | FA-E7–E9 |
| Revisjonsloggen uten fritekst | FA-I38 |
| ADR, ordliste, funnfiler, versjon | sjekkes ved gjennomgang (ikke test) |
| `pnpm lint`, `typecheck`, `test`, `test:e2e` grønne | test-leder kjører alle fire |

## 6. Godkjenning
Test-leder avviser hvis noen av disse mangler: FA-I13 (ekte samtidige transaksjoner), FA-T1–T6, FA-I32–I34, FA-I16 eller FA-I19 (ingenting lagret uten grunn), FA-I38, FA-E1 eller FA-E2 i begge prosjektene.
