# ADR 0014 – Rydding av innloggingsdata: hard sletting av tre tekniske tabeller, kjørt av en planlagt arbeidsflyt

Dato: 17.11.2026. Status: vedtatt av agentene i autonom modus (A419–A422 i `docs/09-apne-sporsmal.md`); Ståle kan endre, og unntaket fra myk sletting skal bekreftes av Ståle før ekte data. Oppgavekort: `docs/agenter/oppgaver/rydd-innloggingsdata.md`. Kilde: svar 10.11.2026, nr. 15 og 18 (`docs/kartlegging/svar-claude-pa-vegne-av-stale-2026-11-10.md`).

Støtter hovedmålene: **de ansatte** (innloggingen holder seg rask og trygg, og det ligger ikke gamle koder og økter igjen som kan misbrukes; vi lagrer bare det vi trenger). **Færre reklamasjoner:** ikke direkte. **KI i bunnen:** ikke berørt. Dette er drift av tekniske innloggingsdata, som ikke er fagdata og aldri går til KI.

## Beslutninger

1. **Unntak fra myk sletting for tre tabeller, og bare dem:** `login_attempts`, `verifications` og `sessions` slettes for godt når de er utløpt. De er tekniske innloggingsdata uten `organization_id`, ikke fagdata. `users`, `accounts` og alt med `organization_id` slettes aldri hardt. Regel 3 i `CLAUDE.md` skrives ikke om; unntaket står her og i `docs/05-domenemodell.md` (A419).
2. **Oppbevaringstider** (konstanter i `src/core/auth/auth-cleanup.ts`, A421):

   | Tabell | Slettes når | Konstant |
   |---|---|---|
   | `login_attempts` | `created_at` er eldre enn 24 timer | `LOGIN_ATTEMPT_RETENTION_MS` |
   | `verifications` | `expires_at` er eldre enn 24 timer | `EXPIRED_VERIFICATION_RETENTION_MS` |
   | `sessions` | `expires_at` er eldre enn 30 dager | `EXPIRED_SESSION_RETENTION_MS` |

   Grensen er streng: en rad nøyaktig på grensen står. Appens klokke brukes, den samme som setter `created_at` og `expires_at`.
3. **Ryddingen er én funksjon i kjernen:** `purgeExpiredAuthData(now?)` i `src/core/auth/auth-cleanup.ts`. Én transaksjon, bare faste vilkår på tid, aldri vilkår på bruker, e-post-hash eller organisasjon. Idempotent. Filen importerer ikke `./auth`, så Better Auth startes ikke for å rydde.
4. **Kjøremåte: en planlagt GitHub Actions-arbeidsflyt kaller et internt endepunkt** (`POST /api/intern/rydd-innloggingsdata`) én gang i døgnet, og kan startes manuelt (`workflow_dispatch`). Kjernen vet ikke hvem som kaller, så kalleren kan byttes uten kodeendring (A420).
5. **Endepunktet beskyttes av en driftshemmelighet**, sjekket i `src/core/access` (`verifyOperationsSecret` i `operations-secret.ts`, regel 2). Egen hemmelighet `AUTH_CLEANUP_SECRET`, aldri `BETTER_AUTH_SECRET`. Sammenligningen hasher begge sider og bruker `timingSafeEqual`. Endepunktet tar ingen inndata; grenser og tid kan ikke styres utenfra.
6. **Alt som ikke er godkjent, får 404** (hemmeligheten ikke satt, mangler i kallet eller er feil). Endepunktet røpes ikke (A422).
7. **Feil oppsett slår av endepunktet, aldri appen.** `AUTH_CLEANUP_SECRET` er valgfri i `src/shared/config/env.ts` (samme mønster som `MS_LOGIN_*`, ADR 0008). For kort hemmelighet (under 32 tegn) eller uløst nøkkelboks-referanse (ADR 0005) gir usann i `verifyOperationsSecret` og en advarsel i loggen med bare navnet. Påkrevde verdier valideres fortsatt strengt ved oppstart.
8. **Driftshemmeligheten kan ikke brukes av en tilkobling:** `AUTH_CLEANUP_SECRET` står i `DENIED_SECRET_REFS` i `src/core/integrations/secrets.ts`, så den aldri kan sendes til en leverandør.
9. **Ingen indeks og ingen migrering** (A422). Ikke noe generelt jobbrammeverk.
10. **Loggen har bare antall per tabell, tidsbruk og utfall.** Ved feil: referansekode, uten parametre fra databasefeilen. Aldri e-post, hash, token, IP, nettleser eller bruker-id.

