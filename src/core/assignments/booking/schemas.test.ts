import { describe, expect, it } from "vitest";
import type { ZodError } from "zod";
import { orderInputSchema } from "@/core/orders";
import { TEST_NOW } from "../../../../tests/factories";
import { bookingInputSchema, createAssignmentInputSchema } from "./schemas";

/*
 * Felles bestillingsregler for ordre og oppdrag (testplan for «Nytt oppdrag» 1.1, ADR 0011). Rene
 * tester uten database. Ordren og «Nytt oppdrag» skal godta og avvise det samme med samme
 * feilsti og samme melding, og meldingen har aldri verdien. Oppdiktede verdier.
 *
 * Støtter hovedmål: de ansatte (samme regler og meldinger i begge skjemaene) og KI i bunnen
 * (ingen fødselsnummer i bestillingsfeltene).
 */

const NOW = TEST_NOW;
const OFFICE = "0190a000-0000-7000-8000-000000000030";
const INSPECTOR = "0190a000-0000-7000-8000-000000000031";
const KEY = "0190a000-0000-7000-8000-000000000060";

const orderSchema = orderInputSchema(NOW);
const assignmentSchema = createAssignmentInputSchema(NOW);

/** Feltene oppdraget krever i tillegg til bestillingen. */
const ASSIGNMENT_EXTRA = { officeId: OFFICE, responsibleEmployeeId: INSPECTOR };

function issues(error: ZodError | undefined): [string, string][] {
  return (error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]);
}

/** Resultatet for ordre og oppdrag: om det godtas, og feilsti med melding for bookingfeltene. */
function both(input: Record<string, unknown>) {
  const order = orderSchema.safeParse(input);
  const assignment = assignmentSchema.safeParse({ ...input, ...ASSIGNMENT_EXTRA });
  return { order, assignment };
}

const SAME_CASES: [string, Record<string, unknown>][] = [
  ["gyldig med bare adresse", { addressText: "Testveien 12, 8000 Bodø" }],
  [
    "gyldig med alle felt",
    {
      addressText: "Prøvegata 3",
      gnr: "9001",
      bnr: "1",
      snr: "2",
      orderedByText: "Megler Oppdiktet",
      externalRef: "ORD-2026-0001",
      housingAssociationName: "Prøvetunet Borettslag",
      receivedAt: "2026-11-02T08:00",
    },
  ],
  ["tom adresse", { addressText: "" }],
  ["adresse med bare mellomrom", { addressText: "   " }],
  ["adresse som mangler", {}],
  ["adresse over 300 tegn", { addressText: "a".repeat(301) }],
  ["adresse på 300 tegn", { addressText: "a".repeat(300) }],
  ["gnr med bokstav", { addressText: "Testveien 12", gnr: "12a" }],
  ["bnr med bindestrek", { addressText: "Testveien 12", bnr: "1-2" }],
  ["snr over ti sifre", { addressText: "Testveien 12", snr: "12345678901" }],
  ["tom gnr blir null", { addressText: "Testveien 12", gnr: "  " }],
  ["bestiller over 200 tegn", { addressText: "Testveien 12", orderedByText: "b".repeat(201) }],
  ["mottatt frem i tid", { addressText: "Testveien 12", receivedAt: "2026-11-04T10:00" }],
  ["mottatt ugyldig", { addressText: "Testveien 12", receivedAt: "i går" }],
  ["kontakt som ikke er uuid", { addressText: "Testveien 12", orderedByContactId: "kontakt-1" }],
];

describe("1.1.1 ordre og oppdrag godtar og avviser det samme", () => {
  it.each(SAME_CASES)("%s", (_name, input) => {
    const { order, assignment } = both(input);
    expect(assignment.success).toBe(order.success);
    expect(issues(assignment.error)).toEqual(issues(order.error));
    if (order.success && assignment.success) {
      for (const key of [
        "addressText",
        "gnr",
        "bnr",
        "snr",
        "orderedByText",
        "externalRef",
        "housingAssociationName",
        "orderedByContactId",
        "receivedAt",
      ] as const) {
        expect(assignment.data[key], key).toEqual(order.data[key]);
      }
    }
  });

  it("ordreskjemaet er den felles regelen (ingen kopi)", () => {
    expect(orderInputSchema).toBe(bookingInputSchema);
  });
});

