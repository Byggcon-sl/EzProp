/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Kolonnene i den lokale databasen ligger nå i `sync/local-columns.ts` (felles for alle
 * kandidater). Denne filen videresender dem, så PowerSync-skjemaet og testene er uendret.
 */
export {
  trialColumns,
  TRIAL_TABLE_NAMES,
  type TrialColumnKind,
  type TrialTableName,
} from "../local-columns";
