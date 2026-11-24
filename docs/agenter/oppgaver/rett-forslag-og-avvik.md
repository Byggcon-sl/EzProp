# Funksjon: Godtatt forslag og avvik henger alltid sammen (rett T-0113, T-0115, T-0116, T-0117)

- **Fase:** 2a-2 Hele veien først (retting av funn fra testlaget)
- **Modul:** kjerne / `src/core/reports` (regelforslag, avvik, advarsler) og badet på PC/iPad
- **Status:** under bygging (forhåndsvurdert runde 1 av forbedrer, arkitekt, fagansvarlig og test-leder 23.11.2026)
- **Gjenstår (23.11.2026, overtatt av hovedløkken):** bit 1–3 er levert på branchen (ren logikk, `already_decided`/`newer_decision`, TG-bytte med grunn og grunnvalget i avvikskortet). Igjen er bit 4: forslagskortet med «Fjern avviket»-meldingen og «Angre» (ny visning fra `deleteDeviation`), meldingene for `already_decided` og `newer_decision`, «Å se over» med Godta/Endre/Avvis og TG3 øverst, e2e på PC og iPad (med axe), resten av testplanen, funnfilene, PR-nummer i A490–A495 og versjon.
- **Branch:** `rett-forslag-og-avvik` (bygger på main)
- **Støtter hovedmål:**
  - **Reklamasjoner:** et TG3-forhold kan ikke lenger falle stille ut av rapporten, og hver endring av TG fra et regelforslag har grunn i loggen. Det er det vi trenger for å forklare graden ved en reklamasjon.
  - **De ansatte:** «Å se over» viser bare ekte advarsler og kan bli tom, og åpne forslag kan avgjøres rett fra listen. To vinduer (iPad og PC) gir ikke dobbelt arbeid.
  - **KI i bunnen:** beslutningsloggen for regelforslag blir sann og komplett, og er dermed brukbar som grunnlag for KI (se nytt planpunkt «Hvorfor har dette punktet denne TG-en?»).

## Problem

Fire bekreftede funn (alle middels, T-0117 nær alvorlig) har samme rot: koblingen mellom en beslutning i `rule_suggestion_decisions` og avviket den laget, holdes ikke ved like.

| Funn | Hva skjer i dag |
|---|---|
| T-0113 | TG byttes i avvikskortet etter «Godta» uten grunn. Loggen og skjermen sier fortsatt «Godtatt: TG3». |
| T-0115 | «Forslaget gjelder ikke lenger» står igjen etter at avviket er fjernet (og for godtatt TG0/TGIU uten avvik). «Å se over» blir aldri tom. |
| T-0116 | «Godta» i én fane og «Endre» i en annen gir to avvik for samme forhold. |
| T-0117 | «Fjern avviket» etter godtatt TG3: forslaget står som godtatt uten avvik og uten knapper, punktet har ingen TG, og ingen advarsel. |

Lar vi være, kan rapporten mangle et TG3-forhold eller ha to avvik med ulik TG for samme forhold, og loggen kan ikke forklare hvorfor.

## KI i bunnen

- KI har ingen ny oppgave her, og KI setter aldri TG. Reglene (data, ikke KI) lager forslaget; takstmannen avgjør.
- Det som lagres for KI: hver TG-endring på et avvik fra et regelforslag gir en ny rad i `rule_suggestion_decisions` med valgt TG, begrunnelseskode og eventuell tekst. Da får senere KI-funksjoner (sporet «Hvorfor har dette punktet denne TG-en?», KI-sjekk før publisering, læring av hvilke forslag som endres og hvorfor) en sann historikk. Begrunnelsesteksten lagres som i dag, men står aldri i revisjonsloggen (bare koder, id-er og TG).
- Ingenting går til KI i denne oppgaven, så `src/core/ai` berøres ikke. En test viser at det ikke blir kall dit og ingen rad i `ai_usage_log` når et forslag avgjøres eller TG byttes.

## Brukerhistorier

