# Funksjon: Godtatt forslag og avvik henger alltid sammen (rett T-0113, T-0115, T-0116, T-0117)

- **Fase:** 2a-2 Hele veien først (retting av funn fra testlaget)
- **Modul:** kjerne / `src/core/reports` (regelforslag, avvik, advarsler) og badet på PC/iPad
- **Status:** utkast
- **Branch:** `rett-forslag-og-avvik` (bygger på main)
- **Støtter hovedmål:**
  - **Reklamasjoner:** et TG3-forhold kan ikke lenger falle stille ut av rapporten, og hver endring av TG fra et regelforslag har grunn i loggen. Det er det vi trenger for å forklare graden ved en reklamasjon.
  - **De ansatte:** «Å se over» viser bare ekte advarsler og kan bli tom. To vinduer (iPad og PC) gir ikke dobbelt arbeid.
  - **KI i bunnen:** beslutningsloggen for regelforslag blir sann og komplett, og er dermed brukbar som grunnlag for KI senere.

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
- Det som lagres for KI: hver TG-endring på et avvik fra et regelforslag gir en ny rad `changed` i `rule_suggestion_decisions` med valgt TG, begrunnelseskode og eventuell tekst. Da får senere KI-funksjoner (KI-sjekk før publisering, læring av hvilke forslag som endres og hvorfor) en sann historikk. Begrunnelsesteksten lagres som i dag, men sendes aldri ut i loggen (bare koder, id-er og TG i revisjonsloggen).
- Ingenting går til KI i denne oppgaven, så `src/core/ai` berøres ikke.

## Brukerhistorier

- Som **takstmann** vil jeg måtte gi grunn når jeg endrer TG på et avvik som kom fra et forslag, slik at rapporten tåler en reklamasjon.
- Som **takstmann** vil jeg se forslaget igjen med knappene når jeg har fjernet avviket, slik at et TG3-forhold ikke forsvinner uten at jeg har bestemt det.
- Som **takstmann** med badet åpent på iPad og PC vil jeg aldri få to avvik for samme forslag.
- Som **takstmann** vil jeg at advarselen forsvinner når forholdet er løst.

## Omfang

**Med:**

1. **Fjernet avvik gjør forslaget åpent igjen (T-0117).** En beslutning `accepted`/`changed` med `deviation_id` som peker på et mykt slettet avvik, regnes ikke som gjeldende. Forslaget vises da som åpent, med «Godta», «Endre» og «Avvis», i `room-view.ts` og `rule-suggestion-card.tsx`. Ingen ny rad når avviket fjernes; revisjonsloggen har slettingen. «Angre» (gjenopprett) gjør beslutningen gjeldende igjen. Ett sted i `src/core/reports/logic/` avgjør «gjeldende beslutning», og det brukes av skjermen, advarslene og `decideSuggestion`.
2. **Åpent forslag på ferdig punkt varsles.** Står et forslag åpent (utløst regel uten gjeldende beslutning) når punktet er merket ferdig, gir det en advarsel i «Å se over» med knapp til punktet, slik at TG3 ikke faller stille ut. Bruk eksisterende `checkpoint_done_without_tg` der den dekker tilfellet; ny kode bare hvis den ikke gjør det (se A491).
3. **Advarselen om foreldet forslag (T-0115).** `suggestion_no_longer_applies` gjelder bare gjeldende beslutninger: for utfallsforslag bare når avviket står; for TG0/TGIU bare når punktets TG fortsatt er det som ble valgt. Egen tekst når forslaget ikke ga avvik (TG0 og TGIU). Advarselen forsvinner når forholdet er løst.
4. **Ett avvik per forslag, også med to faner (T-0116).** I `decideSuggestion` hentes siste gjeldende beslutning for alle tre valg (Godta, Endre, Avvis) og alle forslagstyper. Finnes en gjeldende beslutning, svarer serveren `already_decided` med ny visning, og lager ingenting. Samme beslutnings-id to ganger gir fortsatt samme svar (som i dag). For å tåle to samtidige kall låses punktets `checkpoint_results`-rad (`FOR UPDATE`) før siste beslutning leses. Skjermen viser «Forslaget er alt avgjort i et annet vindu» og oppdaterer kortet.
5. **TG-bytte etter «Godta» krever grunn (T-0113).** Når TG byttes (`saveDeviationField`, feltet `tg`) på et avvik med `suggested_by_rule_id` og en gjeldende beslutning på det avviket: serveren krever begrunnelse etter samme regel som «Endre» (`CheckOverrideReason`, koder fra A380), og lagrer en ny rad `changed` med samme avvik, ny TG og grunnen, i samme transaksjon. Uten grunn: feilen `override_reason`, ingenting lagres. Skjermen åpner samme valg av begrunnelse som «Endre». Byttes TG tilbake til forslagets TG, lagres en ny rad `accepted` uten grunn (A490). Kortet viser «Endret: TG2 (grunn)» etter siste rad.
6. Funnfilene T-0113, T-0115, T-0116 og T-0117 settes til status «rettet» med PR-nummer, `forsok: 1`, og en linje i loggen.
7. Tester: rene tester for «gjeldende beslutning» og advarslene, integrasjonstester mot databasen (inkludert to samtidige kall og tenant-isolasjon for endrede spørringer), e2e på PC og iPad-størrelse for T-0117 og T-0113.
8. Beslutninger A490–A493 i `docs/09-apne-sporsmal.md`. Ordlisten oppdateres med «gjeldende beslutning» (`effective decision`). ADR 0013 punkt 9 får én setning om at en beslutning uten levende avvik ikke er gjeldende. Versjonsnummer (patch).

