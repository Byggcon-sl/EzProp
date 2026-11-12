# Funksjon: Logg inn med Microsoft 365

- **Fase:** 2a (prioritert av Ståle 12.11.2026, før neste punkt i 2a-2)
- **Modul:** kjerne (`src/core/auth`, innloggingssiden `src/app/logg-inn`)
- **Status:** utkast
- **Branch:** `microsoft-innlogging` (bygger på `main`)
- **Støtter hovedmål:** De ansatte: rett inn med kontoen de allerede bruker hver dag, uten å vente på kode på e-post (særlig på iPaden ute på befaring). KI i bunnen: ingen KI i innloggingen; personopplysninger fra Microsoft går aldri til KI. Reklamasjoner: ikke direkte; tofaktor fra Microsoft-kontoen gjør det tryggere at rett person signerer.

## Problem
I dag må den ansatte be om en kode, åpne e-posten og skrive inn koden hver gang hun logger inn. Det tar tid og stopper arbeidet, særlig på iPaden. Alle i Byggcon har Microsoft 365-konto (`@byggcon.no`). Ståle i chat 12.11.2026: «tror vi skal sette opp logg inn via microsoft 365 kontoene vi har, epost knyttet til @byggcon.no – så kommer vi rett inn uten kode. Vi kan ha kode i bakhånd, i tilfelle microsoft innloggingen feiler».

Lar vi være, fortsetter kodeflyten som i dag, uten tofaktor.

## KI i bunnen
KI har ingen oppgave i innloggingen. Innlogging er en sikkerhetsgrense, og her skal ingenting gjettes eller foreslås. Ingen data fra Microsoft (navn, e-post, tenant) sendes til KI, og ingenting lagres for KI. Det som hjelper KI senere, er at hvem som gjorde hva (forslag godtatt, endret, avvist i `ai_usage_log`) knyttes til en sikkert identifisert ansatt, og det blir bedre med Microsoft-innlogging. Ingen endring i `src/core/ai`.

## Brukerhistorier
- Som **takstmann** vil jeg **trykke «Logg inn med Microsoft» og komme rett inn** slik at jeg slipper å hente kode på e-post.
- Som **admin** vil jeg **alltid kunne logge inn med kode** slik at jeg ikke stenges ute hvis Microsoft-innloggingen feiler (regel 11).
- Som **leder** vil jeg **at bare personer jeg har registrert som ansatt slipper inn** slik at en Microsoft-konto alene ikke gir tilgang.

