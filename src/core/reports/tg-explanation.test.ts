import { describe, expect, it } from "vitest";
import { TG_EXPLANATION, TG_EXPLANATION_STATUS_TEXT } from "./tg-explanation";

/*
 * TG-forklaringen i PDF-en (testplanen 3.3, A533). Egne ord, uten gjetteord og uten henvisning til
 * NS 3600. Merket «utkast» står i dataene, ikke i teksten.
 */

const allText = () =>
  [
    TG_EXPLANATION.title,
    ...TG_EXPLANATION.items.flatMap((item) => [item.label, item.text]),
    TG_EXPLANATION.hmsText,
  ].join("\n");

describe("TG-forklaringen (3.3)", () => {
  it("3.3.1 har TG0, TG1, TG2, TG3 og TGIU i den rekkefølgen, og én setning om HMS", () => {
    expect(TG_EXPLANATION.items.map((item) => item.tg)).toEqual(["0", "1", "2", "3", "IU"]);
    expect(TG_EXPLANATION.hmsText).toMatch(/HMS/u);
    expect(TG_EXPLANATION.hmsText).toMatch(/uten tilstandsgrad/u);
    expect(TG_EXPLANATION.hmsText.split(/[.!?](\s|$)/u).filter((s) => s.trim()).length).toBe(1);
  });

  it("3.3.2 TG0 sier «normalt», TG3 nevner kostnadsanslag, TGIU sier hva og hvorfor", () => {
    const text = (tg: string) => TG_EXPLANATION.items.find((item) => item.tg === tg)?.text ?? "";
    expect(text("0")).toMatch(/normalt/u);
    expect(text("3")).toMatch(/kostnadsanslag/u);
    expect(text("IU")).toMatch(/hva som ikke er undersøkt/u);
    expect(text("IU")).toMatch(/hvorfor/u);
  });

  it("3.3.3 status er utkast i dataene, og merket står ikke i teksten til PDF-en", () => {
    expect(TG_EXPLANATION.textStatus).toBe("draft");
    expect(TG_EXPLANATION_STATUS_TEXT).toBe("utkast, ikke godkjent av fagrådet");
    expect(allText()).not.toMatch(/utkast/iu);
    expect(allText()).not.toMatch(/fagrådet/iu);
  });

  it("3.3.4 ingen gjetteord, ingen NS 3600 og ingen paragraftegn", () => {
    const text = allText();
    for (const forbidden of [/antas/iu, /trolig/iu, /sannsynligvis/iu, /NS\s*3600/iu, /§/u]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it("3.3.5 etiketten er «TGIU», aldri «IU» alene", () => {
    const iu = TG_EXPLANATION.items.find((item) => item.tg === "IU");
    expect(iu?.label.startsWith("TGIU")).toBe(true);
    expect(allText()).not.toMatch(/(^|[^G])IU\b/u);
    for (const item of TG_EXPLANATION.items) expect(item.label).toMatch(/^TG/u);
  });
});
