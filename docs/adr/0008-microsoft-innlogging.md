# ADR 0008 – Logg inn med Microsoft 365 ved siden av engangskoden

Dato: 12.11.2026. Status: vedtatt av agentene i autonom modus (A214–A223); Ståle kan endre. Oppgavekort: `docs/funksjoner/fase2a-microsoft-innlogging.md`. Bygger på ADR 0001 (Better Auth) og ADR 0005 (nøkkelboksen).

Støtter hovedmålene: **de ansatte** (ett trykk med kontoen de bruker hver dag, ingen kode å hente på e-post, særlig på iPaden), **KI i bunnen** (ingen KI i innloggingen; ingenting fra Microsoft går til KI, men hvem som godtok et forslag er sikrere identifisert) og **færre reklamasjoner** (indirekte: vi vet sikrere hvem som signerer).

## Beslutninger

1. **Better Auth sin innebygde Microsoft-leverandør** (`socialProviders.microsoft`). Ingen ny avhengighet. Vår kode kaller aldri Microsoft direkte; Better Auth er adapteren. Statisk test stopper `fetch` mot Microsoft i `src/core/auth`.
2. **Én Microsoft-katalog (tenant) for hele installasjonen.** `tenantId` er alltid `MS_LOGIN_TENANT_ID` og må være en GUID. `common`, `organizations` og `consumers` godtas aldri, og `authority` settes ikke.
3. **Tenant-sjekken er vår egen og er selve sperren.** I omdirigeringsflyten dekoder Better Auth bare ID-tokenet. Før noe slås opp sjekker vi selv (`checkMicrosoftProfile`): `tid` er lik vår tenant, kontoen er ikke gjest (`idp` ulik egen tenant, eller `#EXT#` i brukernavnet), og e-posten finnes (`email`, med `preferred_username` som reserve, trimmet og med små bokstaver).
4. **Ingen ny bruker.** `disableSignUp: true` (ikke `disableImplicitSignUp`, som lar klienten be om ny bruker). Bare personer i `users` med aktivt ansattforhold slipper inn.
5. **Kobling på e-post første gang, deretter på `oid`** (A216). `accounts.account_id` er Microsofts `oid`, ikke `sub` (`sub` er ulik per app-registrering). Bytter admin e-post på en ansatt, eller endres adressen i Entra, følger kontoen samme `users`-rad.
6. **`trustedProviders: ["microsoft"]` og `requireLocalEmailVerified: false`.** Entra sender normalt ikke `email_verified`, og ansatte lagt inn av admin har `email_verified = false`; uten dette avvises alle. Det er trygt fordi (a) brukere lages bare av admin eller seed, aldri av innloggingen, og (b) vår egen `tid`-sjekk sikrer at adressen kommer fra Byggcons katalog. `allowDifferentEmails`, `updateUserInfoOnLink` og `overrideUserInfoOnSignIn` står av: navn, e-post og bilde i `users` eies av EzProp.
7. **Aktivt ansattforhold sjekkes ved hver Microsoft-innlogging** (A217): `hasActiveEmployment(userId)` i `src/core/access`, kalt fra `databaseHooks.session.create.before`. Samme vilkår som `findGrant`. Avvist gir ingen rad i `sessions`. Innloggingen gir ingen rettigheter; de kommer som før bare fra `requireOrganizationAccess`.
8. **Tokens lagres ikke** (A218). Vi ber bare om `openid profile email` (`disableDefaultScope: true`, `disableProfilePhoto: true`), og `access_token`, `refresh_token`, `id_token` og utløpstidene nulles før raden i `accounts` skrives. ID-tokenet har navn og e-post i klartekst, og vi bruker ingen av dem etter innlogging.
9. **Engangskoden er reserven og er uendret** (regel 11). Den virker alltid, også når Microsoft-oppsettet mangler eller feiler.
10. **Oppsettet er «alle eller ingen», og appen stopper aldri av det** (A219). `getMicrosoftLoginConfig()` gir `{ tenantId, clientId, clientSecret }` eller `null`. Delvis oppsett, tenant-id som ikke er GUID, eller en nøkkelboks-referanse som ikke ble hentet, gir `null` og én advarsel med bare navnene på verdiene. Derfor valideres ikke `MS_LOGIN_*` strengt i `env.ts` (der ville en feil stoppet appen).
11. **Egen app-registrering, adskilt fra e-post** (A214): `MS_LOGIN_*` er ikke `MS_GRAPH_*`. Innlogging trenger bare `openid profile email`; e-post trenger rettigheter i Graph. En lekket innloggingshemmelighet skal ikke kunne sende e-post.
12. **Innlogging er ikke en port i `integration_connections`.** Tilkoblinger hører til en organisasjon, og organisasjonen er ikke kjent før innlogging. Hemmeligheten leses med `readSecret` fra bladfilen `@/core/integrations/secrets` (ikke indeksen, som ville gitt sirkelen integrations → access → auth).
13. **`MS_LOGIN_CLIENT_SECRET` er et reservert hemmelighetsnavn** (`RESERVED_SECRET_REFS` i `src/core/integrations/secrets.ts`). Tilkoblingslaget avviser navnet som `secret_ref` for alle leverandører, ved lagring og ved oppslag. Ellers kunne en rad i `integration_connections` sendt innloggingshemmeligheten til en annen adapter. Navnet kan ikke stå i `DENIED_SECRET_REFS`, for da kunne `readSecret` ikke lese det for innloggingen.
14. **Endepunkter vi ikke bruker, er stengt:** `/link-social`, `/unlink-account`, `/refresh-token`, `/get-access-token`, `/account-info`, og `/sign-in/social` med `idToken` i kroppen. Bare omdirigeringsflyten er åpen. Ingen kobler til eller fra selv, så ingenting slettes i `accounts` (regel 3).
15. **Lik feilmelding for alle avvisninger** (A215). Årsaken (`MicrosoftRejectionReason`) logges som kode uten e-post, `oid`, token eller hemmelighet, og vises aldri på siden.
16. **Ingen migrering** (A220). Microsoft-kontoen bruker den eksisterende tabellen `accounts` med `provider_id = 'microsoft'`.
17. **ID-tokenet: `aud`, `iss` og `exp` sjekkes av oss, signaturen ikke** (A223). I omdirigeringsflyten dekoder Better Auth bare tokenet. `checkMicrosoftProfile` krever derfor at `aud` er vår klient-id, at `iss` er `https://login.microsoftonline.com/<tenant>/v2.0`, og at `exp` ikke er passert, før `tid` og resten sjekkes (årsakskode `invalid_token`). Signaturen sjekkes ikke: tokenet hentes av serveren direkte fra Microsofts token-adresse over TLS, med klienthemmeligheten, og OpenID Connect Core 3.1.3.7 punkt 6 tillater da å stole på TLS i stedet for signaturen. Flyten der klienten sender tokenet selv (`/sign-in/social` med `idToken`), er stengt (punkt 14). Det gir ingen henting av nøkler (JWKS) og ingen ekstra nettverkskall. Åpnes en flyt der tokenet ikke kommer rett fra token-adressen, må signaturen sjekkes der.
18. **Adresser utenfor appen følges ikke.** Better Auth sin sjekk av `callbackURL` og `errorCallbackURL` mot egen adresse (`trustedOrigins`, bare `BETTER_AUTH_URL`) står på, også i tester (`advanced.disableOriginCheck: false`; Better Auth slår den ellers av når `NODE_ENV` er «test»). Avviste innlogginger sendes til `/logg-inn?error=…` (`onAPIError.errorURL`).

