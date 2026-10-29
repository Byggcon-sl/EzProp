# 11 – Agentlaget og løkkene

Sist oppdatert: 28.10.2026. Kilde: `docs/kartlegging/prompt-ezprop-utvikling-agenter.md` (Ståle 28.10.2026).

EzProp bygges av et lag av agenter som jobber selvstendig i løkker. Rollene står i `.claude/agents/<rolle>.md`. Tilstanden lagres i repoet (`docs/agenter/tilstand.md` og `docs/agenter/erfaringer.md`), fordi en kjøring kan stoppe når som helst (kvoten brukes opp). Alle steg tåler å kjøres to ganger.

## Rollene

**Ledere** (planlegger, setter krav, godkjenner, skriver sjelden kode): `prosjektleder` (eneste som skriver til Ståle, har siste ord), `arkitekt`, `fagansvarlig` (bestemmer ikke faglige spørsmål, det gjør Ståle), `ux-ansvarlig`, `ui-designer`, `ki-ansvarlig`, `test-leder`, `feilrettingsleder`, `sikkerhet-personvern`, `forenkler`. Lederne arver modellen fra sesjonen eller rutinen som starter dem (`model: inherit`), slik at modellen kan byttes på rutinen uten å endre repoet. Normalt er det ledermodellen; mens den kvoten er brukt opp, kjører rutinene på utøvermodellen (Ståle 29.10.2026).

**Utøvere** (skriver koden, egen worktree, starter aldri nye agenter): `utvikler`, `testskriver`, `retter`.

## Stasjonene

```
BACKLOG → SPESIFISERT → DESIGNET → BYGGET → TESTET → GJENNOMGÅTT → PR → (agentene merger når alt er grønt, eller Ståle når PR-en venter på ham) → FERDIG
```

## Løkkene

| Løkke | Hva | Hvor |
|---|---|---|
| **A. Hovedløkken** | Rutine annenhver time i ny sesjon. Sjekker at ingen annen kjøring er i gang (tag `ezprop-utvikling`), leser tilstanden og åpne PR-er, kjører F ved merge, lager oppgave av Ståles kommentarer, og starter B for neste punkt i planen. Først i hver kjøring: åpne PR-er med konflikt eller rød CI rettes, og PR-er som er klare, merges (`scripts/merge-klare-pr.sh`). | Rutine (`create_trigger`), prompt i `docs/agenter/rutiner.md` |
| **B. Oppgaveløkken** | Spesifiser → forhåndsvurdering i parallell (bare rollene oppgaven trenger) → design og testplan → bygg i parallell (utvikler og testskriver) → kjør alle sjekker → gjennomgang (D) → PR. | `.claude/workflows/oppgave.js` |
| **C. Retteløkken** | Feilrettingsleder finner årsaken, retter fikser, tester kjøres på nytt. Etter 3 forsøk merkes oppgaven «trenger Ståle». | inne i `oppgave.js` |
| **D. Gjennomgangsløkken** | Test-leder, sikkerhet, forenkler og fagansvarlig (bare ved fagstoff) hver for seg. Alvorlige funn går tilbake til design eller bygg. Små funn nevnes i PR-en. | inne i `oppgave.js` |
| **E. Nattløkken** | Hele testpakken, e2e på iPad-størrelse (også uten nett), universell utforming, sårbare pakker, appstørrelse, trege spørringer. Funn blir oppgaver i `tilstand.md`. Trygg rydding samles i én PR. | `.claude/workflows/natt.js`, rutine ca. kl. 02 Oslo-tid |
| **F. Læringsløkken** | Etter merge: oppdater `erfaringer.md`, planen og ordlisten. Gjentatte kommentarer fra Ståle blir regel i agentbeskrivelsen. | i hovedløkken |

