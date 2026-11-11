# Funksjon: Rett funn T-0001 – én avvist endring stopper synkkøen

- **Fase:** 2a (retting fra testlaget, går foran nytt planpunkt)
- **Modul:** kjerne (`src/shared`, `src/core/ai`) / offline-trial
- **Status:** klar for bygging (runde 1 med forenkler, ki-ansvarlig og test-leder er tatt inn 11.11.2026)
- **Funn:** `docs/agenter/testlag/funn/T-0001-synkko-stopper-ved-avvist-endring.md` (feil, alvorlig)
- **Branch:** `rett-t0001-synkko` fra `main`
- **Støtter hovedmål:** De ansatte: takstmannen mister ikke arbeid fra iPaden fordi ett felt har et rart tegn, og ser hvilket felt det gjelder. / KI i bunnen: tekst med nulltegn gir ikke lenger feil i KI-forslaget, og loggen i `ai_usage_log` blir skrevet. / Reklamasjoner: svar som faktisk kommer fram til serveren, gir en rapport uten hull.

## Problem
Tekst kopiert fra PDF kan ha nulltegn (U+0000). PostgreSQL tar ikke imot det. Da svarer `POST /api/prove/synk/endringer` 500, og fordi bare 200 regnes som levert (`shouldAckBatch` i `src/modules/offline-trial/sync/local/outbox.ts`), blir alle endringer bak den liggende på iPaden for alltid. Takstmannen ser bare «Prøver igjen automatisk». Samme tegn gir feil i `/prove/ki` (innsettingen i `ai_usage_log`). Mønsteret skal også brukes i den ekte synken i fase 2b.

## KI i bunnen
KI gjør ikke noe nytt her, og vasken har ingen KI i seg. Rettingen reparerer grunnmuren: teksten som går til `requestSuggestion` (`src/core/ai`), og svaret fra leverandøren, vaskes før de lagres, så KI-forslag og `ai_usage_log` virker også for innlimt tekst. Ingen nye data, ingen ny datakrok, bare den falske leverandøren.

## Brukerhistorier
- Som **takstmann** vil jeg at endringene mine kommer fram selv om ett felt ikke kan lagres, slik at jeg ikke mister arbeid.
- Som **takstmann** vil jeg se hvilket felt som ikke ble sendt, slik at jeg kan skrive det om.

## Omfang
**Med:**
1. **Felles vask** `stripUnstorableChars` i `src/shared/lib/clean-text.ts`: fjerner U+0000 og ensomme surrogattegn (som `jsonb` avviser). Går gjennom tekst i objekter og lister, også nøkler i objekter. Tall, `true`/`false` og `null` røres ikke. Inndata endres ikke (ny verdi tilbake). Gyldige surrogatpar (emoji), linjeskift, tabulator, æøå og m² beholdes. Kodekommentar: «Bare tegn databasen ikke tar. Ikke personvernvask, erstatter ikke «Vask før KI».»
2. **Synken:** `applyTrialChanges` vasker `data` i hver operasjon før lagring, **unntatt** `id`, `trial_form_id`, `field_key` og `text_state` (koder og id-er skal aldri endres stille; feil i dem gir 400 som i punkt 4). For tekstfelt vaskes `value` **etter** `readText` av den flettede tilstanden. `text_state` (Yjs, base64) lagres urørt, så fletting (`mergeTextStates`) virker som før.
3. **KI-modulen:** `requestSuggestion` beholder rekkefølgen. Vasken gjøres på verdiene i `input.fields` etter trinn 1–3 (validering, rettighet, tillatt-liste) og før `buildPrompt` i trinn 7. Feltkodene (nøklene) vaskes ikke. Lengdene i `inputSummary` regnes av vasket tekst. `result.text` fra leverandøren vaskes før innsettingen i `ai_usage_log`. Tekst som er tom etter vask, gir samme avslag som tom tekst i dag (aldri 500).
4. **400 i stedet for 500:** feil i verdien fra databasen (SQLSTATE-klasse 22, og 23514) og `InvalidTrialChangeError` fra én operasjon gir 400 med `{ feil, endring: { id, table, field_key } }`. Andre databasefeil (brutt forbindelse, 23505 osv.) gir 500 som før. Svaret, loggen og `ai_usage_log` får aldri selve teksten; kroppen logges ikke. Hele bunten rulles tilbake i én transaksjon (som i dag).
5. **Klienten legger til side bare ved 400:**
   - 400 med `endring`: den endringen (alle køoppføringer med samme `table`+`id` i bunten) merkes som lagt til side, resten sendes med en gang.
   - 400 uten `endring` og bunt med én endring: den legges til side.
   - 400 uten `endring` og flere i bunten: behandles som 5xx (nytt forsøk som i dag). Ingen sending én og én.
   - 401, 403, 409, 413, 5xx og nettfeil: nytt forsøk som før. Ingenting legges til side.
