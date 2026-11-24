import { describe, expect, it } from "vitest";
import { publishFindingKey } from "@/core/reports/logic";
import type { PublishCheckFinding } from "@/core/reports/logic";
import type { PublishFindingView } from "@/core/reports/publish-types";
import {
  abilityNotice,
  addedAnchorsOf,
  anchorOf,
  barState,
  blockersMissingReason,
  carryOverrides,
  EMPTY_OVERRIDE,
  findingText,
  formatDate,
  groupByRoom,
  openBlockers,
  overrideError,
  overridesToSend,
  quickFixOf,
  type DraftCheck,
  type OverrideState,
} from "./publish-model";
import { PUBLISH_LINK_TEXTS, PUBLISH_TEXTS } from "./publish-texts";

/*
 * Tilstanden på publiser-siden (docs/funksjoner/fase2a-publisering-badet-design.md avsnitt 6–12,
 * testplanen E3, E4, E7 og E9 som enhetstester): hovedknappens tekst i fast rekkefølge, hvilke
 * grunner som sendes, at grunner står igjen for samme mangel, «Rett nå» bare der det er opplagt,
 * og at TG aldri er forhåndsvalgt. Testdata er oppdiktet.
 * Støtter hovedmål: færre reklamasjoner (sperren passeres bare med aktiv bryter og gyldig grunn)
 * og de ansatte (knappen sier hvorfor, med tall).
 */

const ROOM = "0190a000-0000-7000-8000-0000000000a1";
const ROOM_2 = "0190a000-0000-7000-8000-0000000000a2";
const CP_ID = "0190a000-0000-7000-8000-0000000000c1";
const DEV = "0190a000-0000-7000-8000-0000000000d1";

function finding(
  checkCode: PublishCheckFinding["checkCode"],
  severity: "blocker" | "warning",
  target: Partial<PublishCheckFinding["target"]> = {},
  extra: Partial<PublishFindingView> = {},
): PublishFindingView {
  const full: PublishCheckFinding = {
    checkCode,
    severity,
    source: "rule",
    target: {
      roomId: null,
      checkpointId: null,
      checkpointKey: null,
      deviationId: null,
      ruleKey: null,
      aiUsageId: null,
      missing: [],
      ...target,
    },
  };
  return {
    ...full,
    key: publishFindingKey(full),
    href: full.target.roomId ? `/oppdrag/x/rom/${full.target.roomId}?fra=publiser` : null,
    roomName: full.target.roomId ? "Bad oppdiktet" : null,
    checkpointLabel: full.target.checkpointKey ? "Membran og sluk" : null,
    deviationNumber: null,
    deviationTg: null,
    previousOverride: null,
    ...extra,
  };
}

const HOLE = finding("wet_or_below_ground_missing_hole", "blocker", {
  roomId: ROOM,
  missing: ["hole_drilling"],
});
const COST = finding(
  "tg3_missing_cost",
  "blocker",
  { roomId: ROOM, checkpointId: CP_ID, checkpointKey: "wet_room.membrane_drain", deviationId: DEV },
  { deviationNumber: 1, deviationTg: 3 },
);
const NO_TG = finding("mandatory_without_tg", "blocker", {
  roomId: ROOM,
  checkpointId: CP_ID,
  checkpointKey: "wet_room.membrane_drain",
  missing: ["tg"],
});
const DATE = finding("inspection_date_missing", "blocker");
const WARN = finding("hole_reading_missing", "warning", { roomId: ROOM });

function check(findings: PublishFindingView[], extra: Partial<DraftCheck> = {}): DraftCheck {
  return {
    state: "draft",
    reportId: "0190a000-0000-7000-8000-0000000000f1",
    nextVersionNumber: 1,
    validUntil: "2027-06-15",
    validUntilInherited: false,
    findings,
    summary: {
      blockers: findings.filter((f) => f.severity === "blocker").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
    },
    fingerprint: "a".repeat(64),
    hasWetRoom: true,
    preview: [],
    pendingAiSuggestions: [],
    ability: { allowed: true, certificationId: "0190a000-0000-7000-8000-0000000000e1" },
    canEdit: true,
    ...extra,
  };
}

const on = (reasonCode: OverrideState["reasonCode"], text = ""): OverrideState => ({
  ...EMPTY_OVERRIDE,
  on: true,
  reasonCode,
  text,
});

