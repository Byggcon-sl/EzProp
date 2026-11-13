import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  createContact,
  createOrder as insertOrder,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { editInput, orderRow, orgWithAdmin, updateAuditRows } from "../../../tests/order-edit";
import { getOrder, updateOrder } from "./index";

/*
 * Ingen verdier på avveie (docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 3, AK 12).
 * Én tabelltest for tjenesten: unike markører i hvert verdi-felt, spion på alle nivåene i
 * `logger`, og feilgrenene som rader. Databasefeilen (tvunget med mock) står i
 * orders-transaction.test.ts, action-laget i src/app/(ansatt)/ordre/actions.test.ts.
 * 3.4 viser at markøren faktisk lagres i revisjonsloggen, så testen ikke er hul.
 *
 * Testdata er oppdiktet. Støtter hovedmål: færre reklamasjoner (adresse og navn havner aldri i
 * applikasjonsloggen eller hendelsene) og KI i bunnen (bare feltkoder går videre).
 */

const MARKERS = {
  addressText: "MARKOR-ADR-91c2 1",
  orderedByText: "MARKOR-NAVN-91c2",
  externalRef: "MARKOR-REF-91c2",
  housingAssociationName: "MARKOR-BRL-91c2",
  gnr: "9173",
} as const;

const LEVELS = ["debug", "info", "warn", "error"] as const;

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function spyLogger() {
  return LEVELS.map((level) => vi.spyOn(logger, level));
}

function expectNoMarker(text: string, where: string) {
  for (const marker of Object.values(MARKERS)) {
    expect(text, `${where} har markøren ${marker}`).not.toContain(marker);
  }
}

type Branch = {
  name: string;
  /** Kjører lagringen med markørene og gir feilen (eller null ved suksess). */
  run: (actor: Actor, organizationId: string, orderId: string) => Promise<unknown>;
  expectError: boolean;
};

async function attempt(
  actor: Actor,
  organizationId: string,
  orderId: string,
  overrides: Record<string, unknown>,
  rowVersion?: number,
) {
  const row = await orderRow(orderId);
  const version = rowVersion ?? (await getOrder(actor, organizationId, orderId)).rowVersion;
  return updateOrder(
    actor,
    organizationId,
    orderId,
    editInput(row, { ...MARKERS, ...overrides }) as Parameters<typeof updateOrder>[3],
    version,
  ).then(
    () => null,
    (error: unknown) => error,
  );
}

const branches: Branch[] = [
  {
    name: "vellykket lagring",
    expectError: false,
    run: (actor, organizationId, orderId) => attempt(actor, organizationId, orderId, {}),
  },
  {
    name: "Zod-feil (markør i ugyldig verdi)",
    expectError: true,
    run: (actor, organizationId, orderId) =>
      attempt(actor, organizationId, orderId, { snr: `${MARKERS.gnr}x`, bnr: "MARKOR-NAVN-91c2" }),
  },
  {
    name: "OrderChangedError",
    expectError: true,
    run: (actor, organizationId, orderId) => attempt(actor, organizationId, orderId, {}, 999),
  },
  {
    name: "ContactNotFoundError",
    expectError: true,
    run: (actor, organizationId, orderId) =>
      attempt(actor, organizationId, orderId, { orderedByContactId: randomUUID() }),
  },
];

describe("3. updateOrder: ingen verdier i logger, feilmeldinger eller hendelser", () => {
  it.each(branches)("3.1/3.2 $name", async ({ run, expectError }) => {
    const spies = spyLogger();
    const { org, admin } = await orgWithAdmin();
    const order = await insertOrder(org.id);

    const error = await run(admin, org.id, order.id);
    if (expectError) expect(error).toBeInstanceOf(Error);
    else expect(error).toBeNull();

    expectNoMarker(JSON.stringify(spies.map((spy) => spy.mock.calls)), "logger");
    if (error instanceof Error) expectNoMarker(error.message, "feilmeldingen");
    expectNoMarker(JSON.stringify(await db.select().from(events)), "hendelsene");
  });

  it("3.4 markøren finnes i audit_log.changes.values (testen er ikke hul)", async () => {
    const { org, admin } = await orgWithAdmin();
    const contact = await createContact(org.id);
    const order = await insertOrder(org.id);

    expect(await attempt(admin, org.id, order.id, { orderedByContactId: contact.id })).toBeNull();

    const [audit] = await updateAuditRows(order.id);
    const values = JSON.stringify((audit?.changes as { values?: unknown }).values);
    for (const marker of Object.values(MARKERS)) expect(values).toContain(marker);
  });
});
