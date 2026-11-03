# Liten oppgave (r) og (s): småfunn fra PR #69 og nattløkken 03.11.2026 (fase 0b)

**I arbeid:** hovedløkken startet oppgaven 03.11.2026 kl. 06:15 UTC på branchen `fase0b-smafunn-r-s` (markør, 3-timersregelen). Oppgavekortet fylles ut av arbeidsflyten «oppgave».

Omfang (fra `docs/agenter/tilstand.md`):

- **Liten oppgave (r)** (små funn fra gjennomgangen av PR #69): håndskrevet type i `senderForConnection` i stedet for typen fra skjemaet; test 16 i `email.test.ts` dekkes av test 13; test 9 i `connections.test.ts` 3.12 gjentar `email.test.ts` 8.2; spioner på `put`/`get` i `config.test.ts` test 6 beviser ingenting; de eksakte ordene i `SENSITIVE_KEY` i `logger.ts` er overflødige etter suffiks-utvidelsen.
- **Nattløkken punkt 20:** `findOrCreateUser` i `src/core/organization/employees-admin.ts` slår opp med `lower(users.email)` (Seq Scan). Sammenlign rett på `email` (skjemaet gjør alt til små bokstaver), med test. Mål: tid.
- **Nattløkken punkt 19:** `employee_permissions` mangler indeks som begynner med `organization_id`. Enten ny migrering `(organization_id, employee_id) WHERE deleted_at IS NULL`, eller skriv unntaket inn i `docs/05-domenemodell.md`. Agentene velger det enkleste.
- **Nattløkken punkt 18:** ustabil e2e-test i prøve D (`e2e/fase-1-prove-d-bilder.spec.ts`, «kopi som får 400 …»): `waitForFile` kan se en halvskrevet fil. Skriv til midlertidig fil og gi nytt navn i `photo-storage.ts`, eller vent på riktig størrelse i testen. Mål: reklamasjoner.

Ikke med: nøkkelboksen (egen branch `fase0b-nokkelboks`, annen kjøring), `ci.yml`, `deploy-azure.yml`, `secrets.ts`, `env.ts`. Ingen ny funksjon, ingen ny avhengighet.
