import { describe, expect, it } from "vitest";
import type { PdfCheckpoint, PdfDeviation, ReportPdfData } from "@/core/pdf";
import type { ReportSnapshot } from "@/core/reports";
import { CAUSE_CRITERION_LABELS, TGIU_FIELD_LABELS, TG_NOT_SET_LABEL } from "@/core/reports/logic";
import { costDisplayText } from "@/core/reports/logic/cost";
import { publishFindingText } from "@/core/reports/logic/publish-check-texts";
import type { PublishCheckFinding } from "@/core/reports/logic/publish-check-types";
import { CAUSE_CRITERIA, PUBLISH_BLOCKER_CODES, PUBLISH_WARNING_CODES } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import {
  allKeys,
  buildInput,
  finding,
  SNAP_COMPANY,
  SNAP_COVER,
  SNAP_IDS,
  snapAnswer,
  snapCheckpoint,
  snapDeviation,
  snapMeasure,
  snapRoom,
  snapshotOf,
  snapTgiu,
} from "../../../tests/pdf-snapshot-fixtures";
import { buildReportPdfData } from "./pdf-data-build";

/*
 * `buildReportPdfData` som ren funksjon (testplanen for PDF av badet avsnitt 3.1, 10.3.2, 10.4,
 * 10.6.2 og 10.7.1–10.7.3; kortets T1–T26 og A540–A542). Inndata er et oppdiktet
 * `ReportSnapshot` og funn fra publiseringssjekken, utdata er `ReportPdfData`. Ingen database.
 *
 * Hovedmål: færre reklamasjoner (hvert avvik vises likt hver gang, og utkastet sier det samme som
 * sjekken), KI i bunnen (én ren funksjon med faste koder; ventende KI-forslag og KI-merker kommer
 * aldri med) og de ansatte (lenker rett til feltet som skal rettes).
 */

const NBSP = " ";
const MARK = "MERKETEKST-PDF-7c1e";

const CP = {
  general: "wet_room.general",
  documentation: "wet_room.documentation",
  walls: "wet_room.walls_ceiling",
  floor: "wet_room.floor",
  membrane: "wet_room.membrane_drain",
  fixtures: "wet_room.fixtures",
  ventilation: "wet_room.ventilation",
  adjacent: "wet_room.adjacent",
} as const;

function build(snapshot: ReportSnapshot, options: Parameters<typeof buildInput>[1] = {}) {
  return buildReportPdfData(buildInput(snapshot, options));
}

function oneCheckpoint(data: ReportPdfData, checkpointId: string): PdfCheckpoint {
  const found = data.rooms
    .flatMap((r) => r.checkpoints)
    .find((c) => c.checkpointId === checkpointId);
  if (!found) throw new Error(`fant ikke punktet ${checkpointId} i PDF-dataene`);
  return found;
}

function oneDeviation(data: ReportPdfData, deviationId: string): PdfDeviation {
  const found = data.rooms
    .flatMap((r) => r.checkpoints)
    .flatMap((c) => c.deviations)
    .find((d) => d.deviationId === deviationId);
  if (!found) throw new Error(`fant ikke avviket ${deviationId} i PDF-dataene`);
  return found;
}

/** Alle tekster i dataene utenom forsiden, for søk etter persondata og merketekster. */
function textOutsideCover(data: ReportPdfData): string {
  const { cover: _cover, ...rest } = data;
  return JSON.stringify(rest);
}

function answersText(c: PdfCheckpoint): string {
  return c.answers.map((a) => `${a.label}: ${a.valueText}`).join("\n");
}

/** Teksten fra sjekken, med eller uten avviksnummer og TG (skjermen viser «Avvik 1 (TG3)»). */
function findingTexts(f: PublishCheckFinding, deviationTg: 2 | 3 | null = null): Set<string> {
  return new Set([
    publishFindingText(f),
    publishFindingText(f, { deviationNumber: 1, deviationTg }),
    publishFindingText(f, { deviationNumber: null, deviationTg }),
    publishFindingText(f, { deviationNumber: 1, deviationTg: null }),
  ]);
}

function allNotes(data: ReportPdfData) {
  const checkpoints = data.rooms.flatMap((r) => r.checkpoints);
  return [
    ...checkpoints.flatMap((c) => c.notes.map((n) => ({ where: c.checkpointId, note: n }))),
    ...checkpoints.flatMap((c) =>
      c.deviations.flatMap((d) => d.notes.map((n) => ({ where: d.deviationId, note: n }))),
    ),
    ...(data.missing?.reportNotes ?? []).map((n) => ({ where: "report", note: n })),
  ];
}

// --- 3.1 T1–T16 og testsakene 17–23 --------------------------------------------------------

