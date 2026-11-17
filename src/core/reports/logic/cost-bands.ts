import type { TextStatus } from "@/db/schema";

/**
 * Kostnadsintervallene som kodedata (docs/funksjoner/fase2a-badet-pc.md Omfang 2). Tabell og
 * redigering kommer i 2a-3 med de samme kodene. `deviations.cost_band_key` lagrer koden.
 *
 * Grensene er tall (fakta) og brukes til visning og rekkefølge. Takstmannen velger intervallet
 * selv; ingen kode regner et beløp om til et intervall. `null` = ingen grense. Etikettene skrives
 * med egne ord i oversettelsen av koder til norsk (`logic/`), merket utkast.
 *
 * En kode får aldri nye grenser (regel 6): nye grenser gir ny kode, og den gamle arkiveres med
 * `archived: true` slik at lagrede avvik fortsatt kan vises.
 */
export type CostBand = {
  /** Fast kode. Endres aldri. */
  key: string;
  /** Nedre grense i kroner. */
  min: number | null;
  /** Øvre grense i kroner. */
  max: number | null;
  sort_order: number;
  /** `draft` = «utkast, ikke godkjent av fagrådet». */
  status: TextStatus;
  /** Arkiverte intervaller kan ikke velges, men vises på avvik som har dem. */
  archived: boolean;
};

export const COST_BANDS = [
  { key: "under_20000", min: null, max: 20000, sort_order: 0, status: "draft", archived: false },
  {
    key: "from_20000_to_100000",
    min: 20000,
    max: 100000,
    sort_order: 1,
    status: "draft",
    archived: false,
  },
  {
    key: "from_100000_to_200000",
    min: 100000,
    max: 200000,
    sort_order: 2,
    status: "draft",
    archived: false,
  },
  {
    key: "from_200000_to_500000",
    min: 200000,
    max: 500000,
    sort_order: 3,
    status: "draft",
    archived: false,
  },
  { key: "over_500000", min: 500000, max: null, sort_order: 4, status: "draft", archived: false },
] as const satisfies readonly CostBand[];

export type CostBandKey = (typeof COST_BANDS)[number]["key"];
