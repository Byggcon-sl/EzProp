import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES, parseWorkQueueParams } from "@/core/assignments";
import { otherTabHits, queueHref } from "./queue-href";

/*
 * Lenkene i arbeidskøen med søk og «Treff i andre faner» (T-0029,
 * docs/funksjoner/fase2a-sok-ordre-arbeidsko-testplan.md avsnitt 4.7, 5.6 og 5.7). Rene
 * funksjoner, ingen database. Står i egen fil ved siden av `queue-href.test.ts`.
 *
 * Støtter hovedmål: de ansatte (søket og «Mine» følger med når fanen byttes, og kontoret ser at
 * treffet ligger i en annen fane i stedet for å tro at oppdraget mangler).
 */

function query(href: string) {
  const url = new URL(href, "http://localhost");
  return { url, params: url.searchParams };
}

describe("5.6 queueHref skriver alltid mine og tar med q", () => {
  it.each(ASSIGNMENT_STATUSES.flatMap((s) => [true, false].map((m) => [s, m] as const)))(
    "status %s, mine %s: mine=1 eller mine=0 står alltid",
    (status, mineOnly) => {
      for (const q of ["", "Fjordgata 7"]) {
        const { url, params } = query(queueHref({ status, mineOnly, query: q }));
        expect(url.pathname).toBe("/arbeidskoe");
        expect(params.get("status")).toBe(status);
        expect(params.getAll("mine")).toEqual([mineOnly ? "1" : "0"]);
      }
    },
  );

  it.each([
    ["prosent", "50%"],
    ["og-tegn", "Hansen & Co"],
    ["æøå", "Øvre Ålgård"],
    ["matrikkel", "12/34/0/5"],
    ["understrek og skråstrek", "REF_77\\a"],
    ["spørsmålstegn og pund", "a?b#c"],
  ])("q (%s) URL-kodes og leses tilbake likt", (_name, q) => {
    const href = queueHref({ status: "completed", mineOnly: true, query: q });
    const { url, params } = query(href);
    expect(url.hash).toBe("");
    expect(params.get("q")).toBe(q);
    for (const std of [true, false]) {
      expect(parseWorkQueueParams(Object.fromEntries(params), { defaultMineOnly: std })).toEqual({
        status: "completed",
        mineOnly: true,
        query: q,
      });
    }
  });

  it("& og % står kodet i adressen, ikke rått", () => {
    const href = queueHref({ status: "ordered", mineOnly: false, query: "50% & co" });
    const search = href.slice(href.indexOf("?") + 1);
    expect(search.split("&").filter((part) => part.startsWith("q="))).toHaveLength(1);
    expect(search).not.toContain("50% ");
  });

  it("tomt søk gir ikke q= i adressen", () => {
    const href = queueHref({ status: "in_progress", mineOnly: false, query: "" });
    expect(href).not.toContain("q=");
    expect(href).toBe("/arbeidskoe?status=in_progress&mine=0");
  });

  it("fanebytte med søk: «Mine» og søket følger med", () => {
    const href = queueHref({ status: "ordered", mineOnly: true, query: "fjordgata" });
    expect(href).toBe("/arbeidskoe?status=ordered&mine=1&q=fjordgata");
  });
});

describe("4.7 «Treff i andre faner»", () => {
  it("tom fane + tellinger: bare faner med treff, i fanerekkefølgen, med antall", () => {
    const counts = { ordered: 2, in_progress: 0, completed: 1, invoiced: 4 };
    expect(otherTabHits(counts, "in_progress")).toEqual([
      { status: "ordered", count: 2 },
      { status: "completed", count: 1 },
      { status: "invoiced", count: 4 },
    ]);
  });

  it("rekkefølgen er fanerekkefølgen, ikke antallet", () => {
    const counts = { ordered: 9, in_progress: 0, completed: 1, invoiced: 5 };
    expect(otherTabHits(counts, "in_progress").map((hit) => hit.status)).toEqual(
      ASSIGNMENT_STATUSES.filter((status) => status !== "in_progress"),
    );
  });

  it("gjeldende fane tas aldri med", () => {
    const counts = { ordered: 0, in_progress: 3, completed: 1, invoiced: 0 };
    expect(otherTabHits(counts, "in_progress")).toEqual([{ status: "completed", count: 1 }]);
  });

  it("tom fane uten treff andre steder gir ingen lenker", () => {
    const zero = { ordered: 0, in_progress: 0, completed: 0, invoiced: 0 };
    for (const status of ASSIGNMENT_STATUSES) expect(otherTabHits(zero, status)).toEqual([]);
  });

  it("lenken til fanen med treff tar med søket og «Mine»", () => {
    const counts = { ordered: 0, in_progress: 0, completed: 1, invoiced: 0 };
    const state = { status: "in_progress" as const, mineOnly: true, query: "Fjordgata" };
    const [hit] = otherTabHits(counts, state.status);
    expect(hit).toBeDefined();
    expect(queueHref({ ...state, status: hit!.status })).toBe(
      "/arbeidskoe?status=completed&mine=1&q=Fjordgata",
    );
  });
});

describe("5.7 standardvalget kommer fra tilgangssjekken (kodegjennomgang)", () => {
  const root = path.resolve(__dirname, "../../../..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");

  it("siden sender standardvalget inn i parseWorkQueueParams, ikke rolle fra adressen", () => {
    const page = read("src/app/(ansatt)/arbeidskoe/page.tsx");
    expect(page).toMatch(/parseWorkQueueParams\(\s*params\s*,\s*\{\s*defaultMineOnly/);
    expect(page).not.toMatch(/params\.(roles|role|defaultMineOnly)/);
  });

  it("standardvalget regnes fra grant.roles", () => {
    const context = read("src/app/(ansatt)/employee-context.ts");
    expect(context).toMatch(/defaultMineOnly\(\s*found\.grant\.roles\s*\)/);
  });
});
