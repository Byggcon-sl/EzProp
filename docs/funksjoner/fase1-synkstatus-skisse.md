# Skisse: Synkstatus som alltid vises (komponentspesifikasjon)

- **Oppgavekort:** `docs/funksjoner/fase1-synkstatus.md` (fasit for regler, tekster og tester)
- **Design:** A «Fjord». Mønsteret er `.sync`-pillen øverst i `docs/design/retning-A.html` («Alt er lagret», «Lagret 10:42») og `.sync.off` for uten nett.
- **Dato:** 29.10.2026
- **Støtter hovedmål:** reklamasjoner (takstmannen ser alltid om noe bare ligger på iPaden), tid (ett trykk i stedet for å vente opptil 60 sekunder). KI først: ikke direkte, se oppgavekortet.

## 1. Komponent

Én komponent, `SyncStatus`, i ny fil `src/modules/offline-trial/sync-status.tsx`. Den erstatter `SyncIndicator`, og `sync-indicator.tsx` slettes (testplanen er bindende for fil- og testnavn; prosjektleder 29.10.2026). Ingen ny komponent i `src/shared/ui`: knappen er `Button` (`variant="secondary"`, `size="lg"`). Ikoner er små inline-SVG med `aria-hidden="true"`. Ingen ny avhengighet.

Props:

```ts
interface SyncStatusProps {
  getStatus: () => Promise<TrialSyncStatus>;
  subscribe?: (onChange: () => void) => () => void;
  syncNow: () => Promise<TrialSyncRoundResult>;
  candidate: TrialSyncCandidate; // for localStorage-nøkkelen til «Lagret kl.»
}
```

## 2. Oppsett

Komponenten er hele den faste linjen øverst (sticky), på både testskjemaet og listen «Testskjema». På testskjemaet står «N av M felt utfylt» under den, i samme faste linje som i dag.

```
iPad og PC (bredde 640 px og mer), maks bredde som siden (max-w-3xl)
┌──────────────────────────────────────────────────────────────────┐
│ ▂▂▂▂ nordlysstripe (finnes fra før i layouten) ▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂ │
├──────────────────────────────────────────────────────────────────┤
│  ( ☁ Venter: 3 endringer, 2 bilder )            ┌─────────────┐  │
│  Lagret kl. 14:32                               │  ⟳ Synk nå  │  │  56 px høy
│                                                 └─────────────┘  │
│  Du er uten nett. Alt er lagret på iPaden og sendes når nettet   │  bare når det
│  kommer.                                                         │  finnes en beskjed
├──────────────────────────────────────────────────────────────────┤
│  12 av 20 felt utfylt                     (bare på testskjemaet) │
└──────────────────────────────────────────────────────────────────┘

Smalere enn 640 px (ikke målet, men skal ikke knekke): knappen legger seg
under teksten i full bredde.
```

Mål og klasser (Tailwind, tokens fra `globals.css`):

| Del | Mål |
|---|---|
| Linjen | `sticky top-0 z-10 -mx-4 px-4 py-3 bg-white/95 border-b border-slate-200` (som i dag). `flex items-center justify-between gap-4`, `flex-wrap` under 640 px |
| Tilstandspillen | `inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-base font-medium`. Tekst 16 px (større enn 13 px i skissen, fordi den leses på armlengdes avstand på iPad) |
| «Lagret kl.» | `mt-1 text-sm text-slate-600`, `tabular-nums` |
| «Synk nå» | `Button variant="secondary" size="lg"`: min. 56 px høy, `min-w-36` slik at bredden ikke hopper når teksten blir «Synker …» |
| Beskjed | `mt-2 text-sm text-slate-800`, egen rad under, full bredde |

## 3. Tilstander

Teksten bærer alltid betydningen; farge og ikon er bare tillegg (prinsipp 9, 10, 15). Kontrasten er målt på pillfargene fra skissen A.