**Ikke med (bevisst utelatt):**

- Ny beslutningsverdi (for eksempel `withdrawn`) eller endret CHECK i `rule_suggestion_decisions`. Ingen migrering.
- Spørsmål 104 (b) til fagrådet: om TG-bytte *alltid* skal kreve grunn, også på avvik som ikke kom fra et forslag. Her gjelder kravet bare avvik fra forslag.
- Endring av hvilke regler som utløses, terskler eller fagtekster.
- Varsel i sanntid mellom faner (push). Den andre fanen får svaret når den prøver å lagre.
- Synkkøen uten nett utover at `already_decided` håndteres som et vanlig svar (ingen ny kø-logikk).
- Andre funn fra testlaget i samme område, med mindre de faller ut av samme endring.

## Tilgang

Uendret. Samme regler som badet i dag (`withRoomWrite`, `src/core/access`).

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja | ja (`access.inspectors_edit_all`) |
| kontor | som i dag | som i dag |
| leder | ja | ja |
| admin | ja | ja |

Endrede spørringer filtrerer på `grant.organizationId`, og får `expectTenantIsolation` i testfilen.

## Data

- Ingen nye tabeller eller kolonner. Ingen migrering.
- `rule_suggestion_decisions` får nye rader `changed`/`accepted` ved TG-bytte på avvik fra forslag.
- Ny svarstatus `already_decided` fra `decideSuggestion`.
- Ny avledet størrelse i `logic/`: gjeldende beslutning per regel og punkt (siste rad, og bare hvis avviket står, eller for TG0/TGIU hvis punktets TG fortsatt er den valgte).
- Eventuell ny advarselskode legges sist i `CHECKPOINT_WARNING_CODES` (fast kode, arkiveres aldri om).

## Skjermer

- **Forslagskortet (iPad og PC):** etter «Fjern avviket» vises forslaget åpent igjen med knappene. Etter TG-bytte vises «Endret: TG… (grunn)». Ved `already_decided`: kort melding og oppdatert kort.
- **Avvikskortet:** TG-valg på avvik fra forslag åpner begrunnelsen (ett trykk mer enn i dag, bare der det trengs).
- **«Å se over»:** foreldet-advarselen forsvinner når avviket er borte; åpent forslag på ferdig punkt varsles med knapp til punktet.

## Regler

Ingen nye fagregler. Logikken for gjeldende beslutning og advarslene er ren kode i `src/core/reports/logic/` som kjører både på iPad og server, med tabelltester (testsaker for hvert av de fire funnene).

## Akseptkriterier

