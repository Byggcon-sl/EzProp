# Funksjon: Grunnlayout i design A «Fjord» med tom arbeidskø som startside

- **Fase:** 0b
- **Modul:** kjerne (felles layout i `src/app/(ansatt)` og `src/shared/ui`)
- **Status:** utkast (31.10.2026, branch `fase0b-grunnlayout-fjord` fra `main`)
- **Støtter hovedmål:** Tid: én fast ramme med arbeidskøen først, så takstmannen ser hva som venter uten å lete. Reklamasjoner: rolig og lik ramme på PC og iPad, høy kontrast og mørk visning gir færre feiltrykk og feillesing ute og i mørke rom. KI først: rammen har en fast plass for status og «venter på deg», der KI-forslag til godkjenning skal vises senere.

## Problem
I dag er arbeidskøen en enkel side uten meny og uten felles ramme (fase 0a). Hver ny side i fase 0b og 2a ville da laget sin egen topplinje. Det gir ulik oppførsel på PC og iPad, mer kode og mer å lære. Mørk visning er lovet som valg (designprinsipp 10), men finnes ikke.

## KI først
Layouten i seg selv er ikke en KI-oppgave. Den lager plassen KI skal bruke: arbeidskøen («Ingenting venter på deg» nå) er der KI-forslag som venter på godkjenning skal stå når rapportdelen og KI-laget kommer. Ingen KI-funksjon bygges nå.

## Brukerhistorier
- Som **takstmann** vil jeg **se arbeidskøen som første side etter innlogging, i samme ramme på PC og iPad**, slik at **jeg vet hvor ting er uansett enhet**.
- Som **takstmann** vil jeg **kunne slå på mørk visning**, slik at **skjermen ikke blender i mørke rom (kjeller, loft)**.

## Omfang
**Med:**
- Felles layout for innloggede ansatte i `src/app/(ansatt)/layout.tsx`, etter skissen `docs/design/bilder/A-dashbord.png` (bare rammen):
  - Topplinje: produktnavn fra `brand.ts`, navnet til den innloggede (initialer i rund flate), «Logg ut».
  - Meny: «Arbeidskø» (valgt når man står der) og en egen gruppe «Prøver» med «Testskjema uten nett» så lenge fase 1-prøvene lever. På PC (bredde fra `lg`) står menyen fast til venstre. På iPad stående og smalere skjermer åpnes den med en menyknapp (minst 44 pt) i topplinjen, uten sveiping.
  - Nederst i menyen: «Du jobber for <organisasjon>» (som i skissen).
  - Valget «Mørk visning» (av/på) i menyen.
  - Innholdsflate med luftige kort på `bg-canvas`, maks bredde, samme marg på PC og iPad.
- Startsiden `/arbeidskoe` flyttes inn i rammen: overskrift «Arbeidskø», hilsen, tomt kort «Ingenting venter på deg» (og kortet «Du er ikke registrert som ansatt» som i dag). Lenken til testskjemaet flyttes fra siden til menyen.
- Mørk visning: fargevariabler for mørk visning i `globals.css` (kontrast minst 4,5:1 på tekst, Byggcon-blå beholdes som aksent). Valget lagres i en informasjonskapsel per enhet (`theme=dark`), leses på serveren i rotlayouten, så siden ikke blinker lyst først. Standard er lys. Beslutning A22.
- Testskjemaet og listen i `/prove` beholder sin egen statuslinje; de får rammen rundt seg, men ingen andre endringer.
- Felles komponenter i `src/shared/ui` bare der de brukes minst to steder (for eksempel menyknapp). Ingen ny avhengighet (ikoner som enkel SVG i koden).
- e2e i PC- og iPad-størrelse: innlogget takstmann lander på tom arbeidskø i rammen, menyen åpnes og lukkes på iPad, mørk visning slås på og står seg etter ny innlasting, tastaturnavigasjon og fokusmarkering i menyen.
- Versjon i `package.json` økes (patch).

**Ikke med (bevisst utelatt):**
- Bytte mellom EzProp og Optiplan (eget punkt i fase 0b). Ingen plassholder for knappen.
- Søk, varsler (bjella), «Alt er lagret»-merke i topplinjen, kalender, «Nytt oppdrag», tallkort og «Teamet i dag» fra skissen. De kommer med funksjonene de hører til.
- Menypunkter for funksjoner som ikke finnes (Mine oppdrag, Felles kø, Sidemannskontroll, Bibliotek, Admin). Admin-menyen kommer med admin-skjermene.
- Lagring av mørk visning på brukeren i databasen. Ingen migrering.
- Endringer i tilgangsmodulen (`src/core/access`), roller og rettigheter (branchen `fase0b-roller-rettigheter` er i arbeid). Layouten bruker bare `requireActor` og `listOrganizationsForActor` som i dag.
- Valg av organisasjon i rammen (det finnes i dag én organisasjon per ansatt i praksis).
- Innloggingssiden og `/dev/epost` får ikke rammen. Innloggingssiden får bare mørk visning hvis informasjonskapselen alt finnes.
- Kompakt visning (designprinsippene: ikke i første versjon).

## Tilgang
Ingen nye rettigheter. Rammen vises bare for innloggede (`requireActor`, som i dag). Innholdet i arbeidskøen er tomt for alle.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ramme og tom arbeidskø | eget valg av mørk visning (per enhet) |
| kontor | samme | samme |
| leder | samme | samme |
| admin | samme | samme |

