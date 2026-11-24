import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError } from "@/core/access";
import {
  fakeAiProvider,
  FAKE_ADD_NUMBER_INPUT,
  FAKE_ADD_TG_INPUT,
  FAKE_ADDED_TG,
} from "@/core/ai/providers/fake";
import {
  addMeasure,
  polishDescription,
  polishDeviation,
  ReportValidationError,
  saveField,
} from "@/core/reports";
import { db } from "@/db/client";
import { auditLog, deviationMeasures, deviations } from "@/db/schema";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import { uuidv7 } from "@/shared/lib/uuid";
import { aiRow, aiRowCount, captureError } from "../../../tests/ai";
import { resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  addPlaceDeviation,
  kiBathroom,
  PLACE,
  type KiBathroom,
} from "../../../tests/report-ki-fixtures";
import { answer, CP } from "../../../tests/report-fixtures";

/*
 * Språkvask i avvikskortet (docs/funksjoner/fase2a-ki-i-veien-testplan.md 4b: K4.8–K4.11 for
 * rapportdelen, og A466/A469/A470 for «Bruk»). Falsk leverandør, oppdiktede tekster.
 */

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

async function deviationWithMeasures(f: KiBathroom) {
  const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
  const extra = uuidv7();
  await addMeasure(f.actor, f.organizationId, f.room, { id: extra, deviationId });
  const measures = await db
    .select()
    .from(deviationMeasures)
    .where(eq(deviationMeasures.deviationId, deviationId));
  return { deviationId, measureIds: measures.map((m) => m.id), emptyMeasure: extra };
}

function item(
  target:
    | {
        type: "deviation";
        id: string;
        fieldKey: "deviation_text" | "cause_text" | "consequence_text";
      }
    | { type: "deviation_measure"; id: string; fieldKey: "text" },
  text: string,
) {
  return { requestId: uuidv7(), target, text };
}