## Grensesnitt

```ts
// src/core/auth/auth-cleanup.ts
export const LOGIN_ATTEMPT_RETENTION_MS: number;        // 24 timer
export const EXPIRED_VERIFICATION_RETENTION_MS: number; // 24 timer
export const EXPIRED_SESSION_RETENTION_MS: number;      // 30 dager
export type AuthCleanupResult = {
  loginAttempts: number;
  verifications: number;
  sessions: number;
  durationMs: number;
};
export function purgeExpiredAuthData(now?: Date): Promise<AuthCleanupResult>;

// src/core/access/operations-secret.ts (eksportert fra src/core/access/index.ts)
export const OPERATIONS_SECRET_MIN_LENGTH = 32;
export function verifyOperationsSecret(authorizationHeader: string | null): boolean;
```

Ruten i `src/app` kaller bare disse to funksjonene og har ingen databasekode.

## Hjemmel

Svarene 10.11.2026 nr. 15 og 18 sier at tellerne slettes etter 24 timer, at økter og koder kan slettes helt, og at utløpte koder ryddes etter 24 timer og utløpte økter etter 30 dager. Svarene er skrevet av prosjektlederen på oppdrag fra Ståle og har status «til gjennomgang». De er ikke Ståles egne ord. De ble ført inn i planen 10.11.2026.

Derfor er unntaket ført som agentbeslutning (A419) med «hvordan det kan endres», og det står under «Trenger Ståle når han er tilbake» at Ståle bekrefter unntaket før ekte data. Beslutningen er **dyr å endre** i én forstand: slettede rader kommer ikke tilbake.

## Hvorfor oppbevaringstidene er trygge

- **Tellere (24 timer):** sperren bruker et vindu på 15 minutter og leser høyst 2 timer tilbake (`login-throttle.ts`). Rader eldre enn 24 timer påvirker aldri en sperre. At også `login_succeeded`-rader slettes, er ufarlig av samme grunn.
- **Koder (24 timer etter utløp):** en utløpt kode eller innloggingsrunde kan ikke brukes. Gyldige rader, også state-raden for en pågående Microsoft-runde, har `expires_at` i framtiden og står.
- **Økter (30 dager etter utløp):** en økt varer 30 dager og fornyes ved bruk (`expires_at` flyttes fram, høyst én gang i døgnet). En økt slettes derfor tidligst rundt 60 dager etter siste bruk. En utløpt økt gir ikke tilgang, så slettingen endrer ikke hvem som er innlogget.

## Hvorfor ingen indeks

`verifications.expires_at`, `sessions.expires_at` og `login_attempts.created_at` alene har ingen indeks, så slettingen leser hele tabellene. Etter første kjøring har tabellene bare rundt 24 timer med tellere og koder og rundt 60 dager med økter, og jobben går én gang i døgnet. En migrering uten målt nytte er unødvendig risiko. Vurderes på nytt hvis tidsbruken i loggen (`durationMs`) viser at ryddingen er treg.

## Drift

