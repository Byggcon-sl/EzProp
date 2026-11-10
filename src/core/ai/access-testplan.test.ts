import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import {
  aiRow,
  aiRowCount,
  auditCount,
  captureError,
  employeeWithGrant,
  enableAi,
  mergeOrganizationSettings,
  recordDecision,
  requestSuggestion,
  snapshot,
  validRequest,
  type EmployeeVariant,
} from "../../../tests/ai";
import {
  checkAiTextApproved,
  getSuggestionStatus,
  outcomeOf,
  trialTarget,
} from "../../../tests/ai-pattern";
import {
  createAiUsageLog,
  createOrganization,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Tilgang per rolle for forslagsmønsteret (docs/funksjoner/fase2a-forslagsmonster-testplan.md
 * avsnitt 6). Fasiten er skrevet inn her. Gjelder `requestSuggestion` (med prøvemålet
 * `ai_trial`), `recordDecision`, `getSuggestionStatus` og `checkAiTextApproved`. Mot
 * testdatabasen. Serverhandlingene har samme tabell i `src/app/(ansatt)/prove/ki`.
 *
 * Forventet avslag per tjeneste:
 * - `requestSuggestion`, `recordDecision` og `checkAiTextApproved`: `AccessDeniedError`.
 * - `getSuggestionStatus`: samme nøytrale svar som ukjent id (avklaring A, kortet Omfang 3).
 * - Ansatt i annen organisasjon: nøytralt avslag (ikke `AccessDeniedError`) eller «stoppet».
 * - Deaktivert eller mykt slettet ansatt får ingen grant (`requireOrganizationAccess` nekter).
 *
 * Støtter hovedmål: de ansatte (riktige personer får bruke KI-forslag) og regel 11 (admin
 * stenges aldri ute).
 */

type Variant = {
  name: string;
  roles: EmployeeVariant[];
  inspectorsEditAll: boolean;
  grantReportEdit?: boolean;
  allowed: boolean;
};

const VARIANTS: Variant[] = [
  {
    name: "takstmann, innstillingen på",
    roles: ["inspector"],
    inspectorsEditAll: true,
    allowed: true,
  },
  {
    name: "takstmann, innstillingen av",
    roles: ["inspector"],
    inspectorsEditAll: false,
    allowed: false,
  },
  { name: "kontor uten report.edit", roles: ["office"], inspectorsEditAll: true, allowed: false },
  {
    name: "kontor med report.edit gitt",
    roles: ["office"],
    inspectorsEditAll: true,
    grantReportEdit: true,
    allowed: true,
  },
  { name: "leder", roles: ["manager"], inspectorsEditAll: true, allowed: true },
  { name: "admin med bare rollen admin", roles: ["admin"], inspectorsEditAll: true, allowed: true },
  { name: "admin, innstillingen av", roles: ["admin"], inspectorsEditAll: false, allowed: true },
];

const DECIDED_AT = new Date("2026-11-09T10:00:00Z");

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

/** Organisasjon med KI på, innstillingen satt, en forslagsrad og den ansatte i varianten. */
async function setup(variant: Omit<Variant, "name" | "allowed">) {
  const organization = await createOrganization("Oppdiktet Takst A");
  await enableAi(organization.id);
  if (!variant.inspectorsEditAll) {
    await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
  }
  const requester = await employeeWithGrant(organization.id, ["manager"], "Test Leder Forslag");
  const person = await employeeWithGrant(organization.id, variant.roles, "Test Ansatt");
  let grant: EmployeeGrant = person.grant;
  if (variant.grantReportEdit) {
    await grantPermission(person.employee, "report.edit");
    grant = await requireOrganizationAccess(person.actor, organization.id);
  }
  const target = trialTarget();
  const suggested = await createAiUsageLog(organization.id, {
    employeeId: requester.grant.employeeId,
    targetRef: target,
  });
  const accepted = await createAiUsageLog(organization.id, {
    employeeId: requester.grant.employeeId,
    targetRef: trialTarget(),
    status: "accepted",
    decidedBy: requester.grant.employeeId,
    decidedAt: DECIDED_AT,
  });
  return { organization, requester, person, grant, suggested, accepted, target };
}

describe("tilgang per rolle: requestSuggestion med ai_trial (6.1)", () => {
  it.each(VARIANTS)("$name: be om = $allowed", async (variant) => {
    const { grant } = await setup(variant);
    const rowsBefore = await aiRowCount();
    const request = validRequest({ target: trialTarget() });

    if (variant.allowed) {
      const result = await requestSuggestion(grant, request);
      expect(result.kind).toBe("suggestion");
      expect(await aiRowCount()).toBe(rowsBefore + 1);
      return;
    }
    const error = await captureError(() => requestSuggestion(grant, request));
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect(await aiRowCount()).toBe(rowsBefore);
  });
});

describe("tilgang per rolle: recordDecision (6.1)", () => {
  it.each(VARIANTS)("$name: avgjøre og angre = $allowed", async (variant) => {
    const { grant, suggested, accepted } = await setup(variant);
    const beforeS = snapshot(await aiRow(suggested.id));
    const beforeA = snapshot(await aiRow(accepted.id));
    const auditBefore = await auditCount();

    if (variant.allowed) {
      await recordDecision(grant, suggested.id, "accepted");
      expect((await aiRow(suggested.id))!.status).toBe("accepted");
      await recordDecision(grant, accepted.id, "undo");
      expect((await aiRow(accepted.id))!.status).toBe("suggested");
      return;
    }
    for (const [id, decision] of [
      [suggested.id, "accepted"],
      [suggested.id, "rejected"],
      [accepted.id, "undo"],
    ] as const) {
      const error = await captureError(() => recordDecision(grant, id, decision));
      expect(error, decision).toBeInstanceOf(AccessDeniedError);
    }
    expect(snapshot(await aiRow(suggested.id))).toBe(beforeS);
    expect(snapshot(await aiRow(accepted.id))).toBe(beforeA);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("tilgang per rolle: getSuggestionStatus (6.1)", () => {
  it.each(VARIANTS)("$name: se status = $allowed", async (variant) => {
    const { grant, accepted } = await setup(variant);
    const answer = await outcomeOf(() => getSuggestionStatus(grant, accepted.id));

    if (variant.allowed) {
      expect(answer).toEqual({ kind: "value", value: { status: "accepted", outcome: "ok" } });
      return;
    }
    // Avklaring A: samme svar som ukjent id, ikke AccessDeniedError
    const baseline = await outcomeOf(() => getSuggestionStatus(grant, randomUUID()));
    expect(answer).toEqual(baseline);
    expect(answer.kind === "error" && answer.accessDenied).toBe(false);
  });
});

describe("tilgang per rolle: checkAiTextApproved (6.1)", () => {
  it.each(VARIANTS)("$name: kjøre sperren = $allowed", async (variant) => {
    const { grant, accepted, suggested, target } = await setup(variant);
    const acceptedTarget = (await aiRow(accepted.id))!.target_ref as {
      type: string;
      id: string;
      fieldKey: string;
    };
    const items = [
      { aiUsageId: accepted.id, target: acceptedTarget },
      { aiUsageId: suggested.id, target },
    ];

    if (variant.allowed) {
      expect(await checkAiTextApproved(grant, items)).toEqual([items[1]]);
      return;
    }
    const error = await captureError(() => checkAiTextApproved(grant, items));
    expect(error).toBeInstanceOf(AccessDeniedError);
  });
});

describe("tilgang: deaktivert eller mykt slettet ansatt (6.1)", () => {
  it.each([
    { name: "mykt slettet", column: "deleted_at" },
    { name: "deaktivert", column: "deactivated_at" },
  ])("$name: får ingen grant med report.edit, og raden er uendret", async ({ column }) => {
    const { organization, person, suggested } = await setup({
      roles: ["inspector"],
      inspectorsEditAll: true,
    });
    const before = snapshot(await aiRow(suggested.id));
    await db.execute(
      sql`update employees set ${sql.identifier(column)} = now() where id = ${person.employee.id}`,
    );

    for (const permission of ["report.edit", "organization.read"] as const) {
      const error = await captureError(() =>
        requireOrganizationAccess(person.actor, organization.id, permission),
      );
      expect(error).toBeInstanceOf(AccessDeniedError);
    }
    expect(snapshot(await aiRow(suggested.id))).toBe(before);
  });
});

describe("tilgang: ansatt i annen organisasjon får nøytralt avslag (6.1)", () => {
  it.each<EmployeeVariant>(["inspector", "admin"])("%s i B mot A sine rader", async (role) => {
    const { suggested, accepted } = await setup({ roles: ["inspector"], inspectorsEditAll: true });
    const orgB = await createOrganization("Oppdiktet Takst B");
    await enableAi(orgB.id);
    const outsider = await employeeWithGrant(orgB.id, [role], "Test Ansatt B");
    const beforeS = snapshot(await aiRow(suggested.id));
    const beforeA = snapshot(await aiRow(accepted.id));
    const auditBefore = await auditCount();

    // recordDecision: nøytralt avslag, ikke AccessDeniedError
    const decisionError = await captureError(() =>
      recordDecision(outsider.grant, suggested.id, "accepted"),
    );
    expect(decisionError).not.toBeInstanceOf(AccessDeniedError);
    expect(decisionError.name).toBe("AiRequestRejectedError");

    // getSuggestionStatus: samme svar som ukjent id
    const baseline = await outcomeOf(() => getSuggestionStatus(outsider.grant, randomUUID()));
    expect(await outcomeOf(() => getSuggestionStatus(outsider.grant, accepted.id))).toEqual(
      baseline,
    );

    // checkAiTextApproved: A sin godkjente rad er «stoppet» for B
    const acceptedTarget = (await aiRow(accepted.id))!.target_ref;
    const item = { aiUsageId: accepted.id, target: acceptedTarget };
    expect(await checkAiTextApproved(outsider.grant, [item])).toEqual([item]);

    // requestSuggestion med A sin id som requestId: nøytralt avslag, ingen ny rad
    const rows = await aiRowCount();
    const requestError = await captureError(() =>
      requestSuggestion(
        outsider.grant,
        validRequest({ requestId: suggested.id, target: trialTarget() }),
      ),
    );
    expect(requestError).not.toBeInstanceOf(AccessDeniedError);
    expect(await aiRowCount()).toBe(rows);

    expect(snapshot(await aiRow(suggested.id))).toBe(beforeS);
    expect(snapshot(await aiRow(accepted.id))).toBe(beforeA);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("admin stenges aldri ute (6.2)", () => {
  it("admin uten noen tildelte enkeltrettigheter, innstillingen av: be om, avgjøre, angre, se status og kjøre sperren", async () => {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    await mergeOrganizationSettings(organization.id, { "access.inspectors_edit_all": false });
    const admin = await employeeWithGrant(organization.id, ["admin"], "Test Admin");
    const permissions = (await db.execute(
      sql`select permission from employee_permissions where employee_id = ${admin.employee.id}`,
    )) as unknown as unknown[];
    expect(permissions).toHaveLength(0);

    const target = trialTarget();
    const result = await requestSuggestion(admin.grant, validRequest({ target }));
    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;

    expect(await getSuggestionStatus(admin.grant, result.usageId)).toEqual({
      status: "suggested",
      outcome: "ok",
    });
    await recordDecision(admin.grant, result.usageId, "rejected");
    await recordDecision(admin.grant, result.usageId, "undo");
    await recordDecision(admin.grant, result.usageId, "accepted");
    expect(await getSuggestionStatus(admin.grant, result.usageId)).toEqual({
      status: "accepted",
      outcome: "ok",
    });
    expect(await checkAiTextApproved(admin.grant, [{ aiUsageId: result.usageId, target }])).toEqual(
      [],
    );
  });
});
