import { listTrialFields, type TrialField, type TrialForm, type TrialTg } from "./trial-form";

/** En rad i et tabellfelt. `id` er en uuidv7 laget på enheten. */
export interface TrialTableRow {
  id: string;
  cells: Record<string, string | number | null>;
}

/** Et valgt bilde. Bare det som kan lagres: aldri filobjekt eller objekt-URL. */
export interface TrialPhoto {
  id: string;
  name: string;
  sizeBytes: number;
}

export type TrialValue = string | TrialTg | number | null | TrialTableRow[] | TrialPhoto[];
export type TrialAnswers = Partial<Record<string, TrialValue>>;

function isAnswered(field: TrialField, value: TrialValue | undefined): boolean {
  switch (field.type) {
    case "text":
      return typeof value === "string" && value.trim() !== "";
    case "tg":
    case "choice":
      return typeof value === "string" && value !== "";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "table":
    case "photo":
      return Array.isArray(value) && value.length > 0;
  }
}

/** Antall felt i skjemaet som har en verdi. Ukjente nøkler i `answers` teller aldri. */
export function countAnswered(form: TrialForm, answers: TrialAnswers): number {
  return listTrialFields(form).filter((field) => isAnswered(field, answers[field.key])).length;
}

const STRICT_DECIMAL = /^-?\d+([.,]\d+)?$/;

/**
 * Leser et tall skrevet på iPaden. Godtar bare et strengt desimaltall: valgfritt minus,
 * sifre, og eventuelt komma eller punktum fulgt av sifre («12,5», «-3», « 7 »).
 * Alt annet gir null: tom tekst, «12,», «,5», «+3», «1e3», «Infinity», «0x10», «1 000».
 */
export function parseTrialNumber(input: string): number | null {
  const text = input.trim();
  if (!STRICT_DECIMAL.test(text)) return null;
  return Number(text.replace(",", "."));
}
