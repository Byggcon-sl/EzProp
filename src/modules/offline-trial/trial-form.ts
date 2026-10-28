/**
 * Testskjemaet for prøven uten nett i fase 1 (docs/funksjoner/fase1-testskjema.md).
 * Ren data: ingen React, ingen database, ingen TG-logikk. Nøklene er faste og endres aldri.
 */

export type TrialFieldType = "text" | "tg" | "choice" | "number" | "table" | "photo";
export type TrialTg = "TG0" | "TG1" | "TG2" | "TG3" | "TGIU";
export const TRIAL_TG_VALUES: readonly TrialTg[] = ["TG0", "TG1", "TG2", "TG3", "TGIU"];

export interface TrialOption {
  key: string;
  label: string;
}

export interface TrialColumn {
  key: string;
  label: string;
  type: "text" | "number";
  unit?: string;
}

export interface TrialField {
  key: string;
  label: string;
  type: TrialFieldType;
  /** Bare for tall: "m²", "år", "%". */
  unit?: string;
  /** Bare for valg. */
  options?: TrialOption[];
  /** Bare for tabell. */
  columns?: TrialColumn[];
}

export interface TrialGroup {
  key: string;
  title: string;
  fields: TrialField[];
}

export interface TrialForm {
  groups: TrialGroup[];
}

const YES: TrialOption = { key: "yes", label: "Ja" };
const NO: TrialOption = { key: "no", label: "Nei" };

export const trialForm: TrialForm = {
  groups: [
    {
      key: "about_dwelling",
      title: "Om boligen",
      fields: [
        { key: "building_year", label: "Byggeår", type: "number" },
        {
          key: "building_type",
          label: "Boligtype",
          type: "choice",
          options: [
            { key: "detached", label: "Enebolig" },
            { key: "apartment", label: "Leilighet" },
            { key: "row_house", label: "Rekkehus" },
          ],
        },
        { key: "floors", label: "Antall etasjer", type: "number" },
        { key: "usable_area", label: "Bruksareal", type: "number", unit: "m²" },
        { key: "general_description", label: "Generell beskrivelse", type: "text" },
        { key: "cover_photo", label: "Forsidebilde", type: "photo" },
      ],
    },
    {
      key: "exterior",
      title: "Utvendig",
      fields: [
        { key: "roof_tg", label: "Tak – tilstandsgrad", type: "tg" },
        { key: "roof_description", label: "Tak – beskrivelse", type: "text" },
        {
          key: "roof_covering",
          label: "Taktekking",
          type: "choice",
          options: [
            { key: "tiles", label: "Takstein" },
            { key: "metal", label: "Metall" },
            { key: "felt", label: "Papp" },
            { key: "other", label: "Annet" },
          ],
        },
        { key: "roof_covering_age", label: "Taktekkingens alder", type: "number", unit: "år" },
        { key: "roof_photo", label: "Tak – bilde", type: "photo" },
        { key: "walls_tg", label: "Yttervegger – tilstandsgrad", type: "tg" },
        { key: "walls_description", label: "Yttervegger – beskrivelse", type: "text" },
        { key: "walls_photo", label: "Yttervegger – bilde", type: "photo" },
      ],
    },
    {
      key: "bathroom",
      title: "Bad",
      fields: [
        { key: "bathroom_tg", label: "Bad – tilstandsgrad", type: "tg" },
        { key: "bathroom_description", label: "Bad – beskrivelse", type: "text" },
        { key: "bathroom_age", label: "Badets alder", type: "number", unit: "år" },
        {
          key: "floor_slope",
          label: "Fall mot sluk",
          type: "choice",
          options: [YES, NO, { key: "not_measured", label: "Ikke målt" }],
        },
        {
          key: "membrane_visible",
          label: "Membran synlig i sluk",
          type: "choice",
          options: [YES, NO],
        },
        { key: "moisture_floor", label: "Fuktmåling gulv", type: "number", unit: "%" },
        { key: "moisture_wall", label: "Fuktmåling vegg", type: "number", unit: "%" },
        { key: "bathroom_photo", label: "Bad – bilde", type: "photo" },
        { key: "drain_photo", label: "Sluk – bilde", type: "photo" },
        {
          key: "drill_measurements",
          label: "Hulltakingsmålinger",
          type: "table",
          columns: [
            { key: "location", label: "Sted", type: "text" },
            { key: "value", label: "Verdi", type: "number", unit: "%" },
            { key: "note", label: "Kommentar", type: "text" },
          ],
        },
      ],
    },
    {
      key: "kitchen",
      title: "Kjøkken",
      fields: [
        { key: "kitchen_tg", label: "Kjøkken – tilstandsgrad", type: "tg" },
        { key: "kitchen_description", label: "Kjøkken – beskrivelse", type: "text" },
        {
          key: "kitchen_ventilation",
          label: "Avtrekk",
          type: "choice",
          options: [
            { key: "external", label: "Ut av boligen" },
            { key: "carbon_filter", label: "Kullfilter" },
            { key: "none", label: "Ingen" },
          ],
        },
        { key: "leak_stopper", label: "Lekkasjestopper", type: "choice", options: [YES, NO] },
        { key: "kitchen_photo", label: "Kjøkken – bilde", type: "photo" },
      ],
    },
    {
      key: "technical",
      title: "Teknisk",
      fields: [
        { key: "water_heater_tg", label: "Varmtvannsbereder – tilstandsgrad", type: "tg" },
        { key: "water_heater_age", label: "Berederens alder", type: "number", unit: "år" },
        {
          key: "water_heater_location",
          label: "Berederens plassering",
          type: "choice",
          options: [
            { key: "bathroom", label: "Bad" },
            { key: "laundry", label: "Vaskerom" },
            { key: "storage", label: "Bod" },
            { key: "other", label: "Annet" },
          ],
        },
        { key: "water_heater_photo", label: "Bereder – bilde", type: "photo" },
        { key: "electrical_tg", label: "Elektrisk anlegg – tilstandsgrad", type: "tg" },
        {
          key: "electrical_description",
          label: "Elektrisk anlegg – beskrivelse",
          type: "text",
        },
        { key: "fuse_box_photo", label: "Sikringsskap – bilde", type: "photo" },
        {
          key: "compliance_declaration",
          label: "Samsvarserklæring foreligger",
          type: "choice",
          options: [YES, NO, { key: "unknown", label: "Ukjent" }],
        },
      ],
    },
    {
      key: "overall",
      title: "Oppsummering",
      fields: [
        { key: "summary", label: "Samlet kommentar", type: "text" },
        { key: "rooms_inspected", label: "Antall rom befart", type: "number" },
        { key: "recommendation_tg", label: "Samlet inntrykk – tilstandsgrad", type: "tg" },
      ],
    },
  ],
};

/** Alle felt i skjemaet, i rekkefølge. */
export function listTrialFields(form: TrialForm): TrialField[] {
  return form.groups.flatMap((group) => group.fields);
}
