import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql, type SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { findPossibleDuplicateOrders } from "@/core/orders";
import { db } from "@/db/client";
import { assignments, orders } from "@/db/schema";
import {
  CROSS_TABLE_CASES,
  type CrossTableRow,
  type CrossTableTarget,
} from "../../../../tests/duplicate-cases";
import {
  TEST_NOW,
  createAssignment as createAssignmentRow,
  createEmployee,
  createOffice,
  createOrder,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../tests/factories";
import { DUPLICATE_KEY_INDEXES } from "./contract";
import {
  ADDRESS_KEY_SQL,
  BNR_KEY_SQL,
  GNR_KEY_SQL,
  possibleDuplicatesQuery,
} from "./duplicate-sql";
import { duplicateReasons, isWithinDuplicateWindow } from "./duplicates";
import { findPossibleDuplicatesFor } from "./duplicates-service";

/*
 * Dublett på tvers av ordre og oppdrag (testplan for «Nytt oppdrag» 2.1–2.11, ADR 0011).
 * Testsakene står som data i `tests/duplicate-cases.ts` (`CROSS_TABLE_CASES`). Hver sak kjøres
 * gjennom en ren modell av regelen (bygget på `duplicateReasons` og `isWithinDuplicateWindow`)
 * og gjennom spørringen i databasen; begge skal gi forventet svar i samme rekkefølge (paritet).
 * Oppdiktede adresser.
 *
 * Støtter hovedmål: færre reklamasjoner (samme bolig blir ikke bestilt eller tatt to ganger, uansett
 * om den kom som ordre eller som «Nytt oppdrag») og de ansatte (oppslaget er raskt med indeks).
 */

beforeEach(resetDatabase);

const DAY = 24 * 60 * 60 * 1000;
const OPEN_ASSIGNMENT = new Set(["ordered", "in_progress"]);

function receivedAt(daysAgo = 0): Date {
  return new Date(TEST_NOW.getTime() - daysAgo * DAY);
}

function fieldsOf(row: CrossTableRow) {
  return {
    addressText: row.address,
    gnr: row.gnr ?? null,
    bnr: row.bnr ?? null,
    snr: row.snr ?? null,
  };
}

/** Hva målet sammenlignes med, og hvilke rader som tas bort (seg selv og ordren/oppdraget sitt). */
function targetOf(rows: readonly CrossTableRow[], target: CrossTableTarget) {
  if (target.kind === "draft") {
    return {
      fields: {
        addressText: target.address,
        gnr: target.gnr ?? null,
        bnr: target.bnr ?? null,
        snr: target.snr ?? null,
      },
      receivedAt: receivedAt(target.daysAgo),
      excludeOrder: null as string | null,
      excludeAssignment: null as string | null,
    };
  }
  const row = rows.find((candidate) => candidate.key === target.key);
  if (!row) throw new Error(`Saken mangler raden ${target.key}`);
  if (row.kind === "assignment") {
    return {
      fields: fieldsOf(row),
      receivedAt: receivedAt(row.daysAgo),
      excludeOrder: row.fromOrder ?? null,
      excludeAssignment: row.key,
    };
  }
  const assignment = rows.find((candidate) => candidate.fromOrder === row.key);
  return {
    fields: fieldsOf(row),
    receivedAt: receivedAt(row.daysAgo),
    excludeOrder: row.key,
    excludeAssignment: assignment?.key ?? null,
  };
}

/** Den rene modellen av regelen i kontrakten (`FindPossibleDuplicatesFor`). */
function model(rows: readonly CrossTableRow[], target: CrossTableTarget) {
  const t = targetOf(rows, target);
  const hits: { key: string; at: number; reasons: string[] }[] = [];
  for (const row of rows) {
    if (row.deleted) continue;
    if (row.kind === "order") {
      if ((row.status ?? "received") !== "received") continue;
      if (row.key === t.excludeOrder) continue;
    } else {
      if (row.key === t.excludeAssignment) continue;
      if (row.fromOrder !== undefined && row.fromOrder === t.excludeOrder) continue;
      const open = OPEN_ASSIGNMENT.has(row.status ?? "ordered");
      if (!open && !isWithinDuplicateWindow(receivedAt(row.daysAgo), t.receivedAt)) continue;
    }
    const reasons = duplicateReasons(t.fields, fieldsOf(row));
    if (reasons.length === 0) continue;
    hits.push({ key: row.key, at: receivedAt(row.daysAgo).getTime(), reasons });
  }
  return hits.sort((a, b) => b.at - a.at).map((hit) => [hit.key, hit.reasons] as const);
}

async function adminIn(name = "Oppdiktet Takst A") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id);
  return { org, admin, office };
}

