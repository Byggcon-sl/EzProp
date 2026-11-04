# Regel for sletting av betadata

**Utkast, ikke godkjent av Ståle.** 04.11.2026.

- **Fase:** Minimum før ekte data
- **Støtter hovedmål:** Tid: prøvedata blandes ikke inn i ekte oppdrag, og ingen må rydde for hånd. Reklamasjoner: regelen åpner aldri for permanent sletting av ekte data, så rapporter, bilder og logg finnes i 10 år når en sak kommer.
- **Hører sammen med:** [Intern personvernerklæring](intern-personvernerklaering.md)

Dokumentet beskriver regelen. Selve oppryddingen er ikke bygd (se «Når det bygges»).

## 1. Hva som regnes som prøvedata

- Tabellene fra fase 1: `trial_forms`, `trial_answers` og `trial_photos`.
- Oppdiktede brukere, ansatte og filer som er laget for testing.
- Prøverapporter og prøveoppdrag som bare var for testing.

## 2. Hvordan prøvedata merkes (A57)

Det finnes én måte: **en egen prøveorganisasjon.** Alle data har allerede organisasjons-ID (`organization_id`), så det trengs ingen nye felt. Alt som lages for testing, skal ligge i prøveorganisasjonen, ikke i Byggcons ekte organisasjon.

Valgt bort: et merke «prøve» på hvert oppdrag. Det krever et nytt felt, og det er lett å glemme å sette det.

Brukere (`users`) har ingen organisasjons-ID. En oppdiktet bruker regnes som prøvedata bare når alle ansatt-radene til brukeren ligger i prøveorganisasjonen. `users` har ikke `deleted_at`, så brukerraden blir stående; det er ansatt-radene som myk-slettes, og da kommer brukeren ikke inn.

## 3. Regelen

- Prøvedata plukkes **aldri** ut av ekte oppdrag ut fra innholdet (for eksempel adresse, navn eller ordet «test»).
- Bare det som ligger i prøveorganisasjonen, ryddes.
- Ligger prøvedata i Byggcons ekte organisasjon, blir det liggende. Admin kan myk-slette enkeltrader på vanlig måte, én og én.

## 4. Hvordan det ryddes

- **Myk sletting:** `deleted_at` og `deleted_by` settes. Raden finnes fortsatt. Ingenting slettes permanent (CLAUDE.md regel 3, 10 års oppbevaring).
- **Filer** i prøveorganisasjonen myk-slettes som andre rader. Filinnholdet blir liggende i lagringen (`src/db/schema/files.ts`). Oppbevaringstidene står i `src/core/files/retention.ts`, men `retain_until` settes ikke ennå. Filtjenesten (`src/core/files/service.ts`) stopper merkingen bare når feltet har en verdi i fremtiden. I dag kan admin derfor merke filer som slettet. Filinnholdet blir uansett liggende.
- **Eneste unntak er `trial_forms`, `trial_answers` og `trial_photos`.** De kan slettes helt, fordi tabellene skulle inneholde oppdiktede data og bare var for prøven i fase 1 (merknaden 28.10.2026 og `docs/05-domenemodell.md`: «slettes eller gjøres om i fase 2b»). Merk: `trial_photos` er ekte kamerabilder som kan ha posisjon (GPS), og `trial_answers` er fritekst. Bildefilene (`storage_path` i fillagringen) slettes sammen med radene, så ingen bilder blir liggende igjen. Unntaket er **ikke** presedens for andre tabeller.

## 5. Det som aldri ryddes (A58)

- `audit_log` (revisjonsloggen) og `events` ryddes aldri, heller ikke mykt og heller ikke for prøveorganisasjonen. Radene endres aldri (se kommentaren i `src/db/schema/events.ts`).

## 6. Hvem som kan rydde (A59)

- Bare **admin** kan rydde prøveorganisasjonen. Takstmann og leder kan ikke.
- Oppryddingen rører bare prøveorganisasjonen. Brukerraden (`users`) har ikke `deleted_at` og myk-slettes ikke.
- Oppryddingen myk-sletter **aldri** ansatt-raden som gir admin tilgang til den ekte organisasjonen, og aldri siste admin i prøveorganisasjonen. Admin stenges aldri ute (CLAUDE.md regel 11).
- Tilgangen sjekkes i `src/core/access`, som for alt annet.

## 7. Når det bygges

Selve oppryddingen bygges senere, med eget oppgavekort. Disse testene kreves før den godkjennes (fra testplanen `docs/agenter/oppgaver/minimum-personvern-betadata-testplan.md`, avsnittet «Senere»):

| Test | Hva den viser |
|---|---|
| Bare admin kan rydde | Takstmann og leder får avslag, admin får lov. |
| Andre organisasjoner berøres ikke | `expectTenantIsolation` for spørringen som finner rader å rydde. Den ekte organisasjonen er urørt. |
| Bare myk sletting | Radene har `deleted_at` og finnes fortsatt (unntatt `trial_*`). |
| Logg urørt | Antall rader i `audit_log` og `events` er likt før og etter rydding (utenom den nye loggraden for selve ryddingen). |
| Admin ikke stengt ute | Admin logger inn og har tilgang i den ekte organisasjonen etterpå. |

Beslutningene A57–A59 står i `docs/09-apne-sporsmal.md` i tabellen «Avgjort av agentene mens Ståle var borte».