describe("1.1.2 påkrevd adresse", () => {
  it.each([
    ["", "Skriv inn adressen."],
    ["   ", "Skriv inn adressen."],
    ["a".repeat(301), "Adressen kan ha høyst 300 tegn."],
  ])("«%s» avvises ved addressText", (addressText, message) => {
    const result = assignmentSchema.safeParse({ addressText, ...ASSIGNMENT_EXTRA });
    expect(result.success).toBe(false);
    expect(issues(result.error)).toEqual([["addressText", message]]);
  });

  it("adressen trimmes", () => {
    const result = assignmentSchema.parse({ addressText: "  Testveien 12  ", ...ASSIGNMENT_EXTRA });
    expect(result.addressText).toBe("Testveien 12");
  });
});

describe("1.1.3 matrikkel", () => {
  it.each([
    ["gnr", "12a", "Gårdsnummer kan bare ha sifre."],
    ["bnr", "1 2", "Bruksnummer kan bare ha sifre."],
    ["snr", "-1", "Seksjonsnummer kan bare ha sifre."],
  ])("%s «%s» avvises", (field, value, message) => {
    const result = assignmentSchema.safeParse({
      addressText: "Testveien 12",
      [field]: value,
      ...ASSIGNMENT_EXTRA,
    });
    expect(issues(result.error)).toEqual([[field, message]]);
  });

  it("bnr uten gnr behandles likt for ordre og oppdrag", () => {
    const { order, assignment } = both({ addressText: "Testveien 12", bnr: "1" });
    expect(assignment.success).toBe(order.success);
    expect(issues(assignment.error)).toEqual(issues(order.error));
  });
});

describe("1.1.4 elleve sifre avvises i fritekstfeltene", () => {
  const FIELDS = ["addressText", "orderedByText", "externalRef", "housingAssociationName"] as const;
  const ELEVEN = ["12345678901", "123456 78901", "Ref 01020312345"];

  it.each(FIELDS.flatMap((field) => ELEVEN.map((value) => [field, value] as const)))(
    "%s med «%s» avvises for ordre og oppdrag, uten verdien i meldingen",
    (field, value) => {
      const input = { addressText: "Testveien 12", [field]: value };
      const { order, assignment } = both(input);
      for (const result of [order, assignment]) {
        expect(result.success).toBe(false);
        expect(issues(result.error)).toEqual([[field, "Fødselsnummer skal ikke lagres her."]]);
        expect(JSON.stringify(result.error?.issues)).not.toContain(value.replace(/\D/g, ""));
        expect(result.error?.message ?? "").not.toContain(value);
      }
    },
  );

  it.each(
    FIELDS.flatMap((field) =>
      ["4791234567", "123456789012", "Tlf 41 23 45 67"].map((value) => [field, value] as const),
    ),
  )("%s med «%s» (ti eller tolv sifre) godtas", (field, value) => {
    const { order, assignment } = both({ addressText: "Testveien 12", [field]: value });
    expect(order.success).toBe(true);
    expect(assignment.success).toBe(true);
  });
});

