# Funksjon: Papirkurv og angre for sletting

- **Fase:** 2a, 2a-3 Bredden («Rapporten på PC»)
- **Modul:** kjerne (`src/core/buildings`, `src/core/assignments`), skjermen for oppdraget
- **Status:** klar for bygging (runde 1 av forhåndsvurderingen er tatt inn 16.11.2026)
- **Branch:** `papirkurv` (fra main)
- **Støtter hovedmål:** De ansatte: et feiltrykk på «Fjern» koster ett trykk på «Angre», ikke ny utfylling av rom og arealer, og en feilregistrert etasje fjernes med ett trykk i stedet for sju. KI i bunnen: sletting og gjenoppretting lagres som strukturerte hendelser (romtype, antall, angre eller papirkurv, tid til gjenoppretting), og KI-forslag knyttet til et rom eller en etasje er like gyldige etter gjenoppretting. Reklamasjoner: ingenting forsvinner sporløst fra rapporten, feil etasjer blir ikke stående fordi det er tungvint å fjerne dem, og hvem som fjernet og hentet tilbake hva, står i loggen.

## Problem
I dag fjerner «Fjern» bygninger, etasjer (med arealraden), rom og parter på oppdraget med én gang, uten dialog. Dataene ligger igjen i databasen (myk sletting, regel 3), men den ansatte kan ikke se dem eller hente dem tilbake. Et feiltrykk betyr at rommet, arealene eller parten må legges inn på nytt, og de opprinnelige verdiene (målt av, rekkefølge, KI-forslag) er borte for brukeren. Bygning og etasje kan i dag bare fjernes når de er tomme (A98), så en feilregistrert etasje med 6 rom krever 7 trykk. Uten papirkurv blir «Fjern» skummelt å bruke, og takstmennene lar feil rom stå i rapporten i stedet.

## KI i bunnen
- **Ingen KI-kall i denne oppgaven.** Å angre eller gjenopprette er en ren brukerhandling; KI har ingenting å foreslå her som er bedre enn det takstmannen nettopp gjorde. KI sletter eller gjenoppretter aldri selv.
- **Data for KI:** hver sletting og gjenoppretting lagres som hendelse (`assignment.*_removed` finnes, nye `assignment.*_restored`) og i revisjonsloggen (`action: "restore"`). Hendelsene får strukturerte felt uten persondata (se «Data»). Senere kan vi se hvor ofte «Fjern» er et feiltrykk, og hvilke romtyper i malen som nesten alltid fjernes, et tegn på at standardvalgene i malen kan forbedres.
- **KI-forslag overlever:** forslag i `ai_usage_log` som peker på et gjenopprettet rom eller en etasje (`target_ref.type` room eller floor) røres ikke av slettingen eller gjenopprettingen, og vises igjen som før. Test viser dette.
- **Vasken før KI** (`src/core/ai/redaction.ts`) leser partene uten filter på `deleted_at`, slik at navnet til en fjernet part fortsatt vaskes bort. Det skal stå slik; en test låser det.
- Ingenting går til KI-leverandøren; `src/core/ai` brukes ikke.

## Brukerhistorier
- Som **takstmann** vil jeg **trykke «Angre» rett etter at jeg fjernet et rom ved en feil** slik at rommet kommer tilbake på samme plass med alt som var registrert.
- Som **takstmann** vil jeg **fjerne en feilregistrert etasje med ett trykk**, også når den har rom, og kunne angre det.
- Som **takstmann** vil jeg **se alt som er fjernet fra oppdraget i en papirkurv** og hente det tilbake senere, også dagen etter.
- Som **leder** vil jeg **se hvem som fjernet hva, og når**, slik at jeg kan svare ved en reklamasjon. Papirkurven viser bare det som fortsatt er fjernet; hvem som hentet tilbake hva, står i revisjonsloggen og hendelsene. En egen historikkskjerm på oppdraget er et eget planpunkt («Fra forbedreren» i 2a-3) og bygges ikke her.

