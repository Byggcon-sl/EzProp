import { describe, expect, it } from "vitest";
import { MERGE_FIELD_KEYS } from "./codes";
import { mergeFieldWarningText } from "./labels";
import { fillMergeFields, mergeFieldsText, mergeFieldValues } from "./merge-fields";

/*
 * Flettefeltene i standardtekstene (testplanen B1.8). Ren test.
 *
 * Hovedmål: færre reklamasjoner (en tekst med `{årstall}` havner aldri i rapporten) og de ansatte
 * (feltet som mangler, står tydelig i teksten).
 */

describe("B1.8 flettefelt", () => {
  it("fyller alle fire felt fra svarene", () => {
    const result = mergeFieldsText(
      "Sjiktet er fra {årstall}. Målt {måleverdi} {enhet} ved {sted}.",
      { årstall: "1990", måleverdi: "18", enhet: "vekt-%", sted: "dusjhjørnet" },
    );
    expect(result).toEqual({
      text: "Sjiktet er fra 1990. Målt 18 vekt-% ved dusjhjørnet.",
      missing: [],
    });
  });

  it.each(MERGE_FIELD_KEYS.map((key) => [key]))(
    "{%s} uten verdi står aldri som {…} og står i missing",
    (key) => {
      for (const value of [undefined, null, "", "   "]) {
        const result = mergeFieldsText(`Før {${key}} etter.`, { [key]: value });
        expect(result.text).not.toMatch(/[{}]/u);
        expect(result.text).toBe(`Før [${key} mangler] etter.`);
        expect(result.missing).toEqual([key]);
      }
    },
  );

  it("to måleverdier i fallteksten fylles begge", () => {
    const result = mergeFieldsText("Fallet er {måleverdi} mm per meter, målt {måleverdi} ganger.", {
      måleverdi: "8",
    });
    expect(result.text).toBe("Fallet er 8 mm per meter, målt 8 ganger.");
    expect(result.missing).toEqual([]);
  });

  it("manglende felt som står to ganger, står én gang i missing", () => {
    expect(mergeFieldsText("{årstall} og {årstall}", {}).missing).toEqual(["årstall"]);
  });

  it("ukjente {…} står som vanlig tekst", () => {
    expect(fillMergeFields("Se {ukjent} her", {})).toEqual([
      { type: "text", text: "Se {ukjent} her" },
    ]);
  });

  it("deler teksten i biter med verdi og manglende felt", () => {
    expect(fillMergeFields("{årstall}: målt {måleverdi}", { årstall: "2001" })).toEqual([
      { type: "value", field: "årstall", text: "2001" },
      { type: "text", text: ": målt " },
      { type: "missing", field: "måleverdi" },
    ]);
  });

  it("tekst uten flettefelt er uendret", () => {
    expect(mergeFieldsText("Ingen felt her.", {})).toEqual({
      text: "Ingen felt her.",
      missing: [],
    });
  });

  it("advarselen sier hvilket felt som mangler", () => {
    expect(mergeFieldWarningText("årstall")).toBe("Fyll inn årstall i teksten.");
  });
});

describe("B1.8 verdiene til flettefeltene fra svarene", () => {
  const labels = (elementKey: string, optionKey: string) =>
    elementKey === "unit" && optionKey === "weight_percent" ? "Vekt-%" : null;

  it("«all» gir begge svarene: «5 og 7,5»; ett svar gir ett tall", () => {
    const sources = { måleverdi: { keys: ["a", "b"], pick: "all" } } as const;
    expect(mergeFieldValues(sources, { a: 5, b: 7.5 }, labels).måleverdi).toBe("5 og 7,5");
    expect(mergeFieldValues(sources, { b: 3 }, labels).måleverdi).toBe("3");
  });

  it("«first» tar første svar som finnes; årstall uten tusenskille", () => {
    const sources = { årstall: { keys: ["own", "fallback"], pick: "first" } } as const;
    expect(mergeFieldValues(sources, { own: 1990, fallback: 1985 }, labels).årstall).toBe("1990");
    expect(mergeFieldValues(sources, { fallback: 1985 }, labels).årstall).toBe("1985");
  });

  it("valg vises med etiketten, aldri koden; tekst trimmes", () => {
    const sources = {
      måleverdi: { keys: ["reading"], pick: "first" },
      enhet: { keys: ["unit"], pick: "first" },
      sted: { keys: ["place"], pick: "first" },
    } as const;
    expect(
      mergeFieldValues(
        sources,
        { reading: 18.4, unit: ["weight_percent"], place: "  Vegg mot gang  " },
        labels,
      ),
    ).toEqual({ måleverdi: "18,4", enhet: "Vekt-%", sted: "Vegg mot gang" });
    expect(mergeFieldValues(sources, { unit: ["unknown"] }, labels)).toEqual({});
  });

  it("uten svar mangler verdien, og teksten får markøren; arvede nøkler leses ikke", () => {
    const sources = { måleverdi: { keys: ["a"], pick: "all" } } as const;
    const answers = Object.create({ a: 9 }) as Record<string, unknown>;
    const values = mergeFieldValues(sources, answers, labels);
    expect(values).toEqual({});
    expect(mergeFieldsText("Målt fall {måleverdi} mm.", values).text).toBe(
      "Målt fall [måleverdi mangler] mm.",
    );
  });
});
