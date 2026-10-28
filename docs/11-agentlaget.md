# 11 – Agentlaget og løkkene

Sist oppdatert: 28.10.2026. Kilde: `docs/kartlegging/prompt-ezprop-utvikling-agenter.md` (Ståle 28.10.2026).

EzProp bygges av et lag av agenter som jobber selvstendig i løkker. Rollene står i `.claude/agents/<rolle>.md`. Tilstanden lagres i repoet (`docs/agenter/tilstand.md` og `docs/agenter/erfaringer.md`), fordi en kjøring kan stoppe når som helst (kvoten brukes opp). Alle steg tåler å kjøres to ganger.

## Rollene

**Ledere** (planlegger, setter krav, godkjenner, skriver sjelden kode): `prosjektleder` (eneste som skriver til Ståle, har siste ord), `arkitekt`, `fagansvarlig` (bestemmer ikke faglige spørsmål, det gjør Ståle), `ux-ansvarlig`, `ui-designer`, `ki-ansvarlig`, `test-leder`, `feilrettingsleder`, `sikkerhet-personvern`, `forenkler`.

**Utøvere** (skriver koden, egen worktree, starter aldri nye agenter): `utvikler`, `testskriver`, `retter`.

## Stasjonene

```
BACKLOG → SPESIFISERT → DESIGNET → BYGGET → TESTET → GJENNOMGÅTT → PR → (Ståle merger) → FERDIG
```

## Løkkene

| Løkke | Hva | Hvor |
|---|---|---|
| **A. Hovedløkken** | Rutine annenhver time i ny sesjon. Sjekker at ingen annen kjøring er i gang (tag `ezprop-utvikling`), leser tilstanden og åpne PR-er, kjører F ved merge, lager oppgave av Ståles kommentarer, og starter B for neste punkt i planen. Ingen grense for antall PR-er som venter på Ståle (28.10.2026); oppgaver som bygger på en PR som ikke er merget, lages som egen branch oppå den. | Rutine (`create_trigger`), prompt i `docs/agenter/rutiner.md` |
| **B. Oppgaveløkken** | Spesifiser → forhåndsvurdering i parallell (bare rollene oppgaven trenger) → design og testplan → bygg i parallell (utvikler og testskriver) → kjør alle sjekker → gjennomgang (D) → PR. | `.claude/workflows/oppgave.js` |
| **C. Retteløkken** | Feilrettingsleder finner årsaken, retter fikser, tester kjøres på nytt. Etter 3 forsøk merkes oppgaven «trenger Ståle». | inne i `oppgave.js` |
| **D. Gjennomgangsløkken** | Test-leder, sikkerhet, forenkler og fagansvarlig (bare ved fagstoff) hver for seg. Alvorlige funn går tilbake til design eller bygg. Små funn nevnes i PR-en. | inne i `oppgave.js` |
| **E. Nattløkken** | Hele testpakken, e2e på iPad-størrelse (også uten nett), universell utforming, sårbare pakker, appstørrelse, trege spørringer. Funn blir oppgaver i `tilstand.md`. Trygg rydding samles i én PR. | `.claude/workflows/natt.js`, rutine ca. kl. 02 Oslo-tid |
| **F. Læringsløkken** | Etter merge: oppdater `erfaringer.md`, planen og ordlisten. Gjentatte kommentarer fra Ståle blir regel i agentbeskrivelsen. | i hovedløkken |

**Uenighet:** prosjektlederen avgjør og begrunner i PR-en. Fag, pris, personvern og nye funksjoner avgjøres av Ståle; spørsmålet legges i `docs/09-apne-sporsmal.md`, og løkken fortsetter med andre oppgaver.

**Kvote:** ingen kostnadstak (Ståle 28.10.2026). Når kvoten er brukt opp, stopper kjøringen der den er; neste kjøring fortsetter fra `tilstand.md`. Derfor commit og push etter hvert ferdige steg. Flere enn ca. 10 agenter samtidig krever at Ståle øker «Dynamic workflow size» i `/config`.

## Kommandoer

- `/neste`: finn og start neste oppgave i planen.
- `/spesifiser <funksjon>`: lag spesifikasjon fra `docs/maler/funksjon.md`.

## Rutinene (forslag, lages først når Ståle har godkjent PR-en for fase 0a)

Se `docs/agenter/rutiner.md`.
