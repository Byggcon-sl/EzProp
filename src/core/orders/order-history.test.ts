import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import {
  createContact,
  createOrder as insertOrder,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { orgWithAdmin, person, setEmployee } from "../../../tests/order-edit";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { listOrderHistory } from "./index";

/*
 * «Endringer» på ordresiden: `listOrderHistory` (docs/funksjoner/fase2a-rette-ordre-testplan.md
 * avsnitt 4, 7.2 og 7.3). Loggradene settes inn direkte, slik at lesingen prøves uavhengig av
 * `updateOrder`, og slik at ødelagte og ukjente rader kan lages.
 *
 * Formen på linjene står i kortet: tid, navn, handling, og for `update` en liste med
 * `{ field, label, from, to }`. Navnene på de øvrige nøklene er ikke avtalt, så testene finner
 * tiden (Date eller ISO-tekst) og listen over felt ut fra innholdet.
 *
 * Testdata er oppdiktet. Støtter hovedmål: færre reklamasjoner (hvem endret hva og når, bare
 * egne rader) og de ansatte (historikken leses uten å åpne adminloggen).
 */

beforeEach(resetDatabase);

type Line = Record<string, unknown>;
type FieldChange = { field: string; label: string; from: unknown; to: unknown };

const DELETED_AT = new Date("2026-11-01T08:00:00Z");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function minutesAfter(minutes: number) {
  return new Date(TEST_NOW.getTime() + minutes * 60_000);
}

/** Tiden på linjen: første verdi som er en Date eller ISO-tekst. */
function timeOf(line: Line): number {
  for (const value of Object.values(line)) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string" && ISO.test(value)) return new Date(value).getTime();
  }
  throw new Error(`linjen har ingen tid: ${JSON.stringify(line)}`);
}

/** Feltlisten på linjen: første liste der elementene har `field`. */
function changesOf(line: Line): FieldChange[] {
  for (const value of Object.values(line)) {
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "object" && item !== null && "field" in item)
    ) {
      return value as FieldChange[];
    }
  }
  return [];
}

async function insertAudit(
  organizationId: string,
  orderId: string,
  action: string,
  changes: Record<string, unknown>,
  occurredAt: Date,
  actorEmployeeId: string | null = null,
  entityType = "order",
) {
  await db.insert(auditLog).values({
    organizationId,
    entityType,
    entityId: orderId,
    action,
    changes,
    occurredAt,
    actorEmployeeId,
  });
}

function addressChange(from: string, to: string) {
  return { fields: ["addressText"], values: { addressText: { from, to } } };
}

