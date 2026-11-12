# Svar fra Ståle 12.11.2026

Sist oppdatert: 12.11.2026
Kilde: Ståle svarte på 25 åpne spørsmål i chat 12.11.2026, ett om gangen med avkrysning. Der han skrev et eget svar, står det ordrett i anførselstegn. Numrene i parentes er numrene i `docs/09-apne-sporsmal.md`.

## Fag (Ståle er fagrådet)

| Nr | Spørsmål | Svar |
|---|---|---|
| F1 (72) | Hva betyr «TG0 gis når vi ikke måler fukt» (svar 59a)? | **TG0 gis når det er tatt hull og målt uten forhøyet fukt**, uansett hvor gammelt badet er. Gjelder tilliggende konstruksjoner i våtrom. |
| F2 (72) | Hva gis når det ikke er tatt hull og ikke målt fukt i et eldre bad? | **TGIU**, med begrunnelse og risikovurdering. |
| F3 (71) | Hvilke tall gjelder for fuktgrensen og levetidene? | **Verdiene i NS 3600:2025 gjelder** som de er. |
| F4 (70) | Alderen er nøyaktig halvparten av funksjonstiden. Forslag om TG2? | **Ja.** Lik eller over grensen gir forslag. |
| F5 (69) | Fuktmålingen er nøyaktig lik grensen. Avvik? | **Ja.** Lik eller over grensen er avvik. |
| F6 (68) | Kryperom og lavt, uinnredet loft | **Kan føres som «ikke del av BRA». Kryperom følger reglene for krypkjeller**, uten krav om hulltaking. |
| F7 (66) | Etasjenummer for «Underetasje» | **-1. «Under terreng» er forhåndsvalgt**, og takstmannen kan endre det. |
| F8 (67) | Ansvarlig takstmann og sertifisering | **Ingen kontroll ved valg.** Kontrollen skjer bare ved publisering, som i dag. |
| F9 (65) | Kan egne maler lage nye sperrer ved publisering? | **Nei, bare advarsler.** Bare de sju kravene fra forskriften sperrer. |

## KI og personvern

| Nr | Spørsmål | Svar |
|---|---|---|
| K1 (73a) | Hvor skal KI-behandlingen skje? | **Anthropic direkte i testmiljøet med oppdiktede data. EU/EØS før ekte kundedata.** |
| K2 (73b) | Kreve null-lagring hos leverandøren? | **Nei.** Leverandørens vanlige oppbevaringstid godtas og skrives inn i personvernerklæringen. Endrer forutsetningen i ADR 0006. |
| K3 (73c) | Personvernkonsekvensvurdering (DPIA)? | **Ja, et kort utkast fra agentene** som Ståle godkjenner. Før ekte data, ikke før testing. |
| K4 (54) | Restrisiko i vasket fritekst | **Godtatt.** |
| K5 (58) | Bestilling på e-post til ekte KI | **«ja»** |
| K6 (55) | Taleopptak og bilder til ekte KI | **«ja til alt»** |
| K7 (56) | Oppbevaring av avviste KI-forslag | **Innstilling, 10 år som standard.** |
| K8 (57) | Tall om KI-bruk per ansatt | **Ja, også for leder.** Må drøftes med de ansatte først (arbeidsmiljøloven kapittel 9). |
| K9 (64) | Tak på antall KI-kall | **Nei.** Ingen grense i EzProp. |

**Slik er K5 og K6 lest:** ja til funksjonene. K1 gjelder fortsatt, så ekte kundedata (e-post, tale og bilder) sendes først når behandlingen skjer i EU/EØS og databehandleravtalen er på plass. Ståle retter dette hvis han mente noe annet.

## Innlogging

| Nr | Spørsmål | Svar |
|---|---|---|
| I1 (75) | Dekkes Microsoft-innloggingen av dagens databehandleravtale for Microsoft 365? | **Ja, bekreftet.** |
| I2 (74) | Hvem kan bruke engangskoden når ekte data tas i bruk? | **Alle.** Koden er reserve for alle ansatte. |
| I3 (ny) | Krever Byggcons Microsoft-oppsett tofaktor i dag? | **«nei, dette styrer vi selv»** |

**Følge av I2 og I3:** med disse svarene er det ingen tofaktor når ekte data tas i bruk. Det står mot mål 11 i planen («tofaktor eller tilsvarende») og punktet om tofaktor i fase 4. Ståle avgjør om målet skal endres, eller om tofaktor slås på i Microsoft før ekte data.

## Forslag fra testlaget

| Nr | Forslag | Svar |
|---|---|---|
| T1 (60) | Rette en ordre etter at den er lagret | **«ja, full redigeringstilgang. alltid»** Også etter at ordren er blitt oppdrag. Endrer A55 og A87. |
| T2 (61) | Søk i ordrelisten og i arbeidskøen | **Ja, nå** (fase 2a). |
| T3 (62) | Varsel om mulig dublett | **Ja, nå.** Fast regel uten KI, og varselet stopper ikke lagringen. |
| T4 (63) | Legge til flere rom på én gang | **«færrest klikk, mest mulig effektivt. ki first (altså ki skal utvikles så tidlig som mulig)»** |

**Slik er T4 lest:** velg løsningen med færrest trykk nå, og legg KI som foreslår rom (for eksempel fra plantegning) så tidlig som det lar seg gjøre, ikke i «Senere».

## Det agentene må gjøre med svarene

- Reglene for badet (PR #167): F1–F5. Prøvene bruker i dag «over grensen» og «ikke avvik» ved lik verdi. Det skal være «lik eller over».
- Funnene T-0003, T-0007, T-0010, T-0011 og T-0016 kan rettes eller lukkes etter F1–F8.
- ADR 0006 og beslutningsnotatet om KI-leverandør: K1, K2 og K7. A157 (10 år fast) blir en innstilling.
- Planen: T1–T4 inn i fase 2a, DPIA-utkast (K3) før ekte data, visning av KI-bruk per ansatt (K8) først etter drøfting med de ansatte.
- Forslag 64 (tak på KI-bruk) bygges ikke. Uten tak i EzProp bør Ståle sette en beløpsgrense hos leverandøren.
