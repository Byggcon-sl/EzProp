# Funksjon: Rett T-0044, T-0094 og T-0110: vasken før KI tar alle vanlige skrivemåter

- **Fase:** 2a (retting av testlagsfunn, kommer før nytt planpunkt)
- **Modul:** kjerne (`src/core/ai`) og felles mønstre (`src/shared/lib/pii-patterns.ts`)
- **Status:** godkjent (autonom modus, 17.11.2026)
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
Oppgaven er grunnmuren for all KI: vasken kjører i `src/core/ai` før hver forespørsel til leverandøren, og lekkasjesjekken (`src/core/ai/prompt-leaks.ts`) stopper forespørselen hvis noe slipper gjennom. Ingen ny KI-funksjon; ingen nye data lagres. Kjente verdier lever bare i minnet under kallet, som før. Alt prøves mot den falske leverandøren og med evalueringssettet (`pnpm ai:eval`).

## Brukerhistorier
- Som **takstmann** vil jeg **skrive navn, telefon og adresse slik jeg pleier** slik at **KI-forslaget lages uten at persondata sendes ut**.
- Som **leder** vil jeg **at lekkasjesjekken fanger det vasken bommer på** slik at **vi kan slå på ekte KI trygt**.

## Omfang
**Med:**
- T-0044: utvid mønstrene i `src/shared/lib/pii-patterns.ts`: e-post med «(at)»/«[at]» og mellomrom rundt @; telefon som enkeltsifre med mellomrom og med «(+47)» foran (hele nummeret vaskes, også parentesen); adresse med «nr.» før husnummer, husnummerspenn med bindestrek eller tankestrek («12–14»), flere vanlige gateendelser og flere adresser i én opplisting; postnummer med «N-» foran og poststed på flere ord («8622 Mo i Rana» blir ett merke); matrikkel med kommunenummer foran («1804-12/345»); andelsnummer med tall. Bokstaver fra annen skrift som ser like ut, slås sammen i `normalizeForRedaction` (vanlige kyrilliske og greske tegn som ligner latinske).
- T-0094: ta bort nuller foran i gnr, bnr, fnr og snr når kjente verdier lages (`redact-text.ts`, `redaction.ts`), og la mønsteret godta valgfrie nuller foran (`0*`), med og uten kommunenummer. Samme i lekkasjesjekken (`containsCadastral` i `prompt-leaks.ts`).
- T-0110: bestillerteksten deles ved komma; deler uten selskapsform går gjennom samme vask som personnavn (ord for ord, minst tre tegn). Borettslag/sameie får også en variant uten første ord når det står igjen minst to ord. Ordrenummer (`orders.external_ref`) vaskes med valgfrie skilletegn mellom bokstav- og talldelen. Lekkasjesjekken merker de samme formene.
- Oppdiktede testsaker i begge retninger for alle eksemplene i de tre funnfilene (i `pii-patterns.test.ts`, `redaction.test.ts` / `redaction-cases.ts` og lekkasjetestene), pluss saker som viser at fagtekst ikke overvaskes (brøken «1/2», årstall, mål som «120 mm», vanlige ord som «Tak»). Ingen eksisterende test svekkes eller fjernes.
- Funnfilene T-0044, T-0094 og T-0110 settes til status «rettet» med PR-nummer og en linje i loggen.
- Versjon i `package.json` økes (patch). Restrisiko som står igjen, beskrives i ADR 0006 del 6 eller oppgavekortet til vasken.

**Ikke med (bevisst utelatt):**
- Navn på personer som ikke er kjente verdier for oppdraget (navnegjenkjenning med KI eller ordlister).
- Utenlandske telefonnumre og adresser utenfor Norge.
- Andre småfunn for vasken i tilstandsfilen (fødselsnummer etter «fnr», overvask av korte stedsnavn, grense for sperrede rader, dobbel kopi av `isOwnRequest`) og T-0046, T-0047, T-0111. Tas senere.
- Ny KI-funksjon, ny ledetekst, endring av skjermer, ny tabell eller migrering.
- Å slå på ekte KI-leverandør (Ståle).

## Tilgang
Ingen endring. Vasken er ren og uten tilgangssjekk; `loadKnownValues` bruker fortsatt `grant.organizationId`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | uendret | uendret |
| kontor | uendret | uendret |
| leder | uendret | uendret |
| admin | uendret | uendret |

## Data
Ingen nye tabeller eller felter. Ingen faste koder. Ordrenummer (`orders.external_ref`) leses inn som kjent verdi i `loadKnownValues` hvis det ikke allerede gjøres (samme organisasjon, samme spørring).

## Skjermer
Ingen.

## Regler
Ingen fagregler. Vaskemønstrene er kode med testsaker.

## Akseptkriterier
- [ ] Alle eksemplene i T-0044 gir [e-post], [telefon], [adresse] eller [matrikkel], uten rester («(+47) [telefon]», «[adresse]–14», «[adresse] i Rana» skjer ikke lenger).
- [ ] Gnr/bnr lagret som «077» vasker «77/4321», «077/4321» og «1804-77/4321»; lagret som «77» vasker «077/4321». Lekkasjesjekken merker de usvaskede formene (test).
- [ ] Bestiller «Synnøve Testkisen» gir [navn] for «Synnøve» og «Testkisen» alene; «Testki Fjellstua borettslag» vasker «Fjellstua borettslag»; «TKMEGL-998877» vasker «TKMEGL 998877» og «TKMEGL998877». Lekkasjesjekken merker de samme formene (test).
- [ ] Fagtekst overvaskes ikke: «1/2», årstall, mål i mm og vanlige fagord står urørt (test).
- [ ] Alle eksisterende tester er grønne uten å svekkes; `pnpm ai:eval` har minst samme treffprosent.
- [ ] `loadKnownValues` filtrerer fortsatt på `grant.organizationId`; bruker i annen organisasjon får ikke andres kjente verdier (eksisterende `expectTenantIsolation`).
- [ ] Ingen kjente verdier i feilmeldinger eller logger (eksisterende tester).
- [ ] Funnfilene er oppdatert med status «rettet» og PR-nummer.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Roller
- `utvikler`: mønstrene og kjente verdier (`pii-patterns.ts`, `redact-text.ts`, `redaction.ts`, `prompt-leaks.ts`).
- `testskriver`: testsaker i begge retninger og mot overvask, parallelt.
- `sikkerhet-personvern`: gjennomgang (krav i `redact-text.ts`: endring krever denne gjennomgangen).

## Åpne spørsmål
- Ingen. Beslutninger tatt i autonom modus (hvilke skrivemåter som tas, og restrisiko) føres i `docs/09-apne-sporsmal.md` som «lett å endre».
