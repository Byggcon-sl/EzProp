/*
 * Testsakene for normaliseringen i regelen for mulig dublett (T3), delt mellom den rene testen
 * (`src/core/orders/duplicates.test.ts`, testplanen 1.1 og 1.2) og paritetstesten mot SQL
 * (`src/core/orders/duplicates-parity.test.ts`, testplanen 2). Oppdiktede adresser.
 */

/** [inndata, forventet nøkkel]. `null` = ingen nøkkel, gir aldri treff. */
export const ADDRESS_CASES: readonly (readonly [string, string | null])[] = [
  // 1.1.1 ulik skrivemåte gir samme nøkkel
  ["Storgata 1A, 8006 Bodø", "storgata1a"],
  ["storgata 1 a", "storgata1a"],
  ["Storgata 1a", "storgata1a"],
  ["STORGATA 1-A.", "storgata1a"],
  // 1.1.2 med og uten postnummer
  ["Storgata 1A", "storgata1a"],
  ["Storgata 1A, 8006", "storgata1a"],
  // 1.1.3 bare delen før første komma
  ["Storgata 1A, H0101, 8006 Bodø", "storgata1a"],
  // 1.1.4 uten komma brukes i sin helhet
  ["Testveien 12 8000 Bodø", "testveien128000bodø"],
  // 1.1.5 og 1.1.6 æ, ø og å beholdes og gjøres små
  ["Øvre gate 2", "øvregate2"],
  ["ØVRE GATE 2", "øvregate2"],
  ["øvre gate 2", "øvregate2"],
  ["Ovre gate 2", "ovregate2"],
  ["Ærfuglveien 3", "ærfuglveien3"],
  ["Åsveien 4, 8000 Bodø", "åsveien4"],
  // 1.1.7 tom nøkkel
  ["", null],
  ["   ", null],
  [",", null],
  [" , 8006 Bodø", null],
  ["-.", null],
  // 1.1.8 ulik husbokstav eller nummer
  ["Storgata 1B", "storgata1b"],
  ["Storgata 11", "storgata11"],
  ["Storgata 1", "storgata1"],
];

/** [inndata, forventet normalisert nummer]. `null` = ikke utfylt. */
export const CADASTRE_NUMBER_CASES: readonly (readonly [string | null, string | null])[] = [
  // 1.2.1
  ["012", "12"],
  ["12", "12"],
  [" 12 ", "12"],
  // 1.2.2
  ["1 2", "12"],
  ["0 12", "12"],
  ["120", "120"],
  ["9999", "9999"],
  // 1.2.3 ikke utfylt
  [null, null],
  ["", null],
  ["  ", null],
  ["0", null],
  ["000", null],
];

/*
 * Dublett på tvers av ordre og oppdrag (testplan for «Nytt oppdrag» 2, ADR 0011). Brukes av
 * `src/core/assignments/booking/duplicates-cross-table.test.ts`: hver sak kjøres gjennom en ren
 * modell av regelen og gjennom spørringen i databasen, og begge skal gi forventet svar i samme
 * rekkefølge (nyeste mottatt først). Mottakstidene er ulike i hver sak, så rekkefølgen er entydig.
 * Oppdiktede adresser og matrikler.
 */

/** En rad i saken. `daysAgo` er døgn (× 24 timer) før testens «nå». */
export type CrossTableRow = {
  key: string;
  kind: "order" | "assignment";
  address: string;
  gnr?: string | null;
  bnr?: string | null;
  snr?: string | null;
  /** Ordre: `received` (standard), `rejected` eller `converted`. Oppdrag: standard `ordered`. */
  status?: string;
  daysAgo?: number;
  /** Mykt slettet (for oppdrag: kansellert). */
  deleted?: boolean;
  /** Oppdrag laget fra ordren med denne nøkkelen (ordren blir `converted`). */
  fromOrder?: string;
};

/** Hva det slås opp for: et skjema som ikke er lagret, eller en lagret rad i saken. */
export type CrossTableTarget =
  | {
      kind: "draft";
      address: string | null;
      gnr?: string | null;
      bnr?: string | null;
      snr?: string | null;
      daysAgo?: number;
    }
  | { kind: "order" | "assignment"; key: string };

/** [navn, rader, mål, forventede treff som [nøkkel, grunner]]. */
export type CrossTableCase = readonly [
  string,
  readonly CrossTableRow[],
  CrossTableTarget,
  readonly (readonly [string, readonly ("address" | "cadastre")[]])[],
];

const TESTVEIEN = "Testveien 12, 8000 Bodø";
const PROVEGATA = "Prøvegata 3, 8006 Bodø";

