# Funksjon: Forslagsmønsteret

- **Fase:** 2a-1 KI-grunnmuren
- **Modul:** kjerne (`src/core/ai`), felles visning (`src/shared/ui`), prøveside (`src/app/(ansatt)/prove/ki`)
- **Status:** utkast
- **Branch:** `fase2a-forslagsmonster` fra `main` (bygger på PR #127, merget)
- **Støtter hovedmål:** De ansatte: ett og samme forslagskort overalt, så takstmannen lærer det én gang og har alltid siste ord. / KI i bunnen: mønsteret alle KI-funksjoner i 2a-2 og senere bruker, og «Ferdig når» for 2a-1 kan vises. / Reklamasjoner: sperren gjør at ingen KI-tekst kommer i en rapport uten at takstmannen har godkjent den.

## Problem
KI-modulen (PR #127) kan lage og logge forslag, men ingen kan se dem eller svare på dem. Uten én felles visning vil hver KI-funksjon i 2a-2 (frasebank, språkvask, sammendrag) lage sin egen, og takstmannen må lære flere måter. Uten sperren kan ikke-godkjent KI-tekst havne i en rapport.

## KI i bunnen
- **Hva KI gjør fra første dag:** prøvefunksjonen `language_polish` (språkvask av én setning) mot den falske leverandøren. Takstmannen skriver en setning, ber om forslag, og velger bruk, endre og bruk, behold egen tekst, nytt forslag, eller angre.
- **Data for KI:** ingen nye tabeller. Forslag, kilde (funksjon, ledetekstversjon, leverandør) og status ligger i `ai_usage_log` fra PR #127. Hver statusendring står i `audit_log` (bare id og status, aldri tekst).
- **Alt gjennom `src/core/ai`:** siden kaller bare `requestSuggestion` og `recordDecision` via en serverhandling. Ingen leverandør kalles direkte. KI setter aldri TG og publiserer aldri.

## Brukerhistorier
- Som **takstmann** vil jeg **se et KI-forslag ved siden av min egen tekst og velge bruk, behold eller nytt forslag** slik at **jeg sparer tid uten å miste kontrollen**.
- Som **takstmann** vil jeg **kunne angre et valg** slik at **et feiltrykk ikke blir stående**.
- Som **takstmann** vil jeg **se tydelig hvilken tekst som kom fra KI** slik at **jeg vet hva jeg har godkjent**.
- Som **leder** vil jeg **at en rapport ikke kan publiseres med KI-tekst som ikke er godkjent** slik at **vi får færre reklamasjoner**.

## Omfang
**Med:**
1. **Felles forslagskort** (`src/shared/ui/ai-suggestion.tsx`): viser forslaget ved siden av egen tekst, med merket «Forslag fra KI», og knappene «Bruk», «Endre og bruk», «Behold min tekst», «Nytt forslag». Etter et valg: «Angre». Viser «Ingen treff», «KI svarte ikke, prøv igjen» og «KI er av» med vanlige ord. Komponenten vet ingenting om tilgang eller lagring; den får tilstand og handlinger inn.
2. **Merket for KI-tekst** (`src/shared/ui/ai-text-mark.tsx`): et lite merke «Tekst fra KI, godkjent» på tekst som har `ai_usage_id`. Samme merke skal brukes overalt der KI-tekst vises.
3. **Prøvesiden `/prove/ki`:** ett tekstfelt, knappen «Foreslå bedre språk», forslagskortet, og etter valget status lest tilbake fra `ai_usage_log` for dette ene forslaget («Logget: godtatt»). Teksten holdes bare i nettleseren; ingen ny tabell. Målet er `{ type: "ai_trial", id: <uuid per side>, fieldKey: "text" }`, lagt til i `allowedTargets` for `language_polish`. Krever rettigheten `report.edit`. I organisasjoner der KI er av, vises «KI er av».
4. **Publiseringssperren som tjeneste** (`checkAiTextApproved` i `src/core/ai`): tar `grant` og en liste med `{ aiUsageId, target }` og svarer med de som ikke er godkjent. En `ai_usage_id` er godkjent bare hvis raden finnes i samme organisasjon (`grant.organizationId`), ikke er slettet, har status `accepted` eller `edited`, **og** `target_ref` gjelder samme type, id og felt (ad-6). Leser aldri `output_text`. Kobles til publisering når den bygges (2a-2).
5. **Småfunn fra PR #127:**
   - `recordDecision` sjekker rettigheten før raden leses (ingen forskjell i svar eller tid på «finnes ikke» og «ikke lov» som avslører rader).
   - `ensureSampleAi` sjekker selv at organisasjonen har `settings.sampleData`, og gjør ingenting ellers (med test).
   - ad-6 løses i punkt 4.
6. Versjon 0.5.0 → 0.5.1. Ordlisten i `docs/05-domenemodell.md` (forslagskort, KI-merke, publiseringssperre for KI-tekst, `ai_trial`). Beslutning A166 i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**
- Ingen `answers`-tabell, rapport eller publisering. Sperren kobles til publiseringen i 2a-2. Kontrollen av mål-id mot organisasjonen når `answers` bygges, står igjen til da.
- Ingen nye KI-funksjoner (frasebank, sammendrag, KI-sjekk før publisering). Bare `language_polish`.
- Ingen vask av persondata (neste punkt, «Vask før KI», med ad-1, ad-3, ad-4, ad-7).
- Ingen kø og ingen visning «venter på KI» uten nett (punktet «KI-kø»).
- Ingen liste eller telling av forslag per ansatt (spørsmål 57). Samlede tall (ad-8) kommer senere.
- Ingen ekte leverandør (S8). Ingen ny avhengighet.
- Prøvesiden lagrer ikke teksten.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Prøvesiden og egne forslag | Be om forslag og avgjøre det (`report.edit`) |
| kontor | Bare hvis rollen har `report.edit` | Samme |
| leder | Som takstmann | Som takstmann |
| admin | Som takstmann | Som takstmann. Stenges aldri ute. |

All tilgang sjekkes i `src/core/access`. Sperren og statusoppslaget filtrerer på `grant.organizationId`, aldri en id fra klienten.

## Data
Ingen nye tabeller eller migreringer. Ny fast kode: måltypen `ai_trial` (bare for prøvesiden). Ordlisten oppdateres.

## Skjermer
PC og iPad-størrelse. `/prove/ki`: hovedhandling «Foreslå bedre språk». Fra skrevet setning til godtatt forslag: to trykk (be om forslag, bruk). Angre: ett trykk. Forslagskortet følger designprinsippene (A «Fjord»): forslaget er tydelig skilt fra egen tekst, knapper minst 44 px.

## Regler
Ingen nye fagregler. Overgangene for status er A162 (PR #127) og endres ikke.

## Akseptkriterier
- [ ] På `/prove/ki` i prøveorganisasjonen: skriv en setning, be om forslag, forslaget vises med merket «Forslag fra KI» (e2e mot falsk leverandør).
- [ ] «Bruk» gir status `accepted`, «Endre og bruk» gir `edited`, «Behold min tekst» gir `rejected`, og siden viser status lest fra loggen (e2e).
- [ ] «Angre» etter bruk setter status tilbake til `suggested` og egen tekst tilbake (e2e).
- [ ] «Nytt forslag» lager en ny rad; det gamle avvises etter A164 (test).
- [ ] Godtatt tekst vises med merket «Tekst fra KI, godkjent».
- [ ] «Ingen treff», feil og «KI er av» vises med vanlige ord (enhetstest eller e2e).
- [ ] `checkAiTextApproved`: godtatt og endret godkjennes; `suggested`, `rejected`, slettet rad, annen organisasjon, annet felt, annen id og annen type stoppes (ad-6). Leser aldri `output_text` (test).
- [ ] `recordDecision` uten rettighet gir samme feil uansett om raden finnes (test).
- [ ] `ensureSampleAi` gjør ingenting i en organisasjon uten `sampleData` (test).
- [ ] Bruker i annen organisasjon får ikke tilgang til forslag, status eller sperre (`expectTenantIsolation`).
- [ ] Bruker uten `report.edit` får ikke bruke prøvesiden (test).
- [ ] Virker på iPad-størrelse (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.

## Beslutninger (autonom modus)
- **A166 (lett å endre):** Forslagsmønsteret prøves på en egen prøveside `/prove/ki` med måltypen `ai_trial`, fordi `answers` og rapporten ikke finnes ennå. Siden og måltypen fjernes (arkiveres) når språkvask kommer på avviksteksten i 2a-2. Kilde: planen 2a-1 «Ferdig når», ADR 0006 del 4.
- **A167 (lett å endre):** Knappene heter «Bruk», «Endre og bruk», «Behold min tekst», «Nytt forslag» og «Angre». «Behold» er avvisning. Kilde: planen («bruk, behold, nytt forslag» og angre), ADR 0006 del 4 (status `edited`).

## Roller
utvikler (to i parallell: kjerne og sperre / visning og prøveside), testskriver, ux (forslagskortet blir mønsteret for alt), sikkerhet-personvern (sperren og tilgangsrekkefølgen i `recordDecision`).

## Åpne spørsmål
- Ingen som stopper. Endelig ordlyd på knappene kan prøves med de ansatte i betaen (S7).
