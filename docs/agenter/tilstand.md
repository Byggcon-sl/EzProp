# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 28.10.2026 (testmiljø i Azure: oppgavekort rettet etter forhåndsvurdering, klart for utvikler, arkitekt og testskriver)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #2 (grunnmuren) og PR #1 (testhjelperen) er merget 28.10.2026. PR #3, #4 (rutiner) og #5 (beslutning: testmiljø i Azure og felles innlogging) er også merget 28.10.2026.

Gjeldende fase: **Fase 1 – Prøve uten nett.** Oppgave 3 (testoppsett) er merget som PR #6 28.10.2026.

## Gjeldende oppgave

**Testmiljø i Azure** (fase 1, første punkt, Ståle 28.10.2026): oppgavekort i `docs/funksjoner/fase1-testmiljo-azure.md` på branchen `fase1-testmiljo-azure` (fra `main`), testplan i `fase1-testmiljo-azure-testplan.md`. Forhåndsvurdering ferdig 28.10.2026 (forenkler, arkitekt, test-leder, sikkerhet-personvern); kortet er rettet og godkjent for bygging. Avgjørelser: Graph-adapteren utsatt til fase 0b (spørsmål nr. 6 åpent), ressursgruppen lages av Ståle og GitHub får bare rettigheter der, ingen hostname-binding i Bicep, `logLine` på e-posten for serverloggen, `sslmode=verify-full`, seed uten adresse i loggen. **Neste steg:** bit A (utvikler: e-post/innlogging/seed), bit B (arkitekt: Bicep, arbeidsflyt, ADR 0002) og bit T (testskriver) i parallell, deretter bit C (dokumentasjon og plan), så test-leder og PR. Ingenting rulles ut fra skyen, ingen Azure-kall. Versjon blir 0.2.0.

**Forrige oppgave:** Oppgave 3 – Testoppsett for prøven uten nett (PR #6, merget 28.10.2026). Oppgavekort `docs/funksjoner/fase1-testskjema.md`, testplan `docs/funksjoner/fase1-testskjema-testplan.md`. Kjente svakheter som tas i oppgave 4 står nederst i oppgavekortet.

**Neste oppgave etter testmiljøet:** oppgave 4 (første kandidat: PowerSync), som bygger på testskjemaet og trenger testmiljøet for prøving på ekte iPad.

Hovedmål for fase 1: tid og KI først (grunnlaget for befaring på iPad, der KI-forslag senere vises og godkjennes).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| – | Ingen åpne PR-er. Neste blir «Testmiljø i Azure» fra `fase1-testmiljo-azure` | – | – |

Ingen PR-er venter. Grensen er 3.

## Venter på Ståle

- **PR-en for testmiljøet må merges med «Squash and merge»** (første commit på branchen fikk et modellnavn i attribusjonslinjen, og det kan ikke rettes fra skyen).
- **Før testmiljøet kan tas i bruk:** lage innlogging for GitHub i Azure (OIDC) og legge inn secrets og variabler med nøyaktige navn. Stegene kommer i `docs/drift/testmiljo-azure.md` i PR-en.
- **Gi rutinene tilgang** (se `docs/agenter/rutiner.md`): åpne hver rutine på claude.ai/code/routines → Edit → Advanced settings → Repository `Byggcon-sl/EzProp`, miljø «Byggcon», koblingen «Claude Code Remote». Før det gjør hovedløkken ingenting.
- Spørsmålene i `docs/09-apne-sporsmal.md`: nr. 6 (adresse og e-post for testmiljøet i Azure; oppgaven forutsetter kode i serverloggen og tom adresse til han svarer), nr. 8 (GPS-posisjon i bildene fra iPaden, trengs før prøve D) og nr. 9 (hvem har tilgang til ressursgruppen i Azure-portalen; ikke blokkerende for testmiljøet).

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

28.10.2026: hovedløkken startet «Testmiljø i Azure»: branch `fase1-testmiljo-azure` fra `main`, oppgavekort skrevet, forhåndsvurdering kjørt og kortet rettet (klart for bygging). Sesjon: https://claude.ai/code/session_01JqwntzCcVvuiXSedMUVdYg

28.10.2026 kl. 14:45–16:00: hovedløkken kjørte oppgave 3 fra oppgavekort til PR #6 (arbeidsflyten «oppgave»: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver). Fase 0a krysset av i planen. Læringsløkken kjørt for PR #4 og #5 (`erfaringer.md`). Sesjon: https://claude.ai/code/session_01JqwntzbzRrrZa27xqnubtP

28.10.2026 kl. 13:44: hovedløkken startet, men stoppet uten GitHub-tilgang. Ingen endringer gjort.

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
