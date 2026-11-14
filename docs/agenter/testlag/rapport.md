# Rapport fra testlaget

**Kjøring 14.11.2026.** Det som er nytt siden 13.11 ble prøvd: rette en ordre, søk i ordrelisten og arbeidskøen, varsel om mulig dublett, legge til flere rom på én gang, oppbevaringstid for avviste KI-forslag, og dokumentene. Seks testere: takstmann, kontor, robusthet, fag, KI og dokumentvakt.

## Hva er prøvd
Hele veien fra ny ordre til ferdig romliste på iPad (liggende og stående) og PC, som takstmann, kontor, leder og admin. To faner samtidig, dobbelttrykk, uten nett, utløpt innlogging, rare tegn og forsøk på å se en annen organisasjons data. Romsettene og romtypene mot forskriften og dine svar. KI-vasken og loggen med den falske KI-tjenesten. Om planen og beslutningene stemmer med det som er bygget. Kontrollpunkter, avvik, bilder, fraser og rapportutskrift finnes ikke ennå, så de er ikke prøvd.

## Hva virker
- **Flere rom på én gang sparer mye tid:** en enebolig med tre etasjer tar 9 trykk mot rundt 84 før. Fra ordre til ferdig romliste tar rundt 36 trykk og felt.
- **Kontoret kan rette en ordre** i alle tilstander. Endringene vises med gammel og ny verdi, og to som lagrer samtidig får beskjed uten at noe går tapt.
- **Søket finner** ordrenummer, oppdragsnummer, gårds- og bruksnummer og adresse. **Dublettvarselet** kjenner igjen samme adresse skrevet ulikt, og stopper ingenting.
- **Tilgang og skille mellom organisasjonene holder** overalt, også når noen tukler med skjemaene. Ingen adresser eller navn i loggene.
- **KI:** avviste forslag får oppbevaringstiden admin har valgt, ingenting slettes, og KI satte aldri TG eller sendte noe.
- **Tre funn er lukket:** romtypene er delt i grupper (T-0018), kontoret starter på «Alle» i arbeidskøen (T-0029), og live diktat og strekkmål 6 er tilbake i planen (T-0052).

## Hva virker ikke (viktigst først)
1. **Arealtypen i «Legg til rom» hopper tilbake etter en feilmelding,** og feil arealtype blir lagret uten varsel (alvorlig, T-0050, andre forsøk). De ti andre skjemaene er rettet. Feil areal kan havne i rapporten.
2. **Det du sa ja til om varsel ved like kontakter og firma, falt ut av planen** da svarene ble ført inn. Bare varselet på ordre er bygget (T-0072).
3. **Går innloggingen ut midt i et skjema, er det som er skrevet borte** (T-0070). **Faller nettet idet man lagrer eiendom eller rom, kommer en engelsk feilside** (T-0071).
4. **Rom som legges til samtidig, kommer i tilfeldig rekkefølge** (T-0069). «Legg til rom» med ett rom gir ikke nummer, så det kan bli «Soverom» ved siden av «Soverom 1» (T-0084).
5. **Dokumentene:** punktet om personvernvurdering (DPIA) er skrevet om uten at du har sagt det (T-0078), og fire beslutninger som er dyre å endre, er merket lette (T-0082).

I tillegg kom 16 små ting, blant annet at dublettvarselet bommer når adressen mangler komma (T-0086). Liten ting fra takstmannen: eierform blir ikke fylt ut på eiendommen selv om ordren sier borettslag.

## Tall
| Nye funn | Åpne | Lukket |
|---|---|---|
| 23 (5 middels, 18 små) | 81 (1 alvorlig, 23 middels, 57 små) | 3 |

En uavhengig kontrollør gjenskapte de alvorlige og middels funnene. Fire rettede funn ble prøvd på nytt: tre er lukket, og T-0050 er fortsatt feil.

**Ikke bekreftet:** ingen. Ett funn om nummerering av ett rom ble dømt «ikke feil» mot oppgaven, og er tatt som forbedring (T-0084).

**Til deg:** ingen nye forslag. Fem nye spørsmål til fagrådet om rom, romsett, fraser og automatisk tekst (nr. 82 i `docs/09-apne-sporsmal.md`). Fire nye rader i listen over dyre beslutninger (`docs/agenter/testlag/beslutninger-til-staale.md`), som nå er gått gjennom til A291.

## De tre viktigste tingene
1. **Rett arealtypen i «Legg til rom»** (T-0050), så det takstmannen valgte, faktisk blir lagret.
2. **Før varselet om like kontakter og firma inn i planen igjen** (T-0072), slik du sa ja til 12.11.
3. **Ingenting skal gå tapt ved utløpt innlogging eller brudd i nettet** (T-0070, T-0071). Det hører til «klar for drift».

Sist kjørt på commit: a1ca41d9
Dato: 14.11.2026