## Omfang
**Med:**
- **Hva papirkurven dekker:** alt som kan fjernes på oppdraget i dag: bygninger, etasjer (arealraden følger etasjen) og rom (`src/core/buildings`), og parter på oppdraget (`src/core/assignments/parties.ts`).
- **«Fjern» tar med innholdet (A414, erstatter A98):** «Fjern» på etasje tar med de aktive rommene og arealraden. «Fjern» på bygning tar med de aktive etasjene, rommene og arealradene. Alt skjer i én transaksjon med **ett felles tidspunkt** (`deleted_at`) og samme `deleted_by`, slik at det blir én **slettegruppe**. Meldingen sier hva som gikk med: «2. etasje og 4 rom er fjernet.» `BuildingNotEmptyError` og `FloorNotEmptyError` brukes ikke lenger av «Fjern» (fjernes fra kjernen og skjermen).
- **Kjernen:** `listTrash(actor, organizationId, assignmentId)` og `restoreBuilding`, `restoreFloor`, `restoreRoom`, `restoreParty`.
  - **Tilgang (A417):** bare via `requireOrganizationAccess`. `listTrash` krever `organization.read` (som `getAssignmentBuildings`); `restore*` krever `assignment.edit` (som «Fjern» i dag). Ingen ny rettighetskode (regel 6), ingen sjekk utenfor `src/core/access`. Admin har alltid tilgang (regel 11).
  - **`restore*` tar bare id-en til raden.** Oppdraget slås opp fra raden med `grant.organizationId`, aldri fra skjema eller adresse. Ukjent id, annen organisasjon, ugyldig UUID og kansellert oppdrag gir samme `AccessDeniedError` (ingen lekkasje om at raden finnes). Raden låses med `for update`. Server-handlingene henter organisasjonen fra sesjonen.
  - Alt i én transaksjon med revisjonslogg og hendelse.
