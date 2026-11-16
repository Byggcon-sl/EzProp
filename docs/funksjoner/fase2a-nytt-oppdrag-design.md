# Design: «Nytt oppdrag» (komponentspesifikasjon)

- **Oppgavekort:** `docs/funksjoner/fase2a-nytt-oppdrag.md` (Omfang 6, 7, 8, 9, 10 og 11, og lenken på ordresiden)
- **Grunnlag:** `docs/08-designprinsipper.md` (Byggcon-profilen), `docs/design/bilder/A-dashbord.png` (knappen «+ Nytt oppdrag» øverst til høyre), `docs/design/bilder/A-oppdrag.png` og `A-ipad-*.png` (luft og trykkflater)
- **Dato:** 14.11.2026
- **Støtter hovedmål:**
  - **De ansatte:** ett skjema, forhåndsvalg for kontor og ansvarlig og ingen nedtrekkslister gir 2 trykk fra køen til lagret oppdrag (ux).
  - **KI i bunnen:** skjemaet bygges av gjenbrukbare felt med faste `name`. KI kan senere fylle det samme skjemaet som forslag (krok A1) uten nye komponenter. Ingen KI i denne oppgaven, og derfor heller ikke noe KI-merke.
  - **Færre reklamasjoner:** dublettvarselet vises mens du fyller ut, og adresse og matrikkel står øverst.

Ingen nye komponenter i `src/shared/ui`. Alt bygges av `Card`, `Button`, `buttonVariants`, `Field`, `Input`, `Radio`, `ChoiceGroup`, `FormMessage` og `Notice`, og av delene i `(ansatt)`: `SubmitButton`, `FormErrors`, `ContactPicker`, `OrderFields`, `PossibleDuplicatesNotice` og `NavLink`.

## 1. Hva som lages

| Del | Fil (forslag) | Ny eller endret |
|---|---|---|
| Knappen i arbeidskøen | `arbeidskoe/page.tsx` | endret |
| Menypunktet | `(ansatt)/layout.tsx` | endret |
| Siden `/oppdrag/ny` | `oppdrag/ny/page.tsx`, `oppdrag/ny/assignment-form.tsx` | ny |
| Felles felt | `ordre/order-fields.tsx` (`OrderFields` får `layout`) | endret |
| Velger for ansvarlig | `oppdrag/ny/inspector-choice.tsx` | ny |
| Dublettvarsel | `ordre/[id]/possible-duplicates-notice.tsx` flyttes til `(ansatt)/possible-duplicates-notice.tsx` og tar treff fra både ordre og oppdrag | endret |
| Kortet «Bestilling» med «Endre» og «Endringer» | `oppdrag/[id]/booking-card.tsx`, `oppdrag/[id]/booking-history.tsx` | ny |
| Lenken på ordresiden | `ordre/[id]/order-edit-form.tsx` og `ordre/[id]/page.tsx` | endret |

## 2. Knappen «Nytt oppdrag» i arbeidskøen

Som i A: overskriften til venstre, hovedknappen til høyre på samme linje.

```
Arbeidskø                                   [ + Nytt oppdrag ]   <- night, pille, 56 px
Hei, Ingrid.
[Bestilt 3][Under arbeid 5][Ferdig 2][Fakturert 0]
...
```

- Lenke (`<Link href="/oppdrag/ny">`) med `buttonVariants({ variant: "primary", size: "lg" })`, plusstegn (svg 20 px, `aria-hidden`) foran teksten «Nytt oppdrag».
- Raden: `flex flex-wrap items-start justify-between gap-3`. På smal skjerm (iPad stående) bryter knappen under hilsenen, venstrestilt. Ingen vannrett rulling.
- Vises bare når den ansatte har `assignment.edit` (nytt flagg `canCreateAssignments` i `getEmployeeContext()`, regnet ut i `src/core/access`). Vises også når køen er tom.
- **Tom kø i fanen «Bestilt»:** lenken «Ny ordre» i det tomme kortet byttes til «Nytt oppdrag», men som **sekundærknapp** (`variant: "secondary"`, `size: "md"`), fordi hovedknappen allerede står øverst (én hovedhandling per skjerm). Vises bare med samme flagg.

