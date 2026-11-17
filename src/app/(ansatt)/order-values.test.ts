import { describe, expect, it } from "vitest";
import { ORDER_FORM_TEXT_FIELDS, readOfferValues, readOrderValues } from "./order-values";

describe("readOrderValues", () => {
  it("leser alle tekstfeltene, og manglende felt blir tom tekst", () => {
    const formData = new FormData();
    formData.set("addressText", "Testveien 12, 8000 Bodø");
    formData.set("gnr", "12");
    const values = readOrderValues(formData);
    expect(Object.keys(values).sort()).toEqual([...ORDER_FORM_TEXT_FIELDS].sort());
    expect(values.addressText).toBe("Testveien 12, 8000 Bodø");
    expect(values.gnr).toBe("12");
    expect(values.snr).toBe("");
  });

  it("tar med avkrysningen bare når den er sendt", () => {
    const off = readOrderValues(new FormData());
    expect(off.sellerDeclarationReceived).toBeUndefined();
    const formData = new FormData();
    formData.set("sellerDeclarationReceived", "on");
    expect(readOrderValues(formData).sellerDeclarationReceived).toBe("on");
  });

  it("leser aldri organisasjon, status eller versjon inn i verdiene", () => {
    const formData = new FormData();
    formData.set("organizationId", "00000000-0000-4000-8000-000000000000");
    formData.set("status", "rejected");
    formData.set("rowVersion", "3");
    const values = readOrderValues(formData);
    expect(values).not.toHaveProperty("organizationId");
    expect(values).not.toHaveProperty("status");
    expect(values).not.toHaveProperty("rowVersion");
  });
});

describe("readOfferValues", () => {
  it("leser bestillingsfeltene og «Gyldig til»", () => {
    const formData = new FormData();
    formData.set("addressText", "Testveien 12, 8000 Bodø");
    formData.set("validUntil", "2026-12-03");
    const values = readOfferValues(formData);
    expect(values.addressText).toBe("Testveien 12, 8000 Bodø");
    expect(values.validUntil).toBe("2026-12-03");
    expect(Object.keys(values).sort()).toEqual([...ORDER_FORM_TEXT_FIELDS, "validUntil"].sort());
  });

  it("manglende «Gyldig til» blir tom tekst", () => {
    expect(readOfferValues(new FormData()).validUntil).toBe("");
  });
});