| Tilstand | Tekst i pillen | Pillfarge (tekst / bakgrunn) | Ikon | Kontrast |
|---|---|---|---|---|
| Alt er lagret | «Alt er lagret» | `#155e3e` / `#d9f2e6` | sky med hake | ca. 7:1 |
| Noe venter | «Venter: 3 endringer, 2 bilder» | `brand-700` / `brand-50` | sky med pil opp | ca. 6,5:1 |
| Uten nett | «Uten nett» | `#6b4405` / `#fbe7b5` | sky med strek over | ca. 7:1 |
| Venter på kontakt med serveren | «Venter på kontakt med serveren» | `#334155` / `#e2e8f0` | sky | ca. 9:1 |
| Første lasting (status ikke lest ennå) | tom pill med samme høyde, ingen tekst | `#e2e8f0` | ingen | ikke relevant |

Uten nett skiller seg fra «Alt er lagret» med både tekst, ikon og farge (gul mot grønn).

Linje to («Lagret kl.»), tekst etter `savedAtText`:
- «Lagret kl. 14:32» · «Lagret 28.10. kl. 14:32» · «Ikke lagret på serveren ennå»

Knappen:

| Tilstand | Tekst | Utseende | Kan trykkes |
|---|---|---|---|
| Klar (med eller uten nett) | «Synk nå» | sekundær, ikon ⟳ | ja |
| Runde pågår | «Synker …» | sekundær, ikonet roterer (stopper ved `prefers-reduced-motion`) | nei (`disabled`), linjen får `aria-busy="true"` |

Knappen er aldri skjult og aldri grå uten nett: trykket skal gi beskjeden.

Beskjeden under linjen:

| Resultat av `syncNow` | Beskjed |
|---|---|
| `"offline"` | «Du er uten nett. Alt er lagret på iPaden og sendes når nettet kommer.» |
| `"failed"` | «Fikk ikke sendt. Prøver igjen automatisk.» |
| `"ok"` | ingen beskjed; pillen og «Lagret kl.» viser resultatet |

Beskjeden står til neste trykk på «Synk nå», eller til pillen viser «Alt er lagret». Ingen tidsbryter (enklere å teste, og ingen rekker ikke å lese den).

## 4. Universell utforming

- Linjen er et `<section aria-label="Synkstatus">`.
- Pillen har `role="status"` (høflig). Den endres bare når teksten endres, ikke ved hver avlesning hvert 2. sekund. «Lagret kl.» er utenfor det levende feltet, så skjermleseren ikke leser opp klokkeslettet ved hver runde.
- Beskjeden har et eget felt med `role="status"` / `aria-live="polite"` som alltid finnes i DOM (tomt når det ikke er noen beskjed), slik at opplesingen virker første gang.
- Knappen har synlig tekst, ingen ekstra `aria-label`. Fokusring fra `globals.css` (`outline-brand-600`).
- Ikonene har `aria-hidden="true"`.

## 5. Testkroker (`data-testid`)

| Del | `data-testid` |
|---|---|
| Hele linjen | `sync-status` |
| Pillen | `sync-status-state` (`indicator()` i `e2e/helpers.ts` peker hit) |
| «Lagret kl.» | `sync-status-saved-at` |
| Knappen | ingen; finnes med rollen og navnet «Synk nå» / «Synker …» |
| Beskjedfeltet | `sync-status-message` (`aria-live="polite"`) |

Navnene følger testplanen (`fase1-synkstatus-testplan.md`, K6), som er bindende.

## 6. Mørk visning

Mørk visning er ikke bygget ennå (kommer som eget valg). Komponenten bruker bare farger fra temaet og pillfargene over, slik at mørk variant kan legges til senere uten å endre oppsettet.

## 7. Bevisst utelatt

Liste over hva som venter, fremdriftslinje, feil per bilde, varsel etter lang tid uten synk, synktjenestene i Azure. Se oppgavekortet.

## 8. Antall trykk

Før: ingen måte å be om synk; vente opptil 60 sekunder. Etter: ett trykk. Anslaget i tid og trykk bekreftes av ux-ansvarlig.