**Merge og åpne PR-er (Ståle 29.10.2026):**
- Agentene merger selv når en PR er klar: CI grønn, ingen konflikt, ingen alvorlige funn, og ingenting under «Må bestemmes av Ståle». Skriptet `scripts/merge-klare-pr.sh` sjekker dette og bruker «Squash and merge».
- PR-er som trenger Ståle, får tittelen «Venter på Ståle: …» og merket `venter-pa-stale`. Han får varsel på telefonen. Alle andre PR-er kan han se bort fra.
- GitHub-arbeidsflyten «Oppdater åpne PR-er» (`.github/workflows/oppdater-pr.yml`) fletter main inn i alle åpne PR-er hver gang main endres. Felles dokumenter (tilstand, erfaringer, åpne spørsmål, domenemodell) får begge sider med, og versjonsnummeret settes én over main. Bare ekte kodekonflikter blir igjen; da får PR-en en kommentar, og hovedløkken retter.
- Merge til main rulles ut til testmiljøet. Produksjon styrer Ståle.

**Autonom modus (Ståle 29.10.2026, gjelder til Ståle sier fra)**

Ståle er borte noen dager og vil ikke ha meldinger, spørsmål eller noe å teste. Hans ord: «Kjør utvikling og testing autonomt. Er du i tvil, gå tilbake til undersøkelsene og tolk hva du mener blir beste løsning. Løsningen er foreløpig kun i test.» Derfor, så lenge `docs/agenter/tilstand.md` sier «Autonom modus: på»:

- **Agentene avgjør selv** spørsmål om fag, innhold og funksjoner innenfor planen. Grunnlaget er researchen i `docs/kartlegging/` (Ståles svar er fasit, nyeste dato gjelder), hovedmålene og forskriften. Velg det som best støtter målene (mindre tid, færre reklamasjoner, KI først), og det enkleste som virker.
- **Hver slik beslutning føres** i `docs/09-apne-sporsmal.md` i tabellen «Avgjort av agentene mens Ståle var borte» (hva, hvorfor, kilde i researchen, hvordan det kan endres), og nevnes i PR-en. PR-en merges som vanlig.
- **Ingen PushNotification, ingen «Venter på Ståle»-PR-er.** Det som virkelig bare Ståle kan gjøre (hemmeligheter, kontoer, noe som koster penger, e-post/SMS til ekte mottakere), legges under «Trenger Ståle når han er tilbake» i tilstandsfilen, og løkken går videre med en annen oppgave.
- **Ikke lov uansett:** noe som koster penger (for eksempel å slå på tjenester i Azure), sende e-post eller SMS til ekte mottakere, logge inn i IVIT, Spectora eller SmartTakst, rulle ut til produksjon, ekte kundedata, hemmeligheter i repoet, tekst fra NS 3600, IVIT eller SmartTakst.
- **Fagtekster** (avvikstekster, regler, terskler) kan lages som utkast etter beslutningene og prøveeksemplene i researchen. De merkes «utkast, ikke godkjent av fagrådet» i data, slik at Ståle godkjenner dem før ekte bruk.
- Gjeldende fase fullføres først. Når alle punktene i en fase er levert, går løkken videre til neste fase i planen.

**Uenighet:** prosjektlederen avgjør og begrunner i PR-en. Fag, pris, personvern og nye funksjoner avgjøres av Ståle; spørsmålet legges i `docs/09-apne-sporsmal.md`, og løkken fortsetter med andre oppgaver.

**Kvote:** ingen kostnadstak (Ståle 28.10.2026). Når kvoten er brukt opp, stopper kjøringen der den er; neste kjøring fortsetter fra `tilstand.md`. Derfor commit og push etter hvert ferdige steg. Flere enn ca. 10 agenter samtidig krever at Ståle øker «Dynamic workflow size» i `/config`.

## Kommandoer

- `/neste`: finn og start neste oppgave i planen.
- `/spesifiser <funksjon>`: lag spesifikasjon fra `docs/maler/funksjon.md`.

## Rutinene (forslag, lages først når Ståle har godkjent PR-en for fase 0a)

Se `docs/agenter/rutiner.md`.
