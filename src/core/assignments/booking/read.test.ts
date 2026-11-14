import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import {
  createAssignment,
  createContact,
  createEmployee,
  createFirm,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../tests/factories";
import { expectTenantIsolation } from "../../../../tests/tenant-isolation";
import { getAssignmentBooking } from "./read";

/*
 * Kortet «Bestilling» på oppdragssiden (docs/funksjoner/fase2a-nytt-oppdrag.md, Omfang 10).
 * Oppdiktede adresser og navn.
 * Støtter hovedmål: de ansatte (riktig bestilling står på oppdraget) og færre reklamasjoner
 * (rettelser skjer på oppdraget, og bare i egen organisasjon).
 */

beforeEach(resetDatabase);

async function adminIn(name = "Organisasjon A") {
  const organization = await createOrganization(name);
  const user = await createUser({ name: `Admin ${name}` });
  await createEmployee(user, organization.id, ["admin"]);
  return { organization, user };
}

describe("getAssignmentBooking", () => {
  it("gir bestillingen med navn på bestiller og firma, og versjonen", async () => {
    const { organization, user } = await adminIn();
    const firm = await createFirm(organization.id, { name: "Oppdiktet Megling AS" });
    const contact = await createContact(organization.id, {
      firstName: "Line",
      lastName: "Testesen",
      firmId: firm.id,
    });
    const assignment = await createAssignment(organization.id, {
      addressText: "Prøvegata 3, 8006 Bodø",
      gnr: "9001",
      bnr: "1",
      orderedByText: "Line Testesen, Oppdiktet Megling AS",
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
      externalRef: "55-0001",
    });

    const view = await getAssignmentBooking(user, organization.id, assignment.id);

    expect(view.id).toBe(assignment.id);
    expect(view.rowVersion).toBe(assignment.rowVersion);
    expect(view.booking).toMatchObject({
      addressText: "Prøvegata 3, 8006 Bodø",
      gnr: "9001",
      bnr: "1",
      snr: null,
      externalRef: "55-0001",
      orderedByContactId: contact.id,
      orderedByFirmName: "Oppdiktet Megling AS",
      source: "manual",
    });
    expect(view.booking.orderedByContactName).toContain("Testesen");
  });

  it("slettet (kansellert), ukjent og ugyldig id gir AccessDeniedError", async () => {
    const { organization, user } = await adminIn();
    const cancelled = await createAssignment(organization.id, { deletedAt: new Date() });
    for (const id of [cancelled.id, crypto.randomUUID(), "ikke-en-id"]) {
      await expect(getAssignmentBooking(user, organization.id, id)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
    }
  });

  it("fremmed oppdrag med egen organisasjon gir samme feil", async () => {
    const { organization, user } = await adminIn();
    const other = await createOrganization("Organisasjon B");
    const foreign = await createAssignment(other.id);
    await expect(getAssignmentBooking(user, organization.id, foreign.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it("tenant-isolasjon: bare oppdrag i egen organisasjon, også når fremmede id-er prøves", async () => {
    const allIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createAssignment(grantA.organizationId);
        const b = await createAssignment(grantB.organizationId);
        allIds.push(a.id, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const views = [];
        for (const id of allIds) {
          try {
            views.push(await getAssignmentBooking(actor, organizationId, id));
          } catch (error) {
            // Fremmed id gir samme feil som ukjent. Mangler tilgang til organisasjonen, kastes
            // feilen videre (punkt 3 og 4 i `expectTenantIsolation`).
            if (!(error instanceof AccessDeniedError)) throw error;
            await requireOrganizationAccess(actor, organizationId);
          }
        }
        return views;
      },
      idOf: (view) => view.id,
    });
  });
});
