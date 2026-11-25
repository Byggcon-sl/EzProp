import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, effectivePermissions, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees, type EmployeeRole } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAiUsageLog,
  createEmployee,
  createOrganization,
  createOverrideSummaryRow,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { overrideOrg, overrideRelease, overrideReport } from "../../../tests/override-fixtures";
import { setInspectorsEditAll } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  decideOverrideSummary,
  getOverrideSummary,
  listPublishOverrides,
  requestOverrideSummary,
  saveOverrideSummary,
} from "./index";

vi.mock("server-only", () => ({}));

/*
 * Tilgang per rolle (docs/funksjoner/fase2a-overstyringer-leder-testplan.md avsnitt 5, O5.1–O5.6).
 * Siden viser reklamasjonsdata og følger reklamasjonsrettighetene (`claims.read` og
 * `claims.manage`, A565), ikke `report.publish`. Fast klokke: 24.11.2026.
 *
 * Støtter hovedmål: de ansatte (takstmann og kontor ser ikke reklamasjonsdata, admin stenges
 * aldri ute) og færre reklamasjoner (leder får oversikten). Testdata er oppdiktet.
 */

const NOW = new Date("2026-11-24T12:00:00Z");
const MONTH = "2026-10";

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

type RoleCase = {
  name: string;
  roles: EmployeeRole[];
  editAll?: boolean;
  /** `claims.read`: se siden, tallene og lage oppsummering. */
  read: boolean;
  /** `claims.manage`: godta, endre, avvise, angre og skrive selv. */
  manage: boolean;
};

const ROLES: RoleCase[] = [
  { name: "takstmann", roles: ["inspector"], read: false, manage: false },
  {
    name: "takstmann med access.inspectors_edit_all",
    roles: ["inspector"],
    editAll: true,
    read: false,
    manage: false,
  },
  { name: "kontor", roles: ["office"], read: false, manage: false },
  { name: "takstmann med kontor", roles: ["inspector", "office"], read: false, manage: false },
  { name: "leder", roles: ["manager"], read: true, manage: true },
  { name: "admin med lederrolle", roles: ["admin", "manager"], read: true, manage: true },
  { name: "admin uten lederrolle", roles: ["admin"], read: true, manage: true },
];

async function world(testCase: Pick<RoleCase, "roles" | "editAll">) {
  const organization = await createOrganization("Oppdiktet Takst");
  if (testCase.editAll) await setInspectorsEditAll(organization.id, true);
  const org = await overrideOrg(organization.id);
  const report = await overrideReport(org);
  await overrideRelease(org, report, { releasedAt: new Date("2026-10-10T10:00:00Z") });
  const actor: Actor = await createUser({ name: "Testperson Rolle" });
  const employee = await createEmployee(actor, organization.id, testCase.roles);
  const row = await createOverrideSummaryRow(organization.id, { month: MONTH });
  const usage = await createAiUsageLog(organization.id, {
    feature: "override_summary",
    targetRef: { type: "override_summary", id: row.id, fieldKey: "text" },
    outputText: "Forslag til oppsummering.",
  });
  return { organizationId: organization.id, actor, employee, row, usage };
}

/** Kallene som krever `claims.read`. */
function readCalls(w: Awaited<ReturnType<typeof world>>) {
  return {
    listPublishOverrides: () => listPublishOverrides(w.actor, w.organizationId),
    getOverrideSummary: () => getOverrideSummary(w.actor, w.organizationId, MONTH),
    requestOverrideSummary: () =>
      requestOverrideSummary(w.actor, w.organizationId, { requestId: uuidv7(), month: "2026-09" }),
  };
}

/** Kallene som krever `claims.manage`, med en `usageId` den ansatte kjenner. */
function manageCalls(w: Awaited<ReturnType<typeof world>>) {
  const decide = (decision: "accepted" | "rejected" | "undo") => () =>
    decideOverrideSummary(w.actor, w.organizationId, {
      month: MONTH,
      usageId: w.usage.id,
      decision,
      baseRowVersion: w.row.rowVersion,
    });
  return {
    godta: decide("accepted"),
    avvis: decide("rejected"),
    angre: decide("undo"),
    endre: () =>
      saveOverrideSummary(w.actor, w.organizationId, {
        month: MONTH,
        text: "Endret tekst.",
        baseRowVersion: w.row.rowVersion,
        usageId: w.usage.id,
      }),
    skrivSelv: () =>
      saveOverrideSummary(w.actor, w.organizationId, {
        month: MONTH,
        text: "Skrevet av leder.",
        baseRowVersion: w.row.rowVersion,
      }),
  };
}

