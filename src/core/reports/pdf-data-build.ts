import { ROOM_TYPES } from "@/core/buildings";
import type {
  PdfAnswer,
  PdfCheckpoint,
  PdfCost,
  PdfDeviation,
  PdfDraftNote,
  PdfMissing,
  PdfRoom,
  PdfTgExplanation,
  PdfTgiu,
  PdfTgiuDetail,
} from "@/core/pdf";
import type { TemplateDocument } from "@/core/templates";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import { isUuid } from "@/shared/lib/uuid";
import {
  CAUSE_CRITERION_LABELS,
  CONSTRUCTION_VULNERABLE_LABELS,
  costDisplayText,
  formatDecimal,
  mergeFieldsText,
  mergeFieldValues,
  mergeNumberText,
  publishFindingText,
  TGIU_FIELD_LABELS,
  type MergeValues,
} from "./logic";
import type { PublishCheckFinding } from "./logic/publish-check-types";
import { mergeSourcesFor, UNIT_ELEMENT_OF } from "./merge-sources";
import type { BuildReportPdfData, BuildReportPdfDataInput, PdfTemplateLabels } from "./pdf-types";
import type {
  SnapshotAnswer,
  SnapshotCheckpoint,
  SnapshotDeviation,
  SnapshotRoom,
  SnapshotTgiu,
} from "./publish-types";
import { TG_EXPLANATION } from "./tg-explanation";

/*
 * Rapportdataene til PDF-en (ADR 0016, docs/funksjoner/fase2a-pdf-badet.md Omfang 4 og 5, F6 og
 * F8). Én ren funksjon fra `ReportSnapshot`, lik for utkast og utgivelse. Leser aldri klokke,
 * database eller KI.
 *
 * - TG regnes aldri her: punktets TG er `SnapshotCheckpoint.tg`.
 * - Ingen egne regler for hva som mangler: i utkastet plasseres hvert funn fra
 *   `computePublishCheck` ved målet sitt, med teksten fra publiseringsskjermen
 *   (`publishFindingText`).
 * - Aldri med: KI-merkene og `ai_usage_id`, `text_source`, `rule_decisions`, regelkoder,
 *   kilder, hjelpetekster, sammendrag, reklamasjoner og overstyringer. Funksjonen plukker bare ut
 *   feltene PDF-en viser, så nye felt i snapshotet kommer aldri med av seg selv.
 */

/** Hardt mellomrom, så tall og enhet aldri deles over to linjer. */
const NBSP = " ";

const own = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/**
 * Tar bort KI-plassholderne (`[navn]`, `[e-post]` osv.) fra gamle data. Lagringen avviser dem
 * (A466), men de skal aldri stå i PDF-en. «[årstall mangler]» er ikke en av dem og står.
 */
function withoutPlaceholders(text: string): string {
  if (!PII_PLACEHOLDERS.some((placeholder) => text.includes(placeholder))) return text;
  let result = text;
  for (const placeholder of PII_PLACEHOLDERS) result = result.split(placeholder).join("");
  return result.replace(/[ \t]{2,}/gu, " ").replace(/ ([.,;:])/gu, "$1");
}

function present(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = withoutPlaceholders(text).trim();
  return trimmed === "" ? null : trimmed;
}

// --- Malversjonen ------------------------------------------------------------------------------

/** Det PDF-en trenger fra den låste malversjonen: `show_in_report`, enhet og felttype per felt. */
export function pdfTemplateLabelsOf(
  document: Pick<TemplateDocument, "elements">,
): PdfTemplateLabels {
  const elements: Record<string, PdfTemplateLabels["elements"][string]> = Object.create(null);
  for (const element of document.elements) {
    elements[element.key] = {
      showInReport: element.show_in_report,
      unit: present(element.unit),
      fieldType: element.field_type,
    };
  }
  return { elements };
}

// --- Svar på felt (A540) -----------------------------------------------------------------------

/**
 * Tallet med desimalkomma. Tusenskille (hardt mellomrom) først fra fem sifre, så årstall og korte
 * mål står som «1990» og «1200», og store tall som «12 500».
 */
