# Funksjon: Testhjelper for tenant-isolasjon (`expectTenantIsolation`)

- **Fase:** 0a – Repo og database
- **Modul:** kjerne (testhjelpere i `tests/`)
- **Status:** spesifisert (forhåndsvurdering fra test-leder tatt inn 28.10.2026)
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
  2. kaller en `seed`-funksjon som oppgaven sender inn, for å legge rader i **begge** organisasjonene (får `grant` for A og B). `seed` returnerer id-ene den la inn per organisasjon: `{ a: string[]; b: string[] }`;
  3. kaller spørringen som bruker i A mot A, og venter at **alle** A-radene er med (minst én) og **ingen** B-rader (sammenlignet med `idOf(row)`);
  4. kaller spørringen som bruker i B mot B, og venter det samme speilvendt: alle B-rader, ingen A-rader;
  5. kaller spørringen som bruker i A mot B sin id, og venter `AccessDeniedError`;
  6. kaller spørringen som bruker i B mot A sin id, og venter `AccessDeniedError` (symmetrisk nektelse).
- Hjelperen kaster en egen feilklasse (`TenantIsolationError`, `extends Error`) med tydelig norsk melding som sier hvilken organisasjon og hvilken rad-id som lekket, eller hvilken organisasjon som manglet egne rader, eller hvilken retning som ikke ble nektet. Ikke en generell assert-feil, slik at selvtesten kan matche på meldingen (`rejects.toThrow(/organisasjon B/)`).
- Signatur (arkitekt trengs ikke):
  ```ts
  expectTenantIsolation<Row>({
    seed: (grantA: EmployeeGrant, grantB: EmployeeGrant) => Promise<{ a: string[]; b: string[] }>,
    query: (actor: Actor, organizationId: string) => Promise<Row[]>,
    idOf: (row: Row) => string,
  }): Promise<void>
  ```
- `vitest.config.ts`: legg `tests/**/*.test.ts` til i `include`, slik at selvtesten av hjelperen faktisk kjøres. Ingen ny avhengighet.
- Selvtest av hjelperen i `tests/tenant-isolation.test.ts` (fire tester, se testplanen under). Spørringene som skal få hjelperen til å feile skrives som lokale funksjoner i selvtesten, aldri i produktkoden.
- Bruk hjelperen i `src/core/audit/audit.test.ts`: testen «viser aldri hendelser fra en annen organisasjon» byttes ut med ett kall til `expectTenantIsolation` der `seed` legger inn én hendelse i hver organisasjon via `recordAuditEvent` med `grantA`/`grantB` og returnerer id-ene. Den første testen (leder/admin leser, takstmann nektes) beholdes uendret.
- Kort omtale i `CLAUDE.md` under «Tilgang» (én setning: hjelperen finnes og skal brukes for hver ny spørring).
- Kryss av punktet i `docs/07-utviklingsplan.md` fase 0a.
- Øk patch-versjon i `package.json`.

**Ikke med (bevisst utelatt):**
- Ingen nye tabeller, ingen migreringer, ingen nye avhengigheter.
- Ingen endring i `src/core/access` (tilgangslogikken er som før; testen i `guards.test.ts` beholdes slik den er).
- Ingen endring i `src/core/audit/index.ts`. `listAuditEvents` skal **ikke** ta med `organizationId` i select bare for testens skyld (se «Avgjørelser»).
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
- [ ] `vitest.config.ts` har `tests/**/*.test.ts` i `include`, og `pnpm test` viser at `tests/tenant-isolation.test.ts` faktisk kjører (test-leder godkjenner ikke før dette er sett i kjøringen).
- [ ] `tests/tenant-isolation.ts` eksporterer `expectTenantIsolation` med signaturen over (`seed` returnerer id-er per organisasjon, hjelperen tar `idOf`).
- [ ] Hjelperen feiler med egen `TenantIsolationError` og tydelig norsk melding som nevner organisasjonen og raden, når spørringen returnerer en rad fra den andre organisasjonen (selvtest: en lokal spørring uten `where` skal få hjelperen til å feile).
- [ ] Hjelperen feiler når spørringen ikke kaster `AccessDeniedError` for den andre organisasjonens id (selvtest: en lokal spørring som returnerer `[]` i stedet for å kaste). Sjekkes i begge retninger (A mot B sin id, B mot A sin id).
- [ ] Hjelperen feiler når spørringen ikke returnerer organisasjonens egne rader (selvtest: en lokal spørring som alltid gir `[]`).
- [ ] `src/core/audit/audit.test.ts` bruker hjelperen for `listAuditEvents`, og testen er grønn. Første test i filen er uendret. `src/core/audit/index.ts` er uendret.
- [ ] `src/core/access/guards.test.ts` er uendret.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): dekket av hjelperen.
- [ ] Admin brukes i begge organisasjoner, `resetDatabase` i `beforeEach`.
- [ ] `pnpm lint`, `pnpm typecheck` og `pnpm test` er grønne.
- [ ] Virker på iPad-størrelse (e2e): ikke relevant, ingen skjerm.

