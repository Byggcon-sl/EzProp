import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReportPdfData } from "@/core/pdf";
import { PUBLISH_BLOCKER_CODES, PUBLISH_CHECK_CODES, type PublishCheckCode } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  CAUSE_CRITERION_LABELS,
  publishFindingText,
  TG_NOT_SET_LABEL,
  type PublishCheckFinding,
  type PublishCheckTarget,
} from "./logic";
import { buildReportPdfData, pdfTemplateLabelsOf } from "./pdf-data-build";
import type { BuildReportPdfDataInput, PdfCompanyRow } from "./pdf-types";
import type {
  ReportSnapshot,
  SnapshotAnswer,
  SnapshotCheckpoint,
  SnapshotDeviation,
  SnapshotRoom,
  SnapshotTgiu,
} from "./publish-types";

/*
 * `buildReportPdfData` fra snapshotet (testplanen 3.1, 10.3, 10.4 og 10.7, kortet T1–T26 og A540).
 * Ren funksjon: ingen database, ingen motor. Alle data er oppdiktede.
 */

const NBSP = " ";
const TEMPLATE = pdfTemplateLabelsOf(wetRoomTemplate);
const ASSIGNMENT_ID = uuidv7();
const ROOM_ID = uuidv7();
const REPORT_ID = uuidv7();
const CHECKPOINT_IDS: Record<string, string> = Object.fromEntries(
  wetRoomTemplate.checkpoints.map((c) => [c.key, uuidv7()]),
);
const LABELS: Record<string, string> = Object.fromEntries(
  wetRoomTemplate.checkpoints.map((c) => [c.key, c.name]),
);

const CP = {
  general: "wet_room.general",
  documentation: "wet_room.documentation",
  floor: "wet_room.floor",
  membrane: "wet_room.membrane_drain",
  adjacent: "wet_room.adjacent",
} as const;

// --- Byggere --------------------------------------------------------------------------------

function elementLabel(key: string): string {
  return wetRoomTemplate.elements.find((e) => e.key === key)?.label ?? key;
}

function optionLabel(elementKey: string, key: string): string {
  return (
    wetRoomTemplate.element_options.find((o) => o.element_key === elementKey && o.key === key)
      ?.label ?? key
  );
}

function ans(
  elementKey: string,
  value: { text?: string; number?: number; options?: string[] },
): SnapshotAnswer {
  return {
    element_key: elementKey,
    label: elementLabel(elementKey),
    value_text: value.text ?? null,
    value_number: value.number ?? null,
    value_option_keys: value.options ?? null,
    value_option_labels: value.options?.map((key) => optionLabel(elementKey, key)) ?? null,
    ai: null,
  };
}

function dev(overrides: Partial<SnapshotDeviation> = {}): SnapshotDeviation {
  return {
    id: uuidv7(),
    kind: "tg",
    tg: 2,
    question_key: null,
    outcome_key: null,
    deviation_text: "Avvikstekst",
    cause_criterion: null,
    cause_text: null,
    consequence_text: null,
    cost: { type: "none", band_key: null, amount: null, text: null },
    measurement_value: null,
    measurement_unit: null,
    text_source: "free",
    suggested_by_rule_key: null,
    measures: [],
    ai: {},
    ...overrides,
  };
}

function tgiu(overrides: Partial<SnapshotTgiu> = {}): SnapshotTgiu {
  return {
    reason: "Gulvet var dekket av tunge møbler.",
    owner_informed: null,
    owner_informed_at: null,
    alternative_check_method: null,
    alternative_check_result: null,
    risk_assessment: "Lekkasje kan gi skade i bjelkelaget.",
    construction_vulnerable: null,
    how_to_examine: "Flytt møblene og undersøk på nytt.",
    ai: {},
    ...overrides,
  };
}

function cp(key: string, overrides: Partial<SnapshotCheckpoint> = {}): SnapshotCheckpoint {
  return {
    checkpoint_id: CHECKPOINT_IDS[key]!,
    checkpoint_key: key,
    label: LABELS[key]!,
    tg: null,
    tg_direct: null,
    done: false,
    description_text: null,
    description_ai: null,
    answers: [],
    deviations: [],
    tgiu: null,
    rule_decisions: [],
    ...overrides,
  };
}

function room(checkpoints: SnapshotCheckpoint[], overrides: Partial<SnapshotRoom> = {}) {
  return {
    room_id: ROOM_ID,
    name: "Bad",
    room_type: "bathroom",
    answers: [],
    checkpoints,
    ...overrides,
  } satisfies SnapshotRoom;
}

function snapshot(rooms: SnapshotRoom[], inspectionDate: string | null = "2026-06-15") {
  return {
    schema_version: 1,
    report: {
      report_id: REPORT_ID,
      report_type: "condition_report",
      template_version_id: uuidv7(),
      template_family_id: uuidv7(),
      template_version_number: 1,
      inspection_date: inspectionDate,
    },
    buildings: [
      {
        report_building_id: uuidv7(),
        name: "Hovedhus",
        floors: [{ floor_id: uuidv7(), name: "1. etasje", rooms }],
      },
    ],
  } as ReportSnapshot;
}

const COMPANY: PdfCompanyRow = { legalName: "Testselskap takst AS", orgNumber: "999 111 222" };

function input(
  snap: ReportSnapshot,
  options: Partial<Omit<BuildReportPdfDataInput, "snapshot">> = {},
): BuildReportPdfDataInput {
  return {
    snapshot: snap,
    template: TEMPLATE,
    cover: {
      assignmentId: ASSIGNMENT_ID,
      assignmentNumber: "26-1042",
      addressLines: ["Prøvevegen 1", "8000 Bodø"],
      cadastralText: "Gnr. 12, bnr. 34",
    },
    company: COMPANY,
    findings: null,
    versionNumber: null,
    options: { draft: true },
    ...options,
  };
}

