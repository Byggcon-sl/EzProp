# 11 – Agentlaget og løkkene

Sist oppdatert: 10.11.2026 (ryddet, og testlaget lagt til som løkke G)

EzProp bygges av et lag av agenter som jobber selvstendig i løkker. Rollene står i `.claude/agents/<rolle>.md`. Tilstanden lagres i repoet (`docs/agenter/tilstand.md` og `docs/agenter/erfaringer.md`), fordi en kjøring kan stoppe når som helst. Alle steg tåler å kjøres to ganger.

## Rollene

**Ledere** (planlegger, setter krav, godkjenner, skriver sjelden kode): `prosjektleder` (eneste som skriver til Ståle, har siste ord), `arkitekt`, `fagansvarlig` (bestemmer ikke fag, det gjør Ståle), `ux-ansvarlig`, `ui-designer`, `ki-ansvarlig`, `test-leder`, `feilrettingsleder`, `sikkerhet-personvern` og `forenkler`.

**Utøvere** (skriver koden, egen worktree, starter aldri nye agenter): `utvikler`, `testskriver` og `retter`.

**Testlaget** (prøver det som er merget, endrer aldri koden): `test-takstmann`, `test-kontor`, `test-ny-ansatt`, `test-fag`, `test-ki`, `test-robusthet`, `test-dokumentvakt`, `funn-kontrollor` og `kvalitetsleder`. Se `docs/agenter/testlag/LES-MEG.md`.

## Stasjonene

```
BACKLOG → SPESIFISERT → DESIGNET → BYGGET → TESTET → GJENNOMGÅTT → PR → MERGET → PRØVD AV TESTLAGET
```

## Løkkene

| Løkke | Hva | Hvor |
|---|---|---|
| **A. Hovedløkken** | Annenhver time, i ny sesjon. Merger PR-er som er klare, retter PR-er med konflikt eller rød CI, retter alvorlige feil fra testlaget, og starter B for neste punkt i planen. | Rutine, se `docs/agenter/rutiner.md` |
| **B. Oppgaveløkken** | Spesifiser → forhåndsvurdering (bare rollene oppgaven trenger) → design og testplan → bygg (utvikler og testskriver hver for seg) → alle sjekker → gjennomgang (D) → PR. | `.claude/workflows/oppgave.js` |
| **C. Retteløkken** | Feilrettingsleder finner årsaken, retter fikser, testene kjøres på nytt. Etter tre forsøk går saken til Ståle. | Inne i `oppgave.js` |
| **D. Gjennomgangsløkken** | Test-leder, sikkerhet, forenkler og fagansvarlig (bare ved fagstoff), hver for seg. Alvorlige funn går tilbake til design eller bygg. | Inne i `oppgave.js` |
| **E. Nattløkken** | Hele testpakken, e2e på iPad-størrelse, universell utforming, sårbare pakker, appstørrelse og trege spørringer. Funn blir oppgaver i `tilstand.md`. Trygg rydding samles i én PR. | `.claude/workflows/natt.js`, rutine hver natt |
| **F. Læringsløkken** | Etter merge: oppdater `erfaringer.md` og ordlisten, og flytt det leverte punktet fra planen til `docs/plan/levert.md`. | I hovedløkken |
| **G. Testlaget** | Agenter med ulike roller bruker appen slik de ansatte vil gjøre. Funnene etterprøves av en uavhengig kontrollør og blir retteoppgaver, forbedringer eller forslag. Rapport til Ståle i klarspråk. | `.claude/workflows/testlag.js`, rutine hver natt |

**Forskjellen på D, E og G:** D ser på én oppgave før den merges. E kjører de automatiske testene på alt hver natt. G bruker det ferdige systemet slik et menneske ville gjort, og finner det testene ikke fanger: det som er tungvint, uklart, faglig galt eller lett å ødelegge.

## Slik henger utvikling og testing sammen