describe("4b språkvask avviket", () => {
  it("K4.8 ett kall til serveren gir én loggrad per felt med egen target_ref", async () => {
    const f = await kiBathroom();
    const { deviationId, measureIds } = await deviationWithMeasures(f);
    const [m1, m2] = measureIds;
    if (!m1 || !m2) throw new Error("mangler tiltak");
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const items = [
      item({ type: "deviation", id: deviationId, fieldKey: "deviation_text" }, "mxq avvik  tekst"),
      item({ type: "deviation", id: deviationId, fieldKey: "cause_text" }, "mxq årsak tekst"),
      item({ type: "deviation", id: deviationId, fieldKey: "consequence_text" }, "mxq konsekvens"),
      item({ type: "deviation_measure", id: m1, fieldKey: "text" }, "mxq tiltak en"),
      item({ type: "deviation_measure", id: m2, fieldKey: "text" }, "mxq tiltak to"),
    ];
    const result = await polishDeviation(f.actor, f.organizationId, f.room, { deviationId, items });
    if (result.status !== "done") throw new Error(`fikk ${result.status}`);
    expect(result.fields).toHaveLength(5);
    expect(spy).toHaveBeenCalledTimes(5);
    for (const [index, field] of result.fields.entries()) {
      expect(field.requestId).toBe(items[index]?.requestId);
      expect(field.result.status).toBe("suggestion");
      const row = await aiRow(field.requestId);
      expect(row).toMatchObject({
        feature: "language_polish",
        report_id: f.reportId,
        assignment_id: f.assignmentId,
        target_ref: items[index]?.target,
      });
    }
    expect(result.fields[1]?.result).toMatchObject({ text: "Mxq årsak tekst." });
  });

  it("K4.9 felt uten tekst tas ikke med; alle tomme gir intet kall og ingen rad (T-0111)", async () => {
    const f = await kiBathroom();
    const { deviationId } = await deviationWithMeasures(f);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const empty = await polishDeviation(f.actor, f.organizationId, f.room, {
      deviationId,
      items: [
        item({ type: "deviation", id: deviationId, fieldKey: "deviation_text" }, ""),
        item({ type: "deviation", id: deviationId, fieldKey: "cause_text" }, "   "),
        item({ type: "deviation", id: deviationId, fieldKey: "consequence_text" }, "\n\t "),
      ],
    });
    expect(empty).toEqual({ status: "nothing_to_polish" });
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);

    const some = await polishDeviation(f.actor, f.organizationId, f.room, {
      deviationId,
      items: [
        item({ type: "deviation", id: deviationId, fieldKey: "deviation_text" }, "  "),
        item({ type: "deviation", id: deviationId, fieldKey: "cause_text" }, "mxq årsak"),
      ],
    });
    if (some.status !== "done") throw new Error(`fikk ${some.status}`);
    expect(some.fields.map((x) => x.target.fieldKey)).toEqual(["cause_text"]);
    expect(await aiRowCount()).toBe(1);
  });

  it("K4.10 beskrivelsen på punktet har eget kall og egen rad", async () => {
    const f = await kiBathroom();
    const saved = await saveField(f.actor, f.organizationId, f.room, {
      table: "checkpoint_results",
      checkpointKey: CP.membrane,
      field: "description_text",
      value: "mxq beskrivelse",
      base: null,
    });
    if (saved.status !== "saved") throw new Error("lagring feilet");
    const requestId = uuidv7();
    const result = await polishDescription(f.actor, f.organizationId, f.room, {
      requestId,
      checkpointKey: CP.membrane,
      text: "mxq beskrivelse",
    });
    if (result.status !== "done") throw new Error(`fikk ${result.status}`);
    expect(result.fields[0]?.target).toEqual({
      type: "checkpoint_result",
      id: saved.id,
      fieldKey: "description_text",
    });
    expect((await aiRow(requestId))?.target_ref).toEqual({
      type: "checkpoint_result",
      id: saved.id,
      fieldKey: "description_text",
    });
    expect(
      await polishDescription(f.actor, f.organizationId, f.room, {
        requestId: uuidv7(),
        checkpointKey: CP.membrane,
        text: " ",
      }),
    ).toEqual({ status: "nothing_to_polish" });
  });

  it("K4.11 et stoppet felt stopper ikke de andre, og teksten går aldri til klienten (A460)", async () => {
    const f = await kiBathroom();
    const { deviationId, measureIds } = await deviationWithMeasures(f);
    const [m1] = measureIds;
    if (!m1) throw new Error("mangler tiltak");
    const items = [
      item({ type: "deviation", id: deviationId, fieldKey: "deviation_text" }, "mxq avvik"),
      item({ type: "deviation", id: deviationId, fieldKey: "cause_text" }, "mxq årsak"),
      item(
        { type: "deviation", id: deviationId, fieldKey: "consequence_text" },
        `mxq konsekvens ${FAKE_ADD_TG_INPUT}`,
      ),
      item(
        { type: "deviation_measure", id: m1, fieldKey: "text" },
        `mxq tiltak ${FAKE_ADD_NUMBER_INPUT}`,
      ),
    ];
    const result = await polishDeviation(f.actor, f.organizationId, f.room, { deviationId, items });
    if (result.status !== "done") throw new Error(`fikk ${result.status}`);
    expect(result.fields.map((x) => x.result.status)).toEqual([
      "suggestion",
      "suggestion",
      "stopped",
      "stopped",
    ]);
    expect(result.fields[2]?.result).toMatchObject({ guard: "tg_guard" });
    expect(result.fields[3]?.result).toMatchObject({ guard: "number_guard" });
    expect(JSON.stringify(result)).not.toContain(FAKE_ADDED_TG);
    const stopped = await aiRow(items[2]?.requestId ?? "");
    expect(stopped).toMatchObject({ outcome: "stopped", error_code: "tg_guard", status: null });
    const audit = await db.select().from(auditLog);
    expect(JSON.stringify(audit)).not.toContain(FAKE_ADDED_TG);
  });

  it("A460 mål utenfor avviket i rommet gir 404 uten kall", async () => {
    const f = await kiBathroom();
    const { deviationId } = await deviationWithMeasures(f);
    const other = await addPlaceDeviation(f, PLACE.furnitureTg2);
    const error = await captureError(() =>
      polishDeviation(f.actor, f.organizationId, f.room, {
        deviationId,
        items: [item({ type: "deviation", id: other, fieldKey: "cause_text" }, "mxq")],
      }),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    const b = await kiBathroom();
    const foreign = await captureError(() =>
      polishDeviation(b.actor, b.organizationId, b.room, {
        deviationId,
        items: [item({ type: "deviation", id: deviationId, fieldKey: "cause_text" }, "mxq")],
      }),
    );
    expect(foreign).toBeInstanceOf(AccessDeniedError);
    expect(await aiRowCount()).toBe(0);
  });
});

