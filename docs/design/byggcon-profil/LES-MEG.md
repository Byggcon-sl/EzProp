# Byggcon-profilen (fra Optiplan, til EzProp)

Kopiert fra Optiplan 12.11.2026 som grunnlag for oppgaven «Byggcon-profilen i EzProp» i `docs/07-utviklingsplan.md`. Ståle i chat 12.11.2026: «vi har oppdatert designet på optiplan, får å reflektere vår design på hjemmesiden. Jeg ønsker at vi også gjør samme grep for EzProp.»

Optiplan tok profilen i bruk 10.11.2026 (Ståle valgte designutkast A: samme uttrykk som byggcon.no). Kilde: Optiplan-repoet, `docs/08-designprinsipper.md` («Farger, skrift og former»), `docs/funksjoner/ny-profil.md` og `src/app/globals.css`.

## Innhold i mappen

| Fil | Hva |
|---|---|
| `fonts/` | Inter (brødtekst) og Schibsted Grotesk (overskrifter), SIL OFL 1.1. Flyttes til `public/fonts` når profilen bygges, og Roboto fjernes. |
| `optiplan-globals.css.txt` | Optiplans tema (`@theme`) som referanse: paletten, gråskalaen omdefinert til Byggcon-tonene, statusfarger, hjørner og kanter. Ikke kode i EzProp. |
| `bilder/` | Skjermbilder fra Optiplan etter ny profil (10.11.2026), som mål for uttrykket. |

## Paletten

| Navn | Farge | Brukes til |
|---|---|---|
| snow | #F5F4F0 | bakgrunn |
| sand | #EEEBE3 | paneler, framhevede flater, tellere |
| night | #0F1924 | tekst, hovedknapp, valgt menypunkt |
| fjord | #316AA0 | aksent, søyler |
| mørk fjord | #255A8C | lenker og fokusramme |
| stone | #5D6774 | dempet tekst |
| linje | night 12 % | kanter og skillelinjer (sterkere: 25 %) |

## Former

Pilleformede knapper (hovedknapp night med lys tekst, sekundær gjennomsiktig med mørk kant), kort med tynn kant og 12 px hjørner uten skygge, framhevede flater i sand uten kant, skjemafelt med 8 px hjørner. Skygge bare på lag som flyter over innholdet. Ingen fargeoverganger, ingen nordlys, ingen gul knapp (gult betyr «følg med»).

## Det som er annerledes i EzProp

- **Tettheten følger ikke Optiplan.** EzProp beholder luften (Ståle 24.10.2026: «luftig også på PC») og trykkflatene på iPad (minst 44 pt, hovedknapper 56–72 pt). Bare farger, skrift og former byttes.
- **TG-fargene** beholdes med tekst ved siden av, men tonene hentes fra statusfargene i Optiplan (grønn, gul, rød, varm grå), slik at de er like i begge løsningene.
- **KI-merket** trenger fortsatt et eget, tydelig uttrykk (KI-tekst skal kunne skilles fra takstmannens tekst). Nordlysfiolett tas ut; ui-designer foreslår et merke i paletten.
- **PDF-en** for tilstandsrapporten bygges i den nye profilen fra start (2a-2).