describe("4. listOrderHistory", () => {
  it("4.1 opprettet, endret og avvist: nyeste først, én etikett per handling", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await insertAudit(
      org.id,
      order.id,
      "create",
      { status: "received" },
      minutesAfter(0),
      adminEmployee.id,
    );
    await insertAudit(
      org.id,
      order.id,
      "update",
      addressChange("Testveien 12", "Testveien 14"),
      minutesAfter(5),
      adminEmployee.id,
    );
    await insertAudit(
      org.id,
      order.id,
      "reject",
      { status: { from: "received", to: "rejected" } },
      minutesAfter(10),
      adminEmployee.id,
    );

    const lines = (await listOrderHistory(admin, org.id, order.id)) as Line[];
    expect(lines).toHaveLength(3);
    const times = lines.map(timeOf);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(JSON.stringify(lines[0])).toContain("Avvist");
    expect(JSON.stringify(lines[1])).toContain("Endret");
    expect(JSON.stringify(lines[2])).toContain("Opprettet");
  });

  it("4.1 gjort om har egen etikett", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await insertAudit(
      org.id,
      order.id,
      "convert",
      { status: { from: "received", to: "converted" } },
      minutesAfter(1),
      adminEmployee.id,
    );
    const lines = (await listOrderHistory(admin, org.id, order.id)) as Line[];
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0])).toMatch(/[Gg]jort om/);
  });

  it("4.2 update gir { field, label, from, to } med navnet på den ansatte; aldri rå changes", async () => {
    const { org } = await orgWithAdmin();
    const { actor, employee } = await person(org.id, ["office"], "Kari Kontorsen");
    const order = await insertOrder(org.id);
    await insertAudit(
      org.id,
      order.id,
      "update",
      addressChange("Testveien 12", "Testveien 14"),
      minutesAfter(1),
      employee.id,
    );

    const [line] = (await listOrderHistory(actor, org.id, order.id)) as Line[];
    expect(line).toBeDefined();
    expect(JSON.stringify(line)).toContain("Kari Kontorsen");
    const changes = changesOf(line!);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: "addressText",
      from: "Testveien 12",
      to: "Testveien 14",
    });
    expect(changes[0]?.label).toBeTruthy();
    expect(changes[0]?.label).not.toBe("addressText");
    // `changes` er en liste; den har aldri egen nøkkel `values` (Array.prototype.values teller ikke)
    expect(Object.hasOwn((line!.changes as object | undefined) ?? {}, "values")).toBe(false);
    expect(JSON.stringify(line)).not.toContain('"values"');
  });

  it("4.3 ukjente feltkoder og nøkler hoppes over, uten unntak", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await insertAudit(
      org.id,
      order.id,
      "update",
      {
        fields: ["addressText", "secretField"],
        values: {
          addressText: { from: "Testveien 12", to: "Testveien 14" },
          secretField: { from: "MARKOR-HEMMELIG", to: "MARKOR-HEMMELIG-2" },
        },
        extra: "MARKOR-EKSTRA",
      },
      minutesAfter(1),
      adminEmployee.id,
    );

    const lines = (await listOrderHistory(admin, org.id, order.id)) as Line[];
    expect(lines).toHaveLength(1);
    expect(changesOf(lines[0]!).map((change) => change.field)).toEqual(["addressText"]);
    const text = JSON.stringify(lines);
    expect(text).not.toContain("secretField");
    expect(text).not.toContain("MARKOR");
  });

  it.each([
    ["values som tekst", { fields: ["addressText", "gnr"], values: "ødelagt" }],
    ["from mangler", { fields: ["addressText"], values: { addressText: { to: "Testveien 14" } } }],
    ["values mangler", { fields: ["gnr"] }],
  ])(
    "4.4 ødelagt values (%s): linjen vises med feltetiketter, uten unntak",
    async (_name, changes) => {
      const { org, admin, adminEmployee } = await orgWithAdmin();
      const order = await insertOrder(org.id);
      await insertAudit(org.id, order.id, "update", changes, minutesAfter(1), adminEmployee.id);

      const lines = (await listOrderHistory(admin, org.id, order.id)) as Line[];
      expect(lines).toHaveLength(1);
      expect(JSON.stringify(lines[0])).toContain("Endret");
      const fields = changesOf(lines[0]!).map((change) => change.field);
      for (const field of fields) expect(changes.fields as string[]).toContain(field);
      for (const change of changesOf(lines[0]!)) expect(change.label).toBeTruthy();
      expect(JSON.stringify(lines)).not.toContain("ødelagt");
    },
  );

  it("4.5 myk-slettet ansatt vises fortsatt med navnet", async () => {
    const { org, admin } = await orgWithAdmin();
    const { employee } = await person(org.id, ["office"], "Ola Sluttetsen");
    const order = await insertOrder(org.id);
    await insertAudit(
      org.id,
      order.id,
      "update",
      addressChange("Testveien 12", "Testveien 14"),
      minutesAfter(1),
      employee.id,
    );
    await setEmployee(employee.id, { deletedAt: DELETED_AT });

    const lines = (await listOrderHistory(admin, org.id, order.id)) as Line[];
    expect(JSON.stringify(lines)).toContain("Ola Sluttetsen");
  });

  it("4.6/8.3 kontaktnavn slås opp; slettet, ukjent og fremmed kontakt gir «(fjernet kontakt)»", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin("Organisasjon A");
    const { org: orgB } = await orgWithAdmin("Organisasjon B");
    const live = await createContact(org.id, { firstName: "Kari", lastName: "Testesen" });
    const deleted = await createContact(org.id, {
      firstName: "Per",
      lastName: "Fjernetsen",
      deletedAt: DELETED_AT,
    });
    const foreign = await createContact(orgB.id, {
      firstName: "Fremmed",
      lastName: "Bestillersen",
    });
    const order = await insertOrder(org.id);

    const contactChange = (from: string | null, to: string | null) => ({
      fields: ["orderedByContactId"],
      values: { orderedByContactId: { from, to } },
    });
    await insertAudit(
      org.id,
      order.id,
      "update",
      contactChange(null, live.id),
      minutesAfter(1),
      adminEmployee.id,
    );
    await insertAudit(
      org.id,
      order.id,
      "update",
      contactChange(deleted.id, randomUUID()),
      minutesAfter(2),
      adminEmployee.id,
    );
    await insertAudit(
      org.id,
      order.id,
      "update",
      contactChange(foreign.id, live.id),
      minutesAfter(3),
      adminEmployee.id,
    );

    const lines = (await listOrderHistory(admin, org.id, order.id)) as Line[];
    expect(lines).toHaveLength(3);
    const [newest, middle, oldest] = lines.map((line) => changesOf(line)[0]);
    expect(JSON.stringify(oldest?.to)).toContain("Testesen");
    expect(oldest?.from === null || /\(tom\)/.test(String(oldest?.from))).toBe(true);
    expect(middle?.from).toBe("(fjernet kontakt)");
    expect(middle?.to).toBe("(fjernet kontakt)");
    expect(newest?.from).toBe("(fjernet kontakt)");
    const text = JSON.stringify(lines);
    expect(text).not.toContain("Fjernetsen");
    expect(text).not.toContain("Bestillersen");
  });

  it("4.7 205 loggrader gir 200 linjer, de nyeste", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    await db.insert(auditLog).values(
      Array.from({ length: 205 }, (_, i) => ({
        organizationId: org.id,
        entityType: "order",
        entityId: order.id,
        action: "update",
        changes: addressChange(`Testveien ${i}`, `Testveien ${i + 1}`),
        occurredAt: minutesAfter(i),
        actorEmployeeId: adminEmployee.id,
      })),
    );

    const lines = (await listOrderHistory(admin, org.id, order.id)) as Line[];
    expect(lines).toHaveLength(200);
    const times = lines.map(timeOf);
    expect(Math.max(...times)).toBe(minutesAfter(204).getTime());
    expect(Math.min(...times)).toBe(minutesAfter(5).getTime());
  });

  it("4.8 bare denne ordren: annen ordre og annen entity_type med samme id tas ikke med", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const order = await insertOrder(org.id);
    const other = await insertOrder(org.id);
    await insertAudit(
      org.id,
      order.id,
      "update",
      addressChange("Testveien 12", "Testveien 14"),
      minutesAfter(1),
      adminEmployee.id,
    );
    await insertAudit(
      org.id,
      other.id,
      "update",
      addressChange("MARKOR-ANNEN", "MARKOR-ANNEN-2"),
      minutesAfter(2),
      adminEmployee.id,
    );
    await insertAudit(
      org.id,
      order.id,
      "update",
      { fields: ["name"], values: { name: { from: "MARKOR-ENTITY", to: "x" } } },
      minutesAfter(3),
      adminEmployee.id,
      "assignment",
    );

    const lines = (await listOrderHistory(admin, org.id, order.id)) as Line[];
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain("MARKOR");
  });

  it.each([
    ["myk-slettet ordre", "deleted"],
    ["ukjent uuid", "unknown"],
    ["ikke-uuid", "abc"],
  ] as const)("4.9/8.2 %s gir AccessDeniedError", async (_name, variant) => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const deleted = await insertOrder(org.id, { deletedAt: DELETED_AT });
    await insertAudit(
      org.id,
      deleted.id,
      "update",
      addressChange("Testveien 12", "Testveien 14"),
      minutesAfter(1),
      adminEmployee.id,
    );
    const orderId =
      variant === "deleted" ? deleted.id : variant === "unknown" ? randomUUID() : "abc";

    await expect(listOrderHistory(admin, org.id, orderId)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });
});

