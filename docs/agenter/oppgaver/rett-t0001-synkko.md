# Funksjon: Rett funn T-0001 – én avvist endring stopper synkkøen

- **Fase:** 2a (retting fra testlaget, går foran nytt planpunkt)
- **Modul:** kjerne (`src/shared`, `src/core/ai`) / offline-trial
- **Status:** utkast
- **Funn:** `docs/agenter/testlag/funn/T-0001-synkko-stopper-ved-avvist-endring.md` (feil, alvorlig)
- **Branch:** `rett-t0001-synkko` fra `main`
- **Støtter hovedmål:** De ansatte: takstmannen mister ikke arbeid fra iPaden fordi ett felt har et rart tegn, og ser hvilket felt det gjelder. / KI i bunnen: tekst med nulltegn gir ikke lenger feil i KI-forslaget, og loggen i `ai_usage_log` blir skrevet. / Reklamasjoner: svar som faktisk kommer fram til serveren, gir en rapport uten hull.

## Problem
Tekst kopiert fra PDF kan ha nulltegn (U+0000). PostgreSQL tar ikke imot det. Da svarer `POST /api/prove/synk/endringer` 500, og fordi bare 200 regnes som levert (`shouldAckBatch` i `src/modules/offline-trial/sync/local/outbox.ts`), blir alle endringer bak den liggende på iPaden for alltid. Takstmannen ser bare «Prøver igjen automatisk». Samme tegn gir feil i `/prove/ki` (innsettingen i `ai_usage_log`). Mønsteret skal også brukes i den ekte synken i fase 2b.

## KI i bunnen
KI gjør ikke noe nytt her. Rettingen sørger for at teksten som går til KI-modulen (`requestSuggestion` i `src/core/ai`) og til loggen, er vasket på samme måte som teksten i synken, slik at KI-forslag og logg virker også for innlimt tekst. Ingen nye data lagres for KI. Alt går fortsatt gjennom `src/core/ai`.

## Brukerhistorier
- Som **takstmann** vil jeg at endringene mine kommer fram selv om ett felt ikke kan lagres, slik at jeg ikke mister arbeid.
- Som **takstmann** vil jeg se hvilket felt som ikke ble sendt, slik at jeg kan skrive det om.

## Omfang
**Med:**
1. **Felles vask av innkommende tekst** i `src/shared/lib/` (for eksempel `clean-text.ts`, `stripUnstorableChars`): fjerner U+0000 og ensomme surrogattegn (som `jsonb` avviser). Går også gjennom tekst inne i objekter og lister (`jsonb`-felt). Endrer ikke annen tekst (linjeskift, tabulator, æøå, m² beholdes).
2. **Synken:** `applyTrialChanges` (`src/modules/offline-trial/server/apply-changes.ts`) vasker tekstverdier før lagring.
3. **KI-modulen:** `requestSuggestion` (`src/core/ai/request-suggestion.ts`) vasker feltene før prompt, lengdesammendrag og innsetting i `ai_usage_log`.
4. **400 i stedet for 500:** en endring som likevel ikke kan lagres (databasen avviser verdien), gir 400 med hvilken endring det gjelder (`id`, `table`, feltnøkkel). Svaret gjentar aldri selve teksten, og kroppen logges ikke.
5. **Klienten legger til side:** ved 400 som peker på én endring, flyttes den til side lokalt (slettes ikke), resten sendes videre med en gang. Ved 400 uten slik opplysning og flere endringer i bunten, sendes de én og én for å finne den som feiler. 5xx og nettfeil gir fortsatt nytt forsøk som før.
6. **Synlig melding** i statuslinjen: «Kunne ikke sendes: <feltnavn>» med feltnavnet fra skjemaet (samme navn som takstmannen ser). Meldingen forsvinner når takstmannen endrer feltet og den nye endringen er sendt.
7. **Funnfilen:** status «rettet», `pr:` med PR-nummer, linje i loggen. Flyttes til lukket når testlaget har bekreftet etter merge.
8. Versjon i `package.json` økes (patch).

**Ikke med (bevisst utelatt):**
- Den ekte synken i fase 2b (mønsteret noteres der, bygges ikke nå).
- Egen skjerm eller knapp for å se, prøve igjen eller kaste endringer som er lagt til side.
- Vask av annen tekst enn den som kommer inn via synken og KI-modulen (andre skjemaer i appen tas når de berøres).
- Endringer i «Vask før KI» (egen PR); vasken her er bare for tegn databasen ikke tar, ikke personvernvask.
- Nye tabeller eller migreringer.

## Tilgang
Uendret. Tilgangen sjekkes fortsatt i `applyTrialChanges` og `requestSuggestion` før noe annet. Fremmed organisasjon gir fortsatt 403, også med giftig innhold.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | egne og andres prøveskjema (som før) | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
Ingen nye tabeller. Endringer som er lagt til side, lagres lokalt i IndexedDB (eget merke eller eget lager i køen), slettes ikke. Ordlisten: `unstorable characters`, `set aside` (lagt til side) føres i `docs/05-domenemodell.md` avsnitt 8 hvis nye navn tas i bruk.

## Skjermer
`/prove/testskjema` (iPad og PC): statuslinjen viser «Kunne ikke sendes: Generell beskrivelse» i tillegg til ventetallet. Ingen nye trykk.

## Regler
Ingen fagregler.

## Akseptkriterier
- [ ] Enhetstest for vaskefunksjonen: nulltegn og ensomme surrogater fjernes, i tekst og nestet i objekter og lister; vanlig tekst, linjeskift, æøå og m² er uendret.
- [ ] Integrasjonstest: bunt med nulltegn i «Generell beskrivelse» først, deretter byggeår og samlet kommentar, gir 200 og tre lagrede svar uten nulltegn.
- [ ] Integrasjonstest: en endring databasen avviser gir 400 som peker på endringen, ikke 500, og svaret inneholder ikke teksten.
- [ ] Enhetstest for køen: giftig endring først i køen, 400 for den, de andre blir sendt og kvittert; den giftige ligger til side og er ikke slettet.
- [ ] Enhetstest: 400 uten opplysning om endringen med flere i bunten gir sending én og én; 5xx og nettfeil gir nytt forsøk som før.
- [ ] Statuslinjen viser «Kunne ikke sendes: <feltnavn>» (test), og meldingen forsvinner når feltet er skrevet om og sendt.
- [ ] `requestSuggestion` med nulltegn i teksten gir forslag og skriver rad i `ai_usage_log` (test mot falsk leverandør).
- [ ] Bruker i annen organisasjon får 403 også med giftig innhold (test, `expectTenantIsolation` der spørringen er ny).
- [ ] Virker på iPad-størrelse (e2e: lim inn tekst med nulltegn, synk, se at svarene kommer fram).
- [ ] KI-forslag kan fortsatt godtas, endres og avvises, og logges (eksisterende tester grønne).
- [ ] Funnfilen T-0001 har status «rettet» og PR-nummer.

## Beslutninger (autonom modus)
- Nulltegn fjernes stille i stedet for å avvise hele feltet. Grunn: tegnet er usynlig og har ingen betydning for takstmannen; enkleste løsning som ikke mister arbeid. Lett å endre. Føres i `docs/09-apne-sporsmal.md` med neste ledige A-nummer.
- Endringer som er lagt til side, beholdes lokalt og slettes aldri automatisk. Lett å endre.

## Roller
utvikler (vask, server, kø, statuslinje), testskriver (tester over, i parallell). Ingen andre roller trengs: ingen fag, ingen ny skjerm, ingen ny KI-funksjon.

## Åpne spørsmål
- Ingen.