- Som **takstmann** vil jeg måtte gi grunn når jeg endrer TG på et avvik som kom fra et forslag, med grunnene rett under TG-valget, slik at rapporten tåler en reklamasjon uten at jeg må gjennom en feilmelding.
- Som **takstmann** vil jeg se forslaget igjen med knappene med en gang jeg har fjernet avviket, slik at et TG3-forhold ikke forsvinner uten at jeg har bestemt det.
- Som **takstmann** med badet åpent på iPad og PC vil jeg aldri få to avvik for samme forslag, og jeg vil se hva som ble bestemt i det andre vinduet.
- Som **takstmann** vil jeg at advarselen forsvinner når forholdet er løst, og at jeg kan avgjøre åpne forslag rett fra «Å se over».

## Definisjon: gjeldende beslutning

Én ren funksjon i `src/core/reports/logic/` (ny fil `effective-decision.ts`):

```ts
isEffectiveDecision(decision: DecisionState, checkpoint: { tgDirect: TgDirect | null }): boolean
```

- Bare **siste rad** per regel og punkt vurderes (siste rad vinner, også accepted → changed → accepted).
- `rejected` er alltid gjeldende.
- Rad som laget avvik (`madeDeviation`) er gjeldende bare når avviket står (ikke mykt slettet).
- Rad uten avvik med valgt TG 0, 1 eller IU er gjeldende bare når punktets `tgDirect` er lik den valgte.

`DecisionState` utvides med `madeDeviation: boolean` (raden har `deviation_id`) og `chosenTg: ChosenTg | null`; `deviationId` er som i dag `null` når avviket er slettet. Serveren bruker funksjonen ett sted (`room-view.ts`): `SuggestionView.latestDecision` er `null` når beslutningen ikke er gjeldende (kommentaren i typen oppdateres), `CheckpointState.decisions` får bare gjeldende beslutninger, og `decideSuggestion` bruker samme funksjon. Forslagskortet får ingen egen logikk; det viser knappene når `latestDecision` er `null`, som i dag.

## Omfang

**Med:**

1. **Fjernet avvik gjør forslaget åpent igjen (T-0117, A491).** En beslutning med avvik der avviket er mykt slettet, er ikke gjeldende. Forslaget vises da åpent med «Godta», «Endre» og «Avvis». Ingen ny rad når avviket fjernes; revisjonsloggen har slettingen. «Angre» (gjenopprett) gjør beslutningen gjeldende igjen, se punkt 6 for unntaket.
2. **Kortet oppdateres med en gang etter «Fjern avviket»** (forbedreren). Svaret fra `deleteDeviation` tar med ny visning (`RoomRefresh`), slik at forslagskortet straks står åpent der avviket var, uten å bytte punkt. Meldingen sier for avvik fra forslag: «Avviket er fjernet. Forslaget om TG3 er åpent igjen.» (TG-en fra forslaget; for «velg TG2 eller TG3»: «Forslaget er åpent igjen.»), med «Angre».
3. **Åpent forslag på ferdig punkt varsles (A492).** Ny fast advarselskode `open_suggestion_on_done_checkpoint`, sist i `CHECKPOINT_WARNING_CODES`. Slår til når punktet er merket ferdig og et utløst forslag av typen `outcome` eller `tg0` står uten gjeldende beslutning, **uansett om punktet har TG fra før** (også når et annet avvik har TG1 eller TG2). TGIU-forslag er dekket av `tgiu_suggested_not_set` og tas ikke med (ingen dobbel advarsel). Advarsel, aldri sperre. Tekst i `logic/labels.ts`, handling i `logic/warning-fix.ts` (gjenbruk `scroll_to_suggestion`), rad i ordlisten. Kodene står ikke i noen CHECK, så ingen migrering.
   - I «Å se over» viser advarselen forslagets TG og regelens korte grunn (målingen), med de samme tre knappene som forslagskortet (gjenbruk `rule-suggestion-card`). «Gå til punktet» står som reserve. TG3-forslag sorteres øverst (forbedreren).
