import { describe, expect, it } from "vitest";
import { OVERRIDE_SUMMARY_TEXT_MAX_CHARS } from "@/db/schema";
import {
  OVERRIDE_SUMMARY_TEXT_MAX_LENGTH,
  OVERRIDE_SUMMARY_TEXT_MESSAGES,
  validateSummaryText,
} from "./summary-text";

/*
 * Enhetstester for kontrollen av lederens tekst (docs/funksjoner/fase2a-overstyringer-leder-testplan.md
 * avsnitt 1d, O1.9 og O1.10). Støtter hovedmål: de ansatte (ingen ansatt pekes ut med navn i
 * fagmøtet) og KI i bunnen (samme krav som KI-teksten). Oppdiktede navn og tall.
 */

const NAMES = ["Åse Testesen", "Per Olav Prøvesen"];

describe("O1.9 validateSummaryText, én test per tilfelle", () => {
  it("over 2000 tegn avvises, 2000 tegn godtas", () => {
    expect(validateSummaryText("a".repeat(2001), NAMES)).toBe("too_long");
    expect(validateSummaryText("a".repeat(2000), NAMES)).toBeNull();
  });

  it("grensen er samme tall som CHECK-regelen", () => {
    expect(OVERRIDE_SUMMARY_TEXT_MAX_LENGTH).toBe(OVERRIDE_SUMMARY_TEXT_MAX_CHARS);
  });

  it.each(["01019012345", "010190 12345", "010190.12345", "010190-12345"])(
    "elleve sifre på rad avvises: %s",
    (number) => {
      expect(validateSummaryText(`Saken gjaldt ${number} i oktober.`, NAMES)).toBe("id_number");
    },
  );

  it("e-post avvises", () => {
    expect(validateSummaryText("Spør ase.testesen@eksempel.no om saken.", NAMES)).toBe("email");
  });

  it.each(["12345678", "+47 123 45 678", "123 45 678"])("telefon avvises: %s", (phone) => {
    expect(validateSummaryText(`Ring ${phone} ved spørsmål.`, NAMES)).toBe("phone");
  });

  it.each([
    "Åse Testesen krysset bort flest sperrer.",
    "åse testesen krysset bort flest sperrer.",
    "ÅSE TESTESEN krysset bort flest sperrer.",
    "Ifølge Per Olav Prøvesen gjelder det bad.",
    "Ifølge Per Prøvesen gjelder det bad.",
  ])("navn på ansatt avvises: %s", (text) => {
    expect(validateSummaryText(text, NAMES)).toBe("employee_name");
  });

  it("del av et ord eller bare fornavn stoppes ikke", () => {
    expect(validateSummaryText("Åse var ikke med; Testesenes rutine gjelder.", NAMES)).toBeNull();
  });

  it("plassholder fra vasken avvises", () => {
    expect(validateSummaryText("Gjelder [adresse] i oktober.", NAMES)).toBe("placeholder");
  });

  it("tall som «7 av 18» og «39 %» godtas", () => {
    expect(
      validateSummaryText(
        "Hulltaking mangler ble krysset bort i 7 av 18 rapporter (39 %), opp fra 2 i september.",
        NAMES,
      ),
    ).toBeNull();
  });

  it.each(["", "   ", "\n\t"])("tom tekst godtas ikke: %j", (text) => {
    expect(validateSummaryText(text, NAMES)).toBe("empty");
  });

  it("hver feil har en norsk melding", () => {
    expect(OVERRIDE_SUMMARY_TEXT_MESSAGES.employee_name).toBe(
      "Oppsummeringen kan ikke inneholde navn på ansatte.",
    );
    for (const message of Object.values(OVERRIDE_SUMMARY_TEXT_MESSAGES)) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("O1.10 meldingen lekker ikke", () => {
  it("ingen melding nevner navnet eller tallet som ble funnet", () => {
    for (const message of Object.values(OVERRIDE_SUMMARY_TEXT_MESSAGES)) {
      expect(message).not.toContain("Testesen");
      expect(message).not.toContain("Åse");
      expect(message).not.toContain("12345");
      expect(message).not.toContain("@");
    }
  });
});