- [ ] T-0117: godtatt TG3, «Fjern avviket», bytt punkt og tilbake: forslaget er åpent med knappene. «Angre» gjør det godtatt igjen. (integrasjon + e2e)
- [ ] T-0117: punkt merket ferdig med åpent TG3-forslag gir advarsel i «Å se over». (ren test + integrasjon)
- [ ] T-0115: etter «Fjern avvikene med TG og sett TGIU» står ingen «Forslaget gjelder ikke lenger». Godtatt TG0 uten avvik har egen tekst, og advarselen forsvinner når forholdet er løst. «Å se over» kan bli tom. (ren test)
- [ ] T-0116: Godta i fane A og Endre (og Avvis) i fane B gir ett avvik og `already_decided`. To samtidige kall gir ett avvik. (integrasjon)
- [ ] T-0113: TG-bytte på avvik fra godtatt forslag uten grunn avvises med `override_reason`; med grunn lagres ny rad `changed` med samme avvik. Skjermen viser «Endret». Bytte tilbake gir `accepted`. (integrasjon + e2e)
- [ ] TG-bytte på avvik som ikke kom fra et forslag, er uendret (ingen grunn kreves).
- [ ] KI setter aldri TG; ingen kall til `src/core/ai`.
- [ ] Bruker i annen organisasjon får ikke tilgang (test, `expectTenantIsolation` for endrede spørringer)
- [ ] Virker på iPad-størrelse (e2e)
- [ ] Revisjonsloggen har bare koder, id-er og TG, aldri begrunnelsesteksten.
- [ ] Funnfilene satt til «rettet» med PR-nummer.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` er grønne.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`)

Høyeste A-nummer på main er A430, på åpne brancher A489. Denne oppgaven bruker **A490–A493**.

| Nr | Hva | Hvorfor | Endres slik | Kost |
|---|---|---|---|---|
| A490 | TG-bytte på avvik fra forslag krever grunn og gir rad `changed`; bytte tilbake til forslagets TG gir `accepted` uten grunn. Bare avvik fra forslag (spørsmål 104 b står åpent). | ADR 0013 punkt 9 og A345: tabellen er eneste fasit. Reklamasjoner. | Fjern kravet i `saveDeviationField`. | lett å endre |
| A491 | Fjernet avvik gjør beslutningen ikke-gjeldende (avledet, ingen ny rad, ingen ny beslutningsverdi). Forslaget blir åpent igjen. | Tabellen får bare nye rader, CHECK står; «Angre» virker av seg selv. Enkleste som virker. | Ny beslutningsverdi krever migrering. | dyrt å endre |
| A492 | Åpent forslag på ferdig punkt varsles i «Å se over» (advarsel, aldri sperre, regel 12). | TG3 skal ikke falle stille ut (T-0117). | Ta bort advarselskoden. | lett å endre |
| A493 | Godta/Endre/Avvis når en gjeldende beslutning finnes, gir `already_decided`; punktets rad låses under beslutningen. | Ett avvik per forslag (testplan B4.31). | Endres i `decideSuggestion`. | lett å endre |

## Roller

- `arkitekt`: kort, fordi «gjeldende beslutning» blir felles regel for skjerm, advarsler og server, og låsing ved to samtidige kall.
- `utvikler` og `testskriver` i parallell. Biter som ikke henger sammen:
  1. Ren logikk i `logic/` (gjeldende beslutning, advarsler) + tester.
  2. `decideSuggestion` (`already_decided`, låsing) + integrasjonstester.
  3. `saveDeviationField` TG med grunn + avvikskortet + tester.
  4. Forslagskortet og «Å se over» + e2e.
- `ux`: lite, for begrunnelsen ved TG-bytte og meldingen `already_decided` (gjenbruk av «Endre»-dialogen).
- `domene`: kontroll av at TG3 ikke kan falle ut og at bytte-regelen er riktig mot ADR 0013 og forskriften.
- Ikke `ui` (ingen nye komponenter), ikke `sikkerhet` utover vanlig tenant-test (ingen ny tilgang).

## Åpne spørsmål

- Spørsmål 104 (b) til fagrådet: skal TG-bytte alltid kreve grunn, også på avvik som ikke kom fra et forslag? Står åpent; ikke med her.
