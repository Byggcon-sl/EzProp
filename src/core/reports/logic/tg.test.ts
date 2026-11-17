import { describe, expect, it } from "vitest";
import { parseTemplateDocument } from "@/core/templates";
import type { TgDirect } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { checkDirectTgConflict, computeCheckpointTg, directTgConflictsWithDeviations } from "./tg";
import type { CheckpointTg, DeviationState } from "./types";

/*
 * TG-logikken på kontrollpunktet (testplanen B1.1–B1.4). Ren test uten database. Mykt slettede
 * avvik sendes aldri inn, så «slettet TG3» betyr at avviket ikke står i listen.
 *
 * Hovedmål: færre reklamasjoner (TG regnes likt hver gang, og TGIU overskrives aldri stille).
 * KI setter aldri TG: funksjonene regner bare ut hva som vises.
 */

type Dev = Pick<DeviationState, "kind" | "tg">;
const tg2: Dev = { kind: "tg", tg: 2 };
const tg3: Dev = { kind: "tg", tg: 3 };
const hms: Dev = { kind: "hms", tg: null };
const notChosen: Dev = { kind: "tg", tg: null };

describe("B1.1 computeCheckpointTg", () => {
  it.each<[string, TgDirect | null, Dev[], CheckpointTg | null]>([
    ["tom liste og ingen TG direkte gir tom", null, [], null],
    ["TG2 og TG3 gir 3", null, [tg2, tg3], "3"],
    ["slettet TG3 (ikke sendt inn) og TG2 gir 2", null, [tg2], "2"],
    ["bare HMS og TG1 direkte gir 1", "1", [hms], "1"],
    ["avvik med TG går foran TG0", "0", [tg2], "2"],
    ["avvik med TG går foran TG1", "1", [tg3], "3"],
    ["avvik uten valgt TG teller ikke", null, [notChosen], null],
    ["bare HMS uten TG direkte gir tom", null, [hms], null],
    ["TGIU uten avvik gir IU", "IU", [], "IU"],
    ["TGIU med HMS gir IU", "IU", [hms], "IU"],
  ])("%s", (_name, tgDirect, deviations, expected) => {
    expect(computeCheckpointTg({ tgDirect, deviations: deviations as DeviationState[] })).toBe(
      expected,
    );
  });
});

describe("B1.2 TG0 er aldri et utfall", () => {
  it("ingen utfall i badmalen har TG0, og TG-avvik kan bare være 2 eller 3", () => {
    const parsed = parseTemplateDocument(wetRoomTemplate);
    if (!parsed.success) throw new Error("malen for badet er ugyldig");
    const kinds = new Set(parsed.document.outcomes.map((o) => o.kind));
    expect([...kinds].every((kind) => ["tg2", "tg3", "hms", "choose_tg2_tg3"].includes(kind))).toBe(
      true,
    );
  });

  it("«velg TG2 eller TG3» uten valgt TG gir ingen TG på punktet (ingen stille TG)", () => {
    expect(computeCheckpointTg({ tgDirect: null, deviations: [notChosen as DeviationState] })).toBe(
      null,
    );
  });
});

describe("B1.3 TGIU og TG2/TG3", () => {
  it.each<[string, TgDirect, Dev[], boolean]>([
    ["TGIU med TG2-avvik krever aktivt valg", "IU", [tg2], true],
    ["TG0 med TG3-avvik krever aktivt valg", "0", [tg3], true],
    ["TGIU med HMS er lov", "IU", [hms], false],
    ["TGIU med avvik uten valgt TG gir ingen konflikt", "IU", [notChosen], false],
    ["TGIU uten avvik gir ingen konflikt", "IU", [], false],
    ["TG1 med TG2-avvik gir ingen konflikt (avviket gjelder)", "1", [tg2], false],
  ])("%s", (_name, tgDirect, deviations, expected) => {
    expect(directTgConflictsWithDeviations(tgDirect, deviations)).toBe(expected);
  });

  it("nytt TG-avvik på punkt med TGIU krever aktivt valg; HMS gjør ikke", () => {
    expect(checkDirectTgConflict("IU", "tg")).toBe("choose_tgiu_or_deviation");
    expect(checkDirectTgConflict("IU", "hms")).toBe("none");
  });
});

describe("B1.4 TG-avvik på punkt med TG0 eller TG1", () => {
  it.each<[TgDirect | null, "none" | "clear_direct"]>([
    ["0", "clear_direct"],
    ["1", "clear_direct"],
    [null, "none"],
  ])("TG direkte %s gir %s", (tgDirect, expected) => {
    expect(checkDirectTgConflict(tgDirect, "tg")).toBe(expected);
  });

  it("HMS-avvik tømmer aldri TG direkte", () => {
    expect(checkDirectTgConflict("0", "hms")).toBe("none");
    expect(checkDirectTgConflict("1", "hms")).toBe("none");
  });
});
