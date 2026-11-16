# Funksjon: Papirkurv og angre for sletting

- **Fase:** 2a, 2a-3 Bredden («Rapporten på PC»)
- **Modul:** kjerne (`src/core/buildings`, `src/core/assignments`), skjermen for oppdraget
- **Status:** utkast
- **Branch:** `papirkurv` (fra main)
- **Støtter hovedmål:** De ansatte: et feiltrykk på «Fjern» koster ett trykk på «Angre», ikke ny utfylling av rom og arealer. KI i bunnen: sletting og gjenoppretting lagres som strukturerte hendelser, og KI-forslag knyttet til et rom eller en etasje er like gyldige etter gjenoppretting. Reklamasjoner: ingenting forsvinner sporløst fra rapporten, og hvem som fjernet og hentet tilbake hva, står i loggen.

## Problem
I dag fjerner «Fjern» bygninger, etasjer (med arealraden), rom og parter på oppdraget med én gang, uten dialog. Dataene ligger igjen i databasen (myk sletting, regel 3), men den ansatte kan ikke se dem eller hente dem tilbake. Et feiltrykk betyr at rommet, arealene eller parten må legges inn på nytt, og de opprinnelige verdiene (målt av, rekkefølge, KI-forslag) er borte for brukeren. Uten papirkurv blir «Fjern» skummelt å bruke, og takstmennene lar feil rom stå i rapporten i stedet.

## KI i bunnen
- **Ingen KI-kall i denne oppgaven.** Å angre eller gjenopprette er en ren brukerhandling; KI har ingenting å foreslå her som er bedre enn det takstmannen nettopp gjorde. KI sletter eller gjenoppretter aldri selv.
- **Data for KI:** hver sletting og gjenoppretting lagres som hendelse (`assignment.*_removed` finnes, nye `assignment.*_restored`) og i revisjonsloggen (`action: "restore"`), med hvem, når og hvilken bygning, etasje eller rom. Senere KI (sjekken før publisering, oppsummering) kan da se at et rom ble fjernet og hentet tilbake, uten å lese persondata.
- **KI-forslag overlever:** forslag i `ai_usage_log` som peker på et gjenopprettet rom eller en etasje røres ikke av slettingen eller gjenopprettingen, og vises igjen som før. Test viser dette.
- Ingenting går til KI-leverandøren; `src/core/ai` brukes ikke.

## Brukerhistorier
- Som **takstmann** vil jeg **trykke «Angre» rett etter at jeg fjernet et rom ved en feil** slik at rommet kommer tilbake på samme plass med alt som var registrert.
- Som **takstmann** vil jeg **se alt som er fjernet fra oppdraget i en papirkurv** og hente det tilbake senere, også dagen etter.
- Som **leder** vil jeg **se hvem som fjernet og hentet tilbake hva** slik at jeg kan svare ved en reklamasjon.

## Omfang
**Med:**
- **Hva papirkurven dekker:** alt som kan fjernes på oppdraget i dag: bygninger, etasjer (arealraden følger etasjen) og rom (`src/core/buildings`), og parter på oppdraget (`src/core/assignments/parties.ts`).
- **Kjernen:** `listTrash(actor, organizationId, assignmentId)` og `restoreBuilding`, `restoreFloor`, `restoreRoom`, `restoreParty`. Tilgang bare via `requireOrganizationAccess` (`assignment.view` for å se, `assignment.edit` for å gjenopprette, som «Fjern» i dag). Spørringene filtrerer på `grant.organizationId`. Alt i én transaksjon med revisjonslogg og hendelse.
- **Gjenoppretting av overordnet ledd (A410):** gjenopprettes et rom i en etasje som også er fjernet, hentes etasjen (og bygningen) tilbake i samme transaksjon. Den ansatte får beskjed om hva mer som kom tilbake.
- **Arealraden (A411):** arealraden som ble fjernet sammen med etasjen (samme `deleted_at`), kommer tilbake med etasjen, men bare hvis etasjen ikke har fått en ny aktiv arealrad i mellomtiden (unik indeks `floor_areas_active_floor_idx`). Ellers står den nye, og den ansatte får beskjed.
- **Rekkefølge og innhold:** det gjenopprettede får tilbake samme plass (`sort_order`), samme verdier og samme id, slik at koblinger (KI-forslag, hendelser) fortsatt stemmer.
- **Gjentatte kall:** å gjenopprette noe som allerede er aktivt gir ingen endring og ingen ny hendelse (tåler dobbelttrykk og ny sending).
- **Kansellert oppdrag:** ingenting kan gjenopprettes på et kansellert oppdrag (samme regel som for endring i dag); papirkurven vises bare til lesing.
- **«Angre»-melding:** etter «Fjern» vises en melding nederst, «Rommet «Bad» er fjernet.» med knappen **«Angre»**, i 10 sekunder (A412). Meldingen leses opp av skjermleser (`role="status"`), knappen kan nås med tastatur, og tiden stopper mens musa eller fokus er på meldingen. «Angre» bruker samme gjenoppretting som papirkurven. Meldingen er en felles komponent i `src/shared/ui` (ingen ny avhengighet).
- **Papirkurven på oppdraget:** en sammenfoldet del «Papirkurv (n)» nederst på bygningsskjermen og ved partene, med det som er fjernet: navn, hvor det lå (bygning › etasje), hvem som fjernet det og når, og knappen «Gjenopprett». Nyeste først. Tom papirkurv vises ikke (A413).
- **iPad- og PC-størrelse**, universell utforming (fokus flyttes til det gjenopprettede, knapper minst 44 px).
- Ordlisten i `docs/05-domenemodell.md` avsnitt 8: papirkurv = `trash`, gjenopprette = `restore`.
- Beslutninger A410–A413 føres i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**
- **Permanent sletting og tømming av papirkurven.** Finnes ikke (regel 3, 10 års oppbevaring).
- **Kansellerte oppdrag.** Å ta et kansellert oppdrag tilbake hører til statusflyten, ikke papirkurven.
- **Reklamasjonssaker** (bare leder og admin), **avtaler, kontakter, firma, sertifiseringer, integrasjoner og filer i admin.** De er ikke en del av rapporten og har egne skjermer.
- **Bilder, avvikskort, tiltak, befaringer og fraser.** De finnes ikke som slettbare ting i rapporten ennå (badmalen og avvikskortene er i arbeid på branch `badet-pc`). Når de bygges, kobles de til den samme papirkurven og «Angre»-meldingen.
- **Papirkurv på iPaden uten nett.** Prøveløsningen uten nett har sin egen lokale sletting; den kobles på når befaringsappen bygges i fase 2b.
- **Samlet papirkurv for hele organisasjonen.** Papirkurven gjelder ett oppdrag.
- **Dialog før «Fjern».** «Angre» erstatter bekreftelsesdialogen (færre trykk); bekreftelse før sletting av bilder er eget planpunkt.
- **Endringer i** tilbud/ordre (`tilbud-i-stedet-for-ordre`), badmalen og avvikskortene (`badet-pc`) og innloggingen (`rydd-innloggingsdata`, `rett-t0070-t0071`).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | papirkurven på oppdrag han kan se | gjenopprette når han kan endre oppdraget (`access.inspectors_edit_all`) |
| kontor | papirkurven på oppdrag han kan se | gjenopprette når han har `assignment.edit` |
| leder | ja | ja |
| admin | ja | ja (regel 11, stenges aldri ute) |