export const CROSS_TABLE_CASES: readonly CrossTableCase[] = [
  // 2.1 oppdrag mot ordre
  [
    "2.1 nytt oppdrag (utkast) med samme adresse som en åpen ordre: ett treff, ordren",
    [{ key: "o1", kind: "order", address: TESTVEIEN, daysAgo: 1 }],
    { kind: "draft", address: "testveien 12" },
    [["o1", ["address"]]],
  ],
  [
    "2.1 lagret oppdrag uten ordre ser en åpen ordre med samme adresse",
    [
      { key: "o1", kind: "order", address: TESTVEIEN, daysAgo: 1 },
      { key: "a1", kind: "assignment", address: "Testveien 12", daysAgo: 0 },
    ],
    { kind: "assignment", key: "a1" },
    [["o1", ["address"]]],
  ],
  // 2.2 oppdrag mot oppdrag
  [
    "2.2 oppdrag mot oppdrag, samme adresse",
    [
      { key: "a1", kind: "assignment", address: "Prøvegata 3", daysAgo: 2 },
      { key: "a2", kind: "assignment", address: PROVEGATA, daysAgo: 0 },
    ],
    { kind: "assignment", key: "a2" },
    [["a1", ["address"]]],
  ],
  [
    "2.2 oppdrag mot oppdrag, ulik adresse og samme gnr/bnr: samme matrikkel",
    [
      { key: "a1", kind: "assignment", address: "Prøvegata 3", gnr: "9001", bnr: "1", daysAgo: 2 },
      { key: "a2", kind: "assignment", address: "Annenvei 4", gnr: "09001", bnr: "1", daysAgo: 0 },
    ],
    { kind: "assignment", key: "a2" },
    [["a1", ["cadastre"]]],
  ],
  [
    "2.2 samme adresse og matrikkel gir én rad med begge grunnene",
    [
      { key: "a1", kind: "assignment", address: TESTVEIEN, gnr: "9001", bnr: "1", daysAgo: 3 },
      { key: "o1", kind: "order", address: TESTVEIEN, gnr: "9001", bnr: "1", daysAgo: 2 },
    ],
    { kind: "draft", address: TESTVEIEN, gnr: "9001", bnr: "1" },
    [
      ["o1", ["address", "cadastre"]],
      ["a1", ["address", "cadastre"]],
    ],
  ],
  // 2.3 ordre mot oppdrag
  [
    "2.3 en åpen ordre ser et oppdrag laget direkte",
    [
      { key: "a1", kind: "assignment", address: TESTVEIEN, daysAgo: 4 },
      { key: "o1", kind: "order", address: TESTVEIEN, daysAgo: 0 },
    ],
    { kind: "order", key: "o1" },
    [["a1", ["address"]]],
  ],
  // 2.4 seg selv
  [
    "2.4 et oppdrag gir aldri treff på seg selv",
    [{ key: "a1", kind: "assignment", address: TESTVEIEN, gnr: "9001", bnr: "1" }],
    { kind: "assignment", key: "a1" },
    [],
  ],
  [
    "2.4 en ordre gir aldri treff på seg selv",
    [{ key: "o1", kind: "order", address: TESTVEIEN, gnr: "9001", bnr: "1" }],
    { kind: "order", key: "o1" },
    [],
  ],
  // 2.5 oppdrag fra ordre
  [
    "2.5 ordren (gjort om) og oppdraget gir ett treff til en tredje, oppdraget",
    [
      { key: "o1", kind: "order", address: TESTVEIEN, status: "converted", daysAgo: 5 },
      { key: "a1", kind: "assignment", address: TESTVEIEN, fromOrder: "o1", daysAgo: 5 },
    ],
    { kind: "draft", address: TESTVEIEN },
    [["a1", ["address"]]],
  ],
  [
    "2.5 fra oppdraget gir ordren det kom fra ikke treff",
    [
      { key: "o1", kind: "order", address: TESTVEIEN, status: "converted", daysAgo: 5 },
      { key: "a1", kind: "assignment", address: TESTVEIEN, fromOrder: "o1", daysAgo: 5 },
    ],
    { kind: "assignment", key: "a1" },
    [],
  ],
  [
    "2.5 fra ordren (gjort om) gir oppdraget den ble til ikke treff",
    [
      { key: "o1", kind: "order", address: TESTVEIEN, status: "converted", daysAgo: 5 },
      { key: "a1", kind: "assignment", address: TESTVEIEN, fromOrder: "o1", daysAgo: 5 },
      { key: "a2", kind: "assignment", address: TESTVEIEN, daysAgo: 1 },
    ],
    { kind: "order", key: "o1" },
    [["a2", ["address"]]],
  ],
  // 2.6 kansellert og avvist
  [
    "2.6 kansellert oppdrag og avvist ordre teller ikke",
    [
      { key: "a1", kind: "assignment", address: TESTVEIEN, deleted: true, daysAgo: 1 },
      { key: "o1", kind: "order", address: TESTVEIEN, status: "rejected", daysAgo: 2 },
    ],
    { kind: "draft", address: TESTVEIEN },
    [],
  ],
  // 2.7 mykt slettet
  [
    "2.7 mykt slettet ordre og oppdrag teller ikke",
    [
      { key: "o1", kind: "order", address: TESTVEIEN, deleted: true, daysAgo: 1 },
      { key: "a1", kind: "assignment", address: TESTVEIEN, status: "completed", deleted: true },
    ],
    { kind: "draft", address: TESTVEIEN },
    [],
  ],
  // 2.8 grensen på 90 døgn (A291)
  [
    "2.8 ferdig oppdrag 89 og 90 døgn før gir treff, 91 gir ikke",
    [
      { key: "a89", kind: "assignment", address: TESTVEIEN, status: "completed", daysAgo: 89 },
      { key: "a90", kind: "assignment", address: TESTVEIEN, status: "invoiced", daysAgo: 90 },
      { key: "a91", kind: "assignment", address: TESTVEIEN, status: "completed", daysAgo: 91 },
    ],
    { kind: "draft", address: TESTVEIEN },
    [
      ["a89", ["address"]],
      ["a90", ["address"]],
    ],
  ],
  [
    "2.8 grensen måles fra mottatt på målet, også bakover",
    [{ key: "a1", kind: "assignment", address: TESTVEIEN, status: "completed", daysAgo: 0 }],
    { kind: "draft", address: TESTVEIEN, daysAgo: 91 },
    [],
  ],
  [
    "2.8 åpent oppdrag og mottatt ordre gir treff uansett alder",
    [
      { key: "a1", kind: "assignment", address: TESTVEIEN, status: "in_progress", daysAgo: 200 },
      { key: "o1", kind: "order", address: TESTVEIEN, daysAgo: 300 },
    ],
    { kind: "draft", address: TESTVEIEN },
    [
      ["a1", ["address"]],
      ["o1", ["address"]],
    ],
  ],
];
