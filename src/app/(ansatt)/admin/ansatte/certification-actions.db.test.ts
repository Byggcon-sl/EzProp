import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, certifications } from "@/db/schema";
import {
  createCertification as giveCertification,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../../tests/factories";
import { initialFormState, NO_ACCESS } from "../form-state";

/*
 * Server-handlingene for sertifiseringer mot ekte kjerne og testdatabase. Bare innloggingen er
 * byttet ut; organisasjonen hentes av den ekte `getAdminContext` (findAdminOrganizationId).
 * Testplan: docs/funksjoner/fase0b-sertifisering-testplan.md avsnitt 5.
 * Støtter hovedmål: reklamasjoner (ingen kan lagre en sertifisering i en annen organisasjon).
 * Testdata er oppdiktet.
 */

const mocks = vi.hoisted(() => ({
  actor: null as Actor | null,
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/core/auth/session", () => ({
  requireActor: async () => {
    if (!mocks.actor) throw new Error("ikke innlogget");
    return mocks.actor;
  },
}));

const { createCertificationAction, deleteCertificationAction } =
  await import("./certification-actions");

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function twoOrgs() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const adminA = await createUser({ name: "Admin A Testesen" });
  await createEmployee(adminA, orgA.id, ["admin"]);
  const kariA = await createEmployee(await createUser({ name: "Kari Testdatter" }), orgA.id, [
    "inspector",
  ]);
  const kariB = await createEmployee(await createUser({ name: "Kari B Testdatter" }), orgB.id, [
    "inspector",
  ]);
  return { orgA, orgB, adminA, kariA, kariB };
}

async function snapshot() {
  return {
    certs: await db.select().from(certifications).orderBy(certifications.id),
    audit: await db.select().from(auditLog),
  };
}

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  mocks.actor = null;
});

describe("5.1 organisasjonen kommer fra serveren", () => {
  it("organizationId fra B i skjemadata ignoreres: raden lagres i A", async () => {
    const { orgA, orgB, adminA, kariA } = await twoOrgs();
    mocks.actor = adminA;
    await expect(
      createCertificationAction(
        kariA.id,
        initialFormState,
        form({ validTo: "2027-10-31", organizationId: orgB.id }),
      ),
    ).rejects.toThrow(`REDIRECT /admin/ansatte/${kariA.id}?lagret=sertifisering`);
    const rows = await db.select().from(certifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: orgA.id, employeeId: kariA.id });
  });

  it("ansatt fra B (i adressen) gir feilsvar, ingen rad og ingen loggrad", async () => {
    const { adminA, kariB } = await twoOrgs();
    mocks.actor = adminA;
    const before = await snapshot();
    const state = await createCertificationAction(
      kariB.id,
      initialFormState,
      form({ validTo: "2027-10-31" }),
    );
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it("employeeId fra B i skjemadata ignoreres: raden lagres på den ansatte i adressen", async () => {
    const { orgA, adminA, kariA, kariB } = await twoOrgs();
    mocks.actor = adminA;
    await expect(
      createCertificationAction(
        kariA.id,
        initialFormState,
        form({ validTo: "2027-10-31", employeeId: kariB.id }),
      ),
    ).rejects.toThrow("REDIRECT");
    const rows = await db.select().from(certifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: orgA.id, employeeId: kariA.id });
  });

  it("fjern med sertifisering fra B gir feilsvar, B-raden er urørt", async () => {
    const { adminA, kariA, kariB } = await twoOrgs();
    const certB = await giveCertification(kariB, { validTo: "2027-10-31" });
    mocks.actor = adminA;
    const before = await snapshot();
    const state = await deleteCertificationAction(kariA.id, certB.id, initialFormState);
    expect(state.message).toBe(NO_ACCESS);
    expect(await snapshot()).toEqual(before);
    const [row] = await db.select().from(certifications).where(eq(certifications.id, certB.id));
    expect(row?.deletedAt).toBeNull();
  });
});

describe("5.2 takstmann, kontor og leder får feilsvar", () => {
  it.each(["inspector", "office", "manager"] as const)(
    "%s: legg til og fjern gir «ingen tilgang», ingenting endres",
    async (role) => {
      const { orgA, kariA } = await twoOrgs();
      const cert = await giveCertification(kariA, { validTo: "2027-10-31" });
      const user = await createUser({ name: "Ola Testesen" });
      const employee = await createEmployee(user, orgA.id, [role]);
      await giveCertification(employee, { validTo: "2027-10-31" });
      mocks.actor = user;
      const before = await snapshot();

      const created = await createCertificationAction(
        kariA.id,
        initialFormState,
        form({ validTo: "2027-10-31" }),
      );
      expect(created.message).toBe(NO_ACCESS);
      const own = await createCertificationAction(
        employee.id,
        initialFormState,
        form({ validTo: "2027-10-31" }),
      );
      expect(own.message).toBe(NO_ACCESS);
      const removed = await deleteCertificationAction(kariA.id, cert.id, initialFormState);
      expect(removed.message).toBe(NO_ACCESS);

      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    },
  );
});
