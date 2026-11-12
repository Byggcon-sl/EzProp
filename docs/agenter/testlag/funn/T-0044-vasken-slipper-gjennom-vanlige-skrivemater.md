---
id: T-0044
tittel: Vasken før KI slipper gjennom flere vanlige skrivemåter av e-post, telefon, adresse og postnummer
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-12
rolle: test-robusthet, test-ki
omrade: KI (vask før KI)
maal: KI i bunnen
commit: 11672aa
forsok: 0
pr:
---

## Hva
Navn, e-post, telefon, adresse og matrikkel skal aldri sendes til KI (regel 14). Vasken tar de vanlige formene, men flere skrivemåter går urørt gjennom og lagres i KI-loggen. Det er trygt nå fordi bare den falske leverandøren finnes, og fordi oppdragets egne opplysninger fanges som kjente verdier. Det gjelder derfor andre personer og adresser i teksten, som naboen.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne `/prove/ki`.
2. Be om forslag til hver av: «Send til ola.nordmann(at)example.no», «ola.nordmann @ example.no», «Ring 4 1 2 3 4 5 6 7», «Havnegata nr. 3», «N-8006 Bodø», «Solsvingen 4, Granlia 3, Brygga 7 og Kirketorget 2», «Eiendommen 1804-12/345», «Andelsnummer 45 i Fjellsiden borettslag».
3. Se forslaget, eller `output_text` i `ai_usage_log`.

## Forventet
Merkene [e-post], [telefon], [adresse] og [matrikkel], eller at restrisikoen er beskrevet med disse eksemplene.

## Faktisk
Alle står urørt. I tillegg: et gatenavn med en bokstav fra annen skrift som ser lik ut, går gjennom, «(+47) 41234567» blir «(+47) [telefon]», «Strandveien 12–14» blir «[adresse]–14», og «8622 Mo i Rana» blir «[adresse] i Rana».

## Forslag
Utvid mønstrene i `src/shared/lib/pii-patterns.ts` («(at)», enkeltsifre med mellomrom, «gata nr. 3», «N-» foran postnummer, flere gateendelser, kommunenummer foran gnr/bnr, andelsnummer), og legg dem inn som oppdiktede testsaker. Tas før ekte leverandør slås på. Ingen av disse står i listen over kjente småfunn for vasken.

## Etterprøvd
Ikke etterprøvd (forbedring). To testere fant det uavhengig av hverandre.

## Logg
- 2026-11-12: funnet
