# Beslutningsnotat: KI-leverandør (S8)

Til: Ståle · Dato: 11.11.2026 · Leverandør valgt: Anthropic (Ståle 10.11.2026)
Støtter hovedmålene: KI i bunnen (ekte KI bak den ene KI-porten), best for de ansatte (bedre forslag) og færre reklamasjoner (hver funksjon må bestå evalueringssettet før den slås på).

## 1. Behandles dataene i EU/EØS?

**Nei, ikke hvis vi bruker Anthropic direkte.** Da behandles teksten i USA eller i andre land der Anthropic har kapasitet, og den lagres i USA. Anthropic tilbyr i dag bare valgene «hvor som helst» og «bare USA», ikke EU. Microsoft (Azure, der testmiljøet vårt ligger) tilbyr de samme modellene bare som «hvor som helst» eller «bare USA». **Vil du ha behandlingen i EU, må det gå gjennom Amazon (AWS) eller Google**, som begge selger Anthropics modeller med EU-region, mot om lag 10 % høyere pris. Da blir Amazon eller Google databehandleren vår, og vi trenger konto og avtale der. Koden vi har laget, går mot Anthropic direkte; en EU-vei er en ny tilkobling bak den samme KI-porten, ikke en ombygging.

Kilder (lest 11.11.2026): Anthropic om [hvor dataene behandles](https://docs.anthropic.com/en/docs/build-with-claude/data-residency) og [hvor serverne står](https://privacy.anthropic.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers); Amazon om [regionvalg](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html); Google om [modellene i Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude).

**Dette er usikkert** (må bekreftes i avtaletekst eller svar fra leverandøren):

- Om de nyeste modellene finnes i EU-region hos Amazon og Google. Hos Amazon mangler EU for noen av de nyeste.
- Om Amazons «EU»-region kan sende data til London (utenfor EØS, men med godkjent overføringsgrunnlag).
- Om null-lagring (se del 5) kan avtales for en liten kunde, og hva det koster.
- Om Anthropic, Amazon eller Google kan lese innhold ved mistanke om misbruk, og i hvilket land det skjer.
- Om valget av EU-region gjelder alt, også sikkerhetskopier og logger hos leverandøren.

## 2. Hvilken modell til hvilken funksjon

Anthropic har modeller i tre størrelser. Den minste er billig og rask, den største er best til vanskelige vurderinger. Navnene og den nøyaktige modellen står bare i innstillingene, ikke her, fordi de skiftes ofte. Regelen er: start med den minste som består evalueringssettet.

| Funksjon | Størrelse | Hvorfor |
|---|---|---|
| Språkvask av notater | mellomste | God norsk er viktigst; korte tekster |
| Forslag fra frasebanken | minste | Velger blant godkjente fraser, skriver ikke selv |
| Utkast til oppsummering og sammendrag | mellomste | Skal samle mange funn riktig |
| KI-sjekk før publisering | største | Leser hele rapporten og finner motstrid; brukes én gang per rapport; viktigst mot reklamasjoner |
| Ordreforslag fra e-post | minste | Henter ut felt fra en kort tekst (venter på spørsmål 58) |
| Tale (fase 2b) | ingen | Anthropic gjør ikke tale til tekst, se del 6. Teksten etterpå behandles som språkvask |
| Bilde (fase 2b) | mellomste | Kan beskrive bilder; venter på spørsmål 55 |
| Senere faser (sidemannshjelp med mer) | mellomste | Største bare der evalueringen viser at det trengs |

I dag velges én modell for hele tilkoblingen. Ulik modell per funksjon lages først når evalueringen viser at det lønner seg.

## 3. Pris per rapport

Anthropic tar betalt per million tekstbiter (en tekstbit er en del av et ord), med egen pris for tekst inn og tekst ut. Prisene er fra [Anthropics prisliste](https://docs.anthropic.com/en/docs/about-claude/pricing), lest 11.11.2026, i dollar per million tekstbiter: minste 0,10 inn og 0,50 ut, mellomste 2 inn og 10 ut, største 4 inn og 20 ut. Regnet med 11 kroner per dollar. **Prisene og kursen må sjekkes på nytt før avtale.**

Mengdene under er **oppdiktede anslag** for én rapport, ikke tall fra ekte rapporter:

| Funksjon | Ganger | Tekstbiter inn / ut per gang | Størrelse | Kroner |
|---|---|---|---|---|
| Språkvask | 30 | 1 000 / 300 | mellomste | 1,65 |
| Frasebank | 30 | 2 000 / 200 | minste | 0,10 |
| Oppsummering | 1 | 15 000 / 1 000 | mellomste | 0,44 |
| KI-sjekk | 2 | 20 000 / 2 000 | største | 2,64 |
| Ordreforslag | 1 | 3 000 / 500 | minste | 0,01 |
| **Sum** | | | | **om lag 5 kr** |

Alt på den største: om lag 11 kr. Alt på den minste: under 50 øre. EU-vei via Amazon eller Google: legg til om lag 10 %. Tale kommer i tillegg: 20 minutters opptak koster om lag 3–4 kr (del 6). Forslag 64 (tak på KI-bruk) hindrer at en feil gir en stor regning.

## 4. Databehandleravtale

Det som må på plass før ekte data sendes:

- **Vilkårene for bedriftskunder** (Commercial Terms) hos Anthropic, eller hos Amazon eller Google hvis du velger EU-vei.
- **Databehandleravtalen** (DPA) hos den samme leverandøren. Hos Anthropic er den en del av bedriftsvilkårene: [vilkår](https://www.anthropic.com/legal/commercial-terms) og [databehandleravtale](https://www.anthropic.com/legal/data-processing-addendum).
- **Grunnlag for overføring ut av EØS** hvis du velger Anthropic direkte. Anthropics databehandleravtale har EUs standardavtaler med; det må vurderes om de holder for oss (overføringsvurdering).
- Listen over underleverandører må leses.

**Du må signere** (eller godta vilkårene i kontoen). Agentene gjør ikke det.

## 5. Trening og lagring er to ulike ting

- **Trening:** Anthropic bruker ikke tekst fra bedriftskunder til å trene modellene, med mindre vi selv sender inn tilbakemelding eller sier ja til det ([kilde](https://privacy.anthropic.com/en/articles/7996868-is-my-data-used-for-model-training), lest 11.11.2026).
- **Lagring:** «trener ikke» betyr ikke «lagrer ikke». Ved vanlig bruk slettes tekst inn og ut innen 30 dager. Tekst som flagges for misbruk, kan ligge i opptil to år. Det kan også lagres lenger når loven krever det ([kilde](https://privacy.anthropic.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), lest 11.11.2026).
- **Null-lagring** krever en egen avtale som Anthropic må godkjenne ([kilde](https://privacy.anthropic.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)).

ADR 0006 sier at leverandøren «lagrer ingenting ut over kallet». Det stemmer ikke med vanlig bruk. **Enten avtales null-lagring, eller du endrer forutsetningen** (for eksempel til «slettes innen 30 dager»). Navn, adresse og lignende vaskes bort før noe sendes uansett.

## 6. Norsk tale til tekst

Anthropic tilbyr ikke tale til tekst. Et opptak kan ikke vaskes for navn slik tekst kan (spørsmål 55). Tre alternativer:

| | Microsoft (Azure) | Google Cloud | Eget oppsett med Nasjonalbibliotekets norske talemodell |
|---|---|---|---|
| EU/EØS | Ja, Sverige (samme sted som testmiljøet) | Ja, EU-region | Ja, på vår egen server i Azure |
| Databehandleravtale | Microsofts, som vi har fra før | Googles, ny konto og avtale | Ingen ny; ingen ekstern part hører opptaket |
| Lagring | Må bekreftes i Microsofts vilkår | Må velge «uten logging hos Google» | Bare hos oss |
| Pris (lest 11.11.2026) | om lag 1 dollar per time opptak | om lag 1 dollar per time | Fast pris for en server med grafikkort, også når den står ubrukt |

**Anbefaling:** Microsoft (Azure) i Sverige. Det er samme leverandør og region som resten, norsk bokmål støttes, og det trengs ingen ny avtale. Prøv kvaliteten på dialekt før valget. **Du velger (S8).** Ingenting bygges før fase 2b. Kilder: [Microsoft, språk](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=stt), [Google, pris](https://cloud.google.com/speech-to-text/pricing), [Nasjonalbiblioteket, talemodell](https://huggingface.co/NbAiLab/nb-whisper-large).

## 7. Hva du må gjøre, i denne rekkefølgen

1. **Velg EU/EØS-vei:** Anthropic direkte (ut av EØS) eller Amazon eller Google med EU-region.
2. **Signer** vilkårene og databehandleravtalen hos den du valgte.
3. **Svar på spørsmål 54–58 og 73** i `docs/09-apne-sporsmal.md` (restrisiko, tale og bilde, oppbevaring, tall per person, e-post og personvern).
4. **Vurder forslag 64** (tak på KI-bruk). Det anbefales før nøkkelen legges inn.
5. **Legg nøkkelen inn** i GitHub under Secrets med navnet `ANTHROPIC_API_KEY`. Aldri i chat eller e-post. Oppskrift: `docs/drift/testmiljo-azure.md`.
6. **Velg leverandør for tale til tekst** (del 6).

Til alt dette er på plass, kobles Anthropic ikke til for en organisasjon med ekte data. I testmiljøet, med oppdiktede data, kan du slå det på før: det koster penger, og det er ditt valg. Nøkkelen alene slår ikke på noe; en admin må også lage tilkoblingen og slå på KI.