1. Hovedløkken bygger og merger et punkt fra planen.
2. Testlaget prøver det neste natt.
3. Bekreftede alvorlige feil ligger som funnfiler i `docs/agenter/testlag/funn/` med status «ny».
4. Hovedløkken retter dem før neste nye punkt (høyst tre per kjøring), og setter status «rettet».
5. Testlaget prøver dem på nytt og lukker dem, eller åpner dem igjen.
6. Ideer til nye funksjoner går til Ståle som forslag i `docs/09-apne-sporsmal.md`.

## Merge og åpne PR-er

- Agentene merger selv når en PR er klar: CI er grønn, ingen konflikt, ingen alvorlige funn, og ingenting under «Må bestemmes av Ståle» (Ståle 29.10.2026). Skriptet `scripts/merge-klare-pr.sh` sjekker dette og bruker «Squash and merge».
- PR-er som trenger Ståle, får tittelen «Venter på Ståle: …» og merket `venter-pa-stale`, og merges aldri av agentene. Mens autonom modus er på, lages det ingen slike PR-er.
- GitHub-arbeidsflyten «Oppdater åpne PR-er» (`.github/workflows/oppdater-pr.yml`) fletter main inn i alle åpne PR-er hver gang main endres. Felles dokumenter (tilstand, erfaringer, åpne spørsmål, domenemodell) får begge sider med, og versjonsnummeret settes én over main. Bare ekte konflikter blir igjen; da får PR-en en kommentar, og hovedløkken retter.
- Merge til main rulles ut til testmiljøet. Produksjon styrer Ståle.

## Autonom modus

Gjelder så lenge `docs/agenter/tilstand.md` sier «Autonom modus: på» (Ståle 29.10.2026, på igjen fra 04.11.2026, til han sier fra). Reglene står i `CLAUDE.md` under «Autonom modus». Kort:

- Agentene avgjør selv spørsmål om fag, innhold og funksjoner innenfor planen, ut fra researchen og hovedmålene. Hver beslutning føres i `docs/09-apne-sporsmal.md`, merket «lett å endre» eller «dyrt å endre».
- Ingen varsler og ingen «Venter på Ståle»-PR-er. Det bare Ståle kan gjøre, står i «Venter på Ståle» i planen og under «Trenger Ståle» i tilstandsfilen.
- Aldri: noe som koster penger, e-post eller SMS til ekte mottakere, innlogging i IVIT, Spectora eller SmartTakst, utrulling til produksjon, ekte kundedata, eller tekst fra NS 3600, IVIT eller SmartTakst.
- Fagtekster lages som utkast, merket «ikke godkjent av fagrådet».

**Uenighet:** prosjektlederen avgjør og begrunner i PR-en. Fag, pris, personvern og nye funksjoner avgjøres av Ståle.

## Kvote

- Ingen kostnadstak (Ståle 28.10.2026). Når kvoten er brukt opp, stopper kjøringen der den er, og neste kjøring fortsetter fra `tilstand.md`. Derfor commit og push etter hvert ferdige steg.
- **Spar fable-kvoten** (Ståle 04.11.2026): den fylles på én gang i uken. Bare `arkitekt`, `fagansvarlig` og `sikkerhet-personvern` bruker fable. Alle andre roller, hovedløkken, nattløkken og testlaget bruker opus. Er fable-kvoten brukt opp, kjøres de tre rollene på opus.
- Forhåndsvurderingen og gjennomgangen tar bare med rollene oppgaven berører. Testlaget prøver bare det som er nytt, unntatt den fulle kjøringen én gang i uken.
- Små funn samles og tas med neste oppgave i samme område.
- Flere enn ca. 10 agenter samtidig krever at Ståle øker «Dynamic workflow size» i `/config`.

## Kommandoer

- `/neste`: finn og start neste oppgave (alvorlige feil fra testlaget først, deretter planen).
- `/spesifiser <funksjon>`: lag spesifikasjon fra `docs/maler/funksjon.md`.