4. **Advarselen om foreldet forslag (T-0115).** `suggestion_no_longer_applies` gjelder bare gjeldende beslutninger: for utfallsforslag bare når avviket står; for TG0/TGIU bare når punktets TG fortsatt er den valgte. Egen tekst når beslutningen ikke ga avvik, valgt etter om `deviationId` er `null` (ingen ny kode). Advarselen forsvinner når forholdet er løst, og «Å se over» kan bli tom.
5. **Ett avvik per forslag, også med to faner (T-0116, A493).** Rekkefølgen i `decideSuggestion`:
   - (a) samme beslutnings-id som før gir samme svar `saved` (som i dag);
   - (b) regelen slår ikke til gir `no_longer_applies`;
   - (c) en gjeldende beslutning finnes gir `{ status: "already_decided"; decision: "accepted" | "changed" | "rejected"; chosenTg: ChosenTg | null; decidedAt: string; refresh: RoomRefresh }`, uten ny rad og uten avvik, for Godta, Endre og Avvis og for alle forslagstyper;
   - (d) ellers som i dag.
   - Dagens `alreadyAccepted` fjernes og erstattes av (c).
   - **Ingen ekstra lås.** `withRoomWrite` låser alt rapportraden med `FOR UPDATE` (`context.ts`), så to samtidige kall i samme rapport går etter hverandre. Integrasjonstesten med to ekte samtidige transaksjoner skal være grønn med dagens lås.
   - Skjermen viser hva som ble bestemt og når, uten navn (forbedreren): «Godtatt i et annet vindu kl. 10.42: TG3», «Endret i et annet vindu kl. 10.42: TG2» eller «Avvist i et annet vindu kl. 10.42», og kortet viser riktig tilstand.
   - Kjent følge: gir regelen senere et annet forslag enn det som ble godtatt, og takstmannen velger «Behold» på det gamle avviket, er den gamle beslutningen fortsatt gjeldende, og det nye forslaget kan ikke avgjøres før avviket fjernes. Det gir ett avvik per regel og punkt, og er et bevisst valg (står i A493).
6. **«Angre» når forslaget er avgjort på nytt (A494).** Gjenopprettes et avvik fra et forslag (Angre eller papirkurven) mens det finnes en nyere beslutningsrad for samme regel og punkt (nytt avvik godtatt, endret eller avvist), avvises gjenopprettingen med `newer_decision`, og ingenting endres. Meldingen: «Forslaget er avgjort på nytt etter at avviket ble fjernet. Avviket hentes ikke tilbake.» med lenke til forslaget. Avvik som ikke kom fra forslag, gjenopprettes som før. Gjenopprettet avvik der regelen ikke lenger slår til, gir `suggestion_no_longer_applies` som i dag (testsak).
7. **TG-bytte på avvik fra forslag krever grunn (T-0113, A490).** Egen handling, ikke `saveField` (ADR 0013 punkt 12: `ReportFieldChange` er én endring per felt; en beslutningsrad er en følge utover feltet). Grensesnitt i `src/core/reports/types.ts`:

   ```ts
   ChangeSuggestedDeviationTg = (actor, organizationId, room, input: {
     id: string;            // UUID v7 fra nettleseren for beslutningsraden
     deviationId: string;
     tg: DeviationTg | null;
     base: DeviationTg | null;
     overrideReasonCode?: OverrideReasonCode;
     overrideReason?: string;
   }) => Promise<
     | { status: "saved"; decisionId: string; refresh: RoomRefresh }
     | { status: "conflict"; current: DeviationTg | null }
   >
   ```

   - Samme `id` to ganger gir samme svar og ingen ny rad.
   - `saveField` med feltet `tg` på et avvik som har `suggested_by_rule_id` og en gjeldende beslutning, avvises alltid med `override_reason` og lagrer ingenting. Avvik uten forslag er uendret.
   - **Regel for `accepted` mot `changed`** (ren funksjon i `logic/` med tabelltester): raden blir `accepted` uten grunn bare når avvikets utfall er forslagets utfall, og ny TG er utfallets faste TG, eller utfallet er «velg TG2 eller TG3» (da er TG-valget en del av å godta, også tom TG). Alt annet er `changed` og krever grunn etter `checkOverrideReason` (koder fra A380). Uten grunn: `override_reason`, verken avvik eller rad lagres.
   - **Innholdet i den nye raden:** `suggestion`, `reasons`, `lifespan_set_key`, `threshold_set_key` og `inspection_year` kopieres fra den gjeldende raden som erstattes; reglene kjøres ikke på nytt (regelen slår kanskje ikke til lenger, og kolonnene er NOT NULL). `chosen_outcome_key` er avvikets utfall, `deviation_id` det samme avviket. TG og raden lagres i samme transaksjon.
   - **Skjermen** (forbedreren): room-view merker hvert avvik med gjeldende beslutning (`suggestionTg`, `requiresReasonOnTgChange`). Velges en TG som krever grunn, vises grunnene som store knapper rett under TG-raden i avvikskortet (gjenbruk «Endre»-valgene, ikke egen dialog). Ett trykk velger grunn; fritekst er valgfri der `CheckOverrideReason` tillater det. Valgt TG vises ikke som lagret før grunnen er valgt, og TG og grunn sendes som ett kall. «Avbryt» setter TG tilbake. Byttes TG tilbake til forslagets TG, spørres det ikke om grunn.
   - Kortet viser «Endret: TG2 (grunn)», der grunnen er den norske teksten for grunnkoden (ikke fritekst), og både forslagets TG og valgt TG («Forslag TG3, endret til TG2: …»).
   - Tekster og kostnad følger TG: ved TG3 → TG2 slår `texts_written_for_other_tg` til, og ved TG2 → TG3 slår `tg3_missing_cost` til (testsak begge veier). «Endre» skal heller ikke lage TG2-avvik med tiltakstekst for TG3.