Annen organisasjon får verken liste eller gjenoppretting (`expectTenantIsolation` per ny spørring).

## Data
- **Ingen nye tabeller eller kolonner.** `deleted_at` og `deleted_by` finnes på alle fire tabellene. Gjenoppretting setter `deleted_at` og `deleted_by` til `null` og `updated_by` til den ansatte.
- Nye hendelsestyper i `src/core/events/types.ts`: `assignment.building_restored`, `assignment.floor_restored`, `assignment.room_restored`, `assignment.party_restored`.
- Revisjonsloggen: `action: "restore"` med samme `entityType` som ved sletting.
- Ingen persondata i hendelsene (partens navn står ikke i hendelsen, bare id og rolle, som ved fjerning).

## Skjermer
- **Bygningsskjermen (`/oppdrag/[id]/bygninger`) og partene på oppdraget, PC og iPad.** Hovedhandling: «Angre» i meldingen.
- Trykk for å rette et feiltrykk: før = legge inn rommet på nytt (5–10 trykk og tasting, og verdiene er borte); etter = 1 trykk («Angre») eller 2 trykk (åpne papirkurven, «Gjenopprett»).

## Regler
Ingen fagregler. Gjenopprettingsreglene (overordnet ledd, arealrad, kansellert oppdrag, gjentatte kall) er kode med enhetstester.

## Akseptkriterier
- [ ] «Fjern» på rom, etasje, bygning og part viser meldingen med «Angre»; «Angre» henter tilbake det som ble fjernet, på samme plass og med samme verdier og id.
- [ ] Papirkurven viser det som er fjernet fra oppdraget, med hvor, hvem og når, nyeste først; «Gjenopprett» henter det tilbake og fjerner det fra listen.
- [ ] Rom i fjernet etasje: etasjen (og bygningen) kommer tilbake sammen med rommet, og den ansatte får beskjed (A410).
- [ ] Arealraden kommer tilbake med etasjen, unntatt når etasjen har fått en ny aktiv arealrad (A411).
- [ ] Gjenoppretting to ganger gir ingen endring og ingen ny hendelse.
- [ ] Ingenting kan gjenopprettes på et kansellert oppdrag; takstmann uten endringsrett får avslag (`access.inspectors_edit_all` av).
- [ ] Hver gjenoppretting gir én linje i revisjonsloggen (`restore`) og én hendelse (`*_restored`) i samme transaksjon.
- [ ] KI-forslag som peker på et gjenopprettet rom, vises igjen uendret (test).
- [ ] Ingen rad slettes permanent (test som teller rader før og etter).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for `listTrash` og hver `restore*`).
- [ ] Meldingen og papirkurven virker med tastatur og skjermleser, og på iPad-størrelse (e2e).
- [ ] KI-forslag: ingen i denne oppgaven (se «KI i bunnen»).

## Åpne spørsmål
- Ingen som stopper oppgaven. A410–A413 er «lett å endre».
