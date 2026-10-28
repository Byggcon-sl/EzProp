# IVIT-data som CSV (referanse)

Sist oppdatert: 28.10.2026. Laget av Claude for Ståle Limstrand.

**IVIT-tekstene er iVerdis eiendom. Filene er referanse for å se hva som er dekket. De skal aldri inn i kode, seed-data eller EzProp-maler.**

## Kilde

To Excel-filer i SharePoint (Claude → 03 Arbeidsmappe → 2026-10-22 Eget rapportsystem – kartlegging av IVIT (SL) → EzProp-kartlegging → excel), begge hentet fra IVIT (admin.ivit.no) 24.10.2026:

- `IVIT-standardavvik-og-fraser-2026-10-24.xlsx` (6 faner)
- `IVIT-fraser-Byggcon-2026-10-24.xlsx` (2 faner)

Konvertert 28.10.2026. Alle CSV-filer er UTF-8, komma-separert, med header-rad lik kolonnene i fanen.

## Filer

Fra `IVIT-standardavvik-og-fraser-2026-10-24.xlsx`:

| Fil | Fane | Kolonner | Rader |
|---|---|---|---|
| `ivit-oversikt.csv` | Oversikt (tabellen per kontrollpunkt; fritekst-sammendraget øverst i fanen er ikke tatt med) | Gruppe, Kontrollpunkt, TG0/TG1, TG2, TG3, TGIU, Tiltak | 50 |
| `ivit-avvikssporsmaal.csv` | IVIT avviksspørsmål (ny mal) | Gruppe, Kontrollpunkt, Avviksspørsmål (Ja gir avviket), Vises, TG, Avvikstekst, Antall alternativer, Konsekvens og tiltak (alternativer takstmannen velger mellom) | 343 av 603 – **ufullstendig, se under** |
| `ivit-malfraser.csv` | IVIT malfraser | Gruppe, Kontrollpunkt, Tittel, Tekst | 44 |
| `ivit-frasebank-avvik-gammel.csv` | IVIT frasebank avvik (gammel) | Gruppe, Kontrollpunkt, TG, Tittel, Avvikstekst, Antall tiltak, Standard tiltak | 582 av 822 – **ufullstendig, se under** |
| `ivit-standardfraser.csv` | IVIT standardfraser | Del av rapporten, Felt, Tittel, Tekst | 266 |
| `ivit-byggcon-fraser-alle.csv` | Byggcon-fraser alle | Selskap, Del av rapporten, Felt, Tittel, Tekst, Delt, Laget, Merknad | 650 |

Fra `IVIT-fraser-Byggcon-2026-10-24.xlsx`:

| Fil | Fane | Kolonner | Rader |
|---|---|---|---|
| `ivit-fraser-byggcon.csv` | Fraser | Nr, Del av rapporten, Kontrollpunkt, Felt, Tittel, Tekst, Laget, Sist endret, Merknad | 506 |
| `ivit-fraser-byggcon-oversikt.csv` | Oversikt (tabellen per del av rapporten) | Del av rapporten, Antall | 9 |

Fanene «Byggcon-fraser alle» (650) og «Fraser» (506) overlapper: begge er Byggcons egne fraser, men hentet på to måter (alle tre selskaper mot bare det som er synlig i admin). Byggcons egne fraser er Byggcons eget innhold; merknaden om iVerdis eiendom gjelder IVIT-fanene.

## Ufullstendige filer

SharePoint-leseren som ble brukt ved konverteringen stopper ved ca. 190 000 tegn per fane. To faner er større enn det:

- `ivit-avvikssporsmaal.csv`: de første 343 av 603 avvik (til og med gruppen «Våtrom»/«Ventilasjon» slik fanen er sortert). De siste 260 radene mangler.
- `ivit-frasebank-avvik-gammel.csv`: de første 582 av 822 standardavvik (til og med «Tomteforhold»/«Fuktsikring og drenering» slik fanen er sortert). De siste 240 radene mangler.

For å fullføre: del de to fanene i to faner hver i Excel (eller lagre dem som CSV i SharePoint), så kan resten leses inn og legges til nederst i filene.

## Rensing

Søkt etter oppdragsnummer (f.eks. [oppdragsnr fjernet]), telefonnummer, private e-postadresser, gateadresser til private boliger og personnavn på kunder. Funn:

- Ingen oppdragsnummer, telefonnummer, e-postadresser eller private gateadresser ble funnet. Kildefilene inneholdt allerede «[adresse fjernet]» og «[firma fjernet]» i én frase (trykktest).
- Tre personnavn på håndverkere/utførende i to Byggcon Helgeland-fraser («Kontroll KS» og «Kontroll produkter tettesjikt») er erstattet med `[fjernet]`. Firmanavn (f.eks. forsikringsselskap, boligbyggelag, regnskapskontor, byggefirma) er beholdt.
- Fraser og fagtekst er ellers uendret.
