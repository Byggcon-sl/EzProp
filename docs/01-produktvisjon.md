# 01 – Produktvisjon

Sist oppdatert: 10.11.2026

**EzProp** er Byggcons eget system for tilstandsrapporter etter forskriften til avhendingslova, med NS 3600:2025 som grunnlag for TG. Det erstatter IVIT. Systemet er bygget for samarbeid mellom flere selskaper (Byggcon AS, Nord, Helgeland, Troms) og mange ansatte fra start, men brukes internt i Byggcon først.

## Hovedmål (Ståle 10.11.2026)

> «Vi skal lage et best mulig system for våre ansatte – KI først. Det betyr også at KI må ligge i bunnen, ikke komme som et tillegg senere.»

| Mål | Hva det betyr | Slik ser vi det (Claudes forslag) |
|---|---|---|
| **Best mulig system for de ansatte** | En enklere, raskere og tryggere arbeidsdag for takstingeniørene, kontoret og lederne. De ansatte avgjør om vi har lykkes. | Spørreskjema og EzProp-panelet i piloten: vil de heller bruke EzProp enn IVIT? Tid per rapport og antall trykk i de vanligste arbeidsflytene. |
| **KI først, og KI i bunnen** | KI er en del av grunnmuren og av hver funksjon fra første dag. KI foreslår, den ansatte kontrollerer, godkjenner og signerer. KI setter aldri TG og sender aldri noe selv. | Andel KI-forslag som godtas, endres eller avvises, og kostnad per rapport. All KI-bruk logges. |
| **Færre reklamasjoner** | Halvparten så mange reklamasjoner og krav per 100 leverte rapporter (målet fra 28.10.2026 står). | Nullpunkt: de siste 3 årene. Måles over flere år. |

**50 % mindre tid per rapport er ikke lenger hovedmålet** (Ståle 10.11.2026). Tiden måles fortsatt, som ett av flere tegn på at systemet er godt.

## Hvem bruker det

- **Takstingeniøren**: befaring på iPad Pro (uten nett i kjellere og grisgrendte strøk), rapporten ferdigstilles på PC.
- **Kontoret**: ordre, oppdrag, parter, befaringstid, kø og fakturagrunnlag.
- **Leder og admin**: ansatte, roller, selskaper, reklamasjoner, statistikk.
- **Kunde og megler** (senere): ser leverte rapporter.

## Retningen

«IVITs innhold, Spectoras drift og SmartTaksts beste detaljer, pluss TG-forslag fra regler» (godkjent 27.10.2026). Fra 10.11.2026 ligger KI i bunnen av alt dette: se «KI i bunnen» i `docs/07-utviklingsplan.md`. Design A «Fjord»: luftig, kort-basert, mørk visning som valg.

## Grenser

- Ingen betaling i EzProp. Byggcon fakturerer etter levering via adapter til Visma eAccounting.
- Verdidel og markedsverdi er ikke krav for produksjon.
- Samme Azure-miljø som Optiplan. Felles innlogging og felles profil for admin og ansatte, og bytte mellom løsningene med ett trykk (Ståle 28.10.2026). Kundene holdes adskilt. Annet samspill kommer etter hvert, ikke nå.
- Alt skjer i nettleseren. Ingen egen app.

Hele bakgrunnen står i `docs/kartlegging/LES-MEG-kartlegging.md` (beslutningene) og `docs/07-utviklingsplan.md` (fasene).
