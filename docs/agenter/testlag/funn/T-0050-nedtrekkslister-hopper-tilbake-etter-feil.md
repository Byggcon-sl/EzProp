---
id: T-0050
tittel: Nedtrekkslister og avkrysninger hopper tilbake etter en feilmelding, og neste lagring lagrer feil verdi uten varsel
type: feil
alvor: alvorlig
status: rettet
funnet: 2026-11-13
rolle: test-robusthet, test-kontor
omrade: skjemaer: «Legg til rom» (arealtype); før også areal, eiendom, reklamasjon, part, avtale
maal: reklamasjoner
commit: e013fde7
forsok: 2
pr:
---

## Hva
**Står igjen 14.11.2026 (forsøk 2):** bare arealtypen i «Legg til rom» (ett rom). Velger takstmannen en annen arealtype enn forslaget og får en feilmelding, hopper arealtypen tilbake til forslaget for romtypen. Lagrer han etter å ha rettet feilen, blir feil arealtype lagret uten varsel. Feil areal kan havne i rapporten. De ti andre skjemaene virker nå (se «Etterprøvd»).

Opprinnelig funn:
Får den ansatte en feilmelding i et skjema, står tekstfeltene igjen, men nedtrekkslistene går tilbake til gammel verdi eller tomt, og avkrysninger nullstilles. Lagrer han på nytt etter å ha rettet feilen, blir feil verdi lagret uten varsel. Feil målemetode, feil måler, feil eierform eller feil type reklamasjonssak kan da havne i rapporten og i tallene.

## Slik gjenskapes det
Det som står igjen (14.11.2026):
1. Logg inn som takstmann. Åpne «Bygninger, areal og rom» på et oppdrag med bygning og etasje.
2. «Legg til rom» (ett rom): velg romtypen Kjøkken, sett Arealtype til BRA-e, kryss av «Under terreng», og skriv et navn med 11 sifre (for eksempel 12345678901), så lagringen gir feilmelding.
3. Trykk Lagre. Etter feilmeldingen står Arealtype på BRA-i (forslaget for Kjøkken). «Under terreng» står som valgt.
4. Rett navnet og lagre. Rommet er lagret med arealtype BRA-i (`area_type = bra_i`), ikke BRA-e, uten varsel.
5. Det samme skjer med romtypen «Bod, inne» og arealtypen BRA-b.

Opprinnelig (13.11.2026, nå rettet):
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
2026-11-14, **fortsatt feil (alvorlig)**. Funn-kontrolløren prøvde alle skjemaene på nytt på main a1ca41d9. Rettet i ti skjemaer, der valgene står etter feilmeldingen og databasen har riktige verdier: areal, eiendom, fellesdeler, team, part, reklamasjon, avtale, selskap, ansatt og «Endre ordren». Står igjen: arealtypen i «Legg til rom» (ett rom, `buildings-editor.tsx`), som går tilbake til forslaget for romtypen etter feil og lagres feil (se stegene). Mulig årsak, ikke sjekket i koden: forslaget for romtypen settes på nytt når skjemaet vises etter feilen, og overstyrer det som ble sendt. Mål: færre reklamasjoner.

2026-11-13, bekreftet (alvorlig). Funn-kontrolløren gjenskapte feilen i areal, eiendom, reklamasjon, part og avtale, og fant feil verdi i databasen etter lagring (areal uten metode og med feil måler; reklamasjon lagret som `complaint` i stedet for forsikringskrav; eiendom med gammel boligtype og eierform). Meldt av to testere hver for seg (robusthet som alvorlig, kontor som middels); slått sammen hit. Ikke duplikat av T-0009, som gjelder felt som ikke blir lagret i det hele tatt.

## Logg
- 2026-11-13: funnet
- 2026-11-13: rettet på branch `rett-t0050-valg-etter-feil` (versjon 0.10.7): ny `key` per forsøk på nedtrekkslister, avkrysninger og radioknapper i 14 skjemaer, startverdien fra det som ble sendt. E2e `e2e/fase-2a-rett-t0050-valg-etter-feil.spec.ts` (areal, eiendom, reklamasjon, part).
- 2026-11-14: prøvd på nytt av testlaget på main a1ca41d9: fortsatt feil i arealtypen i «Legg til rom». Status tilbake til «ny», forsøk 2. Tas før neste nye punkt i planen.
- 2026-11-14: forsøk 2, 14.11.2026: årsak: listen «Arealtype» i `RoomForm` var styrt (`value`). React tilbakestiller skjemaet etter hvert forsøk, og en styrt liste har ingen startverdi i DOM-en, så tilbakestillingen satte den til første valg (BRA-i); React rettet den ikke, fordi tilstanden var uendret. Rettet ved å gjøre «Arealtype» og «Under terreng» ustyrte (`defaultValue`/`defaultChecked` fra det som ble sendt, ny nøkkel per forsøk), og forslaget for romtypen (A97) settes rett i feltene. Gjelder både «Legg til rom» og «Endre rom». «Legg til flere rom» har ingen arealtype-liste eller avkrysning i skjemaet, så ingen retting der. Bekreftet rød før og grønn etter med lokal e2e (pc og ipad). Versjon 0.12.2.
