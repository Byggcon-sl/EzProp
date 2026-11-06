import { describe, expect, it } from "vitest";
import { todayInOslo } from "@/shared/lib/dates";
import { isAgreementActive } from "./active";

/*
 * Gjelder avtalen i dag? Ren regeltest som data.
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 2.
 *
 * Støtter hovedmål: reklamasjoner (en avtale som ikke gjelder, blir aldri foreslått eller valgt,
 * og dagen regnes i norsk tid, ikke UTC).
 */

const PERIOD = { validFrom: "2026-03-01", validTo: "2026-10-31" };

describe("2 isAgreementActive", () => {
  it.each([
    { name: "2.1 dagen før start", ...PERIOD, today: "2026-02-28", active: false },
    { name: "2.2 startdagen", ...PERIOD, today: "2026-03-01", active: true },
    { name: "midt i perioden", ...PERIOD, today: "2026-06-15", active: true },
    { name: "2.3 siste dag", ...PERIOD, today: "2026-10-31", active: true },
    { name: "2.4 dagen etter", ...PERIOD, today: "2026-11-01", active: false },
    {
      name: "2.5 tom validTo, i dag langt fram",
      validFrom: "2026-03-01",
      validTo: null,
      today: "2036-01-01",
      active: true,
    },
    {
      name: "tom validTo, dagen før start",
      validFrom: "2026-03-01",
      validTo: null,
      today: "2026-02-28",
      active: false,
    },
    {
      name: "2.6 én-dags avtale",
      validFrom: "2026-11-03",
      validTo: "2026-11-03",
      today: "2026-11-03",
      active: true,
    },
  ])("$name → $active", ({ validFrom, validTo, today, active }) => {
    expect(isAgreementActive({ validFrom, validTo }, today)).toBe(active);
  });

  it("2.7 tidssone: 2026-10-31T23:30Z er 2026-11-01 i Oslo, og avtalen gjelder da ikke", () => {
    const today = todayInOslo(new Date("2026-10-31T23:30:00Z"));
    expect(today).toBe("2026-11-01");
    expect(isAgreementActive(PERIOD, today)).toBe(false);
    // UTC-datoen ville gitt «gyldig»; derfor må kjernen bruke norsk dato
    expect(isAgreementActive(PERIOD, "2026-10-31")).toBe(true);
  });
});
