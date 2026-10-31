# Funksjon: Grunnlayout i design A «Fjord» med tom arbeidskø som startside

- **Fase:** 0b
- **Modul:** kjerne (felles layout i `src/app/(ansatt)`)
- **Status:** klar for bygging (31.10.2026, runde 2 etter forenkler og test-leder, branch `fase0b-grunnlayout-fjord` fra `main`)
- **Støtter hovedmål:** Tid: én fast ramme med arbeidskøen først, så takstmannen ser hva som venter uten å lete. Reklamasjoner: rolig og lik ramme på PC og iPad, høy kontrast og store trykkflater gir færre feiltrykk og feillesing. KI først: rammen har en fast plass for «venter på deg», der KI-forslag til godkjenning skal vises senere.

## Problem
I dag er arbeidskøen en enkel side uten meny og uten felles ramme (fase 0a). Hver ny side i fase 0b og 2a ville da laget sin egen topplinje. Det gir ulik oppførsel på PC og iPad, mer kode og mer å lære.

## KI først
Layouten i seg selv er ikke en KI-oppgave. Den lager plassen KI skal bruke: arbeidskøen («Ingenting venter på deg» nå) er der KI-forslag som venter på godkjenning skal stå når rapportdelen og KI-laget kommer. Ingen KI-funksjon bygges nå.

## Brukerhistorier
- Som **takstmann** vil jeg **se arbeidskøen som første side etter innlogging, i samme ramme på PC og iPad**, slik at **jeg vet hvor ting er uansett enhet**.

## Omfang
**Med:**
- Felles layout for innloggede ansatte i `src/app/(ansatt)/layout.tsx`, etter skissen `docs/design/bilder/A-dashbord.png` (bare rammen). Alt holdes i layoutfilen, med høyst én liten hjelpefil ved siden av (se «Data»). Ingen felles komponenter i `src/shared/ui` nå (brukes bare ett sted).
  - Topplinje: produktnavn fra `brand.ts`, initialene til den innloggede i rund flate, «Logg ut».
  - Meny: «Arbeidskø» (`aria-current="page"` når man står der) og en egen gruppe «Prøver» med «Testskjema uten nett» så lenge fase 1-prøvene lever.
  - Fra bredde `lg` (PC og iPad liggende): menyen står fast til venstre.
  - Smalere enn `lg` (iPad stående): menypunktene står som en rad rett under topplinjen. Ingen menyknapp, ikke noe panel, ingen egen tilstandskode. Se avgjørelse 2 under.
  - «Du jobber for <organisasjon>» nederst i menyen (under raden på smale skjermer). Flere organisasjoner slås sammen med komma, som i dag. Ingen organisasjon: linjen vises ikke.
  - Innholdsflate med luftige kort på `bg-canvas`, maks bredde, samme marg på PC og iPad.
- Startsiden `/arbeidskoe` flyttes inn i rammen: overskrift «Arbeidskø», hilsen, tomt kort «Ingenting venter på deg» (og kortet «Du er ikke registrert som ansatt» som i dag). Lenken til testskjemaet flyttes fra siden til menyen.
- Testskjemaet og listen i `/prove` beholder sin egen statuslinje; de får rammen rundt seg, men ingen andre endringer.
- Ingen ny avhengighet (ikoner som enkel SVG i koden, ingen axe).
- e2e i PC, iPad liggende og iPad stående (se testplanen).
- Versjon i `package.json` økes (patch).

**Ikke med (bevisst utelatt):**
- **Mørk visning** (fase 3, `docs/07-utviklingsplan.md` linje 332 «Mørk visning som valg, og større tekst»; kartleggingstabellen linje 643 sier også fase 3). Ingen mørke fargevariabler, ingen informasjonskapsel `theme`, ingen bryter. Se avgjørelse 1.
- Menyknapp og panel som legger seg over innholdet på iPad stående.
- Bytte mellom EzProp og Optiplan (eget punkt i fase 0b). Ingen plassholder for knappen.
- Søk, varsler (bjella), «Alt er lagret»-merke i topplinjen, kalender, «Nytt oppdrag», tallkort og «Teamet i dag» fra skissen. De kommer med funksjonene de hører til.
- Menypunkter for funksjoner som ikke finnes (Mine oppdrag, Felles kø, Sidemannskontroll, Bibliotek, Admin).
- Endringer i tilgangsmodulen (`src/core/access`), roller og rettigheter (branchen `fase0b-roller-rettigheter` er i arbeid). Layouten bruker bare `requireActor` og `listOrganizationsForActor` som i dag.
- Valg av organisasjon i rammen.
- Innloggingssiden og `/dev/epost` får ikke rammen.
- Kompakt visning (designprinsippene: ikke i første versjon).