describe("hovedknappen (design avsnitt 12, E4, E7)", () => {
  const base = { online: true, pendingChanges: 0, publishing: false };

  it("uten mangler: «Publiser versjon 1»", () => {
    expect(barState({ ...base, check: check([WARN]), overrides: new Map() })).toEqual({
      kind: "ready",
      status: PUBLISH_TEXTS.allSaved,
      label: "Publiser versjon 1",
    });
  });

  it("sperrer igjen: tallet i knappen og fokus til første sperre", () => {
    const state = barState({ ...base, check: check([HOLE, COST]), overrides: new Map() });
    expect(state).toMatchObject({
      kind: "blockers",
      label: "Publiser (2 må rettes eller krysses bort)",
      announcement: "2 må rettes eller krysses bort.",
      focusKey: HOLE.key,
    });
  });

  it("bryter på uten grunn: «Publiser (1 mangler grunn)»", () => {
    const overrides = new Map([[HOLE.key, on(null)]]);
    expect(barState({ ...base, check: check([HOLE]), overrides })).toMatchObject({
      kind: "missing_reason",
      label: "Publiser (1 mangler grunn)",
      focusKey: HOLE.key,
    });
  });

  it("«Annet» krever tekst før knappen åpnes", () => {
    const short = new Map([[HOLE.key, on("other", "kort")]]);
    expect(barState({ ...base, check: check([HOLE]), overrides: short }).kind).toBe(
      "missing_reason",
    );
    const ok = new Map([[HOLE.key, on("other", "Eier nektet hulltaking på stedet.")]]);
    expect(barState({ ...base, check: check([HOLE]), overrides: ok }).kind).toBe("ready");
  });

  it("fast grunn uten tekst er nok (4 trykk)", () => {
    const overrides = new Map([[HOLE.key, on("no_access_or_refused")]]);
    expect(barState({ ...base, check: check([HOLE]), overrides }).kind).toBe("ready");
  });

  it("rekkefølgen: rett eller sertifisering, publiserer, uten nett, synk, sperrer", () => {
    const blocked = check([HOLE]);
    expect(
      barState({
        ...base,
        online: false,
        pendingChanges: 2,
        check: { ...blocked, ability: { allowed: false, reason: "missing_permission" } },
        overrides: new Map(),
      }).kind,
    ).toBe("not_allowed");
    expect(
      barState({ ...base, online: false, pendingChanges: 2, check: blocked, overrides: new Map() }),
    ).toMatchObject({ kind: "offline", status: PUBLISH_TEXTS.offline });
    expect(
      barState({ ...base, pendingChanges: 3, check: blocked, overrides: new Map() }),
    ).toMatchObject({ kind: "waiting_for_sync", status: "Venter på synk (3 endringer)" });
    expect(
      barState({ ...base, pendingChanges: 1, check: blocked, overrides: new Map() }),
    ).toMatchObject({ status: "Venter på synk (1 endring)" });
    expect(barState({ ...base, publishing: true, check: blocked, overrides: new Map() }).kind).toBe(
      "publishing",
    );
  });

  it("versjon 2 står i knappen", () => {
    const state = barState({
      ...base,
      check: check([], { nextVersionNumber: 2 }),
      overrides: new Map(),
    });
    expect(state).toMatchObject({ label: "Publiser versjon 2" });
  });
});

describe("grunnene som sendes", () => {
  it("bare sperrer med bryteren på og gyldig grunn; teksten trimmes og tom blir null", () => {
    const overrides = new Map<string, OverrideState>([
      [HOLE.key, on("described_elsewhere", "   ")],
      [COST.key, { ...on("other", "Kostnaden avklares med eier senere."), on: false }],
      [WARN.key, on("other", "Advarsler kan ikke krysses bort.")],
    ]);
    expect(overridesToSend(check([HOLE, COST, WARN]), overrides)).toEqual([
      { findingKey: HOLE.key, reasonCode: "described_elsewhere", text: null },
    ]);
  });

  it("feilteksten følger samme regel som serveren", () => {
    expect(overrideError(on(null))).toBe("Velg en grunn.");
    expect(overrideError(on("other", "kort"))).toBe("Skriv minst 10 tegn.");
    expect(overrideError(on("other", "x".repeat(1001)))).toMatch(
      /^Teksten er for lang\. Grensen er 1\s000 tegn\.$/u,
    );
    expect(overrideError(on("not_applicable_to_room", "010199 12345"))).toBe(
      "Teksten ser ut til å inneholde et fødselsnummer. Fjern det.",
    );
    expect(overrideError(on("not_applicable_to_room"))).toBeNull();
  });

  it("åpne sperrer og sperrer som mangler grunn telles hver for seg", () => {
    const overrides = new Map([[HOLE.key, on(null)]]);
    const c = check([HOLE, COST]);
    expect(openBlockers(c, overrides).map((f) => f.key)).toEqual([COST.key]);
    expect(blockersMissingReason(c, overrides).map((f) => f.key)).toEqual([HOLE.key]);
  });
});

