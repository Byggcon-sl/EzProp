> Kilde: SharePoint-mappen `spectora-youtube` (Claude → Kunnskapsbase), kopiert ordrett 09.11.2026. Videonotatene (`videoer/`), oversikten og bildene ligger bare i SharePoint. Funnene er referanse som resten av `docs/kartlegging/`: ingen sitater fra Spectora inn i kode, seed-data eller maler.

# Spectoras YouTube-arkiv – lærdom til EzProp

Sist oppdatert: 09.11.2026. Eier: Ståle Limstrand. Arbeidet gjøres av Claude Code på Ståles Mac.
Oppgaven står i `../prompt-spectora-youtube-arkiv.md`.

## Hva dette er

Gjennomgang av hele YouTube-kanalen til Spectora (https://www.youtube.com/@Spectora) for å finne det som kan gjøre EzProp bedre, eller som Byggcon kan lære av som bedrift. Funnene sorteres etter hovedmålene for EzProp 2.0: **50 % mindre tid**, **halvparten så mange reklamasjoner** og **KI først**.

Funnene er **forslag til Ståle**. `datamodell.md` og `utviklingsplan.md` endres ikke herfra.

## Avgrensning (Ståle 08.11.2026)

**Videoer lastet opp 08.11.2024 eller senere tas først**, prioritet 1 og så prioritet 2. Eldre videoer med prioritet 1 og 2 tas etterpå, hvis Ståle vil. [Kilde: Ståle i chat, 08.11.2026]

**Utvalget:** 46 videoer, 16 med prioritet 1 (ca. 4,7 timer) og 30 med prioritet 2 (ca. 8,4 timer).
- Prioritet 1: 001–005, 010, 011, 012, 014, 015, 016, 017, 018, 019, 020, 024
- Prioritet 2: 027–034, 047, 048, 049, 050, 064, 065, 066, 076–080, 092–100, 106

**Eldre videoer, prioritet 1 (Ståle sa ja 09.11.2026):** 10 videoer, ca. 6,4 timer: 006, 007, 008, 009, 013, 021, 022, 023, 025, 026. [Kilde: Ståle i chat, 09.11.2026]

**Eldre videoer, prioritet 2 («bare de relevante», Ståle 09.11.2026):** 11 av 37 om rapportskriving, befaring og reklamasjoner, ca. 2,6 timer: 035, 036, 038, 039, 040, 045, 052, 102, 103, 104, 105. De andre 26 (mest mersalg, pris, markedsføring og tall) er ikke gjennomgått. [Kilde: Ståle i chat, 09.11.2026]

## Status

| Steg | Status |
|---|---|
| 1 Oversikt og prioritering | **Ferdig 08.11.2026.** 521 videoer i `oversikt-videoer.md`. |
| Datoer | **Ferdig 08.11.2026.** 431 av 442 (de 11 siste er private eller slettet). Se `datoer.md`. |
| 2 Gjennomgang video for video | **Ferdig for utvalget 08.11.2026.** De 10 eldre videoene med prioritet 1 ble ferdige 09.11.2026. 11 relevante eldre videoer med prioritet 2 ble ferdige samme dag. Til sammen ligger 67 notater i `videoer/`. |
| 3 Samlet analyse (`spectora-youtube-funn.md`) | **Oppdatert 09.11.2026** med de 10 eldre videoene. Nye funn har V-nummer fra V102. Forslag, ikke godkjent. |

## Forslag til endret prioritet (fra gjennomgangen)

Prioriteten i `oversikt-videoer.md` er ikke endret. Ståle avgjør.
- **Bør vært prioritet 3** (lite nytt, mest salg eller kundehistorie): 001, 002, 016, 028, 029, 031, 032, 047, 049, 050, 065, 066, 076, 077, 079, 080, 092, 095–098. Muligens også 027.
- **Bør vært prioritet 2** (noen detaljer, men lite nytt): 010, 011, 012, 015, 024.
- **Kunne vært prioritet 1:** 099, for planleggingen av overgangen fra IVIT.
- **Eldre videoer med prioritet 2 (09.11.2026):** 035, 036, 038, 039, 040, 045, 052, 102 og 103 bør vært prioritet 3. 104 og 105 er riktig som prioritet 2.
- **Eldre videoer (09.11.2026):** 008, 009, 013, 021, 023 og 025 bør vært prioritet 3. 022 bør vært prioritet 2. 006, 007 og 026 er riktig som prioritet 1. 013 bør også vært kategori D, ikke B.

## Neste steg

1. Ståle leser `spectora-youtube-funn.md` og svarer på spørsmålene i kapittel 7.
2. De 10 eldre videoene med prioritet 1 er gjennomgått (09.11.2026). Av de 37 eldre med prioritet 2 er de 11 relevante gjennomgått. De andre 26 tas bare hvis Ståle ber om det.
3. Prioritet 3 (415 videoer) skumleses til slutt, hvis Ståle vil.
4. Nøkkelbildene lastes opp til `bilder/` (se under).

## Slik er notatene laget

- **Tekstingen fra YouTube er sperret** («HTTP 429: for mange forespørsler», prøvd igjen 08.11.2026 kl. 21.36, fortsatt sperret). Derfor lastes videoen ned i 360p, og teksten lages **lokalt på Mac-en** med tale-til-tekst (Whisper, modellen small.en via mlx-whisper). Ingenting sendes ut. Tale-til-tekst kan ha hørefeil i navn.
- Stillbilder hvert 15. sekund, sett på som oversiktsark. 0–2 nøkkelbilder per video (JPG, 480 px) i `bilder/`.
- **Nøkkelbildene er ikke lastet opp ennå** (08.11.2026). SharePoint-koblingen krever at bildet sendes som tekst gjennom Claude, og det ble ikke nøyaktig nok. Bildene ligger lokalt på Mac-en, og Ståle kan dra dem inn i `bilder/`. Notatene viser til filnavnene.
- Seks korte videoer (076, 095–098, 106) fikk først feil lydspor (automatisk dubbet språk) og ga bare støy. De ble lastet ned på nytt med originallyden og har fått nye notater.
- Analysen av tekst og bilder gjøres av hjelpeagenter (Claude), én gruppe videoer om gangen, etter malen i oppgaven.
- Hele transkripsjoner lagres ikke her. Videoer, lyd og tekst slettes lokalt når notatet er ferdig.

## Slik fortsetter en ny økt

1. Les denne filen og `oversikt-videoer.md`.
2. Ta videoene i utvalget med status «–», laveste nummer først.
3. Notat per video i `videoer/NNN-kort-tittel.md` etter malen i oppgaven. Noen få nøkkelbilder i `bilder/`.
4. Oppdater status her og i `oversikt-videoer.md` etter hver 3.–5. video.
5. Ikke lagre hele transkripsjoner her. De tilhører Spectora.

## Verktøy (lokalt på Mac-en)

yt-dlp (offisiell Mac-versjon, 2026.10.26, med `--js-runtimes node`), ffmpeg (fra `imageio-ffmpeg`) og mlx-whisper i et eget Python-miljø. Alt ligger i øktens midlertidige mappe og må installeres på nytt i en ny økt. Ingen innlogging mot YouTube eller Google. Ingen informasjonskapsler.

## Filer

| Fil / mappe | Innhold |
|---|---|
| `LES-MEG.md` | Denne filen: status og neste steg |
| `oversikt-videoer.md` | Alle 521 videoene med dato, kategori, prioritet og status |
| `datoer.md` | Nøyaktig opplastingsdato og lengde per video |
| `videoer/` | Ett notat per gjennomgått video |
| `bilder/` | 0–2 nøkkelbilder per video (JPG, lav oppløsning) |
| `spectora-youtube-funn.md` | Samlet analyse: funn V1 og utover, topp 10, forretning, ikke for Norge og spørsmål til Ståle |