## 3. Menypunktet

- Første punkt i «Hovedmeny», før «Arbeidskø»: `NavLink href="/oppdrag/ny"` med `PlusIcon` (samme strek 1,8 og 18 px som de andre ikonene) og teksten «Nytt oppdrag».
- Samme stil som de andre menypunktene (ikke pilleknapp), så menyen holder seg rolig. Aktivt (night) når du står på `/oppdrag/ny`.
- Vises bare med `canCreateAssignments`. «Ordre» står som i dag.

## 4. Siden `/oppdrag/ny`

`<main className="max-w-2xl">`, som ordre- og oppdragssiden. Én kolonne på PC og iPad. Tittel i fanen: «Nytt oppdrag».

```
‹ Arbeidskø
Nytt oppdrag                                   (h1, Schibsted Grotesk)
Rapporttype: Tilstandsrapport                  (fast tekst, stone)

┌ Eiendom ───────────────────────────────────┐
│ Adresse                                    │
│ [__________________________________]       │
│ Matrikkel (valgfritt)                      │
│ Gårdsnummer   Bruksnummer   Seksjonsnummer │
│ [_____]       [_____]       [_____]        │
└────────────────────────────────────────────┘
┌ Bestiller ─────────────────────────────────┐
│ Søk i kontakter  [__________]   (ContactPicker)
│ Hvem bestilte (valgfritt) [______________] │
└────────────────────────────────────────────┘
┌ Befaring og ansvar ────────────────────────┐
│ Avtalt befaring (valgfritt) [dd.mm.åååå tt:mm]
│ Kontor                                     │
│ (•) Bodø        ( ) Tromsø                 │
│ Ansvarlig takstmann                        │
│ (•) Ingrid Holm (deg)                      │
│ ( ) Mats Hågensen   ( ) Kari Nygård  ...   │
└────────────────────────────────────────────┘
┌ Mer om bestillingen ───────────────────────┐
│ Mottatt [14.11.2026 09:12]                 │
│ Meglerens ordrenummer (valgfritt) [______] │
│ Borettslag eller sameie (valgfritt) [____] │
└────────────────────────────────────────────┘
[ ! Mulig dublett ... ]                       (bare ved treff)
[ Ikke lagret. Du er uten nett ... ]          (bare ved feil)
[      Lagre      ]   Avbryt                  (Lagre: night, 56 px)
```

### 4.1 Oppbygging

- Lenken «‹ Arbeidskø» øverst (samme stil som «‹ Tilbake til ordre», minst 44 px).
- Fire kort (`Card`, `space-y-5`) med `h2` i Inter 600, `text-lg` (kortoverskrifter er `h2` i dokumentet, men får samme størrelse som kortoverskriftene på oppdragssiden). Avstand mellom kortene `space-y-6`.
- Hele siden er ett `<form noValidate>`. Rekkefølgen i tastaturet følger rekkefølgen over.
- «Mer om bestillingen» er et synlig kort nederst, ikke sammenfoldet (oppgavekortet: «synlig avsnitt»).
- Skjult felt `creationKey` (uuid laget på serveren når siden lages). Skjult felt for rapporttype finnes ikke; kjernen setter den.

### 4.2 Feltene

