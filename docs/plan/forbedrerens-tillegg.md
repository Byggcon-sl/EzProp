# Lagt til av forbedreren

Sist oppdatert: 16.11.2026

Her står alt forbedreren har fått bygget som ikke stod i planen (Ståle 14.11.2026, se «Forbedreren» i `CLAUDE.md`). Listen er til for Ståle: mot slutten av utviklingen går han gjennom den og beholder, justerer eller fjerner.

Én rad per tillegg, nyeste øverst. Prosjektlederen fører raden når tillegget tas inn, og fyller inn PR-nummeret når det er bygget.

| Dato | Tillegg (det den ansatte merker) | Hvorfor | Type | Hvor (PR, oppgavekort, kode) | Slik fjernes det | Ståle |
|---|---|---|---|---|---|---|
| 16.11.2026 | «Gå til feltet» på hver linje under «Hvorfor» i regelforslaget: ett trykk viser feltet verdien kom fra. | Grunnlaget sjekkes før Godta på TG3; færre reklamasjoner. | i oppgaven | `docs/funksjoner/fase2a-badet-pc.md`, A389, `RuleSuggestionCard` | Gjør linjene til vanlig tekst igjen. | |
| 16.11.2026 | «Fjern avviket» / «Behold avviket» når et regelforslag ikke lenger gjelder og et godtatt avvik henger på det. Ingenting skjer uten trykk. | Avvik som henger igjen etter en retting gir feil TG; færre reklamasjoner. | i oppgaven | `docs/funksjoner/fase2a-badet-pc.md`, A388, `RuleSuggestionCard` (`stale`) og `warningFix` | Fjern de to knappene; advarselen og lenken «Gå til avvik» står som før. | |
| 16.11.2026 | «Skriv det du ser»: takstmannen beskriver avviket med egne ord, og KI viser opptil tre passende utfall fra malen å velge mellom (aldri TG, aldri forhåndsvalgt). | KI i bunnen og de ansatte: egne ord inn, malens strukturerte avvik ut. | nytt planpunkt | Plan 2a-2 «Fra forbedreren», A384 | Stryk planpunktet; tekstsøket i «+ Avvik» blir igjen. | |
| 16.11.2026 | Tastatursnarveier på PC: Ctrl/Cmd+Enter ferdig med punktet, Alt+↑/↓ forrige/neste punkt (utenfor tekstfelt), Ctrl/Cmd+K avvikssøk, «?» viser listen. | Den som skriver ferdig på PC slipper musa. | i oppgaven | `docs/funksjoner/fase2a-badet-pc.md`, A383, branch `badet-pc` | Fjern tastaturlytteren og snarveilisten på badets skjerm. | |
| 16.11.2026 | Søk etter avvik i «+ Avvik»: skriv «bom» og få alle utfall i badet som passer, med punktnavn; valg lager avviket på riktig punkt. | Takstmannen trenger ikke vite hvilket punkt utfallet ligger under. | i oppgaven | `docs/funksjoner/fase2a-badet-pc.md`, A382, `AddDeviationPanel` | Fjern søkefeltet i `AddDeviationPanel`. | |
| 16.11.2026 | «Rett nå»-knapp på advarsler med én opplagt retting, og «x å se over – gå til neste» i punktlisten. | Mangler rettes i stedet for bare å vises; færre reklamasjoner og raskere sluttsjekk. | i oppgaven | `docs/funksjoner/fase2a-badet-pc.md`, A381, branch `badet-pc` | Fjern knappene og telleren; advarslene står som før. | |
| 16.11.2026 | Begrunnelse med ett trykk ved Endre og Avvis av et regelforslag (faste grunner, fritekst bare ved «Annet»). | Ett trykk i stedet for en setning; statistikk over hvilke regler som overstyres og hvorfor. | i oppgaven | `docs/funksjoner/fase2a-badet-pc.md`, A380, `rule_suggestion_decisions.override_reason_code` | Skjul knappene og krev fritekst igjen; kolonnen står (faste koder arkiveres, regel 6). | |

Type: «i oppgaven» eller «nytt planpunkt». Kolonnen «Ståle» er tom til han har sett på raden: behold, juster eller fjern.