## Omfang
**Med:**
- Better Auth sin innebygde Microsoft-leverandør (`socialProviders.microsoft`) i `src/core/auth/auth.ts`. Ingen ny avhengighet.
- **Én tenant:** leverandøren settes opp med Byggcons tenant-id (ikke `common`/`organizations`). I tillegg sjekkes `tid` i ID-tokenet mot `MS_LOGIN_TENANT_ID` på serveren; feil tenant avvises.
- **Ingen ny bruker:** innloggingen lager aldri bruker (`disableSignUp` / `disableImplicitSignUp`). Bare personer som allerede er registrert som ansatt i EzProp (finnes i `users` og har aktivt ansattforhold, ikke myk-slettet eller deaktivert) slipper inn. E-post matches uten hensyn til store og små bokstaver, og med mellomrom fjernet.
- **Kobling til eksisterende bruker:** første gang en ansatt logger inn med Microsoft, kobles Microsoft-kontoen til den eksisterende brukeren (rad i `accounts` med `provider_id = 'microsoft'`). Kobling skjer bare når tenant er riktig og e-posten matcher en registrert ansatt.
- **Innloggingssiden:** knappen «Logg inn med Microsoft» er hovedvalget. Under den: «Logg inn med kode i stedet», som viser dagens kodeskjema. Feilmelding på norsk ved avvist innlogging, lik for ukjent adresse og feil tenant (røper ikke om adressen finnes): «Du har ikke tilgang med denne kontoen. Kontakt Byggcon på …», og koden tilbys som reserve. `neste`-adressen (trygg sti, `safeNextPath`) tas med gjennom Microsoft-runden.
- **Uten oppsett:** mangler en av `MS_LOGIN_TENANT_ID`, `MS_LOGIN_CLIENT_ID` eller `MS_LOGIN_CLIENT_SECRET`, er leverandøren av og siden viser bare kodeskjemaet, som i dag. De tre settes sammen: alle eller ingen (sjekk i `env.ts`, som for `MS_GRAPH_*`).
- **Hemmeligheter:** `MS_LOGIN_CLIENT_SECRET` leses gjennom `readSecret` (`src/core/integrations/secrets`), aldri direkte fra miljøet; tenant og klient-id leses som valgfrie verdier i `env.ts`. Utrullingen (`.github/workflows/deploy-azure.yml` og `infra/azure`) sender dem til appen; hemmeligheten legges i nøkkelboksen som de andre (ADR 0005).
- **Siste innlogging og sperre:** `lastLoginAt` oppdateres som før (gjelder alle økter). Innloggingssperren for kode endres ikke.
- **ADR 0008:** Microsoft-innlogging ved siden av engangskode: én tenant, ingen ny bruker, kobling på e-post, kode som reserve, forholdet til felles innlogging med Optiplan (S6) og til `MS_GRAPH_*` (egen app-registrering for innlogging, ikke samme som e-post, så rettighetene holdes adskilt).
- **Oppskrift for Ståle** i `docs/drift/testmiljo-azure.md`: app-registrering i Entra ID (én tenant), tilbakeadresse `https://app-ezprop-test.azurewebsites.net/api/auth/callback/microsoft`, rettighetene `openid`, `email`, `profile`, `User.Read`, lage klienthemmelighet, legge de tre verdiene inn som secrets i GitHub. Føres under «Trenger Ståle når han er tilbake» i tilstandsfilen.
- `.env.example`, `start.sh` (bash 3.2) og oppsettssjekken der oppdateres med de tre valgfrie verdiene.
- Versjon i `package.json` økes (minor: 0.6.9 → 0.7.0).

**Ikke med (bevisst utelatt):**
- Felles innlogging med Optiplan og bytte med ett trykk (venter på S6).
- Automatisk oppretting av ansatte fra Microsoft-katalogen, synk av navn, telefon, stilling eller grupper/roller fra Entra ID.
- Å skru av engangskoden, eller å kreve Microsoft for noen roller.
- Innlogging for kunder, meglere eller andre utenfor Byggcon; andre leverandører (Google, Apple), passord, passkey.
- Utlogging fra Microsoft (single sign-out); vi logger bare ut av EzProp.
- Ekte innlogging mot Microsoft i test eller CI. Ingen app-registrering eller noe som koster penger opprettes av agentene.
- Ny skjerm for admin for å se hvem som har koblet Microsoft-konto (kan foreslås i `docs/09-apne-sporsmal.md`).

## Tilgang
Innloggingen gir ingen rettigheter i seg selv. Rettigheter kommer som før fra `requireOrganizationAccess` i `src/core/access`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Kan logge inn med Microsoft eller kode | – |
| kontor | Kan logge inn med Microsoft eller kode | – |
| leder | Kan logge inn med Microsoft eller kode | – |
| admin | Kan logge inn med Microsoft eller kode; koden virker alltid | – |
| ukjent / ikke ansatt / annen tenant | Avvises, ingen bruker lages | – |

## Data
- Ingen ny tabell og ingen migrering forventes. Microsoft-kontoen lagres i eksisterende `accounts` (Better Auth) med `provider_id = 'microsoft'` og Microsofts bruker-id (`oid`/`sub`) som `account_id`. Tokens lagres ikke lenger enn Better Auth krever; vi ber ikke om `offline_access`.
- Hvis utvikleren likevel må endre skjema (for eksempel unik indeks på `lower(email)`), lages migrering og domenemodellen oppdateres.
- Ordlisten (`docs/05-domenemodell.md` avsnitt 8): «Microsoft-innlogging» (`microsoft` provider), «tenant» (Microsoft-katalog).