- **Planlagte kjøringer i GitHub kan bli forsinket eller falle ut.** Det er ufarlig: jobben er idempotent, og neste kjøring tar det som ble stående.
- **Arbeidsflyten** er `.github/workflows/rydd-innloggingsdata.yml` («Rydding av innloggingsdata»), hver natt kl. 02:17 UTC og manuelt med «Run workflow».
- **GitHub kan slå av planlagte kjøringer** etter lang tid uten aktivitet i repoet: ifølge GitHubs dokumentasjon i offentlige repoer når det ikke har vært aktivitet på 60 dager. Det vises som et varsel på arbeidsflyten under Actions, og siste kjøring er gammel. Den slås på igjen med «Enable workflow» samme sted.
- **Slik ser man at den gikk:** kjøringen i Actions er grønn, og appens logg har infolinjen med antall per tabell.
- **Kostnad:** noen sekunder av de inkluderte Actions-minuttene per døgn. Ingenting i Azure.
- **Hemmeligheten** legges inn av Ståle som GitHub-secret, og utrullingen fører den til nøkkelboksen og appen (samme vei som `ANTHROPIC_API_KEY`). Uten hemmelighet er endepunktet av, og arbeidsflyten hopper over uten feil.
- **Produksjon** trenger egen adresse og egen hemmelighet. Det setter Ståle opp ved utrulling; agentene legger ikke inn produksjon.
- Oppskriften står i `docs/drift/testmiljo-azure.md`.

## Forbehold: felles innlogging med Optiplan (S6)

I dag har EzProp egen database (ADR 0002), og ryddingen rører bare EzProps egne rader. ADR 0008 skriver likevel at innloggingstabellene «deles med Optiplan i dag». Det stemmer ikke med ADR 0002 slik databasen er satt opp nå, og avklares med S6. Blir `sessions` og `verifications` virkelig delt når S6 avgjøres, må ryddingen vurderes på nytt **før** den kjøres mot delte tabeller: da sletter den også Optiplans økter og koder, og oppbevaringstidene må gjelde for begge systemene.

## Forkastet

- **Tidsur inne i appen** (`setInterval` eller lignende ved oppstart): kjører også under bygg og tester, kjører én gang per instans, og er skjult for drift (ingen kjørelogg, kan ikke startes manuelt).
- **Arbeidsflyt rett mot databasen:** krever daglig åpning av databasens brannmur for GitHub og databasepassordet som GitHub-secret. Større angrepsflate enn ett endepunkt som bare kan gjøre én fast ting.
- **Azure Functions, Logic Apps, Container Apps-jobber eller WebJobs:** koster penger eller krever at noe slås på i Azure. Ikke lov i autonom modus, og ikke nødvendig.
- **Rydding ved innlogging:** gjør innloggingen tregere, og kjører ikke når ingen logger inn. Ikke planlagt drift.
- **Myk sletting (`deleted_at`) på innloggingstabellene:** løser ikke problemet. IP-adresse, nettleser og e-post i `verifications.identifier` blir liggende, og tabellene vokser fortsatt.
- **Indeks på tidskolonnene nå:** se over.
- **401 ved feil hemmelighet:** røper at endepunktet finnes. Én fast oppførsel (404) er også enklere å teste.
- **Streng validering av `AUTH_CLEANUP_SECRET` i `env.ts`:** en skrivefeil i en valgfri driftshemmelighet ville stoppet hele appen, også admins innlogging (regel 11).
- **Egen kommando (`pnpm auth:cleanup`):** endepunktet når databasen fra innsiden av Azure, og manuell kjøring dekkes av `workflow_dispatch`. Én vei å teste og dokumentere. Kan legges til senere som tynn innpakning rundt `purgeExpiredAuthData`.
- **Generelt jobbrammeverk:** det finnes én jobb. Rammeverket lages når det finnes flere.

## Følger

- Ingen skjemaendring, ingen migrering, ingen ny avhengighet. Én ny valgfri miljøvariabel.
- `src/core/auth/auth-cleanup.ts` er det eneste stedet i systemet som sletter rader for godt. Nye tabeller legges ikke til der uten ny beslutning.
- Tabellene har ingen `organization_id` og føres ikke i `tests/tenant-tables.ts`. Testen med to organisasjoner viser at `users`, `accounts` og `employees` er urørt.
- Etter rydding finnes ingen innloggingshistorikk ut over `users.last_login_at` og driftsloggen. Om det trengs historikk for å undersøke sikkerhetshendelser, er et åpent spørsmål til Ståle (personvern).
- **Lett å endre:** kjøremåten, statuskoden, indeksen og hva grensene måles fra (A420–A422). **Dyrt å endre:** selve slettingen (A419). Den slås av ved å fjerne hemmeligheten eller slå av arbeidsflyten.
