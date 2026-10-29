# Prøve E – regler uten nett: protokoll og resultat

- **Oppgavekort:** `docs/funksjoner/fase1-prove-e-regler.md`. Testplan: `docs/funksjoner/fase1-prove-e-regler-testplan.md`.
- **Plan:** `docs/07-utviklingsplan.md` fase 1, prøve E.
- **Status:** mal, ikke kjørt. Fylles inn av Ståle på ekte iPad.
- **Støtter hovedmål:** Reklamasjoner (iPaden gir samme svar som serveren, så rapporten kan ikke si noe annet enn det takstmannen så på stedet) og tid (svaret kommer under feltet uten nett, uten ekstra trykk).

**Viktig:** tallene i prøven (7 år og 42 %) er **oppdiktede prøveverdier**, ikke fag. De skal ikke brukes i ekte rapporter. Ekte levetider og grenser avgjøres i fase 2a (spørsmål nr. 13).

Tabellen under har de samme testsakene som de automatiske testene (`src/modules/offline-trial/rules/trial-rule-cases.ts`). En test sjekker at tabellen og dataene er like. Endres en testsak, endres tabellen i samme PR.

## Før du starter

1. Testmiljøet i Azure er oppe. `/api/helse` svarer, og versjonen er den som har prøve E eller nyere.
2. iPad Pro med appen lagt på hjemskjermen fra Safari (Del → Legg til på Hjem-skjerm). Åpne appen **fra hjemskjermen**, ikke fra Safari.
3. Logg inn **med nett**, åpne listen «Testskjema», velg «Egenbygd» under «Synkløsning», trykk «Nytt testskjema» og åpne det. Se at det står «Prøveregel: ikke vurdert» under feltene «Berederens alder» og «Fuktmåling gulv». Da ligger appen og skjemaet i hurtiglageret.
4. **Bare oppdiktede data.** Skriv bare tallene i tabellen. Ingen ekte adresser eller navn i skjemaet.

## Slik gjør du prøven

| Steg | Gjør dette |
|---|---|
| E1 | Slå på flymodus. Synkstatusen øverst skal vise «Uten nett». |
| E2 | For hver rad i tabellen under: trykk i feltet, slett det som står der, og skriv teksten i kolonnen «Skriv inn» nøyaktig som den står (uten «»). «» betyr at feltet skal være tomt. |
| E3 | Les linjen rett under feltet uten å trykke noe annet. Skriv hva den viser i kolonnen «Vist på iPad», og kryss av «Riktig» hvis den sier det samme som «Forventet». «over prøvegrensen» betyr at linjen sier «Prøveregel: over prøvegrensen (…)». |
| E4 | Lukk appen helt (sveip opp fra appveksleren) og åpne den igjen fra hjemskjermen, fortsatt i flymodus. Åpne samme testskjema. Skriv «7,5» i «Berederens alder». Linjen skal si «over prøvegrensen». |
| E5 | Slå av flymodus. Ingenting skal endre seg i linjene under feltene. |

Svaret fra serveren sammenlignes automatisk i testene (samme testsaker). På iPaden sammenligner du bare med kolonnen «Forventet».

## Resultat

| Felt | Testsak | Skriv inn | Forventet | Vist på iPad | Riktig |
|---|---|---|---|---|---|
| Berederens alder | tomt felt | «» | ikke vurdert | | [ ] |
| Berederens alder | null | «0» | ikke over prøvegrensen | | [ ] |
| Berederens alder | under | «6» | ikke over prøvegrensen | | [ ] |
| Berederens alder | lik grensen | «7» | ikke over prøvegrensen | | [ ] |
| Berederens alder | rett over (komma) | «7,5» | over prøvegrensen | | [ ] |
| Berederens alder | negativt tall | «-1» | ikke vurdert | | [ ] |
| Berederens alder | ugyldig tekst | «12,» | ikke vurdert | | [ ] |
| Fuktmåling gulv | tomt felt | «» | ikke vurdert | | [ ] |
| Fuktmåling gulv | null | «0» | ikke over prøvegrensen | | [ ] |
| Fuktmåling gulv | under (komma) | «41,9» | ikke over prøvegrensen | | [ ] |
| Fuktmåling gulv | lik grensen | «42» | ikke over prøvegrensen | | [ ] |
| Fuktmåling gulv | rett over (punktum) | «42.01» | over prøvegrensen | | [ ] |
| Fuktmåling gulv | negativt tall | «-1» | ikke vurdert | | [ ] |
| Fuktmåling gulv | ugyldig tekst | «1e3» | ikke vurdert | | [ ] |

| Kontroll | Svar |
|---|---|
| E4: svaret riktig etter at appen ble lukket og åpnet uten nett | ja / nei |
| E5: ingenting endret seg da nettet kom tilbake | ja / nei |

## Enheten

| | |
|---|---|
| iPad-modell | |
| iPadOS-versjon | |
| Safari-versjon (følger iPadOS) | |
| Versjon i `/api/helse` | |
| Dato og hvem som kjørte | |

**Det som ikke virket:**
-

**Vurdering:** bestått / ikke bestått. Bestått når alle 14 rader er riktige, og E4 og E5 er «ja». Begrunnelse:
