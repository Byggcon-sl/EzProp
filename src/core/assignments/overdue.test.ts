import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "./codes";
import { isOverdue } from "./overdue";

/*
 * Merket «Forfalt» i arbeidskøen (docs/funksjoner/fase2a-arbeidsko-testplan.md avsnitt 1.1). Ren
 * enhetstest som data: hver status har en fast forventning, og grensen ved midnatt i norsk tid er
 * testet både vinter og sommer.
 *
 * Støtter hovedmål: reklamasjoner (en passert frist blir synlig, men ikke før dagen etter, og
 * ferdige oppdrag merkes aldri).
 */

// 05.11.2026 kl. 11 i Oslo
const NOW = new Date("2026-11-05T10:00:00Z");
const YESTERDAY = "2026-11-04";
const TODAY = "2026-11-05";
const TOMORROW = "2026-11-06";

/** Kan statusen bli forfalt? Én linje per status; ny status uten linje gjør testen rød (1.1.7). */
const CAN_BE_OVERDUE: Record<AssignmentStatus, boolean> = {
  ordered: true,
  in_progress: true,
  completed: false,
  invoiced: false,
};

describe("1.1 isOverdue", () => {
  it.each(["ordered", "in_progress"] as const)("1.1.1 frist i går, %s → forfalt", (status) => {
    expect(isOverdue({ dueDate: YESTERDAY, status }, NOW)).toBe(true);
  });

  it.each(ASSIGNMENT_STATUSES)("1.1.2 frist i dag, %s → ikke forfalt", (status) => {
    expect(isOverdue({ dueDate: TODAY, status }, NOW)).toBe(false);
  });

  it.each(ASSIGNMENT_STATUSES)("1.1.3 frist i morgen, %s → ikke forfalt", (status) => {
    expect(isOverdue({ dueDate: TOMORROW, status }, NOW)).toBe(false);
  });

  it.each(ASSIGNMENT_STATUSES)("1.1.4 ingen frist, %s → ikke forfalt", (status) => {
    expect(isOverdue({ dueDate: null, status }, NOW)).toBe(false);
  });

  it.each(["completed", "invoiced"] as const)(
    "1.1.5 %s med frist i går → ikke forfalt",
    (status) => {
      expect(isOverdue({ dueDate: YESTERDAY, status }, NOW)).toBe(false);
    },
  );

  it("1.1.5 frist langt tilbake i tid, ferdig → ikke forfalt", () => {
    expect(isOverdue({ dueDate: "2020-01-01", status: "completed" }, NOW)).toBe(false);
  });

  it.each([
    // Vintertid (UTC+1): 23:59:59 Oslo 4.11 og 00:00 Oslo 5.11
    { dueDate: "2026-11-04", now: "2026-11-04T22:59:59Z", expected: false },
    { dueDate: "2026-11-04", now: "2026-11-04T23:00:00Z", expected: true },
    // Sommertid (UTC+2): 23:59:59 Oslo 30.6 og 00:00 Oslo 1.7
    { dueDate: "2026-06-30", now: "2026-06-30T21:59:59Z", expected: false },
    { dueDate: "2026-06-30", now: "2026-06-30T22:00:00Z", expected: true },
  ])("1.1.6 frist $dueDate, nå $now (UTC) → $expected", ({ dueDate, now, expected }) => {
    for (const status of ["ordered", "in_progress"] as const) {
      expect(isOverdue({ dueDate, status }, new Date(now))).toBe(expected);
    }
  });

  it("1.1.6 midnatt i UTC er ikke grensen (00:30 UTC 5.11 er 01:30 Oslo)", () => {
    // Fristen 4.11 er forfalt fra 23:00 UTC 4.11; 22:30 UTC er fortsatt 4.11 i Oslo
    expect(
      isOverdue({ dueDate: "2026-11-04", status: "ordered" }, new Date("2026-11-04T22:30:00Z")),
    ).toBe(false);
  });

  it("1.1.7 tabellen dekker alle statuser, og ingen ukjente", () => {
    expect(Object.keys(CAN_BE_OVERDUE).sort()).toEqual([...ASSIGNMENT_STATUSES].sort());
  });

  it.each(ASSIGNMENT_STATUSES)("1.1.7 %s med frist i går følger tabellen", (status) => {
    expect(isOverdue({ dueDate: YESTERDAY, status }, NOW)).toBe(CAN_BE_OVERDUE[status]);
  });

  it("ukjent status (for eksempel kansellert) er aldri forfalt", () => {
    expect(isOverdue({ dueDate: YESTERDAY, status: "cancelled" }, NOW)).toBe(false);
  });
});
