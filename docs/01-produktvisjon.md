# 01 – Produktvisjon

Sist oppdatert: 28.10.2026

**EzProp** er Byggcons eget system for tilstandsrapporter etter forskriften til avhendingslova, med NS 3600:2025 som grunnlag for TG. Det erstatter IVIT. Systemet er bygget for samarbeid mellom flere selskaper (Byggcon AS, Nord, Helgeland, Troms) og mange ansatte fra start, men brukes internt i Byggcon først.

## Hovedmål (Ståle 28.10.2026)

> «Med EzProp 2.0 skal vi effektivisere takstingeniørens hverdag med 50 % (målt mot dagens IVIT), samt halvere antall reklamasjoner mot oss i ettertid. EzProp skal være laget med "AI-first"-tankegangen.»

| Mål | Slik måles det (Claudes forslag, Ståle bekrefter) |
|---|---|
| 50 % mindre tid per rapport | Samlet tid fra forberedelse til levering, per rapporttype. Nullpunkt: Ståles måling i IVIT. EzProp måler automatisk fra hendelsesloggen og arbeidsøktene. |
| Halvparten så mange reklamasjoner | Antall reklamasjoner og krav per 100 leverte rapporter, og beløp. Nullpunkt: de siste 3 årene. Måles over flere år. |
| KI først | Hver ny funksjon spør først om KI kan gjøre eller forberede arbeidet. Takstmannen kontrollerer, godkjenner og signerer. KI publiserer aldri selv. All KI-bruk logges med kostnad. |

## Hvem bruker det

- **Takstingeniøren**: befaring på iPad Pro (uten nett i kjellere og grisgrendte strøk), rapporten ferdigstilles på PC.
- **Kontoret**: ordre, oppdrag, parter, befaringstid, kø og fakturagrunnlag.
- **Leder og admin**: ansatte, roller, selskaper, reklamasjoner, statistikk.
- **Kunde og megler** (senere): ser leverte rapporter.

## Retningen

«IVITs innhold, Spectoras drift og SmartTaksts beste detaljer, pluss TG-forslag fra regler» (godkjent 27.10.2026). Design A «Fjord»: luftig, kort-basert, mørk visning som valg.

## Grenser

- Ingen betaling i EzProp. Byggcon fakturerer etter levering via adapter til Visma eAccounting.
- Verdidel og markedsverdi er ikke krav for produksjon.
- Samme Azure-miljø som Optiplan. Felles innlogging og felles profil for admin og ansatte, og bytte mellom løsningene med ett trykk (Ståle 28.10.2026). Kundene holdes adskilt. Annet samspill kommer etter hvert, ikke nå.
- Alt skjer i nettleseren. Ingen egen app.

Hele bakgrunnen står i `docs/kartlegging/LES-MEG-kartlegging.md` (beslutningene) og `docs/07-utviklingsplan.md` (fasene).
