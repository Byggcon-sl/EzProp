import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { updateOrder } from "@/core/orders";
import { createOrder as insertOrder, resetDatabase, TEST_NOW } from "../../../../tests/factories";
import { editInput, NEW_ADDRESS, orderRow, orgWithAdmin } from "../../../../tests/order-edit";
import { ACCESS_VARIANTS } from "../../../../tests/order-edit-variants";

/*
 * «Endre ordren» vises bare når `canEditOrders` er sann, og den følger samme svar som
 * `updateOrder` for hver variant i rettighetsmatrisen (docs/funksjoner/fase2a-rette-ordre-testplan.md
 * 6.3). Erstatter e2e-testen «takstmann ser ikke knappen» (runde 4). Mot testdatabasen; bare
 * innloggingen er byttet ut. Selve sjekken skjer i kjernen; konteksten styrer bare visning.
 *
 * Testdata er oppdiktet. Støtter hovedmål: de ansatte (knappen vises for dem som kan bruke den).
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

const { getEmployeeContext } = await import("../employee-context");

beforeEach(async () => {
  await resetDatabase();
  session.actor = null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("6.3 canEditOrders følger updateOrder", () => {
  it.each(ACCESS_VARIANTS)(
    "$name: canEditOrders = $edit, som updateOrder",
    async ({ setup, edit }) => {
      const { org } = await orgWithAdmin();
      const order = await insertOrder(org.id);
      const actor = await setup(org.id);
      session.actor = actor;

      const context = await getEmployeeContext();
      const canEdit = context?.canEditOrders ?? false;
      expect(canEdit).toBe(edit);

      const before = await orderRow(order.id);
      const outcome = await updateOrder(
        actor,
        org.id,
        order.id,
        editInput(before, { addressText: NEW_ADDRESS }) as Parameters<typeof updateOrder>[3],
        before.rowVersion,
      ).then(
        () => true,
        (error: unknown) => {
          if (error instanceof AccessDeniedError) return false;
          throw error;
        },
      );
      expect(outcome).toBe(canEdit);
    },
  );
});
