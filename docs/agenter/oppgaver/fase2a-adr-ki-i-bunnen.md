# Funksjon: ADR 0006 – KI i bunnen

- **Fase:** 2a-1 KI-grunnmuren (første punkt)
- **Modul:** kjerne (`src/core/ai`, KI-porten i `src/core/integrations`). Bare dokumentasjon, ingen produktkode.
- **Status:** utkast
- **Branch:** `fase2a-adr-ki-i-bunnen` (bygger på `main`)
- **Støtter hovedmål:**
  - **KI i bunnen:** legger grunnmuren som alle KI-funksjoner bygges på. Én vei inn, samme forslagsmønster overalt, logg over nytten.
  - **De ansatte:** forslag vises likt overalt og kan alltid angres. Takstmannen kontrollerer og godkjenner, og har siste ord.
  - **Reklamasjoner:** KI setter aldri TG, og ingen KI-tekst kommer i en publisert rapport uten godkjenning. Evalueringssett hindrer at dårlig KI slås på.

## Problem
De neste punktene i 2a-1 (KI-modulen og loggen, forslagsmønsteret, vask, evalueringssett, kø) og alle KI-funksjoner i 2a-2 og senere må bygges likt. Uten en felles beslutning lager hver funksjon sin egen vei til KI, sin egen lagring av forslag og sin egen vask. Da blir personvernet vanskelig å kontrollere, nytten kan ikke måles, og det blir dyrt å bytte leverandør.

## KI i bunnen
- Oppgaven **er** KI-grunnmuren på papir. Ingen KI kjører i denne oppgaven.
- ADR-en bestemmer hvilke data som lagres for KI: forslaget med kilde (funksjon, leverandør, modell, versjon av ledetekst, hvilke felt som var grunnlaget), status og hva den ansatte gjorde. Det gjør at KI senere kan bruke godkjente tekster og avvisninger som læring (3a), og at nytten kan måles.
- Alt går gjennom `src/core/ai`. Ingen modul snakker med en leverandør direkte. Dette håndheves med lint-regel (bestemmes i ADR-en, bygges i neste punkt).

## Brukerhistorier
- Som **utvikler** vil jeg ha én beskrevet vei til KI, slik at hver ny KI-funksjon bygges på samme måte.
- Som **takstmann** vil jeg at alle KI-forslag ser like ut og kan godtas, endres, avvises og angres, slik at jeg aldri lurer på hva som er KI og hva som er mitt.
- Som **Ståle** vil jeg kunne bytte KI-leverandør uten at funksjonene må skrives om, og se hva KI koster og hvor mye den hjelper.

## Omfang
**Med:**
- `docs/adr/0006-ki-i-bunnen.md` med disse delene:
  1. **Modulen `src/core/ai`:** offentlig flate (én funksjon for å be om forslag, én for å registrere beslutning), mapper, og hvordan modulene kaller den.
  2. **KI-porten** i tilkoblingslaget (`ai` i `src/core/integrations/ports.ts`): leverandører som faste koder (`fake` først), valg av leverandør per organisasjon via `integration_connections`, nøkkel via `readSecret`. Hvordan leverandøren byttes uten endring i funksjonene.
  3. **Falsk leverandør:** forutsigbare svar, null kostnad, brukes i utvikling, test, CI og testmiljøet. Ekte leverandør bare etter S8.
  4. **Forslag:** hvor de lagres (egen tabell eller `ai_usage_log`, ADR-en velger det enkleste), kilde, status `suggested` / `accepted` / `edited` / `rejected`, angre, og hvordan KI-tekst merkes i svaret (`ai_usage_id` på `answers`, se 4.7).
  5. **`ai_usage_log`:** feltene fra 4.12, med det ADR-en legger til (for eksempel `organization_id`, `status`, versjon av ledetekst). Ingen rå inndata med persondata.
  6. **Vask før KI:** navn, e-post, telefon, adresse, matrikkel (gårds-, bruks-, seksjons-, andels- og aksjenummer) og fødselsnummer. Hvor vasken skjer (inne i `src/core/ai`, aldri i modulene), hva som erstatter dem, og at vasken har tester. Premisseteksten og andre fritekster vaskes også.
  7. **Hva KI aldri gjør:** setter TG, publiserer, sender e-post eller SMS. Sperren mot publisering med KI-tekst som ikke er godkjent.
  8. **KI velger fra det godkjente:** frasebanken først, «ingen treff» i stedet for oppdiktet tekst.
  9. **Evalueringssett:** hvor eksemplene ligger, format, fasit, kommando og treffgrense før en funksjon slås på.
  10. **KI-kø uten nett:** hvordan forespørsler legges i kø på iPaden og vises som «venter på KI», og hvordan den henger sammen med synken i ADR 0004.
  11. **KI av/på:** innstillingen i `settings` per organisasjon, og at alt virker uten KI.
