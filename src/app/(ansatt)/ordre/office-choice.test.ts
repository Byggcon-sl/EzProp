import { describe, expect, it } from "vitest";
import { officeChoice } from "./office-choice";

/*
 * Forhåndsvalgt kontor ved «Gjør om til oppdrag» (docs/funksjoner/fase2a-manuell-ordre-testplan.md
 * runde 2, nytt 7.7). Ren funksjon, ingen database. Kontorene er oppdiktet.
 * Støtter hovedmål: tid (riktig kontor er valgt fra før, ett trykk mindre).
 */

const BODO = {
  id: "0190a000-0000-7000-8000-000000000031",
  name: "Testkontor Bodø",
  address: null,
  sortOrder: 1,
};
const NARVIK = {
  id: "0190a000-0000-7000-8000-000000000032",
  name: "Testkontor Narvik",
  address: null,
  sortOrder: 2,
};
const offices = [BODO, NARVIK];

describe("officeChoice", () => {
  it("7.7.1 den ansattes kontor står i listen og blir forhåndsvalgt", () => {
    const choice = officeChoice(offices, NARVIK.id);
    expect(choice.defaultOfficeId).toBe(NARVIK.id);
    expect(choice.offices).toEqual(offices);
  });

  it("7.7.2 den ansatte har ikke kontor: ingen forhåndsvalg", () => {
    expect(officeChoice(offices, null).defaultOfficeId).toBeNull();
  });

  it("7.7.3 den ansattes kontor står ikke i listen (slettet): ingen forhåndsvalg", () => {
    expect(
      officeChoice(offices, "0190a000-0000-7000-8000-000000000099").defaultOfficeId,
    ).toBeNull();
  });

  it("7.7.4 tom liste gir beskjeden og ingen forhåndsvalg", () => {
    const choice = officeChoice([], BODO.id);
    expect(choice.emptyMessage).toBe("Legg inn et kontor i admin først.");
    expect(choice.defaultOfficeId).toBeNull();
    expect(choice.offices).toEqual([]);
  });

  it("7.7.5 liste med kontorer gir ingen beskjed", () => {
    expect(officeChoice(offices, null).emptyMessage).toBeNull();
    expect(officeChoice(offices, BODO.id).emptyMessage).toBeNull();
  });
});
