import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { auditLog, events } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  TEST_NOW,
  createEmployee,
  createOrder as insertOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { getOrder, updateOrder, type OrderInput } from "./index";

/*
 * Ingen verdier på avveie (docs/funksjoner/fase2a-rette-ordre-testplan.md 3.1, 3.2 og 3.4).
 * Hvert verdifelt får en unik markør. Markøren skal aldri stå i applikasjonsloggen, i
 * feilmeldingen eller i hendelsene, men skal stå i `audit_log.changes.values` (3.4, viser at
 * testen ikke er hul). Databasefeilen (3.2) står i orders-transaction.test.ts, der revisjonsloggen
 * er pakket inn. Testdata er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner og personvern (adresser og navn havner ikke i loggene).
 */

const MARK = "91c2";
const MARKED: Record<string, unknown> = {
  addressText: `MARKOR-ADR-${MARK} 1`,
  orderedByText: `MARKOR-NAVN-${MARK}`,
  externalRef: `MARKOR-REF-${MARK}`,
  housingAssociationName: `MARKOR-BRL-${MARK}`,
  gnr: "9173",
  bnr: "9174",
  snr: "9175",
};
const MARKERS = [MARK, "9173", "9174", "9175"];

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function spyOnLogger() {
  return [
    vi.spyOn(logger, "debug"),
    vi.spyOn(logger, "info"),
    vi.spyOn(logger, "warn"),
    vi.spyOn(logger, "error"),
    vi.spyOn(console, "log"),
    vi.spyOn(console, "info"),
    vi.spyOn(console, "warn"),
    vi.spyOn(console, "error"),
  ];
}

function text(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function expectNoMarker(haystack: string) {
  for (const marker of MARKERS) expect(haystack).not.toContain(marker);
}

async function setup() {
  const org = await createOrganization("Oppdiktet Takst A");
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const inserted = await insertOrder(org.id);
  const opened = await getOrder(admin, org.id, inserted.id);
  return { org, admin, inserted, opened };
}

async function allEvents() {
  return db.select().from(events);
}

describe("3.1 vellykket lagring", () => {
  it("ingen markør i logger eller hendelser; markøren står i audit_log.values (3.4)", async () => {
    const { org, admin, inserted, opened } = await setup();
    const spies = spyOnLogger();

    await updateOrder(admin, org.id, inserted.id, MARKED as OrderInput, opened.rowVersion);

    expectNoMarker(text(spies.map((spy) => spy.mock.calls)));
    expectNoMarker(text((await allEvents()).map((row) => row.data)));

    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, inserted.id), eq(auditLog.action, "update")));
    const values = text((row?.changes as { values: unknown }).values);
    for (const marker of MARKERS) expect(values).toContain(marker);
  });
});

describe("3.2 feilgrenene", () => {
  it.each([
    [
      "Zod-feil (markør i ugyldig verdi)",
      async (s: Awaited<ReturnType<typeof setup>>) =>
        updateOrder(
          s.admin,
          s.org.id,
          s.inserted.id,
          {
            ...MARKED,
            gnr: `MARKOR-GNR-${MARK}`,
            orderedByText: `${MARK} 01019912345`,
          } as OrderInput,
          s.opened.rowVersion,
        ),
    ],
    [
      "OrderChangedError",
      async (s: Awaited<ReturnType<typeof setup>>) =>
        updateOrder(
          s.admin,
          s.org.id,
          s.inserted.id,
          MARKED as OrderInput,
          s.opened.rowVersion + 5,
        ),
    ],
    [
      "ContactNotFoundError",
      async (s: Awaited<ReturnType<typeof setup>>) =>
        updateOrder(
          s.admin,
          s.org.id,
          s.inserted.id,
          { ...MARKED, orderedByContactId: randomUUID() } as OrderInput,
          s.opened.rowVersion,
        ),
    ],
  ])("%s: ingen markør i logger, feilmelding eller hendelser", async (_name, call) => {
    const state = await setup();
    const spies = spyOnLogger();

    let caught: unknown = null;
    try {
      await call(state);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expectNoMarker((caught as Error).message);
    expectNoMarker(text(spies.map((spy) => spy.mock.calls)));
    expectNoMarker(text((await allEvents()).map((row) => row.data)));
  });
});
