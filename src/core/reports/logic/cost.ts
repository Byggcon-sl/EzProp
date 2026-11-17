import type { CostType } from "@/db/schema";
import { COST_AMOUNT_ROUNDING } from "./codes";
import { COST_BANDS, type CostBandKey } from "./cost-bands";
import { COST_AMOUNT_MESSAGES, COST_BAND_LABELS, formatWholeNumber } from "./labels";
import type { CheckCostAmount } from "./types";

/**
 * Kostnaden på et avvik (docs/funksjoner/fase2a-badet-pc.md Omfang 5, design avsnitt 11). Eget
 * beløp rundes aldri av automatisk: ikke rundet til nærmeste 10 000 gir advarsel, aldri sperre
 * (regel 12). 0, negative tall og ikke-heltall avvises.
 */

/** Største beløp som kan lagres (`deviations.cost_amount` er `integer`). */
export const COST_AMOUNT_MAX = 2_000_000_000;

/** `invalid` for 0, negative tall, ikke-heltall og for store tall; `not_rounded` når beløpet ikke går opp i 10 000. */
export const checkCostAmount: CheckCostAmount = (amount) => {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > COST_AMOUNT_MAX) return "invalid";
  if (amount % COST_AMOUNT_ROUNDING !== 0) return "not_rounded";
  return "ok";
};

/** Advarselen rett under feltet, eller `null`. Ugyldige beløp gir feil, ikke advarsel. */
export function costWarning(amount: number): "not_rounded" | null {
  return checkCostAmount(amount) === "not_rounded" ? "not_rounded" : null;
}

/**
 * Nærmeste beløp rundet til 10 000, til knappen «Bruk 40 000». Gir aldri 0. Brukes bare når
 * takstmannen trykker; funksjonen endrer ingenting selv.
 */
export function nearestRoundedAmount(amount: number): number {
  const rounded = Math.round(amount / COST_AMOUNT_ROUNDING) * COST_AMOUNT_ROUNDING;
  return Math.max(COST_AMOUNT_ROUNDING, rounded);
}

export type ParsedCostAmount = { ok: true; amount: number } | { ok: false; message: string };

/** Mellomrom, hardt mellomrom og smalt hardt mellomrom er lov som tusenskille. */
const THOUSANDS_SEPARATORS = /[   ]/g;

/**
 * Leser beløpet slik takstmannen skrev det. «40 000» og «40000» godtas. Tomt felt, tekst, 0,
 * negative tall og desimaltall (også «10 000,00») avvises med norsk melding. Beløpet rundes aldri.
 */
export function parseCostAmount(input: string): ParsedCostAmount {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, message: COST_AMOUNT_MESSAGES.empty };
  const compact = trimmed.replace(THOUSANDS_SEPARATORS, "");
  if (/^[-−]?\d+([.,]\d+)?$/u.test(compact) && !/^\d+$/u.test(compact)) {
    return { ok: false, message: COST_AMOUNT_MESSAGES.not_whole_above_zero };
  }
  if (!/^\d+$/u.test(compact)) return { ok: false, message: COST_AMOUNT_MESSAGES.not_number };
  const amount = Number(compact);
  if (amount <= 0) return { ok: false, message: COST_AMOUNT_MESSAGES.not_whole_above_zero };
  if (amount > COST_AMOUNT_MAX) return { ok: false, message: COST_AMOUNT_MESSAGES.too_large };
  return { ok: true, amount };
}

function bandOf(key: string | null | undefined): (typeof COST_BANDS)[number] | null {
  return COST_BANDS.find((band) => band.key === key) ?? null;
}

/**
 * Kostnaden som tekst, slik den står i skrivebeskyttet visning, i `changed`-linjen og senere i
 * PDF-en (oversettelsen av `cost_type`). Eget beløp: «ca. 40 000 kr». Intervall: etiketten med kr.
 * Ingen kostnad, ukjent intervall eller ugyldig beløp gir tom tekst, aldri «ca.».
 */
export function costDisplayText(
  costType: CostType,
  value: { amount?: number | null; bandKey?: string | null },
): string {
  if (costType === "approx") {
    const amount = value.amount;
    if (amount === null || amount === undefined || checkCostAmount(amount) === "invalid") return "";
    return `ca. ${formatWholeNumber(amount)} kr`;
  }
  if (costType === "band") {
    const band = bandOf(value.bandKey);
    return band ? `${COST_BAND_LABELS[band.key as CostBandKey]} kr` : "";
  }
  return "";
}