8. **TG satt direkte på punktet etter godtatt TG0 eller TGIU (A495).** Endres punktets TG bort fra en godtatt TG0 eller TGIU, blir beslutningen ikke gjeldende (definisjonen over), forslaget står åpent igjen, og advarselen kommer på ferdig punkt (`open_suggestion_on_done_checkpoint` for TG0, `tgiu_suggested_not_set` for TGIU). Ingen grunn kreves og ingen ny rad her: `tg_direct` er et vanlig felt i køen uten nett. Ingen falsk «gjelder ikke lenger».
9. Funnfilene T-0113, T-0115, T-0116 og T-0117 settes til status «rettet» med PR-nummer, `forsok: 1`, og en linje i loggen.
10. Beslutninger A490–A495 og spørsmål 105 er ført i `docs/09-apne-sporsmal.md` (23.11.2026); PR-kolonnen fylles inn. ADR 0013 punkt 9 (gjeldende beslutning), 10 (regelsvaret kopieres fra raden som erstattes ved TG-bytte) og 12 (ny handling) oppdateres. Ordlisten får «gjeldende beslutning» (`effective decision`), `open_suggestion_on_done_checkpoint`, `already_decided` og `newer_decision`. Versjonsnummer (patch).

**Ikke med (bevisst utelatt):**

- Ny beslutningsverdi (for eksempel `withdrawn`) eller endret CHECK i `rule_suggestion_decisions`. Ingen migrering.
- Spørsmål 104 (b) til fagrådet: om TG-bytte *alltid* skal kreve grunn, også på avvik som ikke kom fra et forslag. Her gjelder kravet bare avvik fra forslag.
- Spørsmål 105 til Ståle: om et åpent TG3-forslag på ferdig punkt skal sperre publisering. Inntil svar: advarsel.
- Endring av hvilke regler som utløses, terskler eller fagtekster.
- Varsel i sanntid mellom faner (push). Den andre fanen får svaret når den prøver å lagre.
- Synkkøen uten nett utover at `already_decided` regnes som ferdig (ingen ny kø-logikk). TG-bytte med grunn går som egen handling på PC; i køen uten nett (2b) blir den en egen kommando (ADR 0013 punkt 12).
- Andre funn fra testlaget i samme område, med mindre de faller ut av samme endring.

## Tilgang

Uendret. Samme regler som badet i dag (`withRoomWrite`, `src/core/access`).

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja | ja (`access.inspectors_edit_all`) |
| kontor | som i dag | som i dag |
| leder | ja | ja |
| admin | ja | ja (admin stenges aldri ute, test med TG-bytte med grunn) |

