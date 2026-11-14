# Testplan: Rett funn T-0050 (forsøk 2) – arealtypen i «Legg til rom»

- **Oppgavekort:** `docs/agenter/oppgaver/rett-t0050-arealtype.md`
- **Funn:** `docs/agenter/testlag/funn/T-0050-nedtrekkslister-hopper-tilbake-etter-feil.md`
- **Støtter hovedmål:** færre reklamasjoner (riktig arealtype lagres), best for de ansatte (valget står igjen etter feil).

## E2e: `e2e/fase-2a-rett-t0050-arealtype-takstmann.spec.ts` (kjører i prosjektene pc og ipad)

Oppsett per test: logg inn som takstmann, lag eget oppdrag med `uniqueSuffix()` (som i `e2e/fase-2a-rett-t0050-valg-etter-feil.spec.ts`), åpne «Bygninger, areal og rom», legg til bygning og én etasje over terreng (se `e2e/fase-2a-bygninger-areal-rom.spec.ts` for stegene). Testdata er oppdiktet. Navnet med elleve sifre er `12345678901` (oppdiktet, gir feil fordi det ligner fødselsnummer).

| Nr | Sak | Steg | Forventet |
|---|---|---|---|
| E1 | Kjøkken + BRA-e (funnet steg 2–4) | «Legg til rom»: Romtype Kjøkken, Arealtype BRA-e, kryss av «Under terreng», navn `12345678901`, Lagre (vent på svaret fra server-handlingen) | Feilmelding på navnet vises. Arealtype viser BRA-e (`option:checked`), «Under terreng» er krysset av, Romtype er Kjøkken, navnet står igjen |
| E2 | Lagre etter retting | Fortsettelse av E1: endre navnet til `Kjøkken test`, Lagre | Skjemaet lukkes, rommet står i listen med arealtypen BRA-e (ikke BRA-i) og «Under terreng». Last siden på nytt: fortsatt BRA-e |
| E3 | Bod, inne + BRA-b (funnet steg 5) | Som E1 og E2 med romtypen «Bod, inne» og arealtypen BRA-b | Etter feil: BRA-b og «Under terreng» står. Etter lagring: rommet har BRA-b |
| E4 | Forslaget virker fortsatt (A97) | Etter en feil (som E1): bytt romtype til en annen romtype med annet forslag | Arealtype og «Under terreng» settes til forslaget for den nye romtypen |
| E5 | Feil to ganger på rad | Som E1, trykk Lagre to ganger med samme feil | Arealtype står på BRA-e etter begge feilene |
| E6 | Endre rom (hvis samme mønster) | Åpne «Endre» på et lagret rom, bytt arealtype, gi feil med navnet, lagre etter retting | Valgt arealtype står etter feil og lagres |
| E7 | «Legg til flere rom» (hvis samme mønster) | Gi en feil i dialogen etter å ha gjort valg | Valgene står igjen. Har dialogen ikke arealtype eller avkrysning, droppes saken og det skrives i PR-en |

Sjekk av at testen var rød: kjør E1–E3 mot `main` før rettingen og skriv resultatet i PR-en.

## Regresjon

- `e2e/fase-2a-rett-t0050-valg-etter-feil.spec.ts` grønn (de ti skjemaene fra første retting).
- `e2e/fase-2a-bygninger-areal-rom.spec.ts` og e2e for «Legg til flere rom» grønne.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.

## Enhetstest

Bare hvis rettingen lager en felles hjelper (for eksempel i `src/shared`): test at verdien fra svaret brukes etter feil, og at forslaget brukes når romtypen byttes.

## Tilgang og tenant

Ingen nye spørringer, ingen ny tenant-test. `saveRoomAction` og tilgangssjekken er uendret.
