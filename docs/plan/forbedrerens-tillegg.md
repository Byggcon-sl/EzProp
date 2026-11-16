# Lagt til av forbedreren

Sist oppdatert: 16.11.2026

Her står alt forbedreren har fått bygget som ikke stod i planen (Ståle 14.11.2026, se «Forbedreren» i `CLAUDE.md`). Listen er til for Ståle: mot slutten av utviklingen går han gjennom den og beholder, justerer eller fjerner.

Én rad per tillegg, nyeste øverst. Prosjektlederen fører raden når tillegget tas inn, og fyller inn PR-nummeret når det er bygget.

| Dato | Tillegg (det den ansatte merker) | Hvorfor | Type | Hvor (PR, oppgavekort, kode) | Slik fjernes det | Ståle |
|---|---|---|---|---|---|---|
| 16.11.2026 | Logg inn igjen i en dialog over skjemaet når innloggingen har gått ut. E-posten er fylt ut, og det som er skrevet står igjen | En lenke til innloggingssiden forlater siden og sletter verdiene; ny fane virker ikke i appen på iPad | i oppgaven | Oppgavekort `docs/agenter/oppgaver/rett-t0070-t0071.md` punkt 5; `src/app/logg-inn/sign-in-dialog.tsx`, `LoginForm` (`initialEmail`, `onSignedIn`); PR fylles inn | Fjern dialogen og bruk lenken `loginHref` i meldingen i stedet; ta bort de to egenskapene i `LoginForm` | |
| 16.11.2026 | Melding «Du er logget ut. Logg inn før du lagrer.» når siden får fokus igjen, og «Nettet er tilbake. Trykk Lagre.» når nettet kommer tilbake | Den ansatte oppdager utlogging før han skriver, og slipper å gjette når det er trygt å lagre i kjelleren | i oppgaven | Oppgavekort punkt 4, 6 og 10; `src/app/logg-inn/use-session-check.ts`, `src/shared/forms/guarded-form-action.ts`; PR fylles inn | Fjern `use-session-check.ts` og bruken i skjemaene; fjern lytteren på `online` i hjelperen | |
| 16.11.2026 | Feilsidene henter siden på nytt ved «Prøv igjen», sier fra når nettet er borte, har Byggcon-profilen også ved feil i rotoppsettet og store nok knapper for iPad | Uten dette kommer feilen straks tilbake, og siden ser ødelagt ut | i oppgaven | Oppgavekort punkt 9; `src/app/error.tsx`, `src/app/global-error.tsx`; PR fylles inn | Fjern `router.refresh()` og teksten uten nett fra feilsidene | |

Type: «i oppgaven» eller «nytt planpunkt». Kolonnen «Ståle» er tom til han har sett på raden: behold, juster eller fjern.
