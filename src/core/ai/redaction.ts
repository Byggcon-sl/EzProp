import type { EmployeeGrant } from "@/core/access";

/*
 * MIDLERTIDIG PLASSHOLDER for bit 2 (docs/funksjoner/fase2a-vask-for-ki.md Omfang 2 og 3).
 * Bit 2 leverer den ekte vasken med samme signatur; denne filen erstattes helt ved samlingen
 * og skal aldri merges som den står. Den finnes bare så bit 3 (koblingen i `requestSuggestion`)
 * kan bygges og testes i parallell.
 */

export type RedactedFields = { fields: Record<string, string>; count: number };

export async function redactFields(
  _grant: EmployeeGrant,
  _assignmentId: string | null,
  fields: Readonly<Record<string, string>>,
): Promise<RedactedFields> {
  return { fields: { ...fields }, count: 0 };
}
