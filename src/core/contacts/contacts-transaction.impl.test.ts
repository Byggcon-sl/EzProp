import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { auditLog, contacts, firms } from "@/db/schema";
import {
  createContact as insertContact,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { createFirm, updateContact } from "./index";

/*
 * Revisjonsloggen skrives i samme transaksjon som endringen
 * (docs/funksjoner/fase2a-kontakter-firma-testplan.md 5.8.6). `recordAuditEvent` er pakket inn
 * og kaster bare der testen ber om det. Da skal verken firma, kontakt eller loggrad endres.
 *
 * Ingen ny spørring her, så filen trenger ikke expectTenantIsolation. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (aldri en endring uten spor).
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

async function orgWithAdmin() {
  const org = await createOrganization();
  const admin = await createUser();
  await createEmployee(admin, org.id, ["admin"]);
  return { org, admin };
}

describe("samme transaksjon", () => {
  it("createFirm: feil i loggen gir verken firma eller loggrad", async () => {
    const { org, admin } = await orgWithAdmin();
    failAuditOnce();
    await expect(
      createFirm(admin, org.id, { name: "Testmegling AS", orgNumber: "000000019" }),
    ).rejects.toThrow("revisjonsloggen feilet (test)");
    const [f] = await db.select({ n: count() }).from(firms);
    const [a] = await db.select({ n: count() }).from(auditLog);
    expect(f?.n).toBe(0);
    expect(a?.n).toBe(0);
  });

  it("updateContact: feil i loggen gir uendret kontakt", async () => {
    const { org, admin } = await orgWithAdmin();
    const contact = await insertContact(org.id, { notes: "Gammelt notat" });
    failAuditOnce();
    await expect(
      updateContact(admin, org.id, contact.id, { firstName: "Megler", notes: "Nytt notat" }),
    ).rejects.toThrow("revisjonsloggen feilet (test)");
    const [row] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(row).toEqual(contact);
  });
});