## Skjermer
- **Innloggingssiden (PC og iPad):** hovedhandling «Logg inn med Microsoft» (stor knapp, øverst). Lenke/knapp «Logg inn med kode i stedet» under. Teksten over endres fra «Vi sender deg en kode» til en kort tekst om å bruke Byggcon-kontoen.
- Trykk før: skriv e-post, trykk «Send kode», åpne e-post, skriv kode, trykk «Logg inn» (5 steg, bytte av app). Etter: ett trykk (og eventuelt Microsoft sin egen bekreftelse første gang).

## Regler
Ingen fagregler. Sikkerhetsreglene over (én tenant, bare registrerte ansatte, ingen ny bruker, kode som reserve) testes som tilgangstester.

## Akseptkriterier
- [ ] Med de tre verdiene satt vises «Logg inn med Microsoft» som hovedvalg, og «Logg inn med kode i stedet» viser kodeskjemaet. Uten verdiene (eller med bare én eller to) vises bare kodeskjemaet, og appen starter (test av `env.ts`: alle eller ingen).
- [ ] Registrert ansatt med riktig tenant kommer inn og blir sendt til `neste` (test mot mocket Microsoft: falske token-/brukerinfo-svar, ingen nettverk).
- [ ] E-post med andre store/små bokstaver enn i EzProp (`Ola.Nordmann@Byggcon.no`) matcher og logger inn samme bruker; ingen ny rad i `users`.
- [ ] Ukjent adresse avvises, ingen rad i `users` eller `accounts` lages, og feilmeldingen er lik den for feil tenant.
- [ ] ID-token med annen `tid` enn `MS_LOGIN_TENANT_ID` avvises, også om e-posten matcher en ansatt.
- [ ] Myk-slettet eller deaktivert ansatt avvises.
- [ ] Bruker i annen organisasjon i EzProp får ikke tilgang til Byggcons data etter Microsoft-innlogging (`expectTenantIsolation` på eventuell ny spørring; innloggingen gir bare økt, tilgang via `src/core/access`).
- [ ] Engangskoden virker uendret for admin når Microsoft er satt opp (regel 11).
- [ ] `MS_LOGIN_CLIENT_SECRET` leses bare gjennom `readSecret` (statisk test som for `MS_GRAPH_CLIENT_SECRET`), og står aldri i logger eller feilmeldinger. En uløst nøkkelboks-referanse slår leverandøren av i stedet for å bruke referansen som hemmelighet.
- [ ] Utrullingen sender de tre verdiene til appen, med hemmeligheten via nøkkelboksen. Oppskriften for Ståle står i `docs/drift/testmiljo-azure.md`, og punktet står under «Trenger Ståle når han er tilbake».
- [ ] ADR 0008 skrevet. `start.sh` og `.env.example` oppdatert. Versjon økt.
- [ ] Virker på iPad-størrelse (e2e: innloggingssiden med og uten Microsoft-oppsett; klikk på knappen går til en mocket Microsoft-side, ikke til ekte Microsoft).
- [ ] KI-forslag: ikke aktuelt (ingen KI i innloggingen).

## Beslutninger i autonom modus (føres som A214 og videre i `docs/09-apne-sporsmal.md`)
- Egen app-registrering for innlogging, adskilt fra den for e-post (`MS_GRAPH_*`). **Lett å endre.**
- Lik feilmelding for ukjent adresse og feil tenant (røper ikke hvem som er ansatt). **Lett å endre.**
- Kobling av Microsoft-konto til eksisterende bruker på e-post ved første innlogging, bare innenfor Byggcons tenant. **Dyrt å endre** (hvordan identitet knyttes).

## Åpne spørsmål
- Ingen som stopper oppgaven. Om Microsoft senere skal være eneste vei for noen roller, eller om roller skal hentes fra Entra ID-grupper, er ny funksjon og avgjøres av Ståle.

## Roller
arkitekt (ADR 0008, oppsett av leverandør og hemmeligheter), ux (innloggingssiden og feilmeldinger), sikkerhet-personvern (tenant, kobling, ingen ny bruker, hemmeligheter), utvikler og testskriver i parallell (kode og drift / tester mot mocket Microsoft), test-leder.
