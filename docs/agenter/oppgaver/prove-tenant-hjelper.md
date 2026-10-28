# Funksjon: Testhjelper for tenant-isolasjon (`expectTenantIsolation`)

- **Fase:** 0a – Repo og database
- **Modul:** kjerne (testhjelpere i `tests/`)
- **Status:** utkast
- **Branch:** `prove-tenant-hjelper` (bygger på `fase-0a-grunnmur`, som ikke er merget ennå)
- **Dato:** 28.10.2026
- **Støtter hovedmål:** Tid: ingen direkte. / Reklamasjoner: indirekte, ved at feil der én organisasjon ser en annens data aldri når produksjon. / KI først: nei (se under). Planen krever punktet: fase 0a, «Testhjelper som viser at en spørring aldri gir data fra en annen organisasjon».

## Problem
Regel 2 i `CLAUDE.md` sier at hver ny spørring skal ha en test som viser at andre organisasjoner ikke får data. I dag skriver hver test dette for hånd (to organisasjoner, to brukere, to ansatte, kall, sjekk). Det tar tid, blir gjort litt ulikt hver gang, og det er lett å glemme én av de to sjekkene (tom liste for feil organisasjon, og nektet tilgang til den andre organisasjonens id). Lar vi være, vokser testpakken med ulike kopier, og noen spørringer får svakere sjekk enn andre.

## KI først
Nei. Dette er testverktøy for utviklerne, ikke en oppgave for takstmannen. KI er ikke med.

## Brukerhistorier
- Som **utvikler** vil jeg **kalle én hjelper med spørringen min** slik at **testen for tenant-isolasjon er lik for alle spørringer og tar ett minutt å skrive**.
- Som **test-leder** vil jeg **se samme sjekk brukt overalt** slik at **gjennomgangen av nye spørringer blir rask og sikker**.

## Omfang
**Med:**
- Én ny eksportert funksjon i `tests/tenant-isolation.ts` (navn: `expectTenantIsolation`). Den:
  1. lager organisasjon A og B med én admin-ansatt i hver (bruker fabrikkene i `tests/factories.ts`);
  2. kaller en `seed`-funksjon som oppgaven sender inn, for å legge rader i **begge** organisasjonene (får `grant` for A og B);
  3. kaller spørringen som bruker i A mot A, og venter at resultatet bare har A-rader (sjekker ved hjelp av et `belongsTo(row)`-oppslag eller ved at B-rader ikke finnes);
  4. kaller spørringen som bruker i A mot B sin id, og venter `AccessDeniedError`;
  5. kaller spørringen som bruker i B mot B, og venter at A-rader ikke er med.
- Signatur (forslag, arkitekt trengs ikke):
  ```ts
  expectTenantIsolation<Row>({
    seed: (grantA: EmployeeGrant, grantB: EmployeeGrant) => Promise<void>,
    query: (actor: Actor, organizationId: string) => Promise<Row[]>,
    organizationIdOf: (row: Row) => string,
  }): Promise<void>
  ```
- Bruk hjelperen i `src/core/audit/audit.test.ts` (testen «viser aldri hendelser fra en annen organisasjon»), slik at den erstatter den håndskrevne varianten.
- Kort omtale i `CLAUDE.md` under «Tilgang» (én setning: hjelperen finnes og skal brukes for hver ny spørring).
- Kryss av punktet i `docs/07-utviklingsplan.md` fase 0a.
- Øk patch-versjon i `package.json`.

**Ikke med (bevisst utelatt):**
- Ingen nye tabeller, ingen migreringer, ingen nye avhengigheter.
- Ingen endring i `src/core/access` (tilgangslogikken er som før; testen i `guards.test.ts` beholdes slik den er).
- Ingen lint-regel som tvinger bruk av hjelperen. Det er en gjennomgangsregel for test-leder, ikke kode. Kan foreslås senere i `docs/09-apne-sporsmal.md`.
- Ingen hjelper for skriving/oppdatering/sletting på tvers av organisasjoner. Bare lesing (spørringer) nå. Skriving kommer når det finnes skriveoperasjoner som tar `organizationId` fra adresse eller skjema.
- Ingen e2e-test. Dette er en enhetstest-hjelper mot testdatabasen.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | – | – |
| kontor | – | – |
| leder | – | – |
| admin | – | – |

Ingen produktfunksjon. Hjelperen bruker rollen `admin` i begge organisasjonene fordi admin aldri stenges ute (regel 11), og isolasjonen dermed må holde selv for admin.

## Data
Ingen nye eller endrede tabeller. `docs/05-domenemodell.md` endres ikke.

## Skjermer
Ingen.

## Regler
Ingen regler som data. Hjelperen er selv testsaken.

## Akseptkriterier
- [ ] `tests/tenant-isolation.ts` eksporterer `expectTenantIsolation` med signaturen over (eller en enklere variant som gjør de samme tre sjekkene).
- [ ] Hjelperen feiler med tydelig melding når spørringen returnerer en rad fra den andre organisasjonen (vist med en test av hjelperen selv: en spørring uten `where organization_id = …` skal få hjelperen til å feile).
- [ ] Hjelperen feiler når spørringen ikke kaster `AccessDeniedError` for den andre organisasjonens id.
- [ ] `src/core/audit/audit.test.ts` bruker hjelperen for `listAuditEvents`, og testen er grønn.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): dekket av hjelperen.
- [ ] `pnpm lint`, `pnpm typecheck` og `pnpm test` er grønne.
- [ ] Virker på iPad-størrelse (e2e): ikke relevant, ingen skjerm.

## Roller
- **utvikler**: skriver hjelperen, testen av hjelperen og bytter ut testen i `audit.test.ts`. Én bit, én worktree.
- **test-leder**: kort forhåndsvurdering (er de tre sjekkene riktige og nok?) og godkjenning til slutt.
- **prosjektleder**: oppgavekort, PR, tilstand og plan.

Ikke med: arkitekt (ingen skjema eller grensesnitt), ux/ui (ingen skjerm), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagstoff), sikkerhet-personvern (ingen ny tilgangslogikk, ingen kundedata; test-leder dekker isolasjonen), forenkler (omfanget er allerede minst mulig; «ikke med» står over).

## Åpne spørsmål
- Ingen for Ståle.
