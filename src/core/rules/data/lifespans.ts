import type { LifespanDocumentation, LifespanEntry, LifespanSet } from "../types";

/**
 * Levetider for skjult vanntett sjikt i våtrom, med trinn (docs/funksjoner/fase2a-regler-bad.md,
 * Omfang 2). Kodedata nå, tabell i 2a-3 med samme koder. Kodene endres aldri (regel 6).
 *
 * Tallene er fakta fra kilden i `source_ref`; ingen tekst fra standarden står her. Alle rader er
 * utkast, ikke godkjent av fagrådet. Materialkodene er de samme som valgene i membranfeltet i
 * badmalen. «Ukjent» har ingen rad: da gjelder bare radene uten materialkode.
 */

const SOURCE = "NS 3600:2025 tillegg C, levetider for vanntett sjikt i våtrom";

type Row = [material: string, component: string, withoutDoc: number, withDoc: number | null];

/** `withDoc = null`: samme levetid med og uten dokumentasjon (`documentation = any`). */
const ROWS: Row[] = [
  ["liquid_membrane", "Skjult vanntett sjikt – smøremembran", 15, 22],
  ["foil", "Skjult vanntett sjikt – foliemembran", 18, 25],
  ["sheet_membrane", "Skjult vanntett sjikt – banemembran", 20, 30],
  ["membrane_boards", "Skjult vanntett sjikt – membranplater", 15, 22],
  ["bathroom_cabin", "Baderomskabin", 15, 20],
  ["bathroom_panel", "Baderomspanel", 10, 20],
  ["wet_room_wallpaper_paint", "Våtromstapet eller malingssystem", 7, null],
  ["wet_room_vinyl", "Våtromsvinyl", 20, null],
];

function entry(
  material: string,
  component: string,
  documentation: LifespanDocumentation,
  minAge: number,
  sortOrder: number,
): LifespanEntry {
  return {
    key: `membrane.${material}.${documentation}`,
    material_code: material,
    component,
    from_year: null,
    to_year: null,
    min_age: minAge,
    documentation,
    outcome_kind: "tg2",
    source_ref: SOURCE,
    sort_order: sortOrder,
    status: "draft",
  };
}

const MATERIAL_ENTRIES: LifespanEntry[] = ROWS.flatMap(([material, component, without, withDoc]) =>
  withDoc === null
    ? [entry(material, component, "any", without, 0)]
    : [
        entry(material, component, "without", without, 0),
        entry(material, component, "with", withDoc, 0),
      ],
);

const BEFORE_2000: LifespanEntry = {
  key: "membrane.before_2000",
  material_code: null,
  component: "Skjult vanntett sjikt fra før 2000, alle typer",
  from_year: null,
  to_year: 1999,
  min_age: null,
  documentation: "any",
  outcome_kind: "tg3",
  source_ref: "NS 3600:2025 tillegg C, vanntett sjikt i våtrom fra før 2000",
  sort_order: 0,
  status: "draft",
};

export const WET_ROOM_LIFESPANS: LifespanSet = {
  key: "wet_room_membrane_lifespans",
  entries: [...MATERIAL_ENTRIES, BEFORE_2000].map((e, index) => ({
    ...e,
    sort_order: (index + 1) * 10,
  })),
};