describe("3.1 buildReportPdfData: T1–T16", () => {
  it("T1 TG3 med intervall 20 000–100 000 gir TG 3 og kostnadsteksten med hardt mellomrom", () => {
    const dev = snapDeviation({
      tg: 3,
      cause_text: "Oppdiktet årsak.",
      consequence_text: "Oppdiktet konsekvens.",
      cost: { type: "band", band_key: "from_20000_to_100000", amount: null, text: null },
    });
    const cp = snapCheckpoint(CP.membrane, { tg: "3", deviations: [dev] });
    const data = build(snapshotOf([snapRoom([cp])]));
    const out = oneDeviation(data, dev.id);
    expect(out.tg).toBe("3");
    expect(out.cost.displayText).toBe(`20${NBSP}000–100${NBSP}000 kr`);
    expect(out.cost.displayText).toBe(
      costDisplayText("band", { bandKey: "from_20000_to_100000", amount: null }),
    );
  });

  it.each([
    ["under_20000", `Under 20${NBSP}000 kr`],
    ["over_500000", `Over 500${NBSP}000 kr`],
  ])("T2 intervallet %s gir «%s»", (bandKey, expected) => {
    const dev = snapDeviation({
      tg: 3,
      cost: { type: "band", band_key: bandKey, amount: null, text: null },
    });
    const data = build(
      snapshotOf([snapRoom([snapCheckpoint(CP.floor, { tg: "3", deviations: [dev] })])]),
    );
    expect(oneDeviation(data, dev.id).cost.displayText).toBe(expected);
  });

  it.each([
    [40000, `ca. 40${NBSP}000 kr`],
    [37500, `ca. 37${NBSP}500 kr`],
  ])("T3 eget beløp %d gir «%s» (PDF-delen runder ikke av)", (amount, expected) => {
    const dev = snapDeviation({
      tg: 3,
      cost: { type: "approx", band_key: null, amount, text: null },
    });
    const data = build(
      snapshotOf([snapRoom([snapCheckpoint(CP.floor, { tg: "3", deviations: [dev] })])]),
    );
    expect(oneDeviation(data, dev.id).cost.displayText).toBe(expected);
    expect(oneDeviation(data, dev.id).cost.amount).toBe(amount);
  });

  it("T4 TG3 uten kostnad: ingen kostnadstekst; utkastet har «Mangler» med sjekkens tekst", () => {
    const dev = snapDeviation({
      tg: 3,
      cost: { type: "none", band_key: null, amount: null, text: null },
    });
    const cp = snapCheckpoint(CP.membrane, { tg: "3", deviations: [dev] });
    const f = finding("tg3_missing_cost", "blocker", {
      roomId: SNAP_IDS.room,
      checkpointId: cp.checkpoint_id,
      checkpointKey: cp.checkpoint_key,
      deviationId: dev.id,
    });
    const draft = build(snapshotOf([snapRoom([cp])]), { findings: [f] });
    const out = oneDeviation(draft, dev.id);
    expect(out.cost.displayText).toBeNull();
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]).toMatchObject({ kind: "missing", checkCode: "tg3_missing_cost" });
    expect(findingTexts(f, 3).has(out.notes[0]!.text)).toBe(true);

    const release = build(snapshotOf([snapRoom([cp])]), { draft: false });
    expect(oneDeviation(release, dev.id).notes).toEqual([]);
    expect(oneDeviation(release, dev.id).cost.displayText).toBeNull();
  });

  it("T5 TG2 med årsak, konsekvens og to tiltak: alt med, tiltakene i lagret rekkefølge", () => {
    const dev = snapDeviation({
      tg: 2,
      cause_criterion: "symptom_of_damage",
      cause_text: "Oppdiktet årsak T5.",
      consequence_text: "Oppdiktet konsekvens T5.",
      measures: [snapMeasure("Andre tiltak i lista."), snapMeasure("Første tiltak i lista.")],
    });
    const data = build(
      snapshotOf([snapRoom([snapCheckpoint(CP.floor, { tg: "2", deviations: [dev] })])]),
    );
    const out = oneDeviation(data, dev.id);
    expect(out.tg).toBe("2");
    expect(out.causeText).toBe("Oppdiktet årsak T5.");
    expect(out.consequenceText).toBe("Oppdiktet konsekvens T5.");
    // Snapshotet har tiltakene i lagret rekkefølge (sort_order); PDF-dataene sorterer aldri om.
    expect(out.measures).toEqual(["Andre tiltak i lista.", "Første tiltak i lista."]);
  });

  it("T6 punkt med TG2- og TG3-avvik viser punktets TG 3 fra snapshotet", () => {
    const tg2 = snapDeviation({ tg: 2 });
    const tg3 = snapDeviation({ tg: 3 });
    const cp = snapCheckpoint(CP.floor, { tg: "3", deviations: [tg2, tg3] });
    const data = build(snapshotOf([snapRoom([cp])]));
    expect(oneCheckpoint(data, cp.checkpoint_id).tg).toBe("3");
    expect(oneDeviation(data, tg2.id).tg).toBe("2");
    expect(oneDeviation(data, tg3.id).tg).toBe("3");
  });

  it("T7 bare HMS-avvik: ingen TG på avviket eller punktet; konsekvens og tiltak med", () => {
    const hms = snapDeviation({
      kind: "hms",
      tg: null,
      consequence_text: "Oppdiktet HMS-konsekvens.",
      measures: [snapMeasure("Oppdiktet HMS-tiltak.")],
    });
    const cp = snapCheckpoint(CP.fixtures, { tg: null, deviations: [hms] });
    const data = build(snapshotOf([snapRoom([cp])]));
    const out = oneDeviation(data, hms.id);
    expect(out.kind).toBe("hms");
    expect(out.tg).toBeNull();
    expect(out.tgNotSet).toBe(false);
    expect(out.consequenceText).toBe("Oppdiktet HMS-konsekvens.");
    expect(out.measures).toEqual(["Oppdiktet HMS-tiltak."]);
    expect(oneCheckpoint(data, cp.checkpoint_id).tg).toBeNull();
  });

  it("T8 wet_room.adjacent med TGIU og eier nektet: TGIU og alle sju opplysningene, ingen TG2", () => {
    const cp = snapCheckpoint(CP.adjacent, {
      tg: "IU",
      tg_direct: "IU",
      tgiu: snapTgiu({
        reason: "Oppdiktet: eier ga ikke samtykke til hulltaking.",
        risk_assessment: "Oppdiktet risiko.",
        how_to_examine: "Oppdiktet: ta hull fra naborommet.",
        alternative_check_method: "Oppdiktet overflatemåling.",
        alternative_check_result: "Oppdiktet resultat uten utslag.",
        construction_vulnerable: "yes",
        owner_informed: true,
        owner_informed_at: "2026-06-15",
      }),
    });
    const data = build(snapshotOf([snapRoom([cp])]));
    const out = oneCheckpoint(data, cp.checkpoint_id);
    expect(out.tg).toBe("IU");
    expect(out.deviations).toEqual([]);
    const fields = out.tgiu!.details.map((d) => d.field).sort();
    expect(fields).toEqual(
      [
        "reason",
        "risk_assessment",
        "how_to_examine",
        "alternative_check_method",
        "alternative_check_result",
        "construction_vulnerable",
      ].sort(),
    );
    expect(out.tgiu!.ownerInformedText).toEqual(expect.any(String));
    expect(out.tgiu!.ownerInformedText!.length).toBeGreaterThan(0);
    for (const d of out.tgiu!.details) {
      expect(d.label).toBe(TGIU_FIELD_LABELS[d.field as keyof typeof TGIU_FIELD_LABELS]);
    }
    expect(out.tgiu!.details.find((d) => d.field === "construction_vulnerable")!.text).toBe("Ja");
    expect(JSON.stringify(out)).not.toMatch(/"tg":"2"/);
  });

  it("T9 TGIU på annet punkt: hva/hvorfor, risiko og hva som må til; ingen fuktkontroll- eller eierlinjer", () => {
    const cp = snapCheckpoint(CP.walls, {
      tg: "IU",
      tg_direct: "IU",
      tgiu: snapTgiu({
        reason: "Oppdiktet: himlingen er dekket av plater.",
        risk_assessment: "Oppdiktet risiko T9.",
        how_to_examine: "Oppdiktet: åpne en plate.",
      }),
    });
    const data = build(snapshotOf([snapRoom([cp])]));
    const out = oneCheckpoint(data, cp.checkpoint_id);
    expect(out.tgiu!.details.map((d) => d.field).sort()).toEqual(
      ["how_to_examine", "reason", "risk_assessment"].sort(),
    );
    expect(out.tgiu!.ownerInformedText).toBeNull();
  });

  it("T10 TG0 direkte på wet_room.adjacent: TG 0 og ingen avvik", () => {
    const cp = snapCheckpoint(CP.adjacent, { tg: "0", tg_direct: "0", done: true });
    const data = build(snapshotOf([snapRoom([cp])]));
    const out = oneCheckpoint(data, cp.checkpoint_id);
    expect(out.tg).toBe("0");
    expect(out.deviations).toEqual([]);
    expect(out.tgiu).toBeNull();
  });

  it("T11 TG1 med beskrivelse uten avvik: TG 1 og beskrivelsen, tom avviksliste", () => {
    const cp = snapCheckpoint(CP.ventilation, {
      tg: "1",
      tg_direct: "1",
      description_text: "Oppdiktet beskrivelse av ventilasjonen.",
    });
    const data = build(snapshotOf([snapRoom([cp])]));
    const out = oneCheckpoint(data, cp.checkpoint_id);
    expect(out.tg).toBe("1");
    expect(out.descriptionText).toBe("Oppdiktet beskrivelse av ventilasjonen.");
    expect(out.deviations).toEqual([]);
  });

  it("T12 beskrivelse uten TG gir tg null og «Ikke satt» i utkast; tomt punkt står bare i missing", () => {
    const described = snapCheckpoint(CP.general, {
      description_text: "Oppdiktet beskrivelse T12.",
    });
    const empty = snapCheckpoint(CP.documentation);
    const f = finding("mandatory_without_tg", "blocker", {
      roomId: SNAP_IDS.room,
      checkpointId: described.checkpoint_id,
      checkpointKey: described.checkpoint_key,
      missing: ["tg"],
    });
    const data = build(snapshotOf([snapRoom([described, empty])]), { findings: [f] });
    const out = oneCheckpoint(data, described.checkpoint_id);
    expect(out.tg).toBeNull();
    expect(out.tgNotSet).toBe(true);
    expect(data.rooms.flatMap((r) => r.checkpoints).map((c) => c.checkpointId)).not.toContain(
      empty.checkpoint_id,
    );
    expect(data.missing!.emptyCheckpoints.map((c) => c.checkpointId)).toEqual([
      empty.checkpoint_id,
    ]);
    expect(data.missing!.emptyCheckpoints[0]!.label).toBe("Dokumentasjon for våtrom");

    const release = build(snapshotOf([snapRoom([described, empty])]), { draft: false });
    expect(oneCheckpoint(release, described.checkpoint_id).tgNotSet).toBe(false);
    expect(release.missing).toBeNull();
  });

  it("T13 avvikstekst med {årstall} uten verdi gir «[årstall mangler]» og ingen krøllparenteser", () => {
    const dev = snapDeviation({
      tg: 2,
      deviation_text: "Oppdiktet: sjiktet er fra {årstall} og er gammelt.",
    });
    const cp = snapCheckpoint(CP.membrane, { tg: "2", deviations: [dev] });
    const data = build(snapshotOf([snapRoom([cp])]));
    const text = oneDeviation(data, dev.id).text!;
    expect(text).toContain("[årstall mangler]");
    expect(JSON.stringify(data)).not.toMatch(/[{}]årstall|\{årstall\}/);
    expect(text).not.toMatch(/[{}]/);
  });

  it("T13b avvikstekst med {årstall} fylles fra snapshotets svar", () => {
    const dev = snapDeviation({ tg: 2, deviation_text: "Oppdiktet: sjiktet er fra {årstall}." });
    const cp = snapCheckpoint(CP.membrane, {
      tg: "2",
      deviations: [dev],
      answers: [snapAnswer("wet_room.membrane_year", { number: 1991 })],
    });
    const data = build(snapshotOf([snapRoom([cp])]));
    expect(oneDeviation(data, dev.id).text).toBe("Oppdiktet: sjiktet er fra 1991.");
  });

  it("T14 regelbeslutninger og KI-merker i snapshotet kommer ikke med i PDF-dataene", () => {
    const aiUsageId = "0193b000-0000-7000-8000-0000000aa001";
    const dev = snapDeviation({
      tg: 2,
      deviation_text: "Oppdiktet godtatt tekst.",
      ai: { deviation_text: { ai_usage_id: aiUsageId, status: "accepted" } },
    });
    const cp = snapCheckpoint(CP.membrane, {
      tg: "2",
      deviations: [dev],
      description_text: "Oppdiktet beskrivelse.",
      description_ai: { ai_usage_id: aiUsageId, status: "edited" },
      rule_decisions: [
        {
          rule_key: "wet_room.membrane_before_2000",
          decision: "rejected",
          chosen_tg: null,
          chosen_outcome_key: null,
          override_reason_code: "other",
          decided_at: "2026-06-15T10:00:00.000Z",
        },
      ],
    });
    const data = build(snapshotOf([snapRoom([cp])]));
    const json = JSON.stringify(data);
    expect(json).not.toContain(aiUsageId);
    expect(json).not.toContain("wet_room.membrane_before_2000");
    expect(json).not.toContain("rule_decisions");
    expect(json).not.toContain("override_reason");
  });

  it("T16 teksten i dataene har ingen henvisning til standarden, «§» eller gjetteord", () => {
    const dev = snapDeviation({
      tg: 3,
      cause_criterion: "age_uncertain_function",
      cause_text: "Oppdiktet årsak.",
      consequence_text: "Oppdiktet konsekvens.",
      cost: { type: "band", band_key: "from_20000_to_100000", amount: null, text: null },
      measures: [snapMeasure("Oppdiktet tiltak.")],
    });
    const data = build(
      snapshotOf([snapRoom([snapCheckpoint(CP.membrane, { tg: "3", deviations: [dev] })])]),
    );
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/NS\s?3600/);
    expect(json).not.toMatch(/\bantas\b|\btrolig\b/i);
    const deviations = JSON.stringify(
      data.rooms.flatMap((r) => r.checkpoints).map((c) => c.deviations),
    );
    expect(deviations).not.toContain("§");
  });
});