- **Slettegruppe tilbake (A414):** «Angre» og «Gjenopprett» på en etasje eller bygning henter tilbake hele gruppen, men bare radene med **samme `deleted_at`** som den øverste delen. Rom som var fjernet tidligere, blir liggende i papirkurven.
- **Gjenoppretting av overordnet ledd (A410):** gjenopprettes et rom i en etasje som også er fjernet, hentes etasjen (og bygningen) tilbake i samme transaksjon, men aldri andre rom eller etasjer (søsken blir liggende). Svaret lister det som kom med, og den ansatte får beskjed: «Rommet kom tilbake, sammen med etasjen «1. etasje».»
- **Arealraden (A411):** `removeFloor` (og «Fjern» på bygning) setter ett tidspunkt for etasjen og arealraden (i dag kalles `softDelete()` to ganger og kan gi ulik tid; det rettes, med egen test). Arealraden med samme `deleted_at` kommer tilbake med etasjen. **Eldre rader** fjernet før denne endringen: arealraden for etasjen med `deleted_at` innen 1 sekund før eller etter etasjens, og samme `deleted_by`, regnes som samme gruppe. Har etasjen fått en ny aktiv arealrad i mellomtiden (unik indeks `floor_areas_active_floor_idx`), står den nye, den gamle blir liggende, og den ansatte får beskjed. Indeksen skal aldri gi en 500-feil, heller ikke ved samtidige kall.
- **Rekkefølge og innhold:** det gjenopprettede får tilbake samme plass (`sort_order`), samme verdier og samme id, slik at koblinger (KI-forslag, hendelser) fortsatt stemmer.
- **Arkiverte koder:** et rom med romtype eller en etasje med etasjeverdi som er arkivert i malen i mellomtiden, gjenopprettes uendret (regel 6: koden finnes fortsatt, den er bare arkivert). Test viser dette.
- **Gjentatte kall:** å gjenopprette noe som allerede er aktivt gir ingen endring og ingen ny hendelse (tåler dobbelttrykk og ny sending). Dette avgjøres først etter at tilgang og organisasjon er sjekket.
- **Kansellert oppdrag (A416):** kansellering er myk sletting av oppdraget, og bygninger, etasjer, areal og rom på et kansellert oppdrag kan i dag verken leses eller endres (`buildings-cancel.test.ts`, punkt 4.4.1b). Derfor gir `listTrash` og alle `restore*` `AccessDeniedError` på kansellert oppdrag, for alle roller, uten nye rader, hendelser eller loggrader. Papirkurven vises ikke der. Det kansellerte oppdraget selv står aldri i papirkurven.
- **Part med kobling (A415):** når en part hentes tilbake, sjekkes det at kontakten og firmaet den var koblet til, fortsatt er aktive i samme organisasjon. Er kontakten slått sammen med en annen, har sammenslåingen allerede flyttet koblingen (også på fjernede parter), så den står. Er kontakten eller firmaet fjernet, kommer parten tilbake med navnet og verdiene den hadde, og den ansatte får beskjed: «Parten kom tilbake, men kontakten den var koblet til, er fjernet.» Er kontakten fjernet, settes `contactId` og `firmId` til `null`. Er bare firmaet fjernet, settes bare `firmId` til `null`, og kontakten står, fordi kontakter beholdes når firmaet fjernes (presisert 16.11.2026).
- **Parter er personopplysninger:** `listTrash` gir bare id, rolle, navn og firmanavn for parter, ikke e-post, telefon, `contactId` eller `firmId`. Angre-meldingen holder bare id, type og visningsnavn i minnet: ikke i adressen, `localStorage` eller `sessionStorage`, og aldri i loggeren.
- **«Angre»-melding (A412):** felles komponent i `src/shared/ui` (ingen ny avhengighet).
  - Vises etter «Fjern» på rom, etasje, bygning og part: «Rommet «Bad» er fjernet.» med knappen **«Angre»** og teksten «Du finner det også i papirkurven.»
  - Står i **10 sekunder**, eller til neste «Fjern». På PC stopper tiden mens musa eller fokus er på meldingen. Lukkeknapp (×, minst 44 pt). Papirkurven er den varige veien, så tidsgrensen er i tråd med WCAG 2.2.1.
  - **Én melding om gangen:** en ny sletting erstatter meldingen, og «Angre» gjelder bare den siste. Den forrige ligger i papirkurven, og meldingen sier «Mer i papirkurven». Meldinger stables ikke.
  - **Cmd/Ctrl+Z** på PC utløser «Angre» mens meldingen vises (ikke når fokus står i et tekstfelt).
  - **Overlever revalidering:** meldingen må bli stående når siden lastes på nytt etter server-handlingen. e2e viser dette.
  - **Feil ved «Angre» eller «Gjenopprett»** (nettet faller, økten er utløpt, oppdraget er kansellert i mellomtiden): meldingen blir stående med en tydelig feiltekst, «Fikk ikke hentet tilbake rommet. Prøv igjen, eller bruk papirkurven.», og en ny «Angre»-knapp. Ingenting ser gjenopprettet ut før serveren har svart.
  - **Plassering:** nederst, men over hovedknappene som er festet nederst; dekker dem aldri. «Angre» er hovedhandling, 56 pt på iPad.
  - Leses opp av skjermleser (`role="status"`), og knappene kan nås med tastatur.
  - «Angre» bruker samme kjernefunksjon som papirkurven.
- **Papirkurven på oppdraget (A413):** en sammenfoldet åpne/lukke-del «Papirkurv (n)» nederst på bygningsskjermen og ved partene. Nyeste først, høyst 200 linjer. Tom papirkurv vises ikke. Hver linje viser:
  - romtype eller navn, og hvor det lå (bygning › etasje), også når overordnet ledd er fjernet;
  - for etasjer: areal fra arealraden (BRA og P-ROM);
  - en slettegruppe som én linje: «2. etasje (4 rom)». Hvert rom i gruppen kan også hentes tilbake for seg (da gjelder A410);
  - hvem som fjernet det (navnet hentes fra `employees` med `grant.organizationId`, også for ansatte som har sluttet; bare navn, ikke e-post) og når, som «i dag 14:02», «i går 09:15» eller dato;
  - knappen «Gjenopprett» (minst 44 pt).
  Ingen telling eller statistikk per ansatt bygges på «hvem».
- **Etter «Angre» eller «Gjenopprett»:** fokus flyttes til det som kom tilbake, skjermen ruller dit (også på iPad), og raden får kort uthevet bakgrunn (ingen animasjon ved `prefers-reduced-motion`).
- **iPad- og PC-størrelse**, universell utforming.
- Ordlisten i `docs/05-domenemodell.md` avsnitt 8: papirkurv = `trash`, gjenopprette = `restore`, slettegruppe = `removal group`.
- Beslutninger A410–A418 føres i `docs/09-apne-sporsmal.md`. Personvernspørsmålet om fjernede parter (nr. 85) går til Ståle og stopper ikke oppgaven.