/*
 * Tenant-isolasjon for språkvasken (gjennomgangen av KI i veien): egen organisasjon får forslag på
 * egne mål; en annen organisasjon gir 404, og ingen rad havner i ai_usage_log.
 */
describe("5b tenant-isolasjon for språkvask", () => {
  type Seeded = { f: KiBathroom; deviationId: string; resultId: string };

  /** Et avvik og en lagret beskrivelse på punktet i hver organisasjon. */
  async function seedOrg(organizationId: string): Promise<Seeded> {
    const f = await kiBathroom({ organizationId });
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const saved = await saveField(f.actor, f.organizationId, f.room, {
      table: "checkpoint_results",
      checkpointKey: CP.membrane,
      field: "description_text",
      value: "mxq beskrivelse",
      base: null,
    });
    if (saved.status !== "saved") throw new Error("lagring feilet");
    return { f, deviationId, resultId: saved.id };
  }

  function deviationInput(deviationId: string) {
    return {
      deviationId,
      items: [item({ type: "deviation", id: deviationId, fieldKey: "cause_text" }, "mxq årsak")],
    };
  }

  function descriptionInput() {
    return { requestId: uuidv7(), checkpointKey: CP.membrane, text: "mxq beskrivelse" };
  }

  /** Kallene fra A mot B: B sin organisasjon, og B sitt rom med A sin organisasjon. */
  async function expectForeignDenied(a: Seeded, b: Seeded) {
    const before = await aiRowCount();
    for (const call of [
      () => polishDeviation(a.f.actor, b.f.organizationId, b.f.room, deviationInput(b.deviationId)),
      () => polishDeviation(a.f.actor, a.f.organizationId, b.f.room, deviationInput(b.deviationId)),
      () => polishDeviation(a.f.actor, a.f.organizationId, a.f.room, deviationInput(b.deviationId)),
      () => polishDescription(a.f.actor, b.f.organizationId, b.f.room, descriptionInput()),
      () => polishDescription(a.f.actor, a.f.organizationId, b.f.room, descriptionInput()),
    ]) {
      expect(await captureError(call)).toBeInstanceOf(AccessDeniedError);
    }
    expect(await aiRowCount()).toBe(before);
  }

  it("polishDeviation: en annen organisasjon får verken forslag, tilgang eller rad", async () => {
    const byOrg = new Map<string, Seeded>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedOrg(grantA.organizationId);
        const b = await seedOrg(grantB.organizationId);
        byOrg.set(grantA.organizationId, a);
        byOrg.set(grantB.organizationId, b);
        return { a: [a.deviationId], b: [b.deviationId] };
      },
      query: async (actor, organizationId) => {
        const own = byOrg.get(organizationId);
        const room = own?.f.room ?? { assignmentId: uuidv7(), roomId: uuidv7() };
        const result = await polishDeviation(
          actor,
          organizationId,
          room,
          deviationInput(own?.deviationId ?? uuidv7()),
        );
        if (result.status !== "done") throw new Error(`fikk ${result.status}`);
        return result.fields.map((field) => field.target);
      },
      idOf: (target) => target.id,
    });
    const [a, b] = [...byOrg.values()];
    if (!a || !b) throw new Error("mangler oppsett");
    await expectForeignDenied(a, b);
    await expectForeignDenied(b, a);
  });

  it("polishDescription: en annen organisasjon får verken forslag, tilgang eller rad", async () => {
    const byOrg = new Map<string, Seeded>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedOrg(grantA.organizationId);
        const b = await seedOrg(grantB.organizationId);
        byOrg.set(grantA.organizationId, a);
        byOrg.set(grantB.organizationId, b);
        return { a: [a.resultId], b: [b.resultId] };
      },
      query: async (actor, organizationId) => {
        const room = byOrg.get(organizationId)?.f.room ?? {
          assignmentId: uuidv7(),
          roomId: uuidv7(),
        };
        const result = await polishDescription(actor, organizationId, room, descriptionInput());
        if (result.status !== "done") throw new Error(`fikk ${result.status}`);
        return result.fields.map((field) => field.target);
      },
      idOf: (target) => target.id,
    });
    const [a, b] = [...byOrg.values()];
    if (!a || !b) throw new Error("mangler oppsett");
    await expectForeignDenied(a, b);
  });
});

