import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/core/access";
import {
  createEmployee,
  createOffice,
  createOrganization,
  createProperty,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { convertOrderToAssignment, createOrder as createOrderService } from "@/core/orders";
import { createAssignment as createAssignmentService, listWorkQueue } from "./index";

/*
 * Arbeidskøen med oppdrag laget direkte («Nytt oppdrag», testplan 4.5.5, 4.5.6, 4.8.2 og 4.8.3).
 * Oppdragene lages med tjenestene, slik de lages i drift. Oppdiktede adresser og navn.
 *
 * Støtter hovedmål: de ansatte (oppdraget står i køen med en gang, med riktig adresse) og færre
 * reklamasjoner (aldri treff fra en annen organisasjon, aldri samme oppdrag to ganger).
 */

beforeEach(resetDatabase);

const ADDRESS = "Qxzkøveien 12, 8000 Bodø";
const ORDERED_BY = "Qxzbestiller Køsen";

async function orgWithPeople(name: string) {
  const org = await createOrganization(name);
  const office = await createOffice(org.id);
  const admin = await createUser({ name: `Admin ${name}` });
  await createEmployee(admin, org.id, ["admin"]);
  const inspector = await createEmployee(await createUser(), org.id, ["inspector"]);
  return { org, office, admin, inspector };
}

async function direct(
  actor: Actor,
  organizationId: string,
  officeId: string,
  responsibleEmployeeId: string,
) {
  return createAssignmentService(actor, organizationId, {
    addressText: ADDRESS,
    orderedByText: ORDERED_BY,
    gnr: "7711",
    bnr: "7712",
    externalRef: "QXZ-KO-5511",
    officeId,
    responsibleEmployeeId,
  });
}

async function queue(actor: Actor, organizationId: string, query: string) {
  return (await listWorkQueue(actor, organizationId, { status: "ordered", mineOnly: false, query }))
    .items;
}

describe("4.5.5 og 4.5.6 tenant-isolasjon for søket i arbeidskøen", () => {
  it.each(["qxzkøveien", "køsen", "7711/7712", "QXZ-KO"])(
    "oppdrag laget direkte med samme bestilling i A og B: søk på «%s» gir bare egne",
    async (query) => {
      await expectTenantIsolation({
        seed: async (grantA, grantB) => {
          const ids = { a: [] as string[], b: [] as string[] };
          for (const [key, grant] of [
            ["a", grantA],
            ["b", grantB],
          ] as const) {
            const office = await createOffice(grant.organizationId);
            const user = await createUser();
            const inspector = await createEmployee(user, grant.organizationId, ["inspector"]);
            const created = await direct(user, grant.organizationId, office.id, inspector.id);
            ids[key].push(created.id);
          }
          return ids;
        },
        query: (actor, organizationId) => queue(actor, organizationId, query),
        idOf: (row) => row.id,
      });
    },
  );
});

describe("4.8 kortet i køen", () => {
  it("4.8.2 adressen er oppdragets når det ikke har eiendom, og eiendommens når den finnes", async () => {
    const { org, office, admin, inspector } = await orgWithPeople("Oppdiktet Takst A");
    const withoutProperty = await direct(admin, org.id, office.id, inspector.id);
    const withProperty = await direct(admin, org.id, office.id, inspector.id);
    await createProperty(org.id, { assignmentId: withProperty.id, address: "Qxzeiendomsveien 3" });

    const items = await queue(admin, org.id, "");
    expect(items.find((item) => item.id === withoutProperty.id)?.address).toBe(ADDRESS);
    expect(items.find((item) => item.id === withProperty.id)?.address).toBe("Qxzeiendomsveien 3");
  });

  it("4.8.3 oppdrag fra ordre finnes som før og vises én gang", async () => {
    const { org, office, admin } = await orgWithPeople("Oppdiktet Takst A");
    const order = await createOrderService(admin, org.id, {
      addressText: "Qxzordreveien 8, 8000 Bodø",
      orderedByText: ORDERED_BY,
    });
    await convertOrderToAssignment(admin, org.id, order.id, { officeId: office.id });

    for (const query of ["qxzordreveien", "køsen"]) {
      const items = await queue(admin, org.id, query);
      expect(items, query).toHaveLength(1);
      expect(items[0]?.address).toBe("Qxzordreveien 8, 8000 Bodø");
    }
  });
});
