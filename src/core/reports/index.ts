import "server-only";

/**
 * Rapportkjernen (ADR 0013, docs/funksjoner/fase2a-badet-pc.md). Bare for serveren:
 * `server-only` stopper bygget hvis en klientkomponent importerer herfra. Klientkomponenter
 * importerer fra `@/core/reports/logic`.
 *
 * Tjenestene bygges mot funksjonstypene i `./types` og eksporteres herfra.
 */
export type * from "./types";
