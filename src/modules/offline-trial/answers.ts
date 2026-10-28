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

/** Leser et tall skrevet på iPaden. Godtar komma og punktum. Tom eller ugyldig tekst gir null. */
export function parseTrialNumber(input: string): number | null {
  const text = input.trim().replace(",", ".");
  if (text === "") return null;
  const value = Number(text);
  return Number.isNaN(value) ? null : value;
}