function build(
  checkpoints: SnapshotCheckpoint[],
  options: Partial<Omit<BuildReportPdfDataInput, "snapshot">> = {},
) {
  return buildReportPdfData(input(snapshot([room(checkpoints)]), options));
}

function checkpointIn(data: ReportPdfData, key: string) {
  return data.rooms.flatMap((r) => r.checkpoints).find((c) => c.checkpointKey === key) ?? null;
}

function target(overrides: Partial<PublishCheckTarget> = {}): PublishCheckTarget {
  return {
    roomId: null,
    checkpointId: null,
    checkpointKey: null,
    deviationId: null,
    ruleKey: null,
    aiUsageId: null,
    missing: [],
    ...overrides,
  };
}

function finding(
  checkCode: PublishCheckCode,
  overrides: Partial<PublishCheckTarget> = {},
): PublishCheckFinding {
  const blocker = (PUBLISH_BLOCKER_CODES as readonly string[]).includes(checkCode);
  return {
    checkCode,
    severity: blocker ? "blocker" : "warning",
    source: "rule",
    target: target(overrides),
  };
}

function onCheckpoint(key: string): Partial<PublishCheckTarget> {
  return { roomId: ROOM_ID, checkpointId: CHECKPOINT_IDS[key]!, checkpointKey: key };
}

/** All tekst i dataene, uten kodene (`checkCode`, `elementKey`, id-er og koder for kostnad). */
function visibleText(data: ReportPdfData): string {
  const texts: string[] = [];
  const skip = new Set([
    "checkCode",
    "elementKey",
    "checkpointKey",
    "roomType",
    "type",
    "bandKey",
    "field",
    "textStatus",
    "kind",
    "tg",
  ]);
  const walk = (value: unknown, key: string | null) => {
    if (key && (skip.has(key) || /Id$/u.test(key) || key === "editPath")) return;
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, null));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(data, null);
  return texts.join("\n");
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// --- T1–T26 ---------------------------------------------------------------------------------

