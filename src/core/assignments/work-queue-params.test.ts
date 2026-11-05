import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES } from "./codes";
import {
  DEFAULT_WORK_QUEUE_STATUS,
  WORK_QUEUE_LIMIT,
  parseWorkQueueParams,
} from "./work-queue-params";

/*
 * Tolking av adressen til arbeidskøen (docs/funksjoner/fase2a-arbeidsko-testplan.md avsnitt 1.2).
 * Ren enhetstest som data. Ugyldige verdier gir standard (A99, A102), aldri feil. Organisasjon og
 * ansatt i adressen ignoreres.
 *
 * Støtter hovedmål: tid (startsiden viser «Mine» under arbeid uten valg) og reklamasjoner (en
 * adresse fra en lenke kan aldri bytte organisasjon eller person).
 */

type Params = Parameters<typeof parseWorkQueueParams>[0];

function parse(params: Record<string, string | string[] | undefined>) {
  return parseWorkQueueParams(params as Params);
}

describe("1.2 tolking av adressen", () => {
  it("konstantene: standardfanen er Under arbeid, høyst 50 kort", () => {
    expect(DEFAULT_WORK_QUEUE_STATUS).toBe("in_progress");
    expect(WORK_QUEUE_LIMIT).toBe(50);
  });

  it("1.2.1 ingen parametre → Under arbeid, Mine, tomt søk", () => {
    expect(parse({})).toEqual({ status: "in_progress", mineOnly: true, query: "" });
  });

  it.each(ASSIGNMENT_STATUSES)("1.2.2 status=%s gir seg selv", (status) => {
    expect(parse({ status }).status).toBe(status);
  });

  it.each([
    ["cancelled", "cancelled"],
    ["store bokstaver", "IN_PROGRESS"],
    ["tom", ""],
    ["liste med to verdier", ["ordered", "completed"]],
    ["mellomrom rundt", " ordered "],
    ["SQL-aktig", "ordered' or '1'='1"],
  ] as const)("1.2.3 ugyldig status (%s) → Under arbeid, aldri feil", (_name, status) => {
    expect(() => parse({ status: status as string | string[] })).not.toThrow();
    expect(parse({ status: status as string | string[] }).status).toBe("in_progress");
  });

  it("1.2.4 mine=0 → Alle", () => {
    expect(parse({ mine: "0" }).mineOnly).toBe(false);
  });

  it.each([
    ["mine=1", "1"],
    ["mine=ja", "ja"],
    ["mangler", undefined],
    ["liste", ["0", "0"]],
    ["tom", ""],
  ] as const)("1.2.4 %s → Mine", (_name, mine) => {
    expect(parse({ mine: mine as string | string[] | undefined }).mineOnly).toBe(true);
  });

  it("1.2.5 q trimmes", () => {
    expect(parse({ q: "  Testveien 12  " }).query).toBe("Testveien 12");
  });

  it("1.2.5 q over 100 tegn kastes ikke, og blir aldri lengre enn 100", () => {
    const long = "a".repeat(250);
    expect(() => parse({ q: long })).not.toThrow();
    expect(parse({ q: long }).query.length).toBeLessThanOrEqual(100);
  });

  it("1.2.5 q som liste kastes ikke og gir tekst", () => {
    expect(() => parse({ q: ["a", "b"] })).not.toThrow();
    expect(typeof parse({ q: ["a", "b"] }).query).toBe("string");
  });

  it("1.2.6 organizationId og employeeId i adressen ignoreres", () => {
    const result = parse({
      status: "ordered",
      organizationId: "0190a000-0000-7000-8000-000000000002",
      employeeId: "0190a000-0000-7000-8000-000000000060",
    });
    expect(Object.keys(result).sort()).toEqual(["mineOnly", "query", "status"]);
    expect(JSON.stringify(result)).not.toContain("0190a000");
  });

  it("tåler at adressen mangler", () => {
    expect(parseWorkQueueParams(undefined as unknown as Params)).toEqual({
      status: "in_progress",
      mineOnly: true,
      query: "",
    });
  });
});