Ikke innlogget: sendes til `/logg-inn` som i dag.

## Data
Ingen nye tabeller, ingen migrering. Informasjonskapselen `theme` (verdi `dark` eller ingen) er ikke en personopplysning og trenger ikke samtykke (nødvendig for funksjonen brukeren selv slår på). Ordlisten får `theme` / mørk visning og `app shell` / ramme.

## Skjermer
- **PC (bredde fra `lg`):** meny fast til venstre, topplinje øverst, arbeidskø i midten. Hovedhandling: ingen ennå (tom kø).
- **iPad liggende:** som PC.
- **iPad stående:** menyen skjult bak menyknapp øverst til venstre; åpner som panel over innholdet, lukkes med knapp, Esc eller trykk utenfor. Trykkflater minst 44 pt.
- **Antall trykk:** fra innlogging til arbeidskø 0 trykk (som i dag). Til testskjemaet: PC 1 trykk, iPad stående 2 (før: 1, lenken lå på siden). Akseptert, fordi testskjemaet bare er for prøvene.

## Regler
Ingen.

## Akseptkriterier
- [ ] Innlogget ansatt som åpner `/` havner på `/arbeidskoe` i rammen med topplinje, meny og kortet «Ingenting venter på deg».
- [ ] Ansatt uten organisasjon ser kortet «Du er ikke registrert som ansatt» i rammen, uten organisasjonsnavn nederst i menyen.
- [ ] Ikke innlogget sendes til `/logg-inn` (eksisterende test står seg).
- [ ] Menyen står fast til venstre på PC; på iPad stående åpnes og lukkes den med menyknappen, Esc og trykk utenfor (e2e i begge størrelser).
- [ ] «Arbeidskø» er markert som valgt (`aria-current="page"`) når man står der.
- [ ] Mørk visning slås på og av i menyen, står seg etter ny innlasting, og siden blinker ikke lyst først (klassen settes på serveren).
- [ ] Tekst har kontrast minst 4,5:1 i både lys og mørk visning (sjekk med axe i e2e eller målte fargepar i testplanen).
- [ ] Alle knapper og lenker i rammen har trykkflate på minst 44 pt og synlig fokusmarkering; menyen kan brukes med tastatur.
- [ ] Testskjemaet og listen i `/prove` virker som før (eksisterende e2e grønne).
- [ ] Produktnavnet hentes fra `brand.ts` (lint).
- [ ] Ingen endring i `src/core/access`, `src/db` eller migreringer.
- [ ] Bruker i annen organisasjon får ikke tilgang: ikke relevant, ingen ny spørring. Organisasjonsnavnet nederst i menyen kommer fra `listOrganizationsForActor`, som allerede har tenant-test.
- [ ] Virker på iPad-størrelse (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjonen er økt.

## Beslutninger tatt av agentene (autonom modus)
- **A22: Mørk visning lagres per enhet i en informasjonskapsel, ikke på brukeren.** Standard er lys. Grunn: designprinsippene sier mørk visning er et valg, ikke standard (`docs/08-designprinsipper.md`, `docs/kartlegging/design-retninger.md`); oppgaven skal ikke ha migrering, og det enkleste som virker er per enhet (iPad i mørkt rom, PC på kontoret kan ha ulikt valg). Kan endres ved å flytte valget til profilen senere.
- **A23: Menyen viser bare det som finnes.** Arbeidskø, og «Prøver → Testskjema uten nett» til fase 1-prøvene fjernes. Ingen tomme menypunkter for kommende funksjoner. Grunn: «Hold det enkelt» (CLAUDE.md regel 1) og prinsippet om én hovedhandling. Kilde: skissen `A-dashbord.png`. Kan endres når nye funksjoner kommer.

Prosjektlederen fører A22 og A23 i `docs/09-apne-sporsmal.md` (tabellen «Avgjort av agentene mens Ståle var borte»). Nummer A18–A21 er brukt av branchen `fase0b-roller-rettigheter`.

## Roller
- **ui-designer:** kort komponentspesifikasjon for rammen og fargeparene i mørk visning, målt mot `A-dashbord.png` og `A-ipad-staende.png`, før koding.
- **utvikler:** layout, meny, mørk visning, flytting av arbeidskøen.
- **testskriver:** e2e (PC og iPad) og enhetstest for lesing av informasjonskapselen. Kan skrives i parallell ut fra akseptkriteriene.
- **test-leder:** gjennomgang før PR.

Ikke med: arkitekt (ingen ny struktur), ux-ansvarlig (rammen følger skissen, ingen nye flyter), fagansvarlig, KI, sikkerhet-personvern (ingen ny data, ingen ny tilgang).

## Bygging i biter (parallell)
1. **utvikler:** `globals.css` (mørke farger), rotlayout (les `theme`), `(ansatt)/layout.tsx` med topplinje og meny, menyknapp og bryter for mørk visning, arbeidskøsiden.
2. **testskriver:** `e2e/fase-0b-grunnlayout.spec.ts` (PC og iPad) og enhetstest for hjelperen som leser og setter `theme`. Avtalt grensesnitt: `data-testid` brukes ikke; testene finner elementer på rolle og navn («Meny», «Mørk visning», «Arbeidskø», «Logg ut»).

## Åpne spørsmål
- Ingen som stopper oppgaven.
