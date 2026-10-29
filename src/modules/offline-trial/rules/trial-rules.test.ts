import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listTrialFields, trialForm } from "../trial-form";
import { TRIAL_ONLY_LIMITS, trialRules } from "./trial-rules";

// Prøve E: reglene som data (docs/funksjoner/fase1-prove-e-regler.md pkt. 1, AK 1–2).
// Testplan avsnitt 2.1. Tallene er oppdiktede prøveverdier, ikke fag.

const WATER_HEATER = "trial_water_heater_age";
const MOISTURE = "trial_moisture_floor_limit";

function rule(key: string) {
  const found = trialRules.find((entry) => entry.key === key);
  if (!found) throw new Error(`Fant ikke regelen ${key}`);
  return found;
}

function allMessages(): string[] {
  return trialRules.flatMap((entry) => [
    entry.messages.triggered,
    entry.messages.not_triggered,
    entry.messages.not_evaluated,
  ]);
}

describe("prøvereglene som data", () => {
  it("det finnes nøyaktig to prøveregler med faste koder", () => {
    const keys = trialRules.map((entry) => entry.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect([...keys].sort()).toEqual([MOISTURE, WATER_HEATER].sort());
  });

  it("reglene leser riktig felt og har riktig type", () => {
    expect(rule(WATER_HEATER)).toMatchObject({
      field: "water_heater_age",
      kind: "age_vs_lifespan",
    });
    expect(rule(MOISTURE)).toMatchObject({ field: "moisture_floor", kind: "number_vs_limit" });
  });

  it("feltene finnes i testskjemaet som tallfelt", () => {
    const fields = listTrialFields(trialForm);
    for (const entry of trialRules) {
      const field = fields.find((candidate) => candidate.key === entry.field);
      expect(field, entry.field).toBeDefined();
      expect(field?.type, entry.field).toBe("number");
    }
  });

  it("prøvetallene ligger i TRIAL_ONLY-konstanten", () => {
    expect(rule(WATER_HEATER).limit).toBe(TRIAL_ONLY_LIMITS.water_heater_age_years);
    expect(rule(MOISTURE).limit).toBe(TRIAL_ONLY_LIMITS.moisture_floor_percent);
    expect(TRIAL_ONLY_LIMITS.water_heater_age_years).toBe(7);
    expect(TRIAL_ONLY_LIMITS.moisture_floor_percent).toBe(42);
  });

  it("hver regel er merket som oppdiktet prøveverdi", () => {
    for (const entry of trialRules) {
      expect(entry.source_ref, entry.key).toBe("oppdiktet prøveverdi");
    }
  });

  it("kildefilen merker tallene som oppdiktet", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/modules/offline-trial/rules/trial-rules.ts"),
      "utf8",
    );
    expect(source).toContain("Oppdiktet prøveverdi, ikke fag");
  });

  it("alle meldinger starter med Prøveregel", () => {
    for (const message of allMessages()) {
      expect(message.startsWith("Prøveregel"), message).toBe(true);
    }
  });

  it("meldingene er ordrett som i kortet", () => {
    expect(rule(WATER_HEATER).messages).toEqual({
      triggered: "Prøveregel: over prøvegrensen (7 år)",
      not_triggered: "Prøveregel: ikke over prøvegrensen (7 år)",
      not_evaluated: "Prøveregel: ikke vurdert",
    });
    expect(rule(MOISTURE).messages).toEqual({
      triggered: "Prøveregel: over prøvegrensen (42 %)",
      not_triggered: "Prøveregel: ikke over prøvegrensen (42 %)",
      not_evaluated: "Prøveregel: ikke vurdert",
    });
  });

  // Obligatorisk (AK 2)
  it("ingen gjetteord eller vurderingsord i meldingene", () => {
    for (const message of allMessages()) {
      const lower = message.toLowerCase();
      for (const word of ["antas", "trolig", "avvik", "bør"]) {
        expect(lower, message).not.toContain(word);
      }
      expect(message, message).not.toMatch(/(^|[^\p{L}\p{N}])tg([^\p{L}]|$)/iu);
    }
  });

  it("ingen TG eller utfall i reglene", () => {
    const forbidden = ["tg", "suggest_tgiu", "suggest_outcome", "outcome", "show", "validate"];
    for (const entry of trialRules) {
      const keys = Object.keys(entry).map((key) => key.toLowerCase());
      for (const key of forbidden) {
        expect(keys, entry.key).not.toContain(key);
      }
    }
  });
});