describe("3.1.17 årsakskriteriet", () => {
  it.each([...CAUSE_CRITERIA])(
    "%s: etiketten står sammen med årsaksteksten («Annet» aldri alene)",
    (criterion) => {
      const dev = snapDeviation({
        tg: 2,
        cause_criterion: criterion,
        cause_text: "Oppdiktet årsakstekst.",
      });
      const data = build(
        snapshotOf([snapRoom([snapCheckpoint(CP.floor, { tg: "2", deviations: [dev] })])]),
      );
      const out = oneDeviation(data, dev.id);
      expect(out.causeText).toBe("Oppdiktet årsakstekst.");
      if (criterion === "other") {
        expect(out.causeLabel).toBeNull();
      } else {
        expect(out.causeLabel).toBe(CAUSE_CRITERION_LABELS[criterion]);
      }
    },
  );

  it("tabellen dekker alle kriteriene (et nytt kriterium uten etikett gjør testen rød)", () => {
    expect(Object.keys(CAUSE_CRITERION_LABELS).sort()).toEqual([...CAUSE_CRITERIA].sort());
  });
});

describe("3.1.18 kostnaden", () => {
  it("cost_type none gir ingen kostnadslinje; cost_text står med når den finnes", () => {
    const none = snapDeviation({
      tg: 3,
      cost: { type: "none", band_key: null, amount: null, text: "Oppdiktet kostnadsforklaring." },
    });
    const data = build(
      snapshotOf([snapRoom([snapCheckpoint(CP.floor, { tg: "3", deviations: [none] })])]),
    );
    const out = oneDeviation(data, none.id);
    expect(out.cost.displayText).toBeNull();
    expect(out.cost.text).toBe("Oppdiktet kostnadsforklaring.");
  });

  it("kostnad på TG2 vises når den er satt", () => {
    const dev = snapDeviation({
      tg: 2,
      cost: { type: "band", band_key: "under_20000", amount: null, text: null },
    });
    const data = build(
      snapshotOf([snapRoom([snapCheckpoint(CP.floor, { tg: "2", deviations: [dev] })])]),
    );
    expect(oneDeviation(data, dev.id).cost.displayText).toBe(`Under 20${NBSP}000 kr`);
  });
});

