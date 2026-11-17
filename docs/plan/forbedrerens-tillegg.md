# Lagt til av forbedreren

Sist oppdatert: 17.11.2026

Her står alt forbedreren har fått bygget som ikke stod i planen (Ståle 14.11.2026, se «Forbedreren» i `CLAUDE.md`). Listen er til for Ståle: mot slutten av utviklingen går han gjennom den og beholder, justerer eller fjerner.

Én rad per tillegg, nyeste øverst. Prosjektlederen fører raden når tillegget tas inn, og fyller inn PR-nummeret når det er bygget.

| Dato | Tillegg (det den ansatte merker) | Hvorfor | Type | Hvor (PR, oppgavekort, kode) | Slik fjernes det | Ståle |
|---|---|---|---|---|---|---|
| 17.11.2026 | «Se hva KI fikk» under hvert KI-forslag, med «Skulle vært vasket» på ord som slapp gjennom | Takstmannen ser selv at persondata ikke sendes ut, og vasken blir bedre for hver bom | nytt planpunkt | `docs/07-utviklingsplan.md` fase 2a «Fra forbedreren»; ikke bygget ennå | Ta punktet ut av planen før bygging; etterpå: fjern knappen, kolonnen blir stående (ingenting slettes) | |
| 17.11.2026 | Vaskeresultatet per type i `pnpm ai:eval` (navn, e-post, telefon, adresse, matrikkel), aldri verdiene | Gjør vasken målbar før ekte KI slås på | i oppgaven | `docs/agenter/oppgaver/rett-vask-for-ki.md`, `src/core/ai/evals/`; PR fylles inn | Fjern sakene og tellingen per type fra kjøreren | |
| 17.11.2026 | Flere testsaker mot overvask (datoer, mål, romnummer, «Mo» alene) | Fagteksten KI får, beholder datoer og mål, så forslagene blir riktige | i oppgaven | `docs/agenter/oppgaver/rett-vask-for-ki.md`, `src/core/ai/redaction-cases-spellings.ts`; PR fylles inn | Ta ut sakene (det svekker bare testene) | |
| 17.11.2026 | Varianttest som går begge veier (vask og lekkasjesjekk) | Dekker skrivemåter testlaget ikke har kommet på ennå | i oppgaven | `docs/agenter/oppgaver/rett-vask-for-ki.md`, testen i `src/core/ai/`; PR fylles inn | Slett testfilen | |
| 17.11.2026 | Én felles liste over skrivemåter for vasken og lekkasjesjekken (`knownValueForms`), og normalisering i sjekken | Vasken og sjekken kan ikke gli fra hverandre igjen (årsaken til T-0094 og T-0110) | i oppgaven | `docs/agenter/oppgaver/rett-vask-for-ki.md`, `src/core/ai/known-value-forms.ts`; PR fylles inn | Lag formene hver for seg i `redact-text.ts` og `prompt-leaks.ts` igjen | |
| 16.11.2026 | «Forleng 30 dager» med ett trykk på utløpte tilbud og tilbud som går ut innen 7 dager | Forlengelse er det vanligste med et levende tilbud; slipper å finne datofeltet og regne dato på iPad | i oppgaven | `docs/funksjoner/fase2a-tilbud.md` F1 (A365), tilbudssiden og listen under `src/app/(ansatt)/tilbud/`; PR fylles inn | Fjern knappen og handlingen; datoen kan fortsatt endres under «Endre» | |
| 16.11.2026 | «Lagre som tilbud i stedet» på «Nytt oppdrag», og «Gjør om tilbudet» på dublettreff mot et åpent eller utløpt tilbud | Ingen avskrift, og samme jobb blir ikke registrert to ganger | i oppgaven | `docs/funksjoner/fase2a-tilbud.md` F2 (A363, A364), `src/app/(ansatt)/oppdrag/ny/`, `possible-duplicates-notice.tsx`; PR fylles inn | Fjern knappen og handlingen på «Nytt oppdrag» og knappen i varselet; varselet virker som før | |
| 16.11.2026 | Antall på filterknappene, «Åpne» sortert etter gyldig til, merket «Går ut om N dager» | Lederen ser hvilke mulige jobber som må følges opp denne uken | i oppgaven | `docs/funksjoner/fase2a-tilbud.md` F3 (A366), `src/core/orders` (telling, `offerDaysLeft`), `src/app/(ansatt)/tilbud/`; PR fylles inn | Fjern tellingen, merket og sorteringen etter dato; filtrene virker som før | |
| 16.11.2026 | Faste valg for avslagsgrunn (Pris, Tidspunkt passet ikke, Valgte en annen, Kunden trakk seg, Annet) | Raskere enn å skrive på iPad; «hvorfor taper vi tilbud» blir data for statistikk og KI | i oppgaven | `docs/funksjoner/fase2a-tilbud.md` F4 (A361), kolonnen `orders.rejected_reason_key` i migrering 0035, `src/core/orders/codes.ts`; PR fylles inn | Skjul valgene og la «Annet» være standard; kolonnen blir stående (ingenting slettes) | |
| 16.11.2026 | Kvitteringen etter «Gjør om til oppdrag» peker til takstmann og befaringsdato | Neste steg er alltid det samme; den ansatte slipper å lete | i oppgaven | `docs/funksjoner/fase2a-tilbud.md` F5 (A367); PR fylles inn | Sett kvitteringen tilbake til «Oppdraget er laget.» | |

Type: «i oppgaven» eller «nytt planpunkt». Kolonnen «Ståle» er tom til han har sett på raden: behold, juster eller fjern.
