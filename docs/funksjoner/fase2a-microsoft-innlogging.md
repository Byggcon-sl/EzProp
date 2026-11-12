# Funksjon: Logg inn med Microsoft 365

- **Fase:** 2a (prioritert av Ståle 12.11.2026, før neste punkt i 2a-2)
- **Modul:** kjerne (`src/core/auth`, `src/core/access`, `src/shared/config`, innloggingssiden `src/app/logg-inn`). Ingen modul berøres.
- **Status:** klar for bygging (forhåndsvurdert av forenkler, arkitekt, ux, sikkerhet-personvern og test-leder 12.11.2026)
- **Branch:** `microsoft-innlogging` (bygger på `main`)
- **Støtter hovedmål:** De ansatte: rett inn med kontoen de allerede bruker hver dag, uten å vente på kode på e-post (særlig på iPaden ute på befaring). KI i bunnen: ingen KI i innloggingen; personopplysninger fra Microsoft går aldri til KI. Reklamasjoner: bare indirekte; vi vet sikrere hvem som signerer.

## Problem
I dag må den ansatte be om en kode, åpne e-posten og skrive inn koden hver gang hun logger inn. Det tar 1–2 minutter og 6–8 trykk med bytte mellom apper, særlig tungvint på iPaden. Alle i Byggcon har Microsoft 365-konto (`@byggcon.no`). Ståle i chat 12.11.2026: «tror vi skal sette opp logg inn via microsoft 365 kontoene vi har, epost knyttet til @byggcon.no – så kommer vi rett inn uten kode. Vi kan ha kode i bakhånd, i tilfelle microsoft innloggingen feiler».

Etter: ett trykk og 5–10 sekunder når den ansatte alt er logget inn i Microsoft. Første gang kommer Microsofts egne steg i tillegg. Økten varer 30 dager, så det skjer sjelden.

## KI i bunnen
KI har ingen oppgave i innloggingen. Innlogging er en sikkerhetsgrense, og her skal ingenting gjettes eller foreslås. Ingen data fra Microsoft (navn, e-post, tenant, `oid`) sendes til KI, og ingenting lagres for KI. Det som hjelper KI senere, er at hvem som godtok, endret eller avviste et forslag (`ai_usage_log`) er sikrere identifisert. Ingen endring i `src/core/ai`.

## Brukerhistorier
- Som **takstmann** vil jeg **trykke «Logg inn med Microsoft» og komme rett inn** slik at jeg slipper å hente kode på e-post.
- Som **admin** vil jeg **alltid kunne logge inn med kode** slik at jeg ikke stenges ute hvis Microsoft-innloggingen feiler (regel 11).
- Som **leder** vil jeg **at bare personer jeg har registrert som ansatt slipper inn** slik at en Microsoft-konto alene ikke gir tilgang.

## Omfang
**Med:**

*Leverandøren (`src/core/auth/auth.ts` og ny `src/core/auth/microsoft-login.ts`)*
- Better Auth sin innebygde Microsoft-leverandør (`socialProviders.microsoft`, finnes i better-auth 1.7.21). Ingen ny avhengighet. Vår kode kaller aldri Microsoft direkte; Better Auth er adapteren.
- Oppsett av leverandøren, eksakt:
  - `tenantId: MS_LOGIN_TENANT_ID` (aldri `common`, `organizations` eller `consumers`). Ingen innstilling for `authority`.
  - `disableSignUp: true` (ikke `disableImplicitSignUp`; den lar klienten be om ny bruker med `requestSignUp`).
  - `disableDefaultScope: true`, `scope: ["openid", "profile", "email"]`, `disableProfilePhoto: true`. Ingen `offline_access`, ingen `User.Read`, ingen kall til Graph.
  - Ikke `prompt=login` eller `select_account`, så det blir ett trykk når den ansatte alt er logget inn i Microsoft. Omdirigering i samme vindu, aldri sprettoppvindu (virker i appen på hjemskjermen).