function numberText(value: number): string {
  if (Math.abs(value) >= 10000) return formatDecimal(value);
  return String(value).replace(".", ",");
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Svaret som tekst: valgtekst, «Ja»/«Nei», dato eller tall med komma og enhet. Tomt gir `null`. */
function answerValueText(
  answer: SnapshotAnswer,
  meta: PdfTemplateLabels["elements"][string],
): string | null {
  const labels = (answer.value_option_labels ?? [])
    .map((label) => present(label))
    .filter((label): label is string => label !== null);
  if (labels.length > 0) return labels.join(", ");
  const number = answer.value_number;
  if (number !== null && Number.isFinite(number)) {
    if (meta.fieldType === "checkbox") {
      if (number === 1) return "Ja";
      if (number === 0) return "Nei";
      return null;
    }
    const value = numberText(number);
    return meta.unit ? `${value}${NBSP}${meta.unit}` : value;
  }
  const text = present(answer.value_text);
  if (text === null) return null;
  if (meta.fieldType === "date") {
    const match = ISO_DATE.exec(text);
    if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  }
  return text;
}

/** Valgteksten i enhetsfeltet til et tallfelt (A540), eller `null`. */
function unitLabelOf(answers: readonly SnapshotAnswer[], elementKey: string): string | null {
  if (!own(UNIT_ELEMENT_OF, elementKey)) return null;
  const unitKey = UNIT_ELEMENT_OF[elementKey];
  const unit = answers.find((answer) => answer.element_key === unitKey);
  const label = (unit?.value_option_labels ?? [])
    .map((text) => present(text))
    .find((text): text is string => text !== null);
  return label ?? null;
}

function pdfAnswers(answers: readonly SnapshotAnswer[], template: PdfTemplateLabels): PdfAnswer[] {
  const result: PdfAnswer[] = [];
  // Enheter som står sammen med tallet sitt, får ikke egen linje
  const joinedUnits = new Set<string>();
  for (const answer of answers) {
    const unitLabel = unitLabelOf(answers, answer.element_key);
    const shown =
      own(template.elements, answer.element_key) &&
      template.elements[answer.element_key]?.showInReport === true;
    if (shown && unitLabel !== null && Number.isFinite(answer.value_number)) {
      joinedUnits.add(UNIT_ELEMENT_OF[answer.element_key]!);
    }
  }
  for (const answer of answers) {
    if (joinedUnits.has(answer.element_key)) continue;
    if (!own(template.elements, answer.element_key)) continue;
    const meta = template.elements[answer.element_key];
    if (!meta || meta.showInReport !== true) continue;
    const label = present(answer.label);
    const unitLabel = meta.unit === null ? unitLabelOf(answers, answer.element_key) : null;
    const valueText = answerValueText(answer, unitLabel ? { ...meta, unit: unitLabel } : meta);
    if (label === null || valueText === null) continue;
    result.push({ elementKey: answer.element_key, label, valueText });
  }
  return result;
}

// --- Flettefelt --------------------------------------------------------------------------------

/** Svarene i rommet slik flettefeltene leser dem (valgkoder, tall eller tekst), og valgtekstene. */
function roomMergeInput(room: SnapshotRoom) {
  const values: Record<string, unknown> = Object.create(null);
  const optionLabels = new Map<string, string>();
  const all = [...room.answers, ...room.checkpoints.flatMap((c) => c.answers)];
  for (const answer of all) {
    const keys = answer.value_option_keys;
    if (keys && keys.length > 0) {
      values[answer.element_key] = keys;
      keys.forEach((key, index) => {
        const label = answer.value_option_labels?.[index];
        if (label) optionLabels.set(`${answer.element_key}|${key}`, label);
      });
    } else if (answer.value_number !== null) {
      values[answer.element_key] = answer.value_number;
    } else if (present(answer.value_text) !== null) {
      values[answer.element_key] = answer.value_text;
    }
  }
  return {
    values,
    optionLabel: (elementKey: string, optionKey: string) =>
      optionLabels.get(`${elementKey}|${optionKey}`) ?? null,
  };
}

/** Teksten med flettefeltene fylt inn. Manglende verdi blir «[årstall mangler]», aldri `{…}`. */
function merged(text: string | null, values: MergeValues): string | null {
  const value = present(text);
  return value === null ? null : present(mergeFieldsText(value, values).text);
}

// --- Funnene fra sjekken (bare utkast, F8) -----------------------------------------------------

type PlacedFindings = {
  checkpointNotes: Map<string, PdfDraftNote[]>;
  checkpointNotSet: Set<string>;
  deviationNotes: Map<string, PdfDraftNote[]>;
  deviationNotSet: Set<string>;
  reportNotes: PdfDraftNote[];
};

const checkpointRef = (roomId: string, checkpointId: string) => `${roomId}|${checkpointId}`;

function push(map: Map<string, PdfDraftNote[]>, key: string, note: PdfDraftNote): void {
  const list = map.get(key);
  if (list) list.push(note);
  else map.set(key, [note]);
}

/**
 * Plasserer hvert funn ved målet sitt (A536, F8): `mandatory_without_tg` om TG gir «Ikke satt» på
 * punktet eller avviket; andre sperrer gir «Mangler», advarsler «Sjekk». Funn uten punkt eller
 * avvik i rapporten står øverst på siden «Ikke med i PDF-en». Teksten er publiseringsskjermens.
 */
function placeFindings(
  findings: readonly PublishCheckFinding[],
  rooms: readonly SnapshotRoom[],
): PlacedFindings {
  const placed: PlacedFindings = {
    checkpointNotes: new Map(),
    checkpointNotSet: new Set(),
    deviationNotes: new Map(),
    deviationNotSet: new Set(),
    reportNotes: [],
  };
  const checkpoints = new Set<string>();
  const deviations = new Map<string, { number: number; tg: 2 | 3 | null }>();
  for (const room of rooms) {
    for (const checkpoint of room.checkpoints) {
      checkpoints.add(checkpointRef(room.room_id, checkpoint.checkpoint_id));
      checkpoint.deviations.forEach((deviation, index) => {
        const tg = deviation.kind === "tg" && (deviation.tg === 2 || deviation.tg === 3);
        deviations.set(deviation.id, { number: index + 1, tg: tg ? deviation.tg : null });
      });
    }
  }

  for (const finding of findings) {
    const { target } = finding;
    const deviation = target.deviationId ? deviations.get(target.deviationId) : undefined;
    const text = publishFindingText(finding, {
      deviationNumber: deviation?.number ?? null,
      deviationTg: deviation?.tg ?? null,
    });
    const note: PdfDraftNote = {
      kind: finding.severity === "blocker" ? "missing" : "check",
      checkCode: finding.checkCode,
      text,
    };
    const notSet = finding.checkCode === "mandatory_without_tg";
    if (target.deviationId && deviation) {
      if (notSet) placed.deviationNotSet.add(target.deviationId);
      else push(placed.deviationNotes, target.deviationId, note);
      continue;
    }
    const ref =
      target.roomId && target.checkpointId
        ? checkpointRef(target.roomId, target.checkpointId)
        : null;
    if (ref && checkpoints.has(ref)) {
      // TGIU uten grunn er også `mandatory_without_tg`, men da mangler grunnen, ikke TG
      if (notSet && !target.missing.includes("reason")) placed.checkpointNotSet.add(ref);
      else push(placed.checkpointNotes, ref, note);
      continue;
    }
    placed.reportNotes.push(note);
  }
  return placed;
}

// --- Rapportens deler --------------------------------------------------------------------------

function editPathOf(
  assignmentId: string,
  roomId: string,
  anchor: "punkt" | "avvik",
  id: string,
): string | null {
  if (!isUuid(assignmentId) || !isUuid(roomId) || !isUuid(id)) return null;
  return `/oppdrag/${assignmentId}/rom/${roomId}#${anchor}-${id}`;
}

function pdfCost(cost: SnapshotDeviation["cost"]): PdfCost {
  if (cost.type === "none") {
    // Ingen kostnadslinje, men forklaringen står med når den finnes (testplanen 3.1.18)
    return {
      type: cost.type,
      bandKey: null,
      amount: null,
      displayText: null,
      text: present(cost.text),
    };
  }
  return {
    type: cost.type,
    bandKey: cost.band_key,
    amount: cost.amount,
    displayText: present(
      costDisplayText(cost.type, { amount: cost.amount, bandKey: cost.band_key }),
    ),
    text: present(cost.text),
  };
}

function causeLabelOf(criterion: string | null): string | null {
  if (!criterion || criterion === "other" || !own(CAUSE_CRITERION_LABELS, criterion)) return null;
  return CAUSE_CRITERION_LABELS[criterion as keyof typeof CAUSE_CRITERION_LABELS];
}

/** TGIU med samme felt som skjermen, i skjermens rekkefølge. Tomme felt er aldri med. */
function pdfTgiu(tgiu: SnapshotTgiu, values: MergeValues): PdfTgiu {
  const details: PdfTgiuDetail[] = [];
  const add = (field: keyof typeof TGIU_FIELD_LABELS, text: string | null) => {
    if (text !== null) details.push({ field, label: TGIU_FIELD_LABELS[field], text });
  };
  add("reason", merged(tgiu.reason, values));
  add("risk_assessment", merged(tgiu.risk_assessment, values));
  add("how_to_examine", merged(tgiu.how_to_examine, values));
  add("alternative_check_method", merged(tgiu.alternative_check_method, values));
  add("alternative_check_result", merged(tgiu.alternative_check_result, values));
  const vulnerable = tgiu.construction_vulnerable;
  add(
    "construction_vulnerable",
    vulnerable && own(CONSTRUCTION_VULNERABLE_LABELS, vulnerable)
      ? CONSTRUCTION_VULNERABLE_LABELS[vulnerable]
      : null,
  );
  return {
    details,
    ownerInformedText: tgiu.owner_informed === true ? `${TGIU_FIELD_LABELS.owner_informed}.` : null,
  };
}

/** Målingen regelen slo til på, brukes når svaret mangler (som når avviket lages). */
function deviationMergeValues(deviation: SnapshotDeviation, values: MergeValues): MergeValues {
  const result: MergeValues = { ...values };
  if (!result.måleverdi && deviation.measurement_value !== null) {
    result.måleverdi = mergeNumberText(deviation.measurement_value);
  }
  return result;
}

function pdfDeviation(
  deviation: SnapshotDeviation,
  values: MergeValues,
  context: BuildContext,
  roomId: string,
): PdfDeviation {
  const deviationValues = deviationMergeValues(deviation, values);
  const isTg = deviation.kind === "tg";
  const tg =
    isTg && (deviation.tg === 2 || deviation.tg === 3) ? (String(deviation.tg) as "2" | "3") : null;
  return {
    deviationId: deviation.id,
    kind: isTg ? "tg" : "hms",
    tg,
    // Fra sjekken alene (F8): utkastet lager ingen egne regler for hva som mangler
    tgNotSet: context.draft && isTg && context.placed.deviationNotSet.has(deviation.id),
    text: merged(deviation.deviation_text, deviationValues),
    causeLabel: causeLabelOf(deviation.cause_criterion),
    causeText: merged(deviation.cause_text, deviationValues),
    consequenceText: merged(deviation.consequence_text, deviationValues),
    measures: deviation.measures
      .map((measure) => merged(measure.text, deviationValues))
      .filter((text): text is string => text !== null),
    cost: pdfCost(deviation.cost),
    images: [],
    notes: context.draft ? [...(context.placed.deviationNotes.get(deviation.id) ?? [])] : [],
    editPath: context.draft
      ? editPathOf(context.assignmentId, roomId, "avvik", deviation.id)
      : null,
  };
}

type BuildContext = {
  draft: boolean;
  assignmentId: string;
  template: PdfTemplateLabels;
  placed: PlacedFindings;
};

/** Et punkt med innhold, eller `null` når punktet er helt tomt (da står det i `missing` i utkast). */
function pdfCheckpoint(
  checkpoint: SnapshotCheckpoint,
  room: SnapshotRoom,
  values: MergeValues,
  context: BuildContext,
): PdfCheckpoint | null {
  const ref = checkpointRef(room.room_id, checkpoint.checkpoint_id);
  const answers = pdfAnswers(checkpoint.answers, context.template);
  const deviations = checkpoint.deviations.map((deviation) =>
    pdfDeviation(deviation, values, context, room.room_id),
  );
  const tgiu =
    checkpoint.tg_direct === "IU" && checkpoint.tgiu ? pdfTgiu(checkpoint.tgiu, values) : null;
  const hasTgiu = tgiu !== null && (tgiu.details.length > 0 || tgiu.ownerInformedText !== null);
  const notes = context.draft ? [...(context.placed.checkpointNotes.get(ref) ?? [])] : [];
  const descriptionText = merged(checkpoint.description_text, values);
  const tg = checkpoint.tg;
  const hasContent =
    tg !== null ||
    descriptionText !== null ||
    answers.length > 0 ||
    deviations.length > 0 ||
    hasTgiu ||
    notes.length > 0;
  if (!hasContent) return null;
  return {
    checkpointId: checkpoint.checkpoint_id,
    checkpointKey: checkpoint.checkpoint_key,
    label: checkpoint.label,
    tg,
    tgNotSet: context.draft && context.placed.checkpointNotSet.has(ref),
    descriptionText,
    answers,
    deviations,
    tgiu: hasTgiu ? tgiu : null,
    notes,
    editPath: context.draft
      ? editPathOf(context.assignmentId, room.room_id, "punkt", checkpoint.checkpoint_id)
      : null,
  };
}

function roomTitleOf(room: SnapshotRoom): string {
  return (
    present(room.name) ?? ROOM_TYPES.find((type) => type.key === room.room_type)?.label ?? "Rom"
  );
}

function cloneTgExplanation(source: PdfTgExplanation): PdfTgExplanation {
  return {
    title: source.title,
    items: source.items.map((item) => ({ ...item })),
    hmsText: source.hmsText,
    textStatus: source.textStatus,
  };
}

/**
 * `ReportPdfData` fra snapshotet (F6). Ren: samme inndata gir samme svar, og inndata endres
 * aldri. Med `draft: false` tas funnene, `missing`, merknadene og `editPath` aldri med.
 */
export const buildReportPdfData: BuildReportPdfData = (input: BuildReportPdfDataInput) => {
  const draft = input.options.draft === true;
  const { snapshot, template, cover } = input;
  const buildings = Array.isArray(snapshot.buildings) ? snapshot.buildings : [];
  const allRooms = buildings.flatMap((building) =>
    (building.floors ?? []).flatMap((floor) => floor.rooms ?? []),
  );
  const placed = placeFindings(draft ? (input.findings ?? []) : [], allRooms);
  const context: BuildContext = { draft, assignmentId: cover.assignmentId, template, placed };

  const rooms: PdfRoom[] = [];
  const emptyCheckpoints: PdfMissing["emptyCheckpoints"] = [];
  for (const building of buildings) {
    for (const floor of building.floors ?? []) {
      for (const room of floor.rooms ?? []) {
        const merge = roomMergeInput(room);
        const title = roomTitleOf(room);
        const checkpoints: PdfCheckpoint[] = [];
        for (const checkpoint of room.checkpoints) {
          const values = mergeFieldValues(
            mergeSourcesFor(checkpoint.checkpoint_key),
            merge.values,
            merge.optionLabel,
          );
          const result = pdfCheckpoint(checkpoint, room, values, context);
          if (result) {
            checkpoints.push(result);
          } else if (draft) {
            emptyCheckpoints.push({
              roomTitle: title,
              checkpointId: checkpoint.checkpoint_id,
              label: checkpoint.label,
              editPath: editPathOf(
                cover.assignmentId,
                room.room_id,
                "punkt",
                checkpoint.checkpoint_id,
              ),
            });
          }
        }
        rooms.push({
          roomId: room.room_id,
          roomType: room.room_type,
          title,
          buildingName: present(building.name),
          floorName: present(floor.name),
          answers: pdfAnswers(room.answers, template),
          checkpoints,
        });
      }
    }
  }

  const company = input.company;
  const orgNumber = present(company?.orgNumber ?? null);
  const legalName = present(company?.legalName ?? null);

  return {
    reportId: snapshot.report.report_id,
    kind: draft ? "draft" : "release",
    versionNumber: draft ? null : input.versionNumber,
    cover: {
      assignmentNumber: cover.assignmentNumber,
      addressLines: [...cover.addressLines],
      cadastralText: cover.cadastralText,
      inspectionDate: snapshot.report.inspection_date ?? null,
    },
    company: legalName && orgNumber ? { legalName, orgNumber } : null,
    tgExplanation: cloneTgExplanation(TG_EXPLANATION),
    rooms,
    missing: draft ? { reportNotes: [...placed.reportNotes], emptyCheckpoints } : null,
  };
};
