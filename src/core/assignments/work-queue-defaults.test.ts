import { describe, expect, it } from "vitest";
import type { EmployeeRole } from "@/db/schema";
import { defaultMineOnly, parseWorkQueueParams } from "./work-queue-params";

/*
 * Standardvalget Mine/Alle i arbeidskøen (T-0029,
 * docs/funksjoner/fase2a-sok-ordre-arbeidsko-testplan.md avsnitt 5.1–5.5). Ren enhetstest som
 * data. Står i egen fil ved siden av `work-queue-params.test.ts` (1.2), som også er endret for
 * standardvalget; ingen test der er slettet.
 *
 * Støtter hovedmål: de ansatte (kontoret starter på «Alle», takstmannen på «Mine») og
 * reklamasjoner (rollene i adressen kan aldri bytte valget; bare tilgangssjekken gir rollene).
 */

type Params = Parameters<typeof parseWorkQueueParams>[0];

describe("5.1 defaultMineOnly", () => {
  it.each<[EmployeeRole[], boolean]>([
    [["inspector"], true],
    [["office"], false],
    [["manager"], false],
    [["admin"], false],
    [["inspector", "manager"], true],
    [["admin", "inspector"], true],
    [["office", "inspector"], true],
    [["office", "manager", "admin"], false],
    [[], false],
  ])("%j → %s", (roles, expected) => {
    expect(defaultMineOnly(roles)).toBe(expected);
  });
});

describe("5.2 parseWorkQueueParams uten mine følger standarden", () => {
  it.each([true, false])("defaultMineOnly %s", (std) => {
    expect(parseWorkQueueParams({}, { defaultMineOnly: std })).toEqual({
      status: "in_progress",
      mineOnly: std,
      query: "",
    });
  });

  it("1.2.1 endret: mine mangler + standard Mine gir Mine", () => {
    expect(parseWorkQueueParams({}, { defaultMineOnly: true }).mineOnly).toBe(true);
  });

  it("1.2.1 søster: mine mangler + standard Alle gir Alle", () => {
    expect(parseWorkQueueParams({}, { defaultMineOnly: false }).mineOnly).toBe(false);
  });

  it("tom adresse (undefined) følger også standarden", () => {
    expect(
      parseWorkQueueParams(undefined as unknown as Params, { defaultMineOnly: false }).mineOnly,
    ).toBe(false);
  });
});

describe("5.3 mine=0 og mine=1 overstyrer", () => {
  it.each([
    ["1", true, true],
    ["1", false, true],
    ["0", true, false],
    ["0", false, false],
  ] as const)("mine=%s med standard %s → %s", (mine, std, expected) => {
    expect(parseWorkQueueParams({ mine }, { defaultMineOnly: std }).mineOnly).toBe(expected);
  });
});

describe("5.4 ugyldig mine gir standarden, ingen krasj", () => {
  it.each([
    ["ja", "ja"],
    ["liste", ["1", "0"]],
    ["liste med én", ["1"]],
    ["tom", ""],
    ["mellomrom", " 1 "],
    ["true", "true"],
  ] as const)("%s", (_name, mine) => {
    for (const std of [true, false]) {
      const params = { mine: mine as string | string[] } as Params;
      expect(() => parseWorkQueueParams(params, { defaultMineOnly: std })).not.toThrow();
      expect(parseWorkQueueParams(params, { defaultMineOnly: std }).mineOnly).toBe(std);
    }
  });
});

describe("5.5 rollene i adressen ignoreres", () => {
  it.each([
    ["roles=inspector", { roles: "inspector" }],
    ["roles=admin", { roles: "admin" }],
    ["defaultMineOnly=1", { defaultMineOnly: "1" }],
    ["defaultMineOnly=true", { defaultMineOnly: "true" }],
  ])("%s endrer ikke standarden Alle", (_name, extra) => {
    const result = parseWorkQueueParams({ status: "ordered", ...extra } as Params, {
      defaultMineOnly: false,
    });
    expect(result).toEqual({ status: "ordered", mineOnly: false, query: "" });
    expect(Object.keys(result).sort()).toEqual(["mineOnly", "query", "status"]);
  });

  it("defaultMineOnly=0 i adressen endrer ikke standarden Mine", () => {
    const result = parseWorkQueueParams({ defaultMineOnly: "0" } as Params, {
      defaultMineOnly: true,
    });
    expect(result.mineOnly).toBe(true);
  });
});
