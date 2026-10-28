# ADR 0001 – Teknologivalg: samme som Optiplan

Dato: 28.10.2026. Status: vedtatt (Ståle 25.10.2026: «utvikling som i Optiplan»).

## Beslutning

EzProp bruker samme teknologi og arbeidsform som Optiplan: Next.js App Router, TypeScript strict, PostgreSQL, Drizzle, Better Auth med e-post-engangskode, Tailwind, Zod, Vitest, Playwright, pnpm og GitHub Actions. Repoet er satt opp etter samme mønster (CLAUDE.md, `docs/`, `src/core`, `src/modules`, `src/shared`, lint-regel for modulgrenser, testhjelpere, `start.sh`, `session-start.sh`).

## Hvorfor

- Én teknologi å kunne for Byggcon, og felles innlogging blir enklere.
- Optiplans oppsett er prøvd i drift (Azure, EU/EØS, Microsoft 365 for e-post).
- Agentlaget kan gjenbruke mønstre og tester fra Optiplan.

## Forskjeller fra Optiplan

- **Felles kolonner på alle tabeller** med `id` laget på enheten (UUID v7), `organization_id`, myk sletting og `row_version` (`src/db/schema/common.ts`), fordi befaringen må virke uten nett.
- **Organisasjonen er takstfirmaet**, ikke kunden. Kunder, selgere og meglere er kontakter.
- **Befaringen på iPad kjører mer i nettleseren** (PWA, lokal lagring, synk). Verktøyet velges i fase 1 (egen ADR).
- **Tilstandsrapporten har låste utgivelser med versjoner**, ikke «levende rapport» som i Optiplan.
- **Ingen abonnement eller moduler per kunde.** Tilgang er rettigheter per ansatt.

## Konsekvenser

Felles innlogging med Optiplan og valg av synkverktøy avgjøres i egne ADR-er (fase 1 og 0b). Pakkeversjonene holdes like Optiplans så lenge det er praktisk.