Reklamasjonssaker: bare leder og admin, som i dag (regel 12). Nye og endrede spørringer filtrerer på `grant.organizationId` og får `expectTenantIsolation` i testfilen: gjeldende beslutning, `decideSuggestion`, `changeSuggestedDeviationTg`, `saveField` for TG og gjenoppretting. En annen organisasjon får samme svar som når saken ikke finnes (ingen `already_decided`- eller `newer_decision`-lekkasje).

## Data

- Ingen nye tabeller eller kolonner. Ingen migrering.
- `rule_suggestion_decisions` får nye rader `changed`/`accepted` ved TG-bytte på avvik fra forslag. CHECK-reglene tåler radene (`accepted` uten grunn, `changed` med grunn, samme `deviation_id`).
- Nye svarstatuser: `already_decided` fra `decideSuggestion`, `newer_decision` fra gjenoppretting, `override_reason` fra `saveField` for TG på avvik fra forslag.
- Ny avledet størrelse i `logic/`: gjeldende beslutning (se definisjonen).
- Ny advarselskode `open_suggestion_on_done_checkpoint` sist i `CHECKPOINT_WARNING_CODES` (fast kode).
- Revisjonsloggen for den nye handlingen: bare koder, id-er og TG, aldri begrunnelsesteksten.

## Skjermer

- **Forslagskortet (iPad og PC):** etter «Fjern avviket» står forslaget åpent med knappene med en gang. Etter TG-bytte: «Forslag TG3, endret til TG2: <grunn>». Ved `already_decided`: «Godtatt i et annet vindu kl. 10.42: TG3» (eller Endret/Avvist) og oppdatert kort.
- **Avvikskortet:** TG-valg på avvik fra forslag viser grunnene som knapper rett under TG-raden (ett trykk mer, bare der det trengs). «Avbryt» setter TG tilbake.
- **«Å se over»:** foreldet-advarselen forsvinner når avviket er borte; åpent forslag på ferdig punkt vises med forslagets TG, kort grunn og knappene Godta, Endre og Avvis, TG3 øverst.
- Universell utforming: grunnvalget har etiketter, fokus flyttes til grunnvalget og tilbake til TG-valget ved «Avbryt», meldingene leses opp (`role="status"`).

### Faste tekster (testene sjekker disse)

| Hvor | Tekst |
|---|---|
| Foreldet forslag med avvik | som i dag |
| Foreldet forslag uten avvik (TG0/TGIU) | «Forslaget gjelder ikke lenger. Punktet har fortsatt TG<x> fra forslaget. Sjekk at graden stemmer.» |
| Åpent forslag på ferdig punkt | «Punktet er ferdig, men forslaget om TG<x> er ikke avgjort.» |
| Etter «Fjern avviket» | «Avviket er fjernet. Forslaget om TG<x> er åpent igjen.» |
| `already_decided` | «Godtatt i et annet vindu kl. HH.MM: TG<x>» / «Endret i et annet vindu kl. HH.MM: TG<x>» / «Avvist i et annet vindu kl. HH.MM» |
| `newer_decision` | «Forslaget er avgjort på nytt etter at avviket ble fjernet. Avviket hentes ikke tilbake.» |
| Grunn mangler | «Velg en grunn for å endre TG fra forslaget.» |

Egne formuleringer, ingen gjetteord, ingen tekst fra NS 3600, IVIT eller SmartTakst.

## Regler

Ingen nye fagregler. Logikken for gjeldende beslutning, `accepted`/`changed` og advarslene er ren kode i `src/core/reports/logic/` som kjører både på iPad og server, med tabelltester.

## Testplan

