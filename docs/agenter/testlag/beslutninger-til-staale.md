# Beslutninger som er dyre å endre

Sist oppdatert: 11.11.2026 (testlagets første kjøring, laget av dokumentvakten og kvalitetslederen)

Mens Ståle var borte, har agentene tatt 167 beslutninger (A1–A168, A22 er ikke brukt). De står i `docs/09-apne-sporsmal.md`, tabellen «Avgjort av agentene mens Ståle var borte». **De fleste er lette å endre.** Her er bare de som blir dyre å endre senere, fordi data må flyttes, fordi de står på rapportene, eller fordi de gjelder personvern og sikkerhet. Det er disse Ståle bør lese først.

Alle beslutninger som ikke står her, er lette å endre.

## KI og personvern

| Nr | Hva er bestemt | Hvorfor det er dyrt å endre |
|---|---|---|
| A148 | Forslag fra KI og loggen over KI-bruk ligger i én og samme tabell. | Skal de deles senere, må data flyttes. |
| A150 | Det som sendes til KI, styres av en liste over felt som er lov per funksjon. | Gjelder personvern. Et bytte krever ny vurdering. |
| A151 | Instruksene til KI har versjonsnummer og ligger ett sted i kjernen. | Alle KI-funksjoner bygger på dette. |
| A154 | En KI-funksjon slås ikke på før den treffer 90 % av eksemplene, og 100 % av dem som må treffe. | Avgjør hva KI får lov til å bidra med i rapporten. |
| A157 | Loggen over KI-bruk regnes som personopplysninger og lagres i 10 år, også forslag som ble avvist. KI har ingen verktøy. | Gjelder personvern. Venter på svar på spørsmål 56. |

## Sikkerhet og tilgang

| Nr | Hva er bestemt | Hvorfor det er dyrt å endre |
|---|---|---|
| A19 | Den som kan publisere, kan også overstyre sperrene fra forskriften. | Skal det skilles senere, må rettighetene deles. |
| A21 | Hvilke rettigheter som kan gis til én og én ansatt. | Grunnmur for all tilgang. |
| A29 | Uten gyldig sertifisering kan man ikke publisere, heller ikke leder og admin. | Avgjør hvem som kan levere rapporter. |
| A35 | Innlogging sperres etter 5 feil på 15 minutter per e-post. | Kjent svakhet: hvem som helst kan holde admin sperret ute en stund. |
| A36, A38 | Innloggingsforsøk lagres uten navn og organisasjon, og er unntatt tiårsregelen og myk sletting. | Unntak fra to faste regler. |
| A43 | Alle ansatte kan hente alle filer i organisasjonen (bilder, egenerklæringer). | Gjelder personvern. Å stramme inn senere krever ny tilgangsmodell for filer. |
| A49 | Nøkkelboksen for hemmeligheter bruker sin egen tilgangsstyring. | Påvirker oppsettet i Azure. |
| A58 | Loggen over hendelser ryddes aldri. | Vokser over tid, og gjelder personvern. |
| A64 | Grunnen ved bytte i teamet er fritekst. | Risiko for at noen skriver helseopplysninger der. |
| A121 | Tidsmåling er på som standard. I betaen er tallene i praksis per person. | Arbeidsmiljøloven kapittel 9. Bør drøftes med de ansatte (se også funn T-0012). |

## Datamodell og faste koder

| Nr | Hva er bestemt | Hvorfor det er dyrt å endre |
|---|---|---|
| A52 | Oppdragsnummer ÅÅÅÅ-NNNNN, én serie per organisasjon og år. | Står på rapportene. |
| A57, A130 | Prøvedata ligger i en egen prøveorganisasjon. | Sletteregelen bygger på det. |
| A60 | Fem roller for parter og tre valg for hvem som mottar rapporten, uten «oppdragsgiver». | Faste koder i data. |
| A61 | Én aktiv person per rolle i teamet. | Låst i databasen. |
| A70 | Hvert oppdrag får sin egen eiendom. | Historikk per bolig blir dyrere senere. |
| A71, A94 | Fellesdeler, bygninger, etasjer og rom hører til oppdraget. Koblingen til rapporten kommer senere. | Data må flyttes når rapportene kommer. |
| A79 | Organisasjonsnummer er valgfritt, men unikt når det er fylt ut. | Låst i databasen. |
| A80 | Faste koder for hvor en kontakt kommer fra. | Faste koder i data. |
| A85 | Partene på oppdraget er et øyeblikksbilde av kontakten. | Endring i kontakten slår ikke gjennom på gamle oppdrag. |
| A115 | Rapportprofilen er en tekstkode, ikke en kobling. | Må gjøres om hvis profiler skal redigeres. |
| A125 | Reklamasjonssaken knyttes til oppdraget, ikke til rapporten. | Data må flyttes hvis det endres. |
| A128 | Bygningsdel på reklamasjonen er fritekst. | Tall per bygningsdel (reklamasjonsmålet og S4) krever opprydding senere. |
| A136, A137, A141 | Hvordan faste koder i malen arkiveres og kjennes igjen. | Grunnmur for regneark og regler (regel 6). |
| A142 | Standardtiltak, vilkår i regler og testsaker har ingen fast kode og erstattes samlet. | Grunnmur for malen. |
| A27 | Roller tas bort med myk sletting. | Låst i databasen. |
| A30 | Ett område for sertifisering: tilstandsrapport. | Flere områder krever endring i data. |

## Fag

| Nr | Hva er bestemt | Hvorfor det er dyrt å endre |
|---|---|---|
| A65–A67 | Utstedende selskap settes automatisk fra ansvarlig takstmann, og kan ikke overstyres. | Avgjør hvilket selskap som står ansvarlig for rapporten. |
| A69 | Fire eierformer, uten obligasjonsleilighet. | Faste koder i data. |
| A72 | Når fellesdeler gjelder. | Påvirker innholdet i rapporten. |
| A95 | 33 romtyper som faste koder (utkast). | Faste koder i data (se funn T-0016 om kryperom). |
| A96 | Areal per etasje, BRA som sum, og koder for målemetode. | Areal er en vanlig grunn til reklamasjon. |
| A97 | Forslaget om «under terreng» styrer kravet om hulltaking. | Påvirker TG i våtrom og kjeller (se funn T-0010). |
| A118 | Teksten om forutsetninger logges uten innhold. | Sporbarhet ved reklamasjon. |

## Til vurdering

- Navn på KI-modeller står i noen dokumenter i `docs/`. Regelen i CLAUDE.md gjelder bare commits, PR-er og kode, så det er ikke meldt som feil. Ståle kan vurdere om regelen skal gjelde dokumentene også.
