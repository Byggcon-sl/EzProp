# Funksjon: Rett funn T-0050 (forsøk 2) – arealtypen i «Legg til rom» hopper tilbake etter feilmelding

- **Fase:** 2a (retting fra testlaget, går foran nytt planpunkt)
- **Modul:** app-siden «Bygninger, areal og rom» (`src/app/(ansatt)/oppdrag/[id]/bygninger/`)
- **Status:** klar for bygging
- **Funn:** `docs/agenter/testlag/funn/T-0050-nedtrekkslister-hopper-tilbake-etter-feil.md` (feil, alvorlig, forsøk 2)
- **Branch:** `rett-t0050-arealtype` fra `main` (main flettet inn 14.11.2026)
- **Roller:** utvikler og testskriver (i parallell: testskriver lager rød e2e, utvikler retter `RoomForm`), deretter gjennomgang
- **Beslutningsnumre:** A309–A314 er ledige hvis rettingen krever en beslutning (føres i `docs/09-apne-sporsmal.md`, merket «lett å endre» eller «dyrt å endre»)
- **Støtter hovedmål:** Reklamasjoner: arealtypen takstmannen velger, er den som lagres, så feil BRA-i/BRA-e/BRA-b ikke havner i rapporten og arealtabellen. / De ansatte: valget står igjen etter en feilmelding, så takstmannen slipper å velge på nytt og slipper å oppdage feilen senere. / KI i bunnen: riktig arealtype er grunndata som KI-forslag om areal og rom senere bygger på.

## Problem
I «Legg til rom» (ett rom, `RoomForm` i `buildings-editor.tsx`) velger takstmannen romtype, og arealtypen settes til forslaget for romtypen (A97). Endrer han arealtypen (Kjøkken → BRA-e, Bod inne → BRA-b) og lagringen gir en feilmelding (navn med 11 sifre), står arealtypen på forslaget (BRA-i) etter feilen. Retter han navnet og lagrer, lagres BRA-i uten varsel. Første retting (nøkkel per forsøk og `setAreaType` fra `state.values`) virket i de ti andre skjemaene, men ikke her.

Mulig årsak (må bekreftes med en rød test før rettingen): React tilbakestiller skjemaet etter en `<form action>`. Listen er styrt (`value={areaType}`), og tilbakestillingen setter listen til valget den hadde da den ble vist første gang (forslaget). Fordi `areaType` i tilstanden ikke endres, retter ikke React listen igjen. Nøkkelen per forsøk hjelper ikke hvis tilbakestillingen skjer etter at listen er vist på nytt. «Under terreng» virker, så sammenlign med hvordan avkrysningen oppfører seg.

## KI i bunnen
KI gjør ikke noe nytt her. Rettingen sikrer at dataene KI senere bruker (romtype og arealtype per rom), er det takstmannen valgte. Ingen nye data, ingen KI-kall, ingenting nytt i `src/core/ai`.

## Brukerhistorier
- Som **takstmann** vil jeg at arealtypen jeg valgte, står igjen etter en feilmelding og blir lagret, slik at rommet får riktig areal i rapporten.

## Omfang
**Med:**
1. **Rød test først:** e2e `e2e/fase-2a-rett-t0050-arealtype.spec.ts` som gjør stegene i funnet, på PC og iPad (begge prosjektene):
   - Kjøkken, Arealtype BRA-e, kryss av «Under terreng», navn `12345678901`, Lagre → feilmelding. Sjekk at Arealtype står på BRA-e og «Under terreng» er krysset av. Rett navnet, lagre, og sjekk i listen over rom (og helst i databasen) at rommet har BRA-e.
   - Det samme med «Bod, inne» og BRA-b.
   - Testen skal være rød på `main` før rettingen (skriv i PR-en at den var rød).
2. **Rettingen i `RoomForm`:** arealtypen som ble sendt, står igjen etter feil og blir lagret. Velg den enkleste løsningen som tåler tilbakestillingen, for eksempel at skjemaet ikke tilbakestilles ved feil (sende via `startTransition` fra `onSubmit`), eller at listen bruker `defaultValue` fra `state.values` med nøkkel per forsøk og forslaget settes bare når romtypen faktisk endres. Forslaget for romtypen (A97) skal fortsatt settes når takstmannen bytter romtype.
3. **Samme sjekk i «Legg til flere rom»** (`add-rooms-dialog.tsx`) og «Endre rom»: har de samme mønster med arealtype eller avkrysning, rettes de på samme måte og får et kort steg i samme e2e-fil. Har de det ikke, skriv det i PR-en.
4. Hvis rettingen er en felles hjelper (for eksempel i `src/shared`), får den en enhetstest.
5. **Funnfilen:** status «rettet», `pr:` med PR-nummer, linje i loggen (forsøk 2, hva som var årsaken). Flyttes ikke til `lukket/` før testlaget har bekreftet.
6. `docs/agenter/tilstand.md` oppdateres. Versjon i `package.json` økes (patch).

**Ikke med (bevisst utelatt):**
- De ti andre skjemaene fra første retting (bekreftet rettet av testlaget 14.11.2026). Røres bare hvis den felles rettingen krever det, og da med eksisterende e2e grønn.
- Nye regler for hvilke arealtyper som passer med hvilke romtyper, eller varsel når arealtypen avviker fra forslaget.
- Endringer i romtyper, forslagene (A97) eller datamodellen.
- Uten-nett-oppførsel (skjemaet er på serveren i dag).

## Tilgang
Uendret. Bruker eksisterende `saveRoomAction` med tilgangssjekk i `src/core/access`. Ingen nye spørringer, så ingen ny tenant-test.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja | ja (som før) |
| kontor | som før | som før |
| leder | som før | som før |
| admin | ja | ja |

## Data
Ingen endringer.

## Skjermer
«Bygninger, areal og rom», dialogen «Legg til rom». iPad og PC. Antall trykk etter feil: fra «velg arealtype på nytt + lagre» til bare «lagre».

## Regler
Ingen nye regler.

## Akseptkriterier
- [ ] E2e-testen gjenskaper funnet (Kjøkken + BRA-e, Bod inne + BRA-b, navn med 11 sifre) og var rød før rettingen
- [ ] Etter feilmelding står valgt arealtype og «Under terreng» igjen
- [ ] Neste lagring lagrer valgt arealtype (sjekket i listen over rom eller databasen)
- [ ] Bytter takstmannen romtype, settes forslaget for arealtype som før (A97)
- [ ] Virker på PC og iPad-størrelse (e2e)
- [ ] Eksisterende e2e for T-0050 (`e2e/fase-2a-rett-t0050-valg-etter-feil.spec.ts`) er fortsatt grønn
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne
- [ ] Funnfilen har status «rettet» og PR-nummer; tilstandsfilen er oppdatert

## Åpne spørsmål
- Ingen. Rettingen følger forventet oppførsel i funnet; ingen fagbeslutning trengs.