**Rene tabelltester (`src/core/reports/logic/`):**
- gjeldende beslutning: accepted med levende avvik er gjeldende; accepted eller changed med mykt slettet avvik er ikke gjeldende; rejected er alltid gjeldende; TG0/TGIU bare når `tgDirect` er den valgte; siste rad vinner (accepted → changed → accepted).
- `accepted` mot `changed`: fast TG lik utfallets, «velg TG2 eller TG3» med TG2, TG3 og tom TG, annet utfall, annen TG.
- advarsler: `suggestion_no_longer_applies` forsvinner når avviket er slettet; egen tekst for TG0 uten avvik; «Å se over» blir tom når alt er løst; åpent TG3 på ferdig punkt gir advarsel, også når et annet avvik har TG1 eller TG2; åpent forslag på punkt som ikke er ferdig gir ingen advarsel; TGIU-forslag gir ikke `open_suggestion_on_done_checkpoint`; advarslene er aldri sperre.
- synkkøen regner `already_decided` som ferdig (ingen ny runde, ingen feil).

**Integrasjon mot testdatabasen:**
- T-0117: godta TG3, fjern avviket, les på nytt: forslaget er åpent, svaret fra `deleteDeviation` har ny visning, ingen ny beslutningsrad. «Angre» gjør det godtatt igjen.
- A494: godta, fjern, godta på nytt, «Angre» på det gamle → `newer_decision`, ett levende avvik. Det samme når forslaget er avvist i mellomtiden.
- T-0116: Godta → Endre, Godta → Avvis og Avvis → Godta gir `already_decided` og høyst ett avvik. Samme beslutnings-id to ganger gir samme svar. To samtidige kall på to egne tilkoblinger (ekte parallelle transaksjoner) gir nøyaktig ett avvik og én beslutning.
- T-0113: `saveField` for TG på avvik fra forslag → `override_reason`, ingenting lagret. `changeSuggestedDeviationTg` uten grunn → `override_reason`, verken avvik eller rad; med grunn → rad `changed` med samme `deviation_id` og kopiert regelsvar; bytte tilbake → `accepted` uten grunn. Avvik uten forslag kan bytte TG uten grunn, som før.
- Fag: byggeår 1995, folie, godta TG3, bytt til TG2 uten grunn → `override_reason`; med grunn → rad `changed` med forslag TG3 og valgt TG2. TG3 → TG2 gir `texts_written_for_other_tg`; TG2 → TG3 gir `tg3_missing_cost`.
- A495: (a) hulltaking nektet, godta TGIU, sett TG2 på punktet → TGIU-forslaget åpent, `tgiu_suggested_not_set` står, ingen «gjelder ikke lenger»; (b) godtatt TG0 (tilliggende konstruksjoner), endre TG → forslaget åpent og advarsel på ferdig punkt.
- A492: godtatt TG3 og et annet TG2-avvik, fjern TG3-avviket, merk ferdig → `open_suggestion_on_done_checkpoint`.
- Revisjonsloggen inneholder ikke begrunnelsesteksten (sjekk mot den eksakte teksten).
- Ingen kall til `src/core/ai` og ingen rad i `ai_usage_log`.
- Tilgang: se «Tilgang».

**e2e på PC og iPad-størrelse:**
- T-0117: godta TG3, fjern avviket: knappene er synlige straks, uten å bytte punkt. «Angre» gir godtatt igjen.
- T-0113: TG-valg viser grunnene under TG-raden; «Avbryt» endrer ingenting; med grunn vises «endret til».
- T-0116: to sider i samme kontekst: den andre siden får «Godtatt i et annet vindu kl. …», og kortet oppdateres.
- «Å se over»: åpent forslag avgjøres fra listen, og listen blir tom.
- Universell utforming: grunnvalget har fokus og etiketter (axe).

## Akseptkriterier

