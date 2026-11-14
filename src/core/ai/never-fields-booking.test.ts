import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assignments, orders } from "@/db/schema";
import { NEVER_FIELDS } from "./never-fields";

/*
 * «Aldri»-listen dekker bestillingsfeltene på oppdraget (testplan for «Nytt oppdrag» 1.2, ADR 0011).
 * Kolonnene leses fra Drizzle-skjemaet, så en ny kolonne med samme navn som en sperret
 * ordrekolonne blir rød her til den er ført i listen. Ren test uten database.
 *
 * Støtter hovedmål: KI i bunnen (adresse, matrikkel, bestiller og referanse fra «Nytt oppdrag» kan
 * aldri være kilde for et felt som sendes til KI, regel 14).
 */

function columnNames(table: typeof assignments | typeof orders): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

const BOOKING_TEXT_COLUMNS = [
  "address_text",
  "ordered_by_text",
  "external_ref",
  "gnr",
  "bnr",
  "snr",
  "housing_association_name",
];

describe("1.2 NEVER_FIELDS og bestillingen på oppdraget", () => {
  it("kolonnene finnes på assignments (kontroll av testen)", () => {
    const columns = columnNames(assignments);
    for (const column of BOOKING_TEXT_COLUMNS) expect(columns, column).toContain(column);
  });

  it.each(BOOKING_TEXT_COLUMNS)("assignments.%s står i NEVER_FIELDS", (column) => {
    expect(NEVER_FIELDS).toContain(`assignments.${column}`);
  });

  it("hver sperret ordrekolonne som også finnes på assignments, er sperret der", () => {
    const onAssignments = new Set(columnNames(assignments));
    const missing = NEVER_FIELDS.filter((field) => field.startsWith("orders."))
      .map((field) => field.slice("orders.".length))
      .filter((column) => onAssignments.has(column))
      .filter((column) => !NEVER_FIELDS.includes(`assignments.${column}`));
    expect(missing).toEqual([]);
  });

  it("alle kolonnene i listen finnes i skjemaet (ingen skrivefeil for oppdrag og ordre)", () => {
    const known = {
      assignments: new Set(columnNames(assignments)),
      orders: new Set(columnNames(orders)),
    };
    for (const field of NEVER_FIELDS) {
      const [table, column] = field.split(".");
      if (table === "assignments" || table === "orders") {
        expect(known[table].has(column!), field).toBe(true);
      }
    }
  });
});
