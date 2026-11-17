# Funksjon: KI i veien (fraseforslag, språkvask og utkast til sammendrag på badet)

- **Fase:** 2a-2 Hele veien først, punktet «KI i veien»
- **Modul:** kjerne (`src/core/ai`: tre funksjoner, kandidater, TG-vakt på svaret; `src/core/reports`: kandidatene fra malen, funnene til sammendraget, lagring av sammendraget), skjerm under `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/`, felles forslagskort `src/shared/ui/ai-suggestion.tsx`
- **Branch:** `ki-i-veien` (bygger på `main`, etter PR #224 «Badet på PC»)
- **Status:** utkast (prosjektlederen 17.11.2026), til forhåndsvurdering
- **Dato:** 17.11.2026
- **Støtter hovedmål:**
  - **KI i bunnen (hovedsaken):** de tre første ekte KI-funksjonene i rapporten, alle gjennom KI-grunnmuren (`src/core/ai`) med vask, forslag, beslutning og logg. KI forbereder teksten, takstmannen kontrollerer og godkjenner.
  - **De ansatte:** takstmannen slipper å lete i tekster og skrive om notater. Ett trykk gir de beste tekstene for avviket, ett trykk gir et språkvasket utkast, ett trykk gir et utkast til sammendrag.
  - **Færre reklamasjoner:** like, godkjente formuleringer i stedet for fritekst, sammendrag som starter med det alvorligste, og en vakt i kjernen som stopper KI-svar som legger til eller endrer TG.

## Problem
Badet kan fylles ut på PC (PR #224), men alle tekster skrives eller rettes for hånd. Takstmannen må selv finne riktig standardtekst, rette språket i egne notater og skrive sammendraget fra bunnen. Det tar tid og gir ulike formuleringer, som er en kjent kilde til reklamasjoner. KI-grunnmuren (2a-1) står klar, men brukes bare av prøvesiden. Lar vi være, har «hele veien» ingen KI, og vi vet ikke om grunnmuren holder i ekte bruk før bredden.

## KI i bunnen
- **Hva KI gjør fra første dag:**
  1. **Forslag fra frasebanken** (`phrase_suggest`, ny funksjon): takstmannen trykker «Forslag» ved et tekstfelt i avvikskortet (avvik, årsak, konsekvens, tiltak). Kjernen henter kandidatene selv (se A423), sender dem vasket som `candidates` sammen med det takstmannen har skrevet og avvikets faste koder, og KI svarer med **id-ene** til de 3–5 beste, i rekkefølge. En id som ikke var blant kandidatene, forkastes (ADR 0006 del 8). Passer ingen: «Ingen treff». KI skriver aldri ny tekst her.
  2. **Språkvask** (`language_polish`, finnes): på tekstfeltene i avvikskortet og beskrivelsen på punktet. Før og etter side om side i forslagskortet (`AiSuggestion`). Målene er de faste kodene fra A350/A356 (`deviation` / `deviation_text`, `cause_text`, `consequence_text`; `deviation_measure` / `text`; `checkpoint_result` / `description_text`).
  3. **Utkast til sammendrag** (`summary_draft`, ny funksjon): laget fra rapportens godkjente funn (A425), sortert etter alvor (TG3, TG2, TGIU), med kontrollpunktets navn, TG og de godkjente tekstene. KI skriver et kort utkast; takstmannen godtar, endrer eller avviser.
- **Alt gjennom `src/core/ai`:** `requestSuggestion` med tillatt-liste per funksjon, vask før KI (persondatafilteret fra «Vask før KI»), oppdraget slås opp av kjernen fra `target`/`reportId` i `grant.organizationId` (ADR 0006 del 3, «gjøres når answers finnes i 2a-2»), forslagsmønsteret (bruk / behold min tekst / nytt forslag / angre) og logg i `ai_usage_log` med `report_id` og `target_ref`. Ingen tekst i loggen utenom `output_text` slik ADR 0006 sier.
- **TG-vakt i kjernen (T-0046):** hvert svar fra KI kontrolleres i `requestSuggestion` før det vises: nevner svaret en TG eller tilstandsgrad som ikke sto i det som ble sendt, eller endrer en TG, vises det ikke, og utfallet logges som avvist av vakten. `extractTgMentions` flyttes fra evalueringen til kjernen og brukes begge steder.
- **Tom tekst (T-0111):** tekst som er tom etter at mellomrom er tatt bort, avvises før kall og gir ingen rad i loggen.
- **Data som lagres for KI:** forslag og beslutning per felt i `ai_usage_log` (finnes). Fraseforslaget logger hvilke kandidat-id-er som ble vist og hvilken som ble valgt (bare id-er og antall i `input_summary`, aldri tekst). Sammendraget lagres i `reports.summary_text` (A424), slik at sjekken før publisering og PDF-en kan bruke det.
- **Falsk leverandør og evalueringssett:** den falske leverandøren får faste, forutsigbare svar for de to nye funksjonene (rangering etter ordlikhet, sammendrag satt sammen av funnene). Nye sett `phrase_suggest.cases.json` og `summary_draft.cases.json` (minst 20 hver, merket «utkast, ikke godkjent av fagrådet»), og `language_polish` får eksempler som krever at en skrivefeil faktisk rettes, vanskelige eksempler og linjen «resultat mot falsk leverandør viser ikke kvalitet» i utskriften (T-0047). `pnpm ai:eval phrase_suggest` og `pnpm ai:eval summary_draft` virker.
- **KI setter aldri TG, velger aldri utfall og publiserer eller sender aldri.** Ingen av de tre funksjonene har et TG-felt som mål (statisk test i `features.ts`).
- **Uten KI eller nett:** «Forslag» faller tilbake til tekstsøk over de samme kandidatene, uten KI og uten logg (A426). Språkvask og sammendrag viser en tydelig melding om at de trenger nett og KI, og feltet kan skrives som før.

## Brukerhistorier
- Som **takstmann** vil jeg **få de 3–5 beste godkjente tekstene for avviket jeg skriver** slik at **jeg bruker Byggcons formuleringer uten å lete**.
- Som **takstmann** vil jeg **få notatet mitt språkvasket og se før og etter side om side** slik at **jeg kan godta, rette eller avvise med ett trykk**.
- Som **takstmann** vil jeg **få et utkast til sammendrag laget fra funnene jeg har godkjent, med det alvorligste først** slik at **jeg bare retter, ikke skriver fra bunnen**.
- Som **takstmann** vil jeg **få tekstforslag også uten nett** slik at **jeg ikke står fast i et kjellerbad**.
- Som **leder** vil jeg **se i loggen hvilke tekster som kom fra KI og hva takstmannen gjorde med dem** slik at **vi kan forklare rapporten ved en reklamasjon**.

## Omfang
**Med:**
- `phrase_suggest` og `summary_draft` som nye funksjoner i `AI_FEATURES` (kode, rettighet `report.edit`, tillatt-liste med `fieldSources`, mål, ledetekst v1, krav til evalueringssettet). Gjennomgang av sikkerhet og personvern kreves (A175).
- Kandidater i `requestSuggestion` (vaskes som felt, id-er sjekkes mot kandidatlisten, øvre grense for antall og lengde i `limits.ts`).
- Kandidatkilden i `src/core/reports`: tekstene i rapportens låste malversjon for kontrollpunktet og tekstfeltet (utfallenes tekster og standardtiltak), med `text_status` (A423). Bygget bak én funksjon, slik at frasebanken (2a-3) kobles til uten å endre KI-delen.
- Språkvask på tekstfeltene i avvikskortet og beskrivelsen på punktet, med `AiTextMark` og angre. Måltypen `field_answer` tas i bruk i KI-testene (A404).
- Sammendraget: `reports.summary_text` (ny kolonne, migrering), egen seksjon på badskjermen med knappen «Lag utkast», lagring per felt som andre tekstfelt, revisjonslogg.
- TG-vakt på svaret i kjernen (T-0046), tom-tekst-vakt (T-0111), nytteeksempler i evalueringen (T-0047). Funnene settes til «rettet» med PR-nummeret.
- Prøvesiden `/prove/ki` fjernes og måltypen `ai_trial` arkiveres (står i koden at det skal skje her). T-0035 lukkes som foreldet.
- Den statiske testen «`src/core/reports` importerer ikke `src/core/ai`» fjernes med vilje (kommentaren sier «gjelder til KI i veien»). Den erstattes av en test som viser at TG-forslag fortsatt bare kommer fra regelmotoren.
- Uten-nett-reserven for fraseforslag: tekstsøk i nettleseren over kandidatene som allerede er lastet med badet (samme søk som A382, ingen ny avhengighet).
- Versjon i `package.json` (minor, 0.17.0), ordlisten, domenemodellen 4.5 og 4.12, ADR 0006 tillegg (kandidater i bruk, TG-vakt).

**Ikke med (bevisst utelatt):**
- Frasebanken som egen tabell (`phrases`, felles og mine, favoritter, mest brukt) og importen fra SharePoint: 2a-3.
- Oppsummering per bygningsdel: 2a-3. Her lages bare sammendraget for rapporten.
- KI-sjekk før publisering og publiseringssperren: egne punkter.
- «Skriv det du ser: KI finner utfallet» (A384): neste punkt fra forbedreren.
- Live diktat, tale og bilder til KI.
- KI-forslag i TGIU-feltene (`tgiu_detail`): de har egne fraser i fraseregisteret, som kommer med frasebanken i 2a-3.
- Språkvask og sammendrag uten nett (krever KI). Bare fraseforslag har reserve uten nett.
- Å slå på ekte KI-leverandør: Ståle gjør det etter bestått evalueringssett.
- Nye fagtekster i malen.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | forslag og sammendrag i rapporter i egen organisasjon | be om forslag, bruke, endre, avvise; skrive sammendrag (`report.edit`; alle takstmenn kan endre alt, `access.inspectors_edit_all`) |
| kontor | sammendraget | nei |
| leder | sammendraget og KI-loggen | som takstmann hvis rollen har `report.edit` |
| admin | alt | alt (stenges aldri ute, regel 11) |

Tilgangen sjekkes bare i `src/core/access` (`requireOrganizationAccess`). Spørringer filtrerer på `grant.organizationId`. Kandidater og funn hentes bare fra rapporten i egen organisasjon; en `reportId` eller kandidat-id fra en annen organisasjon gir «ikke funnet» (test med `expectTenantIsolation`). Reklamasjonssaker berøres ikke.

## Data
- **Ny kolonne:** `reports.summary_text` (tekst, tom tillatt), migrering som tåler eksisterende rader. Revisjonslogg ved endring.
- **Nye faste koder:** KI-funksjonene `phrase_suggest` og `summary_draft`; KI-målet `report` / `summary_text` (A427). Ledetekstene `phrase_suggest.v1` og `summary_draft.v1`.
- **Arkivert kode:** måltypen `ai_trial` (gjenbrukes aldri, regel 6).
- `ai_usage_log`: ingen nye kolonner. `input_summary` for `phrase_suggest` har antall kandidater og antall tegn; valgt kandidat-id står i beslutningen.
- Ingen nye tabeller. Domenemodellen 4.5 (rapporten), 4.12 (KI-loggen) og ordlisten (avsnitt 8) oppdateres.

## Skjermer
PC og iPad-størrelse, badskjermen (`rom/[roomId]`). Designet følger `docs/08-designprinsipper.md` og bruker forslagskortet og KI-merket som finnes.
- **Avvikskortet:** ved hvert tekstfelt to små knapper, «Forslag» og «Språkvask». «Forslag» åpner en liste med 3–5 tekster (utkast merket «utkast»), ett trykk setter teksten inn (angre finnes). «Ingen treff» når ingen passer. «Språkvask» viser forslagskortet med før og etter side om side. Før: lete i malen eller skrive selv. Etter: 2 trykk.
- **Beskrivelsen på punktet:** «Språkvask».
- **Sammendrag:** egen seksjon nederst på badskjermen med tekstfelt og «Lag utkast». Utkastet vises i forslagskortet; «Bruk» fyller feltet. Knappen er av med forklaring når det ikke finnes godkjente funn.
- Tastatur og skjermleser: knappene har tydelige navn, listen kan brukes med piltaster, forslag annonseres (`aria-live`).
- Feil: tydelige meldinger på norsk (ingen nett, KI ikke slått på, svaret ble stoppet av TG-vakten, for lang tekst).

## Regler
Ingen nye regler i regelmotoren. Faste krav som testes:
- KI-svar med ny eller endret TG vises aldri (testsaker i kjernen og i evalueringssettet).
- Kandidat-id som ikke ble sendt, forkastes.
- Sammendraget bruker bare godkjente funn, i rekkefølgen TG3, TG2, TGIU.

## Akseptkriterier
- [ ] «Forslag» på et avviksfelt viser 3–5 kandidater fra rapportens låste malversjon, rangert av KI (falsk leverandør), og «Ingen treff» når ingen passer.
- [ ] Uten nett eller med KI av gir «Forslag» treff fra tekstsøket, uten kall og uten rad i `ai_usage_log`.
- [ ] Språkvask på avvik, årsak, konsekvens, tiltak og beskrivelse viser før og etter side om side; bruk, behold, nytt forslag og angre virker og logges.
- [ ] «Lag utkast» gir et sammendrag laget bare av godkjente funn, sortert TG3, TG2, TGIU, og det lagres i `reports.summary_text` når takstmannen godtar.
- [ ] Navn, e-post, telefon, adresse og matrikkel når aldri leverandøren, også ikke i kandidater eller funn (test med oppdiktede verdier).
- [ ] KI-svar som legger til eller endrer TG, vises ikke (T-0046). Tekst med bare mellomrom gir ikke kall og ikke loggrad (T-0111).
- [ ] `pnpm ai:eval` for alle tre funksjonene består mot falsk leverandør, og utskriften sier at det ikke viser kvalitet (T-0047).
- [ ] Ingen av funksjonene har et TG-felt som mål (statisk test).
- [ ] Bruker i annen organisasjon får ikke kandidater, funn, sammendrag eller logg (test med `expectTenantIsolation`).
- [ ] Prøvesiden `/prove/ki` finnes ikke lenger, og `ai_trial` godtas ikke som mål.
- [ ] Virker på iPad-størrelse og PC (e2e), og med tastatur og skjermleser.
- [ ] KI-forslag kan godtas, endres og avvises, og logges (test mot falsk leverandør).

## Avgjort av prosjektlederen (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A423 (lett å endre):** Frasebanken som tabell kommer i 2a-3. Til da er kandidatene tekstene i rapportens låste malversjon (utfallenes tekster og standardtiltak) for punktet og feltet. Alle er i dag «utkast, ikke godkjent av fagrådet»; de vises med merket «utkast», og bare `approved` regnes som godkjent når fagrådet har godkjent dem. Når frasebanken kommer, legges den til i samme kandidatkilde. Kilde: ADR 0006 del 8, planen 2a-3 «Fraser».
- **A424 (dyrt å endre):** Sammendraget lagres i `reports.summary_text` (domenemodellen 4.5 har feltet), ikke per rom. Sammendraget gjelder hele rapporten; i 2a-2 er det bare badet. Oppsummering per bygningsdel kommer i 2a-3 som eget felt. Kilde: domenemodellen 4.5, planen 2a-3.
- **A425 (lett å endre):** «Godkjente funn» er avvik der takstmannen har satt TG (godtatt eller endret regelforslag, eller lagt til selv), og punkter med TGIU. Avviste regelforslag og tomme punkter tas ikke med. Kilde: ADR 0013, forskriften (sammendrag av vesentlige avvik).
- **A426 (lett å endre):** Reserven uten KI er tekstsøket over de samme kandidatene, i nettleseren, uten logg. Kilde: A382.
- **A427 (dyrt å endre):** Ny fast KI-målkode `report` / `summary_text`. Kilde: A350 (faste koder for KI-mål).
- **A428 (lett å endre):** Prøvesiden `/prove/ki` fjernes nå, fordi språkvask finnes på ekte felt (Ståle 13.11.2026: ingen prøvesider som erstatning for ekte skjermer). T-0035 lukkes som foreldet.
- **A429 (lett å endre):** Testlagets funn T-0046, T-0047 og T-0111 (KI-kjernen og evalueringen, middels og lite) tas i denne oppgaven, fordi de gjelder samme område og må være på plass før ekte KI slås på.

## Roller
- **arkitekt:** kandidater i `requestSuggestion`, TG-vakten i kjernen, kandidatkilden bak én funksjon, migreringen, ADR 0006-tillegget.
- **ux:** plassering av «Forslag», «Språkvask» og sammendraget på badskjermen, uten-nett-oppførsel, tastatur og skjermleser. Bruker forslagskortet og KI-merket som finnes, så egen ui-rolle trengs ikke.
- **ki-ansvarlig:** ledetekstene, tillatt-listene, den falske leverandørens svar og evalueringssettene.
- **fag:** sorteringen og innholdet i sammendraget, hva som er «godkjente funn», eksemplene i evalueringssettene.
- **sikkerhet-personvern:** endringene i tillatt-listene (A175), vask av kandidater og funn, tenant-isolasjon.
- **utvikler** og **testskriver** i parallell, i to uavhengige biter: (1) kjernen (`src/core/ai`, kandidatkilden, sammendraget, migreringen, evalueringen); (2) skjermen (knapper, liste, forslagskort, sammendragsseksjon, uten-nett-reserve), som bygger på kjernens kontrakt.

## Åpne spørsmål
- Ingen som stopper oppgaven. Om fagrådet senere vil ha sammendraget delt i «må utbedres» og «bør undersøkes», endres ledeteksten (ny versjon).
