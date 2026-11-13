import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { createOrder as insertOrder, resetDatabase, TEST_NOW } from "../../../tests/factories";
import {
  editInput,
  NEW_ADDRESS,
  orderAuditRows,
  orderRow,
  orgWithAdmin,
  setInspectorsEditAll,
  updateAuditRows,
} from "../../../tests/order-edit";
import { ACCESS_VARIANTS } from "../../../tests/order-edit-variants";
import { listOrderHistory, updateOrder } from "./index";

/*
 * Tilgang per rolle for «Endre ordren» og «Endringer» (docs/funksjoner/fase2a-rette-ordre-testplan.md
 * avsnitt 6 og 8.4). Matrisen står i tests/order-edit-variants.ts og prøves her mot tjenesten;
 * `canEditOrders` prøves mot samme matrise i src/app/(ansatt)/ordre/can-edit-orders.test.ts.
 * Nekt gir AccessDeniedError, ingen endring, ingen loggrad, row_version lik.
 *
 * Testdata er oppdiktet. Støtter hovedmål: de ansatte (alle som har lov, kan endre) og færre
 * reklamasjoner (ingen uten tilgang slipper til, admin stenges aldri ute).
 */

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("6. rettighetsmatrisen", () => {
  it.each(ACCESS_VARIANTS)("6 $name: listOrderHistory = $read", async ({ setup, read }) => {
    const { org } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const actor = await setup(org.id);

    const run = listOrderHistory(actor, org.id, order.id);
    if (read) await expect(run).resolves.toBeInstanceOf(Array);
    else await expect(run).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it.each(ACCESS_VARIANTS)("6 $name: updateOrder = $edit", async ({ setup, edit }) => {
    const { org } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const actor = await setup(org.id);
    const before = await orderRow(order.id);

    const run = updateOrder(
      actor,
      org.id,
      order.id,
      editInput(before, { addressText: NEW_ADDRESS }) as Parameters<typeof updateOrder>[3],
      before.rowVersion,
    );
    if (edit) {
      await expect(run).resolves.toMatchObject({ addressText: NEW_ADDRESS });
      expect(await updateAuditRows(order.id)).toHaveLength(1);
    } else {
      await expect(run).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await orderRow(order.id)).toEqual(before);
      expect(await orderAuditRows(order.id)).toEqual([]);
    }
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("6.1 admin uten andre roller, innstillingen av, uten enkeltrettigheter: kan endre og lese historikk", async () => {
    const { org, admin } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const order = await insertOrder(org.id);
    const before = await orderRow(order.id);

    await updateOrder(
      admin,
      org.id,
      order.id,
      editInput(before, { addressText: NEW_ADDRESS }) as Parameters<typeof updateOrder>[3],
      before.rowVersion,
    );
    expect((await orderRow(order.id)).addressText).toBe(NEW_ADDRESS);
    const lines = await listOrderHistory(admin, org.id, order.id);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 6.4 og 8.4 statisk: tilgangen går via src/core/access, ingenting slettes
// ---------------------------------------------------------------------------------------------

const repoRoot = join(__dirname, "..", "..", "..");
const ordersDir = join(repoRoot, "src", "core", "orders");
const orderPageDir = join(repoRoot, "src", "app", "(ansatt)", "ordre", "[id]");

function productFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .filter((entry) => !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Teksten i funksjonen fra «export async function <navn>» til neste «export». */
function functionBody(name: string): string {
  for (const file of productFiles(ordersDir)) {
    const text = readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${name}(`);
    if (start === -1) continue;
    const rest = text.slice(start + 1);
    const end = rest.search(/\nexport /);
    return end === -1 ? rest : rest.slice(0, end);
  }
  throw new Error(`fant ikke export async function ${name} i src/core/orders`);
}

describe("6.4 og 8.4 statisk", () => {
  it("6.4 updateOrder kaller requireOrganizationAccess med assignment.edit", () => {
    const body = functionBody("updateOrder");
    expect(body).toMatch(/requireOrganizationAccess\([^)]*"assignment\.edit"/);
    expect(body).toMatch(/grant\.organizationId/);
  });

  it("6.4 listOrderHistory kaller requireOrganizationAccess med organization.read", () => {
    const body = functionBody("listOrderHistory");
    expect(body).toMatch(/requireOrganizationAccess\([^)]*"organization\.read"/);
    expect(body).toMatch(/grant\.organizationId/);
  });

  it("6.4 ingen rollesjekk i src/app/(ansatt)/ordre/[id]", () => {
    const files = productFiles(orderPageDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\broles\b/);
      expect(text, file).not.toMatch(/["'](admin|manager|office|inspector)["']/);
      expect(text, file).not.toMatch(/requireOrganizationAccess|grantHasPermission/);
    }
  });

  it("8.4 ingen .delete( på orders eller auditLog i src/core/orders", () => {
    for (const file of productFiles(ordersDir)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\.delete\s*\(\s*(orders|auditLog)\b/);
      expect(text, file).not.toMatch(/delete\s+from\s+["']?(orders|audit_log)/i);
    }
  });
});
