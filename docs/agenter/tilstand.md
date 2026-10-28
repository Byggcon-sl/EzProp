# Tilstand for agentlaget

Oppdateres av prosjektlederen etter hvert steg. Leses først i hver kjøring. Alle steg tåler å kjøres to ganger.

Sist oppdatert: 28.10.2026 (oppgave 4: byggingen fordelt i fire biter til utvikler og testskriver; `listTrialPhotos` lagt til i kontrakten; modellnavn-sjekken unntar attribusjonslinjene)

## Gjeldende fase

**Fase 0a – Repo og database: ferdig.** PR #1–#6 er merget 28.10.2026.

Gjeldende fase: **Fase 1 – Prøve uten nett.** Testskjemaet (oppgave 3, PR #6) er merget. Testmiljøet i Azure ligger som PR #7 og venter på Ståle.

## Gjeldende oppgave

**Oppgave 4 – Første kandidat: PowerSync koblet til testskjemaet** (fase 1, punktet «Kandidater satt opp mot samme testskjema»). Branch `fase1-kandidat-powersync` fra `main` (etter PR #6). Oppgavekort `docs/funksjoner/fase1-kandidat-powersync.md`, protokoll og resultatmal for prøve A og B `docs/funksjoner/fase1-prove-ab-powersync.md`. Steg: oppgavekort skrevet 28.10.2026; runde 1 (forenkler, arkitekt, sikkerhet-personvern, test-leder) ferdig og kortet oppdatert samme dag (DELETE kuttet, HS256 og Container Apps som eneste valg, `TrialSyncStore`-grensesnitt, tenant-voktere på id og skjema, bilderute som lager raden selv, testkrok `window.__offlineTrial`; avgjørelsene står nederst i kortet). Arkitekt har lagt tabeller, migrering `0001_prove-uten-nett` (med publikasjonen `powersync`) og kontrakten i `sync/types.ts`, `server/types.ts` og `server/errors.ts` (`e31db54`). Test-leder har skrevet testplanen `docs/funksjoner/fase1-kandidat-powersync-testplan.md` (`06121fa`). Prosjektleder har lagt inn de nye avhengighetene (`@powersync/web` 2.5.0, `@powersync/react` 2.1.0, `@journeyapps/wa-sqlite` 2.0.10, `yjs` 13.6.33, `jose` 6.2.13; `113c01f`) så ingen bit rører `package.json`. **Runde 2 (forenkler, sikkerhet-personvern, test-leder) ferdig 28.10.2026:** tekstfletting (Yjs), varselet «Endret av en annen» og bildekøen (også serverdelen `storeTrialPhoto` og ruten `PUT /api/prove/bilder/[id]`) er kuttet til to oppfølgingsoppgaver; `yjs` er fjernet fra `package.json`; kontraktfilene `sync/types.ts`, `server/types.ts` og `server/errors.ts` er trimmet (ingen `TextMerge`, `DetectForeignChanges`, `ShouldReleaseLocalPhoto`, `StoreTrialPhoto`, bildefeil; `maxBodyBytes` 4 MB lagt til); sikkerhets åtte funn og test-leders fire rettelser står i kortet («Avgjørelser etter runde 2»). Test-leder justerer testplanen (2.1, 2.2, 2.4, 3.4 ut; avgjørelsen står øverst i planen). **Test-leder har kontrollert planen mot repoet (`a0f4ff5`) med to funn, begge tatt:** `ListTrialPhotos` er lagt til i `server/types.ts` og kortet (tre lesefunksjoner, alle med `expectTenantIsolation`); modellnavn-sjekken unntar attribusjonslinjene `Co-Authored-By:`/`Claude-Session:` (skyverktøyet legger dem på, Ståle squash-merger med PR-tittelen). **Nå: utvikler og testskriver i parallell på fire biter** (ingen rører samme fil; `package.json` røres ikke, versjonen 0.1.3 er satt): **Bit 1 klient** (`src/modules/offline-trial/sync/**`, `answers.ts`, `trial-form-view.tsx`, sidene under `src/app/(ansatt)/prove/testskjema/`, `log-out-button.tsx`, teknisk tabell i protokollen; tester 2.3, 2.5, 2.6, 2.7, 2.10, e2e 6.1 og 6.2 unntatt rutetestene). **Bit 2 server** (`src/modules/offline-trial/server/**`, `src/app/api/prove/synk/**`, `tests/setup-env.ts`; tester 2.8, 3.1, 3.2, 3.3, 3.5, 3.6, e2e 6.2 rutetestene 401/403/no-store/400/413). **Bit 3 drift** (`docker-compose.yml`, `powersync/config.yaml`, `powersync/sync-rules.yaml`, `scripts/docker-init.sql`, `start.sh`, `.env.example`, `.github/workflows/ci.yml`, `playwright.config.ts`, `docs/drift/powersync.md`; test 2.9 og avsnitt 7). **Bit 4 service worker** (`public/sw.js`, registreringskomponent, `src/app/layout.tsx`; e2e 6.2 «skjemaet åpner fra hurtiglageret …» og «service worker rører ikke …»). Kontrakt bit 1↔4: hurtiglagernavn `offline-trial-static-v1`/`offline-trial-pages-v1`, bit 1 sletter prefikset `offline-trial-`. Deretter sikkerhet-personvern (`/security-review`), test-leder godkjenner, PR mot `main`. Versjon 0.1.2 → 0.1.3 (gjort). Nytt spørsmål nr. 10 til Ståle (PowerSync: selvdrevet eller sky, pris, lisens, databehandleravtale), ikke blokkerende.

**Rekkefølge videre i fase 1:** to kandidatuavhengige oppfølgingsoppgaver fra runde 2 (bygges én gang mot `TrialSyncStore` og `applyTrialChanges`, så «Arbeid» sammenlignes rettferdig; detaljer i kortet under «Oppfølgingsoppgaver»): **«Bildekø for prøve A og D»** (fil i IndexedDB, opplasting med SHA-256-kontroll, «M bilder» i indikatoren, `var/` i `.gitignore`; må være merget før steg A4) og **«Prøve B: tekstfletting og varsel»** (`text-merge.ts`, `text_state` i synk, `foreign-change.ts`, «Endret av en annen»; må være merget før prøve B). Så kandidat 2 (ElectricSQL) og kandidat 3 (egenbygd) på samme skjema og samme protokoll → Ståle kjører prøve A og B per kandidat på ekte iPad når PR #7 og PowerSync i Azure er oppe → prøve C–F → sammenligning og ADR. Punktet «Kandidater satt opp …» krysses av først når alle tre er satt opp.

Hovedmål for fase 1: tid og KI først (grunnlaget for befaring på iPad, der KI-forslag senere vises og godkjennes). Oppgave 4 støtter også reklamasjoner (ingenting går tapt mellom befaring og rapport).

## Åpne PR-er

| PR | Oppgave | Status | Bygger på |
|---|---|---|---|
| #7 | Testmiljø i Azure (fase 1, første punkt). Versjon 0.2.0 | Venter på Ståle (nøkler, adresse, «Squash and merge») | Ingen |

Én PR venter. Grensen er 3. Oppgave 4 blir PR nr. 2 i køen; den bygger ikke på #7 i kode, men prøvene A og B trenger testmiljøet. Versjonskonflikten (0.1.3 mot 0.2.0) løses av prosjektlederen når Ståle har merget #7.

## Venter på Ståle

- **PR #7:** følg `docs/drift/testmiljo-azure.md`: lag ressursgruppen og GitHub-innloggingen i Azure, legg inn secrets og variabler, svar på spørsmål nr. 6 og nr. 9, og merge med **«Squash and merge»**.
- **Gi rutinene tilgang** (se `docs/agenter/rutiner.md`): åpne hver rutine på claude.ai/code/routines → Edit → Advanced settings → Repository `Byggcon-sl/EzProp`, miljø «Byggcon», koblingen «Claude Code Remote». Før det gjør hovedløkken ingenting.
- Spørsmålene i `docs/09-apne-sporsmal.md`: nr. 6 (adresse og e-post for testmiljøet), nr. 8 (GPS-posisjon i bildene, før prøve D), nr. 9 (tilgang til ressursgruppen, i PR #7) og nr. 10 (PowerSync som leverandør, før ADR-en).

## Oppgaver fra nattløkken

Ingen ennå.

## Trenger Ståle (stoppet etter 3 retteforsøk)

Ingen.

## Siste kjøring

28.10.2026 (fjerde kjøring, oppgave 4, fordeling): prosjektleder tok test-leders to funn (`listTrialPhotos` i kontrakt og kort; modellnavn-sjekken unntar attribusjonslinjene), delte bit 2 i server og drift, la hurtiglagernavnene som kontrakt mellom bit 1 og 4, og fordelte fire biter til utvikler og testskriver. Ingen nye spørsmål til Ståle. Sesjon: https://claude.ai/code/session_01Jqwnu1uLzFzcU2aSGh5vhH

28.10.2026 (tredje kjøring, oppgave 4, runde 2): forenkler, sikkerhet-personvern og test-leder vurderte kortet på nytt. Prosjektleder kuttet tekstfletting, varsel og bildekø (også serverdelen, uenig med test-leder, begrunnet i kortet), tok inn alle sikkerhetsfunn og test-leders rettelser, fjernet `yjs`, trimmet kontraktfilene og committet arkitektens presiseringer. Ingen nye spørsmål til Ståle. Sesjon: https://claude.ai/code/session_01Jqwnu1uLzFzcU2aSGh5vhH

28.10.2026 (andre kjøring, oppgave 4): hovedløkken startet oppgave 4 på nytt med snevrere ramme (fra `fase1-testmiljo-azure`, uten Yjs og bildekø). Branchen `fase1-kandidat-powersync` fantes alt med vurdert kort, arkitektarbeid, testplan og avhengigheter. Avgjørelse: det eksisterende kortet gjelder, branchen blir på `main`, forenkler avgjør i runde 2 om Yjs og bildekø kuttes (merknad nederst i kortet). Et nytt, snevrere kort ble skrevet og forkastet. Hvis to kjøringer bygger på samme branch samtidig: den som pusher sist, fletter inn den andres commits (ingen force-push). Sesjon: https://claude.ai/code/session_01Jqwnu1uLzFzcU2aSGh5vhH

28.10.2026: hovedløkken kjører oppgave 4 (første kandidat, PowerSync): branch, oppgavekort, protokoll for prøve A og B, spørsmål nr. 10, ordliste, runde 1, arkitekt, testplan, avhengigheter og fordeling i fire biter. Sesjon: https://claude.ai/code/session_01JqwntzCcVvuiXSedMUVdYg

28.10.2026 kl. 17:34–18:49: PR #6 merget av Ståle (kl. 17:34), deretter oppgaven «Testmiljø i Azure» fra oppgavekort til PR #7 (åpnet kl. 18:49).

28.10.2026 kl. 14:45–16:00: hovedløkken kjørte oppgave 3 fra oppgavekort til PR #6 (arbeidsflyten «oppgave»: forenkler, test-leder, sikkerhet-personvern, utvikler, testskriver). Fase 0a krysset av i planen. Læringsløkken kjørt for PR #4 og #5 (`erfaringer.md`). Sesjon: https://claude.ai/code/session_01JqwntzbzRrrZa27xqnubtP

28.10.2026 kl. 13:44: hovedløkken startet, men stoppet uten GitHub-tilgang. Ingen endringer gjort.

28.10.2026: første kjøring (fase 0a). Sesjon: https://claude.ai/code/session_01Jqwnu2ZDo3evvV7iSgdvQZ