describe("3.1.19–3.1.23 etiketter, persondata, aldri med, selskap og renhet", () => {
  it("19 etiketten fra den låste malversjonen (snapshotet) brukes", () => {
    const cp = snapCheckpoint(CP.floor, {
      tg: "1",
      tg_direct: "1",
      label: "Låst etikett fra versjon 1",
      description_text: "Oppdiktet.",
    });
    const data = build(snapshotOf([snapRoom([cp])]));
    expect(oneCheckpoint(data, cp.checkpoint_id).label).toBe("Låst etikett fra versjon 1");
  });

  it("20 adresse og matrikkel står bare under cover", () => {
    const cp = snapCheckpoint(CP.floor, {
      tg: "1",
      tg_direct: "1",
      description_text: "Oppdiktet.",
    });
    const cover = {
      assignmentId: SNAP_IDS.assignment,
      assignmentNumber: "2026-0042",
      addressLines: [`Prøvevegen ${MARK}`, "8000 Oppdiktet"],
      cadastralText: `Gnr. ${MARK}`,
    };
    const data = build(snapshotOf([snapRoom([cp])]), { cover });
    expect(data.cover.addressLines.join(" ")).toContain(MARK);
    expect(data.cover.cadastralText).toContain(MARK);
    expect(textOutsideCover(data)).not.toContain(MARK);
  });

  it("21 og 10.3.2 nøkkelsøk: ingen KI, kilder, begrunnelser, sammendrag eller sjekkrader", () => {
    const aiUsageId = "0193b000-0000-7000-8000-0000000aa002";
    const dev = snapDeviation({
      tg: 2,
      text_source: "edited",
      suggested_by_rule_key: "wet_room.membrane_past_lifespan",
      measures: [
        { ...snapMeasure("Oppdiktet tiltak."), ai: { ai_usage_id: aiUsageId, status: "accepted" } },
      ],
      ai: { cause_text: { ai_usage_id: aiUsageId, status: "accepted" } },
    });
    const cp = snapCheckpoint(CP.membrane, {
      tg: "2",
      deviations: [dev],
      answers: [
        snapAnswer(
          "wet_room.membrane_type",
          { optionKeys: ["foil"] },
          {
            ai: { ai_usage_id: aiUsageId, status: "edited" },
          },
        ),
      ],
    });
    const f = finding("tg2_tg3_missing_measure", "warning", {
      roomId: SNAP_IDS.room,
      checkpointId: cp.checkpoint_id,
      checkpointKey: cp.checkpoint_key,
      deviationId: dev.id,
      missing: ["measure"],
    });
    for (const draft of [true, false]) {
      const data = build(snapshotOf([snapRoom([cp])]), {
        draft,
        findings: draft ? [f] : null,
      });
      const keys = allKeys(data);
      for (const forbidden of [
        "ai",
        "ai_usage_id",
        "aiUsageId",
        "text_source",
        "textSource",
        "rule_decisions",
        "ruleDecisions",
        "summary_text",
        "summaryText",
        "summary_basis",
        "summaryBasis",
        "regulation_ref",
        "regulationRef",
        "help_text",
        "helpText",
        "reasons",
        "claims",
        "override_reason",
        "overrideReason",
        "overrideReasonCode",
        "suggested_by_rule_key",
        "suggestedByRuleKey",
        "severity",
        "target",
      ]) {
        expect(keys.has(forbidden), `nøkkelen ${forbidden} (draft=${draft})`).toBe(false);
      }
      const json = JSON.stringify(data);
      expect(json).not.toContain(aiUsageId);
      expect(json).not.toContain("wet_room.membrane_past_lifespan");
    }
  });

  it.each([
    ["selskap med navn og org.nr.", { ...SNAP_COMPANY }, { ...SNAP_COMPANY }],
    ["selskap mangler", null, null],
    ["org.nr. mangler", { legalName: "Testselskap takst AS", orgNumber: null }, null],
    ["tomt org.nr.", { legalName: "Testselskap takst AS", orgNumber: "" }, null],
  ] as const)("22 %s", (_name, company, expected) => {
    const cp = snapCheckpoint(CP.floor, {
      tg: "1",
      tg_direct: "1",
      description_text: "Oppdiktet.",
    });
    const data = build(snapshotOf([snapRoom([cp])]), {
      company: company === null ? null : { ...company },
    });
    if (expected === null) expect(data.company).toBeNull();
    else expect(data.company).toEqual(expected);
  });

  it("23 ren: samme rader to ganger gir likt svar, og inndata er uendret", () => {
    const dev = snapDeviation({
      tg: 3,
      deviation_text: "Oppdiktet {årstall}.",
      cost: { type: "approx", band_key: null, amount: 40000, text: null },
      measures: [snapMeasure("B"), snapMeasure("A")],
    });
    const cp = snapCheckpoint(CP.membrane, { tg: "3", deviations: [dev] });
    const f = finding("tg2_tg3_missing_cause_or_consequence", "blocker", {
      roomId: SNAP_IDS.room,
      checkpointId: cp.checkpoint_id,
      checkpointKey: cp.checkpoint_key,
      deviationId: dev.id,
      missing: ["cause_text", "consequence_text"],
    });
    const input = buildInput(snapshotOf([snapRoom([cp, snapCheckpoint(CP.fixtures)])]), {
      findings: [f],
    });
    const before = structuredClone(input);
    const first = buildReportPdfData(input);
    const second = buildReportPdfData(input);
    expect(second).toEqual(first);
    expect(input).toEqual(before);
  });
});

// --- Utkast og utgivelse -------------------------------------------------------------------

