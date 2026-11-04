import { describe, expect, it } from "vitest";
import { officeChoice } from "./office-choice";

/*
 * Forhåndsvalgt kontor ved «Gjør om til oppdrag» (testplan
 * docs/funksjoner/fase2a-manuell-ordre-testplan.md 7.7, runde 2 punkt 5). Ren funksjon, ingen
 * database. Kontorene er oppdiktet.
 * Støtter hovedmål: tid (eget kontor er valgt, så konverteringen er ett trykk).
 */

const BODO = { id: "0190a000-0000-7000-8000-000000000031", name: "Bodø" };
const NARVIK = { id: "0190a000-0000-7000-8000-000000000032", name: "Narvik" };
const DELETED = "0190a000-0000-7000-8000-000000000039";

describe("officeChoice (7.7)", () => {
  it("1. den ansattes kontor står i listen → det er forhåndsvalgt", () => {
    const choice = officeChoice([BODO, NARVIK], NARVIK.id);
    expect(choice.defaultOfficeId).toBe(NARVIK.id);
    expect(choice.offices).toEqual([BODO, NARVIK]);
  });

  it("2. den ansatte har ikke kontor → ingen forhåndsvalg", () => {
    expect(officeChoice([BODO, NARVIK], null).defaultOfficeId).toBeNull();
  });

  it("3. den ansattes kontor står ikke i listen (slettet) → ingen forhåndsvalg", () => {
    expect(officeChoice([BODO, NARVIK], DELETED).defaultOfficeId).toBeNull();
  });

  it("4. tom liste → beskjeden «Legg inn et kontor i admin først.» og ingen forhåndsvalg", () => {
    const choice = officeChoice([], BODO.id);
    expect(choice.emptyMessage).toBe("Legg inn et kontor i admin først.");
    expect(choice.defaultOfficeId).toBeNull();
    expect(choice.offices).toEqual([]);
  });

  it("5. liste med kontorer → ingen beskjed", () => {
    expect(officeChoice([BODO], null).emptyMessage).toBeNull();
    expect(officeChoice([BODO, NARVIK], BODO.id).emptyMessage).toBeNull();
  });
});
