import { describe, expect, it } from "vitest";
import { NOTE_MAX_LENGTH, assignmentNoteSchema, assignmentScheduleSchema } from "./schemas";

/*
 * Skjemaene for arbeidskøen: notatet og «Befaring og frist»
 * (docs/funksjoner/fase2a-arbeidsko-testplan.md avsnitt 1.3). Ren enhetstest. Ligger i egen fil ved
 * siden av schemas.test.ts, så skjemaene for partene og køen kan endres hver for seg.
 *
 * Testdata er oppdiktet: «Venter på nøkkel». «Fødselsnummeret» er 12345678901 (elleve sifre, ikke
 * et gyldig nummer). Telefonnummeret 0000000000 har ti sifre.
 *
 * Støtter hovedmål: reklamasjoner (aldri fødselsnummer i notatet, gyldige datoer) og tid (feil
 * vises med én fast norsk tekst).
 */

const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";
const FAKE_NATIONAL_ID = "12345678901";

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

/** Meldingen er norsk: har æ/ø/å eller vanlige norske ord, og ikke Zods engelske standardtekst. */
function expectNorwegian(message: string | undefined) {
  expect(message).toBeTruthy();
  expect(message).not.toMatch(/^(Invalid|Expected|Too big|String must|Required)/);
  expect(message).toMatch(/[æøåÆØÅ]|Skriv|tegn|dato|gyldig|Notatet/);
}

describe("1.3.1 notat: lengde og tom tekst", () => {
  it("grensen er 200 tegn", () => {
    expect(NOTE_MAX_LENGTH).toBe(200);
  });

  it("200 tegn godtas", () => {
    const note = "a".repeat(200);
    expect(assignmentNoteSchema.parse(note)).toBe(note);
  });

  it("201 tegn avvises med norsk melding", () => {
    const result = assignmentNoteSchema.safeParse("a".repeat(201));
    expect(result.success).toBe(false);
    expectNorwegian(messages(result)[0]);
    expect(messages(result)[0]).toContain("200");
  });

  it("teksten trimmes (200 tegn med mellomrom rundt godtas)", () => {
    const note = "b".repeat(200);
    expect(assignmentNoteSchema.parse(`   ${note}  `)).toBe(note);
  });

  it("Venter på nøkkel trimmes", () => {
    expect(assignmentNoteSchema.parse("  Venter på nøkkel ")).toBe("Venter på nøkkel");
  });

  it.each([
    ["tom tekst", ""],
    ["bare mellomrom", "   "],
    ["linjeskift og tabulator", "\n\t "],
    ["null", null],
    ["undefined", undefined],
  ])("%s gir null", (_name, value) => {
    expect(assignmentNoteSchema.parse(value)).toBeNull();
  });
});

describe("1.3.2 notat: fødselsnummer", () => {
  it.each([
    ["alene", FAKE_NATIONAL_ID],
    ["i teksten", `Ring eier ${FAKE_NATIONAL_ID} i morgen`],
    ["med mellomrom rundt", `  ${FAKE_NATIONAL_ID}  `],
    ["delt med mellomrom", "123456 78901"],
  ])("elleve sifre %s avvises med samme melding som partene", (_name, value) => {
    const result = assignmentNoteSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain(NATIONAL_ID);
  });

  it("feilen har ikke sifrene i seg", () => {
    const result = assignmentNoteSchema.safeParse(`Notat ${FAKE_NATIONAL_ID}`);
    expect(JSON.stringify(messages(result))).not.toContain(FAKE_NATIONAL_ID);
  });

  it("ti sifre (telefonnummer) godtas", () => {
    expect(assignmentNoteSchema.parse("Ring 0000000000")).toBe("Ring 0000000000");
  });
});

describe("1.3.3 befaring og frist", () => {
  it("begge tomme gir null", () => {
    expect(assignmentScheduleSchema.parse({ inspectionAt: "", dueDate: "" })).toEqual({
      inspectionAt: null,
      dueDate: null,
    });
  });

  it("begge mangler gir null", () => {
    expect(assignmentScheduleSchema.parse({})).toEqual({ inspectionAt: null, dueDate: null });
  });

  it("null gir null", () => {
    expect(assignmentScheduleSchema.parse({ inspectionAt: null, dueDate: null })).toEqual({
      inspectionAt: null,
      dueDate: null,
    });
  });

  it("gyldig dato og tidspunkt godtas (tekst uten tidssone er norsk tid)", () => {
    const parsed = assignmentScheduleSchema.parse({
      inspectionAt: "2026-11-06T09:00",
      dueDate: "2026-11-10",
    });
    expect(parsed.dueDate).toBe("2026-11-10");
    expect(parsed.inspectionAt).toBeInstanceOf(Date);
    // 09:00 i Oslo om vinteren er 08:00 UTC
    expect((parsed.inspectionAt as Date).toISOString()).toBe("2026-11-06T08:00:00.000Z");
  });

  it("tidspunkt med tidssone og Date godtas", () => {
    const at = new Date("2026-11-06T08:00:00Z");
    expect(assignmentScheduleSchema.parse({ inspectionAt: at }).inspectionAt).toEqual(at);
    expect(
      (
        assignmentScheduleSchema.parse({ inspectionAt: "2026-11-06T08:00:00Z" })
          .inspectionAt as Date
      ).toISOString(),
    ).toBe("2026-11-06T08:00:00.000Z");
  });

  it("sommertid: 09:00 i Oslo i juni er 07:00 UTC", () => {
    const parsed = assignmentScheduleSchema.parse({ inspectionAt: "2026-06-15T09:00" });
    expect((parsed.inspectionAt as Date).toISOString()).toBe("2026-06-15T07:00:00.000Z");
  });

  it.each([
    ["dato som ikke finnes", "2026-13-40"],
    ["30. februar", "2026-02-30"],
    ["fritekst", "neste uke"],
    ["norsk skrivemåte", "10.11.2026"],
  ])("frist: %s avvises med norsk melding", (_name, dueDate) => {
    const result = assignmentScheduleSchema.safeParse({ dueDate });
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0]!;
    expect(issue.path).toEqual(["dueDate"]);
    expectNorwegian(issue.message);
  });

  it.each([
    ["dato som ikke finnes", "2026-13-40T09:00"],
    ["klokkeslett som ikke finnes", "2026-11-06T25:00"],
    ["fritekst", "i morgen tidlig"],
  ])("befaring: %s avvises med norsk melding", (_name, inspectionAt) => {
    const result = assignmentScheduleSchema.safeParse({ inspectionAt });
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0]!;
    expect(issue.path).toEqual(["inspectionAt"]);
    expectNorwegian(issue.message);
  });

  it("ingen regel om rekkefølge: frist før befaring godtas", () => {
    const result = assignmentScheduleSchema.safeParse({
      inspectionAt: "2026-11-20T09:00",
      dueDate: "2026-11-06",
    });
    expect(result.success).toBe(true);
  });

  it("organizationId i input tas bort", () => {
    const parsed = assignmentScheduleSchema.parse({
      dueDate: "2026-11-10",
      organizationId: "0190a000-0000-7000-8000-000000000002",
    } as Record<string, unknown>);
    expect(Object.keys(parsed).sort()).toEqual(["dueDate", "inspectionAt"]);
  });
});