- `account.accountLinking`: `trustedProviders: ["microsoft"]`, `requireLocalEmailVerified: false`, `allowDifferentEmails` settes ikke, `updateUserInfoOnLink` og `overrideUserInfoOnSignIn` står av. Navn, e-post og bilde i `users` eies av EzProp og overskrives aldri fra Microsoft. Grunnen: Entra sender normalt ikke `email_verified`, og ansatte lagt inn av admin har `email_verified = false`; uten dette avvises alle. Det er trygt fordi brukere bare lages av admin eller seed, og fordi tenant-sjekken under er vår egen.
- **Tenant-sjekken er vår egen og er selve sperren.** I vanlig flyt dekoder Better Auth bare ID-tokenet. Vi sjekker på serveren, før noe slås opp (i `mapProfileToUser` eller `getUserInfo`):
  - `tid` er lik `MS_LOGIN_TENANT_ID`.
  - Ikke gjestekonto: avvis når `idp` finnes og er ulik egen tenant, eller når brukernavnet inneholder `#EXT#`.
  - E-post hentes fra `email`, med `preferred_username` som reserve. Verdien trimmes og gjøres om til små bokstaver. Tom adresse gir avvisning, ikke krasj.
- **Identiteten er `oid`.** `accounts.account_id` er Microsofts `oid` (ikke `sub`, som er ulik per app-registrering). Låses med test. E-post brukes bare til første kobling; etterpå gjelder `oid`. Bytter admin e-post på en ansatt, eller endres adressen i Entra, følger Microsoft-kontoen samme `users`-rad.
- **Ingen ny bruker.** Bare personer som finnes i `users` og har aktivt ansattforhold slipper inn. E-post matches uten hensyn til store og små bokstaver (`users.email` lagres alltid med små bokstaver, og Better Auth slår opp med små bokstaver). Ingen ny spørring på e-post.
- **«Registrert som ansatt» betyr aktivt ansattforhold:** en rad i `employees` med `user_id` lik brukeren, `deactivated_at` og `deleted_at` tomme, og organisasjonen ikke slettet, i minst én organisasjon. Ny funksjon `hasActiveEmployment(userId): Promise<boolean>` i `src/core/access` (regel 2) med samme vilkår som `findGrant` i `src/core/access/guards.ts`. Den kalles fra `databaseHooks.session.create.before` for Microsoft-økter, slik at den gjelder **hver** innlogging, ikke bare første kobling. Avvist gir ingen rad i `sessions`. En bruker som bare er ansatt i en annen organisasjon, kommer inn, men får bare tilgang til den organisasjonen; rettigheter kommer som før bare fra `requireOrganizationAccess`.
- **Tokens lagres ikke.** Vi bruker dem ikke etter innlogging, og ID-tokenet har navn og e-post i klartekst. `access_token`, `refresh_token`, `id_token` og utløpstidene nulles i `databaseHooks.account.create.before` og `update.before`.
- **Steng endepunkter vi ikke bruker** i `isClosedPath`: `/link-social`, `/unlink-account`, `/refresh-token`, `/get-access-token`, `/account-info`, og `/sign-in/social` med `idToken` i kroppen (bare omdirigeringsflyten er åpen). Ingen kobler fra eller til selv, så ingenting slettes i `accounts` (regel 3).
- **`neste` og feiladresse:** `neste` valideres med `safeNextPath` på serveren før og etter Microsoft-runden. `errorCallbackURL` er `/logg-inn`. Eksterne adresser (`https://evil.example`, `//evil.example`) følges aldri.
- **Logg:** Better Auth sin logger går gjennom `src/shared/lib/logger.ts`. Avviste forsøk logges med bare årsakskode (uten e-post, `oid`, token eller hemmelighet), godkjente med bruker-id.
- **Siste innlogging:** den eksisterende økt-hooken (`databaseHooks.session.create.after`) oppdaterer `lastLoginAt` også for Microsoft. Ingenting nytt bygges; én påstand i en test.