**Ikke med (bevisst utelatt):**
- **Permanent sletting og tømming av papirkurven.** Finnes ikke (regel 3, 10 års oppbevaring).
- **Kansellerte oppdrag.** Å ta et kansellert oppdrag tilbake hører til statusflyten, ikke papirkurven.
- **Reklamasjonssaker.** De er en egen ting (`claims`, bare leder og admin med `claims.manage`) med egen fjerning, ikke en del av rapporten. Bygninger, etasjer, rom og parter hører til oppdraget, og «Fjern» på dem har ingen egen reklamasjonssperre i dag, så papirkurven får heller ingen. Kommer reklamasjonskoblingen (eget punkt i 2a-3), vurderes papirkurven der.
- **Avtaler, kontakter, firma, sertifiseringer, integrasjoner og filer i admin.** Egne skjermer.
- **Teamroller** byttes med `to_at` og slettes ikke, så de trenger ingen papirkurv.
- **Filer på oppdraget** har ingen «Fjern» i grensesnittet i dag.
- **Bilder, avvikskort, tiltak, befaringer og fraser.** De finnes ikke som slettbare ting i rapporten ennå (badmalen og avvikskortene er i arbeid på branch `badet-pc`). Når de bygges, kobles de til den samme papirkurven og «Angre»-meldingen.
- **Papirkurv på iPaden uten nett.** Prøveløsningen uten nett har sin egen lokale sletting; den kobles på når befaringsappen bygges i fase 2b.
- **Samlet papirkurv for hele organisasjonen.** Papirkurven gjelder ett oppdrag.
- **Historikkskjerm på oppdraget.** Eget planpunkt fra forbedreren.
- **Dialog før «Fjern».** «Angre» erstatter bekreftelsesdialogen (færre trykk); bekreftelse før sletting av bilder er eget planpunkt.
- **Endringer i** tilbud/ordre (`tilbud-i-stedet-for-ordre`), badmalen og avvikskortene (`badet-pc`) og innloggingen (`rydd-innloggingsdata`, `rett-t0070-t0071`).

## Tilgang
| Rolle | Se (`organization.read`) | Gjenopprette (`assignment.edit`) |
|---|---|---|
| takstmann | papirkurven på oppdrag han kan se | når `access.inspectors_edit_all` er på; ellers ser han ikke «Gjenopprett» og kjernen gir avslag |
| kontor | ja | når han har `assignment.edit` |
| leder | ja | ja |
| admin | ja | ja (regel 11, stenges aldri ute) |

Kansellert oppdrag: avslag for alle roller (A416). Slettet ansatt får avslag. Annen organisasjon får verken liste eller gjenoppretting (`expectTenantIsolation` for `listTrash` og hver av de fire `restore*`).

## Data
- **Ingen nye tabeller eller kolonner,** så `tests/tenant-tables.ts` endres ikke. `deleted_at` og `deleted_by` finnes på alle fire tabellene og på `floor_areas`. Gjenoppretting setter `deleted_at` og `deleted_by` til `null` og `updated_by` til den ansatte. Sporet om hvem som fjernet, ligger da bare i revisjonsloggen, så loggraden for slettingen endres aldri.
- Nye hendelsestyper i `src/core/events/types.ts`: `assignment.building_restored`, `assignment.floor_restored`, `assignment.room_restored`, `assignment.party_restored`.
- **Felt i hendelsene** (`*_removed` og `*_restored`), uten persondata: id, `roomTypeKey` eller `floorKey`, antall i slettegruppen (`groupCount`), og for gjenoppretting `how` (`"undo"` eller `"trash"`) og `secondsSinceRemoval`. Parter: bare id og rolle.
- **Revisjonsloggen:** `action: "restore"` med samme `entityType` som ved sletting. **Hver rad** som fjernes eller hentes tilbake (bygning, etasje, rom, arealrad) får sin egen linje, i samme transaksjon. Hendelse: én for den øverste delen, med antall i data, og én per overordnet ledd som hentes tilbake etter A410.
- Ingen persondata i hendelser eller revisjonslogg for parter (bare id og rolle, som ved fjerning).

