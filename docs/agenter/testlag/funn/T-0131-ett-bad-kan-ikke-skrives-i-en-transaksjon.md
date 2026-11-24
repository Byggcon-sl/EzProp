---
id: T-0131
tittel: Rapporttjenestene kan ikke skrive flere endringer i én transaksjon
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-24
rolle: utvikler
omrade: rapportkjernen, testdata
maal: færre reklamasjoner
commit: 15542ac7
forsok: 0
pr:
---

## Hva
Hver tjeneste i `src/core/reports` (`saveField`, `decideSuggestion`, `addDeviation`, `setTgDirect`, `setCheckpointDone`) åpner sin egen transaksjon på den felles databaseforbindelsen og tar ikke imot en ytre transaksjon. Testdata del 2 skulle skrive hvert bad i én transaksjon, slik at en feil midt i et bad rulles tilbake. Det går ikke uten å endre kjernen eller skrive forbi tjenestene, og begge er utenfor oppgaven.

## Slik gjenskapes det
1. Se `withRoomWrite` i `src/core/reports/write.ts`: den kaller `db.transaction` på den globale `db`.
2. Prøv å kalle to tjenester inne i én `db.transaction` i seed: den andre ser ikke den første før den er lagret, og en feil ruller bare tilbake sin egen del.

## Forventet
Et bad (mange endringer) kan skrives samlet, og en feil ruller tilbake hele badet.

## Faktisk
Hver endring lagres for seg. Testdata del 2 løser det med kontroll før skriving (A518): regelmotoren og de faglige grensene kjøres på alle badene før noe skrives. En feil i selve tjenesten midt i et bad (for eksempel databasen går ned) kan fortsatt gi et halvt bad, som ny kjøring hopper over.

## Forslag
La `withRoomWrite` (og tjenestene) ta imot en valgfri ytre transaksjon, eller lag en samlet skriveramme for flere endringer i samme rom. Det trengs også for køen uten nett i 2b, der flere endringer fra iPaden bør lagres samlet.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-24: funnet under bygging av testdata del 2