describe("utkast og utgivelse (F3, F4, F6)", () => {
  function richSnapshot() {
    const dev = snapDeviation({ tg: 2, cause_text: "Oppdiktet." });
    const cp = snapCheckpoint(CP.floor, { tg: "2", deviations: [dev] });
    const empty = snapCheckpoint(CP.ventilation);
    return { snapshot: snapshotOf([snapRoom([cp, empty])]), cp, dev, empty };
  }

  it("utkast: kind draft, lenker med bare id-er til punkt og avvik", () => {
    const { snapshot, cp, dev } = richSnapshot();
    const data = build(snapshot, { draft: true });
    expect(data.kind).toBe("draft");
    expect(data.versionNumber).toBeNull();
    const roomPath = `/oppdrag/${SNAP_IDS.assignment}/rom/${SNAP_IDS.room}`;
    expect(oneCheckpoint(data, cp.checkpoint_id).editPath).toBe(
      `${roomPath}#punkt-${cp.checkpoint_id}`,
    );
    expect(oneDeviation(data, dev.id).editPath).toBe(`${roomPath}#avvik-${dev.id}`);
    for (const path of JSON.stringify(data).match(/"editPath":"[^"]*"/g) ?? []) {
      expect(path).toMatch(
        /^"editPath":"\/oppdrag\/[0-9a-f-]{36}\/rom\/[0-9a-f-]{36}#(punkt|avvik)-[0-9a-f-]{36}"$/,
      );
    }
  });

  it("utgivelse: kind release med versjon, ingen missing, merknader, lenker eller «Ikke satt»", () => {
    const { snapshot, cp } = richSnapshot();
    const f = finding("mandatory_without_tg", "blocker", {
      roomId: SNAP_IDS.room,
      checkpointId: cp.checkpoint_id,
      checkpointKey: cp.checkpoint_key,
      missing: ["tg"],
    });
    // Funn sendt inn ved en feil skal heller ikke med når draft er usann
    const data = build(snapshot, { draft: false, findings: [f], versionNumber: 2 });
    expect(data.kind).toBe("release");
    expect(data.versionNumber).toBe(2);
    expect(data.missing).toBeNull();
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/"editPath":"/);
    expect(json).not.toMatch(/"tgNotSet":true/);
    expect(allNotes(data)).toEqual([]);
  });

  it("TG-forklaringen sendes med og har tekststatus utkast (A533)", () => {
    const { snapshot } = richSnapshot();
    const data = build(snapshot);
    expect(data.tgExplanation.items.map((i) => i.tg)).toEqual(["0", "1", "2", "3", "IU"]);
    expect(data.tgExplanation.textStatus).toBe("draft");
  });

  it("forsiden: befaringsdatoen fra snapshotet og oppdragsnummeret fra forsideraden", () => {
    const { snapshot } = richSnapshot();
    const data = build(snapshot);
    expect(data.cover.inspectionDate).toBe("2026-06-15");
    expect(data.cover.assignmentNumber).toBe(SNAP_COVER.assignmentNumber);
    expect(data.reportId).toBe(SNAP_IDS.report);
  });

  it("rommet har navn og etasje fra snapshotet", () => {
    const { snapshot } = richSnapshot();
    const room = build(snapshot).rooms[0]!;
    expect(room.title).toBe("Bad i 2. etasje");
    expect(room.floorName).toBe("2. etasje");
    expect(room.roomId).toBe(SNAP_IDS.room);
  });

  it("rom helt uten innhold gir ikke noe rom i dataene for utgivelsen", () => {
    const snapshot = snapshotOf([snapRoom([snapCheckpoint(CP.floor), snapCheckpoint(CP.general)])]);
    const data = build(snapshot, { draft: false });
    expect(data.rooms.flatMap((r) => r.checkpoints)).toEqual([]);
  });
});

// --- 10.7.1 A540 svar på felt ---------------------------------------------------------------

type AnswerCase = {
  key: string;
  value: { text?: string | null; number?: number | null; optionKeys?: string[] | null };
  /** Det som skal stå i svarene på punktet (etikett: verdi). `null` = skal aldri stå. */
  expected: RegExp | null;
  /** Etiketten fra malen står med svaret. */
  labelShown: boolean;
};

/** Én rad per felt i badmalen. Et nytt felt i malen uten rad her gjør testen rød. */
const ANSWER_CASES: AnswerCase[] = [
  { key: "wet_room.build_year", value: { number: 1998 }, expected: /1998/, labelShown: true },
  {
    key: "wet_room.build_year_source",
    value: { optionKeys: ["owner_stated"] },
    expected: /Opplyst av eier/,
    labelShown: true,
  },
  {
    key: "wet_room.building_code",
    value: { optionKeys: ["tek10"] },
    expected: null,
    labelShown: false,
  },
  {
    key: "wet_room.documentation_type",
    value: { optionKeys: ["wet_room_certificate"] },
    expected: /Våtromssertifikat/,
    labelShown: true,
  },
  {
    key: "wet_room.ceiling_type",
    value: { optionKeys: ["panel"] },
    expected: /Panel/,
    labelShown: true,
  },
  {
    key: "wet_room.floor_type",
    value: { optionKeys: ["tiles"] },
    expected: /Fliser/,
    labelShown: true,
  },
  {
    key: "wet_room.floor_heating",
    value: { optionKeys: ["heating_cables"] },
    expected: /Varmekabler/,
    labelShown: true,
  },
  {
    key: "wet_room.fall_direction_1",
    value: { number: 12.5 },
    expected: /12,5[\s ]?mm\/m/,
    labelShown: true,
  },
  {
    key: "wet_room.fall_direction_2",
    value: { number: -3.5 },
    expected: /3,5[\s ]?mm\/m/,
    labelShown: true,
  },
  {
    key: "wet_room.threshold_height_mm",
    value: { number: 15 },
    expected: /15[\s ]?mm/,
    labelShown: true,
  },
  {
    key: "wet_room.membrane_type",
    value: { optionKeys: ["liquid_membrane"] },
    expected: /Smøremembran/,
    labelShown: true,
  },
  { key: "wet_room.membrane_year", value: { number: 2004 }, expected: /2004/, labelShown: true },
  {
    key: "wet_room.drain_type",
    value: { optionKeys: ["clamping_ring"] },
    expected: /Sluk med klemring/,
    labelShown: true,
  },
  {
    key: "wet_room.ventilation_type",
    value: { optionKeys: ["mechanical_extract"] },
    expected: /Mekanisk avtrekk/,
    labelShown: true,
  },
  {
    key: "wet_room.hole_drilling",
    value: { optionKeys: ["done_no_findings"] },
    expected: /Utført uten funn/,
    labelShown: true,
  },
  {
    key: "wet_room.hole_moisture_reading",
    value: { number: 12.4 },
    expected: /12,4[\s ]?vekt-%/i,
    labelShown: true,
  },
  // Enheten kan stå sammen med målingen («12,4 vekt-%») eller som eget svar
  {
    key: "wet_room.hole_moisture_unit",
    value: { optionKeys: ["weight_percent"] },
    expected: /vekt-%/i,
    labelShown: false,
  },
  {
    key: "wet_room.hole_moisture_location",
    value: { text: "Oppdiktet målested bak dusjveggen" },
    expected: /Oppdiktet målested bak dusjveggen/,
    labelShown: true,
  },
  {
    key: "wet_room.hole_air_temperature",
    value: { number: 21.5 },
    expected: /21,5[\s ]?°C/,
    labelShown: true,
  },
  {
    key: "wet_room.hole_construction",
    value: { text: "Oppdiktet oppbygging" },
    expected: /Oppdiktet oppbygging/,
    labelShown: true,
  },
  {
    key: "wet_room.hole_drilling_reason",
    value: { optionKeys: ["owner_refused"] },
    expected: /Eier ga ikke samtykke/,
    labelShown: true,
  },
  {
    key: "wet_room.hole_drilling_reason_note",
    value: { text: "Oppdiktet begrunnelse for hullet" },
    expected: /Oppdiktet begrunnelse for hullet/,
    labelShown: true,
  },
  {
    key: "wet_room.owner_informed",
    value: { optionKeys: null, text: null, number: null },
    expected: null,
    labelShown: false,
  },
  {
    key: "wet_room.other_moisture_method",
    value: { text: "Oppdiktet metode" },
    expected: /Oppdiktet metode/,
    labelShown: true,
  },
  {
    key: "wet_room.other_moisture_result",
    value: { text: "Oppdiktet resultat" },
    expected: /Oppdiktet resultat/,
    labelShown: true,
  },
  {
    key: "wet_room.not_investigated_risk",
    value: { text: "Oppdiktet risiko ved feltet" },
    expected: /Oppdiktet risiko ved feltet/,
    labelShown: true,
  },
  {
    key: "wet_room.construction_damage_prone",
    value: { optionKeys: ["yes"] },
    expected: /Ja/,
    labelShown: true,
  },
];