- [ ] T-0117: godtatt TG3, «Fjern avviket»: forslaget er åpent med knappene med en gang, med meldingen og «Angre». «Angre» gjør det godtatt igjen. (integrasjon + e2e)
- [ ] Åpent forslag (TG3, også når punktet har et annet avvik med TG) på ferdig punkt gir `open_suggestion_on_done_checkpoint` og kan avgjøres fra «Å se over». (ren test + integrasjon + e2e)
- [ ] T-0115: etter «Fjern avvikene med TG og sett TGIU» står ingen «Forslaget gjelder ikke lenger». Godtatt TG0 uten avvik har egen tekst, og advarselen forsvinner når forholdet er løst. «Å se over» kan bli tom. (ren test + e2e)
- [ ] T-0116: Godta i fane A og Endre (og Avvis) i fane B gir ett avvik og `already_decided` med valg og tidspunkt. To samtidige kall gir ett avvik. (integrasjon + e2e)
- [ ] «Angre» på et gammelt avvik etter ny beslutning gir `newer_decision` og aldri to avvik. (integrasjon)
- [ ] T-0113: TG-bytte på avvik fra godtatt forslag uten grunn avvises med `override_reason` og lagrer ingenting; med grunn lagres ny rad `changed` med samme avvik. Skjermen viser forslagets og valgt TG. Bytte tilbake gir `accepted`. (integrasjon + e2e)
- [ ] Tekster og kostnad følger TG (`texts_written_for_other_tg`, `tg3_missing_cost`).
- [ ] TG-bytte på avvik som ikke kom fra et forslag, er uendret (ingen grunn kreves).
- [ ] TG satt direkte bort fra godtatt TG0/TGIU åpner forslaget og gir advarsel (A495).
- [ ] KI setter aldri TG; ingen kall til `src/core/ai`.
- [ ] Bruker i annen organisasjon får ikke tilgang (test, `expectTenantIsolation` for nye og endrede spørringer). Admin kan bytte TG med grunn.
- [ ] Virker på iPad-størrelse (e2e), og grunnvalget er universelt utformet.
- [ ] Revisjonsloggen har bare koder, id-er og TG, aldri begrunnelsesteksten.
- [ ] ADR 0013 punkt 9, 10 og 12 og ordlisten er oppdatert.
- [ ] Funnfilene satt til «rettet» med PR-nummer.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` er grønne.

## Lagt til av forbedreren

Ført i `docs/plan/forbedrerens-tillegg.md`.

| Tillegg | Type | Hvor i kortet |
|---|---|---|
| Grunn velges i nettleseren før TG sendes; TG og grunn går som ett kall, «Avbryt» setter TG tilbake | i oppgaven | Omfang 7 |
| Grunnene som store knapper rett under TG-raden, ikke egen dialog | i oppgaven | Omfang 7 |
| Kortet oppdateres straks etter «Fjern avviket», med «Forslaget om TG3 er åpent igjen» og «Angre» | i oppgaven | Omfang 2 |
| Ny advarselskode, åpne forslag avgjøres rett fra «Å se over», TG3 øverst | i oppgaven | Omfang 3 |
| «Alt avgjort» sier hva og når (uten navn) | i oppgaven | Omfang 5 |
| «Hvorfor har dette punktet denne TG-en?» (spor og KI-utkast til forklaring) | nytt planpunkt | `docs/07-utviklingsplan.md` 2a-2 «Fra forbedreren» |

## Avgjort ved uenighet (prosjektlederen)

- **TG og grunn: felt i køen (forbedreren) eller egen handling (arkitekten)?** Egen handling `changeSuggestedDeviationTg`. Begrunnelse: ADR 0013 punkt 12 sier at det som har følger utover ett felt, er egne handlinger, og køen uten nett i 2b bygger på at `ReportFieldChange` er ett felt. Forbedrerens mål beholdes fullt ut: grunnen velges før noe sendes, TG og grunn går som ett kall, og ingenting henger som «feilet».
- **Lås på `checkpoint_results` (kortet) eller ingen ekstra lås (arkitekten)?** Ingen ekstra lås. Rapportraden er alt låst i `withRoomWrite`, og raden i `checkpoint_results` finnes ikke alltid. Testen med to samtidige kall beholdes som bevis.
- **Ny advarselskode for alle forslag (fagansvarlig) eller bare utfall (arkitekten)?** Utfall og TG0. TGIU har alt `tgiu_suggested_not_set`, og to advarsler for samme forhold gjør «Å se over» støyete.
- **TG0/TGIU satt direkte: krev grunn (fagansvarlig, alternativ 1) eller åpne og varsle (alternativ 2)?** Åpne og varsle (A495). `tg_direct` er et vanlig felt i køen uten nett, og advarselen gjør at forholdet ikke faller stille ut.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`)