## Tilgang
Ingen nye rettigheter. Rammen vises bare for innloggede (`requireActor`, som i dag). Innholdet i arbeidskøen er tomt for alle.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ramme og tom arbeidskø | ingenting |
| kontor | samme | samme |
| leder | samme | samme |
| admin | samme | samme |

Ikke innlogget: sendes til `/logg-inn` som i dag.

## Data
Ingen nye tabeller, ingen migrering, ingen informasjonskapsel. Ingen ny spørring: organisasjonsnavnet kommer fra `listOrganizationsForActor`, som allerede filtrerer bort sluttede (`deactivated_at`) og myk-slettede (`deleted_at`) ansatte og har tenant-test. Teksten lages av en liten ren hjelper `organizationLabel(organizations)` i `src/app/(ansatt)/organization-label.ts` (gir navnene slått sammen med komma, eller `null`). Ordlisten får `app shell` / ramme.

## Skjermer
- **PC (bredde fra `lg`):** meny fast til venstre, topplinje øverst, arbeidskø i midten. Hovedhandling: ingen ennå (tom kø).
- **iPad liggende (1194x834, over `lg`):** som PC.
- **iPad stående (834x1194):** topplinje, under den en rad med menypunktene (minst 44 pt høye), så innholdet. Ingen menyknapp.
- **Antall trykk:** fra innlogging til arbeidskø 0 trykk (som i dag). Til testskjemaet 1 trykk på både PC og iPad (lenken står alltid synlig).

## Regler
Ingen.

## Akseptkriterier
- [ ] Innlogget admin som åpner `/` havner på `/arbeidskoe` i rammen med topplinje, meny og kortet «Ingenting venter på deg» (admin stenges ikke ute). Det samme for en takstmann hvis roller-branchen er merget; ellers bare admin, og det står i PR-en.
- [ ] Ansatt uten ansattrad, sluttet ansatt og myk-slettet ansatt ser «Du er ikke registrert som ansatt» og intet organisasjonsnavn.
- [ ] Rammen viser «Du jobber for <egen org>», og navnet på en annen organisasjon i databasen vises ikke.
- [ ] Ikke innlogget sendes til `/logg-inn` (eksisterende test står seg).
- [ ] PC og iPad liggende: menyen står fast til venstre. iPad stående: menypunktene står synlige som rad under topplinjen. Ingen knapp «Meny» finnes i noen størrelse.
- [ ] «Arbeidskø» har `aria-current="page"` når man står der. «Testskjema uten nett» står under «Prøver» og åpner `/prove/testskjema`.
- [ ] Tekst/bakgrunn-parene rammen bruker (lys visning) har kontrast minst 4,5:1, målt i enhetstest. Byggcon-blå som tekst er minst 4,5:1 mot bakgrunnene den står på.
- [ ] Alle knapper og lenker i rammen er minst 44x44 px og har synlig fokusmarkering; menyen kan brukes med tastatur (Tab).
- [ ] «Logg ut» fører til `/logg-inn`.
- [ ] `/logg-inn` og `/dev/epost` har ikke rammen.
- [ ] Testskjemaet og listen i `/prove` virker som før (eksisterende e2e grønne).
- [ ] Produktnavnet hentes fra `brand.ts` (lint).
- [ ] `git diff main -- src/core/access src/db drizzle` er tom.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjonen er økt.

## Testplan (testskriver)
**Enhetstester**
- `src/app/(ansatt)/contrast.test.ts`: leser fargevariablene for lys visning fra `src/app/globals.css` og regner WCAG-kontrast. Hvert tekst/bakgrunn-par rammen bruker er minst 4,5:1, også Byggcon-blå som tekst mot `canvas` og kortflaten.

**Integrasjonstest (testdatabasen)**
- `src/app/(ansatt)/organization-label.test.ts`: `organizationLabel(await listOrganizationsForActor(user))` gir eget organisasjonsnavn, og ikke navnet på en annen organisasjon som finnes. Bruker uten ansattrad, sluttet ansatt (`deactivated_at`) og myk-slettet ansatt (`deleted_at`) gir `null`. To organisasjoner gir navnene med komma. Ingen ny spørring, så `expectTenantIsolation` trengs ikke; testene for `listOrganizationsForActor` i `src/core/access` står uendret.

