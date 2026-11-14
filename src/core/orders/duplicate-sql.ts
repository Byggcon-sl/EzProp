import { DUPLICATE_KEY_INDEXES } from "@/core/assignments/booking/contract";

/**
 * SQL-uttrykkene og spørringen for mulig dublett er felles for ordre og oppdrag og står i
 * `@/core/assignments/booking/duplicate-sql` (ADR 0011). Gis videre her under de gamle navnene.
 * Uttrykkene er de samme for `orders` og `assignments`.
 */
export {
  ADDRESS_KEY_SQL as ORDER_ADDRESS_KEY_SQL,
  BNR_KEY_SQL as ORDER_BNR_KEY_SQL,
  GNR_KEY_SQL as ORDER_GNR_KEY_SQL,
  SNR_KEY_SQL as ORDER_SNR_KEY_SQL,
  possibleDuplicatesQuery,
  type PossibleDuplicatesCriteria,
} from "@/core/assignments/booking/duplicate-sql";
export { POSSIBLE_DUPLICATES_LIMIT } from "@/core/assignments/booking/contract";

/** Navnene på indeksene på `orders` i migreringen 0033. */
export const ORDER_ADDRESS_KEY_INDEX = DUPLICATE_KEY_INDEXES.order.address;
export const ORDER_CADASTRE_KEY_INDEX = DUPLICATE_KEY_INDEXES.order.cadastre;
