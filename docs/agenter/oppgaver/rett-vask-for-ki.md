# Funksjon: Rett T-0044, T-0094 og T-0110: vasken før KI tar alle vanlige skrivemåter

- **Fase:** 2a (retting av testlagsfunn, kommer før nytt planpunkt)
- **Modul:** kjerne (`src/core/ai`) og felles mønstre (`src/shared/lib/pii-patterns.ts`)
- **Status:** godkjent etter forhåndsvurdering (forbedrer, sikkerhet-personvern, test-leder), autonom modus, 17.11.2026
- **Branch:** `rett-vask-for-ki` (bygger på main)
- **Bygger på:** levert «Vask før KI» (`docs/funksjoner/fase2a-vask-for-ki.md`, PR #135) og ADR 0006 del 6
- **Støtter hovedmål:** KI i bunnen: navn, e-post, telefon, adresse og matrikkel skal aldri nå KI (regel 14), uansett hvordan takstmannen skriver dem; dette må være på plass før ekte KI slås på. / De ansatte: takstmannen kan skrive fritt i notater og avvik uten å tenke på vasken. / Reklamasjoner: indirekte, ingen persondata hos leverandøren gir mindre risiko for avvik og klager.

## Problem
Testlaget fant tre hull i vasken før KI:
- **T-0044 (middels, forbedring):** vanlige skrivemåter av e-post («(at)», mellomrom rundt @), telefon (enkeltsifre med mellomrom, «(+47) 41234567»), adresse («Havnegata nr. 3», «Strandveien 12–14», flere gateendelser, bokstaver fra annen skrift som ser like ut), postnummer («N-8006 Bodø», «8622 Mo i Rana»), matrikkel med kommunenummer foran («1804-12/345») og andelsnummer går urørt gjennom.
- **T-0094 (middels, feil, bekreftet):** gnr/bnr/fnr/snr lagret med null foran («077») fanges ikke når teksten skriver «77/4321» eller «1804-77/4321», og omvendt. Lekkasjesjekken merker det heller ikke.
- **T-0110 (lite, forbedring):** bestillerteksten vaskes bare som hel tekst; fornavn eller etternavn alene, borettslagsnavn uten første ord og ordrenummer med mellomrom eller annet skilletegn går gjennom. Lekkasjesjekken merker det ikke.

Lar vi være, kan persondata havne hos KI-leverandøren og i `ai_usage_log` når ekte KI slås på.

## KI i bunnen
Oppgaven er grunnmuren for all KI: vasken kjører i `src/core/ai` før hver forespørsel til leverandøren, og lekkasjesjekken (`src/core/ai/prompt-leaks.ts`) stopper forespørselen hvis noe slipper gjennom. Ingen ny KI-funksjon; ingen nye data lagres (A172 står: loggen får fortsatt bare summen). Kjente verdier lever bare i minnet under kallet, som før. Alt prøves mot den falske leverandøren og med evalueringssettet (`pnpm ai:eval`).

## Brukerhistorier
- Som **takstmann** vil jeg **skrive navn, telefon og adresse slik jeg pleier** slik at **KI-forslaget lages uten at persondata sendes ut**.
- Som **leder** vil jeg **at lekkasjesjekken fanger det vasken bommer på** slik at **vi kan slå på ekte KI trygt**.

## Omfang
**Med:**

*T-0044, faste mønstre (`src/shared/lib/pii-patterns.ts`), virker også uten kjente verdier:*
- **E-post** med «(at)», «[at]» og mellomrom rundt @ tas i `redactEmails` (første trinn), ikke bare i `redactPii`. Da blir «ola.testesen(at)eksempel.no» ett [e-post]-merke også når «Testesen» er et kjent navn.
- **Telefon:** nøyaktig åtte enkeltsifre med ett mellomrom mellom («4 1 2 3 4 5 6 7»); færre enn åtte står. «(+47)» og «(0047)» foran tas med i merket, også parentesen.
- **Adresse:** «nr.» før husnummer og husnummerspenn med bindestrek eller tankestrek («12–14»), men bare etter en gateendelse. Flere vanlige gateendelser (utvidelsen avgjøres av utvikleren og står i testene), og hver adresse i en opplisting («Solsvingen 4, Granlia 3 …») får eget merke.
- **Postnummer:** «N-» foran, og poststed på flere ord bare som «Stor-bokstav (i|på) Stor-bokstav» («8622 Mo i Rana» blir ett merke).
- **Matrikkel:** kommunenummer foran uten matrikkelord, bare formen fire sifre, bindestrek, gnr/bnr («1804-12/345», også med fnr/snr). Andelsnummer: «andelsnr.»/«andelsnummer» med tall blir ett merke: «Andelsnummer 45 i Fjellsiden borettslag» blir «[matrikkel] i Fjellsiden borettslag» når borettslaget ikke er kjent, og «[matrikkel] i [navn]» når det er kjent verdi på oppdraget.
- **Bokstaver fra annen skrift** i `normalizeForRedaction`: bare kyrilliske og greske tegn som ser ut som latinske byttes. µ/μ, Ω, λ, π og andre fagtegn står urørt; æ, ø og å (også i NFD) står urørt. Funksjonen brukes også av `prompt.ts` og loggeren, så teksten til KI endres tilsvarende (A426).
- Nullene foran (`0*`) og kommunenummer foran med nuller gjelder bare kjente verdier, ikke det generelle matrikkelmønsteret (det har alt `\d{1,5}` etter matrikkelordet).

*T-0094, matrikkel i kjente verdier (`redact-text.ts`, `redaction.ts`, og egen logikk i `containsCadastral` i `prompt-leaks.ts`):*
- Nuller foran fjernes fra gnr, bnr, fnr, snr og kommunenummer når kjente verdier lages, og mønsteret godtar `0*` foran hvert ledd, med og uten kommunenummer, i begge retninger («077» lagret treffer «77/4321», «1804-77/4321», «1804-077/04321»; «77» lagret treffer «077/4321»). Firedelt form med fnr og snr likeså («77/4321/0/2» mot «077/4321/00/2»).
- En verdi som bare er nuller («0», «000») blir «0», aldri tom. Nuller fjernes bare foran sifre; verdier som «12a» beholdes som de er.
- Kommunenummer «0301» og «301» følger samme regel.

*T-0110, bestiller, borettslag og ordrenummer:*
- Bestillerteksten deles ved komma og «v/». Deler uten selskapsform vaskes som personnavn: hel del og hvert ord på minst tre tegn, unntatt en kort stoppliste i kjernen (rolleord: megler, eiendomsmegler, eier, selger, kjøper, styreleder, forretningsfører; og «borettslag», «borettslaget», «sameie», «sameiet»), se A422.
- Borettslag og sameie får også en variant uten første ord når det står igjen minst to ord («Testki Fjellstua borettslag» gir også «Fjellstua borettslag»). «borettslag» eller «borettslaget» alene vaskes aldri.
- **Ordrenummer får eget felt** `orderRefs` i `KnownValues` (ikke lenger i `phrases`). Bare ordrenummeret får valgfrie skilletegn (mellomrom, «-», «–», «/», «_», punktum, eller ingen) mellom bokstav- og talldelen, og bare når nummeret har minst seks bokstaver og sifre til sammen («A-1» vasker ikke «A1»). Talldelen alene vaskes når den har minst fem sifre (A423).

*Lagt til av sikkerhet-personvern (krav før bygging):*
- **Kjente verdier lager ikke rester.** Prefikset for kjent telefon tar «(+47)», og `addAddressPart` får «nr.» og spenn med bindestrek eller tankestrek. Testsaker med kjente verdier: «(+47) 41234567» blir «[telefon]», «Strandveien 12–14» blir «[adresse]».
- **Lekkasjesjekken står på egne bein for matching.** `containsCadastral` og ordgrensene i `prompt-leaks.ts` har egen logikk og importerer ingen hjelpere fra `redact-text.ts`. Se «Avgjort» under for den felles listen over skrivemåter.
- **Lik grense for navnedeler:** tre tegn for ord-for-ord-former både i vasken og i sjekken (hel verdi fortsatt minst to tegn i begge). Ellers sperres den ansatte for noe vasken ikke tar.
- **Ytelse:** nye mønstre har faste øvre grenser og ingen nøstede gjentakelser. Test med minst 100 000 tegn (også nesten-treff) og tidsgrense på ett sekund for `redactPii`, og for `compileKnownValues` med en bestillertekst på mange ord og minst 200 kjente ord.
- **Feilmeldinger:** `RedactionPatternError` beholder fast melding uten `cause`. Den eksisterende testen utvides til bestillertekst på mange ord.
- **Restrisiko** føres i ADR 0006 del 6: «07/04» som dato når gnr er 7 og bnr 4 (kjente verdier), åtte enkeltsifre i en måleserie blir [telefon] (også i loggen), «2025-12/2026» blir [matrikkel], borettslagsnavn som ikke er kjent verdi står, og fornavn på to bokstaver alene står.
- **Testdata:** bare oppdiktede navn (Testesen, Testkisen), e-post på example.com eller eksempel.no, og oppdiktede gatenavn. Aldri ekte gate, ekte postnummer og et navn sammen.

*Lagt til av test-leder:*
- **Nye saker i eget sett** `src/core/ai/redaction-cases-spellings.ts` med egen 0-bom-test. Det gamle settet (50 saker, øvre grense 50) og testen V3.11 står uendret.
- **Lekkasjesjekken uten kjente verdier:** `findPatternLeaks` får egne tester som viser at T-0044-formene merkes når `known` er null.
- **Alle som bruker `pii-patterns.ts`** (`src/shared/lib/logger.ts`, `src/core/ai/prompt.ts`, `src/core/ai/prompt-leaks.ts`, `src/core/ai/redact-text.ts`): utvikleren søker på nytt, og hver får en test eller en kort begrunnelse i PR-en. Loggeren får en test for «(at)» og «(+47)».
- **Måling:** `pnpm ai:eval` kjøres på main før endringen, og treffprosenten står i PR-en.
- E2E: ingen nye skjermer; eksisterende `pnpm test:e2e` (PC og iPad, særlig `/prove/ki`) skal være grønn.

*Ellers som før:*
- Funnfilene T-0044, T-0094 og T-0110 settes til status «rettet» med PR-nummer og en linje i loggen.
- Versjon i `package.json` økes (patch).

**Ikke med (bevisst utelatt):**
- Navn på personer som ikke er kjente verdier for oppdraget (navnegjenkjenning med KI eller ordlister), og borettslagsnavn som ikke er kjente verdier.
- Utenlandske telefonnumre og adresser utenfor Norge.
- Andre småfunn for vasken i tilstandsfilen (fødselsnummer etter «fnr», overvask av korte stedsnavn, grense for sperrede rader, dobbel kopi av `isOwnRequest`) og T-0046, T-0047, T-0111. Tas senere.
- «Se hva KI fikk» (eget planpunkt under «Fra forbedreren»).
- Ny KI-funksjon, ny ledetekst, endring av skjermer, ny tabell eller migrering.
- Å slå på ekte KI-leverandør (Ståle).

## Lagt til av forbedreren
(Ståle 14.11.2026, «Forbedreren» i `CLAUDE.md`. Ført i `docs/plan/forbedrerens-tillegg.md`.)
1. **Én felles liste over skrivemåter.** Ny ren funksjon `knownValueForms(known)` i `src/core/ai/known-value-forms.ts`. Den lager alle formene: matrikkeltall uten null foran, navn ord for ord (stopplisten), borettslag uten første ord, ordrenummer med valgfritt skilletegn og telefon bare med sifre. Både `redactText` og `findLeakedKnownValues` bruker den. `findLeakedKnownValues` kjører også `normalizeForRedaction` først, så kyrillisk «Т» eller usynlige tegn ikke slipper forbi sjekken. Hovedmål: KI i bunnen, færre reklamasjoner.
2. **Varianttest som går begge veier.** En fast generator i testen (ingen ny avhengighet) lager varianter av hver oppdiktet kjent verdi: store og små bokstaver, null foran, kommunenummer foran, «/» «-» «–» og mellomrom, hardt mellomrom, linjeskift midt i adressen («Havnegata\n3») og lignende bokstaver fra annen skrift. For hver variant: `findPromptLeaks(variant, known)` finner den, og `findPromptLeaks(redactText(variant, known).text, known)` er tom. Generatoren skrives i testfilen og importerer ikke `known-value-forms.ts`. Hovedmål: KI i bunnen.
3. **Flere saker mot overvask** (sammen med test-leders): skal stå urørt: «01/02», «12/2025», «17/11», «17.11.2026», «2019–2021», «uke 12/13», «Rom nr. 3», «kontrollpunkt nr. 3», «Bad 2–3», «2–3 mm», «12–14 mm», «8 mm», «1200 mm i badet», «I 2019 i juni», «2 3 4 5 lag», «Mo» alene, «i Rana» uten postnummer, «1/2», «120 mm», «Tak», «borettslaget». Hovedmål: de ansatte og færre reklamasjoner.
4. **Vaskeresultatet i evalueringssettet.** Alle eksemplene fra T-0044, T-0094 og T-0110 legges inn som oppdiktede saker i `pnpm ai:eval`. Rapporten viser antall vasket per type (navn, e-post, telefon, adresse, matrikkel), aldri verdiene. Tallene står bare i rapporten fra kjøringen, ikke i `ai_usage_log` (A172 står). Hovedmål: KI i bunnen.
5. **«Se hva KI fikk»** er større og blir eget planpunkt under «Fra forbedreren» i fase 2a (ikke i denne oppgaven).

## Avgjort ved uenighet (prosjektlederen, 17.11.2026)
- **Felles liste over skrivemåter (forbedreren) mot egne bein for sjekken (sikkerhet-personvern):** begge tas. *Hvilke former* som finnes, lages ett sted (`known-value-forms.ts`, ikke i `redact-text.ts`), fordi det var nettopp at listene gled fra hverandre som ga T-0094 og T-0110. *Matchingen* (ordgrenser, `containsCadastral`, normalisering) skrives hver for seg i `prompt-leaks.ts` og `redact-text.ts`. Den uavhengige kontrollen sikkerhet-personvern ber om, er varianttesten: generatoren er skrevet i testen og bruker ikke `knownValueForms`, så en manglende form i den felles listen blir rød. (A420)
- **Ordgrenser:** sjekken bruker i dag grenser uten `_`, `pii-patterns.ts` med. For kjente verdier brukes grenser uten `_` både i vasken og sjekken (`_` regnes som skilletegn, så «ola_Testesen» vaskes). De generelle mønstrene i `pii-patterns.ts` endres ikke på dette punktet. (A421)
- **«2025-12/2026» (test-leder ville ha den urørt):** kommunenummerformen uten matrikkelord vasker den som [matrikkel]. Vi kan ikke skille et bnr fra et årstall, og vasken skal heller ta for mye enn for lite (A170). Formen er sjelden i fagtekst; «12/2025», «17/11» og «2019–2021» står. Ført som restrisiko. (A425)
- **Rolleord (sikkerhet-personvern ba ki-ansvarlig avgjøre):** avgjort her med stopplisten over (A422), slik at «megler» og «eier» i fagtekst ikke blir [navn]. Ord utenfor listen som står i bestillerteksten, vaskes overalt i teksten; det er restrisiko for overvask, ført i ADR 0006 del 6.

## Tilgang
Ingen endring. Vasken er ren og uten tilgangssjekk; `loadKnownValues` bruker fortsatt `grant.organizationId`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | uendret | uendret |
| kontor | uendret | uendret |
| leder | uendret | uendret |
| admin | uendret | uendret |

## Data
Ingen nye tabeller, felter eller migreringer. Ingen faste koder. Ordrenummer (`orders.external_ref`) leses alt inn i `loadKnownValues` (samme organisasjon, samme spørring); det flyttes bare fra `phrases` til det nye feltet `orderRefs` i `KnownValues` (bare i minnet). Ingen ny spørring, så eksisterende `expectTenantIsolation` i `redaction.test.ts` dekker tilgangen.

## Skjermer
Ingen.

## Regler
Ingen fagregler. Vaskemønstrene er kode med testsaker.

## Akseptkriterier
- [ ] Alle eksemplene i T-0044 gir [e-post], [telefon], [adresse] eller [matrikkel] uten rester, både uten og med kjente verdier («(+47) [telefon]», «[adresse]–14», «[adresse] i Rana», «[navn].[navn](at)eksempel.no» skjer ikke).
- [ ] «Andelsnummer 45 i Fjellsiden borettslag» blir «[matrikkel] i Fjellsiden borettslag» uten kjente verdier, og «[matrikkel] i [navn]» når «Fjellsiden borettslag» er kjent verdi.
- [ ] Gnr/bnr lagret som «077» vasker «77/4321», «077/4321», «1804-77/4321» og «1804-077/04321»; lagret som «77» vasker «077/4321»; firedelt «77/4321/0/2» mot «077/4321/00/2» begge veier. Lagret «0» eller «000» blir «0» og treffer ikke «/34» eller alt etter matrikkelordet. `containsCadastral` merker de samme usvaskede formene, også med kommunenummer.
- [ ] Bestiller «Synnøve Testkisen» gir [navn] for «Synnøve» og «Testkisen» alene; «Testki Fjellstua borettslag» vasker «Fjellstua borettslag», men «borettslaget» alene står; «TKMEGL-998877» vasker «TKMEGL 998877», «TKMEGL998877», «TKMEGL/998877», «TKMEGL_998877» og «998877»; «A-1» vasker ikke «A1». En bestiller med rolleord («Testesen v/ megler») vasker ikke «megler» i fagteksten.
- [ ] Vasken og sjekken er enige: for hver sak i det nye settet og hver variant fra generatoren gir `findPromptLeaks` treff på den usvaskede teksten og tom liste på den vaskede (testene kaller `findPromptLeaks` direkte).
- [ ] `findPatternLeaks` merker T-0044-formene når `known` er null.
- [ ] Alle sakene mot overvask (punkt 3 under «Lagt til av forbedreren») står urørt, også «μm», «Ω», «λ-verdi», og æ, ø, å i NFD.
- [ ] `redactPii` på 100 000 tegn og `compileKnownValues` med 200 kjente ord går under ett sekund hver.
- [ ] `pnpm ai:eval` har minst samme treffprosent som på main (målt før endringen, tallet i PR-en), og viser vasket per type uten verdier.
- [ ] Alle eksisterende tester er grønne uten å svekkes; V3.11 og grensen på 50 er uendret.
- [ ] `loadKnownValues` filtrerer fortsatt på `grant.organizationId` (eksisterende `expectTenantIsolation`).
- [ ] Ingen kjente verdier i feilmeldinger eller logger (E6.1 og `RedactionPatternError`-testen, utvidet).
- [ ] Restrisikoen står i ADR 0006 del 6; beslutningene A420–A426 står i `docs/09-apne-sporsmal.md`.
- [ ] Funnfilene er oppdatert med status «rettet» og PR-nummer.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Roller
- `utvikler` (bit 1): faste mønstre og `normalizeForRedaction` i `pii-patterns.ts`, med loggertesten.
- `utvikler` (bit 2): `known-value-forms.ts`, `redact-text.ts`, `redaction.ts` og `prompt-leaks.ts`.
- `testskriver` (parallelt): `redaction-cases-spellings.ts`, varianttesten, sakene mot overvask, ytelsestestene og sakene i `pnpm ai:eval`.
- `sikkerhet-personvern`: gjennomgang (krav i `redact-text.ts`: endring krever denne gjennomgangen).

## Åpne spørsmål
- Ingen til Ståle. Beslutningene A420–A426 er ført i `docs/09-apne-sporsmal.md`, alle «lett å endre».