*Oppsett og hemmeligheter*
- Én funksjon i `src/core/auth/microsoft-login.ts` returnerer `{ tenantId, clientId, clientSecret } | null`. `MS_LOGIN_TENANT_ID` og `MS_LOGIN_CLIENT_ID` leses som valgfrie verdier i `env.ts`; tenant-id må være en GUID. `MS_LOGIN_CLIENT_SECRET` leses med `readSecret`, importert fra `@/core/integrations/secrets` (bladfilen, ikke indeksen, for å unngå sirkel integrations → access → auth). `readSecret` håndterer allerede uløst nøkkelboks-referanse; ingen ny logikk for det.
- **Alle eller ingen, og appen stopper aldri av Microsoft-oppsettet** (regel 11): delvis oppsett, ugyldig tenant-id eller uløst nøkkelboks-referanse slår leverandøren av og logger én advarsel med bare navnene på verdiene. Da vises bare kodeskjemaet.
- `MS_LOGIN_CLIENT_SECRET` blir **reservert hemmelighetsnavn**: en liste i `src/core/integrations/connections.ts` ved `FIXED_SECRET_REFS` avviser navnet for alle leverandører, både ved lagring og ved oppslag. Ellers kan en rad i `integration_connections` sende innloggingshemmeligheten til en annen adapter. Teksten om `secret_ref` i `docs/05-domenemodell.md` oppdateres.
- Utrullingen (`.github/workflows/deploy-azure.yml` og `infra/azure`) sender de tre verdiene til appen; hemmeligheten via nøkkelboksen som de andre (ADR 0005). Ekte tenant-id og klient-id står bare i GitHub secrets, aldri i repo eller dokumentasjon.
- `.env.example`; `start.sh`: bare de tre navnene inn i den eksisterende løkken for valgfrie verdier (som for `MS_GRAPH_*`). Ingen ny sjekk.

*Innloggingssiden (`src/app/logg-inn`)*
- Serveren sender bare en boolsk verdi («Microsoft er satt opp») til siden.
- «Logg inn med Microsoft» er hovedvalget: full bredde, minst 56 pt (`size="lg"` som i dag). Viser «Åpner Microsoft …» og er sperret etter første trykk.
- «Logg inn med kode i stedet» er en knapp på minst 44 pt (ikke en liten tekstlenke), og viser dagens kodeskjema.
- Teksten øverst endres fra «Vi sender deg en kode» til en kort tekst om å bruke Byggcon-kontoen.
- **Avvist innlogging:** samme norske tekst for alle årsaker (ukjent adresse, feil tenant, gjestekonto, deaktivert ansatt, `signup_disabled`, `account_not_linked`, `unable_to_link_account`); feilkoden vises ikke: «Du har ikke tilgang med denne kontoen. Be leder eller admin legge deg inn som ansatt, eller logg inn med kode.» Kodeskjemaet vises åpent rett under meldingen. Ingen kontaktinformasjon i koden.
- **Uten nett:** begge knappene sperres, og siden viser: «Du er uten nett. Innlogging trenger nett. Det du har lagret på iPaden, er trygt og synkes når du er inne igjen.»
- **Uten oppsett:** bare kodeskjemaet, som i dag.

*Dokumenter*
- **ADR 0008:** Microsoft-innlogging ved siden av engangskode. Skal si: én tenant, ingen ny bruker, kobling på e-post første gang og deretter på `oid`, hvorfor `trustedProviders` og `requireLocalEmailVerified: false` er trygt (brukere lages bare av admin og seed, og vår egen `tid`-sjekk), at tokens ikke lagres, kode som reserve, egen app-registrering adskilt fra `MS_GRAPH_*`, forholdet til felles innlogging med Optiplan (S6). Innlogging er ikke en port i `integration_connections`, fordi organisasjonen ikke er kjent før innlogging. Én tenant gjelder hele installasjonen; før selskap nummer to med egen katalog må tenant knyttes til organisasjon (Byggcons Entra-admin kan i dag i praksis logge inn som enhver bruker i EzProp ved å sette e-postadressen). Forkastet: `common` med filter på domene, automatisk oppretting av brukere, samme app-registrering som e-post, roller fra Entra-grupper.
- **Oppskrift for Ståle** i `docs/drift/testmiljo-azure.md`: app-registrering i Entra ID for én tenant, tilbakeadresse `https://app-ezprop-test.azurewebsites.net/api/auth/callback/microsoft`, rettighetene `openid`, `profile`, `email` (ingen ekstra API-rettigheter), lage klienthemmelighet og skrive ned utløpsdatoen (maks 24 måneder; ved utløp virker bare koden), legge de tre verdiene inn som secrets i GitHub. Føres under «Trenger Ståle når han er tilbake» i tilstandsfilen.
- **Domenemodellen:** `accounts.account_id` er Microsofts `oid` (personopplysning), tokens lagres ikke, reservert hemmelighetsnavn.
- **Ordlisten** (avsnitt 8): «Microsoft-innlogging» (`microsoft`, tenant = Microsoft-katalog) og `hasActiveEmployment` / reservert hemmelighetsnavn. Korte linjer.
- Versjon i `package.json` økes (minor: 0.6.9 → 0.7.0).

