# Resultat: Prøve E – regler uten nett på ekte iPad

- **Oppgavekort:** `docs/funksjoner/fase1-prove-e-regler.md` (pkt. 7)
- **Testplan:** `docs/funksjoner/fase1-prove-e-regler-testplan.md` (avsnitt 6)
- **Fylles ut av:** Ståle
- **Støtter hovedmål:** Reklamasjoner (viser at iPaden gir samme svar som serveren og de automatiske testene, også uten nett). Tid (svaret kommer under feltet uten nett og uten ekstra trykk).

De automatiske testene kjører i Chromium på PC. Denne malen er for prøven i Safari på ekte iPad i flymodus. Tabellen har de samme testsakene som dataene i `src/modules/offline-trial/rules/trial-rule-cases.ts`. En automatisk test passer på at malen og dataene er like.

Tallene i reglene (7 år og 42 %) er **oppdiktede prøveverdier**, ikke fag. Svaret sier bare om verdien er over prøvegrensen eller ikke. Det er ingen tilstandsgrad og ingen vurdering.

## Før du starter

| | Fyll inn |
|---|---|
| iPad-modell | |
| iPadOS-versjon | |
| Safari-versjon | |
| Versjon av appen (fra `/api/helse`) | |
| Dato | |

## Trinn

1. Med nett: logg inn i testmiljøet på iPaden og åpne **Testskjema**.
2. Trykk **Nytt testskjema**. Vent til skjemaet er åpent.
3. Slå på **flymodus** (sveip ned fra øvre høyre hjørne, trykk på flyet). Sjekk at wifi også er av.
4. Finn feltet **Berederens alder**. Skriv inn verdien fra kolonnen «Inndata» for første sak (uten anførselstegnene). «» betyr at feltet skal være tomt.
5. Les linjen rett under feltet. Den starter med «Prøveregel:». Sammenlign med kolonnen «Forventet».
6. Kryss av i «Riktig» hvis svaret er likt. Er det ulikt, skriv hva som sto i «Merknad».
7. Slett det som står i feltet, og gjør det samme for neste sak.
8. Gjør det samme for feltet **Fuktmåling gulv** med de neste sakene.
9. Slå av flymodus når du er ferdig.

Du skal ikke trenge å trykke noe annet sted enn i feltet for å se svaret.

## Testsakene

«Forventet» betyr hva linjen under feltet skal si etter «Prøveregel:»:

- **over prøvegrensen**: «Prøveregel: over prøvegrensen (7 år)» eller «(42 %)»
- **ikke over prøvegrensen**: «Prøveregel: ikke over prøvegrensen (7 år)» eller «(42 %)»
- **ikke vurdert**: «Prøveregel: ikke vurdert»

| Felt (regel) | Testsak | Inndata | Forventet | Riktig | Merknad |
|---|---|---|---|---|---|
| Berederens alder (`trial_water_heater_age`) | tomt felt | «» | ikke vurdert | [ ] | |
| Berederens alder (`trial_water_heater_age`) | null | «0» | ikke over prøvegrensen | [ ] | |
| Berederens alder (`trial_water_heater_age`) | under | «6» | ikke over prøvegrensen | [ ] | |
| Berederens alder (`trial_water_heater_age`) | lik grensen | «7» | ikke over prøvegrensen | [ ] | |
| Berederens alder (`trial_water_heater_age`) | rett over (komma) | «7,5» | over prøvegrensen | [ ] | |
| Berederens alder (`trial_water_heater_age`) | negativt tall | «-1» | ikke vurdert | [ ] | |
| Berederens alder (`trial_water_heater_age`) | ugyldig tekst | «12,» | ikke vurdert | [ ] | |
| Fuktmåling gulv (`trial_moisture_floor_limit`) | tomt felt | «» | ikke vurdert | [ ] | |
| Fuktmåling gulv (`trial_moisture_floor_limit`) | null | «0» | ikke over prøvegrensen | [ ] | |
| Fuktmåling gulv (`trial_moisture_floor_limit`) | under (komma) | «41,9» | ikke over prøvegrensen | [ ] | |
| Fuktmåling gulv (`trial_moisture_floor_limit`) | lik grensen | «42» | ikke over prøvegrensen | [ ] | |
| Fuktmåling gulv (`trial_moisture_floor_limit`) | rett over (punktum) | «42.01» | over prøvegrensen | [ ] | |
| Fuktmåling gulv (`trial_moisture_floor_limit`) | negativt tall | «-1» | ikke vurdert | [ ] | |
| Fuktmåling gulv (`trial_moisture_floor_limit`) | ugyldig tekst | «1e3» | ikke vurdert | [ ] | |

Tips: iPad-tastaturet for tall kan mangle minus eller punktum. Bruk da det vanlige tastaturet (trykk «123»).

## Til slutt

| Spørsmål | Svar |
|---|---|
| Ga alle 14 sakene forventet svar? (ja / nei) | |
| Kom svaret uten å trykke noe annet enn i feltet? (ja / nei) | |
| Ble linjen under feltet lest opp med VoiceOver når den endret seg? (ja / nei / ikke prøvd) | |
| Annet du la merke til | |

Ikke skriv kundeopplysninger, adresser eller ekte måleverdier i denne malen.
