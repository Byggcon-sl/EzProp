import { and, count, eq } from "drizzle-orm";
import type { Actor } from "@/core/access";
import {
  addDeviation,
  addMeasure,
  getPublishCheck,
  publishReport,
  saveField,
  setTgDirect,
  startNewVersion,
} from "@/core/reports";
import { db } from "@/db/client";
import {
  assignments,
  checkpointResults,
  companies,
  deviationMeasures,
  deviations,
  events,
  fieldAnswers,
  files,
  reportReleases,
  reports,
  tgiuDetails,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { createCompany, nextFakeOrgNumber } from "./factories";
import {
  createPublishableBathroom,
  WET_ROOM_CHECKPOINT_KEYS,
  type PublishableOptions,
} from "./publish-fixtures";
import { answerHole, startedView } from "./report-fixtures";

/*
 * Oppsett for testene av PDF-dataene og PDF-rutene mot testdatabasen (testplanen for PDF av
 * badet avsnitt 5, 6, 10 og 11). Bygger på `createPublishableBathroom`. Testfilen må ha
 * `vi.mock("server-only", () => ({}))`. Alle verdier er oppdiktede: adresser som «Prøvevegen 1»,
 * selskap «Testselskap takst AS» med `nextFakeOrgNumber()`.
 */

export const FLOOR = "wet_room.floor";

export type PdfBathroomOptions = PublishableOptions & {
  /** Tekst i adressen, beskrivelsen, avviket, tiltaket og selskapsnavnet, så lekkasjer synes. */
  mark?: string;
  /** Lag et TG2-avvik på gulvet med årsak, konsekvens og ett tiltak. Standard sann. */
  withDeviation?: boolean;
};

/**
 * Et bad som kan publiseres, med juridisk selskap (navn og org.nr.), adresse med merketekst, en
 * beskrivelse på punktet «Generelt» og et TG2-avvik på gulvet. Alle punkter utenom gulvet har TG1.
 */
export async function createPdfBathroom(options: PdfBathroomOptions = {}) {
  const mark = options.mark ?? "MERKE-A";
  const f = await createPublishableBathroom({ ...options, complete: false });
  await db
    .update(companies)
    .set({ legalName: `Testselskap takst ${mark} AS`, orgNumber: nextFakeOrgNumber() })
    .where(eq(companies.id, f.companyId));
  await db
    .update(assignments)
    .set({ addressText: `Prøvevegen 1 ${mark}, 8000 Oppdiktet` })
    .where(eq(assignments.id, f.assignmentId));
  for (const checkpointKey of WET_ROOM_CHECKPOINT_KEYS) {
    if (checkpointKey === FLOOR && options.withDeviation !== false) continue;
    await setTgDirect(f.actor, f.organizationId, f.room, {
      checkpointKey,
      tgDirect: "1",
      base: null,
    });
  }
  await answerHole(f, "done_no_findings", 10);
  await setDescription(f, "wet_room.general", `Oppdiktet beskrivelse ${mark}.`);
  let deviationId: string | null = null;
  let measureId: string | null = null;
  if (options.withDeviation !== false) {
    deviationId = await addFloorDeviation(f);
    await setDeviationText(f, deviationId, "deviation_text", `Oppdiktet avvik ${mark}.`);
    await setDeviationText(f, deviationId, "cause_text", `Oppdiktet årsak ${mark}.`);
    await setDeviationText(f, deviationId, "consequence_text", `Oppdiktet konsekvens ${mark}.`);
    measureId = uuidv7();
    await addMeasure(f.actor, f.organizationId, f.room, { id: measureId, deviationId });
    await saveField(f.actor, f.organizationId, f.room, {
      table: "deviation_measures",
      id: measureId,
      field: "text",
      value: `Oppdiktet tiltak ${mark}.`,
      base: "",
    });
  }
  const [assignment] = await db
    .select({ number: assignments.number })
    .from(assignments)
    .where(eq(assignments.id, f.assignmentId));
  return { ...f, mark, deviationId, measureId, assignmentNumber: assignment!.number };
}

export type PdfBathroom = Awaited<ReturnType<typeof createPdfBathroom>>;

type Who = Pick<PdfBathroom, "actor" | "organizationId" | "room">;

/** Lagrer beskrivelsen på punktet. `base` er teksten som står der fra før. */
export async function setDescription(
  f: Who,
  checkpointKey: string,
  text: string,
  base: string | null = null,
) {
  const result = await saveField(f.actor, f.organizationId, f.room, {
    table: "checkpoint_results",
    checkpointKey,
    field: "description_text",
    value: text,
    base,
  });
  if (result.status !== "saved") throw new Error(`beskrivelsen ble ikke lagret: ${result.status}`);
}

/** Et TG2-avvik på gulvet fra første utfall i malen. Returnerer id-en. */
export async function addFloorDeviation(f: Who): Promise<string> {
  const view = await startedView(f);
  const question = view.document.deviation_questions.find((q) => q.checkpoint_key === FLOOR)!;
  const outcome = view.document.outcomes.find(
    (o) => o.question_key === question.key && o.kind !== "hms",
  )!;
  const id = uuidv7();
  const result = await addDeviation(f.actor, f.organizationId, f.room, {
    id,
    checkpointKey: FLOOR,
    questionKey: question.key,
    outcomeKey: outcome.key,
    tg: 2,
  });
  if (result.status !== "saved") throw new Error(`avviket ble ikke lagt til: ${result.status}`);
  return id;
}

export async function setDeviationText(
  f: Who,
  deviationId: string,
  field: "deviation_text" | "cause_text" | "consequence_text",
  value: string,
) {
  const [row] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
  const base =
    field === "deviation_text"
      ? row!.deviationText
      : field === "cause_text"
        ? row!.causeText
        : row!.consequenceText;
  const result = await saveField(f.actor, f.organizationId, f.room, {
    table: "deviations",
    id: deviationId,
    field,
    value,
    base: base ?? null,
  });
  if (result.status !== "saved") throw new Error(`teksten ble ikke lagret: ${result.status}`);
}

/** Publiserer med alle sperrer krysset bort. Returnerer utgivelsens id. */
export async function publishAs(
  actor: Actor,
  f: Pick<PdfBathroom, "organizationId" | "assignmentId">,
) {
  const view = await getPublishCheck(actor, f.organizationId, f.assignmentId);
  if (view.state !== "draft") throw new Error(`forventet draft, fikk ${view.state}`);
  const result = await publishReport(actor, f.organizationId, {
    assignmentId: f.assignmentId,
    fingerprint: view.fingerprint,
    overrides: view.findings
      .filter((x) => x.severity === "blocker")
      .map((x) => ({
        findingKey: x.key,
        reasonCode: "other" as const,
        text: "Oppdiktet begrunnelse for PDF-testene",
      })),
  });
  const all = await db
    .select({ id: reportReleases.id, versionNumber: reportReleases.versionNumber })
    .from(reportReleases)
    .where(eq(reportReleases.organizationId, f.organizationId));
  const newest = all.sort((a, b) => b.versionNumber - a.versionNumber)[0];
  if (!newest) throw new Error("ingen utgivelse");
  return { result, releaseId: newest.id, versionNumber: newest.versionNumber };
}

/** «Lag ny versjon»: samme rapport går tilbake til utkast (A522). Returnerer rapportens id. */
export async function newVersion(
  f: Pick<PdfBathroom, "actor" | "organizationId" | "assignmentId">,
) {
  const result = await startNewVersion(f.actor, f.organizationId, f.assignmentId);
  return result.reportId;
}

/** Antall rader og siste `updated_at` i rapporttabellene og `files`, for «ingen rader endres». */
export async function reportTableState(organizationId: string) {
  const tables = [
    ["reports", reports],
    ["checkpoint_results", checkpointResults],
    ["field_answers", fieldAnswers],
    ["deviations", deviations],
    ["deviation_measures", deviationMeasures],
    ["tgiu_details", tgiuDetails],
    ["report_releases", reportReleases],
  ] as const;
  const out: Record<string, unknown> = {};
  for (const [name, table] of tables) {
    const rows = await db.select().from(table).where(eq(table.organizationId, organizationId));
    out[name] = rows.map((r) => JSON.stringify(r)).sort();
  }
  out.files = Number(
    (await db.select({ n: count() }).from(files).where(eq(files.organizationId, organizationId)))[0]
      ?.n ?? 0,
  );
  return out;
}

/** Hendelsene av en type i organisasjonen. */
export async function eventsOf(organizationId: string, type: string) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.organizationId, organizationId), eq(events.type, type)));
}

/** To selskaper i samme organisasjon; oppdraget får det andre. */
export async function useSecondCompany(f: PdfBathroom) {
  const other = await createCompany(f.organizationId, {
    legalName: "Annet testselskap takst AS",
    orgNumber: nextFakeOrgNumber(),
  });
  await db
    .update(assignments)
    .set({ companyId: other.id })
    .where(eq(assignments.id, f.assignmentId));
  return other;
}
