---
id: T-0037
tittel: «Logg ut» uten nett gjør ingenting og sier ikke fra, og KI-køen på iPaden tømmes ikke
type: feil
alvor: middels
status: ny
funnet: 2026-11-12
rolle: test-robusthet, test-takstmann
omrade: utlogging og KI-kø (delt iPad)
maal: de ansatte
commit: 11672aa
forsok: 0
pr:
---

## Hva
Trykker den ansatte «Logg ut» uten nett, skjer det ingenting, og det kommer ingen melding. Han er fortsatt innlogget, og tekst som venter på KI, blir liggende og sendes når nettet er tilbake. På en delt iPad kan han tro at han er logget ut, og neste person bruker kontoen hans.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne `/prove/ki`.
2. Slå av nettet. Skriv en kort tekst og trykk «Foreslå bedre språk» (kortet sier «Venter på KI …»).
3. Trykk «Logg ut» og vent 5 sekunder.
4. Slå på nettet og last siden på nytt.
5. Prøv det samme fra `/arbeidskoe`.

## Forventet
Utloggingen virker, eller appen sier tydelig «Du er ikke logget ut. Du må ha nett.» Køen på iPaden tømmes uansett (`docs/funksjoner/fase2a-ki-ko.md`: «Utlogging tømmer køen»).

## Faktisk
Ingen melding, siden står, og innloggingen gjelder fortsatt. Køen ligger urørt, og teksten sendes til KI når nettet er tilbake. Koden som tømmer køen, hentes først ved utlogging og kan ikke hentes uten nett. Feilen fra utloggingskallet fanges ikke (`src/app/(ansatt)/log-out-button.tsx`, `log-out.ts`). At utloggingen stopper uten melding, var slik også før KI-køen.

## Forslag
Tøm køen med kode som alt er lastet. Fang feilen fra utloggingen og si tydelig fra når den ikke gikk. Hører sammen med «Sperring av iPader» i 2b. Småfunnet «dynamisk import ved utlogging kan mangle uten nett» i tilstandsfilen er samme sak.

## Etterprøvd
2026-11-12, bekreftet (middels). Kontrolløren fikk samme resultat fra `/prove/ki` og `/arbeidskoe`. Én tester meldte alvorlig. Kontrolløren satte middels: ingen data går tapt, teksten er den ansattes egen og sendes under hans egen økt, og køen ryddes hvis en annen logger inn (A190). Med nett virker utloggingen.

## Logg
- 2026-11-12: funnet
