import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { fakeAiProvider, recordDecision, requestSuggestion } from "@/core/ai";
import { db } from "@/db/client";
import { employees, type EmployeeRole } from "@/db/schema";
import {
  createAiUsageLog,
  createOrganization,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import {
  EDIT_ALL,
  addMember,
  auditCount,
  enableAi,
  polishRequest,
  regrant,
  setOrganizationSetting,
  usageCount,
  usageRow,
} from "../../../tests/ai";

/*
 * Tilgang per rolle for begge funksjonene i KI-modulen (testplan
 * docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 8). Rettigheten er `report.edit`
 * (A156), sjekket med `grantHasPermission`. Admin stenges aldri ute. Ved nekt: ingen rad, ingen
 * endring, intet kall og ingen linje i revisjonsloggen. Alle data er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (alle som kan endre rapporten, får KI-forslag) og færre
 * reklamasjoner (den som ikke kan endre rapporten, kan heller ikke godta tekst i den).
 */

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(fakeAiProvider, "complete");
});
afterEach(() => vi.restoreAllMocks());

type Variant = [name: string, roles: EmployeeRole[], editAll: boolean, allowed: boolean];

/** Fasit fra kortet (Tilgang), skrevet ut for hånd. */
const VARIANTS: Variant[] = [
  ["takstmann, access.inspectors_edit_all på", ["inspector"], true, true],
  ["takstmann, access.inspectors_edit_all av", ["inspector"], false, false],
  ["kontor", ["office"], true, false],
  ["leder", ["manager"], true, true],
  ["admin, innstillingen av", ["admin"], false, true],
];

async function setup(roles: EmployeeRole[], editAll: boolean) {
  const organization = await createOrganization();
  await enableAi(organization.id);
  await setOrganizationSetting(organization.id, EDIT_ALL, editAll);
  const member = await addMember(organization.id, roles, "Test Ansatt");
  return { organization, member };
}

describe("tilgang: be om forslag (8, requestSuggestion)", () => {
  it.each(VARIANTS)("%s", async (_name, roles, editAll, allowed) => {
    const { member } = await setup(roles, editAll);
    const auditBefore = await auditCount();
    const call = requestSuggestion(member.grant, polishRequest());

    if (allowed) {
      expect((await call).kind).toBe("suggestion");
      expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
      expect(await usageCount()).toBe(1);
      return;
    }
    await expect(call).rejects.toThrow(AccessDeniedError);
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(0);
    expect(await auditCount()).toBe(auditBefore);
  });
});

describe("tilgang: avgjøre og angre (8, recordDecision)", () => {
  it.each(VARIANTS)("%s", async (_name, roles, editAll, allowed) => {
    const { organization, member } = await setup(roles, editAll);
    const accepted = await createAiUsageLog(organization.id);
    const toUndo = await createAiUsageLog(organization.id, {
      status: "accepted",
      decidedBy: null,
      decidedAt: new Date("2026-11-01T10:00:00Z"),
    });
    const before = [
      JSON.stringify(await usageRow(accepted.id)),
      JSON.stringify(await usageRow(toUndo.id)),
    ];
    const auditBefore = await auditCount();

    if (allowed) {
      await recordDecision(member.grant, accepted.id, "accepted");
      await recordDecision(member.grant, toUndo.id, "undo");
      expect((await usageRow(accepted.id))!.status).toBe("accepted");
      expect((await usageRow(accepted.id))!.decidedBy).toBe(member.employeeId);
      expect((await usageRow(toUndo.id))!.status).toBe("suggested");
      expect(await auditCount()).toBe(auditBefore + 2);
      return;
    }
    await expect(recordDecision(member.grant, accepted.id, "accepted")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(recordDecision(member.grant, toUndo.id, "undo")).rejects.toThrow(
      AccessDeniedError,
    );
    expect([
      JSON.stringify(await usageRow(accepted.id)),
      JSON.stringify(await usageRow(toUndo.id)),
    ]).toEqual(before);
    expect(await auditCount()).toBe(auditBefore);
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
  });
});

describe("tilgang: grensene (8.1–8.4)", () => {
  it("8.1 admin stenges aldri ute: bare admin, innstillingen av, ingen enkeltrettigheter", async () => {
    const { organization, member } = await setup(["admin"], false);
    expect(member.grant.roles).toEqual(["admin"]);

    const request = polishRequest();
    expect((await requestSuggestion(member.grant, request)).kind).toBe("suggestion");
    await recordDecision(member.grant, request.requestId, "accepted");
    await recordDecision(member.grant, request.requestId, "undo");
    await recordDecision(member.grant, request.requestId, "rejected");
    const row = (await usageRow(request.requestId))!;
    expect(row.status).toBe("rejected");
    expect(row.decidedBy).toBe(member.employeeId);
    expect(row.organizationId).toBe(organization.id);
  });

  it("8.2 kontor med enkeltrettigheten report.edit kan be om og avgjøre", async () => {
    const { organization, member } = await setup(["office"], true);
    await grantPermission(
      { id: member.employeeId, organizationId: organization.id },
      "report.edit",
    );
    const grant = await regrant(member, organization.id);
    expect(grant.roles).toEqual(["office"]);

    const request = polishRequest();
    expect((await requestSuggestion(grant, request)).kind).toBe("suggestion");
    await recordDecision(grant, request.requestId, "edited");
    expect((await usageRow(request.requestId))!.status).toBe("edited");
  });

  it("8.2 takstmann med innstillingen av, men med enkeltrettigheten report.edit, kan be om", async () => {
    const { organization, member } = await setup(["inspector"], false);
    await grantPermission(
      { id: member.employeeId, organizationId: organization.id },
      "report.edit",
    );
    const grant = await regrant(member, organization.id);

    expect((await requestSuggestion(grant, polishRequest())).kind).toBe("suggestion");
  });

  it.each([
    ["mykt slettet", { deletedAt: new Date("2026-11-04T10:00:00Z") }],
    ["deaktivert", { deactivatedAt: new Date("2026-11-04T10:00:00Z") }],
  ])(
    "8.3 ansatt som er %s etter at forslaget ble laget: tilgangen avvises, ingen endring",
    async (_name, change) => {
      const { organization, member } = await setup(["inspector"], true);
      const request = polishRequest();
      await requestSuggestion(member.grant, request);
      const before = JSON.stringify(await usageRow(request.requestId));
      await db.update(employees).set(change).where(eq(employees.id, member.employeeId));

      await expect(requireOrganizationAccess(member.actor, organization.id)).rejects.toThrow(
        AccessDeniedError,
      );
      expect(JSON.stringify(await usageRow(request.requestId))).toBe(before);
    },
  );

  it("8.3 admin finnes fortsatt og kan avgjøre forslaget til en deaktivert takstmann", async () => {
    const { organization, member } = await setup(["inspector"], true);
    const admin = await addMember(organization.id, ["admin"], "Test Admin");
    const request = polishRequest();
    await requestSuggestion(member.grant, request);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date("2026-11-04T10:00:00Z") })
      .where(eq(employees.id, member.employeeId));

    await recordDecision(admin.grant, request.requestId, "accepted");
    expect((await usageRow(request.requestId))!.decidedBy).toBe(admin.employeeId);
  });

  it("8.4 rettigheten følger funksjonen på raden: recordDecision tar ingen funksjonskode", () => {
    expect(recordDecision.length).toBe(3);
  });
});
