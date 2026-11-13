import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES, parseWorkQueueParams } from "@/core/assignments";
import { formatDueDate, formatInspectionAt, toDateTimeLocal } from "../oslo-format";
import {
  cardAnchor,
  isNoteErrorCode,
  NOTE_ERROR_CODES,
  otherTabHits,
  queueHref,
} from "./queue-href";

/*
 * Adressene i arbeidskøen og datoene på kortet (docs/funksjoner/fase2a-arbeidsko-skisse.md
 * avsnitt 1 og 4). `queueHref` skal alltid gi tilbake det `parseWorkQueueParams` leser, slik at
 * fane, filter og søk følger med i fanene, Mine/Alle, «Avbryt» og etter «Lagre».
 *
 * Støtter hovedmål: tid (fanene og søket står i adressen, så tilbake-knappen virker) og
 * reklamasjoner (datoene står i norsk tid, også rundt midnatt).
 */

function parse(href: string) {
  const url = new URL(href, "http://localhost");
  return { url, params: parseWorkQueueParams(Object.fromEntries(url.searchParams)) };
}

describe("queueHref", () => {
  it.each(ASSIGNMENT_STATUSES.flatMap((s) => [true, false].map((m) => [s, m] as const)))(
    "status %s, mine %s, med og uten søk: tolkes tilbake likt",
    (status, mineOnly) => {
      for (const query of ["", "Testveien 12", "50%_rabatt & co"]) {
        const state = { status, mineOnly, query };
        const { url, params } = parse(queueHref(state));
        expect(url.pathname).toBe("/arbeidskoe");
        expect(params).toEqual(state);
      }
    },
  );

  it("status og mine står alltid; q bare med søk", () => {
    expect(queueHref({ status: "in_progress", mineOnly: true, query: "" })).toBe(
      "/arbeidskoe?status=in_progress&mine=1",
    );
    expect(queueHref({ status: "ordered", mineOnly: false, query: "Bodø" })).toBe(
      "/arbeidskoe?status=ordered&mine=0&q=Bod%C3%B8",
    );
  });

  it.each([true, false])(
    "T-0029: valget står etter fanebytte uansett standardvalget for rollen (mine %s)",
    (mineOnly) => {
      const href = queueHref({ status: "completed", mineOnly, query: "Testveien" });
      const url = new URL(href, "http://localhost");
      const params = Object.fromEntries(url.searchParams);
      for (const std of [true, false]) {
        expect(parseWorkQueueParams(params, { defaultMineOnly: std })).toEqual({
          status: "completed",
          mineOnly,
          query: "Testveien",
        });
      }
    },
  );

  it("notatfeil og mål legges til", () => {
    const id = "0190a000-0000-7000-8000-000000000050";
    const href = queueHref(
      { status: "completed", mineOnly: true, query: "" },
      { noteError: { assignmentId: id, code: "fnr" }, hash: cardAnchor(id) },
    );
    expect(href).toBe(`/arbeidskoe?status=completed&mine=1&notatfeil=${id}&feil=fnr#kort-${id}`);
  });

  it("feil uten kort gir ingen notatfeil", () => {
    const href = queueHref(
      { status: "in_progress", mineOnly: true, query: "" },
      { noteError: { code: "ingen_tilgang" } },
    );
    expect(href).toBe("/arbeidskoe?status=in_progress&mine=1&feil=ingen_tilgang");
  });
});

describe("otherTabHits (T-0029)", () => {
  const counts = { ordered: 0, in_progress: 0, completed: 1, invoiced: 3 };

  it("gir fanene utenom gjeldende med treff, i fast rekkefølge", () => {
    expect(otherTabHits(counts, "in_progress")).toEqual([
      { status: "completed", count: 1 },
      { status: "invoiced", count: 3 },
    ]);
  });

  it("gjeldende fane tas aldri med", () => {
    expect(otherTabHits(counts, "completed")).toEqual([{ status: "invoiced", count: 3 }]);
  });

  it("ingen treff noe sted gir tom liste", () => {
    const zero = { ordered: 0, in_progress: 0, completed: 0, invoiced: 0 };
    expect(otherTabHits(zero, "ordered")).toEqual([]);
  });
});

describe("isNoteErrorCode", () => {
  it.each(NOTE_ERROR_CODES)("%s er en kjent kode", (code) => {
    expect(isNoteErrorCode(code)).toBe(true);
  });

  it.each(["", "FNR", "<script>", undefined, ["fnr"]])("%s er ikke en kjent kode", (value) => {
    expect(isNoteErrorCode(value)).toBe(false);
  });
});

describe("datoene på kortet (Europe/Oslo)", () => {
  const now = new Date("2026-11-05T10:00:00Z");

  it("frist i år: «6. nov.»; annet år med årstall", () => {
    expect(formatDueDate("2026-11-06", now)).toBe("6. nov.");
    expect(formatDueDate("2027-01-02", now)).toBe("2. jan. 2027");
  });

  it("befaring med klokkeslett i norsk tid (vintertid UTC+1)", () => {
    expect(formatInspectionAt(new Date("2026-11-06T08:00:00Z"), now)).toBe("6. nov. kl. 09:00");
  });

  it("befaring rett før midnatt i UTC er neste dag i Norge", () => {
    expect(formatInspectionAt(new Date("2026-11-06T23:30:00Z"), now)).toBe("7. nov. kl. 00:30");
  });

  it("sommertid (UTC+2)", () => {
    expect(formatInspectionAt(new Date("2026-06-30T22:15:00Z"), now)).toBe("1. juli kl. 00:15");
  });

  it("verdien til datetime-local er norsk tid", () => {
    expect(toDateTimeLocal(new Date("2026-11-06T08:00:00Z"))).toBe("2026-11-06T09:00");
    expect(toDateTimeLocal(new Date("2026-06-30T22:15:00Z"))).toBe("2026-07-01T00:15");
  });
});
