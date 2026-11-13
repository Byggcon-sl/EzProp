---
id: T-0003
tittel: Ståles svar om fukt i eldre bad (59a) står med ulik mening i planen, og det strider mot TG-vilkårene
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-fag, test-dokumentvakt
omrade: regler (2a-2), plan
maal: reklamasjoner
commit: 0b8e3b9
forsok: 1
pr: #167 (12.11.2026)
---

## Hva
Planen gjengir Ståles svar 59a som «fukt ikke målt». Det kan leses som at det ikke er tatt hull. Bygges regelen for badet slik, kan et bad uten hulltaking få TG0 eller TG1 der det skulle vært TGIU. Det gir feil tilstandsgrad i rapporten og kan gi reklamasjon.

## Slik gjenskapes det
1. Les `docs/07-utviklingsplan.md`, punktet «Reglene badet trenger» (2a-2): «Fukt ikke målt gir ikke TG2 på grunn av alder alene på tilliggende konstruksjoner».
2. Les Ståles ord i `docs/09-apne-sporsmal.md`, nr. 59: «TG0 gis når vi ikke måler fukt, uavhengig av hvor gammelt badet er».
3. Les `docs/kartlegging/regelverk-krav.md`: hulltaking ikke utført gir TGIU, og TG0 gis bare ved 0–5 år med dokumentasjon.
4. Les `docs/kartlegging/kartlegging-bad.md`: ingen hulltaking gir TGIU for tilliggende konstruksjoner.
5. Les `docs/kartlegging/svar-claude-pa-vegne-av-stale-2026-11-10.md`, svaret på samme spørsmål: anbefaler TG1, og er ikke merket som erstattet av Ståles svar.

## Forventet
Én tydelig regel med Ståles mening, der «målt uten forhøyet fukt», «ikke målt (ingen hulltaking)» og «hulltaking nektet» er tre ulike tilfeller, hver med sin testsak. Den eldre anbefalingen om TG1 er merket som erstattet.

## Faktisk
Planen, Ståles svar, TG-vilkårene (bindende via forskriften § 2-23) og den eldre anbefalingen sier fire ulike ting. Regelen er ikke bygget ennå.

## Forslag
Før regelen for badet lages: skriv planlinjen om til «målt uten forhøyet fukt» hvis det er det Ståle mener, merk den eldre anbefalingen som erstattet, og lag testsaker for alle tre tilfellene. Motstriden mot TG0-vilkåret er lagt fram for fagrådet som spørsmål i `docs/09-apne-sporsmal.md`. I autonom modus kan agentene velge den tolkningen som er tryggest mot forskriften (TGIU når det ikke er målt) og føre den som beslutning.

## Etterprøvd
2026-11-11, bekreftet (middels). Kontrolløren fant motstriden i alle fire kildene. Funnet fra dokumentvakten (samme sak) er slått sammen hit, med tillegget om den eldre anbefalingen.

## Logg
- 2026-11-11: funnet
- 2026-11-12: rettet på branch `fase2a-regler-bad`: én tolkning (A224), planlinjen sier «målt uten forhøyet fukt», svaret som anbefalte TG1 er merket erstattet, og reglene har testsaker for hvert tilfelle (`docs/funksjoner/fase2a-regler-bad.md`).
- 2026-11-13: prøvd på nytt på main e013fde7: fortsatt feil, men bare i ett dokument. Regelen og testsakene er riktige (F1, F2). S3-raden under «Venter på Ståle» i `docs/07-utviklingsplan.md` (ca. linje 87) sier fortsatt «TG0 gis når det ikke er målt fukt, uansett hvor gammelt badet er». Det strider mot Ståles svar F2 (ikke hull og ikke målt gir TGIU). Satt tilbake til «ny», forsøk 1, alvor senket til lite etter råd fra kontrolløren. Rett S3-raden til «TG0 når det er tatt hull og målt uten forhøyet fukt; ikke målt gir TGIU».