describe("7. listOrderHistory: tenant-isolasjon", () => {
  it("7.2 bare egne historikklinjer (expectTenantIsolation)", async () => {
    const orderFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const order = await insertOrder(grant.organizationId);
          orderFor.set(grant.organizationId, order.id);
          await insertAudit(
            grant.organizationId,
            order.id,
            "update",
            addressChange("Testveien 12", "Testveien 14"),
            minutesAfter(1),
            grant.employeeId,
          );
        }
        return {
          a: [orderFor.get(grantA.organizationId)!],
          b: [orderFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor: Actor, organizationId: string) => {
        const orderId = orderFor.get(organizationId) ?? randomUUID();
        const lines = (await listOrderHistory(actor, organizationId, orderId)) as Line[];
        return lines.map((line) => ({ ...line, orderId }));
      },
      idOf: (row) => row.orderId,
    });
  });

  it("7.3 ansatt i A med A sin organisasjons-id og B sin ordre-id: AccessDeniedError, ingen linjer", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const { org: orgB, adminEmployee: adminB } = await orgWithAdmin("Organisasjon B");
    const orderB = await insertOrder(orgB.id);
    await insertAudit(
      orgB.id,
      orderB.id,
      "update",
      addressChange("MARKOR-B", "MARKOR-B2"),
      minutesAfter(1),
      adminB.id,
    );

    await expect(listOrderHistory(adminA, orgA.id, orderB.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(listOrderHistory(adminA, orgB.id, orderB.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });
});
