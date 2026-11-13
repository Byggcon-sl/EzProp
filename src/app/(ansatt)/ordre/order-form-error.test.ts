import { describe, expect, it } from "vitest";
import { NO_ACCESS, UNKNOWN_ERROR } from "../form-state";
import { initialOrderEditState, ORDER_FORM_ERROR_CODES, orderFormError } from "./order-form-error";

/*
 * Meldingen øverst i «Endre ordren» per feilkode (docs/funksjoner/fase2a-rette-ordre-testplan.md
 * 10.4). Støtter hovedmål: de ansatte (ved konflikt vises «Last siden på nytt», og det som er
 * skrevet står igjen) og færre reklamasjoner (ingen lagrer stille over en annens endring).
 */

describe("orderFormError", () => {
  it("ORDER_CHANGED gir meldingen om konflikt og knappen «Last siden på nytt»", () => {
    expect(orderFormError("ORDER_CHANGED")).toEqual({
      message: "Ordren er endret av en annen. Last siden på nytt.",
      reload: true,
    });
  });

  it.each([
    ["OFFLINE", "Du er uten nett. Endringen er ikke lagret."],
    ["NO_ACCESS", NO_ACCESS],
    ["UNKNOWN", UNKNOWN_ERROR],
    ["ukjent-kode", UNKNOWN_ERROR],
    ["", UNKNOWN_ERROR],
  ])("%s gir «%s» uten knappen for ny lasting", (code, message) => {
    expect(orderFormError(code)).toEqual({ message, reload: false });
  });

  it("bare ORDER_CHANGED gir reload", () => {
    const reloads = ORDER_FORM_ERROR_CODES.filter((code) => orderFormError(code).reload);
    expect(reloads).toEqual(["ORDER_CHANGED"]);
  });

  it("ingen melding bruker ordet «rett» eller «rettet» (reservert for rapportversjon 2)", () => {
    for (const code of ORDER_FORM_ERROR_CODES) {
      expect(orderFormError(code).message).not.toMatch(/(^|\s)rett(et)?(\s|$|\.)/i);
    }
  });

  it("starttilstanden er uten kode og ikke lagret", () => {
    expect(initialOrderEditState).toMatchObject({ code: null, saved: false, attempt: 0 });
  });
});