**e2e i `e2e/fase-0b-grunnlayout.spec.ts`** (elementer finnes på rolle og navn, ikke `data-testid`):
- Admin åpner `/` og havner på `/arbeidskoe`; banner, meny og «Ingenting venter på deg» vises. Takstmann også hvis roller-branchen er merget.
- «Arbeidskø» har `aria-current="page"`; «Testskjema uten nett» under «Prøver» åpner `/prove/testskjema`.
- Prosjektene «pc» og «ipad» (liggende): menyen er synlig til venstre uten trykk, og det finnes ingen knapp «Meny».
- iPad stående i egen `test.describe` med `test.use({ viewport: { width: 834, height: 1194 }, hasTouch: true })`: menypunktene er synlige uten trykk, ingen knapp «Meny», «Testskjema uten nett» åpner skjemaet med ett trykk.
- Tastatur: Tab når alle lenkene i menyen og «Logg ut»; fokusmarkeringen er synlig (outline eller ring er ikke `none`).
- Alle knapper og lenker i rammen er minst 44x44 px (`boundingBox`), i alle tre størrelsene.
- «Logg ut» fører til `/logg-inn`; uinnlogget som åpner `/arbeidskoe` sendes til `/logg-inn`.
- `/logg-inn` og `/dev/epost` har ikke rammen (ingen navigasjon «Arbeidskø»).
- Hvordan «uten organisasjon» testes: i integrasjonstesten over, ikke i e2e (ingen ny e2e-bruker trengs).

**Regresjon:** `e2e/fase-0a.spec.ts`, `fase-1-testskjema` og `fase-1-prove-f-innlogging` (`neste` tilbake til skjemaet) skal være grønne. Må selektorer endres fordi lenken flyttes til menyen, holdes endringen liten og forklares i PR-en.

## Avgjørelser fra prosjektlederen (runde 2)
1. **Mørk visning tas ut** (forenkler punkt 1, godtatt). Planen har det som eget punkt i fase 3. Test-lederens punkt 2 (axe) løses med målte fargepar for lys visning, og punkt 4 (serversjekk av mørk klasse) faller bort sammen med mørk visning.
2. **Ingen menyknapp på iPad stående** (forenkler punkt 2, godtatt). Med to menypunkter er en rad under topplinjen enklere, gir færre trykk (1 i stedet for 2 til testskjemaet) og krever ingen Esc-, trykk-utenfor- eller fokuskode. Skissen `A-ipad-staende.png` viser en menyknapp, men skissen tegner også menypunkter vi ikke har ennå. Når menyen får flere punkter, vurderes menyknapp på nytt (da med `<details>`/`<summary>` eller `popover`, ingen egen tilstand). Test-lederens punkt 1 tas inn som egen viewport for iPad stående, med motsatt forventning (ingen menyknapp).
3. **Ingen felles komponenter i `src/shared/ui`** (forenkler punkt 3, godtatt).
4. **«Uten organisasjon», sluttet og slettet testes som integrasjonstest** (test-leder punkt 3). Det er enklere og raskere enn en ny e2e-bruker, og layouten viser bare det `organizationLabel` gir.

## Beslutninger tatt av agentene (autonom modus)
- **A23: Menyen viser bare det som finnes.** Arbeidskø, og «Prøver → Testskjema uten nett» til fase 1-prøvene fjernes. Ingen tomme menypunkter for kommende funksjoner. Grunn: «Hold det enkelt» (CLAUDE.md regel 1) og prinsippet om én hovedhandling. Kilde: skissen `A-dashbord.png`. Kan endres når nye funksjoner kommer.

A22 (mørk visning per enhet) er tatt ut og føres ikke; den tas opp igjen i fase 3. Prosjektlederen fører A23 i `docs/09-apne-sporsmal.md` (tabellen «Avgjort av agentene mens Ståle var borte»). Nummer A18–A21 er brukt av branchen `fase0b-roller-rettigheter`.

## Roller
- **ui-designer:** kort spesifikasjon for rammen og fargeparene i lys visning, målt mot `A-dashbord.png` og `A-ipad-staende.png`, før koding.
- **utvikler:** layout, meny, `organizationLabel`, flytting av arbeidskøen.
- **testskriver:** e2e (PC, iPad liggende, iPad stående), kontrasttest og integrasjonstest for `organizationLabel`. Kan skrives i parallell ut fra akseptkriteriene.
- **test-leder:** gjennomgang før PR.

Ikke med: arkitekt (ingen ny struktur), ux-ansvarlig (rammen følger skissen, ingen nye flyter), fagansvarlig, KI, sikkerhet-personvern (ingen ny data, ingen ny tilgang).

## Bygging i biter (parallell)
1. **utvikler:** `(ansatt)/layout.tsx` med topplinje og meny (fast til venstre fra `lg`, rad under topplinjen under `lg`), `organization-label.ts`, arbeidskøsiden, eventuelle justeringer av lyse fargevariabler i `globals.css`.
2. **testskriver:** `e2e/fase-0b-grunnlayout.spec.ts`, `contrast.test.ts`, `organization-label.test.ts`. Avtalt grensesnitt: `organizationLabel(organizations: { name: string }[]): string | null`; elementer finnes på rolle og navn («Arbeidskø», «Testskjema uten nett», «Logg ut»), ingen `data-testid`.

## Åpne spørsmål
- Ingen som stopper oppgaven.