/*
 * Tomme felt (T-0111 og gjennomgangen av KI i veien): samme regel som kjernen, så også
 * nullbreddetegn er tomt. Intet kall og ingen rad.
 */
describe("4b tomme felt med nullbreddetegn", () => {
  it("felt med bare nullbredde- og ikke-brytende mellomrom språkvaskes ikke", async () => {
    const f = await kiBathroom();
    const { deviationId } = await deviationWithMeasures(f);
    const spy = vi.spyOn(fakeAiProvider, "complete");
    const blank = "\u200B\u00A0\uFEFF \u200B";
    expect(
      await polishDeviation(f.actor, f.organizationId, f.room, {
        deviationId,
        items: [item({ type: "deviation", id: deviationId, fieldKey: "cause_text" }, blank)],
      }),
    ).toEqual({ status: "nothing_to_polish" });
    expect(
      await polishDescription(f.actor, f.organizationId, f.room, {
        requestId: uuidv7(),
        checkpointKey: CP.membrane,
        text: blank,
      }),
    ).toEqual({ status: "nothing_to_polish" });
    expect(spy).not.toHaveBeenCalled();
    expect(await aiRowCount()).toBe(0);
  });
});

describe("«Bruk» på et språkvasket felt (A466, A469, A470)", () => {
  async function polished(f: KiBathroom, deviationId: string) {
    const requestId = uuidv7();
    const result = await polishDeviation(f.actor, f.organizationId, f.room, {
      deviationId,
      items: [
        {
          requestId,
          target: { type: "deviation", id: deviationId, fieldKey: "cause_text" },
          text: "mxq årsak",
        },
      ],
    });
    if (result.status !== "done" || result.fields[0]?.result.status !== "suggestion") {
      throw new Error("fikk ikke forslag");
    }
    return { usageId: requestId, text: result.fields[0].result.text };
  }

  it("teksten lagres og beslutningen registreres i samme transaksjon", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const [before] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    const { usageId, text } = await polished(f, deviationId);
    const result = await saveField(
      f.actor,
      f.organizationId,
      f.room,
      {
        table: "deviations",
        id: deviationId,
        field: "cause_text",
        value: text,
        base: before?.causeText ?? null,
      },
      { aiDecision: { usageId, decision: "accepted" } },
    );
    expect(result.status).toBe("saved");
    expect((await aiRow(usageId))?.status).toBe("accepted");
  });

  it("A525 serveren avgjør «endret» når lagret tekst ikke er lik forslaget", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const [before] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    const { usageId, text } = await polished(f, deviationId);
    const result = await saveField(
      f.actor,
      f.organizationId,
      f.room,
      {
        table: "deviations",
        id: deviationId,
        field: "cause_text",
        value: `${text} Endret av takstmannen.`,
        base: before?.causeText ?? null,
      },
      // Nettleseren sier «godtatt», men teksten er endret
      { aiDecision: { usageId, decision: "accepted" } },
    );
    expect(result.status).toBe("saved");
    expect((await aiRow(usageId))?.status).toBe("edited");
  });

  it("K4.17b «Endret av andre» gir ingen beslutning", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const { usageId, text } = await polished(f, deviationId);
    const result = await saveField(
      f.actor,
      f.organizationId,
      f.room,
      { table: "deviations", id: deviationId, field: "cause_text", value: text, base: "Mxq feil" },
      { aiDecision: { usageId, decision: "accepted" } },
    );
    expect(result.status).toBe("conflict");
    expect((await aiRow(usageId))?.status).toBe("suggested");
  });

  it("A470 loggraden må gjelde akkurat feltet som lagres; ellers lagres ingenting", async () => {
    const f = await kiBathroom();
    const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
    const [before] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    const { usageId } = await polished(f, deviationId);
    const error = await captureError(() =>
      saveField(
        f.actor,
        f.organizationId,
        f.room,
        {
          table: "deviations",
          id: deviationId,
          field: "consequence_text",
          value: "Mxq ny konsekvens",
          base: before?.consequenceText ?? null,
        },
        { aiDecision: { usageId, decision: "accepted" } },
      ),
    );
    expect(error).toBeInstanceOf(AccessDeniedError);
    const [after] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    expect(after?.consequenceText).toBe(before?.consequenceText);
    expect((await aiRow(usageId))?.status).toBe("suggested");

    const notText = await captureError(() =>
      saveField(
        f.actor,
        f.organizationId,
        f.room,
        { table: "deviations", id: deviationId, field: "tg", value: 3, base: 2 },
        { aiDecision: { usageId, decision: "accepted" } },
      ),
    );
    expect(notText).toBeInstanceOf(ReportValidationError);
    const [tg] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
    expect(tg?.tg).toBe(2);
  });

  it.each(PII_PLACEHOLDERS.map((p) => [p]))(
    "A466 tekst med plassholderen %s avvises i alle fritekstfelt",
    async (placeholder) => {
      const f = await kiBathroom();
      const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
      const [before] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
      const error = await captureError(() =>
        saveField(f.actor, f.organizationId, f.room, {
          table: "deviations",
          id: deviationId,
          field: "cause_text",
          value: `Mxq ${placeholder} årsak`,
          base: before?.causeText ?? null,
        }),
      );
      expect(error).toBeInstanceOf(ReportValidationError);
      expect((error as ReportValidationError).code).toBe("text_has_placeholder");
      expect(error.message).toBe(
        "Teksten har en plassholder fra KI, for eksempel [adresse]. Skriv inn riktig verdi.",
      );
      const measure = await captureError(() =>
        saveField(f.actor, f.organizationId, f.room, {
          table: "checkpoint_results",
          checkpointKey: CP.membrane,
          field: "description_text",
          value: `Mxq ${placeholder}`,
          base: null,
        }),
      );
      expect((measure as ReportValidationError).code).toBe("text_has_placeholder");
    },
  );

  it("A466 tekst uten plassholder lagres som før, også med hakeparenteser", async () => {
    const f = await kiBathroom();
    const result = await answer(f, "wet_room.membrane_year", { number: 1990 });
    expect(result.status).toBe("saved");
    const saved = await saveField(f.actor, f.organizationId, f.room, {
      table: "checkpoint_results",
      checkpointKey: CP.membrane,
      field: "description_text",
      value: "Mxq [se bilde 2] og [årstall mangler]",
      base: null,
    });
    expect(saved.status).toBe("saved");
  });
});
