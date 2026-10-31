import { describe, expect, it } from "vitest";
import { todayInOslo } from "@/shared/lib/dates";
import { certificationCases, MIDNIGHT_UTC } from "../../../tests/certification-cases";
import {
  CERTIFICATION_AREAS,
  EXPIRING_SOON_DAYS,
  expiresWithin,
  isCertificationValid,
} from "./certification-rules";

/*
 * Datoregelen for sertifiseringer som ren kode (testplan
 * docs/funksjoner/fase0b-sertifisering-testplan.md, del 1 og 5). Grensesakene ligger som data i
 * tests/certification-cases.ts og brukes også mot databasen. Ingen database her.
 */

describe("datoregelen (regeltester som data)", () => {
  it("bruker 60 dager for «går ut snart»", () => {
    expect(EXPIRING_SOON_DAYS).toBe(60);
  });

  it.each(certificationCases)("$name", (c) => {
    const cert = { validFrom: c.validFrom, validTo: c.validTo, deletedAt: c.deletedAt };
    expect(isCertificationValid(cert, c.today)).toBe(c.valid);
    expect(expiresWithin(cert, c.today, EXPIRING_SOON_DAYS)).toBe(c.expiringIn60);
  });

  it("uten deletedAt i objektet regnes raden som ikke slettet", () => {
    expect(isCertificationValid({ validFrom: null, validTo: "2026-10-31" }, "2026-10-31")).toBe(
      true,
    );
  });
});

describe("todayInOslo", () => {
  it("9. 23:30 UTC 30.10 er 31.10 i Oslo (vintertid, UTC+1)", () => {
    expect(todayInOslo(MIDNIGHT_UTC)).toBe("2026-10-31");
    expect(todayInOslo(new Date("2026-10-30T22:59:00Z"))).toBe("2026-10-30");
  });

  it("10. sommertid: 22:30 UTC 30.06 er 01.07 i Oslo (UTC+2)", () => {
    expect(todayInOslo(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(todayInOslo(new Date("2026-06-30T21:59:00Z"))).toBe("2026-06-30");
  });

  it("11. uten argument gir dagens dato på formen ÅÅÅÅ-MM-DD", () => {
    expect(todayInOslo()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("område som fast kode", () => {
  it("5.1 har nøyaktig én kode, condition_report, med etiketten «Tilstandsrapport bolig»", () => {
    expect(CERTIFICATION_AREAS).toHaveLength(1);
    expect(CERTIFICATION_AREAS.map((area) => area.key)).toEqual(["condition_report"]);
    expect(CERTIFICATION_AREAS[0]?.label).toBe("Tilstandsrapport bolig");
  });
});
