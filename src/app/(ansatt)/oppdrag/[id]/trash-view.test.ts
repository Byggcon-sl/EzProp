import { describe, expect, it } from "vitest";
import type { TrashLine } from "@/core/buildings";
import {
  alreadyRestoredMessage,
  removedMessage,
  restoreFailedMessage,
  restoreResultMessage,
} from "./trash-texts";
import { formatRemovedAt, pathText, toTrashEntries } from "./trash-view";

/*
 * Tekstene i angre-meldingen og linjene i papirkurven
 * (docs/funksjoner/fase2a-papirkurv-design.md 3.3, 3.4 og 4.3). Rene funksjoner, oppdiktede navn.
 * Støtter hovedmål: de ansatte (meldingen sier hva som gikk med) og færre reklamasjoner
 * (papirkurven viser hvem som fjernet hva, og når).
 */

const NOW = new Date("2026-11-16T13:30:00Z"); // 14:30 i Norge

describe("tekstene når noe er fjernet (design 3.3)", () => {
  it.each([
    [removedMessage("room", "Bad"), "Rommet «Bad» er fjernet."],
    [removedMessage("floor", "2. etasje"), "Etasjen «2. etasje» er fjernet."],
    [
      removedMessage("floor", "2. etasje", { floors: 0, rooms: 4 }),
      "2. etasje og 4 rom er fjernet.",
    ],
    [
      removedMessage("floor", "2. etasje", { floors: 0, rooms: 1 }),
      "2. etasje og 1 rom er fjernet.",
    ],
    [removedMessage("building", "Hovedhus"), "Bygningen «Hovedhus» er fjernet."],
    [
      removedMessage("building", "Hovedhus", { floors: 2, rooms: 9 }),
      "Hovedhus med 2 etasjer og 9 rom er fjernet.",
    ],
    [
      removedMessage("building", "Hovedhus", { floors: 1, rooms: 0 }),
      "Hovedhus med 1 etasje er fjernet.",
    ],
    [removedMessage("party", "Ola Testmann"), "Parten «Ola Testmann» er fjernet."],
  ])("%s", (actual, expected) => {
    expect(actual).toBe(expected);
  });
});

describe("tekstene etter «Angre» og «Gjenopprett» (design 3.4)", () => {
  it("vanlig, gruppe, allerede tilbake og beskjed fra kjernen", () => {
    expect(
      restoreResultMessage("room", "Bad", {
        changed: true,
        notices: [],
        restored: [{ type: "room" }],
      }),
    ).toBe("Rommet «Bad» er hentet tilbake.");
    expect(
      restoreResultMessage("floor", "2. etasje", {
        changed: true,
        notices: [],
        restored: [{ type: "floor" }, ...Array.from({ length: 4 }, () => ({ type: "room" }))],
      }),
    ).toBe("2. etasje og 4 rom er hentet tilbake.");
    expect(
      restoreResultMessage("building", "Hovedhus", {
        changed: true,
        notices: [],
        restored: [{ type: "building" }, { type: "floor" }, { type: "room" }],
      }),
    ).toBe("Hovedhus med 1 etasje og 1 rom er hentet tilbake.");
    expect(restoreResultMessage("room", "Bad", { changed: false, notices: [], restored: [] })).toBe(
      alreadyRestoredMessage("room", "Bad"),
    );
    expect(alreadyRestoredMessage("room", "Bad")).toBe("Rommet «Bad» er allerede tilbake.");
    const notice = "Rommet kom tilbake, sammen med etasjen «1. etasje».";
    expect(
      restoreResultMessage("room", "Bad", {
        changed: true,
        notices: [notice],
        restored: [{ type: "floor" }, { type: "room" }],
      }),
    ).toBe(notice);
  });

  it.each([
    ["room", "rommet"],
    ["floor", "etasjen"],
    ["building", "bygningen"],
    ["party", "parten"],
  ] as const)("feiltekst for %s", (type, noun) => {
    expect(restoreFailedMessage(type)).toBe(
      `Fikk ikke hentet tilbake ${noun}. Prøv igjen, eller bruk papirkurven.`,
    );
  });
});

describe("når (norsk tid)", () => {
  it.each([
    ["2026-11-16T13:02:00Z", "i dag 14:02"],
    ["2026-11-15T23:30:00Z", "i dag 00:30"],
    ["2026-11-15T08:15:00Z", "i går 09:15"],
    ["2026-11-12T07:30:00Z", "12.11.2026 08:30"],
  ])("%s → «%s»", (iso, expected) => {
    expect(formatRemovedAt(new Date(iso), NOW)).toBe(expected);
  });
});

describe("linjene i papirkurven (design 4.3)", () => {
  const removedAt = new Date("2026-11-16T13:02:00Z");
  const lines: TrashLine[] = [
    {
      type: "floor",
      id: "f1",
      label: "2. etasje",
      path: [{ type: "building", id: "b1", label: "Hovedhus", removed: false }],
      groupCount: 5,
      contents: { floors: 0, rooms: 4 },
      area: { braI: 64, braE: 0, braB: 0, bra: 64 },
      removedAt,
      removedByName: "Kari Testesen",
      children: [
        {
          type: "room",
          id: "r1",
          label: "Bad",
          path: [
            { type: "building", id: "b1", label: "Hovedhus", removed: false },
            { type: "floor", id: "f1", label: "2. etasje", removed: true },
          ],
        },
      ],
    },
    {
      type: "party",
      id: "p1",
      role: "buyer",
      name: "Ola Testmann",
      firmName: "Testfirma AS",
      removedAt: new Date("2026-11-12T07:30:00Z"),
      removedByName: null,
    },
  ];

  it("gruppe, hvor, areal, hvem og når; parter med rolle og firma", () => {
    const [floor, party] = toTrashEntries(lines, NOW, (role) =>
      role === "buyer" ? "Kjøper" : role,
    );
    expect(floor).toMatchObject({
      type: "floor",
      label: "2. etasje",
      title: "2. etasje (4 rom)",
      where: "Hovedhus · BRA 64,0 m²",
      removedPrefix: "Fjernet av Kari Testesen ",
      removedAtText: "i dag 14:02",
      removedAtIso: removedAt.toISOString(),
      childrenLabel: "Vis rommene (1)",
    });
    expect(floor!.children[0]).toEqual({
      type: "room",
      id: "r1",
      label: "Bad",
      where: "Hovedhus › 2. etasje (fjernet)",
    });
    expect(party).toMatchObject({
      type: "party",
      title: "Ola Testmann",
      where: "Kjøper · Testfirma AS",
      removedPrefix: "Fjernet ",
      removedAtText: "12.11.2026 08:30",
      childrenLabel: null,
    });
    // Aldri e-post eller telefon i visningen
    expect(JSON.stringify(party)).not.toMatch(/@|\d{8}/);
  });

  it("stien merker ledd som også er fjernet", () => {
    expect(
      pathText([
        { type: "building", id: "b", label: "Hovedhus", removed: true },
        { type: "floor", id: "f", label: "1. etasje", removed: false },
      ]),
    ).toBe("Hovedhus (fjernet) › 1. etasje");
  });
});
