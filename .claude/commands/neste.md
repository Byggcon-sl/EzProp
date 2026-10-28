---
description: Finn og start neste oppgave i utviklingsplanen
---

1. Les `docs/agenter/tilstand.md` og `docs/07-utviklingsplan.md`. Finn første fase som ikke er ferdig, og første uavkryssede punkt i den.
2. Sjekk `docs/09-apne-sporsmal.md` for spørsmål som blokkerer oppgaven. Hvis noe blokkerer: si hva, og velg neste punkt som ikke er blokkert.
3. Kjør arbeidsflyten `oppgave` (`.claude/workflows/oppgave.js`) med oppgaven som `args`: `{ "task": "<punktet fra planen>", "phase": "<fase>", "branch": "<kort-navn>" }`.
4. Oppdater `docs/agenter/tilstand.md`, kryss av i planen, og lever som pull request med `docs/maler/pr.md`.