6. **Lagt til side** = merket `setAside` på oppføringen som allerede ligger i køen (samme IndexedDB-lager, ikke eget lager). Slettes aldri. Blir liggende etter omlasting. Sendes ikke, teller ikke i ventetallet, og hindrer ikke at «Synk nå» (`syncNow`) regner køen som tømt. En ny endring i samme felt flettes ikke inn i den som er lagt til side, men blir en ny oppføring.
7. **Beskyttelse mot overskriving:** et felt med en endring som er lagt til side og ikke løst, er med i `pendingKeys`, så henting fra serveren ikke overskriver det takstmannen skrev. Når en senere endring på samme felt (samme `localRowKey`) er kvittert med 200, merkes den gamle som løst (`setAside.resolved`): den er da ute av `pendingKeys` og meldingen. Ingen annen opprydding.
8. **Synlig melding** i statuslinjen: «Kunne ikke sendes: <feltnavn>» med feltnavnet fra skjemaet. For `trial_photos`: «Kunne ikke sendes: bilde i <feltnavn>». For `trial_forms`: «Kunne ikke sendes: testskjemaet». Flere felt skilles med komma. Meldingen forsvinner først etter 200 på den nye endringen.
9. **Funnfilen:** status «rettet», `pr:` med PR-nummer, linje i loggen. Flyttes til `funn/lukket/` først når testlaget har bekreftet rettingen etter merge (slik testløkken er lagt opp, `docs/agenter/testlag/LES-MEG.md`). Oppgaveteksten sa «når merget»; testløkken gjelder.
10. Versjon i `package.json` økes (patch). Beslutningene A180 og A181 står i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**
- Den ekte synken i fase 2b (mønsteret noteres der, bygges ikke nå).
- Egen skjerm eller knapp for å se, prøve igjen eller kaste endringer som er lagt til side.
- Sending én og én for å finne en endring som feiler (vår egen server peker alltid på endringen).
- 409 og 413 som legger til side. 413 for store bilder er funn T-0006 og rettes for seg.
- Vask av annen tekst enn den som kommer inn via synken og KI-modulen.
- Vask i nettleseren før Yjs-tilstanden lages (nulltegnet kan bli liggende usynlig lokalt; serverens `value` er vasket).
- Endringer i «Vask før KI». A166 gjelder fortsatt: prøvemålet virker bare med den falske leverandøren.
- Nye tabeller, migreringer eller spørringer.

## Tilgang
Uendret. Tilgangen sjekkes fortsatt i `applyTrialChanges` og `requestSuggestion` før noe annet. Fremmed organisasjon gir 403, også med giftig innhold. Admin kan synke og ser meldingen.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som før | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
Ingen nye tabeller eller spørringer. Lokalt: valgfritt felt `setAside?: { at: string; resolved?: boolean }` på `OutboxEntry`. Ordlisten (`docs/05-domenemodell.md` avsnitt 8): `set aside` (lagt til side) og `unstorable characters` (tegn databasen ikke tar), siden begge blir navn i koden.

## Skjermer
`/prove/testskjema` (iPad og PC): statuslinjen viser «Kunne ikke sendes: Generell beskrivelse» i tillegg til ventetallet. Ingen nye trykk.

## Regler
Ingen fagregler.

