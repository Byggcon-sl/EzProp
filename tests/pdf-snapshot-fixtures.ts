import type {
  BuildReportPdfDataInput,
  PdfTemplateLabels,
  ReportSnapshot,
  SnapshotAnswer,
  SnapshotCheckpoint,
  SnapshotDeviation,
  SnapshotRoom,
  SnapshotTgiu,
} from "@/core/reports";
import type { PublishCheckFinding } from "@/core/reports/logic/publish-check-types";
import { REPORT_SNAPSHOT_SCHEMA_VERSION } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";

/*
 * Oppdiktede snapshot-rader for testene av `buildReportPdfData` (testplanen for PDF av badet,
 * avsnitt 3.1, 10.3, 10.4 og 10.7). Rene data uten database: snapshotet har samme form som
 * `report_releases.snapshot` (ADR 0015). Ingen ekte adresser, navn eller selskaper.
 */

export const SNAP_IDS = {
  report: "0193b000-0000-7000-8000-000000000001",
  assignment: "0193b000-0000-7000-8000-000000000002",
  room: "0193b000-0000-7000-8000-000000000003",
  building: "0193b000-0000-7000-8000-000000000004",
  floor: "0193b000-0000-7000-8000-000000000005",
  templateVersion: "0193b000-0000-7000-8000-000000000006",
  templateFamily: "0193b000-0000-7000-8000-000000000007",
} as const;

let counter = 0x100;
/** Ny fast uuid i testområdet (bare sifre, så id-ene er like fra kjøring til kjøring i én fil). */
export function snapId(): string {
  counter += 1;
  return `0193b000-0000-7000-8000-${counter.toString(16).padStart(12, "0")}`;
}

/** Badmalens kontrollpunkter med etikettene fra malen. */
export const WET_ROOM_CHECKPOINT_LABELS: Record<string, string> = Object.fromEntries(
  wetRoomTemplate.checkpoints.map((c) => [c.key, c.name]),
);

/** Etiketter, `show_in_report` og enheter fra den låste malversjonen (her: badmalen). */
export function wetRoomTemplateLabels(): PdfTemplateLabels {
  return {
    elements: Object.fromEntries(
      wetRoomTemplate.elements.map((e) => [
        e.key,
        { showInReport: e.show_in_report, unit: e.unit },
      ]),
    ),
  };
}

const ELEMENT_LABELS: Record<string, string> = Object.fromEntries(
  wetRoomTemplate.elements.map((e) => [e.key, e.label]),
);
const OPTION_LABELS: Record<string, string> = Object.fromEntries(
  wetRoomTemplate.element_options.map((o) => [`${o.element_key}:${o.key}`, o.label]),
);

/** Et svar slik snapshotet har det, med etikett og valgtekster fra malen. */
export function snapAnswer(
  elementKey: string,
  value: { text?: string | null; number?: number | null; optionKeys?: string[] | null },
  overrides: Partial<SnapshotAnswer> = {},
): SnapshotAnswer {
  const optionKeys = value.optionKeys ?? null;
  return {
    element_key: elementKey,
    label: ELEMENT_LABELS[elementKey] ?? elementKey,
    value_text: value.text ?? null,
    value_number: value.number ?? null,
    value_option_keys: optionKeys,
    value_option_labels: optionKeys
      ? optionKeys.map((k) => OPTION_LABELS[`${elementKey}:${k}`] ?? k)
      : null,
    ai: null,
    ...overrides,
  };
}

export function snapDeviation(overrides: Partial<SnapshotDeviation> = {}): SnapshotDeviation {
  return {
    id: snapId(),
    kind: "tg",
    tg: 2,
    question_key: null,
    outcome_key: null,
    deviation_text: "Oppdiktet avvikstekst.",
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

export function snapMeasure(text: string) {
  return { id: snapId(), text, text_source: "free" as const, ai: null };
}

export function snapTgiu(overrides: Partial<SnapshotTgiu> = {}): SnapshotTgiu {
  return {
    reason: null,
    owner_informed: null,
    owner_informed_at: null,
    alternative_check_method: null,
    alternative_check_result: null,
    risk_assessment: null,
    construction_vulnerable: null,
    how_to_examine: null,
    ai: {},
    ...overrides,
  };
}

/** Et kontrollpunkt i badmalen. Uten innhold som standard. */
export function snapCheckpoint(
  checkpointKey: string,
  overrides: Partial<SnapshotCheckpoint> = {},
): SnapshotCheckpoint {
  return {
    checkpoint_id: snapId(),
    checkpoint_key: checkpointKey,
    label: WET_ROOM_CHECKPOINT_LABELS[checkpointKey] ?? checkpointKey,
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

export function snapRoom(
  checkpoints: SnapshotCheckpoint[],
  overrides: Partial<SnapshotRoom> = {},
): SnapshotRoom {
  return {
    room_id: SNAP_IDS.room,
    name: "Bad i 2. etasje",
    room_type: "bathroom",
    answers: [],
    checkpoints,
    ...overrides,
  };
}

export function snapshotOf(
  rooms: SnapshotRoom[],
  overrides: Partial<ReportSnapshot["report"]> = {},
): ReportSnapshot {
  return {
    schema_version: REPORT_SNAPSHOT_SCHEMA_VERSION,
    report: {
      report_id: SNAP_IDS.report,
      report_type: "condition_report",
      template_version_id: SNAP_IDS.templateVersion,
      template_family_id: SNAP_IDS.templateFamily,
      template_version_number: 1,
      inspection_date: "2026-06-15",
      ...overrides,
    },
    buildings: [
      {
        report_building_id: SNAP_IDS.building,
        name: "Hovedhus",
        floors: [{ floor_id: SNAP_IDS.floor, name: "2. etasje", rooms }],
      },
    ],
  };
}

/** Oppdiktet forside. */
export const SNAP_COVER = {
  assignmentId: SNAP_IDS.assignment,
  assignmentNumber: "2026-0042",
  addressLines: ["Prøvevegen 1", "8000 Oppdiktet"],
  cadastralText: "Gnr. 999, bnr. 9",
} as const;

export const SNAP_COMPANY = { legalName: "Testselskap takst AS", orgNumber: "999000111" };

/** Et funn fra sjekken med tomt mål utenom det som sendes. */
export function finding(
  checkCode: PublishCheckFinding["checkCode"],
  severity: PublishCheckFinding["severity"],
  target: Partial<PublishCheckFinding["target"]>,
): PublishCheckFinding {
  return {
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
}

/** Inndata til `buildReportPdfData` for et utkast eller en utgivelse. */
export function buildInput(
  snapshot: ReportSnapshot,
  options: {
    draft?: boolean;
    findings?: readonly PublishCheckFinding[] | null;
    company?: { legalName: string; orgNumber: string | null } | null;
    versionNumber?: number | null;
    template?: PdfTemplateLabels;
    cover?: BuildReportPdfDataInput["cover"];
  } = {},
): BuildReportPdfDataInput {
  const draft = options.draft ?? true;
  return {
    snapshot,
    template: options.template ?? wetRoomTemplateLabels(),
    cover: options.cover ?? { ...SNAP_COVER, addressLines: [...SNAP_COVER.addressLines] },
    company: options.company === undefined ? { ...SNAP_COMPANY } : options.company,
    findings: options.findings === undefined ? (draft ? [] : null) : options.findings,
    versionNumber: options.versionNumber === undefined ? (draft ? null : 1) : options.versionNumber,
    options: { draft },
  };
}

/** Alle nøkler i et objekt, på alle nivåer. */
export function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      allKeys(inner, into);
    }
  }
  return into;
}
