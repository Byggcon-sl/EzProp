# Beslutningsnotat: KI-leverandør (S8)

**EU/EØS først:** Notatet lover ikke at KI-behandlingen skjer i EU/EØS når vi bruker Anthropic direkte. Hovedregelen der er at teksten behandles utenfor EØS (USA og andre land). Anthropic tilbyr i dag bare valget «hvor som helst» eller «bare USA», ikke «bare EU». Vil Byggcon ha behandlingen i EU, må vi bruke Anthropic-modellene gjennom en skyleverandør som tilbyr dem i EU-region (Amazon eller Google). Microsofts Azure tilbyr dem i dag ikke med EU-region. Dette må Ståle velge før ekte data sendes til KI.

Skrevet 11.11.2026 til Ståle. Leverandøren er valgt (Anthropic, Ståle 10.11.2026). Kildene er leverandørenes offentlige sider, lest 11.11.2026 (lenker under hver del). Notatet oppsummerer med egne ord; avtaleteksten gjelder ved tvil.

## EU/EØS

Tre veier:

| Vei | Hvor teksten behandles | Merknad |
|---|---|---|
| Anthropic direkte (det adapteren er bygget for) | Utenfor EØS (hovedregel) | Enklest. Krever grunnlag for overføring ut av EØS (se Databehandleravtale). |
| Amazon (EU-område) | Bare i EU-regioner (Frankfurt, Stockholm, Irland, Paris, Milano, Spania) | Ca. 10 % dyrere. Krever egen adapter og egen avtale med Amazon. |
| Google (europeisk region) | I valgt europeisk region (f.eks. Belgia, Nederland, Finland) | Ca. 10 % dyrere. Krever egen adapter og egen avtale med Google. |

Anbefaling: Anthropic direkte i testmiljøet med oppdiktede data. For ekte data anbefales EU-veien gjennom Amazon eller Google, fordi det er enklest å forklare til kunder og Datatilsynet. Bytte av vei krever en ny adapter bak den samme KI-porten, ikke endringer i funksjonene.