**Ikke med (bevisst utelatt):**
- Felles innlogging med Optiplan og bytte med ett trykk (venter på S6).
- Automatisk oppretting av ansatte fra Microsoft-katalogen, synk av navn, telefon, stilling, bilde eller grupper/roller fra Entra ID.
- Å skru av engangskoden, eller å kreve Microsoft for noen roller. Engangskoden får ingen ny sjekk i denne oppgaven.
- Innlogging for kunder, meglere eller andre utenfor Byggcon; andre leverandører (Google, Apple), passord, passkey.
- Utlogging fra Microsoft (single sign-out); vi logger bare ut av EzProp.
- Ekte innlogging mot Microsoft i test eller CI, og en falsk Microsoft-side i e2e. Ingen app-registrering eller noe som koster penger opprettes av agentene.
- Ny migrering. Ingen indeks på `lower(email)` og ingen unik indeks på `accounts (provider_id, account_id)` (se Beslutninger).
- Ny skjerm for admin for å se hvem som har koblet Microsoft-konto (kan foreslås i `docs/09-apne-sporsmal.md`).

## Tilgang
Innloggingen gir ingen rettigheter i seg selv. Rettigheter kommer som før bare fra `requireOrganizationAccess` i `src/core/access`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Kan logge inn med Microsoft eller kode | – |
| kontor | Kan logge inn med Microsoft eller kode | – |
| leder | Kan logge inn med Microsoft eller kode | – |
| admin | Kan logge inn med Microsoft eller kode; koden virker alltid | – |
| ukjent / uten aktivt ansattforhold / annen tenant / gjest | Avvises, ingen bruker, konto eller økt lages | – |

## Data
- Ingen ny tabell og ingen migrering. Microsoft-kontoen lagres i eksisterende `accounts` med `provider_id = 'microsoft'`, `account_id = oid` og tokenkolonnene tomme.
- `accounts` og `users` har ikke `organization_id` (samme unntak som før); `tests/tenant-tables.ts` berøres ikke.
- Ingen ny spørring som tar `organizationId`. `hasActiveEmployment` tar ikke `organizationId`, så den får i stedet en test som viser at ansettelse i en annen organisasjon ikke gir tilgang til Byggcons data. Kommer det likevel en ny spørring med `organizationId`, gjelder regel 2 og `expectTenantIsolation` som vanlig.

## Skjermer
- **Innloggingssiden (PC og iPad):** se «Innloggingssiden» under Omfang.
- Flyt: Innloggingssiden → [Logg inn med Microsoft] → Microsoft (stille hvis du alt er logget inn der) → tilbake til `neste`. Alternativ: «Logg inn med kode i stedet» → e-post → kode → inn. Avvist → samme side med feilmelding og kodeskjemaet åpent.

## Regler
Ingen fagregler. Sikkerhetsreglene over (én tenant, bare aktive ansatte, ingen ny bruker, kode som reserve) testes som tilgangstester.

## Akseptkriterier
Testdata er oppdiktet: domenet `byggcon.example` og en oppdiktet tenant-id (regel 8). Microsoft mockes med falsk `fetch` på serveren og falsk JWKS; ingen nettverk og ingen miljøvalg som peker innloggingen mot en annen utsteder.

