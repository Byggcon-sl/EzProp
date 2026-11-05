# Funksjon: Statusflyten for oppdrag, kansellering og merket «Rettet»

- **Fase:** 2a – Rapporten på PC (femte punkt under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/assignments`, siden `/oppdrag/[id]`, en linje på `/ordre/[id]`)
- **Branch:** `fase2a-statusflyt` (bygger på `main`)
- **Status:** klar til bygging (05.11.2026, prosjektleder)
- **Dato:** 05.11.2026
- **Støtter hovedmål:** Tid: status endres med ett trykk på oppdragssiden, og alle ser hvor oppdraget står uten å spørre. Hendelsene gir grunnlaget for tidsmålingen per fase (eget planpunkt). Reklamasjoner: hver statusendring og kansellering lagres med hvem, når og grunn, så det kan spores i ettertid hva som skjedde med et oppdrag; kansellerte oppdrag slettes aldri. Merket «Rettet» viser hvilke rapporter som er rettet etter levering, som er råstoff for å finne årsaker til reklamasjoner. KI først: se under.

## Problem
Oppdraget står i dag alltid som «Bestilt». Ingen kan flytte det videre, og et oppdrag som ikke blir noe av, kan ikke fjernes. Uten statusflyt kan ikke arbeidskøen (neste planpunkt) vise faner etter status, og tidsmålingen har ingen hendelser å regne fra. Ståle bestemte 27.10.2026 fire statuser (bestilt, under arbeid, ferdig, fakturert), kansellering som myk sletting, og merket «Rettet» under «Ferdig».

## KI først
Ikke KI nå. Statusen er en fast regel, ikke et skjønn. Senere settes statusene automatisk av hendelser (befaring startet gir «Under arbeid», `report.sent` gir «Ferdig», faktura sendt gir «Fakturert»), så takstmannen ikke trykker i det hele tatt. Denne oppgaven lager overgangene og hendelsene som den automatikken skal bruke.

## Brukerhistorier
- Som **takstmann** vil jeg **flytte oppdraget til neste status med ett trykk** slik at **kontoret ser hvor det står**.
- Som **kontor** vil jeg **kansellere et oppdrag med en grunn** slik at **det forsvinner fra arbeidet uten at noe slettes**.
- Som **leder** vil jeg **se i loggen hvem som endret status, når og hvorfor** slik at **jeg kan spore hva som skjedde ved en klage**.

## Omfang
**Med:**
1. **Ingen migrering.** Grunnen til kansellering står i hendelsen `assignment.cancelled`, og tidspunktet for statusendringen i hendelsen `assignment.status_changed`. Ingen ny tabell, ingen ny kolonne, heller ikke for «Rettet» (A72).
2. **Lovlige overganger** som ren funksjon i `src/core/assignments/status-flow.ts` (A69):
   - `allowedTransitions(status)` gir neste status (ett steg fram) og forrige status (ett steg tilbake). Ingen hopp.
   - Ett steg fram: ingen grunn. Ett steg tilbake: grunn påkrevd (1–500 tegn, Zod-skjema i `schemas.ts`).
   - `canCancel(status)`: bare `ordered` og `in_progress` (A71).
   - Testsaker for alle 16 kombinasjoner av fra/til (lovlig, ulovlig, krever grunn), som én tabellstyrt test (`it.each`) over tabellen i «Regler».
3. **`changeAssignmentStatus(actor, organizationId, assignmentId, { expectedStatus, toStatus, reason? })`** i `src/core/assignments/status.ts`:
   - `requireOrganizationAccess(..., "assignment.edit")`, alle spørringer filtrerer på `grant.organizationId`.
   - Én transaksjon: låser raden (`FOR UPDATE`, bare ikke slettet), sjekker at `status = expectedStatus` (ellers `AssignmentStatusConflictError`, «Statusen er endret av noen andre. Last siden på nytt.»), sjekker overgangen, oppdaterer `status`, `updated_at`, `updated_by`.
   - Hendelse `assignment.status_changed` med `data: { from, to, reason? }` og revisjonslogg `entityType: "assignment"`, `action: "update"`, `changes: { status: { from, to } }` (grunnen står i hendelsen, ikke i revisjonsloggen).
4. **`cancelAssignment(actor, organizationId, assignmentId, { expectedStatus, reason })`** i samme fil:
   - Samme tilgang, lås og konfliktsjekk. Bare fra `ordered` og `in_progress`. Grunn påkrevd (1–500 tegn).
   - Setter `deleted_at`, `deleted_by`, `updated_at`, `updated_by`. Grunnen lagres bare i hendelsen. Statusen beholdes som den var.
   - Hendelse `assignment.cancelled` med `data: { status, reason }` og revisjonslogg `action: "delete"` (myk sletting).
   - Ordren beholder `converted` og `assignment_id`.
5. **Merket «Rettet»** (A72): ren funksjon `isCorrected({ status, highestSentReleaseVersion })` i `status-flow.ts`, sann bare når `status = completed` og versjonen er 2 eller høyere. `getAssignment` returnerer `corrected: false` til utgivelsene finnes (fast verdi med kommentar som peker på planpunktet «Utgivelser med versjon»). Merket vises som `Badge` «Rettet» ved siden av statusen på oppdragssiden.
6. **Oppdragssiden** `/oppdrag/[id]`, nytt kort «Status» øverst, bare knappene med `canEditOrders` (sjekken skjer i kjernen):
   - Status som merke.
   - Én hovedknapp for neste status, med navnet på den («Sett til Under arbeid», «Sett til Ferdig», «Sett til Fakturert»). Ingen hovedknapp på «Fakturert».
   - En liten knapp «Tilbake til <forrige>» som åpner et felt for grunn og «Lagre».
   - «Kanseller oppdraget» (bare fra Bestilt og Under arbeid) åpner et felt for grunn og en tydelig bekreftelse «Kanseller». Etterpå sendes brukeren til `/arbeidskoe` med meldingen «Oppdrag <nr> er kansellert.»
   - Feil (konflikt, ulovlig overgang, tom grunn) vises som norsk melding i kortet. Skjema og server-handlinger i samme mønster som `team-form.tsx` og `actions.ts`.
7. **Ordresiden** `/ordre/[id]`: er oppdraget kansellert, står «Gjort om til oppdrag <nr> (kansellert)» uten lenke. `getOrder` får feltet `assignmentCancelled` (fra `assignments.deleted_at` i den eksisterende joinen).
8. **Tester** (testskriver):
   - Enhetstester for `status-flow.ts`: én `it.each` over alle 16 overganger, pluss `canCancel` og `isCorrected`.
   - Integrasjonstester: fram ett steg, tilbake med grunn, tilbake uten grunn nektes, hopp nektes, feil `expectedStatus` gir konflikt, kansellering setter `deleted_at`, legger grunnen i hendelsen og gjør oppdraget usynlig for `getAssignment`, kansellering fra «Ferdig» nektes, og ett kall mot et kansellert oppdrag gir «ikke funnet» (låsen finner bare rader som ikke er slettet). Hendelse og revisjonslogg kommer én gang per endring, med riktig `data`.
   - Tilgang: uten `assignment.edit` nektes begge funksjonene. Admin får alltid lov.
   - Tenant-isolasjon: `expectTenantIsolation` for `changeAssignmentStatus` og `cancelAssignment` (annen organisasjon får verken endret eller sett oppdraget).
   - e2e (PC og iPad-størrelse), lagt inn i den eksisterende `e2e/fase-2a-oppdrag-team-parter.spec.ts` (ingen ny fil): Bestilt → Under arbeid → tilbake med grunn → kanseller med grunn → havner i arbeidskøen med meldingen.
9. **Dokumenter og versjon:** `docs/05-domenemodell.md` 4.3 («Bygget i fase 2a»: overgangene, kansellering med grunn i hendelsen, «Rettet» regnes ut), ordlisten (`corrected`), intern personvernerklæring (grunnen i hendelsene er fritekst; skriv ikke personopplysninger der), planpunktet krysses av, `package.json` 0.2.76 → 0.2.77, A69–A72 i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**
- Automatisk status fra hendelser (befaring startet, `report.sent`, faktura sendt). Kommer med «Send»-knappen, befaringen og fakturaen (A70).
- Utgivelser (`report_releases`) og at «Rettet» faktisk settes. Bare funksjonen og merket nå.
- Angre kansellering og papirkurv (eget planpunkt «Papirkurv og angre for sletting»).
- «På vent» som status eller hendelse med knapp, og andre hendelser enn de to over.
- Visning av hendelser eller endringslogg på oppdragssiden (admin ser revisjonsloggen på `/admin/logg`).
- Oppdragslisten, faner og filter (neste planpunkt).
- Nye rettigheter. Begge handlingene bruker `assignment.edit`.
- Sperrer for overgangene (for eksempel «Ferdig» krever publisert rapport). Rapporten finnes ikke ennå.

## Tilgang
| Rolle | Se | Endre status / kansellere |
|---|---|---|
| takstmann | ja | ja, med `access.inspectors_edit_all` (standard på) |
| kontor | ja | ja (`assignment.edit`) |
| leder | ja | ja |
| admin | ja | ja, alltid |

Bare `src/core/access` avgjør. Siden viser knappene ut fra `canEditOrders`, men kjernen sjekker på nytt.

## Data
- Ingen migrering. Bruker eksisterende `status`, `deleted_at`, `deleted_by`, `updated_at`, `updated_by` på `assignments`.
- Hendelsestyper som tas i bruk (finnes allerede i `src/core/events/types.ts`): `assignment.status_changed`, `assignment.cancelled`.
- Faste koder som tas i bruk: de fire statusene i `ASSIGNMENT_STATUSES`. Ingen nye koder.
- Ingen ny tabell, så `tests/tenant-tables.ts` endres ikke.

## Skjermer
- PC og iPad: kortet «Status» øverst på `/oppdrag/[id]`. Hovedhandling: neste status, ett trykk (før: ikke mulig). Tilbake og kanseller: tre trykk (knapp, skriv grunn, bekreft). Trykkflater minst 44 px.

## Regler
Overgangene er en fast tabell i kode med testsaker (ikke fagregler, så ikke malmotoren):

| Fra | Fram (uten grunn) | Tilbake (med grunn) | Kanseller (med grunn) |
|---|---|---|---|
| Bestilt | Under arbeid | – | ja |
| Under arbeid | Ferdig | Bestilt | ja |
| Ferdig | Fakturert | Under arbeid | nei |
| Fakturert | – | Ferdig | nei |

## Akseptkriterier
- [ ] Ett trykk flytter oppdraget ett steg fram; status, hendelse og revisjonslogg lagres i samme transaksjon.
- [ ] Ett steg tilbake krever grunn; grunnen står i hendelsen.
- [ ] Hopp over en status, og endring fra en status som ikke lenger gjelder, nektes med norsk melding.
- [ ] Kansellering fra Bestilt eller Under arbeid krever grunn, setter `deleted_at`, grunnen står i hendelsen, og oppdraget vises ikke lenger; ingenting slettes.
- [ ] Ferdig og Fakturert kan ikke kanselleres.
- [ ] Ordresiden viser «(kansellert)» uten lenke for et kansellert oppdrag.
- [ ] Merket «Rettet» vises når `isCorrected` er sann (enhetstest), og aldri ellers.
- [ ] Uten `assignment.edit` nektes endring; admin får alltid lov (test).
- [ ] Bruker i annen organisasjon får ikke tilgang (test med `expectTenantIsolation`).
- [ ] Virker på iPad-størrelse (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjon 0.2.77.

## Beslutninger tatt i autonom modus (føres i `docs/09-apne-sporsmal.md`)
- **A69 Overganger:** ett steg fram uten grunn, ett steg tilbake med grunn, ingen hopp. Hvorfor: det enkleste som gjenspeiler arbeidsgangen, og tilbake trengs for feiltrykk; grunnen gjør det sporbart (reklamasjoner). Kilde: statuslisten 27.10.2026 (spørsmål 13), domenemodellen 4.3. Endres i `status-flow.ts`.
- **A70 «Ferdig» settes for hånd inntil «Send»-knappen finnes.** Da settes den av `report.sent` (innspill D16). Hvorfor: uten rapport og sending ennå er hånd eneste vei, og arbeidskøen trenger statusene. Kilde: domenemodellen 4.3 og 4.9, plan (innspill P9). Endres når «Send»-knappen bygges.
- **A71 Kansellering bare fra Bestilt og Under arbeid, med grunn, for alle med `assignment.edit`.** Hvorfor: et levert eller fakturert oppdrag må stå synlig i 10 år og kan ha reklamasjon; alle takstmenn kan endre alt (27.10.2026). Kilde: Ståles svar 27.10.2026, regel 3 i `CLAUDE.md`. Endres i `canCancel`.
- **A72 «Rettet» regnes ut og lagres ikke, og statusflyten får ingen nye kolonner.** Funksjonen og merket lages nå; verdien kommer fra utgivelsene når de bygges. Grunn for kansellering og tidspunkt for statusendring står bare i hendelsene (`assignment.cancelled`, `assignment.status_changed`), ikke som kolonner på `assignments`. Hvorfor: unngår dobbel lagring og en migrering ingen skjerm trenger ennå (det enkleste som virker). Kilde: domenemodellen 4.3 («regnes ut fra utgivelsene») og hendelsesmodellen. Endres ved å koble `getAssignment` til `report_releases`, og ved å legge til `status_changed_at` eller `cancelled_reason` når arbeidskøen eller papirkurven trenger raske oppslag.

## Roller
utvikler, testskriver (i parallell), test-leder (gjennomgang og tester), sikkerhet-personvern (kort gjennomgang: myk sletting, fritekst i hendelser, tenant-isolasjon). Ikke arkitekt, ux, ui, fag eller KI: ingen ny tabell, kortet følger mønsteret på siden, ingen fagtekster.

## Gjennomgang av kortet (prosjektleder, 05.11.2026)
Forenkleren foreslo fem kutt. Alle er tatt:
1. Migreringen 0016 (to kolonner og CHECK) er kuttet. Grunnen og tidspunktet står allerede i hendelsene, så kolonnene ville vært dobbel lagring. Kan legges til når arbeidskøen eller papirkurven trenger dem (A72).
2. «Sist endret» på kortet er kuttet. Ingen akseptkriterier krever det.
3. «status flow» tas ikke inn i ordlisten. Det er et arbeidsnavn. `corrected` beholdes.
4. Overgangene testes som én tabellstyrt test. «Kansellert oppdrag kan ikke få ny status» dekkes av én test for «ikke funnet».
5. e2e legges i den eksisterende filen.

## Åpne spørsmål
- Ingen som stopper. Ståle kan senere si om tilbake-steget skal være forbeholdt leder (A69) og om «På vent» skal bli status.
