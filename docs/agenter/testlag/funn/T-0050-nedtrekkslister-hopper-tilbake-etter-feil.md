---
id: T-0050
tittel: Nedtrekkslister og avkrysninger hopper tilbake etter en feilmelding, og neste lagring lagrer feil verdi uten varsel
type: feil
alvor: alvorlig
status: rettet
funnet: 2026-11-13
rolle: test-robusthet, test-kontor
omrade: skjemaer: areal, eiendom, reklamasjon, part, avtale
maal: reklamasjoner
commit: e013fde7
forsok: 1
pr:
---

## Hva
Får den ansatte en feilmelding i et skjema, står tekstfeltene igjen, men nedtrekkslistene går tilbake til gammel verdi eller tomt, og avkrysninger nullstilles. Lagrer han på nytt etter å ha rettet feilen, blir feil verdi lagret uten varsel. Feil målemetode, feil måler, feil eierform eller feil type reklamasjonssak kan da havne i rapporten og i tallene.

## Slik gjenskapes det
A) Areal:
1. Åpne «Bygninger, areal og rom» på et oppdrag med en etasje.
2. Skriv BRA-i 12,345, velg Metode «Fra tegning» og «Målt av» en annen ansatt.
3. Trykk «Lagre areal». Feilen «høyst én desimal» vises. Metode står nå på «Velg metode», og «Målt av» står på deg selv.
4. Rett tallet til 12,3, lagre og last siden på nytt: arealet er lagret med tom metode og feil måler.

B) Eiendom:
1. Sett Boligtype og Eierform til noe annet enn det som er lagret, tøm Bruksnummer (eller skriv postnummer «80») og trykk «Lagre eiendom».
2. Etter feilen viser listene de gamle verdiene. Fyll inn bruksnummer og lagre: gammel boligtype og eierform er lagret.

C) Reklamasjon (leder):
1. «Registrer reklamasjon», velg Type «Forsikringskrav» og en part, la «Beskrivelse» stå tom og lagre.
2. Etter feilen står Type på «Reklamasjon» og part på tom. Skriv beskrivelse og lagre: saken er lagret som Reklamasjon (bekreftet i databasen).

D) Part: «Legg til part», velg rollen Megler, skriv e-post «feil@» og lagre. Rollen blir tom, og «Rapport» er ikke lenger krysset av.

E) Avtale (admin, /admin/avtaler/ny): velg firma og sett til-dato før fra-dato. Etter feilen er firmaet tomt.

## Forventet
Alt den ansatte valgte, står igjen etter en feilmelding, også nedtrekkslister og avkrysninger. Lagringen etterpå lagrer det som ble valgt.

## Faktisk
Nedtrekkslistene får verdien bare én gang når skjemaet vises (`defaultValue`), og settes ikke på nytt når lagringen svarer med feil. Samme mønster finnes i `buildings-editor.tsx` (metode, målt av, romtype), `property-form.tsx` (boligtype, eierform), `party-form.tsx`, `reklamasjoner/claim-form.tsx` (type og part), `team-form.tsx`, `common-areas-form.tsx`, `ordre/[id]/order-actions.tsx` og `admin/avtaler/agreement-form.tsx`.

## Forslag
Gi listene og avkrysningene `key` ut fra svaret fra lagringen (for eksempel `key={state.attempt}`, slik «Under terreng» i etasjeskjemaet alt gjør), eller gjør dem styrte med verdien fra `state.values`. Rett det helst én gang i felles `Select`-hjelper. Legg til én e2e- eller komponenttest per skjema: feilmelding, lagre på nytt, og sjekk at valget står. Tas før neste nye punkt i planen.

## Etterprøvd
2026-11-13, bekreftet (alvorlig). Funn-kontrolløren gjenskapte feilen i areal, eiendom, reklamasjon, part og avtale, og fant feil verdi i databasen etter lagring (areal uten metode og med feil måler; reklamasjon lagret som `complaint` i stedet for forsikringskrav; eiendom med gammel boligtype og eierform). Meldt av to testere hver for seg (robusthet som alvorlig, kontor som middels); slått sammen hit. Ikke duplikat av T-0009, som gjelder felt som ikke blir lagret i det hele tatt.

## Logg
- 2026-11-13: funnet
- 2026-11-13: rettet på branch `rett-t0050-valg-etter-feil` (versjon 0.10.7): ny `key` per forsøk på nedtrekkslister, avkrysninger og radioknapper i 14 skjemaer, startverdien fra det som ble sendt. E2e `e2e/fase-2a-rett-t0050-valg-etter-feil.spec.ts` (areal, eiendom, reklamasjon, part).
