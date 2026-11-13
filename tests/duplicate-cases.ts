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