## Skjermer
- **Bygningsskjermen (`/oppdrag/[id]/bygninger`) og partene på oppdraget, PC og iPad.** Hovedhandling: «Angre» i meldingen.
- Flyt: Rom › [Fjern] → «Rommet «Bad» er fjernet.» [Angre] → rommet står på samme plass, med fokus. Senere: «Papirkurv (3)» › [Gjenopprett] → «Rommet kom tilbake, sammen med etasjen «1. etasje».»
- Trykk og tid: feiltrykk på rom i dag gir 5–10 trykk og tasting, ca. 1–3 minutter, og verdiene er borte; etter: 1 trykk (ca. 2 sekunder) eller 2 trykk fra papirkurven. Etasje med 6 rom fjernes med 1 trykk i stedet for 7. IVIT har ingen angre. «Fjern» forblir ett trykk uten dialog.
- Utseendet på meldingen og papirkurven avgjøres av ui-designer etter `docs/08-designprinsipper.md`.

## Regler
Ingen fagregler. Slette- og gjenopprettingsreglene (slettegruppe, overordnet ledd, arealrad, kansellert oppdrag, gjentatte kall, part med kobling) er kode med enhetstester.

## Testplan
**Enhetstester:** A410 (rom i fjernet etasje i fjernet bygning: alle tre kommer tilbake, svaret lister det som kom med; søsken blir liggende) · A411 begge grenene (samme tid, og eldre rader innen 1 sekund) og `removeFloor` med ett tidspunkt · A414 slettegruppe (hele gruppen kommer tilbake, rom fjernet før blir liggende) · gjentatte kall · kansellert oppdrag · A415 (kontakt fjernet gir null-kobling og beskjed; sammenslått kontakt beholder flyttet kobling) · arkiverte koder · angre-meldingen med falske tidtakere (10 sekunder, pause ved hover og fokus, ny sletting erstatter, Cmd/Ctrl+Z).

**Integrasjon mot testdatabasen:** én test per funksjon (`listTrash` og hver `restore*`, og ny «Fjern» med innhold) · samme id, `sort_order` og verdier; `deleted_at` og `deleted_by` null, `updated_by` satt · én `restore`-linje per rad og hendelse etter reglene over; tilbakerulling midt i kallet etterlater verken rad, logg eller hendelse · telling før og etter over bygninger, etasjer, rom, parter og `floor_areas` viser at ingenting slettes permanent, og at `audit_log` og `events` bare vokser · `ai_usage_log` med `target_ref.type` room eller floor uendret · ingen navn, e-post eller telefon i `events.data` eller `audit_log.changes` · vasken før KI vasker fortsatt navnet til en fjernet part · samtidighet: to gjenopprettinger samtidig, og gjenoppretting samtidig med ny arealrad, gir aldri 500-feil · listen: nyeste først, riktig sti når overordnet ledd er fjernet, ingen rader fra andre oppdrag, høyst 200 · ukjent id, annen organisasjon, ugyldig UUID og kansellert oppdrag gir samme avslag.

**Tilgang per rolle:** takstmann med og uten `access.inspectors_edit_all`, kontor, leder, admin, slettet ansatt. **Tenant-isolasjon:** `expectTenantIsolation` for `listTrash` og hver av de fire `restore*`.

**E2E, PC og iPad-størrelse:** «Fjern» og «Angre» for rom, etasje med rom, bygning og part · meldingen overlever revalidering · papirkurven: åpne, «Gjenopprett», raden forsvinner, tom papirkurv vises ikke · fokus og rulling til det som kom tilbake · tastatur og skjermleser (`role="status"`) · knapper minst 44 px (56 pt for «Angre» på iPad) · meldingen dekker ikke hovedknappene · takstmann uten endringsrett ser ikke «Gjenopprett» · Playwrights klokke for de 10 sekundene, ikke ventetid.