describe("buildReportPdfData: testsakene fra fagansvarlig (3.1)", () => {
  it.each([
    [
      "T1 intervall 20 000–100 000",
      "band",
      "from_20000_to_100000",
      null,
      `20${NBSP}000–100${NBSP}000 kr`,
    ],
    ["T2 under 20 000", "band", "under_20000", null, `Under 20${NBSP}000 kr`],
    ["T2 over 500 000", "band", "over_500000", null, `Over 500${NBSP}000 kr`],
    ["T3 eget beløp 40 000", "approx", null, 40000, `ca. 40${NBSP}000 kr`],
    ["T3 eget beløp 37 500 (ikke rundet)", "approx", null, 37500, `ca. 37${NBSP}500 kr`],
  ] as const)("%s", (_name, type, bandKey, amount, expected) => {
    const deviation = dev({ tg: 3, cost: { type, band_key: bandKey, amount, text: null } });
    const data = build([cp(CP.membrane, { tg: "3", deviations: [deviation] })]);
    const result = checkpointIn(data, CP.membrane)!.deviations[0]!;
    expect(result.tg).toBe("3");
    expect(result.cost.displayText).toBe(expected);
  });

  it("T4 TG3 uten kostnad: ingen kostnadstekst; i utkastet «Mangler» med sjekkens tekst", () => {
    const deviation = dev({ tg: 3 });
    const f = finding("tg3_missing_cost", {
      ...onCheckpoint(CP.membrane),
      deviationId: deviation.id,
    });
    const checkpoints = [cp(CP.membrane, { tg: "3", deviations: [deviation] })];
    const draft = checkpointIn(build(checkpoints, { findings: [f] }), CP.membrane)!.deviations[0]!;
    expect(draft.cost.displayText).toBeNull();
    expect(draft.cost.text).toBeNull();
    expect(draft.notes).toEqual([
      {
        kind: "missing",
        checkCode: "tg3_missing_cost",
        text: publishFindingText(f, { deviationNumber: 1, deviationTg: 3 }),
      },
    ]);
    const release = buildReportPdfData(
      input(snapshot([room(checkpoints)]), { findings: [f], options: { draft: false } }),
    );
    expect(checkpointIn(release, CP.membrane)!.deviations[0]!.notes).toEqual([]);
  });

  it("T5 TG2 med årsak, konsekvens og to tiltak: alt med, tiltak i lagret rekkefølge", () => {
    const deviation = dev({
      tg: 2,
      cause_criterion: "symptom_of_damage",
      cause_text: "Sprekk i flisfuge ved sluk.",
      consequence_text: "Vann kan trenge inn i konstruksjonen.",
      measures: [
        { id: uuidv7(), text: "Første tiltak", text_source: "free", ai: null },
        { id: uuidv7(), text: "Andre tiltak", text_source: "free", ai: null },
      ],
    });
    const result = checkpointIn(
      build([cp(CP.floor, { tg: "2", deviations: [deviation] })]),
      CP.floor,
    )!.deviations[0]!;
    expect(result.causeLabel).toBe(CAUSE_CRITERION_LABELS.symptom_of_damage);
    expect(result.causeText).toBe("Sprekk i flisfuge ved sluk.");
    expect(result.consequenceText).toBe("Vann kan trenge inn i konstruksjonen.");
    expect(result.measures).toEqual(["Første tiltak", "Andre tiltak"]);
  });

  it("T6 punkt med TG2- og TG3-avvik viser TG3 fra snapshotet", () => {
    const data = build([
      cp(CP.membrane, { tg: "3", deviations: [dev({ tg: 2 }), dev({ tg: 3 })] }),
    ]);
    expect(checkpointIn(data, CP.membrane)!.tg).toBe("3");
  });

  it("T7 HMS-avvik alene: ingen TG på avviket eller punktet; konsekvens og tiltak med", () => {
    const deviation = dev({
      kind: "hms",
      tg: null,
      consequence_text: "Fare for fall.",
      measures: [{ id: uuidv7(), text: "Sett opp rekkverk.", text_source: "free", ai: null }],
    });
    const checkpoints = [cp(CP.general, { tg: null, deviations: [deviation] })];
    const notSet = finding("mandatory_without_tg", {
      ...onCheckpoint(CP.general),
      missing: ["tg"],
    });
    const draft = checkpointIn(build(checkpoints, { findings: [notSet] }), CP.general)!;
    expect(draft.tg).toBeNull();
    expect(draft.tgNotSet).toBe(true);
    expect(draft.deviations[0]).toMatchObject({
      kind: "hms",
      tg: null,
      tgNotSet: false,
      consequenceText: "Fare for fall.",
      measures: ["Sett opp rekkverk."],
    });
    const release = checkpointIn(
      build(checkpoints, { findings: [notSet], options: { draft: false } }),
      CP.general,
    )!;
    expect(release.tgNotSet).toBe(false);
    expect(release.tg).toBeNull();
  });

  it("T8 TGIU på tilliggende konstruksjoner, eier nektet: TGIU og alle sju opplysningene", () => {
    const data = build([
      cp(CP.adjacent, {
        tg: "IU",
        tg_direct: "IU",
        tgiu: tgiu({
          alternative_check_method: "Fuktmåler på overflaten.",
          alternative_check_result: "Ingen utslag.",
          construction_vulnerable: "unknown",
          owner_informed: true,
        }),
      }),
    ]);
    const result = checkpointIn(data, CP.adjacent)!;
    expect(result.tg).toBe("IU");
    expect(result.tgiu!.details.map((d) => d.field)).toEqual([
      "reason",
      "risk_assessment",
      "how_to_examine",
      "alternative_check_method",
      "alternative_check_result",
      "construction_vulnerable",
    ]);
    expect(result.tgiu!.details.find((d) => d.field === "construction_vulnerable")!.text).toBe(
      "Vet ikke",
    );
    expect(result.tgiu!.ownerInformedText).toBe("Eier er informert om utvidet ansvar.");
    expect(
      visibleText({ ...data, tgExplanation: { ...data.tgExplanation, items: [] } }),
    ).not.toMatch(/TG2/u);
  });

  it("T9 TGIU på annet punkt: hva/hvorfor, risiko og hva som må til; ingen fuktkontroll eller eier", () => {
    const result = checkpointIn(
      build([cp(CP.floor, { tg: "IU", tg_direct: "IU", tgiu: tgiu() })]),
      CP.floor,
    )!;
    expect(result.tgiu!.details.map((d) => d.field)).toEqual([
      "reason",
      "risk_assessment",
      "how_to_examine",
    ]);
    expect(result.tgiu!.ownerInformedText).toBeNull();
  });

  it("T10 TG0 direkte på tilliggende konstruksjoner: TG0, ingen avvik", () => {
    const result = checkpointIn(
      build([cp(CP.adjacent, { tg: "0", tg_direct: "0" })]),
      CP.adjacent,
    )!;
    expect(result.tg).toBe("0");
    expect(result.deviations).toEqual([]);
    expect(result.tgiu).toBeNull();
  });

  it("T11 TG1 med beskrivelse uten avvik: TG1 og beskrivelsen, ingen tomme deler", () => {
    const result = checkpointIn(
      build([cp(CP.floor, { tg: "1", tg_direct: "1", description_text: "Normal slitasje." })]),
      CP.floor,
    )!;
    expect(result).toMatchObject({
      tg: "1",
      descriptionText: "Normal slitasje.",
      deviations: [],
      answers: [],
      tgiu: null,
      notes: [],
    });
  });

  it("T12 beskrivelse uten TG gir «Ikke satt»; punkt helt uten innhold står bare i `missing`", () => {
    const notSet = finding("mandatory_without_tg", {
      ...onCheckpoint(CP.general),
      missing: ["tg"],
    });
    const emptyNotSet = finding("mandatory_without_tg", {
      ...onCheckpoint(CP.membrane),
      missing: ["tg"],
    });
    const data = build(
      [cp(CP.general, { description_text: "Badet er pusset opp." }), cp(CP.membrane)],
      { findings: [notSet, emptyNotSet] },
    );
    expect(checkpointIn(data, CP.general)).toMatchObject({ tg: null, tgNotSet: true });
    expect(checkpointIn(data, CP.membrane)).toBeNull();
    expect(data.missing!.emptyCheckpoints).toEqual([
      {
        roomTitle: "Bad",
        checkpointId: CHECKPOINT_IDS[CP.membrane],
        label: LABELS[CP.membrane],
        editPath: `/oppdrag/${ASSIGNMENT_ID}/rom/${ROOM_ID}#punkt-${CHECKPOINT_IDS[CP.membrane]}`,
      },
    ]);
    expect(TG_NOT_SET_LABEL).toBe("Ikke satt");
  });

  it("T13 flettefelt uten verdi gir «[årstall mangler]», aldri krøllparenteser; med svar fylles det", () => {
    const text = "Sjiktet er fra {årstall} og er gammelt.";
    const missing = checkpointIn(
      build([cp(CP.membrane, { tg: "2", deviations: [dev({ deviation_text: text })] })]),
      CP.membrane,
    )!.deviations[0]!;
    expect(missing.text).toBe("Sjiktet er fra [årstall mangler] og er gammelt.");
    const filled = checkpointIn(
      build([
        cp(CP.membrane, {
          tg: "2",
          answers: [ans("wet_room.membrane_year", { number: 1990 })],
          deviations: [dev({ deviation_text: text })],
        }),
      ]),
      CP.membrane,
    )!.deviations[0]!;
    expect(filled.text).toBe("Sjiktet er fra 1990 og er gammelt.");
    expect(JSON.stringify(missing)).not.toMatch(/[{}]årstall/u);
  });

  it("T14 KI-merker, regelbeslutninger og ukjente felt med merketekst kommer ikke med", () => {
    const marker = "MERKE-T14-KI";
    const deviation = dev({
      text_source: "edited",
      suggested_by_rule_key: `${marker}-regel`,
      question_key: `${marker}-sporsmal`,
      outcome_key: `${marker}-utfall`,
      ai: { deviation_text: { ai_usage_id: `${marker}-id`, status: "accepted" } },
      measures: [
        {
          id: uuidv7(),
          text: "Tiltak",
          text_source: "edited",
          ai: { ai_usage_id: `${marker}-id2`, status: "edited" },
        },
      ],
    });
    const checkpoint = cp(CP.membrane, {
      tg: "2",
      description_text: "Beskrivelse",
      description_ai: { ai_usage_id: `${marker}-id3`, status: "accepted" },
      deviations: [deviation],
      rule_decisions: [
        {
          rule_key: `${marker}-regel`,
          decision: "rejected",
          chosen_tg: null,
          chosen_outcome_key: null,
          override_reason_code: "other",
          decided_at: "2026-11-03T10:00:00.000Z",
        },
      ],
    });
    const withExtras = {
      ...checkpoint,
      reasons: [`${marker}-grunn`],
      regulation_ref: `${marker} § 2-2`,
      help_text: `${marker}-hjelp`,
    } as SnapshotCheckpoint;
    const snap = snapshot([room([withExtras])]);
    const extended = {
      ...snap,
      claims: [{ text: `${marker}-reklamasjon` }],
      summary_text: `${marker}-sammendrag`,
      summary_basis: { text: `${marker}-grunnlag` },
      publish_check_results: [{ override_reason: `${marker}-overstyring` }],
    } as unknown as ReportSnapshot;
    for (const draft of [true, false]) {
      const json = JSON.stringify(buildReportPdfData(input(extended, { options: { draft } })));
      expect(json).not.toContain(marker);
      for (const key of [
        "ai_usage_id",
        '"ai"',
        "text_source",
        "textSource",
        "rule_decisions",
        "summary_text",
        "summary_basis",
        "regulation_ref",
        "help_text",
        "reasons",
        "claims",
        "override",
        "publish_check_results",
      ]) {
        expect(json).not.toContain(key);
      }
    }
  });

  it("T16 teksten har ingen NS 3600, ingen paragraftegn i avviksdelen og ingen gjetteord", () => {
    const data = build([
      cp(CP.membrane, {
        tg: "3",
        description_text: "Sjiktet har sprekker.",
        deviations: [
          dev({ tg: 3, cause_criterion: "functional_failure", cause_text: "Lekkasje." }),
        ],
      }),
    ]);
    const text = visibleText(data);
    expect(text).not.toMatch(/NS\s*3600/iu);
    expect(text).not.toMatch(/§/u);
    expect(text).not.toMatch(/\bantas\b|\btrolig\b/iu);
  });

  it("T17 hull tatt uten funn med måling 12,4 vekt-%: svaret og målingen står under punktet", () => {
    const result = checkpointIn(
      build([
        cp(CP.adjacent, {
          tg: "0",
          tg_direct: "0",
          answers: [
            ans("wet_room.hole_drilling", { options: ["done_no_findings"] }),
            ans("wet_room.hole_moisture_reading", { number: 12.4 }),
            ans("wet_room.hole_moisture_unit", { options: ["weight_percent"] }),
          ],
        }),
      ]),
      CP.adjacent,
    )!;
    expect(result.answers).toEqual([
      { elementKey: "wet_room.hole_drilling", label: "Hulltaking", valueText: "Utført uten funn" },
      {
        elementKey: "wet_room.hole_moisture_reading",
        label: "Fuktmåling i hullet",
        valueText: "12,4",
      },
      {
        elementKey: "wet_room.hole_moisture_unit",
        label: "Enhet for fuktmålingen",
        valueText: "Vekt-%",
      },
    ]);
  });

  it("T18 felt med show_in_report = false står aldri med", () => {
    const marker = "MERKE-T18";
    const answer = { ...ans("wet_room.building_code", { options: ["tek10"] }), label: marker };
    const data = build([cp(CP.general, { tg: "1", answers: [answer] })]);
    expect(TEMPLATE.elements["wet_room.building_code"]!.showInReport).toBe(false);
    expect(JSON.stringify(data)).not.toContain(marker);
    expect(JSON.stringify(data)).not.toContain("TEK10");
  });

  it("T19 hull ikke tatt med grunn: grunnen står; uten grunn: «Mangler» med sjekkens tekst", () => {
    const withReason = checkpointIn(
      build([
        cp(CP.adjacent, {
          tg: "0",
          answers: [
            ans("wet_room.hole_drilling", { options: ["not_done"] }),
            ans("wet_room.hole_drilling_reason", { options: ["no_access"] }),
          ],
        }),
      ]),
      CP.adjacent,
    )!;
    expect(withReason.answers.map((a) => a.valueText)).toEqual(["Ikke utført", "Ikke tilgang"]);

    const f = finding("wet_or_below_ground_missing_hole", {
      ...onCheckpoint(CP.adjacent),
      missing: ["hole_drilling_reason"],
    });
    const without = checkpointIn(
      build(
        [
          cp(CP.adjacent, {
            tg: "0",
            answers: [ans("wet_room.hole_drilling", { options: ["not_done"] })],
          }),
        ],
        { findings: [f] },
      ),
      CP.adjacent,
    )!;
    expect(without.notes).toEqual([
      {
        kind: "missing",
        checkCode: "wet_or_below_ground_missing_hole",
        text: "Hulltaking er ikke utført, og grunnen mangler.",
      },
    ]);
  });

  it("T20 TGIU uten hva og hvorfor gir «Mangler»; eier ikke informert gir ingen setning", () => {
    const f = finding("mandatory_without_tg", {
      ...onCheckpoint(CP.adjacent),
      missing: ["reason"],
    });
    const result = checkpointIn(
      build(
        [
          cp(CP.adjacent, {
            tg: "IU",
            tg_direct: "IU",
            tgiu: tgiu({ reason: null, owner_informed: false }),
          }),
        ],
        { findings: [f] },
      ),
      CP.adjacent,
    )!;
    expect(result.tgNotSet).toBe(false);
    expect(result.notes).toEqual([
      { kind: "missing", checkCode: "mandatory_without_tg", text: publishFindingText(f) },
    ]);
    expect(result.tgiu!.ownerInformedText).toBeNull();
    expect(result.tgiu!.details.map((d) => d.field)).not.toContain("reason");
  });

  it("T21 punkt med gives_tg = false og beskrivelse: ingen TG og ikke «Ikke satt»", () => {
    const result = checkpointIn(
      build([cp(CP.documentation, { description_text: "Ingen papirer lagt fram." })], {
        findings: [],
      }),
      CP.documentation,
    )!;
    expect(result.tg).toBeNull();
    expect(result.tgNotSet).toBe(false);
  });

  it("T22 avvik uten valgt TG: «Ikke satt» på avviket, punktets TG fra de andre avvikene", () => {
    const open = dev({ tg: null });
    const f = finding("mandatory_without_tg", {
      ...onCheckpoint(CP.membrane),
      deviationId: open.id,
      missing: ["tg"],
    });
    const result = checkpointIn(
      build([cp(CP.membrane, { tg: "3", deviations: [dev({ tg: 3 }), open] })], {
        findings: [f],
      }),
      CP.membrane,
    )!;
    expect(result.tg).toBe("3");
    expect(result.tgNotSet).toBe(false);
    expect(result.deviations[1]).toMatchObject({ tg: null, tgNotSet: true, notes: [] });
    expect(result.deviations[0]).toMatchObject({ tg: "3", tgNotSet: false });
  });

  it("T23 regulation_ref og help_text i malen kommer aldri med", () => {
    const marker = "MERKE-T23";
    const template = pdfTemplateLabelsOf({
      elements: wetRoomTemplate.elements.map((e) => ({ ...e, help_text: `${marker} § 2-2` })),
    });
    const data = buildReportPdfData(
      input(
        snapshot([
          room([
            cp(CP.floor, {
              tg: "1",
              answers: [ans("wet_room.floor_type", { options: ["tiles"] })],
            }),
          ]),
        ]),
        { template },
      ),
    );
    expect(JSON.stringify(template)).not.toContain(marker);
    expect(JSON.stringify(data)).not.toContain(marker);
    expect(JSON.stringify(data)).not.toContain("NS 3600");
  });
});