| Felt | `name` | Komponent | Etikett | Hjelpetekst | Merknad |
|---|---|---|---|---|---|
| Adresse | `addressText` | `Input`, `autoComplete="off"` | «Adresse» | «Gate, nummer, postnummer og sted.» | påkrevd, `maxLength` 300 |
| Gårdsnummer | `gnr` | `Input`, `inputMode="numeric"` | «Gårdsnummer» | | i `ChoiceGroup`-lik `fieldset` med `legend` «Matrikkel (valgfritt)», tre kolonner fra `md`, én kolonne under |
| Bruksnummer | `bnr` | som over | «Bruksnummer» | | |
| Seksjonsnummer | `snr` | som over | «Seksjonsnummer» | | |
| Kontakt | `orderedByContactId` | `ContactPicker` | som i dag | som i dag | fyller «Hvem bestilte» |
| Hvem bestilte | `orderedByText` | `Input` | «Hvem bestilte (valgfritt)» | som i dag | `maxLength` 200 |
| Avtalt befaring | `inspectionAt` | `Input type="datetime-local"` | «Avtalt befaring (valgfritt)» | «La stå tom hvis befaringen ikke er avtalt.» | norsk tid |
| Kontor | `officeId` | `ChoiceGroup` + `Radio` | legend «Kontor» | | se 4.3 |
| Ansvarlig | `responsibleEmployeeId` | `InspectorChoice` | legend «Ansvarlig takstmann» | | se 4.4 |
| Mottatt | `receivedAt` | `Input type="datetime-local"` | «Mottatt» | | nå som standard |
| Meglerens ordrenummer | `externalRef` | `Input` | «Meglerens ordrenummer (valgfritt)» | | `maxLength` 200 |
| Borettslag eller sameie | `housingAssociationName` | `Input` | «Borettslag eller sameie (valgfritt)» | | `maxLength` 200 |

«Egenerklæring mottatt» står ikke i skjemaet (oppgavekortet, Omfang 2).

**`OrderFields` gjenbrukes** med ny prop `layout: "order" | "assignment"` (standard `"order"`, så ordreskjemaene er uendret):
- `"order"`: rekkefølge og etiketter som i dag, med avkrysningen for egenerklæring.
- `"assignment"`: `OrderFields` gir tre deler som siden plasserer i hvert sitt kort: `<OrderFields.Property>` (adresse og matrikkel), `<OrderFields.OrderedBy>` (kontaktvelger og fritekst) og `<OrderFields.More>` (mottatt, meglerens ordrenummer, borettslag). Ingen egenerklæring. Etiketten «Ekstern referanse» heter «Meglerens ordrenummer» her. Hvis utvikler heller vil eksportere tre små komponenter fra samme fil (`OrderPropertyFields`, `OrderedByFields`, `OrderMoreFields`) som `OrderFields` også bruker, er det like godt. Kravet er at `name`, grenser, kontaktvelger og feilvisning finnes ett sted.

### 4.3 Kontor

- `ChoiceGroup id="officeId" legend="Kontor" columns` med én `Radio` per kontor. Hele raden er trykkflaten (minst 44 px). To kolonner fra `md`.
- Den ansattes kontor er valgt fra start (`officeChoice` som på ordresiden). Har organisasjonen ett kontor, vises det som valgt radio likevel (synlig hva oppdraget får).
- Ingen kontorer: kortet viser teksten fra `officeChoice` (`emptyMessage`), og «Lagre» er deaktivert.
- Etter et mislykket forsøk står valget fra forsøket (ny `key` på gruppen per forsøk, som i dag).

### 4.4 Ansvarlig takstmann (`InspectorChoice`)

Ingen nedtrekksliste (prinsipp 6). Radioknapper med søk når listen er lang.

- Props: `candidates: { id: string; name: string }[]` (aktive ansatte med rollen takstmann, fra kjernen), `currentEmployeeId: string | null`, `defaultId: string | null`, `error?: string`, `attempt: number`.
- Rekkefølge: den innloggede først med « (deg)» bak navnet hvis hen er takstmann, deretter alfabetisk.
- Forhåndsvalg: den innloggede hvis hen er takstmann; ellers ingen (kontoret må velge, og feilen «Velg ansvarlig takstmann.» står ved gruppen).
- Mer enn 8 takstmenn: et søkefelt over listen, `Input type="search"` med etikett «Finn takstmann» (synlig etikett, ikke bare plassholder). Søket filtrerer listen i nettleseren på navn, uten kall til serveren. Den valgte står alltid synlig i listen selv om den ikke passer søket. Ingen treff: «Ingen takstmenn passer søket.»
- To kolonner fra `md`.
- Ingen takstmenn i organisasjonen: «Ingen takstmenn er lagt inn. Admin legger dem inn under Ansatte.», og «Lagre» er deaktivert.

### 4.5 Lagre og Avbryt

- `SubmitButton` (`primary`, `lg` = 56 px) med teksten «Lagre», «Lagrer …» og låst mens lagringen pågår. «Avbryt» som `ghost` lenke til `/arbeidskoe`.
- Raden står nederst i skjemaet, under siste kort, ikke fast i bunnen av skjermen: skjemaet er kort, og en fast rad dekker feltene når tastaturet er oppe på iPad.
- Knappen er aldri skjult bak dublettvarselet; varselet står over raden.

### 4.6 Tilstander

| Tilstand | Hva vises |
|---|---|
| Tom (første visning) | Feltene tomme, mottatt = nå, kontor og ansvarlig forhåndsvalgt, fokus ikke flyttet (tastaturet skal ikke sprette opp) |
| Lagrer | «Lagrer …», knappen låst, feltene står |
| Feltfeil | Feilen under feltet (`Field` / `ChoiceGroup`, rød tekst med «Feil:» for skjermleser), kanten rød. Fokus til første felt med feil i skjermrekkefølge. Ingen samlemelding øverst |
| Feil som ikke hører til et felt | `FormMessage` (`role="alert"`) rett over «Lagre», fokus dit (`FormErrors`) |
| Uten nett (før sending eller fordi sendingen falt) | `FormMessage` over «Lagre»: «Ikke lagret. Du er uten nett. Trykk Lagre når du har nett igjen.» Alt som er skrevet står igjen. Ingenting lagres lokalt |
| Ingen tilgang (takstmann med innstillingen av) | Siden viser kortet «Du har ikke tilgang til å lage oppdrag» med teksten «Spør kontoret eller en leder.» og lenken «‹ Arbeidskø». Ingen skjemafelt |
| Lagret | Videre til `/oppdrag/[id]?ny=1` (se 6.1) |

Feilmeldingene ved feltene (forslag; kjernen og Zod eier dem):

| Felt | Melding |
|---|---|
| Adresse tom | «Skriv adressen.» |
| Elleve sifre i et fritekstfelt | «Fødselsnummer skal ikke lagres her.» |
| Matrikkel ikke tall | «Bare tall.» |
| Kontor mangler eller ugyldig | «Velg kontor.» |
| Ansvarlig mangler eller ugyldig | «Velg ansvarlig takstmann.» |
| Befaringstid ugyldig | «Skriv dato og klokkeslett.» |
| Ukjent feil | «Noe gikk galt. Oppdraget er ikke lagret. Prøv igjen.» |

## 5. Dublettvarselet

Ett varsel, brukt både i skjemaet og på oppdragssiden (og fortsatt på ordresiden).

- `PossibleDuplicatesNotice` flyttes til `(ansatt)/` og tar `items: { kind: "order" | "assignment"; id; number: string | null; status; addressText; reasons }[]` og `hasMore`. Lenken går til `/ordre/[id]` eller `/oppdrag/[id]` etter `kind`.
- Utseende som i dag: `watch`-tonene (flate, tekst og kant), varseltrekant, overskrift «Mulig dublett». Det er en advarsel, ikke en feil, og ikke TG.
- Ny tekst under overskriften: «Samme adresse eller matrikkel som et annet oppdrag eller en ordre. Sjekk at boligen ikke blir tatt to ganger.»
- Én lenke per treff, minst 44 px høy, teksten brytes: «Oppdrag 2026-0042 – Storgata 1A, 8006 Bodø – Under arbeid – samme adresse» eller «Ordre – Storgata 1A, 8006 Bodø – Mottatt – samme matrikkel». Status med samme ord som i køen og i ordrelisten. Ingen matrikkel, bestiller eller dato i linjen (oppgavekortet, punkt 4).
- **I skjemaet:** står over «Lagre». Oppslaget gjøres når fokus forlater adressefeltet eller matrikkelgruppen (ikke for hvert tastetrykk). Uten treff, uten nett eller ved feil i oppslaget vises ingenting. Treffene byttes ut ved hvert nytt oppslag. Varselet har `role="status"`, så skjermleseren leser det uten å flytte fokus. Ingen knapp «Lagre likevel»; «Lagre» virker som vanlig.
- **På oppdragssiden:** under kvitteringen og over statuskortet, som på ordresiden. Feiler oppslaget, vises siden uten varsel.

