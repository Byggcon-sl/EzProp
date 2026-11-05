import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { auditLog, contacts, firms } from "@/db/schema";
import {
  createContact as insertContact,
  createEmployee,
  createFirm as insertFirm,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { createContact, createFirm, updateContact, updateFirm } from "./index";

/*
 * Revisjonsloggen skrives i samme transaksjon som endringen
 * (docs/funksjoner/fase2a-kontakter-firma-testplan.md 5.8.6). `recordAuditEvent` er pakket inn:
 * den kaller den ekte funksjonen, og kaster bare der testen ber om det. Kaster den, skal
 * endringen ikke finnes.
 *
 * Ingen ny spørring her, så filen trenger ikke expectTenantIsolation. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (aldri en endring i registeret uten spor).
 */

vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return { ...actual, recordAuditEvent: vi.fn(actual.recordAuditEvent) };
});

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(recordAuditEvent).mockClear();
});

function failAuditOnce() {
  vi.mocked(recordAuditEvent).mockImplementationOnce(async () => {
    throw new Error("revisjonsloggen feilet (test)");
  });
}

async function rowCount(table: typeof firms | typeof contacts | typeof auditLog) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function orgWithAdmin() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  return { org, admin };
}

describe("5.8.6 feiler revisjonsloggen, finnes ingen endring", () => {
  it("createFirm: ingen firma", async () => {
    const { org, admin } = await orgWithAdmin();
    failAuditOnce();
    await expect(
      createFirm(admin, org.id, { name: "Testmegling AS", orgNumber: "000000019" }),
    ).rejects.toThrow("revisjonsloggen feilet (test)");
    expect(await rowCount(firms)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);

    // Etterpå går det, også med samme nummer (ingen halvferdig rad sperrer)
    await createFirm(admin, org.id, { name: "Testmegling AS", orgNumber: "000000019" });
    expect(await rowCount(firms)).toBe(1);
  });

  it("updateFirm: firmaet er uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id, { name: "Testmegling AS" });
    const [before] = await db.select().from(firms).where(eq(firms.id, firm.id));
    failAuditOnce();
    await expect(
      updateFirm(admin, org.id, firm.id, { name: "Endret AS", orgNumber: null }),
    ).rejects.toThrow("revisjonsloggen feilet (test)");
    const [after] = await db.select().from(firms).where(eq(firms.id, firm.id));
    expect(after).toEqual(before);
  });

  it("createContact: ingen kontakt", async () => {
    const { org, admin } = await orgWithAdmin();
    failAuditOnce();
    await expect(createContact(admin, org.id, { firstName: "Megler" })).rejects.toThrow(
      "revisjonsloggen feilet (test)",
    );
    expect(await rowCount(contacts)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
  });

  it("updateContact: kontakten er uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const firm = await insertFirm(org.id);
    const contact = await insertContact(org.id, { firmId: firm.id, notes: null });
    const [before] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    failAuditOnce();
    await expect(
      updateContact(admin, org.id, contact.id, {
        firstName: "Endret",
        firmId: null,
        notes: "Vil ha rapport før kl. 12",
      }),
    ).rejects.toThrow("revisjonsloggen feilet (test)");
    const [after] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(after).toEqual(before);
    expect(await rowCount(auditLog)).toBe(0);
  });
});