async function errorOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}

describe("tenant-isolasjon for tilgangsinngangen (claims.read)", () => {
  it("leder i en organisasjon ser bare egne overstyringer", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const org = await overrideOrg(grant.organizationId);
          const report = await overrideReport(org);
          ids[side].push(
            await overrideRelease(org, report, { releasedAt: new Date("2026-11-20T10:00:00Z") }),
          );
        }
        return ids;
      },
      query: async (actor, organizationId) =>
        (await listPublishOverrides(actor, organizationId)).groups.flatMap((g) =>
          g.reasons.flatMap((r) => r.releases),
        ),
      idOf: (line) => line.releaseId,
    });
  });
});

describe("O5.1 og O5.2 se siden, tallene og lage oppsummering (claims.read)", () => {
  it.each(ROLES.map((r) => [r.name, r] as const))("%s", async (_name, testCase) => {
    const w = await world(testCase);
    for (const [name, call] of Object.entries(readCalls(w))) {
      const error = await errorOf(call);
      if (testCase.read) {
        expect(error, name).toBeNull();
      } else {
        // Samme avvisning som ukjent organisasjon
        expect(error, name).toBeInstanceOf(AccessDeniedError);
      }
    }
  });

  it("takstmann får samme avvisning som for ukjent organisasjon", async () => {
    const w = await world({ roles: ["inspector"] });
    const own = (await errorOf(() => listPublishOverrides(w.actor, w.organizationId))) as Error;
    const unknown = (await errorOf(() => listPublishOverrides(w.actor, uuidv7()))) as Error;
    expect(own.constructor).toBe(unknown.constructor);
    expect(own.message).toBe(unknown.message);
  });
});

describe("O5.3 godta, endre, avvise, angre og skrive selv (claims.manage)", () => {
  it.each(ROLES.filter((r) => !r.manage).map((r) => [r.name, r] as const))(
    "%s som kjenner usageId, får samme avvisning som for ukjent id",
    async (_name, testCase) => {
      const w = await world(testCase);
      for (const [name, call] of Object.entries(manageCalls(w))) {
        expect(await errorOf(call), name).toBeInstanceOf(AccessDeniedError);
      }
      const unknown = (await errorOf(() =>
        decideOverrideSummary(w.actor, w.organizationId, {
          month: MONTH,
          usageId: uuidv7(),
          decision: "accepted",
          baseRowVersion: 1,
        }),
      )) as Error;
      const known = (await errorOf(manageCalls(w).godta)) as Error;
      expect(known.constructor).toBe(unknown.constructor);
      expect(known.message).toBe(unknown.message);
      // Ingenting er endret
      const view = await errorOf(() => getOverrideSummary(w.actor, w.organizationId, MONTH));
      expect(view).toBeInstanceOf(AccessDeniedError);
    },
  );

  it.each(ROLES.filter((r) => r.manage).map((r) => [r.name, r] as const))(
    "%s kan skrive teksten selv",
    async (_name, testCase) => {
      const w = await world(testCase);
      const result = await manageCalls(w).skrivSelv();
      expect(result.status).toBe("saved");
      expect(result.summary).toMatchObject({ status: "manual", canDecide: true });
    },
  );
});

describe("O5.5 admin stenges aldri ute (regel 11)", () => {
  it("rollen admin har alltid begge reklamasjonsrettighetene, uansett innstilling", () => {
    for (const inspectorsEditAll of [false, true]) {
      const granted = effectivePermissions(["admin"], [], { inspectorsEditAll });
      expect(granted).toContain("claims.read");
      expect(granted).toContain("claims.manage");
    }
  });

  it("eneste aktive admin, uten lederrolle, kan lese, lagre og se siden", async () => {
    const w = await world({ roles: ["admin"] });
    expect((await listPublishOverrides(w.actor, w.organizationId)).groups).toHaveLength(1);
    expect((await manageCalls(w).skrivSelv()).status).toBe("saved");
  });
});

describe("O5.6 deaktivert leder og slettet ansatt får ingen tilgang", () => {
  it.each([
    ["deaktivert leder", { deactivatedAt: NOW }],
    ["slettet ansatt", { deletedAt: NOW }],
  ] as const)("%s", async (_name, patch) => {
    const w = await world({ roles: ["manager"] });
    await db.update(employees).set(patch).where(eq(employees.id, w.employee.id));
    for (const call of [...Object.values(readCalls(w)), ...Object.values(manageCalls(w))]) {
      expect(await errorOf(call)).toBeInstanceOf(AccessDeniedError);
    }
  });
});
