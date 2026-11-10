# Rutiner

Sist oppdatert: 10.11.2026. Hovedløkken og nattløkken ble laget 28.10.2026, testlaget 10.11.2026 (Ståle i chat samme dag). Hver rutine starter en ny sesjon i skymiljøet. Hovedløkken og nattløkken merker seg med taggen `ezprop-utvikling`, testlaget med `ezprop-testlag`. **Promptene ligger på selve rutinene** (https://claude.ai/code/routines), ikke i denne filen.

**Rutinene stoppet 07.–09.11.2026.** Hovedløkken (fra 07.11. kl. 01:42) og nattløkken (fra 09.11.) ble slått av automatisk fordi de ikke fikk tilgang til repoet («auto_disabled_repo_access»). Ingen merket det før 10.11.2026. Skjer det igjen: følg stegene under «Hvis en rutine stopper med tilgangsfeil». Testlag-rutinen ser etter dette hver natt og sender ett varsel hvis en rutine er slått av.

| Rutine | ID | Når | Første kjøring |
|---|---|---|---|
| EzProp hovedløkke | `trig_01PjEi1FmH6JzevEdpMoX7hp` | annenhver time, minutt 42 (`42 */2 * * *`, UTC) | 28.10.2026 kl. 13:42 norsk tid |
| EzProp nattløkke | `trig_01HAksdUvEXW6rRLmPVraJMN` | hver natt kl. 02:17 norsk tid | 29.10.2026 |
| EzProp testlag | `trig_01VfKX9eekLiJsttZZCCGHd6` | hver natt kl. 03:46 norsk tid (full kjøring natt til søndag) | 11.11.2026 |

## Hvis en rutine stopper med tilgangsfeil

Rutinene kan ikke gi seg selv tilgang til GitHub eller sesjonsverktøyene. Det settes på selve rutinen i Claude, av Ståle:
1. Gå til https://claude.ai/code/routines og klikk på «EzProp hovedløkke».
2. Klikk menyen ved siden av navnet og velg **Edit** (Rediger). Dialogen «Edit scheduled task» åpner seg.
3. Åpne **Advanced settings** (Avanserte innstillinger). På fanen **General**: under **Repository**, velg `Byggcon-sl/EzProp`. Under **Cloud environment** som dukker opp, velg «Byggcon».
4. Gå til fanen **Connectors** og sørg for at «Claude Code Remote» er med (den gir sesjonsverktøyene). Microsoft 365 og de andre kan tas bort.
5. Klikk **Save changes** nederst.
6. Gjør det samme for «EzProp nattløkke» og «EzProp testlag». Er rutinen slått av, slå den på igjen med bryteren på rutinens side.
7. Prøv: klikk **Run now** på hovedløkkens side. Kjøringen dukker opp under **History**; klikk på den for å se hva den gjorde.

Rutinene kan pauses, endres eller slettes i Claude under «Routines». Sesjonene de starter, har ikke SharePoint-koblingen; det de trenger, ligger i repoet.

## Hva Ståle kan gjøre

- Følge med i Claude under «Routines» og i GitHub (PR-er).
- Øke «Dynamic workflow size» i `/config` hvis flere enn ca. 10 agenter skal kjøre samtidig.
- Pause rutinene hvis noe går galt. Tilstanden ligger alltid i `docs/agenter/tilstand.md`.