/** Setter inn radene i saken. Gir id-ene per nøkkel. */
async function insertRows(
  organizationId: string,
  officeId: string,
  rows: readonly CrossTableRow[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const deletedAt = new Date(TEST_NOW.getTime() - DAY / 2);
  // Ordre først (oppdrag fra ordre trenger ordren), som mottatt; gjort om settes etterpå.
  for (const row of rows.filter((r) => r.kind === "order")) {
    const rejected = row.status === "rejected";
    const order = await createOrder(organizationId, {
      ...fieldsOf(row),
      receivedAt: receivedAt(row.daysAgo),
      status: rejected ? "rejected" : "received",
      rejectedReason: rejected ? "Feil registrering (test)" : null,
      deletedAt: row.deleted ? deletedAt : null,
    });
    ids.set(row.key, order.id);
  }
  for (const row of rows.filter((r) => r.kind === "assignment")) {
    const orderId = row.fromOrder ? ids.get(row.fromOrder) : undefined;
    const assignment = await createAssignmentRow(organizationId, {
      ...fieldsOf(row),
      officeId,
      status: (row.status ?? "ordered") as "ordered",
      receivedAt: receivedAt(row.daysAgo),
      orderId: orderId ?? null,
      deletedAt: row.deleted ? deletedAt : null,
    });
    ids.set(row.key, assignment.id);
    if (orderId) {
      await db
        .update(orders)
        .set({ status: "converted", assignmentId: assignment.id })
        .where(eq(orders.id, orderId));
    }
  }
  return ids;
}

describe("2 testsakene på tvers av ordre og oppdrag", () => {
  it.each(CROSS_TABLE_CASES)("modellen: %s", (_name, rows, target, expected) => {
    expect(model(rows, target)).toEqual(expected.map(([key, reasons]) => [key, [...reasons]]));
  });

  it.each(CROSS_TABLE_CASES)(
    "2.9 paritet, databasen gir det samme i samme rekkefølge: %s",
    async (_name, rows, target, expected) => {
      const { org, admin, office } = await adminIn();
      const ids = await insertRows(org.id, office.id, rows);
      const keyOf = new Map([...ids].map(([key, id]) => [id, key]));
      const t = targetOf(rows, target);

      const result = await findPossibleDuplicatesFor(admin, org.id, {
        ...t.fields,
        receivedAt: t.receivedAt,
        excludeOrderId: t.excludeOrder === null ? null : ids.get(t.excludeOrder),
        excludeAssignmentId: t.excludeAssignment === null ? null : ids.get(t.excludeAssignment),
      });

      const got = result.items.map((item) => [keyOf.get(item.id), item.reasons] as const);
      expect(got).toEqual(expected.map(([key, reasons]) => [key, [...reasons]]));
      expect(got).toEqual(model(rows, target));
      for (const item of result.items) {
        const row = rows.find((candidate) => candidate.key === keyOf.get(item.id));
        expect(item.kind).toBe(row?.kind);
      }
    },
  );
});

describe("2.3 ordresiden ser et oppdrag laget direkte", () => {
  it("findPossibleDuplicateOrders for en åpen ordre har med oppdraget uten ordre", async () => {
    const { org, admin, office } = await adminIn();
    const direct = await createAssignmentRow(org.id, {
      addressText: "Testveien 12, 8000 Bodø",
      officeId: office.id,
      receivedAt: receivedAt(4),
    });
    const order = await createOrder(org.id, { addressText: "Testveien 12, 8000 Bodø" });

    const result = await findPossibleDuplicateOrders(admin, org.id, order.id);

    // Oppdraget har ingen ordre. Varselet på ordresiden må likevel vise det (kortet, «Regler»:
    // «ordre mot oppdrag»), ellers kan samme bolig bestilles to ganger uten varsel.
    expect(
      result.items.some((item) => item.assignmentNumber === direct.number),
      "oppdraget laget direkte mangler i varselet på ordresiden",
    ).toBe(true);
  });
});

/* -------------------------------------------------------- 2.10 EXPLAIN */

/** Gjør `toSQL()` med `$1 …` om til et SQL-objekt med de samme parametrene. */
function withParams(text: string, params: unknown[]): SQL {
  const parts = text.split(/\$(\d+)/);
  const chunks: SQL[] = [];
  parts.forEach((part, index) => {
    if (index % 2 === 0) chunks.push(sql.raw(part));
    else chunks.push(sql`${params[Number(part) - 1]}`);
  });
  return sql.join(chunks, sql.raw(""));
}

async function explain(
  organizationId: string,
  criteria: Parameters<typeof possibleDuplicatesQuery>[1],
): Promise<string> {
  const query = possibleDuplicatesQuery(organizationId, criteria).toSQL();
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`);
    const result = (await tx.execute(
      sql`explain ${withParams(query.sql, query.params)}`,
    )) as unknown as { "QUERY PLAN": string }[];
    return result.map((row) => row["QUERY PLAN"]).join("\n");
  });
}

describe("2.10 EXPLAIN: uttrykksindeksene på begge tabellene brukes", () => {
  async function seedMany(organizationId: string, officeId: string) {
    for (let index = 0; index < 60; index += 1) {
      const fields = {
        addressText: `Testveien ${index + 1}, 8000 Bodø`,
        gnr: String(1000 + index),
        bnr: String(index + 1),
        receivedAt: receivedAt(index),
      };
      await createOrder(organizationId, fields);
      await createAssignmentRow(organizationId, { ...fields, officeId });
    }
    await db.execute(sql`analyze orders`);
    await db.execute(sql`analyze assignments`);
  }

  it("adresse: adresseindeksen på orders og på assignments, ingen Seq Scan", async () => {
    const { org, office } = await adminIn();
    await seedMany(org.id, office.id);
    const plan = await explain(org.id, {
      addressKey: "testveien12",
      cadastre: null,
      receivedAt: TEST_NOW,
      excludeOrderId: null,
      excludeAssignmentId: null,
    });
    expect(plan).not.toMatch(/Seq Scan on (orders|assignments)/);
    expect(plan).toContain(DUPLICATE_KEY_INDEXES.order.address);
    expect(plan).toContain(DUPLICATE_KEY_INDEXES.assignment.address);
  });

  it("matrikkel: matrikkelindeksen på orders og på assignments, ingen Seq Scan", async () => {
    const { org, office } = await adminIn();
    await seedMany(org.id, office.id);
    const plan = await explain(org.id, {
      addressKey: null,
      cadastre: { gnr: "1011", bnr: "12", snr: "" },
      receivedAt: TEST_NOW,
      excludeOrderId: null,
      excludeAssignmentId: null,
    });
    expect(plan).not.toMatch(/Seq Scan on (orders|assignments)/);
    expect(plan).toContain(DUPLICATE_KEY_INDEXES.order.cadastre);
    expect(plan).toContain(DUPLICATE_KEY_INDEXES.assignment.cadastre);
  });

  it("indeksene finnes med navnene fra konstantene og organization_id først", async () => {
    const rows = (await db.execute(sql`
      select indexname, indexdef from pg_indexes
      where schemaname = current_schema() and tablename in ('orders', 'assignments')`)) as unknown as {
      indexname: string;
      indexdef: string;
    }[];
    for (const name of [
      DUPLICATE_KEY_INDEXES.order.address,
      DUPLICATE_KEY_INDEXES.order.cadastre,
      DUPLICATE_KEY_INDEXES.assignment.address,
      DUPLICATE_KEY_INDEXES.assignment.cadastre,
    ]) {
      const row = rows.find((candidate) => candidate.indexname === name);
      expect(row, name).toBeDefined();
      expect(row?.indexdef).toMatch(/USING btree \(organization_id, /);
    }
  });
});

/* --------------------------------------------- 2.11 uttrykkene er like */

describe("2.11 uttrykkene i duplicate-sql.ts står ordrett i migreringene", () => {
  const folder = join(process.cwd(), "src/db/migrations");
  const files = {
    orders: readFileSync(join(folder, "0033_indekser-mulig-dublett.sql"), "utf8"),
    assignments: readFileSync(join(folder, "0034_oppdrag-bestilling.sql"), "utf8"),
  };

  it.each([
    ["orders", DUPLICATE_KEY_INDEXES.order],
    ["assignments", DUPLICATE_KEY_INDEXES.assignment],
  ] as const)("%s: adresse- og matrikkelindeksen bruker samme tekst", (table, names) => {
    const text = files[table];
    const statement = (name: string) =>
      text.split(";").find((part) => part.includes(`CREATE INDEX "${name}"`)) ?? "";
    expect(statement(names.address)).toContain(`ON "${table}"`);
    expect(statement(names.address)).toContain(ADDRESS_KEY_SQL);
    expect(statement(names.cadastre)).toContain(GNR_KEY_SQL);
    expect(statement(names.cadastre)).toContain(BNR_KEY_SQL);
  });
});

describe("2 oppslaget filtrerer på organisasjonen fra tilgangen", () => {
  it("samme adresse i B gir aldri treff i A (alle måltyper)", async () => {
    const a = await adminIn("Oppdiktet Takst A");
    const b = await adminIn("Oppdiktet Takst B");
    const address = "Testveien 12, 8000 Bodø";
    await createOrder(b.org.id, { addressText: address, gnr: "9001", bnr: "1" });
    await createAssignmentRow(b.org.id, {
      addressText: address,
      gnr: "9001",
      bnr: "1",
      officeId: b.office.id,
    });
    const ownAssignment = await createAssignmentRow(a.org.id, {
      addressText: address,
      gnr: "9001",
      bnr: "1",
      officeId: a.office.id,
    });
    const ownOrder = await createOrder(a.org.id, { addressText: address, gnr: "9001", bnr: "1" });

    const draft = await findPossibleDuplicatesFor(a.admin, a.org.id, {
      addressText: address,
      gnr: "9001",
      bnr: "1",
      snr: null,
      receivedAt: TEST_NOW,
    });
    expect(draft.items.map((item) => item.id).sort()).toEqual(
      [ownAssignment.id, ownOrder.id].sort(),
    );
    const [check] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(assignments)
      .where(eq(assignments.organizationId, b.org.id));
    expect(check?.n).toBe(1);
  });
});