## Testplan (fra test-leder, godkjent av prosjektleder)
- `tests/tenant-isolation.test.ts`:
  - «godtar en spørring som filtrerer på grant.organizationId» (bruker `listAuditEvents`, grønn).
  - «feiler når spørringen returnerer rader fra den andre organisasjonen» (lokal `db.select().from(auditLog)` uten filter → kaster `TenantIsolationError`, melding nevner organisasjonen).
  - «feiler når spørringen ikke kaster AccessDeniedError for fremmed id» (lokal funksjon som returnerer `[]` for fremmed id).
  - «feiler når spørringen ikke returnerer organisasjonens egne rader» (lokal funksjon som alltid gir `[]`).
- `src/core/audit/audit.test.ts`: test 2 byttes ut med ett kall til `expectTenantIsolation`. Test 1 uendret.
- `src/core/access/guards.test.ts`: uendret.
- Ingen e2e.

## Avgjørelser (prosjektleder, 28.10.2026)
Test-leder ba om seks endringer. Alle er tatt inn. Begrunnelse:
1. **Selvtesten må kjøre.** Sjekket `vitest.config.ts`: `include` har bare `src/**` og `eslint-rules/**`. Uten `tests/**/*.test.ts` ville kriteriene vært «grønne» uten å ha kjørt. Lagt til i «Med».
2. **`seed` returnerer id-er, hjelperen tar `idOf`** (alternativ a). Sjekket `src/core/audit/index.ts`: `listAuditEvents` returnerer ikke `organizationId`, så `organizationIdOf(row)` ville ikke fungert. Alternativ b (utvide select) ville endret produktkoden bare for testen, og hjelperen ville avhenge av hva hver spørring viser. Alternativ a holder produktkoden urørt og virker for alle spørringer som har en id.
3. **Fjerde sjekk: egne rader må komme.** Uten denne passerer en spørring som alltid gir tom liste. Lagt til som sjekk og eget akseptkriterium.
4. **Symmetrisk nektelse.** Billig og fanger feil der bare én retning er sjekket.
5. **Egen feilklasse med norsk melding.** Gjør selvtesten presis og feilen lett å lese for den som kjører testene.
6. **Feilspørringene bor i selvtesten,** aldri i produktkoden.
Ingen uenighet som gjelder fag, pris, personvern eller ny funksjon. Ingenting til `docs/09-apne-sporsmal.md`.

## Roller
- **utvikler**: skriver hjelperen, selvtesten, `vitest.config.ts`-endringen og bytter ut testen i `audit.test.ts`. Én bit, én worktree.
- **test-leder**: forhåndsvurdering (gjort 28.10, seks endringer tatt inn) og godkjenning til slutt. Godkjenner ikke før selvtesten er sett kjøre.
- **prosjektleder**: oppgavekort, PR, tilstand og plan.

Ikke med: arkitekt (ingen skjema eller grensesnitt), ux/ui (ingen skjerm), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagstoff), sikkerhet-personvern (ingen ny tilgangslogikk, ingen kundedata; test-leder dekker isolasjonen), forenkler (omfanget er allerede minst mulig; «ikke med» står over).

## Åpne spørsmål
- Ingen for Ståle.
