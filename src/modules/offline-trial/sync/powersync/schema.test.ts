import { getTableColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { trialAnswers, trialForms, trialPhotos } from "@/db/schema";
import * as clientSchemaModule from "./schema";

// PowerSync-klientskjemaet må bruke nøyaktig samme kolonnenavn som PostgreSQL, ellers blir
// synken stille tom (docs/funksjoner/fase1-kandidat-powersync.md pkt. 3). Testplan avsnitt 2.7.
// `@powersync/web` lar seg importere i Node (sjekket 28.10.2026), så testen leser skjemaet direkte.

interface ClientTable {
  name: string;
  columns: { name: string }[];
}

/** Finner PowerSync-skjemaet blant eksportene, uansett hva det heter. */
function findClientSchema(): { tables: ClientTable[] } {
  const candidates = Object.values(clientSchemaModule as Record<string, unknown>).filter(
    (value): value is { tables: ClientTable[] } =>
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as { tables?: unknown }).tables),
  );
  expect(candidates, "schema.ts må eksportere ett PowerSync-skjema").toHaveLength(1);
  return candidates[0]!;
}

const serverTables: Record<string, Table> = {
  trial_forms: trialForms,
  trial_answers: trialAnswers,
  trial_photos: trialPhotos,
};

function serverColumnNames(table: Table): Set<string> {
  return new Set(Object.values(getTableColumns(table)).map((column) => column.name));
}

describe("PowerSync-klientskjema", () => {
  it("klientskjemaet har tabellene trial_forms, trial_answers og trial_photos", () => {
    const names = findClientSchema()
      .tables.map((table) => table.name)
      .sort();
    expect(names).toEqual(["trial_answers", "trial_forms", "trial_photos"]);
  });

  it("kolonnenavnene i klientskjemaet finnes i PostgreSQL-skjemaet", () => {
    for (const table of findClientSchema().tables) {
      const server = serverTables[table.name];
      expect(server, table.name).toBeDefined();
      const allowed = serverColumnNames(server!);
      expect(table.columns.length, table.name).toBeGreaterThan(0);
      for (const column of table.columns) {
        expect(allowed.has(column.name), `${table.name}.${column.name}`).toBe(true);
      }
    }
  });

  it("storage_path synkes ikke til enheten", () => {
    const photos = findClientSchema().tables.find((table) => table.name === "trial_photos");
    expect(photos).toBeDefined();
    expect(photos!.columns.map((column) => column.name)).not.toContain("storage_path");
  });
});