describe("10.7.1 A540 svar på felt med show_in_report", () => {
  const elementsByKey = new Map(wetRoomTemplate.elements.map((e) => [e.key, e]));

  it("tabellen har én rad for hvert felt i badmalen", () => {
    expect(ANSWER_CASES.map((c) => c.key).sort()).toEqual(
      wetRoomTemplate.elements.map((e) => e.key).sort(),
    );
  });

  it("raden følger show_in_report i malen", () => {
    for (const c of ANSWER_CASES) {
      const el = elementsByKey.get(c.key)!;
      if (!el.show_in_report) expect(c.expected, c.key).toBeNull();
    }
  });

  function snapshotWithAll() {
    const byCheckpoint = new Map<string, ReturnType<typeof snapAnswer>[]>();
    for (const c of ANSWER_CASES) {
      const el = elementsByKey.get(c.key)!;
      const list = byCheckpoint.get(el.checkpoint_key!) ?? [];
      list.push(
        snapAnswer(c.key, c.key === "wet_room.building_code" ? { optionKeys: ["tek10"] } : c.value),
      );
      byCheckpoint.set(el.checkpoint_key!, list);
    }
    const checkpoints = [...byCheckpoint.entries()].map(([key, answers]) =>
      snapCheckpoint(key, { tg: "1", tg_direct: "1", answers }),
    );
    return { snapshot: snapshotOf([snapRoom(checkpoints)]), checkpoints };
  }

  it.each(ANSWER_CASES.filter((c) => c.expected !== null))(
    "$key står med valgtekst eller tall med komma og enhet",
    (c) => {
      const { snapshot, checkpoints } = snapshotWithAll();
      const data = build(snapshot);
      const el = elementsByKey.get(c.key)!;
      const cp = checkpoints.find((x) => x.checkpoint_key === el.checkpoint_key)!;
      const out = oneCheckpoint(data, cp.checkpoint_id);
      const text = answersText(out);
      expect(text).toMatch(c.expected!);
      if (c.labelShown) expect(text).toContain(el.label);
      // Valgkoden står aldri som tekst
      for (const key of c.value.optionKeys ?? []) {
        expect(out.answers.map((a) => a.valueText)).not.toContain(key);
      }
    },
  );

  it("show_in_report = false (byggeforskriften) kommer aldri med (T18)", () => {
    const { snapshot } = snapshotWithAll();
    const data = build(snapshot);
    expect(
      data.rooms
        .flatMap((r) => r.checkpoints)
        .flatMap((c) => c.answers)
        .map((a) => a.elementKey),
    ).not.toContain("wet_room.building_code");
    expect(JSON.stringify(data)).not.toContain("TEK10");
    expect(JSON.stringify(data)).not.toContain("Byggeforskrift");
  });

  it("T18 felt med show_in_report = false og merketekst finnes ikke i dataene", () => {
    const cp = snapCheckpoint(CP.general, {
      tg: "1",
      tg_direct: "1",
      answers: [
        snapAnswer(
          "wet_room.building_code",
          { optionKeys: ["tek10"] },
          {
            value_option_labels: [MARK],
          },
        ),
      ],
    });
    const data = build(snapshotOf([snapRoom([cp])]));
    expect(JSON.stringify(data)).not.toContain(MARK);
  });

  it("et felt som ikke står i malens etiketter, regnes som skjult", () => {
    const cp = snapCheckpoint(CP.general, {
      tg: "1",
      tg_direct: "1",
      answers: [snapAnswer("wet_room.build_year", { number: 1998 })],
    });
    const template = { elements: {} };
    const data = build(snapshotOf([snapRoom([cp])]), { template });
    expect(oneCheckpoint(data, cp.checkpoint_id).answers).toEqual([]);
  });

  it("tomme svar gir ingen linje", () => {
    const cp = snapCheckpoint(CP.walls, {
      tg: "1",
      tg_direct: "1",
      answers: [snapAnswer("wet_room.ceiling_type", { optionKeys: null })],
    });
    const data = build(snapshotOf([snapRoom([cp])]));
    expect(oneCheckpoint(data, cp.checkpoint_id).answers).toEqual([]);
  });

  it("T17 hull tatt uten funn, måling 12,4 vekt-%: svaret og målingen med enhet står under punktet", () => {
    const cp = snapCheckpoint(CP.adjacent, {
      tg: "1",
      tg_direct: "1",
      answers: [
        snapAnswer("wet_room.hole_drilling", { optionKeys: ["done_no_findings"] }),
        snapAnswer("wet_room.hole_moisture_reading", { number: 12.4 }),
        snapAnswer("wet_room.hole_moisture_unit", { optionKeys: ["weight_percent"] }),
      ],
    });
    const out = oneCheckpoint(build(snapshotOf([snapRoom([cp])])), cp.checkpoint_id);
    const text = answersText(out);
    expect(text).toContain("Hulltaking");
    expect(text).toContain("Utført uten funn");
    expect(text).toMatch(/12,4[\s ]?vekt-%/i);
    expect(text).not.toContain("12.4");
    expect(text).not.toContain("weight_percent");
  });
});

// --- 10.7.2 T19–T23 ------------------------------------------------------------------------

