---
description: Finn og start neste oppgave i utviklingsplanen
---

1. Les `docs/agenter/tilstand.md`. Se i `docs/agenter/testlag/funn/` etter feil med alvor «alvorlig» og status «ny». Finnes det noen, er den eldste av dem neste oppgave (høyst tre slike per kjøring).
2. Ellers: les `docs/07-utviklingsplan.md`. Gjeldende fase står under «Status nå». Ta første uavkryssede punkt i fasen, ovenfra og ned. Hopp over det som står under «Venter på Ståle» (S1–S8) og deler merket «venter på S…».
3. Sjekk `docs/09-apne-sporsmal.md` for spørsmål som blokkerer oppgaven. Hvis noe blokkerer: si hva, og velg neste punkt som ikke er blokkert.
4. Kjør arbeidsflyten `oppgave` (`.claude/workflows/oppgave.js`) med oppgaven som `args`: `{ "task": "<punktet fra planen, eller «Rett funn T-…: <tittel>»>", "phase": "<fase>", "branch": "<kort-navn>" }`.
5. Oppdater `docs/agenter/tilstand.md`, kryss av i planen (eller sett funnet til «rettet» med PR-nummer), og lever som pull request med `docs/maler/pr.md`. Etter merge flyttes det leverte punktet til `docs/plan/levert.md`.
