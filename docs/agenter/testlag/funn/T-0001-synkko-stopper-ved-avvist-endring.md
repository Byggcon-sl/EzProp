---
id: T-0001
tittel: Én endring som ikke kan lagres, stopper alt annet som venter på å bli sendt fra iPaden
type: feil
alvor: alvorlig
status: rettet
funnet: 2026-11-11
rolle: test-robusthet
omrade: synk uten nett (testskjema)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Hvis én endring i testskjemaet ikke kan lagres på serveren, blir alle endringene etter den liggende på iPaden for godt. Takstmannen får bare «Prøver igjen automatisk», og ingenting sier hvilket felt det gjelder. Blir iPaden tømt eller byttet, er arbeidet tapt. Det samme gjelder alle endringer serveren avviser, ikke bare den som ble prøvd.

## Slik gjenskapes det
1. Logg inn som takstmann, åpne `/prove/testskjema` og trykk «Nytt testskjema».
2. Lim inn tekst med et nulltegn (tegnet U+0000, kan komme med tekst kopiert fra PDF) i «Generell beskrivelse».
3. Fyll ut «Byggeår» = 1985 og «Samlet kommentar».
4. Trykk «Synk nå» og vent 30 sekunder.

## Forventet
De gode endringene kommer fram til serveren. Den som ikke kan lagres, holdes til side med en melding om hvilket felt det gjelder, eller tegnet fjernes før lagring.

## Faktisk
`POST /api/prove/synk/endringer` gir 500 hver gang. Statuslinjen står på «Venter: 3 endringer» og «Fikk ikke sendt. Prøver igjen automatisk.» for alltid. Tabellen `trial_answers` har 0 rader for skjemaet. Køen kommer bare løs hvis takstmannen skriver om akkurat det feltet. Årsaken er at bare svaret 200 regnes som levert (`src/modules/offline-trial/sync/local/outbox.ts`, `shouldAckBatch`), og serveren gir 500 på nulltegnet (`apply-changes.ts`, innsetting i `trial_answers`).

Samme årsak på `/prove/ki`: tekst med nulltegn gir «Noe gikk galt. Teksten din er uendret. Prøv igjen.», og å prøve igjen hjelper ikke (innsettingen i `ai_usage_log` i `src/core/ai/request-suggestion.ts` feiler).

## Forslag
- Fjern nulltegn (og andre tegn databasen ikke tar) i én felles funksjon for innkommende tekst i `src/shared`, og bruk den både i synken og i KI-modulen.
- Serveren svarer 400 og ikke 500 på en endring som ikke kan lagres.
- Ved 400 for én endring: legg den til side med synlig melding om feltet («Kunne ikke sendes: Generell beskrivelse»), og send resten videre.
- Test med en «giftig» endring først i køen. Mønsteret må med i den ekte synken i fase 2b.

## Etterprøvd
2026-11-11, bekreftet (alvorlig). Kontrolløren gjorde stegene over: synkkallet ga 500 hver gang, statusen sto på «Venter: 3 endringer» uten å nevne feltet, og databasen hadde 0 svar for skjemaet. Delen om `/prove/ki` er ikke etterprøvd (meldt som lite av testeren, samme årsak).

## Logg
- 2026-11-11: funnet
- 2026-11-11: rettet på branchen `rett-t0001-synkko`. Nulltegn og ensomme surrogattegn fjernes før lagring i synken og i KI-modulen (`stripUnstorableChars`, A180). Serveren svarer 400 i stedet for 500 på en endring som ikke kan lagres; iPaden legger bare den endringen til side, sender resten og viser «Kunne ikke sendes: <feltnavn>» (A181). Prøvd i e2e på PC og iPad-størrelse (`e2e/fase-2a-rett-t0001-synkko.spec.ts`). Flyttes til `funn/lukket/` når testlaget har bekreftet rettingen.