## 6. Oppdragssiden `/oppdrag/[id]`

### 6.1 Kvitteringer

- `?ny=1`: `Notice` «Oppdrag 2026-0042 er lagret.» rett under `h1` (nummeret hentes fra oppdraget, aldri fra adressen). Sand, `role="status"`.
- `?endret=1`: `Notice` «Endringene er lagret.»

### 6.2 Kortet «Bestilling»

Plassering: etter «Befaring og frist» og kontorlinjene, før «Avtale». Ordrelenken «‹ Ordren» øverst på siden står som i dag for oppdrag fra ordre.

```
Bestilling                                         (h2)
┌───────────────────────────────────────────────┐
│ Adresse            Storgata 1A, 8006 Bodø     │
│ Matrikkel          Gnr. 12, bnr. 34, snr. 5   │
│ Hvem bestilte      Line Mørch, Nordlys        │
│                    Kontakt i registeret ›     │
│ Meglerens ordrenr. 55-1234                    │
│ Borettslag/sameie  Ikke oppgitt               │
│ Mottatt            14.11.2026 kl. 09.12       │
│ Fra ordre          Ja (lenke) / ikke vist     │
│                                               │
│ [ Endre bestillingen ]                        │
└───────────────────────────────────────────────┘
▸ Endringer (2)
```

- Visning som `dl` med samme `Detail`-mønster som ordresiden (linje mellom radene, etikett i stone over verdien). Tomme felt: «Ikke oppgitt» i stone. Matrikkel samlet på én linje; tom hvis alle tre mangler.
- «Endre bestillingen»: sekundærknapp, 44 px. Vises med `canEditOrders` og i alle statuser. Trykk åpner skjemaet i samme kort (samme mønster som `OrderEditSection`: fokus til skjemaets overskrift «Endre bestillingen», «Avbryt» setter fokus tilbake til knappen).
- Skjemaet bruker `OrderFields` med `layout="assignment"` (de tre delene etter hverandre, uten kort i kortet) og skjulte felt `assignmentId` og `rowVersion`. «Lagre» (primary, lg) og «Avbryt» (secondary).
- **Konflikt:** «Oppdraget er endret av en annen. Last siden på nytt.» som `FormMessage`, med sekundærknappen «Last siden på nytt». Det som er skrevet, står igjen. Ingen stille overskriving.
- **Uten nett:** «Du er uten nett. Endringen er ikke lagret.» (samme som for ordren).
- Uten `canEditOrders`: bare visningen.

### 6.3 «Endringer»

- `<details>` under kortet, sammenfoldet. `summary` er minst 44 px høy med teksten «Endringer (n)»; uten endringer «Endringer (0)» og innholdet «Ingen endringer ennå.»
- Innholdet er samme liste som `OrderHistory` (tid, hvem, handling, og per felt «Etikett: gammel → ny»). Utvikler trekker listen ut til én felles komponent (`(ansatt)/booking-history.tsx`) som både ordre og oppdrag bruker; ordresiden beholder sin åpne seksjon.
- Sammenfoldet fordi oppdragssiden allerede er lang; på ordresiden er historikken hovedinnhold.

## 7. Ordresiden for en ordre som er gjort om

- I «Endre ordren» byttes setningen «Oppdraget endres ikke. Eiendom og bestiller på oppdraget endres på oppdraget.» til: «Rettelser for oppdraget gjøres på oppdraget. Endringer her flytter ikke oppdraget.» etterfulgt av lenken «Gå til oppdrag 2026-0042» (`min-h-11`, understreket, `fjord-dark`). Kansellert oppdrag: ingen lenke, som i dag.
- Ellers er ordresiden uendret.

## 8. Mål