*Oppsett (enhetstester)*
- [ ] `env.ts`/`microsoft-login.ts`: 0, 1, 2 og 3 verdier satt. Bare 3 gyldige slår leverandøren på; ellers av, én advarsel med bare navnene, og appen starter. Tenant-id som ikke er GUID (også `common`, `organizations`, `consumers`) slår den av.
- [ ] Uløst nøkkelboks-referanse slår leverandøren av (via `readSecret`; én linje i den statiske testen som finnes for `MS_GRAPH_CLIENT_SECRET`). `MS_LOGIN_CLIENT_SECRET` leses bare via `readSecret`.
- [ ] Leverandøren settes opp med `tenantId` lik `MS_LOGIN_TENANT_ID`, `disableSignUp: true`, bare `openid profile email`, `disableProfilePhoto: true`, og `oid` som konto-id.
- [ ] `MS_LOGIN_CLIENT_SECRET` avvises som `secret_ref` i `integration_connections` for alle leverandører, ved lagring og ved oppslag.
- [ ] Statisk test: ingen `fetch` mot login.microsoftonline.com eller graph.microsoft.com i `src/core/auth`.

*Innlogging (integrasjonstester mot testdatabasen)*
- [ ] Ansatt med riktig `tid` kommer inn: økt lages, rad i `accounts` (`microsoft`, `account_id = oid`), sendes til `neste`, `lastLoginAt` oppdateres. `users.name` og `users.image` er uendret.
- [ ] E-post `Ola.Testesen@Byggcon.Example` med mellomrom foran og bak, og e-post bare i `preferred_username`: samme bruker, ingen ny rad i `users`. Tom e-post avvises uten krasj.
- [ ] Ukjent adresse avvises: ingen rad i `users`, `accounts` eller `sessions`, og samme melding som for feil tenant.
- [ ] Feil `tid` med e-post som matcher en ansatt avvises og kobles ikke. Det samme for en konto som allerede er koblet. Gjestekonto (`#EXT#` eller fremmed `idp`) avvises.
- [ ] Deaktivert og myk-slettet ansatt avvises, både før og etter at kontoen er koblet; ingen økt lages.
- [ ] Ugyldig signatur, feil `aud` og utløpt ID-token avvises.
- [ ] `access_token`, `refresh_token` og `id_token` er tomme etter første og andre innlogging.
- [ ] Stengte endepunkter (`/link-social`, `/unlink-account`, `/refresh-token`, `/get-access-token`, `/account-info`, `/sign-in/social` med `idToken`) gir 404 eller avvisning.
- [ ] Ekstern `neste`, `callbackURL` og `errorCallbackURL` (`https://evil.example`, `//evil.example`) følges ikke.
- [ ] Takstmann, kontor, leder og admin får samme grant fra `requireOrganizationAccess` etter Microsoft som etter kode.
- [ ] Bruker som bare er ansatt i en annen organisasjon, får ingen tilgang til Byggcons data etter Microsoft-innlogging.
- [ ] Engangskoden virker uendret for admin når Microsoft er satt opp, og sperren for kode virker som før (regel 11).
- [ ] Logglinjene inneholder ikke e-post, `oid`, token eller klienthemmelighet.
- [ ] Ingen rader slettes permanent ved avvist eller godkjent innlogging.

*Innloggingssiden (e2e, PC og iPad Pro)*
- [ ] Med oppsett: «Logg inn med Microsoft» er hovedvalget; «Logg inn med kode i stedet» viser kodeskjemaet, og kodeinnlogging virker for admin.
- [ ] Uten oppsett: bare kodeskjemaet, ingen Microsoft-knapp.
- [ ] Trykk på knappen sender nettleseren til `login.microsoftonline.com/<oppdiktet tenant-id>/…` med riktig `client_id`, `redirect_uri` og `state`, aldri `common` eller `organizations`. Avskåret med `page.route`, ingen nettverk. Knappen er sperret etter første trykk.
- [ ] Avvist innlogging (`/logg-inn?error=…`): lik norsk melding, koden vises ikke, kodeskjemaet er åpent.
- [ ] Uten nett: begge knappene er sperret, og teksten om at innlogging trenger nett vises.
- [ ] Ingenting går tapt: en endring som ikke er synket, ligger fortsatt i synkkøen og synkes etter at økten er borte og den ansatte har logget inn på nytt (innlogging med kode i e2e, siden Microsoft-runden ikke kan kjøres der; det er samme sideskift og samme lokale lagring).

