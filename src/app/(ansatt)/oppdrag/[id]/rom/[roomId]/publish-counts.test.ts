import { describe, expect, it } from "vitest";
import type { PublishCheckRoom } from "@/core/reports/logic";
import { publishCounts } from "./room-model";

/*
 * Tellemerket «Se over og publiser» på rommet (docs/funksjoner/fase2a-publisering-badet-design.md
 * avsnitt 14, testplanen E1): rommet regnes lokalt med `computePublishCheck`, resten av rapporten
 * kommer fra serveren. Befaringsdatoen telles bare én gang (den står i resten). Testdata er
 * oppdiktet.
 * Støtter hovedmål: de ansatte (riktige tall uten nett) og færre reklamasjoner.
 */

const room = (holeDrilling: PublishCheckRoom["holeDrilling"]): PublishCheckRoom => ({
  roomId: "0190a000-0000-7000-8000-0000000000a1",
  position: 0,
  isWetRoom: true,
  holeDrilling,
  holeReadingMissing: false,
  adjacentTgiuWithReason: false,
  holeCheckpoint: null,
  checkpoints: [],
});

describe("publishCounts", () => {
  it("sperren for hulltaking i rommet telles sammen med resten av rapporten", () => {
    expect(publishCounts(room("unanswered"), { blockers: 1, warnings: 2 })).toEqual({
      blockers: 2,
      warnings: 2,
    });
  });

  it("rettet hulltaking gir ett mindre", () => {
    expect(publishCounts(room("ok"), { blockers: 1, warnings: 2 })).toEqual({
      blockers: 1,
      warnings: 2,
    });
  });

  it("uten mangler: null og null", () => {
    expect(publishCounts(room("ok"), { blockers: 0, warnings: 0 })).toEqual({
      blockers: 0,
      warnings: 0,
    });
  });
});