## Akseptkriterier
- [ ] **Vask (enhet):** nulltegn og ensomme surrogater fjernes i tekst, nestet i objekter og lister og i objektnøkler. Emoji, linjeskift, tabulator, æøå og m² er uendret. Tall, `true`/`false` og `null` røres ikke. Inndata endres ikke. To vask gir samme resultat. Tekst med bare nulltegn blir tom tekst.
- [ ] **Synk (integrasjon):** bunt med nulltegn i «Generell beskrivelse» først, deretter byggeår og samlet kommentar, gir 200 og tre lagrede svar uten nulltegn. `text_state` kan fortsatt flettes med en ny tilstand (`mergeTextStates`).
- [ ] **Ingen evig løkke:** når svaret hentes tilbake til iPaden (`apply-incoming`), lages det ingen ny køoppføring.
- [ ] **400 (integrasjon):** et nytt bilde med `size_bytes` = 3 000 000 000 (for stort for `integer`, SQLSTATE 22003) gir 400 med `id`, `table` og `field_key`, ikke 500. Svaret har ikke teksten fra bunten, og loggeren får ikke kroppen (spy).
- [ ] **500 består:** en databasefeil utenfor klasse 22 og 23514 (enhetstest på oversettingen, for eksempel 23505 og feil uten SQLSTATE) gir 500.
- [ ] **Én transaksjon:** etter 400 er ingen av de gode endringene i bunten lagret; sendt på nytt uten den giftige blir alle lagret.
- [ ] **Kø (enhet):** giftig endring først, i midten og sist: 400 for den, de andre blir sendt og kvittert, den giftige er lagt til side og ikke slettet. Bunt med én endring og 400 uten `endring` legges til side. Flere i bunten og 400 uten `endring` gir nytt forsøk.
- [ ] **Kø (enhet):** 401, 403, 409, 413, 5xx og nettfeil gir nytt forsøk og legger ingenting til side.
- [ ] **Kø (enhet):** lagt til side overlever ny `createOutboxState` fra lagret kø (omlasting). Ventetallet teller den ikke. `syncNow` regner køen som tømt. Ny endring i samme felt blir ny oppføring. Feltet er i `pendingKeys` til en senere endring på samme felt er kvittert; da er den gamle løst og ute av `pendingKeys`.
- [ ] **Statuslinjen (test):** viser «Kunne ikke sendes: <feltnavn>» med navn fra skjemaet, riktig tekst for bilde og skjema, og meldingen forsvinner først etter 200 på den nye endringen.
- [ ] **KI (falsk leverandør):** tekst med nulltegn gir forslag og en rad i `ai_usage_log`. Svar fra leverandøren med nulltegn lagres vasket i loggen. Tekst som er tom etter vask, gir avslag, ikke 500. Feltkodene vaskes ikke.
- [ ] **KI uendret:** eksisterende tester i `src/core/ai` (no-leak, static-checks, access, record-decision, godtatt/endret/avvist) er grønne uten endring.
- [ ] **Tilgang:** bruker i annen organisasjon får 403 med giftig innhold, både i synken (`applyTrialChanges`) og i KI-ruten. Ingen ny spørring, så ingen ny `expectTenantIsolation` (sjekkes i gjennomgangen).
- [ ] **E2E (PC og iPad-størrelse, `e2e/fase-2a-rett-t0001-synkko.spec.ts`):** (a) lim inn tekst med nulltegn, synk, alle tre svarene kommer fram; (b) `page.route` gir 400 for én endring, statuslinjen viser «Kunne ikke sendes: Generell beskrivelse», de andre blir kvittert; (c) skriv uten nett, kom på nett, samme resultat som (a).
- [ ] Ingenting slettes, verken på serveren eller lokalt.
- [ ] Funnfilen T-0001 har status «rettet», PR-nummer og logglinje. Versjon økt.

## Beslutninger (autonom modus)
- **A180:** nulltegn og ensomme surrogater fjernes stille i stedet for å avvise feltet. Tegnet er usynlig og har ingen betydning for takstmannen; enkleste løsning som ikke mister arbeid. Lett å endre.
- **A181:** bare 400 legger en endring til side; den slettes aldri og meldes med feltnavn. Andre svar prøves på nytt som før. Lett å endre.

## Avgjort ved uenighet (prosjektleder, runde 1)
- **Sending én og én kuttes** (forenkler). Test-leder ba om tester for den; de faller bort. Begrunnelse: vår egen server peker alltid på endringen; 400 uten opplysning og flere i bunten prøves på nytt som før. Jeg beholder test-leders tilfelle «400 uten opplysning for én endring legges til side», fordi det er trygt og ikke krever ny tilstand.
- **Merke på køoppføringen, ikke eget lager** (forenkler). Test-leders krav om omlasting, ventetall, `syncNow` og ny oppføring for samme felt beholdes som tester, siden de gjelder like mye for et merke.
- **`pendingKeys`:** test-leder ba kortet avgjøre. Lagt til side og ikke løst beskytter feltet, så takstmannens tekst ikke overskrives av serveren. Merket `resolved` trengs for at beskyttelsen skal slippe; det er det eneste tillegget til forenklerens løsning.
- **Tenant:** ingen ny spørring, så 403-test er nok (forenkler og test-leder er enige).
- **Ordlisten:** `set aside` og `unstorable characters` blir navn i koden, så de føres inn.
- **Funnfilen lukkes etter bekreftelse fra testlaget**, ikke ved merge.

## Roller
utvikler (vask, server, kø, statuslinje), testskriver (tester over, i parallell). Ingen andre roller: ingen fag, ingen ny skjerm, ingen ny KI-funksjon.

## Åpne spørsmål
- Ingen.
