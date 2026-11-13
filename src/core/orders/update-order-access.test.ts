import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employees, orders, type EmployeeRole } from "@/db/schema";
import { mergeOrganizationSettings } from "../../../tests/ai";
import {
  TEST_NOW,
  createEmployee,
  createOrder as insertOrder,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { listOrderHistory, updateOrder } from "./index";

/*
 * Tilgang per rolle for å endre en ordre og lese endringene
 * (docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 6 og 8). Endre krever `assignment.edit`
 * (A249), lese krever `organization.read`. All sjekk går gjennom `requireOrganizationAccess`.
 * Nekt gir `AccessDeniedError`, ingen endring, ingen loggrad og samme `row_version`.
 * 6.3 (`canEditOrders` på siden) hører til siden og prøves der. Testdata er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (alle som kan legge inn ordre, kan endre den) og regel 11 (admin
 * stenges aldri ute).
 */

const NEW_ADDRESS = "Testveien 14, 8000 Bodø";

type Variant = {
  name: string;
  roles: EmployeeRole[];
  inspectorsEditAll: boolean;
  removed?: "no_employee" | "deactivated_at" | "deleted_at";
  read: boolean;
  edit: boolean;
};

const VARIANTS: Variant[] = [
  {
    name: "takstmann, innstillingen på (standard)",
    roles: ["inspector"],
    inspectorsEditAll: true,
    read: true,
    edit: true,
  },
  {
    name: "takstmann, innstillingen av",
    roles: ["inspector"],
    inspectorsEditAll: false,
    read: true,
    edit: false,
  },
  { name: "kontor", roles: ["office"], inspectorsEditAll: true, read: true, edit: true },
  { name: "leder", roles: ["manager"], inspectorsEditAll: true, read: true, edit: true },
  {
    name: "admin, innstillingen av",
    roles: ["admin"],
    inspectorsEditAll: false,
    read: true,
    edit: true,
  },
  {
    name: "bruker uten ansattrad",
    roles: [],
    inspectorsEditAll: true,
    removed: "no_employee",
    read: false,
    edit: false,
  },
  {
    name: "deaktivert ansatt",
    roles: ["office"],
    inspectorsEditAll: true,
    removed: "deactivated_at",
    read: false,
    edit: false,
  },
  {
    name: "myk-slettet ansatt",
    roles: ["office"],
    inspectorsEditAll: true,
    removed: "deleted_at",
    read: false,
    edit: false,
  },
];

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup(variant: Variant) {
  const org = await createOrganization("Oppdiktet Takst A");
  if (!variant.inspectorsEditAll) {
    await mergeOrganizationSettings(org.id, { "access.inspectors_edit_all": false });
  }
  const actor: Actor = await createUser({ name: "Test Ansatt" });
  let employee: Awaited<ReturnType<typeof createEmployee>> | null = null;
  if (variant.removed !== "no_employee") {
    employee = await createEmployee(actor, org.id, variant.roles);
  }
  if (employee && variant.removed && variant.removed !== "no_employee") {
    await db
      .update(employees)
      .set(
        variant.removed === "deactivated_at"
          ? { deactivatedAt: TEST_NOW }
          : { deletedAt: TEST_NOW },
      )
      .where(eq(employees.id, employee.id));
  }
  const order = await insertOrder(org.id);
  return { org, actor, employee, order };
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw new Error("fant ikke ordren");
  return row;
}

async function tryEdit(actor: Actor, organizationId: string, orderId: string) {
  const row = await orderRow(orderId);
  return updateOrder(
    actor,
    organizationId,
    orderId,
    { addressText: NEW_ADDRESS, receivedAt: row.receivedAt },
    row.rowVersion,
  );
}

describe("6 tilgang per rolle", () => {
  it.each(VARIANTS)("$name: lese endringer = $read", async (variant) => {
    const { org, actor, order } = await setup(variant);
    const call = listOrderHistory(actor, org.id, order.id);
    if (variant.read) {
      await expect(call).resolves.toEqual([]);
    } else {
      await expect(call).rejects.toBeInstanceOf(AccessDeniedError);
    }
  });

  it.each(VARIANTS)("$name: endre = $edit", async (variant) => {
    const { org, actor, order } = await setup(variant);
    const before = await orderRow(order.id);

    if (variant.edit) {
      const result = await tryEdit(actor, org.id, order.id);
      expect(result.addressText).toBe(NEW_ADDRESS);
      expect(result.rowVersion).toBe(before.rowVersion + 1);
    } else {
      await expect(tryEdit(actor, org.id, order.id)).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await orderRow(order.id)).toEqual(before);
      expect(await db.select().from(auditLog)).toEqual([]);
    }
  });

  it("6.1 admin stenges aldri ute: bare admin, innstillingen av, ingen enkeltrettigheter", async () => {
    const { org, actor, order } = await setup({
      name: "admin",
      roles: ["admin"],
      inspectorsEditAll: false,
      read: true,
      edit: true,
    });

    const result = await tryEdit(actor, org.id, order.id);
    expect(result.addressText).toBe(NEW_ADDRESS);
    const history = await listOrderHistory(actor, org.id, order.id);
    expect(history.map((entry) => entry.action)).toEqual(["update"]);
  });

  it("6.2 enkeltrettigheten assignment.edit gir takstmann med innstillingen av lov til å endre", async () => {
    const { org, actor, employee, order } = await setup({
      name: "takstmann av",
      roles: ["inspector"],
      inspectorsEditAll: false,
      read: true,
      edit: false,
    });
    await expect(tryEdit(actor, org.id, order.id)).rejects.toBeInstanceOf(AccessDeniedError);

    if (!employee) throw new Error("mangler ansatt");
    await grantPermission(employee, "assignment.edit");

    const result = await tryEdit(actor, org.id, order.id);
    expect(result.addressText).toBe(NEW_ADDRESS);
  });
});

describe("6.4 og 8.4 statisk", () => {
  const source = (file: string) => readFileSync(join(__dirname, file), "utf8");

  function body(text: string, name: string): string {
    const start = text.indexOf(`export async function ${name}(`);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = text.indexOf("\nexport ", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  }

  it("updateOrder og listOrderHistory kaller requireOrganizationAccess", () => {
    expect(body(source("orders.ts"), "updateOrder")).toMatch(
      /requireOrganizationAccess\([^)]*"assignment\.edit"\)/,
    );
    expect(body(source("history.ts"), "listOrderHistory")).toMatch(
      /requireOrganizationAccess\([^)]*"organization\.read"\)/,
    );
  });

  it("ingen rollesjekk i tjenestene (tilgang bare via rettigheten)", () => {
    for (const file of ["orders.ts", "history.ts"]) {
      expect(source(file)).not.toMatch(/\.roles\b|hasRole\(|"admin"|"inspector"|"office"/);
    }
  });

  it("8.4 ingen .delete( på orders eller audit_log i src/core/orders", () => {
    for (const file of ["orders.ts", "history.ts"]) {
      expect(source(file)).not.toMatch(/\.delete\(\s*(orders|auditLog)\s*\)/);
    }
  });
});