describe("10.7.2 T19–T23", () => {
  it("T19 hull ikke tatt med grunn: grunnen står med etikett", () => {
    const cp = snapCheckpoint(CP.adjacent, {
      tg: "IU",
      tg_direct: "IU",
      answers: [
        snapAnswer("wet_room.hole_drilling", { optionKeys: ["not_done"] }),
        snapAnswer("wet_room.hole_drilling_reason", { optionKeys: ["owner_refused"] }),
      ],
      tgiu: snapTgiu({ reason: "Oppdiktet grunn." }),
    });
    const out = oneCheckpoint(build(snapshotOf([snapRoom([cp])])), cp.checkpoint_id);
    const text = answersText(out);
    expect(text).toContain("Hvorfor hull ikke er tatt");
    expect(text).toContain("Eier ga ikke samtykke");
  });

  it("T19 hull ikke tatt uten grunn: «Mangler» med sjekkens tekst i utkastet", () => {
    const cp = snapCheckpoint(CP.adjacent, {
      tg: "1",
      tg_direct: "1",
      answers: [snapAnswer("wet_room.hole_drilling", { optionKeys: ["not_done"] })],
    });
    const f = finding("wet_or_below_ground_missing_hole", "blocker", {
      roomId: SNAP_IDS.room,
      checkpointId: cp.checkpoint_id,
      checkpointKey: cp.checkpoint_key,
      missing: ["hole_drilling_reason"],
    });
    const out = oneCheckpoint(
      build(snapshotOf([snapRoom([cp])]), { findings: [f] }),
      cp.checkpoint_id,
    );
    expect(out.notes).toEqual([
      {
        kind: "missing",
        checkCode: "wet_or_below_ground_missing_hole",
        text: publishFindingText(f),
      },
    ]);
    expect(out.notes[0]!.text).toBe("Hulltaking er ikke utført, og grunnen mangler.");
  });

  it("T20 TGIU uten «hva og hvorfor»: «Mangler» i utkastet", () => {
    const cp = snapCheckpoint(CP.walls, {
      tg: "IU",
      tg_direct: "IU",
      tgiu: snapTgiu({ risk_assessment: "Oppdiktet risiko." }),
    });
    const f = finding("mandatory_without_tg", "blocker", {
      roomId: SNAP_IDS.room,
      checkpointId: cp.checkpoint_id,
      checkpointKey: cp.checkpoint_key,
      missing: ["reason"],
    });
    const out = oneCheckpoint(
      build(snapshotOf([snapRoom([cp])]), { findings: [f] }),
      cp.checkpoint_id,
    );
    const texts = out.notes.map((n) => n.text);
    expect(texts).toContain("TGIU mangler grunn: hva er ikke undersøkt, og hvorfor.");
    expect(out.notes.find((n) => n.checkCode === "mandatory_without_tg")!.kind).toBe("missing");
  });

  it.each([
    [true, true],
    [false, false],
    [null, false],
  ])("T20 owner_informed = %s gir setningen om utvidet ansvar: %s", (informed, shown) => {
    const cp = snapCheckpoint(CP.adjacent, {
      tg: "IU",
      tg_direct: "IU",
      tgiu: snapTgiu({ reason: "Oppdiktet grunn.", owner_informed: informed }),
    });
    const out = oneCheckpoint(build(snapshotOf([snapRoom([cp])])), cp.checkpoint_id);
    if (shown) expect(out.tgiu!.ownerInformedText).toEqual(expect.any(String));
    else expect(out.tgiu!.ownerInformedText).toBeNull();
    expect(out.tgiu!.details.map((d) => d.field)).not.toContain("owner_informed");
  });

  it("T21 punkt uten TG-krav med beskrivelse: ingen TG og ikke «Ikke satt»", () => {
    const cp = snapCheckpoint("wet_room.note_only", {
      label: "Oppdiktet punkt uten TG",
      description_text: "Oppdiktet merknad.",
    });
    const out = oneCheckpoint(
      build(snapshotOf([snapRoom([cp])]), { findings: [] }),
      cp.checkpoint_id,
    );
    expect(out.tg).toBeNull();
    expect(out.tgNotSet).toBe(false);
    expect(JSON.stringify(out)).not.toContain(TG_NOT_SET_LABEL);
  });

  it("T22 avvik uten valgt TG: «Ikke satt» på avviket, og punktets TG er fra de andre avvikene", () => {
    const without = snapDeviation({ tg: null });
    const tg2 = snapDeviation({ tg: 2, cause_text: "Oppdiktet." });
    const cp = snapCheckpoint(CP.floor, { tg: "2", deviations: [without, tg2] });
    const f = finding("mandatory_without_tg", "blocker", {
      roomId: SNAP_IDS.room,
      checkpointId: cp.checkpoint_id,
      checkpointKey: cp.checkpoint_key,
      deviationId: without.id,
      missing: ["tg"],
    });
    const data = build(snapshotOf([snapRoom([cp])]), { findings: [f] });
    expect(oneDeviation(data, without.id).tgNotSet).toBe(true);
    expect(oneDeviation(data, without.id).tg).toBeNull();
    expect(oneDeviation(data, tg2.id).tgNotSet).toBe(false);
    expect(oneCheckpoint(data, cp.checkpoint_id).tg).toBe("2");
    expect(oneCheckpoint(data, cp.checkpoint_id).tgNotSet).toBe(false);
  });

  it("T23 hjelpetekster og forskriftshenvisning fra malen står ikke i dataene", () => {
    const cp = snapCheckpoint(CP.floor, {
      tg: "1",
      tg_direct: "1",
      answers: [snapAnswer("wet_room.fall_direction_1", { number: 12.5 })],
    });
    const json = JSON.stringify(build(snapshotOf([snapRoom([cp])])));
    for (const el of wetRoomTemplate.elements) {
      if (el.help_text) expect(json).not.toContain(el.help_text);
    }
    for (const c of wetRoomTemplate.checkpoints) {
      if (c.regulation_ref) expect(json).not.toContain(c.regulation_ref);
    }
    expect(json).not.toContain("§");
  });
});

// --- 10.4 T24: utkastet og sjekken sier det samme --------------------------------------------

type FindingCase = {
  name: string;
  /** Lager funnet med målet i snapshotet. */
  make: (ids: { cp: string; cpKey: string; dev: string }) => PublishCheckFinding;
  /** Hvor funnet skal stå. */
  at: "checkpoint" | "deviation" | "report";
  kind: "missing" | "check" | "not_set";
};

const FINDING_CASES: FindingCase[] = [
  {
    name: "mandatory_without_tg på punktet gir «Ikke satt»",
    make: ({ cp, cpKey }) =>
      finding("mandatory_without_tg", "blocker", {
        roomId: SNAP_IDS.room,
        checkpointId: cp,
        checkpointKey: cpKey,
        missing: ["tg"],
      }),
    at: "checkpoint",
    kind: "not_set",
  },
  {
    name: "mandatory_without_tg på avviket gir «Ikke satt» på avviket",
    make: ({ cp, cpKey, dev }) =>
      finding("mandatory_without_tg", "blocker", {
        roomId: SNAP_IDS.room,
        checkpointId: cp,
        checkpointKey: cpKey,
        deviationId: dev,
        missing: ["tg"],
      }),
    at: "deviation",
    kind: "not_set",
  },
  {
    name: "tg2_tg3_missing_cause_or_consequence",
    make: ({ cp, cpKey, dev }) =>
      finding("tg2_tg3_missing_cause_or_consequence", "blocker", {
        roomId: SNAP_IDS.room,
        checkpointId: cp,
        checkpointKey: cpKey,
        deviationId: dev,
        missing: ["cause_text", "consequence_text"],
      }),
    at: "deviation",
    kind: "missing",
  },
  {
    name: "tg3_missing_cost",
    make: ({ cp, cpKey, dev }) =>
      finding("tg3_missing_cost", "blocker", {
        roomId: SNAP_IDS.room,
        checkpointId: cp,
        checkpointKey: cpKey,
        deviationId: dev,
      }),
    at: "deviation",
    kind: "missing",
  },
  {
    name: "wet_or_below_ground_missing_hole",
    make: ({ cp, cpKey }) =>
      finding("wet_or_below_ground_missing_hole", "blocker", {
        roomId: SNAP_IDS.room,
        checkpointId: cp,
        checkpointKey: cpKey,
        missing: ["hole_drilling"],
      }),
    at: "checkpoint",
    kind: "missing",
  },
  {
    name: "tg2_tg3_missing_measure (advarsel)",
    make: ({ cp, cpKey, dev }) =>
      finding("tg2_tg3_missing_measure", "warning", {
        roomId: SNAP_IDS.room,
        checkpointId: cp,
        checkpointKey: cpKey,
        deviationId: dev,
        missing: ["measure"],
      }),
    at: "deviation",
    kind: "check",
  },
  {
    name: "hms_missing_consequence_or_measure (advarsel)",
    make: ({ cp, cpKey, dev }) =>
      finding("hms_missing_consequence_or_measure", "warning", {
        roomId: SNAP_IDS.room,
        checkpointId: cp,
        checkpointKey: cpKey,
        deviationId: dev,
        missing: ["consequence_text"],
      }),
    at: "deviation",
    kind: "check",
  },
  {
    name: "hole_reading_missing (advarsel)",
    make: ({ cp, cpKey }) =>
      finding("hole_reading_missing", "warning", {
        roomId: SNAP_IDS.room,
        checkpointId: cp,
        checkpointKey: cpKey,
      }),
    at: "checkpoint",
    kind: "check",
  },
  {
    name: "ai_suggestion_pending (advarsel) viser bare den faste teksten",
    make: ({ cp, cpKey, dev }) =>
      finding("ai_suggestion_pending", "warning", {
        roomId: SNAP_IDS.room,
        checkpointId: cp,
        checkpointKey: cpKey,
        deviationId: dev,
        aiUsageId: "0193b000-0000-7000-8000-0000000aa003",
      }),
    at: "deviation",
    kind: "check",
  },
  {
    name: "inspection_date_missing står øverst på «Ikke med i PDF-en»",
    make: () => finding("inspection_date_missing", "blocker", {}),
    at: "report",
    kind: "missing",
  },
];

