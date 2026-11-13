import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  aiOrganization,
  aiRow,
  aiRowCount,
  fakeErrorInputs,
  recordDecision,
  requestSuggestion,
  validRequest,
  validTarget,
} from "../../../tests/ai";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
import { AI_REJECTED_RETENTION_KEY } from "./retention";
import { addYears, insertBlockedRow } from "./usage-log";

/*
 * `retain_until` ved hver statusovergang (K7, A272–A275). Testplanen
 * docs/agenter/oppgaver/ki-oppbevaring-avviste-testplan.md avsnitt 2b (L1), 2c (D1–D12) og
 * 2d (S1–S7). Mot testdatabasen. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (datoen regnes ett sted, fra innstillingen i egen organisasjon)
 * og færre reklamasjoner (godtatte og endrede forslag står alltid 10 år, også etter angre).
 */

const CREATED = new Date("2026-11-02T09:00:00Z");
const NOW = new Date("2026-11-13T08:00:00Z");

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setOrgSettings(organizationId: string, patch: Record<string, unknown>) {
  await db.execute(
    sql`update organizations set settings = coalesce(settings, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb where id = ${organizationId}`,
  );
}

async function setRetention(organizationId: string, years: unknown) {
  await setOrgSettings(organizationId, { [AI_REJECTED_RETENTION_KEY]: years });
}

async function retainUntil(id: string): Promise<string> {
  return new Date((await aiRow(id))!.retain_until).toISOString();
}

const plus = (date: Date, years: number) => addYears(date, years).toISOString();

async function deletedCount(): Promise<number> {
  const [row] = (await db.execute(
    sql`select count(*)::int as n from ai_usage_log where deleted_at is not null`,
  )) as unknown as { n: number }[];
  return row!.n;
}

describe("ny rad (L1)", () => {
  it("L1 ny rad får alltid 10 år, uansett innstilling", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 1);

    const ok = validRequest();
    await requestSuggestion(grant, ok);
    expect(await retainUntil(ok.requestId)).toBe(plus(NOW, 10));

    const failed = validRequest({ fields: { text: fakeErrorInputs()[0]! } });
    await requestSuggestion(grant, failed);
    expect((await aiRow(failed.requestId))!.outcome).toBe("error");
    expect(await retainUntil(failed.requestId)).toBe(plus(NOW, 10));

    const blockedId = uuidv7();
    await insertBlockedRow(grant, {
      requestId: blockedId,
      feature: "language_polish",
      provider: "fake",
      model: "fake-v1",
      promptVersion: "language_polish.v1",
      assignmentId: null,
      target: validTarget(),
      sourceFields: ["text"],
    });
    expect(await retainUntil(blockedId)).toBe(plus(NOW, 10));
  });
});