Kilder: [Anthropic, hvor data behandles](https://platform.claude.com/docs/en/manage-claude/data-residency) · [Amazon, EU-område](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html) · [Google, regioner](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations) · [Microsoft](https://learn.microsoft.com/en-us/azure/ai-foundry/foundry-models/how-to/use-foundry-models-claude). Lest 11.11.2026.

## Modellvalg per funksjon

Anthropic har modeller i flere størrelser. Større modell gir bedre svar, men koster mer og svarer saktere. Notatet bruker tre klasser: **minste**, **mellomste** og **største**. Hvilken modell som brukes, står i innstillingene til tilkoblingen og kan byttes uten ny programvare. **Hver funksjon må bestå evalueringssettet (de oppdiktede prøveeksemplene) før den slås på.** Består en mindre modell, brukes den.

| Funksjon | Fase | Klasse | Hvorfor |
|---|---|---|---|
| Språkvask | 2a | mellomste | Godt norsk er viktig i rapporten. Minste prøves først i evalueringssettet. |
| Forslag fra frasebanken | 2a | minste | Velger blant Byggcons egne tekster, skriver ikke nytt. |
| Oppsummering | 2a | mellomste | Må få med det viktige og ikke legge til noe. |
| KI-sjekk før publisering | 2a | største | Leser hele rapporten og leter etter motsigelser. Støtter færre reklamasjoner. |
| Ordreforslag fra e-post | 2a | minste | Henter ut faste felt. Bare falsk leverandør til spørsmål 58 er besvart. |
| Tale | 2b | (egen tale-leverandør) + minste | Tale blir tekst hos en annen leverandør (se Tale til tekst). Teksten ryddes etterpå. |
| Bilde | 2b | mellomste | Beskriver bilder. Bare falsk leverandør til spørsmål 55 er besvart. |
| Senere faser (sidemann-hjelp og videre) | 3a og senere | velges per funksjon | Mellomste som utgangspunkt, og evalueringssettet avgjør. |

KI lager bare forslag. Takstmannen godtar, endrer eller avviser, setter TG selv og signerer.

## Pris per rapport

Anslag. Mengdene er **oppdiktet** (ingen tall fra ekte rapporter). KI-tjenester tar betalt per «token», en tekstbit på noen få bokstaver. Én million tokens er omtrent en tykk bok.

Oppdiktet rapport: 40 språkvask, 30 forslag fra frasebanken, 2 oppsummeringer, 1 KI-sjekk og 1 ordreforslag. Til sammen ca. 117 000 tokens inn og 22 000 tokens ut.

Listepris hos Anthropic per million tokens (lest 11.11.2026, [anthropic.com/pricing](https://www.anthropic.com/pricing)), omregnet med 9,54 kr per dollar (Norges Bank, 11.11.2026):

| Klasse | Inn | Ut | Hvis alt i rapporten gikk på denne klassen |
|---|---|---|---|
| Minste | 0,10 $ (ca. 1 kr) | 0,50 $ (ca. 5 kr) | ca. **0,20 kr** per rapport |
| Mellomste | 2 $ (ca. 19 kr) | 10 $ (ca. 95 kr) | ca. **4,30 kr** per rapport |
| Største | 4 $ (ca. 38 kr) | 20 $ (ca. 191 kr) | ca. **8,70 kr** per rapport |

Med valget i tabellen over (blanding av klasser) blir det ca. **3,70 kr per rapport**, ca. 4 kr med EU-veien (10 % tillegg). Det finnes også en enda større og dyrere klasse, som ingen funksjon trenger nå. Nyere modeller deler norsk tekst i flere tokens, så regn med at det ekte tallet kan bli høyere; loggen i EzProp viser ekte kostnad per kall når KI er slått på. Prisene er uten mva. **Prisene og kursen må sjekkes på nytt før avtale.**

## Databehandleravtale

- Anthropics vilkår for bedriftskunder ([vilkår](https://www.anthropic.com/legal/commercial-terms), gjeldende fra 17.06.2025) har databehandleravtalen ([DPA](https://www.anthropic.com/legal/data-processing-addendum), gjeldende fra 24.02.2025) som en del av seg. For kunder i EØS er avtaleparten Anthropics selskap i Irland.
- Databehandleravtalen har EUs standard personvernklausuler som grunnlag når data går ut av EØS.
- Byggcon er behandlingsansvarlig. **Ståle godtar eller signerer avtalen for Byggcon.** Velges EU-veien gjennom Amazon eller Google, er det deres avtale som gjelder i tillegg.

## Trening og lagring

Dette er to forskjellige ting.

- **Trening:** vilkårene sier at Anthropic ikke trener modellene sine på det bedriftskunder sender inn eller får tilbake.
- **Lagring ved vanlig bruk:** Anthropic sletter det vi sender og får tilbake, innen 30 dager.
- **Flagget innhold:** blir noe flagget som brudd på bruksreglene, kan det ligge hos Anthropic i opptil 2 år.
- **Null-lagring** (ingenting lagres etter svaret) krever en egen avtale med Anthropic, og må bes om.
- ADR 0006 bygger på at leverandøren ikke lagrer noe ut over kallet. Det stemmer bare med null-lagring. **Enten avtales null-lagring, eller Ståle endrer forutsetningen** (spørsmål 73 b).

Kilder: [personvernsiden om lagring](https://privacy.anthropic.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) · [lagring og null-lagring](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention). Lest 11.11.2026.

## Tale til tekst

Anthropic gjør ikke tale om til tekst. Opptak kan ikke vaskes for navn og stemmer slik tekst kan (spørsmål 55). Ingenting bygges før fase 2b. Pris regnet med 20 minutter opptak per befaring (oppdiktet).

| Alternativ | EU/EØS | Avtale | Lagring | Pris per befaring |
|---|---|---|---|---|
| **Microsoft Azure tale** (Norge øst) | Ja, i Norge | Microsofts databehandleravtale for Azure, som Byggcon bruker fra før | Lagrer ikke lyden ved direkte omgjøring | 1 $ per time, ca. 3,20 kr |
| Google tale (europeisk region) | Ja | Ny avtale med Google | Velg varianten der Google ikke beholder lyd; den koster mer | 0,024 $ per minutt, ca. 4,60 kr |
| Nasjonalbibliotekets åpne talemodell (NB-Whisper) på egen server i Azure | Ja, i Byggcons egen Azure | Ingen ny leverandør | Bare hos Byggcon | Fast månedspris for en kraftig server, uansett bruk |

**Anbefaling: Microsoft Azure tale i Norge.** Byggcon er i Azure fra før, lyden behandles i Norge og lagres ikke, og prisen er lav. Nasjonalbibliotekets modell er reserven hvis norsk fagspråk blir for dårlig. Ståle velger (S8).

Kilder: [Azure tale, lagring](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security) · [Azure prisliste](https://prices.azure.com/api/retail/prices) · [Google pris](https://cloud.google.com/speech-to-text/pricing) · [NB-Whisper](https://huggingface.co/NbAiLab/nb-whisper-large). Lest 11.11.2026.

## Hva Ståle må gjøre

1. Velge EU/EØS-vei: Anthropic direkte (utenfor EØS) eller EU-region gjennom Amazon eller Google.
2. Godta eller signere databehandleravtalen for Byggcon (og avtalen med skyleverandøren hvis EU-veien velges).
3. Svare på spørsmål 54–58 og 73 i `docs/09-apne-sporsmal.md` (restrisiko i tekst, tale og bilde, oppbevaring, tall per person, e-post, null-lagring og personvern).
4. Vurdere forslag 64 (tak på KI-bruk per dag) før nøkkelen legges inn, så en feil ikke kan koste mye.
5. Legge nøkkelen inn som secret `ANTHROPIC_API_KEY` i GitHub. Aldri i chat, e-post eller repo.
6. Velge leverandør for tale til tekst (før fase 2b).

KI-tilkoblingen lages ikke for en organisasjon med ekte data før avtalen er på plass, EU/EØS-veien er valgt og spørsmålene er besvart. I testmiljøet med oppdiktede data kan Ståle slå den på når nøkkelen er lagt inn. Det koster penger og er hans valg. Ingen funksjon slås på før den har bestått evalueringssettet.

## Dette er usikkert

- Om Anthropic får et «bare EU»-valg senere. I dag er det bare «hvor som helst» og «bare USA».
- Anthropics sider sier to ting om lagring: personvernsiden sier sletting innen 30 dager, mens den tekniske siden sier at innhold ikke lagres som standard, unntatt for enkelte modeller som krever 30 dager. Dette må avklares med Anthropic.
- Om null-lagring er tilgjengelig for en liten kunde som Byggcon, og hva det koster.
- Om databehandleravtalen gjelder ved at vilkårene godtas på nett, eller om Anthropic krever en egen signert kopi.
- Hvilke modeller som finnes i hvilken EU-region hos Amazon og Google, og om alle klassene finnes der.
- Om lagring for misbrukskontroll hos Amazon og Google skjer i EU, og hvor lenge.
- Om Byggcons avtale med Microsoft for Azure også dekker tale til tekst. Må bekreftes.
- Hvor godt tale til tekst virker på norsk fagspråk og dialekt. Må prøves med oppdiktede opptak.
- Hva en egen server for Nasjonalbibliotekets modell koster per måned.
- Antall tokens per rapport. Tallene over er oppdiktet; ekte tall kommer fra loggen når KI er slått på i testmiljøet.
- Priser og valutakurs endrer seg.
