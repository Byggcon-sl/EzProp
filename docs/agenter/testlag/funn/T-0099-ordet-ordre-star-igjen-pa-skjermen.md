---
id: T-0099
tittel: «Ordre» og «ordrer» står fortsatt på skjermen etter at det heter tilbud
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-kontor
omrade: tilbud (nytt navn), kontakter, firma, admin
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Ordre heter nå tilbud på skjermen (A318), men åtte tekster sier fortsatt «ordre» eller «ordrer». Kontoret kan lure på om det er noe annet enn tilbud.

## Slik gjenskapes det
1. Som kontor: lag to like kontakter, og bruk den ene som bestiller på et tilbud.
2. Som leder: åpne kontakten, «Slå sammen med …», og velg den andre.
3. Les kortene og bekreftelsen.

## Forventet
Ingen synlig tekst sier «ordre» om tilbud (unntak: meglerens ordrenummer), som oppgavekortet for tilbud krever.

## Faktisk
«Ordrer 1» og «… Oppdrag og ordrer flyttes til …». «Fjern» sier «Oppdrag og ordrer beholder navnet». Admin viser rollen kontor som «Ordre og oppdrag.» og loggetiketten «Ordre». Kontaktkilden heter «Fra en ordre».

## Forslag
Bytt til «tilbud» i tekstene, og legg til en test som leter etter «ordre» i synlig tekst. Steder: `remove-merge-actions.tsx`, `kontakter/[id]/sla-sammen/page.tsx`, `firma/[id]/sla-sammen/page.tsx`, `kontakter/[id]/page.tsx`, `firma/[id]/page.tsx`, `admin/labels.ts` og `src/core/contacts/codes.ts` (bare visningsteksten; den faste koden endres ikke, regel 6).

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-17: funnet
