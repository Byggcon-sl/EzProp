import { describe, expect, it } from "vitest";

import { LIST_LIMIT, listLimit } from "./search";

/*
 * Grensen på antall rader i listene og i kontaktvelgeren. Velgeren ber om 10, så kjernen
 * henter ikke flere personopplysninger enn som vises (dataminimering, gjennomgangen av PR #97).
 */
describe("listLimit", () => {
  it("uten grense gir LIST_LIMIT", () => {
    expect(listLimit({})).toBe(LIST_LIMIT);
    expect(listLimit({ query: "Me" })).toBe(LIST_LIMIT);
  });

  it("en mindre grense brukes", () => {
    expect(listLimit({ limit: 10 })).toBe(10);
    expect(listLimit({ limit: 1 })).toBe(1);
  });

  it("grensen kan aldri bli større enn LIST_LIMIT", () => {
    expect(listLimit({ limit: LIST_LIMIT + 1 })).toBe(LIST_LIMIT);
    expect(listLimit({ limit: 100_000 })).toBe(LIST_LIMIT);
  });

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "ugyldig grense %s gir LIST_LIMIT",
    (limit) => {
      expect(listLimit({ limit })).toBe(LIST_LIMIT);
    },
  );
});