// --- A540: svar per felttype ------------------------------------------------------------------

describe("A540: svar på felt med show_in_report (10.7.1)", () => {
  /** Én rad per felttype i badmalen. Et nytt felt i malen med ny type gjør testen rød. */
  const CASES: Record<string, { key: string; value: Parameters<typeof ans>[1]; expected: string }> =
    {
      choice: {
        key: "wet_room.hole_drilling",
        value: { options: ["done_with_findings"] },
        expected: "Utført med funn",
      },
      number: {
        key: "wet_room.threshold_height_mm",
        value: { number: 12.5 },
        expected: `12,5${NBSP}mm`,
      },
      checkbox: { key: "wet_room.owner_informed", value: { number: 1 }, expected: "Ja" },
      text: {
        key: "wet_room.hole_moisture_location",
        value: { text: " Ved dusj " },
        expected: "Ved dusj",
      },
    };

  it("hver felttype i badmalen har en rad", () => {
    const types = new Set(wetRoomTemplate.elements.map((e) => e.field_type));
    for (const type of types) expect(Object.keys(CASES)).toContain(type);
  });

  it.each(Object.entries(CASES))("%s: etikett fra malen og verdien som tekst", (type, row) => {
    expect(TEMPLATE.elements[row.key]!.fieldType).toBe(type);
    const answers = build([cp(CP.adjacent, { tg: "0", answers: [ans(row.key, row.value)] })])
      .rooms[0]!.checkpoints[0]!.answers;
    expect(answers).toEqual([
      { elementKey: row.key, label: elementLabel(row.key), valueText: row.expected },
    ]);
  });

  it("avkrysning 0 gir «Nei», tall med enhet har komma og hardt mellomrom, tomme svar ingen linje", () => {
    const answers = build([
      cp(CP.floor, {
        tg: "1",
        answers: [
          ans("wet_room.fall_direction_1", { number: -1.5 }),
          ans("wet_room.fall_direction_2", { text: "   " }),
          ans("wet_room.floor_type", { options: [] }),
        ],
      }),
      cp(CP.adjacent, { tg: "0", answers: [ans("wet_room.owner_informed", { number: 0 })] }),
    ]).rooms[0]!.checkpoints.flatMap((c) => c.answers);
    expect(answers.map((a) => a.valueText)).toEqual([`-1,5${NBSP}mm/m`, "Nei"]);
  });

  it("felt som ikke står i malversjonen, er ikke med (også nøkler som «__proto__»)", () => {
    const answers = build([
      cp(CP.floor, {
        tg: "1",
        answers: [
          { ...ans("wet_room.floor_type", { options: ["tiles"] }), element_key: "ukjent.felt" },
          { ...ans("wet_room.floor_type", { options: ["tiles"] }), element_key: "__proto__" },
        ],
      }),
    ]).rooms[0]!.checkpoints[0]!.answers;
    expect(answers).toEqual([]);
  });

  it("svar på rommet uten kontrollpunkt følger samme regel", () => {
    const data = buildReportPdfData(
      input(
        snapshot([
          room([], {
            answers: [
              ans("wet_room.build_year", { number: 1990 }),
              ans("wet_room.building_code", { options: ["tek10"] }),
            ],
          }),
        ]),
      ),
    );
    expect(data.rooms[0]!.answers).toEqual([
      { elementKey: "wet_room.build_year", label: "Byggeår for våtrommet", valueText: "1990" },
    ]);
  });
});