describe("1.1.5–1.1.8 feltene bare for oppdraget", () => {
  it("rapporttype: bare condition_report, og den settes når den mangler", () => {
    expect(
      assignmentSchema.parse({ addressText: "Testveien 12", ...ASSIGNMENT_EXTRA }).reportType,
    ).toBe("condition_report");
    expect(
      assignmentSchema.parse({
        addressText: "Testveien 12",
        reportType: "condition_report",
        ...ASSIGNMENT_EXTRA,
      }).reportType,
    ).toBe("condition_report");
    for (const reportType of ["value_report", "CONDITION_REPORT", 1]) {
      const result = assignmentSchema.safeParse({
        addressText: "Testveien 12",
        reportType,
        ...ASSIGNMENT_EXTRA,
      });
      expect(issues(result.error)).toEqual([["reportType", "Velg rapporttype."]]);
    }
  });

  it.each([
    [undefined, null],
    ["", null],
    ["   ", null],
  ])("befaring %j gir null", (inspectionAt, expected) => {
    const result = assignmentSchema.parse({
      addressText: "Testveien 12",
      inspectionAt,
      ...ASSIGNMENT_EXTRA,
    });
    expect(result.inspectionAt).toBe(expected);
  });

  it("gyldig befaring blir en dato, ugyldig avvises", () => {
    const ok = assignmentSchema.parse({
      addressText: "Testveien 12",
      inspectionAt: "2026-11-20T09:00",
      ...ASSIGNMENT_EXTRA,
    });
    expect(ok.inspectionAt).toBeInstanceOf(Date);
    const bad = assignmentSchema.safeParse({
      addressText: "Testveien 12",
      inspectionAt: "neste uke",
      ...ASSIGNMENT_EXTRA,
    });
    expect(bad.success).toBe(false);
    expect(issues(bad.error).map(([path]) => path)).toEqual(["inspectionAt"]);
  });

  it("engangsnøkkel: valgfri uuid, tom blir null, annet avvises", () => {
    const base = { addressText: "Testveien 12", ...ASSIGNMENT_EXTRA };
    expect(assignmentSchema.parse(base).creationKey).toBeNull();
    expect(assignmentSchema.parse({ ...base, creationKey: "" }).creationKey).toBeNull();
    expect(assignmentSchema.parse({ ...base, creationKey: KEY }).creationKey).toBe(KEY);
    const bad = assignmentSchema.safeParse({ ...base, creationKey: "nøkkel-1" });
    expect(issues(bad.error)).toEqual([
      ["creationKey", "Skjemaet er ugyldig. Last siden på nytt."],
    ]);
  });

  it.each([
    ["officeId", "Velg kontor."],
    ["responsibleEmployeeId", "Velg ansvarlig takstmann."],
  ])("%s mangler eller er ugyldig: «%s»", (field, message) => {
    for (const value of [undefined, "", "kontor-1"]) {
      const result = assignmentSchema.safeParse({
        addressText: "Testveien 12",
        ...ASSIGNMENT_EXTRA,
        [field]: value,
      });
      expect(issues(result.error)).toEqual([[field, message]]);
    }
  });

  it("1.1.8 felt som aldri tas fra skjemaet finnes ikke i resultatet", () => {
    const result = assignmentSchema.parse({
      addressText: "Testveien 12",
      ...ASSIGNMENT_EXTRA,
      organizationId: "0190a000-0000-7000-8000-000000000099",
      number: "2026-99999",
      status: "invoiced",
      source: "email",
      issuingCompanyId: "0190a000-0000-7000-8000-000000000098",
      orderedByFirmId: "0190a000-0000-7000-8000-000000000097",
      companyId: "0190a000-0000-7000-8000-000000000096",
      orderId: "0190a000-0000-7000-8000-000000000095",
    });
    for (const key of [
      "organizationId",
      "number",
      "status",
      "source",
      "issuingCompanyId",
      "orderedByFirmId",
      "companyId",
      "orderId",
    ]) {
      expect(result, key).not.toHaveProperty(key);
    }
  });

  it("egenerklæringen er ikke med i «Nytt oppdrag»", () => {
    const result = assignmentSchema.parse({
      addressText: "Testveien 12",
      sellerDeclarationReceived: "on",
      ...ASSIGNMENT_EXTRA,
    });
    expect(result).not.toHaveProperty("sellerDeclarationReceived");
  });
});