*Drift og dokumenter*
- [ ] `tests/start-script.test.ts` og `tests/deploy-workflow.test.ts` dekker de tre verdiene, og hemmeligheten går via nøkkelboksen.
- [ ] Oppskriften for Ståle står i `docs/drift/testmiljo-azure.md`, og punktet står under «Trenger Ståle når han er tilbake».
- [ ] ADR 0008 skrevet. `start.sh`, `.env.example`, domenemodell og ordliste oppdatert. Versjon 0.7.0.
- [ ] KI-forslag: ikke aktuelt (ingen KI i innloggingen).

## Beslutninger i autonom modus (A214–A222 i `docs/09-apne-sporsmal.md`)
- A214 Egen app-registrering for innlogging, adskilt fra den for e-post (`MS_GRAPH_*`). **Lett å endre.**
- A215 Lik feilmelding for alle avvisninger (røper ikke hvem som er ansatt), med kodeskjemaet åpent under. **Lett å endre.**
- A216 Kobling på e-post første gang, deretter på `oid`; `trustedProviders: ["microsoft"]` og `requireLocalEmailVerified: false`, sikret med egen `tid`-sjekk. **Dyrt å endre** (hvordan identitet knyttes).
- A217 Aktivt ansattforhold sjekkes ved hver Microsoft-innlogging (`hasActiveEmployment`). Engangskoden får ikke sjekken nå. **Lett å endre.**
- A218 Tokens fra Microsoft lagres ikke, og vi ber bare om `openid profile email`. **Lett å endre.**
- A219 Feil i Microsoft-oppsettet slår leverandøren av med advarsel; appen stopper aldri. **Lett å endre.**
- A220 Ingen migrering: ingen unik indeks på `accounts (provider_id, account_id)`. E-post er unik i `users`, så samme Microsoft-konto kan bare kobles til én bruker; to samtidige første innlogginger gir i verste fall to like rader for samme bruker. **Lett å endre** (liten migrering senere).
- A221 Gjestekontoer i Byggcons katalog avvises. **Lett å endre.**
- A222 Ingen falsk Microsoft-side i e2e; hele flyten prøves i integrasjonstester. **Lett å endre.**

## Avgjort ved uenighet (prosjektlederen)
- **Migrering 0030 (arkitekt: bør) mot ingen migrering (forenkler):** ingen migrering. Risikoen er liten og gjelder bare samme bruker, og planpunktet krever det ikke (A220).
- **Delvis oppsett:** arkitektens valg. «Alle eller ingen» er regelen, men følgen er at leverandøren slås av med advarsel, ikke at appen stopper. Admin skal aldri stenges ute (regel 11).
- **E2e:** forenkler og test-leder er enige: `page.route` på Microsoft-adressen, ingen falsk OIDC-side. Ux sitt krav om at ingenting går tapt, prøves med ny innlogging med kode, fordi Microsoft-runden ikke kan kjøres i e2e.
- **E-post trimmes:** beholdes (arkitekt, test-leder). Det er én linje i den samme funksjonen som henter e-posten, og den trengs fordi `preferred_username` brukes som reserve.
- **Feilmelding:** ux sin tekst, uten kontaktinformasjon (forenkler).
- **Sjekk for engangskoden:** sikkerhet-personvern lot dette stå åpent. Den tas ikke med nå: kodeflyten er reserven og skal være uendret (A217).

## Åpne spørsmål (til Ståle, stopper ikke oppgaven)
- Nr. 74: Tofaktor kommer bare fra Microsoft hvis Byggcons katalog krever det, og engangskoden går uansett utenom. Skal koden før ekte data være reserve for alle, eller bare for admin? Hører til «Minimum før ekte data».
- Nr. 75: Bekreft at innlogging via Microsoft dekkes av Byggcons databehandleravtale for Microsoft 365.

## Roller
arkitekt (ADR 0008, oppsett av leverandør og hemmeligheter), ux (innloggingssiden og feilmeldinger), sikkerhet-personvern (tenant, kobling, tokens, endepunkter), utvikler og testskriver i parallell (kode og drift / tester mot falsk Microsoft), test-leder.