// --- Årsak og kostnad ---------------------------------------------------------------------------

describe("årsak og kostnad (3.1.17 og 3.1.18)", () => {
  it.each(Object.entries(CAUSE_CRITERION_LABELS))(
    "årsakskriteriet %s vises med etiketten, «Annet» aldri alene",
    (criterion, label) => {
      const result = checkpointIn(
        build([
          cp(CP.floor, {
            tg: "2",
            deviations: [dev({ cause_criterion: criterion, cause_text: "Årsakstekst." })],
          }),
        ]),
        CP.floor,
      )!.deviations[0]!;
      expect(result.causeLabel).toBe(criterion === "other" ? null : label);
      expect(result.causeText).toBe("Årsakstekst.");
    },
  );

  it("ukjent kriterium gir ingen etikett og aldri koden", () => {
    const result = checkpointIn(
      build([cp(CP.floor, { tg: "2", deviations: [dev({ cause_criterion: "ukjent_kode" })] })]),
      CP.floor,
    )!.deviations[0]!;
    expect(result.causeLabel).toBeNull();
  });

  it("cost_type none gir ingen kostnadslinje; cost_text med når den finnes; TG2 med kostnad", () => {
    const none = dev({ cost: { type: "none", band_key: null, amount: null, text: "Tekst" } });
    const tg2 = dev({
      tg: 2,
      cost: { type: "approx", band_key: null, amount: 10000, text: "Gjelder bare sluket." },
    });
    const result = checkpointIn(
      build([cp(CP.floor, { tg: "2", deviations: [none, tg2] })]),
      CP.floor,
    )!;
    expect(result.deviations[0]!.cost).toEqual({
      type: "none",
      bandKey: null,
      amount: null,
      displayText: null,
      text: null,
    });
    expect(result.deviations[1]!.cost).toMatchObject({
      displayText: `ca. 10${NBSP}000 kr`,
      text: "Gjelder bare sluket.",
    });
  });

  it("ugyldig beløp eller ukjent intervall gir ingen kostnadstekst, aldri «ca.» alene", () => {
    const result = checkpointIn(
      build([
        cp(CP.floor, {
          tg: "3",
          deviations: [
            dev({ tg: 3, cost: { type: "approx", band_key: null, amount: 0, text: null } }),
            dev({ tg: 3, cost: { type: "band", band_key: "ukjent", amount: null, text: null } }),
          ],
        }),
      ]),
      CP.floor,
    )!;
    expect(result.deviations.map((d) => d.cost.displayText)).toEqual([null, null]);
  });
});

