import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Menylenken «Statistikk» (docs/funksjoner/fase2a-tidsmaling-testplan.md 9.3). Menyen i
 * layout.tsx viser lenken ut fra `canReadStatistics` i konteksten, som regnes på serveren fra
 * `statistics.read`. Selve sjekken skjer i kjernen; e2e viser at takstmannen ikke ser lenken.
 * Mot testdatabasen; bare innloggingen er byttet ut.
 *
 * Støtter hovedmål: tid (leder finner tallene med ett trykk) og arbeidsmiljøloven kapittel 9
 * (takstmann og kontor ser ikke statistikken).
 */

const session = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/session", () => ({
  requireActor: vi.fn(async () => {
    if (!session.actor) throw new Error("ikke innlogget (test)");
    return session.actor;
  }),
  getCurrentActor: vi.fn(async () => session.actor),
  LOGIN_PATH: "/logg-inn",
}));

const { getEmployeeContext } = await import("./employee-context");

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
});

describe("9.3 menylenken «Statistikk»", () => {
  it.each([
    { role: "manager", inspectorsEditAll: false, expected: true },
    { role: "manager", inspectorsEditAll: true, expected: true },
    { role: "admin", inspectorsEditAll: false, expected: true },
    { role: "admin", inspectorsEditAll: true, expected: true },
    { role: "inspector", inspectorsEditAll: false, expected: false },
    { role: "inspector", inspectorsEditAll: true, expected: false },
    { role: "office", inspectorsEditAll: false, expected: false },
    { role: "office", inspectorsEditAll: true, expected: false },
  ] as const)(
    "$role med innstillingen $inspectorsEditAll gir lenken = $expected",
    async ({ role, inspectorsEditAll, expected }) => {
      const org = await createOrganization();
      await db
        .update(organizations)
        .set({ settings: { "access.inspectors_edit_all": inspectorsEditAll } })
        .where(eq(organizations.id, org.id));
      const actor = await createUser();
      await createEmployee(actor, org.id, [role]);
      session.actor = actor;

      const context = await getEmployeeContext();
      expect(context?.organizationId).toBe(org.id);
      expect(context?.canReadStatistics).toBe(expected);
    },
  );

  it("takstmann med enkeltrettigheten statistics.read får ikke lenken (A21)", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    const employee = await createEmployee(actor, org.id, ["inspector"]);
    await grantPermission(employee, "statistics.read");
    session.actor = actor;

    const context = await getEmployeeContext();
    expect(context?.canReadStatistics).toBe(false);
  });

  it("menyen viser lenken til /statistikk/tid bare når canReadStatistics er sann", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/(ansatt)/layout.tsx"), "utf8");
    const lines = layout.split("\n");
    const index = lines.findIndex((line) => line.includes('"/statistikk/tid"'));
    expect(index, "layout.tsx lenker til /statistikk/tid").toBeGreaterThan(-1);
    const before = lines.slice(Math.max(0, index - 6), index).join("\n");
    expect(before).toMatch(/canReadStatistics\s*&&/);
    expect(layout.split('"/statistikk/tid"').length - 1, "bare én lenke").toBe(1);
  });
});
