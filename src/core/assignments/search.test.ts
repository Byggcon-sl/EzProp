import { describe, expect, it } from "vitest";
import { assignmentFieldsMatch, orderFieldsMatch, parseCadastralQuery } from "./search";

/*
 * Matrikkelsøket som regeltest (docs/funksjoner/fase2a-sok-ordre-arbeidsko-testplan.md avsnitt 2).
 * Ren funksjon, tabeller med testsaker. Hvilke rader som faktisk gir treff, viser
 * `src/core/orders/order-search.test.ts` (3.3) og `work-queue-search.test.ts` (4.3).
 * Testdata er oppdiktet (gnr/bnr 12/34).
 *
 * Støtter hovedmål: reklamasjoner (matrikkelen tolkes del for del, så «12/34» aldri blir 112/34)
 * og de ansatte (mellomrom rundt «/» tåles, feil format krasjer aldri søket).
 */

const ORG = "0190a000-0000-7000-8000-000000000001";

describe("2.1 tolkes som matrikkel", () => {
  it.each([
    ["12/34", { gnr: "12", bnr: "34" }],
    ["12 / 34", { gnr: "12", bnr: "34" }],
    [" 12/34 ", { gnr: "12", bnr: "34" }],
    ["12/34/5", { gnr: "12", bnr: "34", fnr: "5" }],
    ["12/34/0/5", { gnr: "12", bnr: "34", fnr: "0", snr: "5" }],
    ["12 / 34 / 0 / 5", { gnr: "12", bnr: "34", fnr: "0", snr: "5" }],
    ["1/1", { gnr: "1", bnr: "1" }],
  ])("%j", (query, expected) => {
    expect(parseCadastralQuery(query)).toEqual(expected);
  });

  it("uten fnr og snr har svaret ikke nøklene (ikke bare undefined-verdier)", () => {
    const result = parseCadastralQuery("12/34");
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(["bnr", "gnr"]);
  });
});

describe("2.2 gir null, ingen krasj", () => {
  it.each([
    "12/",
    "/34",
    "12",
    "abc",
    "12/abc",
    "12/34/0/5/6",
    "12//34",
    "-12/34",
    "12,5/34",
    "12.5/34",
    "",
    "   ",
    "12/34/",
    "Fjordgata 12/34",
    "12/34 Fjordgata",
    "12a/34",
  ])("%j", (query) => {
    expect(() => parseCadastralQuery(query)).not.toThrow();
    expect(parseCadastralQuery(query)).toBeNull();
  });
});

describe("2.3 ledende nuller", () => {
  it("«012/34» tolkes; gnr er «012» (slik det er skrevet) eller «12»", () => {
    // Dokumenterer valget: funksjonen gir sifrene tilbake slik de er skrevet. Om «012» skal finne
    // gnr 12 i databasen, er ikke bestemt i kortet; integrasjonstestene låser det ikke.
    const result = parseCadastralQuery("012/34");
    expect(result).not.toBeNull();
    expect(["012", "12"]).toContain(result!.gnr);
    expect(result!.bnr).toBe("34");
  });
});

describe("2.4 tomt søk gir intet filter", () => {
  it.each(["", "   "])(
    "orderFieldsMatch(%j) og assignmentFieldsMatch(org, %j) gir undefined",
    (q) => {
      expect(orderFieldsMatch(q)).toBeUndefined();
      expect(assignmentFieldsMatch(ORG, q)).toBeUndefined();
    },
  );

  it.each(["Fjordgata", "12/34", "%"])("søk (%j) gir et vilkår", (q) => {
    expect(orderFieldsMatch(q)).toBeDefined();
    expect(assignmentFieldsMatch(ORG, q)).toBeDefined();
  });
});