- Oppdatere `docs/05-domenemodell.md` 4.12 (og 4.7 hvis merkingen endres) og ordlisten i avsnitt 8 der ADR-en krever det.
- Oppdatere `docs/06-arkitektur.md` punkt 11 med henvisning til ADR 0006.
- Beslutninger som agentene tar, føres i `docs/09-apne-sporsmal.md` fra **A136**, merket «lett å endre» eller «dyrt å endre».
- Krysse av punktet i `docs/07-utviklingsplan.md`, én linje i `docs/plan/endringslogg.md` hvis planteksten endres.
- Versjon i `package.json`: 0.4.1 → **0.4.2**.

**Ikke med (bevisst utelatt):**
- Ingen produktkode, ingen migrering, ingen tabeller, ingen lint-regel. Det kommer i «KI-modulen og loggen» og de neste punktene.
- Ikke valg av ekte KI-leverandør eller pris. Det er beslutningsnotatet (siste punkt i 2a-1) og S8.
- Ikke tale til tekst og bilde til tekst (fase 2b). ADR-en sier bare at de går gjennom samme modul.
- Ingen skjermer og ingen skisser av forslagsvisningen (forslagsmønsteret er eget punkt).
- Ingen innhold i evalueringssett, bare oppsettet.
- Ingen nye avhengigheter.

## Tilgang
ADR-en beskriver tilgangen, ingen kode nå:

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Egne og oppdragets forslag | Godta, endre, avvise egne forslag |
| kontor | Forslag på oppdrag de jobber med | Godta, endre, avvise egne forslag |
| leder | Samlet KI-bruk og kostnad | – |
| admin | Alt, KI av/på, leverandør i tilkoblingslaget | Innstilling og tilkobling |

All tilgang sjekkes i `src/core/access`. Spørringer i loggen filtrerer på `grant.organizationId`.

## Data
Bare i dokumentasjonen: `ai_usage_log` (4.12) får de feltene ADR-en bestemmer, og eventuelt en egen tabell for forslag. Faste koder som beskrives: leverandør `fake` på porten `ai`, status `suggested` / `accepted` / `edited` / `rejected`, funksjonen `language_polish` (prøvefunksjonen i «Ferdig når»).

## Skjermer
Ingen.

## Regler
Ingen nye fagregler. ADR-en slår fast at TG-forslag kommer fra regelmotoren, aldri fra KI.

## Akseptkriterier
- [ ] `docs/adr/0006-ki-i-bunnen.md` finnes, følger formen til ADR 0001–0005, og dekker alle elleve delene under «Med».
- [ ] ADR-en sier tydelig: KI setter aldri TG, publiserer aldri, sender aldri, og ingen funksjon kaller en leverandør utenfor `src/core/ai`.
- [ ] Listen over hva som aldri sendes til KI er konkret (felt for felt, med tabellene de ligger i) og sier at vasken testes.
- [ ] Bytte av leverandør er beskrevet steg for steg, og krever ingen endring i funksjonene.
- [ ] Forslagsstatusene og hvordan de lagres og logges stemmer mellom ADR-en, `docs/05-domenemodell.md` og `docs/06-arkitektur.md`.
- [ ] Ordlisten har de nye ordene (for eksempel forslag, falsk leverandør, vask, evalueringssett, KI-kø).
- [ ] Beslutningene står i `docs/09-apne-sporsmal.md` fra A136, med «lett å endre» eller «dyrt å endre».
- [ ] Ingen modellnavn, ingen kundeopplysninger, ingen tekst fra NS 3600, IVIT eller SmartTakst.
- [ ] Versjon 0.4.2. `pnpm lint`, `pnpm typecheck` og `pnpm test` er grønne (ingen kode er endret, men CI skal være grønn).
- [ ] Bruker i annen organisasjon får ikke tilgang: gjelder ikke nå (ingen kode). ADR-en krever `organization_id` på all KI-data og test med `expectTenantIsolation` når tabellene bygges.
- [ ] KI-forslag kan godtas, endres og avvises og logges: beskrevet i ADR-en, prøves i neste punkt mot falsk leverandør.

## Roller
- **arkitekt:** skriver ADR-en og oppdaterer domenemodell og arkitektur.
- **ki-ansvarlig:** forslagsmønster, evalueringssett, «velger fra det godkjente», kø.
- **sikkerhet-personvern:** vask, hva som aldri sendes, tilgang og logg.
- Ikke `utvikler` og `testskriver` (ingen kode), ikke UX/UI (ingen skjermer), ikke fagansvarlig (ingen fagtekster).

## Åpne spørsmål
- Ingen som stopper ADR-en. Leverandørvalg og databehandleravtale ligger i S8. Det ADR-en avgjør selv, føres som A136 og videre.