describe("manuelle overganger (D1–D12)", () => {
  async function suggested(organizationId: string, employeeId: string, retain?: Date) {
    return createAiUsageLog(organizationId, {
      employeeId,
      createdAt: CREATED,
      ...(retain ? { retainUntil: retain } : {}),
    });
  }

  it("D1 avvist uten innstilling gir 10 år", async () => {
    const { organization, grant } = await aiOrganization();
    const row = await suggested(organization.id, grant.employeeId);
    await recordDecision(grant, row.id, "rejected");
    expect(await retainUntil(row.id)).toBe(plus(CREATED, 10));
  });

  it("D2 avvist med innstilling 2 gir 2 år", async () => {
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 2);
    const row = await suggested(organization.id, grant.employeeId);
    await recordDecision(grant, row.id, "rejected");
    expect(await retainUntil(row.id)).toBe(plus(CREATED, 2));
  });

  it("D3 godtatt og endret gir 10 år, også når raden hadde kort dato", async () => {
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 2);
    for (const decision of ["accepted", "edited"] as const) {
      const row = await suggested(organization.id, grant.employeeId, addYears(CREATED, 2));
      await recordDecision(grant, row.id, decision);
      expect(await retainUntil(row.id)).toBe(plus(CREATED, 10));
    }
  });

  it("D4 avvist → angre → godtatt gir 10 år", async () => {
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 2);
    const row = await suggested(organization.id, grant.employeeId);
    await recordDecision(grant, row.id, "rejected");
    expect(await retainUntil(row.id)).toBe(plus(CREATED, 2));
    await recordDecision(grant, row.id, "undo");
    expect((await aiRow(row.id))!.status).toBe("suggested");
    expect(await retainUntil(row.id)).toBe(plus(CREATED, 10));
    await recordDecision(grant, row.id, "accepted");
    expect(await retainUntil(row.id)).toBe(plus(CREATED, 10));
  });

  it("D7 grensene 1 og 10", async () => {
    const { organization, grant } = await aiOrganization();
    for (const years of [1, 10]) {
      await setRetention(organization.id, years);
      const row = await suggested(organization.id, grant.employeeId);
      await recordDecision(grant, row.id, "rejected");
      expect(await retainUntil(row.id)).toBe(plus(CREATED, years));
    }
  });

  it("D9 A273: kortere og lengre virker bare fremover", async () => {
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 10);
    const r1 = await suggested(organization.id, grant.employeeId);
    await recordDecision(grant, r1.id, "rejected");
    await setRetention(organization.id, 2);
    expect(await retainUntil(r1.id)).toBe(plus(CREATED, 10));
    const r2 = await suggested(organization.id, grant.employeeId);
    await recordDecision(grant, r2.id, "rejected");
    expect(await retainUntil(r2.id)).toBe(plus(CREATED, 2));
    await setRetention(organization.id, 10);
    expect(await retainUntil(r2.id)).toBe(plus(CREATED, 2));
    expect(await retainUntil(r1.id)).toBe(plus(CREATED, 10));
  });

  it("D10 ugyldig innstilling i databasen gir 10 år og advarsel uten verdien", async () => {
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, "5");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const row = await suggested(organization.id, grant.employeeId);
    await recordDecision(grant, row.id, "rejected");
    expect(await retainUntil(row.id)).toBe(plus(CREATED, 10));
    const calls = warn.mock.calls.filter((call) =>
      JSON.stringify(call).includes(AI_REJECTED_RETENTION_KEY),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual({
      organizationId: organization.id,
      key: AI_REJECTED_RETENTION_KEY,
    });
  });

  it("D11 innstillingen leses fra grant.organizationId", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    await setRetention(a.organization.id, 1);
    await setRetention(b.organization.id, 10);
    const rowA = await suggested(a.organization.id, a.grant.employeeId);
    const rowB = await suggested(b.organization.id, b.grant.employeeId);
    const beforeA = await aiRow(rowA.id);

    await recordDecision(b.grant, rowB.id, "rejected");
    expect(await retainUntil(rowB.id)).toBe(plus(CREATED, 10));
    const afterA = (await aiRow(rowA.id))!;
    expect(afterA.status).toBe("suggested");
    expect(new Date(afterA.retain_until).toISOString()).toBe(
      new Date(beforeA!.retain_until).toISOString(),
    );
    expect(new Date(afterA.updated_at as Date).toISOString()).toBe(
      new Date(beforeA!.updated_at as Date).toISOString(),
    );

    await recordDecision(a.grant, rowA.id, "rejected");
    expect(await retainUntil(rowA.id)).toBe(plus(CREATED, 1));
  });

  it("D12 ingen rad slettes", async () => {
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 2);
    const rows = [];
    for (let i = 0; i < 4; i += 1) rows.push(await suggested(organization.id, grant.employeeId));
    const count = await aiRowCount();
    await recordDecision(grant, rows[0]!.id, "rejected");
    await recordDecision(grant, rows[1]!.id, "accepted");
    await recordDecision(grant, rows[2]!.id, "edited");
    await recordDecision(grant, rows[3]!.id, "rejected");
    await recordDecision(grant, rows[3]!.id, "undo");
    await setRetention(organization.id, 10);
    await recordDecision(grant, rows[3]!.id, "rejected");
    expect(await aiRowCount()).toBe(count);
    expect(await deletedCount()).toBe(0);
  });
});