describe("10.4 T24: utkastet og publiseringssjekken sier det samme (F8, A536)", () => {
  function caseSnapshot() {
    const dev = snapDeviation({ tg: 3, cause_text: null, consequence_text: null });
    const cp = snapCheckpoint(CP.membrane, { tg: "3", deviations: [dev] });
    const other = snapCheckpoint(CP.floor, {
      tg: "1",
      tg_direct: "1",
      description_text: "Oppdiktet.",
    });
    return { snapshot: snapshotOf([snapRoom([cp, other])]), cp, dev, other };
  }

  it.each(FINDING_CASES)("$name", (c) => {
    const { snapshot, cp, dev, other } = caseSnapshot();
    const f = c.make({ cp: cp.checkpoint_id, cpKey: cp.checkpoint_key, dev: dev.id });
    const data = build(snapshot, { findings: [f] });
    const notes = allNotes(data);
    const otherCp = oneCheckpoint(data, other.checkpoint_id);
    expect(otherCp.notes).toEqual([]);
    expect(otherCp.tgNotSet).toBe(false);

    if (c.kind === "not_set") {
      const target =
        c.at === "deviation" ? oneDeviation(data, dev.id) : oneCheckpoint(data, cp.checkpoint_id);
      expect(target.tgNotSet).toBe(true);
      // Bare ett sted
      const notSetCount = (JSON.stringify(data).match(/"tgNotSet":true/g) ?? []).length;
      expect(notSetCount).toBe(1);
      return;
    }
    expect(notes).toHaveLength(1);
    const [only] = notes;
    const expectedWhere =
      c.at === "report" ? "report" : c.at === "deviation" ? dev.id : cp.checkpoint_id;
    expect(only!.where).toBe(expectedWhere);
    expect(only!.note.kind).toBe(c.kind);
    expect(only!.note.checkCode).toBe(f.checkCode);
    expect(
      findingTexts(f, c.at === "deviation" ? 3 : null).has(only!.note.text),
      only!.note.text,
    ).toBe(true);
    // Merknaden har bare sjekkens tekst, ingen KI-tekst eller koder
    expect(only!.note.text).not.toMatch(/[a-z]+_[a-z_]+/);
    expect(JSON.stringify(data)).not.toContain("0193b000-0000-7000-8000-0000000aa003");
  });

  it("tabellen dekker alle sperrer og advarsler som kan ha et mål i badet", () => {
    const covered = new Set(
      FINDING_CASES.map((c) => c.make({ cp: "x", cpKey: "y", dev: "z" }).checkCode),
    );
    // bra_missing og electrical_missing regnes ikke ut før 2a-3
    for (const code of PUBLISH_BLOCKER_CODES) {
      if (code === "bra_missing" || code === "electrical_missing") continue;
      expect(covered.has(code), code).toBe(true);
    }
    expect(PUBLISH_WARNING_CODES.length).toBeGreaterThan(0);
  });

  it("utkast uten funn har verken «Ikke satt», «Mangler» eller «Sjekk»", () => {
    const { snapshot } = caseSnapshot();
    const data = build(snapshot, { findings: [] });
    expect(allNotes(data)).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/"tgNotSet":true/);
  });

  it("hvert punkt med mandatory_without_tg står som «Ikke satt» eller på siden «Ikke med i PDF-en»", () => {
    const described = snapCheckpoint(CP.general, { description_text: "Oppdiktet." });
    const empty = snapCheckpoint(CP.membrane);
    const findings = [described, empty].map((cp) =>
      finding("mandatory_without_tg", "blocker", {
        roomId: SNAP_IDS.room,
        checkpointId: cp.checkpoint_id,
        checkpointKey: cp.checkpoint_key,
        missing: ["tg"],
      }),
    );
    const data = build(snapshotOf([snapRoom([described, empty])]), { findings });
    expect(oneCheckpoint(data, described.checkpoint_id).tgNotSet).toBe(true);
    expect(data.missing!.emptyCheckpoints.map((c) => c.checkpointId)).toContain(
      empty.checkpoint_id,
    );
  });
});

// --- 10.7.3 A542: KI-tekst vises som vanlig lagret tekst ---------------------------------------

describe("10.7.3 A542: tekst fra KI gir samme PDF-data som tekst skrevet for hånd", () => {
  it("avvik med KI-merke og text_source edited er likt samme avvik skrevet for hånd", () => {
    const base = {
      id: "0193b000-0000-7000-8000-0000000bb001",
      tg: 2 as const,
      deviation_text: "Oppdiktet avvikstekst.",
      cause_text: "Oppdiktet årsak.",
      consequence_text: "Oppdiktet konsekvens.",
    };
    const byHand = snapDeviation({ ...base, text_source: "free", ai: {} });
    const fromAi = snapDeviation({
      ...base,
      text_source: "edited",
      ai: {
        deviation_text: { ai_usage_id: "0193b000-0000-7000-8000-0000000aa009", status: "accepted" },
        cause_text: { ai_usage_id: "0193b000-0000-7000-8000-0000000aa009", status: "edited" },
      },
    });
    const cpId = "0193b000-0000-7000-8000-0000000bb002";
    const make = (dev: typeof byHand) =>
      build(
        snapshotOf([
          snapRoom([snapCheckpoint(CP.floor, { checkpoint_id: cpId, tg: "2", deviations: [dev] })]),
        ]),
      );
    expect(make(fromAi)).toEqual(make(byHand));
  });
});