describe("listen er oppdatert (F3)", () => {
  it("grunnen står igjen for samme mangel, faller bort for borte funn, og nye sperrer merkes", () => {
    const overrides = new Map<string, OverrideState>([
      [HOLE.key, on("no_access_or_refused", "Påbegynt tekst")],
      [COST.key, on("described_elsewhere")],
    ]);
    const carried = carryOverrides([HOLE, COST], [HOLE, NO_TG], overrides);
    expect([...carried.overrides.keys()]).toEqual([HOLE.key]);
    expect(carried.overrides.get(HOLE.key)?.text).toBe("Påbegynt tekst");
    expect([...carried.added]).toEqual([NO_TG.key]);
  });

  it("samme mangel som endrer form (hulltaking → grunn mangler) merkes ikke som ny", () => {
    const changed = finding("wet_or_below_ground_missing_hole", "blocker", {
      roomId: ROOM,
      missing: ["hole_drilling_reason"],
    });
    expect(anchorOf(changed)).toBe(anchorOf(HOLE));
    expect([...addedAnchorsOf([HOLE], [changed])]).toEqual([]);
    expect([...addedAnchorsOf([HOLE], [HOLE, COST])]).toEqual([anchorOf(COST)]);
  });
});

describe("«Rett nå» (F2)", () => {
  it("bare der rettingen er opplagt", () => {
    expect(quickFixOf(HOLE)).toEqual({ kind: "hole_drilling", roomId: ROOM });
    expect(quickFixOf(COST)).toEqual({ kind: "cost", roomId: ROOM, deviationId: DEV });
    expect(quickFixOf(NO_TG)).toEqual({
      kind: "checkpoint_tg",
      roomId: ROOM,
      checkpointKey: "wet_room.membrane_drain",
    });
    const devTg = finding("mandatory_without_tg", "blocker", {
      roomId: ROOM,
      checkpointId: CP_ID,
      checkpointKey: "wet_room.membrane_drain",
      deviationId: DEV,
      missing: ["tg"],
    });
    expect(quickFixOf(devTg)).toEqual({ kind: "deviation_tg", roomId: ROOM, deviationId: DEV });
  });

  it("ingen «Rett nå» når tekst trengs, eller for rapporten", () => {
    const tgiu = finding("mandatory_without_tg", "blocker", {
      roomId: ROOM,
      checkpointId: CP_ID,
      checkpointKey: "wet_room.adjacent",
      missing: ["reason"],
    });
    const note = finding("wet_or_below_ground_missing_hole", "blocker", {
      roomId: ROOM,
      missing: ["hole_drilling_reason_note"],
    });
    const cause = finding("tg2_tg3_missing_cause_or_consequence", "blocker", {
      roomId: ROOM,
      deviationId: DEV,
      missing: ["cause_text"],
    });
    expect(quickFixOf(tgiu)).toBeNull();
    expect(quickFixOf(note)).toBeNull();
    expect(quickFixOf(cause)).toBeNull();
    expect(quickFixOf(DATE)).toBeNull();
  });
});

describe("visningen", () => {
  it("funnteksten har avviksnummer og TG", () => {
    expect(findingText(COST)).toBe("Avvik 1 (TG3) mangler kostnad.");
    expect(findingText(HOLE)).toBe("Hulltaking er ikke besvart.");
  });

  it("gruppene følger rekkefølgen fra sjekken, med «Rapporten» for befaringsdatoen", () => {
    const other = finding("wet_or_below_ground_missing_hole", "blocker", {
      roomId: ROOM_2,
      missing: ["hole_drilling"],
    });
    const groups = groupByRoom([DATE, HOLE, COST, other]);
    expect(groups.map((g) => [g.id, g.heading, g.items.length])).toEqual([
      ["report", "Rapporten", 1],
      [ROOM, "Bad oppdiktet", 2],
      [ROOM_2, "Bad oppdiktet", 1],
    ]);
  });

  it("meldingen øverst sier hvorfor den ansatte ikke kan publisere (F5)", () => {
    expect(abilityNotice(check([]))).toBeNull();
    expect(
      abilityNotice(check([], { ability: { allowed: false, reason: "missing_permission" } })),
    ).toBe(PUBLISH_TEXTS.noPermission);
    expect(
      abilityNotice(
        check([], {
          ability: { allowed: false, reason: "no_valid_certification", expiredOn: "2026-11-01" },
        }),
      ),
    ).toBe(
      "Du kan ikke publisere: sertifiseringen din gikk ut 01.11. En kollega med gyldig sertifisering kan publisere.",
    );
    expect(
      abilityNotice(
        check([], {
          ability: { allowed: false, reason: "no_valid_certification", expiredOn: null },
        }),
      ),
    ).toBe(PUBLISH_TEXTS.certificationMissing);
  });

  it("datoer og tellemerket", () => {
    expect(formatDate("2027-06-15")).toBe("15.06.2027");
    expect(PUBLISH_LINK_TEXTS.badge(2, 3)).toBe("2 må rettes, 3 bør sees over");
    expect(PUBLISH_LINK_TEXTS.badge(0, 0)).toBe("Ingen mangler");
    expect(PUBLISH_LINK_TEXTS.badge(0, 3)).toBe("3 bør sees over");
    expect(PUBLISH_LINK_TEXTS.back(2)).toBe("Tilbake til publisering (2 igjen)");
    expect(PUBLISH_LINK_TEXTS.back(0)).toBe("Tilbake til publisering (alt rettet)");
  });
});