describe("avvist fordi nytt forslag erstatter (S1–S7)", () => {
  async function olderSuggestion(organizationId: string, employeeId: string, targetId: string) {
    return createAiUsageLog(organizationId, {
      employeeId,
      createdAt: CREATED,
      targetRef: { type: "answer", id: targetId, fieldKey: "text" },
    });
  }

  it("S1 erstattet forslag får innstillingen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 2);
    const targetId = uuidv7();
    const old = await olderSuggestion(organization.id, grant.employeeId, targetId);
    const request = validRequest({ target: validTarget(targetId) });
    await requestSuggestion(grant, request);
    expect((await aiRow(old.id))!.status).toBe("rejected");
    expect(await retainUntil(old.id)).toBe(plus(CREATED, 2));
    expect(await retainUntil(request.requestId)).toBe(plus(NOW, 10));
  });

  it("S2 hver erstattet rad får sin egen dato", async () => {
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 2);
    const targetId = uuidv7();
    const target = { type: "answer", id: targetId, fieldKey: "text" };
    const first = new Date("2026-11-01T09:00:00Z");
    const second = new Date("2026-11-05T09:00:00Z");
    const r1 = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      createdAt: first,
      targetRef: target,
    });
    const r2 = await createAiUsageLog(organization.id, {
      employeeId: grant.employeeId,
      createdAt: second,
      targetRef: target,
    });
    await requestSuggestion(grant, validRequest({ target: validTarget(targetId) }));
    expect(await retainUntil(r1.id)).toBe(plus(first, 2));
    expect(await retainUntil(r2.id)).toBe(plus(second, 2));
    expect(plus(first, 2)).not.toBe(plus(second, 2));
  });

  it("S4 uten innstilling: erstattet rad får 10 år", async () => {
    const { organization, grant } = await aiOrganization();
    const targetId = uuidv7();
    const old = await olderSuggestion(organization.id, grant.employeeId, targetId);
    await requestSuggestion(grant, validRequest({ target: validTarget(targetId) }));
    expect((await aiRow(old.id))!.status).toBe("rejected");
    expect(await retainUntil(old.id)).toBe(plus(CREATED, 10));
  });

  it("S5 nytt forslag som ikke er brukbart avviser ingenting", async () => {
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 2);
    const targetId = uuidv7();
    const old = await olderSuggestion(organization.id, grant.employeeId, targetId);
    const before = await retainUntil(old.id);
    await requestSuggestion(
      grant,
      validRequest({ target: validTarget(targetId), fields: { text: fakeErrorInputs()[0]! } }),
    );
    await insertBlockedRow(grant, {
      requestId: uuidv7(),
      feature: "language_polish",
      provider: "fake",
      model: "fake-v1",
      promptVersion: "language_polish.v1",
      assignmentId: null,
      target: validTarget(targetId),
      sourceFields: ["text"],
    });
    expect((await aiRow(old.id))!.status).toBe("suggested");
    expect(await retainUntil(old.id)).toBe(before);
  });

  it("S6 rader på andre mål og i andre organisasjoner røres ikke", async () => {
    const a = await aiOrganization("Oppdiktet Takst A");
    const b = await aiOrganization("Oppdiktet Takst B");
    await setRetention(a.organization.id, 2);
    await setRetention(b.organization.id, 1);
    const targetId = uuidv7();
    const oldA = await olderSuggestion(a.organization.id, a.grant.employeeId, targetId);
    const otherTargetA = await olderSuggestion(a.organization.id, a.grant.employeeId, uuidv7());
    const oldB = await olderSuggestion(b.organization.id, b.grant.employeeId, targetId);
    const beforeB = JSON.stringify(await aiRow(oldB.id));
    const beforeOther = JSON.stringify(await aiRow(otherTargetA.id));

    await requestSuggestion(a.grant, validRequest({ target: validTarget(targetId) }));

    expect(JSON.stringify(await aiRow(oldB.id))).toBe(beforeB);
    expect(JSON.stringify(await aiRow(otherTargetA.id))).toBe(beforeOther);
    expect((await aiRow(oldA.id))!.status).toBe("rejected");
    expect(await retainUntil(oldA.id)).toBe(plus(CREATED, 2));
  });

  it("S7 ingen rad slettes", async () => {
    const { organization, grant } = await aiOrganization();
    await setRetention(organization.id, 2);
    const targetId = uuidv7();
    await olderSuggestion(organization.id, grant.employeeId, targetId);
    await olderSuggestion(organization.id, grant.employeeId, targetId);
    const count = await aiRowCount();
    await requestSuggestion(grant, validRequest({ target: validTarget(targetId) }));
    expect(await aiRowCount()).toBe(count + 1);
    expect(await deletedCount()).toBe(0);
  });
});