// --- F8: funnene fra sjekken ------------------------------------------------------------------

type Place = "report" | "room" | "checkpoint" | "deviation";

/** Hvor hvert funn står i sjekken. Ny kode uten rad gjør testen rød. */
const PLACE_BY_CODE: Record<PublishCheckCode, Place> = {
  mandatory_without_tg: "checkpoint",
  tg2_tg3_missing_cause_or_consequence: "deviation",
  tg3_missing_cost: "deviation",
  wet_or_below_ground_missing_hole: "checkpoint",
  bra_missing: "report",
  electrical_missing: "report",
  inspection_date_missing: "report",
  tg2_tg3_missing_measure: "deviation",
  cost_amount_not_rounded: "deviation",
  hms_missing_consequence_or_measure: "deviation",
  tgiu_details_missing: "checkpoint",
  tgiu_suggested_not_set: "checkpoint",
  no_findings_with_reading_over_limit: "checkpoint",
  suggestion_no_longer_applies: "checkpoint",
  texts_written_for_other_tg: "deviation",
  tg3_on_age_only: "deviation",
  ai_suggestion_pending: "deviation",
  hole_reading_missing: "checkpoint",
};

describe("T24: utkastet og publiseringssjekken sier det samme (F8, 10.4)", () => {
  it("hver kode i sjekken har en rad", () => {
    expect(Object.keys(PLACE_BY_CODE).sort()).toEqual([...PUBLISH_CHECK_CODES].sort());
  });

  it.each(PUBLISH_CHECK_CODES.map((code) => [code, PLACE_BY_CODE[code]] as const))(
    "%s (%s) står på målet med sjekkens tekst, og ingen andre steder",
    (code, place) => {
      const deviation = dev({ tg: 3, deviation_text: "Avvik på membranen." });
      const base = cp(CP.membrane, {
        tg: "3",
        description_text: "Membranen er gammel.",
        deviations: [deviation],
      });
      const missing =
        code === "tg2_tg3_missing_cause_or_consequence" ? ["cause_text" as const] : [];
      const targetOf: Record<Place, Partial<PublishCheckTarget>> = {
        report: {},
        room: { roomId: ROOM_ID },
        checkpoint: onCheckpoint(CP.membrane),
        deviation: { ...onCheckpoint(CP.membrane), deviationId: deviation.id },
      };
      const f = finding(code, { ...targetOf[place], missing });
      const data = build([base], { findings: [f] });
      const checkpoint = checkpointIn(data, CP.membrane)!;
      const text = publishFindingText(f, {
        deviationNumber: place === "deviation" ? 1 : null,
        deviationTg: place === "deviation" ? 3 : null,
      });
      const kind = f.severity === "blocker" ? "missing" : "check";

      if (code === "mandatory_without_tg") {
        // Punktet har TG3 i snapshotet, så «Ikke satt» vises ikke; teksten brukes aldri
        expect(checkpoint.notes).toEqual([]);
        expect(countOf(visibleText(data), text)).toBe(0);
        return;
      }
      const expected = [{ kind, checkCode: code, text }];
      if (place === "deviation") expect(checkpoint.deviations[0]!.notes).toEqual(expected);
      else if (place === "checkpoint") expect(checkpoint.notes).toEqual(expected);
      else expect(data.missing!.reportNotes).toEqual(expected);
      expect(countOf(visibleText(data), text)).toBe(1);

      const release = build([base], { findings: [f], options: { draft: false } });
      expect(countOf(visibleText(release), text)).toBe(0);
    },
  );

  it("et utkast uten funn har verken «Ikke satt», «Mangler» eller «Sjekk»", () => {
    const data = build(
      [
        cp(CP.general, { description_text: "Beskrivelse" }),
        cp(CP.membrane, { tg: "3", deviations: [dev({ tg: null })] }),
      ],
      { findings: [] },
    );
    const all = data.rooms.flatMap((r) => r.checkpoints);
    expect(all.every((c) => !c.tgNotSet && c.notes.length === 0)).toBe(true);
    expect(all.flatMap((c) => c.deviations).every((d) => !d.tgNotSet && d.notes.length === 0)).toBe(
      true,
    );
    expect(data.missing!.reportNotes).toEqual([]);
  });

  it("hvert punkt med mandatory_without_tg står som «Ikke satt» eller på siden «Ikke med i PDF-en»", () => {
    const keys = [CP.general, CP.membrane, CP.adjacent];
    const findings = keys.map((key) =>
      finding("mandatory_without_tg", { ...onCheckpoint(key), missing: ["tg"] }),
    );
    const data = build(
      [cp(CP.general, { description_text: "Tekst" }), cp(CP.membrane), cp(CP.adjacent)],
      { findings },
    );
    for (const key of keys) {
      const placed = checkpointIn(data, key);
      const empty = data.missing!.emptyCheckpoints.some(
        (e) => e.checkpointId === CHECKPOINT_IDS[key],
      );
      expect(placed?.tgNotSet === true || empty).toBe(true);
    }
  });

  it("funn på rommet og funn på mål som ikke finnes, står øverst på siden «Ikke med i PDF-en»", () => {
    const roomFinding = finding("wet_or_below_ground_missing_hole", {
      roomId: ROOM_ID,
      missing: ["hole_drilling"],
    });
    const gone = finding("ai_suggestion_pending", {
      roomId: ROOM_ID,
      checkpointId: uuidv7(),
      checkpointKey: "wet_room.ukjent",
      deviationId: uuidv7(),
      aiUsageId: uuidv7(),
    });
    const data = build([cp(CP.membrane, { tg: "1" })], { findings: [roomFinding, gone] });
    expect(data.missing!.reportNotes.map((n) => n.checkCode)).toEqual([
      "wet_or_below_ground_missing_hole",
      "ai_suggestion_pending",
    ]);
  });

  it("advarselen om ventende KI-forslag viser bare sjekkens faste tekst", () => {
    const deviation = dev({ tg: 2 });
    const f = finding("ai_suggestion_pending", {
      ...onCheckpoint(CP.floor),
      deviationId: deviation.id,
      aiUsageId: uuidv7(),
    });
    const notes = checkpointIn(
      build([cp(CP.floor, { tg: "2", deviations: [deviation] })], { findings: [f] }),
      CP.floor,
    )!.deviations[0]!.notes;
    expect(notes).toEqual([
      {
        kind: "check",
        checkCode: "ai_suggestion_pending",
        text: "Forslag fra KI som ikke er behandlet. Det kommer ikke med i rapporten.",
      },
    ]);
  });
});

