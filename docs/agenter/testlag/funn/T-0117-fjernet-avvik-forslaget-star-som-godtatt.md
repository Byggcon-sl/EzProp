---
id: T-0117
tittel: Etter «Fjern avviket» sier forslaget fortsatt «Godtatt», punktet har ingen TG, og ingen advarsel
type: feil
alvor: middels
status: rettet
funnet: 2026-11-18
rolle: test-robusthet
omrade: badet, regelforslag
maal: reklamasjoner
commit: 50fad3e4
forsok: 0
pr: 239
---

## Hva
Fjerner takstmannen avviket fra et godtatt TG3-forslag, ser forslaget fortsatt godtatt ut, uten knapper. Punktet står uten TG, og «Å se over» sier ingenting. Et TG3-forhold kan falle ut av rapporten uten varsel. Nær alvorlig.

## Slik gjenskapes det
1. Godta TG3-forslaget på «Vanntett sjikt».
2. Trykk «Fjern avviket», og bytt punkt så «Angre» er borte.
3. Gå tilbake til punktet.

## Forventet
Forslaget venter på beslutning igjen, eller det kommer en advarsel i «Å se over».

## Faktisk
Forslagskortet viser «Godtatt: TG3 …» uten avvik og uten knapper. TG er «Ikke satt», og «Å se over» er tom. Loggen sier «godtatt». Serveren tillater å godta på nytt, men skjermen tilbyr det ikke. Steder: `rule-suggestion-card.tsx` linje 431–493 og `room-view.ts` linje 412–421.

## Forslag
Når avviket fra et godtatt forslag er fjernet, vises forslaget igjen med knappene, eller «Å se over» får en advarsel med knapp. Rettes sammen med T-0115.

## Etterprøvd
2026-11-18, bekreftet (middels, nær alvorlig). Bevis: test-robusthet/etter-fjern-bad1.png; funn-kontrollor-1/f6.log og f6-db.log.

## Logg
- 2026-11-18: funnet

- 2026-11-24: rettet i PR #239 (branch `rett-forslag-og-avvik`, oppgavekort `docs/agenter/oppgaver/rett-forslag-og-avvik.md`). Testlaget prøver på nytt i neste kjøring.
