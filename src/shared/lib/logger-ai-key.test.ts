import { describe, expect, it } from "vitest";
import { TEST_ANTHROPIC_KEY } from "../../../tests/fake-anthropic";
import { createLogger, formatLogLine, scrubText } from "./logger";

/*
 * Loggeren skjuler nøkkelformatet til KI-leverandøren (docs/funksjoner/fase2a-ki-leverandor-
 * testplan.md 1.4, kortet Omfang 8, A4). Ekstra sikring: adapteren logger aldri nøkkelen, men
 * havner den i en melding likevel, skal den ikke stå i loggen. Nøkkelen er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (nøkkelen lekker aldri, så ekte KI kan slås på trygt).
 */

describe("loggeren og nøkkelen til KI-leverandøren (1.4)", () => {
  it("nøkkelen i en loggmelding skjules", () => {
    const line = formatLogLine("error", `Kallet feilet med nøkkel ${TEST_ANTHROPIC_KEY} i teksten`);
    expect(JSON.stringify(line)).not.toContain(TEST_ANTHROPIC_KEY);
    expect(JSON.stringify(line)).not.toContain("OPPDIKTET-TESTNOKKEL");
    expect(line.msg).toContain("Kallet feilet med nøkkel");
  });

  it("nøkkelen i et felt med vanlig navn skjules", () => {
    const line = formatLogLine("warn", "KI-kallet ga feil", {
      detail: `x ${TEST_ANTHROPIC_KEY} y`,
      nested: { note: TEST_ANTHROPIC_KEY },
    });
    expect(JSON.stringify(line)).not.toContain(TEST_ANTHROPIC_KEY);
  });

  it("nøkkelen i en feil skjules", () => {
    const lines: string[] = [];
    const log = createLogger((_level, text) => lines.push(text));
    log.error("feil", { error: new Error(`avvist: ${TEST_ANTHROPIC_KEY}`) });
    expect(lines.join("\n")).not.toContain(TEST_ANTHROPIC_KEY);
  });

  it("scrubText skjuler nøkkelen, også rett etter et skilletegn", () => {
    for (const text of [
      TEST_ANTHROPIC_KEY,
      `"${TEST_ANTHROPIC_KEY}"`,
      `key=${TEST_ANTHROPIC_KEY}&x=1`,
      `(${TEST_ANTHROPIC_KEY})`,
    ]) {
      expect(scrubText(text), text).not.toContain("OPPDIKTET-TESTNOKKEL");
    }
  });

  it("mønsteret er ikke for grådig: vanlig tekst som begynner med sk- skjules ikke", () => {
    for (const text of ["sk-ant", "sk-1", "Rommet sk-bad er ferdig"]) {
      expect(scrubText(text), text).toBe(text);
    }
  });
});