Høyeste A-nummer på main er A430, på åpne brancher A489 (`pdf-motor-badet`). Denne oppgaven bruker **A490–A495**. Høyeste spørsmålsnummer er 104, så nytt spørsmål til Ståle er **105**.

| Nr | Hva | Hvorfor | Endres slik | Kost |
|---|---|---|---|---|
| A490 | TG-bytte på avvik fra forslag krever grunn og gir rad `changed` gjennom egen handling; bytte tilbake til forslagets TG gir `accepted` uten grunn. Regelsvaret kopieres fra raden som erstattes. Bare avvik fra forslag (spørsmål 104 b står åpent hos fagrådet). | ADR 0013 punkt 9 og 12, A345: tabellen er eneste fasit. Reklamasjoner. | Fjern kravet i `changeSuggestedDeviationTg` og slipp `tg` gjennom `saveField`. | lett å endre |
| A491 | Fjernet avvik gjør beslutningen ikke gjeldende (avledet, ingen ny rad, ingen ny beslutningsverdi). Forslaget blir åpent igjen. | Tabellen får bare nye rader, CHECK står; «Angre» virker av seg selv. | Ny beslutningsverdi krever migrering. | dyrt å endre |
| A492 | Åpent forslag (utfall eller TG0) på ferdig punkt gir ny advarsel `open_suggestion_on_done_checkpoint`, også når punktet har annen TG. Advarsel, ikke sperre, til Ståle svarer på spørsmål 105. | TG3 skal ikke falle stille ut (T-0117). | Gjør den til sperre i publiseringen, eller ta bort koden (arkiveres). | lett å endre |
| A493 | Godta/Endre/Avvis når en gjeldende beslutning finnes, gir `already_decided` med valg og tidspunkt (uten navn). Ingen ekstra lås: rapportraden er låst. «Behold» på et gammelt avvik holder et nytt forslag fra samme regel lukket til avviket fjernes. | Ett avvik per regel og punkt (testplan B4.31). | Endres i `decideSuggestion`. | lett å endre |
| A494 | Gjenoppretting av avvik fra forslag avvises med `newer_decision` når forslaget er avgjort på nytt etter slettingen. | Ellers kan to avvik stå for samme forslag. | Tillat gjenoppretting og gi advarsel i stedet. | lett å endre |
| A495 | TG satt direkte bort fra godtatt TG0/TGIU krever ikke grunn; beslutningen blir ikke gjeldende, forslaget åpnes, og advarselen kommer på ferdig punkt. | `tg_direct` er et vanlig felt i køen uten nett; forholdet faller ikke stille ut. | Lag egen handling med grunn som for avvik. | lett å endre |

## Roller

- `arkitekt`: kort ADR-oppdatering (ADR 0013 punkt 9, 10, 12), og kontroll av handlingen og svarformene.
- `utvikler` og `testskriver` i parallell. Biter som ikke henger sammen:
  1. Ren logikk i `logic/` (gjeldende beslutning, `accepted`/`changed`, advarslene og tekstene) + tabelltester.
  2. `decideSuggestion` (`already_decided`), `deleteDeviation` med ny visning og gjenoppretting med `newer_decision` + integrasjonstester.
  3. `changeSuggestedDeviationTg`, avvisning i `saveField`, grunnvalget i avvikskortet + tester.
  4. Forslagskortet, meldingene og «Å se over» med knappene + e2e.
- `ux`: lite, for grunnvalget under TG-raden og meldingene.
- `domene`: kontroll av at TG3 ikke kan falle ut, regelen for `accepted`/`changed`, og følgen i A493.
- Ikke `ui` (gjenbruk av komponenter), ikke `sikkerhet` utover vanlig tenant-test (ingen ny tilgang).

## Åpne spørsmål

- Spørsmål 104 (b) til fagrådet: skal TG-bytte alltid kreve grunn, også på avvik som ikke kom fra et forslag? Står åpent; ikke med her.
- Spørsmål 105 til Ståle (fag): skal et åpent TG3-forslag på et ferdig punkt sperre publisering, slik manglende TG gjør (A385), eller bare gi advarsel? Inntil svar: advarsel (A492).