## Forholdet til felles innlogging med Optiplan (S6)

Denne beslutningen avgjør ikke S6. Microsoft-innloggingen ligger i EzProps egen Better Auth-oppsett og bruker de samme tabellene (`users`, `accounts`, `sessions`) som deles med Optiplan i dag. Blir innloggingen felles senere, kan samme app-registrering få én tilbakeadresse til, eller Optiplan får sin egen; `oid` er lik på tvers av app-registreringer i samme katalog, så koblingene i `accounts` gjelder fortsatt.

## Kjent begrensning

Én tenant gjelder hele installasjonen. Den som er admin i Byggcons Entra ID, kan i praksis logge inn som enhver bruker i EzProp ved å sette e-postadressen på en Microsoft-konto. Det er akseptert så lenge Byggcon er eneste katalog. **Før selskap nummer to med egen katalog** må tenant knyttes til organisasjon, og koblingen må begrenses til brukere i den organisasjonen.

## Forkastet

- **`common` med filter på domenet `@byggcon.no`:** domenet i e-posten bevises ikke av tokenet på samme måte som `tid`, og gjester og andre kataloger kan ha samme adresse.
- **Automatisk oppretting av brukere fra Microsoft:** en Microsoft-konto alene skal ikke gi tilgang. Leder og admin bestemmer hvem som er ansatt i EzProp.
- **Samme app-registrering som e-post (`MS_GRAPH_*`):** blander rettigheter og hemmeligheter med ulik risiko (punkt 11).
- **Roller fra Entra-grupper:** rettigheter har én kilde, `src/core/access` (regel 2). To kilder gir tvil om hvem som har tilgang.
- **Kobling på `sub`:** ulik per app-registrering, så en ny registrering ville løsnet alle koblinger.
- **Unik indeks på `accounts (provider_id, account_id)` (migrering 0030):** arkitekten foreslo den; prosjektlederen valgte ingen migrering. Risikoen er to like rader for samme bruker ved to samtidige første innlogginger. Kan legges til senere med en liten migrering.
- **Streng validering av `MS_LOGIN_*` i `env.ts`:** en skrivefeil ville stoppet appen og stengt admin ute (regel 11).
- **Å lagre tokens for senere kall til Graph:** vi har ingen bruk for dem, og de er personopplysninger og nøkler vi da måtte vokte.
- **Falsk Microsoft-side i e2e:** hele flyten prøves i integrasjonstester med falsk `fetch` for token-adressen (A222, A223).

## Følger

- Ståle må lage app-registreringen og legge inn tre secrets (oppskrift i `docs/drift/testmiljo-azure.md`). Til det er gjort, vises bare engangskoden.
- Klienthemmeligheten utløper (maks 24 måneder). Da virker bare koden til hemmeligheten er fornyet.
- Tofaktor kommer bare fra Microsoft hvis Byggcons katalog krever det, og engangskoden går utenom (åpent spørsmål nr. 74). Databehandleravtalen: nr. 75.
- `accounts.account_id` (`oid`) er en personopplysning og følger samme oppbevaring som `users`.
- Dyrt å endre: hvordan identitet knyttes (punkt 5 og 6). Resten er lett å endre.
