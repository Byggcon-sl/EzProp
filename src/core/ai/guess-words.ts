/*
 * Gjetteordene (regel 7): ord som sier at noe er gjettet eller usikkert. Én liste for kjernen og
 * evalueringen. Vakten `guess_guard` (`guards.ts`) stopper et svar til `override_summary` som har
 * et gjetteord som ikke stod i det som ble sendt, og kjøreren for evalueringssettet
 * (`evals/run.ts`, `EVAL_GUESS_WORDS`) bruker samme liste. Maltesten
 * (`src/db/seed/templates/wet-room.test.ts`) har en egen kopi, og
 * `tests/no-copy-from-research.test.ts` holder dem like.
 *
 * Filen er bare en ordliste til kontrollene. Ordene brukes aldri i tekst til rapporten eller KI.
 */
export const GUESS_WORDS: readonly string[] = [
  "antas",
  "trolig",
  "sannsynligvis",
  "antagelig",
  "muligens",
  "formentlig",
  "ser ut til",
  "antar",
  "antakelig",
  "sannsynlig",
  "kanskje",
  "tyder på",
  "virker som",
  "tilsynelatende",
];
