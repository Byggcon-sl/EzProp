# Skisse: Admin – selskaper, kontorer, ansatte og roller

- **Oppgavekort:** `docs/funksjoner/fase0b-admin-organisasjon.md`
- **Fra:** ui-designer, 31.10.2026
- **Målt mot:** `docs/design/bilder/A-dashbord.png` og `A-ipad-staende.png`, `.card`, `.row`, `.pill` og `.tag` i `docs/design/retning-A.html`, og rammen i `docs/funksjoner/fase0b-grunnlayout-fjord-skisse.md` (PR #51)
- **Støtter hovedmål:** Tid (admin legger inn en ansatt med 3 trykk og ett skjema, uten utvikler). Reklamasjoner (riktig selskap, forsikring og firmatekst før rapporten i fase 2a; utløpt forsikring vises med tekst; feil vises ved feltet). KI først: ingen KI her, men rollene som styrer `report.publish` gis her.

Bare lys visning. Rammen (topplinje, meny, innholdsflate) er uendret, bortsett fra menypunktet «Admin». Tailwind-klassene er forslag; mål, tekster og tilstander er det som gjelder.

## 1. Sider og navigasjon

| Adresse | Innhold | Hovedhandling |
|---|---|---|
| `/admin` | sender videre til `/admin/ansatte` (den som brukes mest) | – |
| `/admin/ansatte` | liste over ansatte | «Ny ansatt» |
| `/admin/ansatte/ny` | skjema for ny ansatt | «Lagre» |
| `/admin/ansatte/[id]` | opplysninger, roller, enkeltrettigheter, sluttet | «Lagre» (opplysninger) |
| `/admin/selskaper` | liste over selskaper | «Nytt selskap» |
| `/admin/selskaper/ny` og `/admin/selskaper/[id]` | skjema for selskap | «Lagre» |
| `/admin/kontorer` | liste over kontorer | «Nytt kontor» |
| `/admin/kontorer/ny` og `/admin/kontorer/[id]` | skjema for kontor | «Lagre» |

Egne sider for skjemaene, ingen dialogbokser eller paneler. Det gir enkel tastaturflyt, en adresse per skjema og ingen klienttilstand.

**Antall trykk, ny ansatt:** «Admin» (1, lander på Ansatte) → «Ny ansatt» (1) → fyll ut → «Lagre» (1). Tre trykk. Før: utvikler i databasen.

### Menypunktet «Admin» i rammen

- Eget punkt i hovedmenyen, nederst i listen før «Du jobber for», i en egen `<ul>` med gruppenavnet «Organisasjon» (samme stil som «Prøver»).
- Vises bare når layouten har fått bekreftet `organization.manage` fra `src/core/access`. Ingen rollesjekk i komponenten.
- `NavLink href="/admin" matchChildren`, så punktet er aktivt på alle sidene under. (`matchChildren` trengs altså; småfunnet i liten oppgave (l) om at den ikke trengs, faller bort.)
- Ikon 18 px som de andre: tannhjul eller tre personer (`stroke="currentColor"`, `stroke-width="1.8"`, `aria-hidden`).

### Undermeny i adminområdet

Øverst på hver adminside, over overskriften:

```
<nav aria-label="Admin">   [ Ansatte ]  [ Selskaper ]  [ Kontorer ]
```

- Samme utseende som menypunktene i raden under `lg` i rammen: `inline-flex min-h-11 px-4 rounded-[10px] bg-white ring-1 ring-slate-200 text-sm text-slate-700`, aktivt `bg-brand-100 text-brand-900 font-medium` og `aria-current="page"` (også på `ny` og `[id]` under).
- Lages med `NavLink` (den finnes). Ingen ny komponent.
- Rekkefølge: Ansatte, Selskaper, Kontorer (oftest brukt først).

## 2. Oppbygning av en listeside

### PC og iPad liggende (fra `lg`)

```
+---------------------+----------------------------------------------------+
| > Arbeidskø         | [Ansatte] [Selskaper] [Kontorer]                   |
| PRØVER              |                                                    |
|   Testskjema …      | Ansatte (h1)                       [ Ny ansatt ]   |
| ORGANISASJON        |                                                    |
| > Admin             | +------------------------------------------------+ |
|                     | | Kari Nordmann                         Endre >  | |
|                     | | Takstingeniør · Byggcon AS · Bodø              | |
|                     | | [Admin] [Takstmann]                            | |
|                     | |------------------------------------------------| |
|                     | | Ola Eksempel                          Endre >  | |
|                     | | …                                              | |
|                     | +------------------------------------------------+ |
|                     |                                                    |
|                     | Har sluttet (h2)                                   |
|                     | +------------------------------------------------+ |
|                     | | Per Tidligere                [Sluttet] Endre > | |
|                     | +------------------------------------------------+ |
+---------------------+----------------------------------------------------+
```

### iPad stående (under `lg`, 834 px)

```
+--------------------------------------------------+
| [Ez] EzProp                    (KN)  [ Logg ut ] |
| [Arbeidskø] Prøver: [Testskjema] Org.: [Admin]   |
| Du jobber for Byggcon                            |
+--------------------------------------------------+
| [Ansatte] [Selskaper] [Kontorer]                 |
| Ansatte (h1)                       [ Ny ansatt ] |
| +----------------------------------------------+ |
| | Kari Nordmann                       Endre >  | |
| | Takstingeniør · Byggcon AS · Bodø            | |
| | [Admin] [Takstmann]                          | |
| +----------------------------------------------+ |
```

Samme oppbygning på alle bredder. Radene bryter linjen når teksten er lang (`flex-wrap`), ingen vannrett rulling.

### Deler

| Del | Mål og stil | Merknad |
|---|---|---|
| `<main>` | `max-w-4xl` (listene), `max-w-2xl` (skjemaene) | Siden har selv `<main>`, som i rammen |
| Overskriftsrad | `flex flex-wrap items-center justify-between gap-3 mt-6` | h1 til venstre, hovedknapp til høyre |
| h1 | 24 px (`text-2xl`) `font-semibold text-slate-900` | «Ansatte», «Selskaper», «Kontorer» |
| Hovedknapp | `Button` primary, `size="md"` (44 px), som lenke (`Link` med `buttonVariants()`) | «Ny ansatt», «Nytt selskap», «Nytt kontor» |
| Liste | `Card` med `p-0`, innhold `<ul>`, `mt-6` | Skjermleseren sier antall |
| Rad | `<li>` med én `Link` som dekker hele raden: `flex items-center gap-3 min-h-14 px-5 py-3`, `border-t border-slate-200` (ikke på første), `hover:bg-brand-50` | Hele raden er trykkflaten (minst 56 px høy) |
| Tittel i raden | 16 px `font-medium text-slate-900` | Navn eller juridisk navn |
| Linje 2 | 14 px `text-slate-600`, deler skilt med « · » | Tomme felt tas ikke med |
| «Endre» | `ml-auto`, 14 px `font-medium text-brand-700` og pil `aria-hidden` | Lenketeksten for skjermleser: «Endre Kari Nordmann» (`sr-only`-del) |
| Merke (`Badge`) | `inline-flex h-6 px-2.5 rounded-full text-xs font-medium` | Se avsnitt 5 |
| Tom liste | Kort med «Ingen ansatte ennå.» / «Ingen selskaper ennå.» / «Ingen kontorer ennå.» 16 px `text-slate-600` | Hovedknappen står over |

## 3. Listene

### Ansatte (`/admin/ansatte`)

- Sortert på navn. Ansatte som har sluttet, står i et eget kort under h2 «Har sluttet» (20 px `text-lg font-semibold`, `mt-10`). Kortet vises bare når noen har sluttet.
- Rad: navn; linje 2 «stilling · selskap · kontor» og e-posten på egen linje i 14 px `text-slate-600` (bare admin ser denne siden, oppgavekortet Omfang 2); rollemerker i rekkefølgen Admin, Leder, Kontor, Takstmann.
- Har sluttet: merket «Sluttet» i stedet for rollemerkene. Raden er `text-slate-600` i tittelen også, men lenken virker (for «Angre sluttet»).
- Ansatt uten roller: merket «Ingen roller».

### Selskaper (`/admin/selskaper`)

- Rad: juridisk navn; linje 2 «Org.nr. 123 456 789 · Forsikring gyldig til 31.12.2027».
- Org.nr. vises i grupper på tre for lesing (lagres uten mellomrom).
- Mangler org.nr. eller forsikring: «Org.nr. mangler» / «Forsikring mangler» i linje 2, og merket «Mangler opplysninger». Utløpt dato (før i dag): merket «Forsikring utløpt». Begge er tekst, ikke bare farge. *Hvorfor:* manglende eller utløpt forsikring på rapporten gir reklamasjoner.

### Kontorer (`/admin/kontorer`)

- Sortert på rekkefølge, så navn. Rad: navn; linje 2 adresse. Rekkefølgen vises ikke i raden (den bestemmer bare sorteringen).

## 4. Skjemaene

Felles for alle skjema:

- `<main class="max-w-2xl">`, undermenyen, så lenken «‹ Tilbake til ansatte» (14 px `text-brand-700`, `min-h-11`), så h1 («Ny ansatt», «Endre ansatt», «Nytt selskap», «Endre selskap», «Nytt kontor», «Endre kontor»).
- Feltene i ett `Card`, `space-y-5`. Ett felt per linje på iPad stående; fra `md` kan korte felt stå to og to (`grid md:grid-cols-2 gap-5`) der det står «halv» under.
- Knapperad nederst i kortet: «Lagre» (`Button` primary, `size="lg"`, 56 px) og «Avbryt» (`Link`, ghost, 44 px, tilbake til listen). Ikke fast nederst på skjermen: skjemaene er korte, og det er kontorarbeid.
- Server action, ingen klientvalidering utover `required`, `type="email"`, `inputmode` og `type="date"`. Zod på serveren er fasit.
- Etter lagring: tilbake til listen med en kvittering øverst (avsnitt 6). Feil: samme side, verdiene står, se avsnitt 6.
- Valgfrie felt merkes «(valgfritt)» i etiketten. Påkrevde felt merkes ikke (de fleste er valgfrie, så det er færre ord sånn).

### Selskap

| Felt | Kontroll | Bredde | Merknad |
|---|---|---|---|
| Juridisk navn | `Input` | hel | påkrevd |
| Org.nr. (valgfritt) | `Input inputmode="numeric" autocomplete="off"` | halv | hjelpetekst «9 siffer». Mellomrom fjernes før sjekk |
| Registrert i MVA-registeret | `Checkbox` | hel | standard på |
| Adresse (valgfritt) | `Input autocomplete="street-address"` | hel | |
| Postnummer (valgfritt) | `Input inputmode="numeric"` | halv | |
| Sted (valgfritt) | `Input` | halv | |
| Firmatekst (valgfritt) | `Textarea` 6 linjer, vokser | hel | hjelpetekst «Står i rapporten.» |
| **Ansvarsforsikring** | `<fieldset>` med `<legend>` 16 px `font-medium` | | egen gruppe, `pt-2 border-t` |
| Forsikringsselskap (valgfritt) | `Input` | hel | |
| Polisenummer (valgfritt) | `Input` | halv | |
| Gyldig til (valgfritt) | `Input type="date"` | halv | iPad viser egen datovelger |

### Kontor

| Felt | Kontroll | Bredde | Merknad |
|---|---|---|---|
| Navn | `Input` | hel | påkrevd |
| Adresse (valgfritt) | `Input` | hel | |
| Rekkefølge | `Input inputmode="numeric"` | halv | hjelpetekst «Lavest står først i lister.» Standard 0 |

### Ny ansatt (`/admin/ansatte/ny`)

| Felt | Kontroll | Merknad |
|---|---|---|
| Navn | `Input autocomplete="off"` | påkrevd |
| E-post | `Input type="email" autocomplete="off"` | påkrevd. Hjelpetekst: «Personen logger inn med en kode som sendes til denne adressen. Den kan ikke endres senere.» |
| Stilling (valgfritt) | `Input` | |
| Selskap (valgfritt) | `RadioGroup`: «Ikke valgt» + selskapene | radioknapper, ikke nedtrekksmeny (4 selskaper, raskere på iPad) |
| Kontor (valgfritt) | `RadioGroup`: «Ikke valgt» + kontorene i rekkefølge | 5 kontorer |
| Roller | `CheckboxGroup`: Takstmann, Kontor, Leder, Admin | «Takstmann» er avkrysset fra start (de fleste nye er takstmenn; sparer ett trykk) |

Under kortet, før «Lagre»: «Det sendes ingen e-post. Si fra til personen at de kan logge inn på {adressen til /logg-inn}.» 14 px `text-slate-600`.

Enkeltrettigheter er ikke med i dette skjemaet; de gis på siden til den ansatte. Det holder skjemaet kort.

### Ansatt (`/admin/ansatte/[id]`)

Fire kort under hverandre, hvert med h2 (18 px `text-lg font-semibold`) og eget skjema. Lagres hver for seg, så en feil (for eksempel «minst én admin») hører til ett kort.

```
Kari Nordmann (h1)                       [Admin] [Takstmann]
kari@eksempel.no

+-- Opplysninger --------------------------------+
| Navn / Stilling / Selskap / Kontor             |
| E-post: kari@eksempel.no (kan ikke endres)     |
|                              [ Lagre ]         |  primary, lg
+------------------------------------------------+
+-- Roller --------------------------------------+
| [x] Takstmann  [ ] Kontor  [ ] Leder  [x] Admin|
|                         [ Lagre roller ]       |  secondary, md
+------------------------------------------------+
+-- Enkeltrettigheter ---------------------------+
| I tillegg til rollene.                         |
| [ ] Endre malstruktur                          |
| [ ] Endre oppdrag                              |
| [ ] Endre rapport                              |
| [ ] Publisere rapport                          |
|                     [ Lagre rettigheter ]      |  secondary, md
+------------------------------------------------+
+-- Har sluttet ---------------------------------+
| Personen kan ikke bruke systemet, men står     |
| fortsatt på rapportene sine. Kan angres.       |
|                         [ Har sluttet ]        |  secondary, md
+------------------------------------------------+
```

- **Opplysninger:** som «Ny ansatt», uten roller. E-posten vises som tekst (`<p>`, ikke felt), med «Kan ikke endres. Er den feil: marker som sluttet og legg inn personen på nytt.»
- **Roller:** `CheckboxGroup` med de fire rollene og en kort forklaring under hver (12–14 px `text-slate-600`):
  - Takstmann – befaring og rapporter.
  - Kontor – ordre og oppdrag.
  - Leder – også reklamasjonssaker og rutiner.
  - Admin – alt, også ansatte og selskaper.
- **Enkeltrettigheter:** `CheckboxGroup` med de fire som kan gis (`grantablePermissions`). Etiketter:
  - `template.edit_structure` → «Endre malstruktur»
  - `assignment.edit` → «Endre oppdrag»
  - `report.edit` → «Endre rapport»
  - `report.publish` → «Publisere rapport»
  Ingen visning av hva rollen alt gir (det er tilgangslogikk og skal ikke ligge i siden).
- **Har sluttet:** knappen «Har sluttet» uten ekstra bekreftelse, fordi den kan angres med ett trykk. Når personen har sluttet: kortet heter «Sluttet», teksten «Sluttet {dato}. Personen kan ikke bruke systemet.» og knappen «Angre sluttet». Mangler personen innlogging, vises «Kan ikke angres: personen har ingen innlogging.» i stedet for knappen.
- Har personen sluttet, er kortene «Opplysninger», «Roller» og «Enkeltrettigheter» fortsatt synlige, men felt og knapper er `disabled` med teksten «Angre sluttet for å endre.» øverst. *Hvorfor:* hindrer endringer på en som ikke jobber her, uten å skjule historikken. (Er dette mer enn utvikler vil bygge, er det godt nok å la dem stå åpne; sjekken på serveren er uansett fasit.)

Navnelengde: lange navn og e-poster brytes (`break-words`), aldri kuttet med «…».

## 5. Nye og endrede komponenter i `src/shared/ui`

Få og gjenbrukbare. Alt annet bruker `Card`, `Button`, `Field`, `Input` og `FormMessage` som de er.

| Komponent | Fil | Spesifikasjon |
|---|---|---|
| `Field` (endres) | `form.tsx` | Nye valgfrie `hint` og `error`. Hint: `<p id="{htmlFor}-hint">` 14 px `text-slate-600`. Feil: `<p id="{htmlFor}-error">` 14 px `text-red-800` med «Feil:» som `sr-only` foran. Barnet får `aria-describedby` med begge id-ene og `aria-invalid="true"` ved feil (sendes inn av siden, eller via `cloneElement`; utvikler velger det enkleste) |
| `Input` (endres) | `form.tsx` | Ved `aria-invalid="true"`: `border-red-700` (kant minst 3:1). Ellers uendret |
| `Textarea` | `form.tsx` | Samme stil som `Input`, `min-h-32 py-2.5`, `resize-y` |
| `Checkbox` | `form.tsx` | `<label>` som omslutter `<input type="checkbox">` og tekst: `flex items-start gap-3 min-h-11 py-2.5`, boksen 20x20 px (`size-5 accent-brand-600`). Hele raden er trykkflaten. Valgfri `description` under teksten |
| `Radio` | `form.tsx` | Som `Checkbox`, med `type="radio"` |
| `ChoiceGroup` | `form.tsx` | `<fieldset>` med `<legend>` (14 px `font-medium text-slate-700`, som `Field`-etiketten), `hint` og `error` som `Field`. Barn: `Checkbox` eller `Radio`. Fra `md` kan valgene stå i to kolonner (`md:grid-cols-2`) |
| `Badge` | `badge.tsx` (ny) | `<span>` `inline-flex items-center h-6 px-2.5 rounded-full text-xs font-medium`. Toner: `neutral` (`bg-slate-100 text-slate-700`), `brand` (`bg-brand-50 text-brand-700`), `warning` (`bg-amber-50 text-amber-900`). Brukes til roller, «Sluttet», «Mangler opplysninger», «Forsikring utløpt». Teksten bærer alltid meningen |
| `Notice` | `form.tsx` | Kvittering etter lagring: `role="status"`, `rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900`. Speil av `FormMessage` (som er for feil) |

Ingen ny avhengighet.

Rollemerker: Admin `brand`, de andre `neutral`. «Sluttet» `neutral`. «Mangler opplysninger» og «Forsikring utløpt» `warning`.

## 6. Tekster

| Hvor | Tekst |
|---|---|
| Menypunkt | «Admin» (gruppenavn «Organisasjon») |
| Undermeny | «Ansatte», «Selskaper», «Kontorer» |
| Sidetitler (`metadata`) | «Ansatte – {produktnavn}», «Ny ansatt – …», «Endre ansatt – …», tilsvarende for selskaper og kontorer |
| Kvittering | «Selskapet er lagret.», «Kontoret er lagret.», «Den ansatte er lagt inn.», «Endringene er lagret.», «Rollene er lagret.», «Rettighetene er lagret.», «Markert som sluttet.», «Sluttet er angret.» |
| Ingen tilgang | Siden «Ingen tilgang» (eller 404, som kortet sier): h1 «Ingen tilgang», «Du har ikke tilgang til denne siden.» og lenke «Til arbeidskøen». Ingen data, ingen navn |

### Feilmeldinger (ved feltet)

| Felt / regel | Melding |
|---|---|
| Navn tomt | «Skriv inn navnet.» |
| Juridisk navn tomt | «Skriv inn det juridiske navnet.» |
| Kontornavn tomt | «Skriv inn navnet på kontoret.» |
| Org.nr. feil | «Org.nr. må være 9 siffer.» |
| Org.nr. finnes | «Det finnes alt et selskap med dette org.nr.» |
| E-post feil | «Skriv inn en gyldig e-postadresse.» |
| E-post finnes | «Det finnes alt en ansatt med denne e-posten.» |
| Gyldig til | «Skriv inn en gyldig dato.» |
| Postnummer | «Postnummeret må være 4 siffer.» (bare hvis utvikler validerer det; ellers ingen sjekk) |
| Rekkefølge | «Skriv inn et helt tall.» |
| Selskap eller kontor finnes ikke lenger | «Velg et annet selskap.» / «Velg et annet kontor.» |
| Siste admin (Roller og Har sluttet) | «Organisasjonen må ha minst én admin.» som `FormMessage` øverst i kortet |
| Ukjent feil | «Noe gikk galt. Ingenting er lagret. Prøv igjen.» som `FormMessage` øverst i kortet |

Ved feil: `FormMessage` øverst i skjemaet med «Rett feltene som er merket.», og fokus flyttes til den meldingen. Feltene beholder verdiene.

## 7. Tilstander

| Tilstand | Hva vises |
|---|---|
| Admin | menypunktet «Admin» og alle sidene |
| Takstmann, kontor, leder | ikke menypunktet; `/admin/**` gir «Ingen tilgang» eller 404, ingen data |
| Tom liste | tomt kort med tekst (avsnitt 2), hovedknappen over |
| Lagrer | knappen `disabled` med teksten «Lagrer …» (`useFormStatus`), `aria-live` ikke nødvendig fordi kvitteringen kommer på neste side |
| Lagret | listen med kvittering (`Notice`) øverst |
| Feil i felt | se avsnitt 6 |
| Siste admin | kortet beholder avkryssingen slik den var før, med meldingen øverst |
| Ansatt har sluttet | kortet «Sluttet» med «Angre sluttet»; andre kort `disabled` |
| Ugyldig eller fremmed id | «Ingen tilgang» eller 404, samme svar uansett |

Ingen lastetilstand for listene: de tegnes på serveren.

## 8. Fargepar for kontrasttesten (nye)

Krav: tekst minst 4,5:1, kanter og ikoner minst 3:1. Paret fra rammen (`slate-600`, `brand-700` osv.) gjelder fortsatt.

| Tekst / kant | Bakgrunn | Brukes til | Kontrast |
|---|---|---|---|
| `slate-700` #334155 | `slate-100` #f1f5f9 | merket `neutral` | ca. 9,4:1 |
| `brand-700` #285786 | `brand-50` #eef4fa | merket `brand` | ca. 6,7:1 |
| `amber-900` #78350f | `amber-50` #fffbeb | merket `warning` | ca. 8,9:1 |
| `red-800` #991b1b | hvit | feil ved feltet | ca. 8,3:1 |
| `red-700` #b91c1c (kant) | hvit | felt med feil | ca. 6,5:1 |
| `emerald-900` #064e3b | `emerald-50` #ecfdf5 | kvittering | ca. 9,2:1 |
| `brand-700` #285786 | `brand-50` #eef4fa | «Endre» i rad med hover | ca. 6,7:1 |
| `field` #8391a5 (kant) | hvit | felt, avkryssingsboks | ca. 3,2:1 |

Utvikler legger de nye parene i `contrast.test.ts` og regner tallene på nytt der.

## 9. Tastatur og skjermleser

- Tab-rekkefølge på en listeside: rammen → undermenyen → hovedknappen → radene i rekkefølge. Hver rad er én lenke (ikke en lenke i en lenke).
- Skjema: feltene i den rekkefølgen de står → «Lagre» → «Avbryt». Enter i et tekstfelt sender skjemaet (vanlig `<form>`). Ett skjema skal kunne fylles ut og sendes med tastaturet alene (e2e).
- Radio og avkryssing: piltaster i radiogruppen, mellomrom på avkryssing (nettleserens egne kontroller, ingen egne).
- Landemerker: `banner`, `navigation` «Hovedmeny», `navigation` «Admin», `main`.
- Hver gruppe (`ChoiceGroup`, «Ansvarsforsikring») er `<fieldset>` med `<legend>`, så skjermleseren sier gruppenavnet.
- Merker leses som tekst i raden, i rekkefølge. Ingen informasjon bare med farge.
- Fokus etter lagring: på neste side står kvitteringen øverst (`role="status"`); fokus starter på `<main>` som vanlig sidebytte.
- Trykkflater: rader minst 56 px, knapper og avkryssing minst 44 px, «Lagre» 56 px.

## 10. Ikke med

Søk og filter i listene, sortering ved klikk, flere organisasjoner, sletting eller arkivering av selskaper og kontorer, logo, signatur, telefon, sertifisering, bryteren `access.inspectors_edit_all`, invitasjon på e-post, dialogbokser, fast knapperad nederst, mørk visning. Alt står i «Ikke med» i oppgavekortet eller hører til senere punkter.
