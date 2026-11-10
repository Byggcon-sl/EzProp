# Funksjon: Forslagsmønsteret

- **Fase:** 2a-1 KI-grunnmuren
- **Modul:** kjerne (`src/core/ai`), felles visning (`src/shared/ui`), prøveside (`src/app/(ansatt)/prove/ki`)
- **Status:** klar til bygging (forhåndsvurdert av forenkler, ux, sikkerhet-personvern og test-leder 10.11.2026)
- **Branch:** `fase2a-forslagsmonster` fra `main` (bygger på PR #127, merget)
- **Støtter hovedmål:** De ansatte: ett og samme forslagskort overalt, så takstmannen lærer det én gang og har alltid siste ord. / KI i bunnen: mønsteret alle KI-funksjoner i 2a-2 og senere bruker, og «Ferdig når» for 2a-1 kan vises. / Reklamasjoner: sperren gjør at ingen KI-tekst kommer i en rapport uten at takstmannen har godkjent den.

## Problem
KI-modulen (PR #127) kan lage og logge forslag, men ingen kan se dem eller svare på dem. Uten én felles visning vil hver KI-funksjon i 2a-2 (frasebank, språkvask, sammendrag) lage sin egen, og takstmannen må lære flere måter. Uten sperren kan ikke-godkjent KI-tekst havne i en rapport.

## KI i bunnen
- **Hva KI gjør fra første dag:** prøvefunksjonen `language_polish` (språkvask av én setning) mot den falske leverandøren. Takstmannen skriver en setning, ber om forslag, og velger «Bruk», «Behold min tekst» eller «Nytt forslag», og kan angre.
- **Data for KI:** ingen nye tabeller. Forslag, kilde (funksjon, ledetekstversjon, leverandør) og status ligger i `ai_usage_log` fra PR #127. Hver statusendring står i `audit_log` (bare id og status, aldri tekst).
- **Alt gjennom `src/core/ai`:** siden kaller bare `requestSuggestion`, `recordDecision` og statusoppslaget via serverhandlinger. Ingen leverandør kalles direkte. KI setter aldri TG og publiserer aldri.

## Brukerhistorier
- Som **takstmann** vil jeg **se et KI-forslag ved siden av min egen tekst og velge bruk, behold eller nytt forslag** slik at **jeg sparer tid uten å miste kontrollen**.
- Som **takstmann** vil jeg **kunne angre et valg** slik at **et feiltrykk ikke blir stående**.
- Som **takstmann** vil jeg **se tydelig hvilken tekst som kom fra KI** slik at **jeg vet hva jeg har godkjent**.
- Som **takstmann** vil jeg **aldri miste min egen tekst** når KI feiler eller nettet faller.
- Som **leder** vil jeg **at en rapport ikke kan publiseres med KI-tekst som ikke er godkjent** slik at **vi får færre reklamasjoner**.

## Flyt på `/prove/ki`
```
skriv setning -> [Foreslå bedre språk] -> «KI jobber …» (knappen låst, eget felt kan fortsatt skrives i)
  -> kort: egen tekst | Forslag fra KI
     -> [Bruk]             -> teksten byttes, status «accepted» lest fra loggen, merket «Tekst fra KI, godkjent» -> [Angre]
     -> [Behold min tekst] -> status «rejected» lest fra loggen -> [Angre] eller [Nytt forslag]
     -> [Nytt forslag]     -> nytt kort; det gamle avvises bare hvis det nye ga et forslag (A164)
```
Antall trykk: fra skrevet setning til godtatt forslag to trykk (be om forslag, bruk). Angre ett trykk. I IVIT finnes ingen språkvask; alternativet er å skrive om selv eller kopiere til et annet verktøy (6–8 trykk, bytte av app og personvernrisiko).

## Omfang
**Med:**
1. **Felles forslagskort** (`src/shared/ui/ai-suggestion.tsx`):
   - Viser egen tekst og forslaget side om side på PC og iPad liggende, over hverandre på iPad stående, med merket «Forslag fra KI». Forslaget vises som ren tekst (escapet, A157).
   - Knapper: «Bruk» (hovedknapp, 56–72 pt), «Behold min tekst» og «Nytt forslag» (minst 44 pt). Alle knappene ligger synlig nederst i kortet. Ingen meny, ingen «mer»-knapp, ingen sveiping (prinsipp 6).
   - «Nytt forslag» vises når status er `suggested` eller `rejected`.
   - Etter «Bruk» eller «Behold min tekst»: «Angre» står synlig til neste handling (ikke en melding som forsvinner). Angre skjules når et nyere forslag finnes på samme mål (serveren avviser det, A162).
   - Hver knapp er låst mens et kall pågår, og hvert valg sendes bare én gang (to trykk gir aldri to rader eller to linjer i `audit_log`).
   - Tilstander med vanlige ord: «KI jobber …», «KI hadde ikke noe forslag. Teksten din er uendret.» (utfallet `no_match`, som kjernen allerede kan gi), «KI svarte ikke. Prøv igjen.», «KI er av.» og «Krever nett. Teksten din er lagret og kan skrives videre.» Når et nytt forslag gir `no_match` eller feil, står det gamle forslaget igjen (A164).
   - Komponenten vet ingenting om tilgang eller lagring. Den får tilstand og handlinger inn, og importerer aldri `@/core/access` eller `@/db`.
2. **Merket for KI-tekst** (`src/shared/ui/ai-text-mark.tsx`): bare et merke med fast tekst «Tekst fra KI, godkjent». Ingen varianter eller innstillinger. Vises bare når status `accepted` eller `edited` er lest fra serveren, aldri ut fra tilstand i nettleseren. Etter angre forsvinner merket. Samme merke skal brukes overalt der KI-tekst vises.
3. **Statusoppslaget** (`getSuggestionStatus(grant, usageId)` i `src/core/ai`), ny spørring:
   - Krever rettigheten til funksjonen på raden (`report.edit` for `language_polish`) via `@/core/access`. Filtrerer på `grant.organizationId` og `deleted_at is null`.
   - Returnerer bare status og utfall. Aldri `output_text`, `employee_id` eller `decided_by`.
   - Ett forslag per kall. Ingen liste, ingen telling (spørsmål 57).
   - Samme svar for «finnes ikke», «annen organisasjon», «slettet», ugyldig uuid og manglende rettighet.
   - Eget `expectTenantIsolation`.
4. **Prøvesiden `/prove/ki`:** ett tekstfelt, knappen «Foreslå bedre språk», forslagskortet og status lest tilbake fra loggen for dette ene forslaget («Logget: godtatt» / «Logget: avvist» / «Logget: forslag»).
   - Fast linje på siden: «Bruk oppdiktet tekst. Ikke skriv navn, adresse eller kundeopplysninger. Forslaget lagres i KI-loggen.»
   - Status for nett vises på siden (prinsipp 9). Uten nett er «Foreslå bedre språk» sperret med «Krever nett. Teksten din er lagret og kan skrives videre.» Faller nettet midt i et forslag, vises samme tekst. Egen tekst går aldri tapt og blir aldri overskrevet uten «Bruk».
   - Teksten i feltet holdes bare i nettleseren (ingen ny tabell). Forslaget fra KI lagres derimot i `ai_usage_log.output_text` som all KI-bruk (falsk leverandør gir tilbake det som ble skrevet).
   - Målet er `{ type: "ai_trial", id: <uuid per side>, fieldKey: "text" }`, lagt til i `allowedTargets` for `language_polish`. Krever `report.edit`.
   - **Bare med falsk leverandør (A166):** målet `ai_trial` godtas bare når organisasjonens leverandør er `fake`. Sjekken ligger i `src/core/ai` (ikke på siden). Ellers svarer kjernen «KI er av», uten rad og uten leverandørkall. Grunnen: siden sender fritekst uten vask, og «Vask før KI» er ikke bygget. Test.
   - I organisasjoner der KI er av, vises «KI er av».
5. **Serverhandlingene** for prøvesiden: aktør og organisasjon fra økten via `src/core/access` (som `employee-context.ts`), aldri fra skjemaet. Inndata valideres med Zod; `requestId` og mål-id må være uuid. Organisasjons-id fra klienten ignoreres. Feil til klienten er de faste meldingene. Loggeren får bare id og feilkode, aldri teksten.
6. **Publiseringssperren som tjeneste** (`checkAiTextApproved(grant, items)` i `src/core/ai`):
   - Krever `report.edit` via `@/core/access`.
   - Tar en liste `{ aiUsageId, target }` (tak: 500 elementer per kall, ellers avslag) og gjør ett oppslag for hele listen (ingen spørring per element).
   - Et element er godkjent bare hvis raden finnes i `grant.organizationId`, ikke er slettet, har `outcome = ok`, status `accepted` eller `edited`, målet står i `allowedTargets` for funksjonen på raden, **og** `target_ref` gjelder samme type, id og felt (ad-6). Id sammenlignes normalisert (små bokstaver, som `sameTarget` i `usage-log.ts`).
   - Svaret er de innsendte elementene som ikke er godkjent, hver med sin `target` (type, id, felt), slik at publiseringen i 2a-2 kan si «2 tekster fra KI er ikke godkjent» og gå rett til feltet. Ingen grunn som skiller «finnes ikke», «annen organisasjon» og «slettet». Ugyldig uuid gir «ikke godkjent», ikke unntak. Tom liste gir tom liste.
   - Leser aldri `output_text`.
   - Står i kortet og i koden: **tjenesten sjekker bare det den får.** Når publisering bygges (2a-2), hentes listen fra serverens data, aldri fra klienten.
7. **Småfunn fra PR #127:**
   - **`recordDecision`, rekkefølgen:** rettigheten står på raden, så den kan ikke sjekkes helt før lesing. Derfor: (1) før noe leses, må `grant` ha rettigheten til minst én KI-funksjon, ellers `AccessDeniedError`; (2) etter lesing gir manglende rettighet for akkurat denne funksjonen `AiRequestRejectedError`, samme feil og melding som «finnes ikke», «annen organisasjon» og «slettet». Ved avslag endres verken raden eller `audit_log`. Admin stenges ikke ute. Lik responstid kreves ikke (kan ikke testes stabilt).
   - **`ensureSampleAi`** (`src/db/seed/sample-assignments.ts`): sjekken av `settings.sampleData` ligger i samme spørring som oppdateringen (`where`), og tilkoblingen lages heller ikke uten den. Kjøres to ganger gir samme resultat.
   - ad-6 løses i punkt 6.
8. Versjon 0.5.2 → 0.5.3 (etter fletting med main). Ordlisten i `docs/05-domenemodell.md` (forslagskort, KI-merke, statusoppslag, publiseringssperre for KI-tekst, `ai_trial`). Beslutninger A166–A168 i `docs/09-apne-sporsmal.md`. Én setning i spørsmål 57 om at prøvesiden også gir linjer i `audit_log` med hvem som avgjorde.

**Ikke med (bevisst utelatt):**
- **«Endre og bruk».** Planen sier «bruk, behold, nytt forslag» og angre. Statusen `edited` finnes allerede i kjernen og godtas av sperren og merket, så ingenting går tapt. Knappen legges til i 2a-2 når takstmannen redigerer en ekte avvikstekst.
- **Egen tilstand «Ingen treff» for frasebanken.** Kommer med frasebanken i 2a-2. Her vises bare én kort tekst for `no_match`, fordi kjernen kan gi det utfallet.
- Ingen `answers`-tabell, rapport eller publisering. Sperren kobles til publiseringen i 2a-2. Kontrollen av mål-id mot organisasjonen når `answers` bygges, står igjen til da.
- Ingen nye KI-funksjoner (frasebank, sammendrag, KI-sjekk før publisering). Bare `language_polish`.
- Ingen vask av persondata (neste punkt, «Vask før KI», med ad-1, ad-3, ad-4, ad-7). Derfor vakten i punkt 4.
- Ingen kø og ingen visning «venter på KI» uten nett (punktet «KI-kø»).
- Ingen liste eller telling av forslag per ansatt (spørsmål 57). Samlede tall (ad-8) kommer senere.
- Ingen ekte leverandør (S8). Ingen ny avhengighet. Ingen migrering.
- Ingen visning av sperren. Bare tjenesten med tester.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Prøvesiden og status for forslag i egen organisasjon | Be om forslag og avgjøre det (`report.edit`) |
| kontor | Bare hvis rollen har `report.edit` | Samme |
| leder | Som takstmann | Som takstmann |
| admin | Som takstmann | Som takstmann. Stenges aldri ute. |

Statusoppslag og `recordDecision` gjelder organisasjon + rettighet, ikke hvem som laget forslaget (regel 12, `access.inspectors_edit_all`, A162). Det bygges ikke noe eierskapsfilter. All tilgang sjekkes i `src/core/access`. Sperren og statusoppslaget filtrerer på `grant.organizationId`, aldri en id fra klienten.

## Data
Ingen nye tabeller eller migreringer. `tests/tenant-tables.ts` endres ikke. Ny fast kode: måltypen `ai_trial` (bare for prøvesiden). Testen 2.1 i `src/core/ai/features/features.test.ts` («ett lovlig mål») oppdateres bevisst til to mål. Når siden fjernes i 2a-2, arkiveres `ai_trial` (gjenbrukes ikke, regel 6).

## Skjermer
PC og iPad-størrelse, liggende og stående. `/prove/ki`: hovedhandling «Foreslå bedre språk». Forslagskortet følger designprinsippene (A «Fjord»): forslaget er tydelig skilt fra egen tekst, hovedknapp 56–72 pt, andre knapper minst 44 pt (pt, ikke px), nettstatus synlig.

## Regler
Ingen nye fagregler. Overgangene for status er A162 og A164 (PR #127) og endres ikke.

## Testdata for e2e
- Prøveorganisasjonen (seed, `sampleData`, `fake`, KI på).
- Utfallene lages med prøveverdiene `FAKE_NO_MATCH_INPUT` og `FAKE_ERROR_INPUT` fra `src/core/ai/providers/fake.ts`.
- «KI er av»: egen organisasjon laget i `e2e/helpers.ts` uten KI slått på.
- Alle tekster er oppdiktede, uten navn, adresse, e-post eller telefon.

## Akseptkriterier
- [ ] På `/prove/ki` i prøveorganisasjonen: skriv en setning, be om forslag, forslaget vises med merket «Forslag fra KI» (e2e mot falsk leverandør, PC og iPad).
- [ ] «Bruk» gir `accepted` og «Behold min tekst» gir `rejected`, og siden viser status lest fra loggen (e2e).
- [ ] «Angre» etter «Bruk» og etter «Behold min tekst» setter status tilbake til `suggested`, egen tekst kommer tilbake og KI-merket forsvinner (e2e).
- [ ] «Angre» er skjult når et nyere forslag finnes på samme mål (enhetstest).
- [ ] «Nytt forslag» lager en ny rad; det gamle avvises bare når det nye ga `ok` (A164, test).
- [ ] Merket «Tekst fra KI, godkjent» vises for `accepted` og `edited` lest fra serveren, ikke uten `ai_usage_id` (enhetstest).
- [ ] `no_match`, feil og «KI er av» vises med vanlige ord (enhetstest; feil og «KI er av» også e2e).
- [ ] Uten nett: «Foreslå bedre språk» viser «Krever nett …», ingenting henger, og egen tekst er uendret (e2e med nettet av).
- [ ] To raske trykk gir én rad og én linje i `audit_log` (test).
- [ ] Hovedknappen er minst 56 pt og de andre minst 44 pt (e2e).
- [ ] Forslagskortet og KI-merket importerer ikke `@/core/access` eller `@/db` (statisk sjekk).
- [ ] `ai_trial` godtas bare med `fake`; med annen leverandør svarer kjernen «KI er av» uten rad og uten kall (test). `ai_trial` med annet felt avvises; målet `answer` virker fortsatt (test).
- [ ] `getSuggestionStatus`: krever rettigheten, gir aldri `output_text`, `employee_id` eller `decided_by`, samme svar for finnes ikke / annen organisasjon / slettet / ugyldig id, `expectTenantIsolation` (test).
- [ ] `checkAiTextApproved`: `accepted` og `edited` godkjennes; `suggested`, `rejected`, `outcome` ulik `ok`, slettet rad, annen organisasjon, annet felt, annen id, annen type, mål som ikke står i `allowedTargets`, ugyldig uuid og ukjent id stoppes og kommer tilbake med `target` (ad-6). Tom liste gir tom liste; samme id to ganger og blandet liste gir riktig utvalg; over taket gir avslag; uten `report.edit` avslag. Leser aldri `output_text` (test). `expectTenantIsolation`.
- [ ] `recordDecision`: uten noen KI-rettighet `AccessDeniedError` før lesing; med KI-rettighet men ikke for funksjonen samme `AiRequestRejectedError` for rad som finnes, ikke finnes, annen organisasjon og slettet; raden og `audit_log` er uendret. Admin får alltid avgjøre (test).
- [ ] `ensureSampleAi` gjør ingenting (innstillinger og tilkobling) i en organisasjon uten `sampleData`, og to kall gir samme resultat (test).
- [ ] Serverhandlingene: organisasjons-id fra klienten ignoreres, ugyldig uuid avvises, uten `report.edit` avslag, takstmann/leder/admin lov, `audit_log` inneholder bare id og status (test).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjon 0.5.3.

## Avklaringer (utvikler, 10.11.2026)
- **A. `getSuggestionStatus(grant, usageId)`** gir `{ status, outcome } | null`. `null` er det ene nøytrale svaret for «finnes ikke», annen organisasjon, slettet, ugyldig uuid **og** manglende rettighet for funksjonen på raden. Statusoppslaget kaster ikke `AccessDeniedError`; serverhandlingene sjekker `report.edit` i `@/core/access` før kallet. Testplan 3.3 deles derfor ikke.
- **`checkAiTextApproved(grant, items)`** gir `{ aiUsageId, target }[]` (de som ikke er godkjent). Uten `report.edit`: `AccessDeniedError`, også for tom liste. Over `AI_APPROVAL_CHECK_MAX = 500`: `AiRequestRejectedError` uten spørring og uten delvis svar. `aiUsageId` og `target.id` sammenlignes med små bokstaver (testplan 4.15: begge godkjent).
- **Vakten for `ai_trial`** ligger i `requestSuggestion` rett etter valget av leverandør: er leverandøren ikke den falske, svarer kjernen `{ kind: "disabled" }` uten rad og uten kall.
- **`recordDecision`:** trinn 1 (rettighet til minst én KI-funksjon) kommer før validering av id, så kontor uten `report.edit` får `AccessDeniedError` også for ugyldig uuid.
- **`ensureSampleAi`** gir `skipped` i en organisasjon uten `sampleData` og lager da verken innstilling eller tilkobling.

## Beslutninger (autonom modus)
- **A166 (lett å endre):** Forslagsmønsteret prøves på en egen prøveside `/prove/ki` med måltypen `ai_trial`, fordi `answers` og rapporten ikke finnes ennå. `ai_trial` godtas bare når leverandøren er `fake`, sjekket i `src/core/ai`, fordi siden sender fritekst uten vask. Siden fjernes og `ai_trial` arkiveres når språkvask kommer på avviksteksten i 2a-2. Kilde: planen 2a-1 «Ferdig når», ADR 0006 del 4, sikkerhet-personvern 10.11.2026.
- **A167 (lett å endre):** Knappene heter «Bruk», «Behold min tekst», «Nytt forslag» og «Angre». «Behold» er avvisning. «Endre og bruk» venter til 2a-2. Kilde: planen («bruk, behold, nytt forslag» og angre).
- **A168 (lett å endre, tas i bruk i 2a-2):** Merket «Tekst fra KI, godkjent» blir stående når takstmannen senere redigerer en godtatt tekst for hånd, fordi takstmannen har godkjent teksten. Bygges ikke nå.

## Avgjort ved uenighet (prosjektleder)
- **«Endre og bruk»:** ux ville bygge den med ett-trykks redigering; forenkler ville kutte den. Kuttes. Planen nevner den ikke, `edited` finnes allerede i kjernen og godtas av sperren, og det ekte behovet kommer med avviksteksten i 2a-2. Uxs krav om at den ikke skal koste et ekstra trykk tas med da.
- **«Ingen treff»:** forenkler ville kutte tilstanden. Kjernen kan likevel gi `no_match` (for eksempel tom tekst), og kortet må ikke vise noe feil da. Derfor én kort tekst, testet med enhetstest, uten egen e2e. Den fulle «Ingen treff»-tilstanden for frasebanken kommer i 2a-2.
- **Én utvikler**, ikke to i parallell: arbeidet er lite og ligger på samme branch.

## Roller
utvikler (én), testskriver (parallelt, ut fra akseptkriteriene), ux (forslagskortet blir mønsteret for alt), sikkerhet-personvern (sperren, statusoppslaget, vakten for `ai_trial` og rekkefølgen i `recordDecision`).

## Åpne spørsmål
- Ingen som stopper. Endelig ordlyd på knappene kan prøves med de ansatte i betaen (S7).
