# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 28.10.2026 (testmiljø i Azure: PR #7 åpnet, venter på Ståle)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #2 (grunnmuren) og PR #1 (testhjelperen) er merget 28.10.2026. PR #3, #4 (rutiner) og #5 (beslutning: testmiljø i Azure og felles innlogging) er også merget 28.10.2026.

Gjeldende fase: **Fase 1 – Prøve uten nett.** Oppgave 3 (testoppsett) er merget som PR #6 28.10.2026.

## Gjeldende oppgave

**Testmiljø i Azure** (fase 1, første punkt, Ståle 28.10.2026): oppgavekort i `docs/funksjoner/fase1-testmiljo-azure.md` på branchen `fase1-testmiljo-azure` (fra `main`), testplan i `fase1-testmiljo-azure-testplan.md`. Forhåndsvurdering ferdig 28.10.2026 (forenkler, arkitekt, test-leder, sikkerhet-personvern); kortet er rettet og godkjent for bygging. Avgjørelser: Graph-adapteren utsatt til fase 0b (spørsmål nr. 6 åpent), ressursgruppen lages av Ståle og GitHub får bare rettigheter der, ingen hostname-binding i Bicep, `logLine` på e-posten for serverloggen, `sslmode=verify-full`, seed uten adresse i loggen. **Gjort 28.10.2026:** testplan (runde 2, `07eb246`) og bit B (arkitekt: `infra/azure/main.bicep`, `.github/workflows/deploy-azure.yml`, ADR 0002, `docs/06`; commit `fca9815`) er ferdig og committet. Kortet rettet etter testplanens avsnitt 0 (ny `env.test.ts`, `otpEmail` som ren funksjon i `src/core/auth/otp-email.ts`) og arkitektens svar på de tre merknadene (bygg uten database OK, gjenforsøk rundt migrering, `HOSTNAME=0.0.0.0`). **Gjort 28.10.2026 (sammenslåing):** bit A (e-post via serverlogg, `otpEmail`, seed uten adresse, versjon 0.2.0), bit C (`docs/drift/testmiljo-azure.md`, `docs/10`, avkryssing i `docs/07`) og to uavhengige utgaver av bit T er slått sammen på `fase1-testmiljo-azure` (commit `ce0600a` og `6c64f87`). Testene fra de to testskriverne dekket det samme; én utgave ble beholdt, og den unike testen om at postkassen vinner lokalt ble tatt med. Ingen nye tabeller, så `tests/factories.ts` trengte ingen endring. `pnpm lint`, `pnpm typecheck` og `pnpm test` (18 filer, 119 tester) er grønne. **Gjort 28.10.2026 (avslutning):** test-leder godkjente mot testplanen (alle 15 akseptkriterier dekket, ingen alvorlige funn; småfunn står i PR-en), `pnpm test:e2e` grønn (35 bestått, 1 hoppet over med vilje), driftsdokumentet fikk tydeligere advarsel om at de fire e-post-secretene ikke skal legges inn før fase 0b. **PR #7 åpnet mot `main`** (https://github.com/Byggcon-sl/EzProp/pull/7). Versjon 0.2.0 (minor, besluttet i kortet). Ingenting rullet ut fra skyen, ingen Azure-kall. **Neste steg:** vente på Ståle. Når PR #7 er merget: læringsløkke (`erfaringer.md`), deretter oppgave 4 (første kandidat: PowerSync) som trenger testmiljøet på ekte iPad.

**Forrige oppgave:** Oppgave 3 – Testoppsett for prøven uten nett (PR #6, merget 28.10.2026). Oppgavekort `docs/funksjoner/fase1-testskjema.md`, testplan `docs/funksjoner/fase1-testskjema-testplan.md`. Kjente svakheter som tas i oppgave 4 står nederst i oppgavekortet.

**Neste oppgave etter testmiljøet:** oppgave 4 (første kandidat: PowerSync), som bygger på testskjemaet og trenger testmiljøet for prøving på ekte iPad.

Hovedmål for fase 1: tid og KI først (grunnlaget for befaring på iPad, der KI-forslag senere vises og godkjennes).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| #7 | Testmiljø i Azure (fase 1, første punkt). https://github.com/Byggcon-sl/EzProp/pull/7 | Venter på Ståle (merge med «Squash and merge») | main |

1 PR venter. Grensen er 3.

## Venter på Ståle

- **PR #7 (testmiljøet) må merges med «Squash and merge»** (første commit på branchen fikk et modellnavn i attribusjonslinjen, og det kan ikke rettes fra skyen).
- **Før testmiljøet kan tas i bruk (helst før merge av PR #7):** lage ressursgruppen `rg-ezprop-test`, lage innlogging for GitHub i Azure (OIDC) og legge inn secrets og variabler med nøyaktige navn. Stegene står i `docs/drift/testmiljo-azure.md` i PR #7. Deretter: åpne appen på ekte iPad Pro fra hjemskjermen («ferdig når»). Ikke legg inn de fire e-post-secretene før Graph-adapteren er bygget (fase 0b).
- **Gi rutinene tilgang** (se `docs/agenter/rutiner.md`): åpne hver rutine på claude.ai/code/routines → Edit → Advanced settings → Repository `Byggcon-sl/EzProp`, miljø «Byggcon», koblingen «Claude Code Remote». Før det gjør hovedløkken ingenting.
- Spørsmålene i `docs/09-apne-sporsmal.md`: nr. 6 (adresse og e-post for testmiljøet i Azure; oppgaven forutsetter kode i serverloggen og tom adresse til han svarer), nr. 8 (GPS-posisjon i bildene fra iPaden, trengs før prøve D) og nr. 9 (hvem har tilgang til ressursgruppen i Azure-portalen; ikke blokkerende for testmiljøet).

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

28.10.2026: hovedløkken kjørte «Testmiljø i Azure» fra oppgavekort til PR #7: branch `fase1-testmiljo-azure` fra `main`, oppgavekort, forhåndsvurdering (forenkler, arkitekt, test-leder, sikkerhet-personvern), testplan, bit A–C og T i parallell, sammenslåing, test-leders gjennomgang, alle sjekker grønne, PR #7 åpnet. Sesjon: https://claude.ai/code/session_01JqwntzCcVvuiXSedMUVdYg

28.10.2026 kl. 14:45–16:00: hovedløkken kjørte oppgave 3 fra oppgavekort til PR #6 (arbeidsflyten «oppgave»: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver). Fase 0a krysset av i planen. Læringsløkken kjørt for PR #4 og #5 (`erfaringer.md`). Sesjon: https://claude.ai/code/session_01JqwntzbzRrrZa27xqnubtP

28.10.2026 kl. 13:44: hovedløkken startet, men stoppet uten GitHub-tilgang. Ingen endringer gjort.

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
