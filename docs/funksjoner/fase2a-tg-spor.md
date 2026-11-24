# Funksjon: «Hvorfor har dette punktet denne TG-en?» (spor og forklaringsutkast)

- **Fase:** 2a-2 Hele veien først (fra forbedreren 23.11.2026, bygger på «Godtatt forslag og avvik henger alltid sammen», PR #239)
- **Modul:** kjerne / `src/core/reports` (sporet og avgjørelsen av forklaringen), `src/core/audit` (ny lesefunksjon), `src/core/ai` (forklaringsutkastet), `src/core/access` (tilgang), badet på PC og iPad, reklamasjonssaken
- **Branch:** `tg-spor` (bygger på main)
- **Status:** klar for bygging (forhåndsvurdering runde 1 innarbeidet 24.11.2026)
- **A-numre:** A590–A599 (A527–A529 og A543–A549 holdes ledige; A530–A542 er tatt av `pdf-motor-badet`, A550–A563 av `skriv-det-du-ser`, A564–A577 av `overstyringer-leder`). **Spørsmål:** 124–128 (120–123 er tatt på andre brancher). **Versjon:** 0.19.8 (én patch over main, 0.19.7). **Migrering:** ingen (0039 er tatt av `overstyringer-leder`). **ADR:** tillegg i ADR 0006 og ADR 0013, ikke nytt nummer (0016 er tatt av `pdf-motor-badet`).
- **Støtter hovedmål:**
  - **Reklamasjoner:** når en kjøper klager, ser leder med ett klikk hva rapporten sa da den ble utgitt, hva reglene foreslo, hva takstmannen valgte og grunnen. Svaret bygges på fakta, og på graden kjøperen faktisk fikk.
  - **De ansatte:** takstmannen ser på knappen hvilke punkter som avviker fra reglene før han publiserer. Leder slipper å ringe takstmannen.
  - **KI i bunnen:** KI skriver et utkast til en kort, saklig forklaring av graden ut fra koder, TG og målinger, som takstmannen eller lederen godtar, endrer eller avviser.

## Problem

Beslutningsloggen for regelforslag (`rule_suggestion_decisions`) er sann og komplett etter PR #239, men ingen kan se den. Endringer på avvik (TG byttet, avvik fjernet, gjenopprettet) og TG satt direkte på punktet står i revisjonsloggen, også usynlig. Ved en reklamasjon må leder i dag spørre takstmannen hvorfor et punkt fikk TG2 og ikke TG3, og hun ser ikke om graden er endret etter at rapporten ble utgitt. Lar vi være, blir svaret tregere og svakere, og kan i verste fall oppgi en grad kjøperen aldri fikk se.

## KI i bunnen

- **Fra første dag:** knappen «Lag forklaring» i sporpanelet gir et KI-utkast på 2–4 setninger om hvorfor punktet har graden. Eksempel (sjikt fra før 2000): «Reglene foreslo TG3 fordi det vanntette sjiktet er fra før 2000 (årstallet er byggeåret, anslått). Takstmannen satte TG2 med grunnen ‹Alderen er kjent på annen måte›.» Eksempel (fukt): «Reglene foreslo avviket forhøyet fukt med TG2 eller TG3 fordi fukten i treverk ble målt til 18 vekt-%, på eller over grensen for treverk. Takstmannen valgte TG3.»
- **Den ansatte avgjør med to knapper** (ux, ki-ansvarlig, A598): «Kopier» av urørt tekst logges som godtatt, «Kopier» etter retting logges som endret, «Forkast» logges som avvist. Lukkes panelet uten valg, blir utkastet stående som foreslått og vises som «Laget [tid], ikke avgjort» neste gang. Den rettede teksten sendes aldri til serveren og lagres ikke (A590); bare status logges.
- **Ny KI-funksjon `tg_explanation`** i `src/core/ai/features.ts`: egen ledetekst `tg_explanation.v1`, `allowedFields: []` (nettleseren sender ingen tekst), inndata bygges bare av serveren, persondatavask, vakter, falsk leverandør, eget evalueringssett `src/core/ai/evals/tg_explanation.cases.json` med minst 30 saker og `evalPassRate: 0.9` (som `summary_draft`). Funksjonen slås ikke på for ekte bruk før settet består.
- **Inndata** (ny type `AiTgTrailInput` i `src/core/ai/types.ts`, felt `tgTrail` i `AiServerInput`, fylt av `src/core/reports`): `checkpointKey`, `checkpointName`, `roomTypeKey` (aldri romnavn), `currentCheckpointTg`, `deviationTg` når sporet gjelder ett avvik, `publishedTg` og `changedAfterRelease` (forbedreren 1), og per forslag `ruleKey`, `suggestedTg` (`choose` gir begge), `decision`, `chosenTg`, `overrideReasonCode`, `overrideReasonLabel`, `measurements: { fieldKey, label, value, unit, material }[]`, `buildYearSource` når regelen bruker byggeåret, `deviationStands`, og kjeden av TG-bytter (fra → til). **Grenseverdien sendes ikke** (A597).
- **`serverSources`** (eksakt liste): `checkpoints.key`, `checkpoints.name`, `room_types.key`, `rule_suggestion_decisions.rule_key`, `.suggestion`, `.decision`, `.chosen_tg`, `.override_reason_code`, `.reasons` (bare tolket måling, se under), `deviations.tg`, `checkpoint_results.tg_direct`, `report_releases.snapshot` (bare TG for punktet). Ingen `free_text`. `findFieldSourceViolations` skal fortsatt være grønn.
- **Sendes aldri:** navn, e-post, telefon, adresse, matrikkel, romnavn, etasje- og bygningsnavn, ansatt-id, rolle knyttet til person, tidspunkter og datoer (de står i panelet, ikke i utkastet), oppdragsnummer, `rule_suggestion_decisions.override_reason`, `deviations.deviation_text`, `cause_text`, `consequence_text`, og alt fra `claims`. `rule_suggestion_decisions.override_reason` legges inn i `src/core/ai/never-fields.ts` og testens faste kopi (krever gjennomgang av sikkerhet-personvern, A175).
- **Målingene** leses fra `rule_suggestion_decisions.reasons` (serverens regelsvar da beslutningen ble tatt), aldri fra dagens `field_answers`. `reasons` tolkes med et strengt Zod-skjema bygd på `RuleReason` i `src/core/rules/types.ts`; bare `type`, `element_key`, `value`, `unit`, `limit`, `comparator`, `threshold_key`, `year`, `age`, `material_code` og `selected_option_keys` beholdes, ukjente nøkler kastes, og ukjent form gir linje uten måling (ikke feil). Enhet og etikett hentes fra rapportens låste malversjon, og etikettene går gjennom vasken som annen tekst.
- **Vakter** (`src/core/ai/guards.ts`):
  - **TG-vakten** får en egen gren for `tg_explanation` under samme kode `tg_guard`: hver TG som nevnes i svaret, må finnes blant TG-ene i inndata (foreslått, begge ved `choose`, valgt, alle fra/til i kjeden, gjeldende, utgitt). Svaret skal ha minst én TG-omtale. Vaktrekkefølgen i A471 oppdateres.
  - **Tallvakten** som før: tall som ikke står i inndata stoppes. Siden tider og datoer ikke sendes, gir den ingen falske stopp.
  - **Gjetteord, standardhenvisninger, skyld og ansvar** prøves i evalueringssettet og ledeteksten, ikke med ny vaktkode (A596). Ingen migrering.
- **Data som lagres for KI:** ingenting nytt i rapporten. Utkastet og avgjørelsen står i `ai_usage_log` med mål `checkpoint_result`, feltkode `tg_explanation` (egen konstant i `src/shared/config/ai-targets.ts` som `DEVIATION_NEW_MEASURE_FIELD_KEY`, ikke i `REPORT_AI_TARGET_FIELDS.checkpoint_result`). Ingen sak-id i `target_ref` eller andre steder i loggen. `output_text` følger vanlig oppbevaring (10 år, avviste etter `ai.rejected_retention_years`, myk sletting).
- **Publiseringssperren:** `tg_explanation` legges i `NOT_AI_TEXT_FEATURES` i `src/core/ai/approval-check.ts`. Et åpent forklaringsutkast gir verken `ai_suggestion_pending` eller KI-merke, og stopper aldri publisering.
- Uten nett eller med KI av: sporet virker som før (med nett), knappen sier «Trenger nett» eller «KI er ikke slått på». Kontor ser ikke knappen.

## Brukerhistorier

- Som **takstmann** vil jeg se på knappen «Spor: TG3 → TG2 (dokumentasjon)» hvilke punkter som avviker fra reglene, og åpne hele kjeden med tid og rolle, slik at jeg vet at graden er godt begrunnet før jeg publiserer.
- Som **leder** vil jeg åpne en reklamasjonssak og finne punktet klagen gjelder øverst, med graden i den utgitte rapporten og graden nå, slik at jeg svarer kjøperen med fakta.
- Som **leder** vil jeg få et KI-utkast til en kort forklaring, eller kopiere sporet som ren tekst når KI er av, slik at svaret går raskere og blir saklig.

## Omfang

**Med:**

1. **Sporet som avledet lesemodell** i `src/core/reports` (ny fil `tg-trail.ts`, ren sammensetting i `logic/tg-trail.ts`). Ingen lagring (tillegg i ADR 0013).
   - Signatur (actor-mønsteret):
     - `getTgTrail(actor, organizationId, { reportId, checkpointResultId, deviationId?, via: { kind: "room" } | { kind: "claim", claimId } }): Promise<TgTrail>`
     - `listClaimTgTrailCheckpoints(actor, organizationId, claimId): Promise<ClaimTrailReport[]>`
   - **Kilder, fast tillatt-liste:**
     - `rule_suggestion_decisions` for punktet. Sporet leser øyeblikksbildet på raden (`suggestion`, `reasons`, `lifespan_set_key`, `threshold_set_key`, `inspection_year`) og kjører **aldri** reglene på nytt med dagens tabeller.
     - Revisjonsloggen gjennom ny funksjon i `src/core/audit`: `listEntityAuditEvents(executor, grant, { entityTypes, entityIds, reportId })`. Filtrerer på `grant.organizationId`, har ingen egen rettighetssjekk (kalleren har sjekket), egen `expectTenantIsolation`. Avviks-id-ene slås først opp med organisasjon og rapport, også mykt slettede. Bare disse hendelsene tas med: avvik `create`, `delete`, `restore`, `update` med `field = "tg"`, og `checkpoint_result` `update` med `field = "tg_direct"` (TG0, TG1, TGIU). Tekstendringer tas aldri med. `changes` sendes aldri videre som den er; bare TG fra/til og utfallskode. Aldri `actorEmployeeId`, navn eller `deviceId` ut av tjenesten.
     - `report_releases`: én linje per utgivelse, «Utgitt versjon N: TG2 i rapporten», med TG for punktet hentet fra snapshot. Linjer etter siste utgivelse merkes «etter utgivelse» (forbedreren 1, A595).
     - Åpent forslag uten beslutning: linjen kommer fra samme regelkjøring som `room-view.ts` gjør, ikke fra ny logikk. «Forslaget er åpent igjen» utledes med `isEffectiveDecision` fra `logic/effective-decision.ts`.
   - **Linjene:**
     - Forslagslinjen bruker `suggestionTgLabel`: «Reglene foreslo avvik: forhøyet fukt, TG2 eller TG3» (fuktregelen har utfallet `choose` og foreslår aldri TG3 alene), «Reglene foreslo TG3: vanntett sjikt fra før 2000». Målingen vises med enhet og materiale: «18 vekt-% i treverk». Grensen vises i panelet (som i dag i «Hvorfor»-linjene). Måling i annen enhet eller annet materiale gir ikke forslag (`unit_not_supported`) og skal ikke vises som om reglene vurderte den.
     - Forslaget har ikke eget tidspunkt (reglene kjøres ved lesing). Forslagslinjen vises uten tid, rett før beslutningslinjen (A594). Tid diktes aldri opp.
     - Beslutningslinjen: «Takstmann godtok», «Leder endret til TG2: Dokumentasjon er lagt fram» (etiketten fra `OVERRIDE_REASON_LABELS`), «avviste».
     - Avvikslinjene har bare utfallskode som etikett og TG fra → til. Avviksteksten vises aldri. HMS-avvik viser «uten TG», og «Lag forklaring» tilbys ikke der.
   - **Rolle** på hver linje er dagens rolle fra `employee_roles` i samme organisasjon, også for ansatte som har sluttet. Fast rangering ved flere roller: admin, leder, takstmann, kontor. Finnes ingen rolle: «Ansatt». Regelforslag: «Reglene». Aldri navn (A591, A593).
   - **Rekkefølge:** eldst øverst, nyeste nederst, både på badet og i reklamasjonssaken. Tiden er `decided_at`, `occurred_at` og `released_at` (aldri `received_at`); ved lik tid avgjør id-en (uuidv7). Vises i norsk tid (Europe/Oslo).
   - **Øverst i panelet:** punktets TG nå (høyeste blant avvikene, ellers `tg_direct`, som `computeCheckpointTg`), avvikets TG når sporet gjelder ett avvik (et TG2-avvik på et TG3-punkt sier begge), og «TG i utgitt rapport» når den er ulik TG nå.
   - **Begrunnelsesteksten** fjernes i tjenesten, ikke i skjermen: med `canSeeOverrideReasons` er den med, ellers bare etiketten. Kode tom og bare tekst: «Grunn oppgitt» uten tekst. Teksten logges aldri og står aldri i feilmeldinger.
   - Sporet telles eller summeres aldri per person (det hører til «Overstyringer for leder» og spørsmål 90).
2. **«Spor» på badskjermen (PC og iPad).** Knappen på hvert avvikskort og på hvert punkt med regelforslag.
   - **Kortversjon på knappen** (forbedreren 2): «Spor: TG3 → TG2 (dokumentasjon)» når graden er endret fra forslaget, «Spor: forslag avvist» når det er avvist, ellers bare «Spor». Sammendraget bygges av beslutningen rommet alt har lastet; ingen ekstra spørring. Det fulle sporet lastes først når panelet åpnes.
   - Tilgjengelig navn: «Spor for Våtrom, sluk: TG2». Trykkflate minst 44 pt på iPad.
   - Panelet: vanlig dialog på iPad som lukkes med knappen (ikke ark som sveipes), sidepanel på PC som ikke dekker avvikskortet som ble åpnet. Esc lukker på PC, og fokus går tilbake til Spor-knappen. Liste med `<time>`, WCAG AA. Knappene nederst i panelet (Lag forklaring, Kopier, Forkast, Kopier spor, Lukk) er 56 pt.
   - Uten nett: Spor-knappen vises som før. Panelet sier «Sporet trenger nett. Det vises når iPaden er på nett igjen.» og laster selv når nettet kommer tilbake mens det er åpent. Synkstatusen synes og dekkes ikke (A592).
3. **Samme spor fra reklamasjonssaken** (bare leder og admin, regel 12). Delen «Hvorfor fikk punktene graden?» på saken.
   - Rapportene på sakens `assignment_id`, både publiserte og erstattede versjoner. Punktene med avvik med TG2, TG3, TGIU, TG satt direkte eller regelforslag, gruppert per rom. Mykt slettede rapporter og rom vises ikke; mykt slettede avvik står i sporet som «fjernet». Slettet sak gir 404.
   - Hver rad viser TG nå, TG i utgitt rapport hvis ulik, og merket «Endret fra forslag» (for eksempel «TG3 foreslått, satt TG2») når forslaget er endret eller avvist. Disse sorteres øverst (ux 4, forbedreren 3).
   - Søkefelt som filtrerer på rom og kontrollpunkt (forbedreren 3).
   - «Kan gjelde reklamasjonen» (forbedreren 3): serveren sammenligner ord i `claims.building_part_text` med navn på romtype, rom og kontrollpunkt, og forhåndsmarkerer treffene. Ren tekstsammenligning i `src/core/claims` (som eier teksten), uten KI. Teksten sendes ikke til klienten i dette svaret, logges ikke og går aldri til KI; bare id-ene for treffene kommer ut.
   - Veien `claim` krever `claims.read` (lese spor) i `src/core/access`, henter saken gjennom `getClaim` i `@/core/claims` med `grant.organizationId` og `deleted_at is null`, og sjekker at rapporten hører til sakens oppdrag. `reportId` og `checkpointResultId` fra klienten stoles aldri på alene; punkt fra annet oppdrag gir 404. `src/core/reports` leser ikke `claims`-tabellen selv. Admin kommer alltid inn (regel 11).
4. **KI-funksjonen `tg_explanation`** fra sporpanelet både på badet og i reklamasjonssaken, også etter publisering.
   - **Egen smal vei etter publisering** (arkitekt 1, sikkerhet 1, A599): `resolveAiTarget` får en egen gren bare for mål `checkpoint_result` / `tg_explanation` som godtar `draft`, `published` og `superseded`. Alle andre funksjoner er fortsatt låst etter publisering.
   - **Egen avgjørelsestjeneste** `decideTgExplanation` i `src/core/reports` (ikke `decideAiText`, som går gjennom `withRoomWrite`). Låser rapportraden med `FOR SHARE` uten krav om `draft`, så KI-låsen (samme rekkefølge som før). Binder loggraden til funksjonen `tg_explanation`, målet, rapporten og `grant.organizationId`, og kaller `recordDecisionIn` i samme transaksjon. En `usageId` fra en annen funksjon, rapport eller organisasjon gir nøytralt avslag, og ingenting endres (samme feilklasse som funnet i PR #234).
   - **Egne utkast** (sikkerhet 5, A598): panelet viser bare utkast med `employee_id = grant.employeeId`. Et nytt utkast avviser bare den samme ansattes åpne utkast på punktet, ikke andres. Da ser ikke takstmannen at leder har laget en forklaring fra en sak.
   - Tilstander på knappen (forbedreren 4): «Lag forklaring», «Laget [tid], ikke avgjort» (viser det åpne utkastet uten nytt kall til KI), «Brukt».
   - **«Kopier spor»** (forbedreren 4): legger sporet på utklippstavlen som ren tekst, én linje per hendelse med tid og rolle, uten navn. Begrunnelsesteksten bare for dem som får se den (teksten er alt filtrert i tjenesten). Virker også når KI er av og for kontor. Ingen logging (det er lesing).
   - Utkastet vises tydelig merket «KI-utkast» i panelet.
5. **Evalueringssett** `tg_explanation.cases.json`, minst 30 saker med fasit. `schema.ts` og `run.ts` utvides med egen saksform og egen eval-testfil i CI. Faglige saker (fagansvarlig 10):
   - fukt over grensen, `choose`, valgt TG2 (forslag «TG2 eller TG3», gjeldende TG2) og valgt TG3
   - fukt lik grensen (15,0 vekt-%), kantsak
   - `membrane_past_lifespan` godtatt TG2 (aldri «utslitt», «lekker», «ikke tett», «skadet»)
   - `membrane_before_2000` med sjiktets eget årstall, og med anslått byggeår
   - endret med «Alderen er kjent på annen måte», endret med «Målt på nytt»
   - hulltaking ikke utført, eier nektet → TGIU (aldri TG2, aldri «i orden»)
   - TG0 (`hole_no_elevated_moisture`) uansett alder (aldri «ny» eller «dokumentert»)
   - punkt med to avvik med ulik TG (punktet har den høyeste)
   - TGIU godtatt, så endret direkte til TG1
   - avvist forslag, avvik fjernet og forslag åpent igjen, flere målinger
   - utgitt TG2, nå TG3 (forklaringen sier tydelig at graden er endret etter utgivelsen)
   - HMS-avvik tilbys ikke
   - vaktsaker: feil TG i svaret, TG som ikke står i inndata, to ulike «gjeldende» grader, oppdiktet tall, gjetteord («antas», «trolig», «sannsynligvis», «muligens», «kan tyde på»), standardhenvisning (NS 3600, punkt, tabell, paragraf), skyld og ansvar («burde», «feil», «beklager»), nye årsaker eller tiltak, «utslitt» ved aldersregel, persondata i inndata (oppdiktede navn og `example.com`) som skal vaskes bort, og etikett som prøver å gi instruks til KI.
6. **Ledeteksten `tg_explanation.v1`** (egen formulering, merket «utkast, ikke godkjent av fagrådet»): bare gjengi kjeden; «Reglene foreslo …», «Takstmannen satte …» (forslaget er aldri takstmannens vurdering, KI aldri kilden); ingen vurdering av om graden er riktig, ingen ansvar eller skyld, ingen nye årsaker, konsekvenser eller tiltak; aldersregel: funksjonen er usikker på grunn av alder; før 2000: si om årstallet er sjiktets eget eller byggeåret, og om det er anslått; TGIU: «ikke undersøkt»; TG0: «hull tatt uten funn og fukt målt under grensen i treverk»; målinger med enhet og materiale; grensen nevnes bare som «på eller over grensen for treverk» (A597); én gjeldende grad, lik sporet; er graden endret etter utgivelsen, sies det.
7. **Dokumenter:** tillegg i ADR 0006 (ny funksjon, serverinndata, publisert rapport tillatt for denne funksjonen, egen avgjørelsestjeneste, TG-vaktens gren) og ADR 0013 (sporet er avledet lesemodell). `docs/05-domenemodell.md` og ordlisten: `tg_trail`, `tg_explanation`, `decideTgExplanation`. Tilgangstabellen i `docs/02-roller-og-tilgang.md`.

**Ikke med (bevisst utelatt):**

- Ingen nye tabeller, kolonner, indekser eller migrering. `audit_log_entity_idx (entity_type, entity_id)` dekker oppslaget.
- Ingen ny vaktkode (A596).
- Den endelige forklaringen lagres ikke i reklamasjonen eller rapporten (A590, spørsmål 124).
- Kobling mellom reklamasjon og kontrollpunkt («Gjelder dette punktet») lagres ikke her; det er eget planpunkt fra forbedreren. Her vises bare forhåndsmarkering.
- Ikke spor for vanlige feltsvar uten regelforslag, avvik eller TG.
- Ikke spor i PDF-en eller i rapporten kunden ser.
- Ikke statistikk på tvers av rapporter eller per person.
- KI foreslår aldri ny TG, og vurderer ikke om graden er riktig.
- Ingen e-post eller sending av forklaringen.

## Tilgang

All tilgang sjekkes i `src/core/access`. Spørringene filtrerer på `grant.organizationId` og `deleted_at is null` på rapport, oppdrag og rom (samme kjede som rommet).

| Rolle | Se sporet på badet | Se sporet fra reklamasjonssaken | Lage / avgjøre KI-utkast | Kopier spor | Se begrunnelsesteksten |
|---|---|---|---|---|---|
| takstmann | ja (`organization.read`) | nei, heller ikke med `access.inspectors_edit_all` eller enkeltrettigheten `claims.read` | på badet når `report.edit` (med `access.inspectors_edit_all`) | ja | som i dag |
| kontor | ja (`organization.read`) | nei | nei, knappen vises ikke | ja | nei (`canSeeOverrideReasons`) |
| leder | ja | ja (`claims.read`) | ja (`report.edit`; fra saken også `claims.read`) | ja | ja |
| admin | ja | ja | ja | ja | ja |

`expectTenantIsolation` for `getTgTrail`, `listClaimTgTrailCheckpoints`, `listEntityAuditEvents`, `tg_explanation` og `decideTgExplanation`.

## Data

Ingen nye tabeller eller kolonner. Leser `rule_suggestion_decisions`, `deviations`, `checkpoint_results`, `audit_log`, `report_releases`, `employee_roles`, `claims` (bare gjennom `src/core/claims`), `reports`. Ny KI-funksjonskode `tg_explanation` og feltkode `tg_explanation` på mål `checkpoint_result` (faste koder, regel 6). `ai_usage_log` har ingen CHECK på `feature` eller `target_ref`, så det krever ingen migrering.

## Skjermer

- **Badet (PC og iPad):** «Spor» med kortversjon på avvikskort og forslagskort. 1 trykk for å se sporet (i dag: ikke mulig), omtrent 15 s per punkt før publisering. «Lag forklaring» → «Kopier» eller «Forkast»: 2 trykk.
- **Reklamasjonssak (PC og iPad, leder og admin):** delen «Hvorfor fikk punktene graden?» med søk, «Endret fra forslag» og «Kan gjelde reklamasjonen» øverst. Spor, Lag forklaring, Kopier: 3 trykk, omtrent 1–2 min per punkt (i dag 10–30 min med venting på takstmannen).

## Regler

Ingen nye regler, grenser eller TG-vilkår. Teksten for hver linje i sporet ligger i `logic/labels.ts` (egne formuleringer). Ledeteksten er egen formulering uten gjetteord og uten henvisning til standarder, merket «utkast, ikke godkjent av fagrådet». Fuktgrensen og alderstabellen er fortsatt utkast (F3).

## Akseptkriterier

- [ ] Sporet viser forslag (uten tid), beslutning, TG-bytte med grunn, TG satt direkte, fjernet og gjenopprettet avvik, utgivelser og «Forslaget er åpent igjen» i riktig rekkefølge (eldst øverst, lik tid sortert på id, norsk tid), med rolle etter A593 og uten navn (enhetstest TS-U1–U6 og integrasjonstest TS-I1 mot ekte rader etter kjeden fra #239).
- [ ] Forslagslinjen for fukt sier «TG2 eller TG3» og «vekt-% i treverk»; endret terskel eller alderstabell etter beslutningen endrer ikke sporet (test).
- [ ] Tekstendringer i revisjonsloggen (avvikstekst, årsak, konsekvens, fraseforslag) kommer aldri ut av tjenesten (test med merke i `audit_log.changes`).
- [ ] «TG i utgitt rapport» og «TG nå» vises når de er ulike, og linjer etter utgivelse er merket (test).
- [ ] Begrunnelsesteksten er ikke i svaret fra serveren for kontor; etiketten vises; kode tom gir «Grunn oppgitt» (test).
- [ ] Kortversjonen på Spor-knappen gir ingen ekstra spørring eller serverhandling når rommet åpnes, og rommets første lasting leser ikke `audit_log` for sporet (test og e2e med `countServerActions`).
- [ ] Takstmann og kontor får verken delen eller sporet fra reklamasjonssaken, også med `access.inspectors_edit_all` på og med `claims.read` gitt som enkeltrettighet; punkt fra annet oppdrag gir 404; slettet sak gir 404 (test og e2e).
- [ ] Reklamasjonslisten sorterer «Endret fra forslag» øverst, filtrerer med søk, og forhåndsmarkerer treff fra `building_part_text` uten at teksten sendes til klienten, logges eller går til KI (test).
- [ ] Bruker i annen organisasjon får ikke tilgang til sporet, listen, revisjonsoppslaget, KI-funksjonen eller avgjørelsen (`expectTenantIsolation`).
- [ ] KI-utkastet kan godtas («Kopier» urørt), endres («Kopier» rettet) og avvises («Forkast») gjennom `decideTgExplanation`, én rad i `ai_usage_log` med riktig mål; lukking uten valg logger ingenting; `usageId` fra annen funksjon, rapport eller organisasjon avvises nøytralt (test mot falsk leverandør).
- [ ] Forklaringen virker etter publisering; `language_polish`, `phrase_suggest` og `summary_draft` er fortsatt låst etter publisering (test).
- [ ] Et åpent forklaringsutkast gir verken `ai_suggestion_pending` eller stopper publisering (test).
- [ ] Panelet viser bare egne utkast; leders utkast fra saken er usynlig for takstmannen på badet (test).
- [ ] Ingenting av navn, e-post, telefon, adresse, matrikkel, romnavn, tider, `override_reason`, avvikstekst eller reklamasjonens tre fritekster går til KI (no-leak-test med merker som ikke kan stå i id eller tidsstempel).
- [ ] TG-vakten (ny gren) og tallvakten stopper feil TG og oppdiktede tall (test i `guard-cases.ts`), og `pnpm ai:eval tg_explanation` består med minst 30 saker og 0.9.
- [ ] Ingen endring i rapporten, TG, `row_version` eller `updated_at` når forklaringen lages eller avgjøres (test).
- [ ] Kontor ser ikke «Lag forklaring»; KI av gir tydelig melding og ingen loggrad (test og e2e).
- [ ] Virker på PC og iPad-størrelse: tastatur, Esc og fokus tilbake, 44/56 pt, uten nett-melding som laster selv, axe uten brudd (e2e TS-E1–E7).
- [ ] Versjon 0.19.8, ADR-tilleggene, domenemodell, ordliste og tilgangstabell oppdatert, A590–A599 ført i `docs/09-apne-sporsmal.md`, gjennomgang av sikkerhet-personvern på `NEVER_FIELDS` i PR-en.

## Testplan (fra test-leder, med tilleggene over)

- Enhet, sammensetting: TS-U1 rekkefølge med lik tid; TS-U2 åpent forslag bare når `isEffectiveDecision` er usann; TS-U3 begrunnelsestekst; TS-U4 rolle og «Reglene»; TS-U5 tekstfelt filtreres; TS-U6 `tg_direct` for TG0, TG1, TGIU; pluss utgivelseslinjer, kortversjonen på knappen og tolkingen av `reasons`.
- Enhet, KI: TE-U1 inndata fra tillatt-listen; TE-U2 TG-vakt; TE-U3 tallvakt; TE-U4 gjetteord i evalueringen; TE-U5 persondatavask.
- Integrasjon: TS-I1–I8 og TE-I1–I7 som i forhåndsvurderingen, med `decideTgExplanation` i stedet for `decideAiText`.
- E2e: TS-E1–E7, pluss «Kopier spor» og sortering og søk i reklamasjonssaken.

## Lagt til av forbedreren

Ført i `docs/plan/forbedrerens-tillegg.md`.

1. **Utgivelsen i sporet** (i oppgaven): «Utgitt versjon N: TGx i rapporten», «TG i utgitt rapport» ved siden av «TG nå», linjer «etter utgivelse», og `publishedTg` / `changedAfterRelease` i KI-inndata. Fjernes ved å ta utgivelseslinjene ut av `logic/tg-trail.ts` og feltene ut av `AiTgTrailInput`.
2. **Kortversjonen på Spor-knappen** (i oppgaven). Fjernes ved å vise bare «Spor».
3. **Sortering, søk og «Kan gjelde reklamasjonen» i reklamasjonssaken** (i oppgaven). Fjernes ved å ta ut søkefeltet, sorteringen og tekstsammenligningen i `src/core/claims`.
4. **«Kopier spor» og tilstandene på «Lag forklaring»** (i oppgaven). Fjernes ved å ta ut knappen og vise bare «Lag forklaring».
5. **Koble reklamasjonen til kontrollpunktet** (nytt planpunkt i 2a-2 «Fra forbedreren», bygges i tur, ikke her).

## Avgjort ved uenighet (prosjektlederen)

- **Gjetteord: evaluering og ledetekst, ikke ny vaktkode.** Arkitekten anbefalte ny kode `wording_guard` med migrering 0040. Valgt bort fordi `overstyringer-leder` har 0039 i arbeid, og to brancher med migreringer i samme rekke gir dyre konflikter i migreringsjournalen; kortet lovet også ingen migrering. Gjetteord stoppes i dag på samme måte for `summary_draft` (kjøreren har listen). En egen vaktkode kan legges til senere med en liten migrering (A596, lett å endre).
- **Evalueringssettet: minst 30, ikke 12.** Regelen for KI-funksjoner er 30–50 saker med fasit (ki-ansvarlig); test-leders 12 var kortets gamle tall.
- **«Bruk» og «Kopier» slått sammen** (ux, ki-ansvarlig): teksten lagres ikke, så «Bruk» alene gav ingenting, og loggen blir sann.
- **KI-tilgang `report.edit`** (arkitekt, sikkerhet) heller enn en ny rettighet (ki-ansvarlig): gir kontor nei og leder ja uten ny regel. Kravet om redigerbar rapport løses av den smale veien etter publisering, ikke av rettigheten.
- **Grenseverdien sendes ikke til KI** (fagansvarlig 9): tallene er ukontrollerte utkast og kan havne i et svar til en klager (A597, spørsmål 125).

## Beslutninger tatt av agentene (autonom modus, føres i `docs/09-apne-sporsmal.md`)

- **A590 (lett å endre):** forklaringen lagres bare som utkast og status i `ai_usage_log`, ikke i reklamasjonen. Den rettede teksten sendes aldri til serveren. Et felt for «svar på reklamasjonen» er spørsmål 124.
- **A591 (lett å endre):** sporet viser rolle, ikke navn, på hver linje. Navnet finnes i revisjonsloggen for admin.
- **A592 (lett å endre):** sporet bygges på serveren og krever nett; badet virker ellers som før uten nett.
- **A593 (lett å endre):** rollen på linjene er den ansattes rolle i dag, ikke rollen da det skjedde (verken revisjonsloggen eller beslutningsloggen lagrer rolle). Ved flere roller: admin, leder, takstmann, kontor. Uten rolle: «Ansatt».
- **A594 (lett å endre):** forslagslinjen har ingen tid (forslaget lagres først ved beslutning); den vises rett før beslutningen. Rekkefølge eldst øverst, lik tid sortert på id, norsk tid.
- **A595 (lett å endre):** sporet viser utgivelsene fra `report_releases` med punktets TG fra snapshot, og «TG i utgitt rapport» ved siden av «TG nå» når de er ulike.
- **A596 (lett å endre):** gjetteord, standardhenvisninger og skyld prøves i evalueringssettet og ledeteksten, ikke med ny vaktkode; TG-vakten får egen gren for `tg_explanation` under `tg_guard`.
- **A597 (lett å endre):** fuktgrensen og årene i alderstabellen sendes ikke til KI og nevnes ikke i forklaringen før tallene er kontrollert; sporet viser dem internt (spørsmål 125).
- **A598 (lett å endre):** «Kopier» er godta eller endre, «Forkast» er avvis, lukking er ingen avgjørelse. Panelet viser bare egne utkast, og et nytt utkast avviser bare egne åpne utkast på punktet.
- **A599 (dyrt å endre):** `tg_explanation` er den eneste KI-funksjonen som kan brukes etter publisering, gjennom en egen gren i `resolveAiTarget` og egen avgjørelsestjeneste `decideTgExplanation`; tilgangen er `report.edit` (fra saken også `claims.read`).

## Åpne spørsmål (stopper ikke bygging)

- **124:** Skal reklamasjonssaken få et eget felt for svaret til klageren, der godtatt forklaring kan lagres? Feltet vil ha personopplysninger og må i så fall stå i `NEVER_FIELDS`.
- **125 (fag):** Skal forklaringen til en klager kunne nevne grenseverdier (fuktgrense, år i alderstabellen), eller bare målt verdi og alder?
- **126 (fag):** Skal forklaringen fra reklamasjonssaken alltid gjelde den utgitte versjonen, også når rapporten er rettet etterpå?
- **127 (fag):** Er lengde og tone (2–4 setninger, bare kjeden, ingen vurdering) riktig for svar på reklamasjon?
- **128 (personvern):** Sporet lar leder se hver beslutning takstmannen tok, med tid og rolle, i en reklamasjonssak. Hører med til spørsmål 90 og drøftingen av kontrolltiltak (arbeidsmiljøloven kap. 9). Til svar: bare rolle, ingen sammenstilling per person.