| Del | Mål |
|---|---|
| Hovedknapp («Nytt oppdrag» i køen, «Lagre») | `min-h-14` (56 px), `px-6`, `text-lg`, pille |
| Sekundærknapp og lenker | minst 44 px høye |
| Radiorader (kontor, ansvarlig) | minst 44 px, hele raden er trykkflaten, `size-5` rundt merke |
| Felt | `min-h-11`, 8 px hjørner, kant `field` |
| Kort | hvit, tynn kant `line`, 12 px hjørner, ingen skygge, indre luft som `Card` i dag |
| Avstand | 24 px mellom kortene, 20 px mellom feltene |
| Bredde | `max-w-2xl`; matrikkel i tre kolonner og radioer i to fra `md` |

## 9. Universell utforming

- Alle felt har synlig etikett; plassholder brukes ikke som etikett.
- Radiogruppene er `fieldset` med `legend`; feilen knyttes med `aria-describedby` og `aria-invalid` (gjør `ChoiceGroup` allerede).
- Fokus: første felt med feil etter mislykket lagring; `FormMessage` for feil uten felt; overskriften når «Endre bestillingen» åpnes.
- Varsler: dublett og kvitteringer med `role="status"`, feil med `role="alert"`.
- Fokusramme i fjord (2 px) på alt som kan trykkes, også `summary`.
- Kontrast: bare tokens fra temaet; `watch`-tekst mot `watch`-flate er godkjent i `contrast.test.ts`.
- Tastatur: Tab følger skjermrekkefølgen; piltaster i radiogruppene; Enter i et tekstfelt sender skjemaet (vanlig oppførsel, og `creationKey` hindrer dobbelt oppdrag).

## 10. Tekster (samlet)

| Sted | Tekst |
|---|---|
| Knapp og menypunkt | «Nytt oppdrag» |
| Tittel og `h1` | «Nytt oppdrag» |
| Rapporttype | «Rapporttype: Tilstandsrapport» |
| Kortoverskrifter | «Eiendom», «Bestiller», «Befaring og ansvar», «Mer om bestillingen» |
| Kontor uten kontorer | tekst fra `officeChoice` |
| Ingen takstmenn | «Ingen takstmenn er lagt inn. Admin legger dem inn under Ansatte.» |
| Søk i takstmenn | «Finn takstmann», ingen treff: «Ingen takstmenn passer søket.» |
| Lagre | «Lagre», «Lagrer …» |
| Uten nett (ny) | «Ikke lagret. Du er uten nett. Trykk Lagre når du har nett igjen.» |
| Ingen tilgang | «Du har ikke tilgang til å lage oppdrag», «Spør kontoret eller en leder.» |
| Kvittering ny | «Oppdrag NNN er lagret.» |
| Kvittering endret | «Endringene er lagret.» |
| Dublett | «Mulig dublett», «Samme adresse eller matrikkel som et annet oppdrag eller en ordre. Sjekk at boligen ikke blir tatt to ganger.», «Viser de 10 nyeste.» |
| Kortet på oppdraget | «Bestilling», «Endre bestillingen», «Endringer (n)» |
| Konflikt | «Oppdraget er endret av en annen. Last siden på nytt.», knapp «Last siden på nytt» |
| Ordresiden, gjort om | «Rettelser for oppdraget gjøres på oppdraget. Endringer her flytter ikke oppdraget.», «Gå til oppdrag NNN» |

## 11. Ikke med

Som oppgavekortet: ingen «Tilbud», ingen endring av menypunktet «Ordre» eller `/ordre/ny`, ingen frist, merknad, parter eller avtale i skjemaet, ingen lokal lagring, ingen KI-forslag, ingen mørk eller kompakt visning.

## 12. Sjekkliste for utvikler

- [ ] Ingen ny komponent i `src/shared/ui`; ingen ny avhengighet.
- [ ] Knappen i køen og menypunktet vises bare med flagget fra `src/core/access`.
- [ ] Ingen `Select` i skjemaet `/oppdrag/ny`.
- [ ] `OrderFields` med `layout="order"` gir samme skjema som før (ordre-e2e uendret).
- [ ] Dublettoppslaget går med POST eller server action, aldri med verdier i adressen.
- [ ] Kvitteringen henter nummeret fra oppdraget.
- [ ] Skjermbilder i PC og iPad stående legges ved PR-en (tom, feltfeil, dublett, uten nett, «Bestilling» åpent).