// --- Utkast og utgivelse ------------------------------------------------------------------------

describe("utkast og utgivelse (F3, F4, A541)", () => {
  it("utkastet har lenker med bare id-er; utgivelsen har ingen lenker, ingen merknader og ingen `missing`", () => {
    const deviation = dev({ tg: 2 });
    const checkpoints = [cp(CP.floor, { tg: "2", deviations: [deviation] }), cp(CP.general)];
    const f = finding("tg2_tg3_missing_measure", {
      ...onCheckpoint(CP.floor),
      deviationId: deviation.id,
    });
    const draft = build(checkpoints, { findings: [f] });
    expect(draft.kind).toBe("draft");
    expect(draft.versionNumber).toBeNull();
    const floor = checkpointIn(draft, CP.floor)!;
    expect(floor.editPath).toBe(
      `/oppdrag/${ASSIGNMENT_ID}/rom/${ROOM_ID}#punkt-${CHECKPOINT_IDS[CP.floor]}`,
    );
    expect(floor.deviations[0]!.editPath).toBe(
      `/oppdrag/${ASSIGNMENT_ID}/rom/${ROOM_ID}#avvik-${deviation.id}`,
    );
    expect(draft.missing!.emptyCheckpoints).toHaveLength(1);

    const release = build(checkpoints, {
      findings: [f],
      versionNumber: 2,
      options: { draft: false },
    });
    expect(release.kind).toBe("release");
    expect(release.versionNumber).toBe(2);
    expect(release.missing).toBeNull();
    expect(JSON.stringify(release)).not.toContain("/oppdrag/");
    expect(checkpointIn(release, CP.general)).toBeNull();
    const releaseFloor = checkpointIn(release, CP.floor)!;
    expect(releaseFloor.notes).toEqual([]);
    expect(releaseFloor.deviations[0]!.notes).toEqual([]);
  });

  it("forsiden har adresse og matrikkel bare i `cover`, og befaringsdatoen fra snapshotet", () => {
    const data = build([cp(CP.floor, { tg: "1" })]);
    expect(data.cover).toEqual({
      assignmentNumber: "26-1042",
      addressLines: ["Prøvevegen 1", "8000 Bodø"],
      cadastralText: "Gnr. 12, bnr. 34",
      inspectionDate: "2026-06-15",
    });
    const withoutCover = JSON.stringify({ ...data, cover: null });
    expect(withoutCover).not.toContain("Prøvevegen");
    expect(withoutCover).not.toContain("Gnr.");
  });

  it("rommet har navn, bygning og etasje; uten navn brukes etiketten for romtypen", () => {
    const named = build([cp(CP.floor, { tg: "1" })]).rooms[0]!;
    expect(named).toMatchObject({ title: "Bad", buildingName: "Hovedhus", floorName: "1. etasje" });
    const unnamed = buildReportPdfData(input(snapshot([room([], { name: "  " })]))).rooms[0]!;
    expect(unnamed.title).toBe("Bad");
  });

  it.each([
    ["navn og org.nr.", COMPANY, { legalName: "Testselskap takst AS", orgNumber: "999 111 222" }],
    ["selskap mangler", null, null],
    ["org.nr. mangler", { legalName: "Testselskap takst AS", orgNumber: null }, null],
    ["org.nr. bare mellomrom", { legalName: "Testselskap takst AS", orgNumber: "  " }, null],
  ] as const)("selskap: %s (A538)", (_name, company, expected) => {
    expect(build([cp(CP.floor, { tg: "1" })], { company }).company).toEqual(expected);
  });

  it("TG-forklaringen følger med som utkast", () => {
    const data = build([]);
    expect(data.tgExplanation.textStatus).toBe("draft");
    expect(data.tgExplanation.items).toHaveLength(5);
  });

  it("er ren: samme inndata gir samme svar, og inndata endres ikke", () => {
    const deviation = dev({ tg: 3, deviation_text: "Fra {årstall}." });
    const value = input(snapshot([room([cp(CP.membrane, { tg: "3", deviations: [deviation] })])]), {
      findings: [
        finding("tg3_missing_cost", { ...onCheckpoint(CP.membrane), deviationId: deviation.id }),
      ],
    });
    const before = structuredClone(value);
    const first = buildReportPdfData(value);
    first.rooms[0]!.checkpoints[0]!.deviations[0]!.measures.push("endret");
    first.tgExplanation.items[0]!.text = "endret";
    expect(value).toEqual(before);
    const second = buildReportPdfData(value);
    expect(second.tgExplanation.items[0]!.text).not.toBe("endret");
    expect(second.rooms[0]!.checkpoints[0]!.deviations[0]!.measures).toEqual([]);
  });

  it("A542: avvik fra KI gir samme data som samme avvik skrevet for hånd", () => {
    const id = uuidv7();
    const byHand = dev({ id, deviation_text: "Lik tekst.", text_source: "free" });
    const fromAi = dev({
      id,
      deviation_text: "Lik tekst.",
      text_source: "edited",
      ai: { deviation_text: { ai_usage_id: uuidv7(), status: "accepted" } },
    });
    const a = build([cp(CP.floor, { tg: "2", deviations: [byHand] })]);
    const b = build([cp(CP.floor, { tg: "2", deviations: [fromAi] })]);
    expect(b).toEqual(a);
  });
});

// --- Statisk ------------------------------------------------------------------------------------

/** Koden uten kommentarer, så forklaringer som nevner `claims` ikke teller. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

describe("statisk: ingen KI og ingen reklamasjoner i PDF-dataene", () => {
  it.each(["pdf-data.ts", "pdf-data-build.ts", "release-pdf.ts", "tg-explanation.ts"])(
    "%s importerer ikke @/core/ai og leser ikke claims",
    (file) => {
      const source = withoutComments(readFileSync(path.join(__dirname, file), "utf8"));
      expect(source).not.toMatch(/from\s+["']@\/core\/ai/u);
      expect(source).not.toMatch(/import\(\s*["']@\/core\/ai/u);
      expect(source).not.toMatch(/\bclaims\b/u);
      expect(source).not.toMatch(/from\s+["']@\/core\/claims/u);
    },
  );

  it("byggefunksjonen har ingen egne regler for hva som mangler (ingen sjekk-koder i koden)", () => {
    const source = withoutComments(readFileSync(path.join(__dirname, "pdf-data-build.ts"), "utf8"));
    for (const code of PUBLISH_CHECK_CODES) {
      if (code === "mandatory_without_tg") continue;
      expect(source).not.toContain(`"${code}"`);
    }
  });
});