## Akseptkriterier
- [ ] «Fjern» på rom, etasje, bygning og part viser meldingen med «Angre»; «Angre» henter tilbake det som ble fjernet, på samme plass og med samme verdier og id.
- [ ] «Fjern» på etasje med rom og på bygning med innhold virker med ett trykk, som én slettegruppe med ett tidspunkt; meldingen sier hva som gikk med, og «Angre» henter hele gruppen, men ikke rom som var fjernet før (A414).
- [ ] Papirkurven viser det som er fjernet fra oppdraget, med hva, hvor, areal for etasjer, hvem og når («i dag 14:02»), nyeste først, slettegrupper som én linje; «Gjenopprett» henter det tilbake og fjerner det fra listen.
- [ ] Rom i fjernet etasje: etasjen (og bygningen) kommer tilbake sammen med rommet, men ikke andre rom, og den ansatte får beskjed (A410).
- [ ] Arealraden kommer tilbake med etasjen, unntatt når etasjen har fått en ny aktiv arealrad (A411); eldre rader med litt ulik tid håndteres.
- [ ] Part med fjernet kontakt kommer tilbake uten kobling, med beskjed (A415).
- [ ] Rom og etasjer med arkiverte koder gjenopprettes uendret.
- [ ] Gjenoppretting to ganger gir ingen endring og ingen ny hendelse.
- [ ] Kansellert oppdrag: `listTrash` og `restore*` gir avslag for alle roller, uten spor (A416); takstmann uten endringsrett får avslag og ser ikke «Gjenopprett».
- [ ] Hver rad som fjernes eller hentes tilbake, gir én linje i revisjonsloggen, og hendelsene har de strukturerte feltene uten persondata, i samme transaksjon.
- [ ] KI-forslag som peker på et gjenopprettet rom, vises igjen uendret (test).
- [ ] Ingen rad slettes permanent (test som teller rader før og etter i alle fem tabellene).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for `listTrash` og hver `restore*`).
- [ ] Meldingen og papirkurven virker med tastatur, skjermleser og Cmd/Ctrl+Z, overlever revalidering, viser feil tydelig, og virker på iPad-størrelse (e2e).
- [ ] KI-forslag: ingen i denne oppgaven (se «KI i bunnen»).

## Lagt til av forbedreren
Ført i `docs/plan/forbedrerens-tillegg.md` 16.11.2026.
- **«Fjern» tar med innholdet** som én slettegruppe, og «Angre» henter hele gruppen (A414). Erstatter A98.
- **Cmd/Ctrl+Z, én melding om gangen med «Mer i papirkurven», meldingen overlever revalidering, uthevet rad etter gjenoppretting.**
- **Rikere linjer i papirkurven:** hvor, areal for etasjer, hvem og når i klarspråk, slettegruppe som én linje.
- **Strukturerte felt i hendelsene** (`roomTypeKey`/`floorKey`, `groupCount`, `how`, `secondsSinceRemoval`).
- Nytt planpunkt (bygges ikke her): «Historikk på oppdraget, med KI-sammendrag av endringer» under «Fra forbedreren» i 2a-3.

## Avgjort av prosjektlederen ved uenighet
- **Fjerning med innhold (forbedreren) mot «bare tomme» (ux-ansvarlig, A98):** forbedreren følges. A98 var en agentbeslutning merket «lett å endre», og med «Angre» og papirkurv er sperren ikke lenger nødvendig for å beskytte rommene. Ux-ansvarliges poeng (ingen skal tro at bygningen fjernes alene) dekkes av meldingen, som sier hva som gikk med.
- **Kansellert oppdrag: «bare lesing» (ux, test-leder) mot «avslag» (sikkerhet-personvern):** avslag følges, fordi dagens regel er at ingenting på et kansellert oppdrag kan leses (punkt 4.4.1b). Å åpne papirkurven der ville gi lesetilgang bakveien.
- **Rettigheter:** `assignment.view` finnes ikke; `organization.read` og `assignment.edit` brukes.
- **Part med fjernet kontakt:** null-kobling og beskjed (sikkerhet-personvern og ux er enige; sammenslåing er dekket av at koblingen allerede er flyttet).

## Åpne spørsmål
- Nr. 85 til Ståle (personvern): hvor lenge og for hvem fjernede parter skal vises med navn i papirkurven, og om det trengs en egen vei for retting og sletting etter GDPR artikkel 16 og 17. Stopper ikke oppgaven; til han svarer vises bare navn og rolle.
- A410–A418 er alle «lett å endre»: ingen nye tabeller, og dataene er de samme om reglene endres.
