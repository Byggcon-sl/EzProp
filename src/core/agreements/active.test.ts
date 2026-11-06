import { describe, expect, it } from "vitest";
import { todayInOslo } from "@/shared/lib/dates";
import { isAgreementActive } from "./active";

/*
 * «Gjelder i dag» for en avtale, som testsaker i data. Testplan:
 * docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 2.
 *
 * Støtter hovedmål: reklamasjoner (en utløpt eller ikke påbegynt avtale gir aldri premisser i en
 * ny rapport) og tid (forslaget på oppdraget bygger på den samme regelen).
 */

const PERIOD = { validFrom: "2026-03-01", validTo: "2026-10-31" };

type Case = {
  name: string;
  validFrom: string;
  validTo: string | null;
  today: string;
  active: boolean;
};

const CASES: Case[] = [
  { name: "dagen før start", ...PERIOD, today: "2026-02-28", active: false },
  { name: "startdagen", ...PERIOD, today: "2026-03-01", active: true },
  { name: "midt i perioden", ...PERIOD, today: "2026-06-15", active: true },
  { name: "siste dag", ...PERIOD, today: "2026-10-31", active: true },
  { name: "dagen etter", ...PERIOD, today: "2026-11-01", active: false },
  {
    name: "tom validTo, i dag langt fram",
    validFrom: "2026-03-01",
    validTo: null,
    today: "2036-01-01",
    active: true,
  },
  {
    name: "tom validTo, før start",
    validFrom: "2026-03-01",
    validTo: null,
    today: "2026-02-28",
    active: false,
  },
  {
    name: "én-dags avtale",
    validFrom: "2026-11-03",
    validTo: "2026-11-03",
    today: "2026-11-03",
    active: true,
  },
];

describe("2. isAgreementActive", () => {
  it.each(CASES)("$name ($today) → $active", ({ validFrom, validTo, today, active }) => {
    expect(isAgreementActive({ validFrom, validTo }, today)).toBe(active);
  });

  it("tidssone: 31.10 kl. 23.30 UTC er 1.11 i Norge, og avtalen gjelder da ikke", () => {
    const today = todayInOslo(new Date("2026-10-31T23:30:00Z"));
    expect(today).toBe("2026-11-01");
    expect(isAgreementActive(PERIOD, today)).toBe(false);
    // Kontroll: UTC-datoen for samme øyeblikk ville gitt gyldig
    expect(isAgreementActive(PERIOD, "2026-10-31")).toBe(true);
  });
});
