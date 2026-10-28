# Eiendomsdata for EzProp: åpne kilder og leverandører

Sist oppdatert: 23.10.2026
Status: Utkast – undersøkt av en Claude-hjelpeagent 23.10.2026 (nettsøk og test av åpne endepunkter). Ikke godkjent.

## Beslutning

[Kilde: Ståle, 23.10.2026]

- Byggcon skal **ikke** ha egen avtale med Kartverket (Matrikkel-API og Grunnbok-API).
- Data som krever avtale (eiere, omsetning, byggeår, BRA osv.) hentes eventuelt via **Eiendomsverdi** eller **PropCloud** (propcloud.no).
- Åpne, gratis kilder brukes der de dekker behovet.

## Hva som kan hentes åpent (V1)

| Kilde | Gir | Tilgang | Dokumentasjon |
|---|---|---|---|
| Kartverket Adresse-API | Adressesøk og autoutfylling, kommunenr, gnr/bnr/fnr/snr, bruksenhetsnummer, koordinat | Åpent (testet) | https://ws.geonorge.no/adresser/v1/ |
| Kartverket Eiendom-API | Matrikkelnummer fra punkt, og eiendomsgrense (polygon) | Åpent (testet). Gir ikke areal. | https://api.kartverket.no/eiendom/v1/ |
| Matrikkelen Eiendomskart Teig | Teigareal og grenser | Åpent, CC BY 4.0 | https://data.norge.no/en/datasets/6219fb0e-74eb-368b-8ba5-452b1a736220/matrikkelen-eiendomskart-teig |
| Matrikkelen Bygningspunkt | Bygningsnummer, type og status (ikke byggeår, etasjer eller BRA) | Åpent, CC BY 4.0 | https://www.kartverket.no/api-og-data/eiendomsdata/apent-tilgjengelige-data-og-tjenester |
| NVE naturfare | Kvikkleire, flom, skred (aktsomhet og faresoner) | Åpent (testet), NLOD | https://kart.nve.no/enterprise/rest/services |
| NGU radon-aktsomhet | Fire aktsomhetsklasser | Åpent (testet), NLOD | https://data.norge.no/en/datasets/20a76841-0bb1-4096-b1c2-1b95fa439c49/radon-aktsomhet |
| Støysoner | Jernbane, lufthavn, vei | Jernbane åpen (testet). Vei-adressen er ikke bekreftet. | https://data.norge.no/en/datasets/a8ef4979-acdc-35c0-a9d6-aeb7caedf371/stoyvarselkart-og-strategiske-stoykart |
| Miljødirektoratet | Forurenset grunn | Åpent, NLOD | https://register.geonorge.no/varsler/grunnforurensning-2-wms/c03cdbdc-a5f5-4b94-b675-4092ccf4e019 |
| Riksantikvaren | Kulturminner og SEFRAK | Åpent, NLOD | https://dokument.geonorge.no/produktark/kulturminner-sefrak/2/kulturminner-sefrak-bygninger-1.pdf |
| DiBK arealplankart | Reguleringsplan og arealformål | WMS svarer (testet). Lisensen er ikke bekreftet helt åpen. | https://data.norge.no/en/datasets/44e7a49f-cd0c-363d-8030-0e58aa219239 |

**Viktig om risikokart:** At en eiendom *ikke* ligger i et aktsomhetsområde, betyr ikke at den er trygg. Rapporten må skille mellom «ikke kartlagt» og «ikke i aktsomhetsområde».

## Hva som krever leverandør (V2)

**Data:** eiere/hjemmelshavere, siste omsetning (kjøpesum og dato), byggeår, etasjer, BRA, bruksenhetsidentId, eventuelt skattetakst og sammenlignbare salg.

**Leverandører:**
- **Eiendomsverdi:** Eies av bankene. Eiendomsdatabase, verdivurdering og prisdata, også via Infotorg. Avtale via kundeansvarlig, pris ikke oppgitt. Om sammenlignbare salg er tilgjengelig for takstforetak, er ikke bekreftet.
- **PropCloud (propcloud.no):** Ikke undersøkt ennå.
- **Ambita og Norkart:** Alternativer, ikke valgt.

## Plan

**V1, uten avtaler:**
1. Adressesøk og eiendomsgrense fra Kartverkets åpne API-er.
2. Én tjeneste som henter risikodata (NVE, NGU, støy, Miljødirektoratet, Riksantikvaren, DiBK), med dato og kilde i rapporten.
3. Manuelle felt med kilde for eiere, omsetning, byggeår, etasjer, BRA, ferdigattest, energimerke og skattetakst.
4. Kildelinjer i rapporten, f.eks. «© Kartverket (CC BY 4.0)», «NVE (NLOD)».

**V2, via leverandør:**
1. Hent pristilbud og vilkår fra Eiendomsverdi og PropCloud.
2. Bygg integrasjonen slik at leverandøren kan byttes. EzProp spør en egen «eiendomsdata-tjeneste», ikke leverandøren direkte.
3. Personvern: Eiere og kjøpesum er personopplysninger. Det trengs behandlingsgrunnlag, tilgangsstyring og regler for lagring. Avgjør om eierens navn skal stå i rapporten.

## Usikkerheter (ikke bekreftet)

- Hva Eiendomsverdi og PropCloud kan levere til takstforetak, og hva det koster
- Om DiBKs plandata er helt åpne, og hvor fullstendige de er per kommune
- Adressen til støykart for vei
- At teigareal fra åpne data kan avvike fra registrert tomteareal

## Det Ståle må gjøre

- Kontakte Eiendomsverdi og PropCloud for vilkår og pris
- Avgjøre om eierens navn skal stå i rapporten
