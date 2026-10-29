import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { employees, trialForms, users } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { createEmployee, createUser, resetDatabase } from "../../../../tests/factories";
import {
  ALL_ROLES,
  answerOp,
  createDeactivatedEmployee,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../tests/offline-trial";
import { expectTenantIsolation } from "../../../../tests/tenant-isolation";
import { localColumnsOf } from "../sync/local-columns";
import { normalizeLocalRow } from "../sync/local/normalize-row";
import { applyTrialChanges } from "./apply-changes";
import { listTrialChangesSince, START_POSITION, subtractOverlap } from "./changes-since";
import { InvalidTrialCursorError } from "./errors";
import { NIL_UUID, TRIAL_PULL_TABLE_ORDER, type TrialChangeTable } from "./types";

// Hente-ruten for kandidat 3 (egenbygd). Testplan docs/funksjoner/fase1-kandidat-egenbygd-testplan.md
// avsnitt 3.1. Alle data er oppdiktet.

beforeEach(resetDatabase);

/** Den andre tilkoblingen i testen «ingen rad hoppes over». `max: 1` gjør `begin` som tekst trygt. */
// setup-env har allerede satt DATABASE_URL til testdatabasen, så testDatabaseUrl() kan ikke kalles her.
const second = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
afterAll(() => second.end());

async function actorFor(grant: EmployeeGrant): Promise<Actor> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, grant.employeeId));
  if (!row) throw new Error("fant ikke den ansatte");
  return row;
}

type Rows = Record<TrialChangeTable, Record<string, unknown>[]>;

/** Henter side for side til `ferdig: true`. Høyst 20 sider, ellers går sidene i ring. */
async function fetchAll(actor: Actor, organizationId: string, cursor: string | null = null) {
  const rows: Rows = { trial_forms: [], trial_answers: [], trial_photos: [] };
  let markor = cursor;
  for (let page = 0; page < 20; page += 1) {
    const result = await listTrialChangesSince(actor, organizationId, markor);
    for (const table of TRIAL_PULL_TABLE_ORDER) rows[table].push(...result.endringer[table]);
    markor = result.markor;
    if (result.ferdig) return { rows, markor, pages: page + 1 };
  }
  throw new Error("sidene går i ring");
}

const idsOf = (rows: Record<string, unknown>[]) => new Set(rows.map((row) => row.id as string));

function decode(markor: string): unknown {
  return JSON.parse(Buffer.from(markor, "base64url").toString("utf8"));
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function maxUpdatedAt(organizationId: string): Promise<string> {
  const [row] = await db.execute<{ u: string }>(
    sql`select max(updated_at)::text as u from trial_forms where organization_id = ${organizationId}`,
  );
  if (!row) throw new Error("ingen rader");
  return row.u;
}

describe("listTrialChangesSince: tilgang og tenant-isolasjon", () => {
  it("listTrialChangesSince gir aldri en annen organisasjons rader (expectTenantIsolation)", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await putTrialForm(await actorFor(grantA), grantA.organizationId, "Skjema A");
        const b = await putTrialForm(await actorFor(grantB), grantB.organizationId, "Skjema B");
        return { a: [a], b: [b] };
      },
      query: async (actor, organizationId) =>
        (await listTrialChangesSince(actor, organizationId, null)).endringer.trial_forms,
      idOf: (row) => row.id as string,
    });
  });

  it("en markør laget for B og sendt av A gir 0 B-rader", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formB = await putTrialForm(b.actor, b.organizationId, "Skjema B");
    await applyTrialChanges(b.actor, b.organizationId, [answerOp(formB, "floors", 2)]);
    const { markor: markorB } = await fetchAll(b.actor, b.organizationId);

    const formA = await putTrialForm(a.actor, a.organizationId, "Skjema A");
    const result = await fetchAll(a.actor, a.organizationId, markorB);

    for (const table of TRIAL_PULL_TABLE_ORDER) {
      for (const row of result.rows[table]) {
        expect(row.id).not.toBe(formB);
        expect(row.trial_form_id ?? null).not.toBe(formB);
      }
    }
    expect(idsOf(result.rows.trial_forms)).toEqual(new Set([formA]));
  });

  it.each(ALL_ROLES)("alle fire roller får hente, deaktivert ansatt nektes (%s)", async (role) => {
    const owner = await setupOrganization("admin");
    const formId = await putTrialForm(owner.actor, owner.organizationId);
    const actor = await createUser({ name: `Oppdiktet ${role}` });
    await createEmployee(actor, owner.organizationId, [role]);

    const result = await listTrialChangesSince(actor, owner.organizationId, null);
    expect(result.endringer.trial_forms.map((row) => row.id)).toEqual([formId]);

    const gone = await createDeactivatedEmployee(owner.organizationId);
    await expect(listTrialChangesSince(gone, owner.organizationId, null)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("fremmed organisasjon gir AccessDeniedError før markøren leses", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    await expect(listTrialChangesSince(a.actor, b.organizationId, "søppel")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("markøren har ingen organisasjons-ID og ingen andre felt enn v og t", async () => {
    const { actor, organizationId } = await setupOrganization();
    await putTrialForm(actor, organizationId);
    const { markor } = await listTrialChangesSince(actor, organizationId, null);
    const decoded = decode(markor) as { v: number; t: Record<string, Record<string, unknown>> };

    expect(Object.keys(decoded).sort()).toEqual(["t", "v"]);
    expect(decoded.v).toBe(1);
    expect(Object.keys(decoded.t).sort()).toEqual([...TRIAL_PULL_TABLE_ORDER].sort());
    for (const position of Object.values(decoded.t)) {
      expect(Object.keys(position).sort()).toEqual(["id", "u"]);
    }
    expect(JSON.stringify(decoded)).not.toContain(organizationId);
    expect(markor).not.toContain(organizationId);
  });
});

describe("listTrialChangesSince: ingen rad hoppes over", () => {
  it("ingen rad hoppes over når en eldre transaksjon committer etter hentingen", async () => {
    const { actor, organizationId } = await setupOrganization();
    const s1 = uuidv7();
    await second`begin`;
    try {
      // tx1 får now() = starten av transaksjonen, før S2
      await second`insert into trial_forms (id, organization_id, name) values (${s1}, ${organizationId}, 'Skjema S1')`;
      const s2 = await putTrialForm(actor, organizationId, "Skjema S2");

      const first = await fetchAll(actor, organizationId);
      expect(idsOf(first.rows.trial_forms)).toEqual(new Set([s2]));

      await second`commit`;
      const next = await fetchAll(actor, organizationId, first.markor);
      expect(idsOf(next.rows.trial_forms).has(s1)).toBe(true);
    } catch (error) {
      await second`rollback`.catch(() => {});
      throw error;
    }
  });

  it("oppdatering med updated_at bakover i tid innenfor 60 s kommer med", async () => {
    const { actor, organizationId } = await setupOrganization();
    const target = await putTrialForm(actor, organizationId, "Før");
    await putTrialForm(actor, organizationId, "Annet");
    const { markor } = await fetchAll(actor, organizationId);
    const max = await maxUpdatedAt(organizationId);

    await db.execute(
      sql`update trial_forms set name = 'Etter', updated_at = ${max}::timestamptz - interval '30 seconds' where id = ${target}`,
    );
    const next = await fetchAll(actor, organizationId, markor);
    const row = next.rows.trial_forms.find((r) => r.id === target);
    expect(row?.name).toBe("Etter");
  });

  it("oppdatering mer enn 60 s bakover kommer ikke med (kjent grense)", async () => {
    // Kjent grense, se resultatfilen (docs/funksjoner/fase1-prove-ab-egenbygd.md).
    const { actor, organizationId } = await setupOrganization();
    const target = await putTrialForm(actor, organizationId, "Før");
    await putTrialForm(actor, organizationId, "Annet");
    const { markor } = await fetchAll(actor, organizationId);
    const max = await maxUpdatedAt(organizationId);

    await db.execute(
      sql`update trial_forms set name = 'Etter', updated_at = ${max}::timestamptz - interval '90 seconds' where id = ${target}`,
    );
    const next = await fetchAll(actor, organizationId, markor);
    expect(next.rows.trial_forms.find((r) => r.id === target)).toBeUndefined();
  });

  it("501 rader med samme updated_at gir ferdig: false og resten i neste svar", async () => {
    const { actor, organizationId } = await setupOrganization();
    await db.execute(sql`
      insert into trial_forms (id, organization_id, name)
      select gen_random_uuid(), ${organizationId}, 'Skjema ' || g from generate_series(1, 501) g
    `);

    const first = await listTrialChangesSince(actor, organizationId, null);
    expect(first.endringer.trial_forms).toHaveLength(500);
    expect(first.ferdig).toBe(false);

    const next = await listTrialChangesSince(actor, organizationId, first.markor);
    expect(next.ferdig).toBe(true);
    const all = idsOf([...first.endringer.trial_forms, ...next.endringer.trial_forms]);
    expect(all.size).toBe(501);
  });

  it("rader som skiller seg med ett mikrosekund hoppes ikke over ved sidegrensen", async () => {
    const { actor, organizationId } = await setupOrganization();
    await db.execute(sql`
      insert into trial_forms (id, organization_id, name, updated_at)
      select gen_random_uuid(), ${organizationId}, 'Skjema ' || g,
        '2026-10-29T10:00:00.000000Z'::timestamptz + g * interval '1 microsecond'
      from generate_series(1, 501) g
    `);

    const result = await fetchAll(actor, organizationId);
    expect(idsOf(result.rows.trial_forms).size).toBe(501);
  });

  it("grensen 500 gjelder hele svaret, og tabellene leses i fast rekkefølge", async () => {
    const { actor, organizationId } = await setupOrganization();
    await db.execute(sql`
      insert into trial_forms (id, organization_id, name)
      select gen_random_uuid(), ${organizationId}, 'Skjema ' || g from generate_series(1, 300) g
    `);
    await db.execute(sql`
      insert into trial_answers (id, organization_id, trial_form_id, field_key, value, device_id)
      select gen_random_uuid(), ${organizationId}, id, 'floors', '2'::jsonb, 'enhet-1'
      from trial_forms where organization_id = ${organizationId}
    `);

    const first = await listTrialChangesSince(actor, organizationId, null);
    expect(first.endringer.trial_forms).toHaveLength(300);
    expect(first.endringer.trial_answers).toHaveLength(200);
    expect(first.endringer.trial_photos).toHaveLength(0);
    expect(first.ferdig).toBe(false);
    const decoded = decode(first.markor) as { t: Record<string, unknown> };
    expect(decoded.t.trial_photos).toEqual(START_POSITION);

    const all = await fetchAll(actor, organizationId);
    expect(idsOf(all.rows.trial_forms).size + idsOf(all.rows.trial_answers).size).toBe(600);
  });

  it("ferdig henting leser de siste 60 s på nytt", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    await applyTrialChanges(actor, organizationId, [answerOp(formId, "floors", 2)]);

    const first = await listTrialChangesSince(actor, organizationId, null);
    expect(first.ferdig).toBe(true);
    const again = await listTrialChangesSince(actor, organizationId, first.markor);
    expect(again.ferdig).toBe(true);
    expect(idsOf(again.endringer.trial_forms)).toEqual(idsOf(first.endringer.trial_forms));
    expect(idsOf(again.endringer.trial_answers)).toEqual(idsOf(first.endringer.trial_answers));
  });

  it("uten markør hentes alt fra start", async () => {
    const { actor, organizationId } = await setupOrganization();
    const first = await listTrialChangesSince(actor, organizationId, null);
    expect(first.endringer).toEqual({ trial_forms: [], trial_answers: [], trial_photos: [] });
    expect(first.ferdig).toBe(true);
    const again = await listTrialChangesSince(actor, organizationId, first.markor);
    expect(again.ferdig).toBe(true);
  });

  it("en full side etterfulgt av en tom side får overlappet likevel", async () => {
    // Uten dette ville markøren bli stående som ren keyset, og en eldre transaksjon som committer
    // senere med tid før siste rad, ville bli hoppet over.
    const { actor, organizationId } = await setupOrganization();
    await db.execute(sql`
      insert into trial_forms (id, organization_id, name)
      select gen_random_uuid(), ${organizationId}, 'Skjema ' || g from generate_series(1, 500) g
    `);
    const first = await listTrialChangesSince(actor, organizationId, null);
    expect(first.ferdig).toBe(false);
    const next = await listTrialChangesSince(actor, organizationId, first.markor);
    expect(next.ferdig).toBe(true);
    const decoded = decode(next.markor) as { t: Record<string, { u: string; id: string }> };
    expect(decoded.t.trial_forms?.id).toBe(NIL_UUID);
  });
});

describe("listTrialChangesSince: form på radene", () => {
  async function seedAll() {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "floors", 2),
      photoOp(formId),
    ]);
    // Serverstyrte kolonner skal aldri ut, heller ikke når de har en verdi.
    await db.execute(
      sql`update trial_photos set storage_path = 'hemmelig/sti' where organization_id = ${organizationId}`,
    );
    return { actor, organizationId };
  }

  it.each(TRIAL_PULL_TABLE_ORDER)(
    "nøklene i hver rad er nøyaktig localColumnsOf(table) (%s)",
    async (table) => {
      const { actor, organizationId } = await seedAll();
      const { rows } = await fetchAll(actor, organizationId);
      expect(rows[table].length).toBeGreaterThan(0);
      for (const row of rows[table]) {
        expect(Object.keys(row).sort()).toEqual([...localColumnsOf(table)].sort());
        for (const hidden of [
          "storage_path",
          "organization_id",
          "created_by",
          "updated_by",
          "deleted_by",
          "row_version",
        ]) {
          expect(row).not.toHaveProperty(hidden);
        }
      }
    },
  );

  it("radene har samme form som normalizeShapeRow gir", async () => {
    const { actor, organizationId } = await seedAll();
    const { rows } = await fetchAll(actor, organizationId);
    for (const table of TRIAL_PULL_TABLE_ORDER) {
      for (const row of rows[table]) {
        expect(normalizeLocalRow(table, row)).toEqual(row);
        expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    }
    expect(rows.trial_answers[0]?.value).toBe("2");
    expect(typeof rows.trial_photos[0]?.size_bytes).toBe("number");
  });

  it("myk slettede rader kommer med deleted_at", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const answerId = uuidv7();
    await applyTrialChanges(actor, organizationId, [answerOp(formId, "floors", 2, {}, answerId)]);
    const { markor } = await fetchAll(actor, organizationId);

    await db.execute(
      sql`update trial_forms set deleted_at = now(), updated_at = now() where id = ${formId}`,
    );
    await db.execute(
      sql`update trial_answers set deleted_at = now(), updated_at = now() where id = ${answerId}`,
    );
    const next = await fetchAll(actor, organizationId, markor);
    expect(next.rows.trial_forms.find((r) => r.id === formId)?.deleted_at).toEqual(
      expect.any(String),
    );
    expect(next.rows.trial_answers.find((r) => r.id === answerId)?.deleted_at).toEqual(
      expect.any(String),
    );
    // Regel 3: raden finnes fortsatt
    expect(await db.select().from(trialForms).where(eq(trialForms.id, formId))).toHaveLength(1);
  });
});

describe("listTrialChangesSince: forfalsket markør", () => {
  const position = { u: "2026-10-29T10:00:00.000000Z", id: NIL_UUID };
  const tables = { trial_forms: position, trial_answers: position, trial_photos: position };

  it.each([
    ["søppel", "søppel"],
    ["feil base64url", "!!!"],
    ["base64url av tekst som ikke er json", Buffer.from("ikke json").toString("base64url")],
    ["v: 2", encode({ v: 2, t: tables })],
    ["mangler t", encode({ v: 1 })],
    ["ugyldig tid", encode({ v: 1, t: { ...tables, trial_forms: { u: "i går", id: "x" } } })],
    [
      "30. februar",
      encode({ v: 1, t: { trial_forms: { u: "2026-02-30T10:00:00.000000Z", id: NIL_UUID } } }),
    ],
    ["id som ikke er uuid", encode({ v: 1, t: { trial_forms: { u: position.u, id: "x" } } })],
    ["ukjent tabell", encode({ v: 1, t: { users: position } })],
    ["ekstra felt", encode({ v: 1, t: tables, organizationId: NIL_UUID })],
    ["tom tekst", ""],
    ["10 000 tegn", "a".repeat(10_000)],
  ])("ugyldig markør gir InvalidTrialCursorError (%s)", async (_name, cursor) => {
    const { actor, organizationId } = await setupOrganization();
    await expect(listTrialChangesSince(actor, organizationId, cursor)).rejects.toThrow(
      InvalidTrialCursorError,
    );
  });

  it("markør med fremtidig tid eller fremmed id gir bare egne rader", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formA = await putTrialForm(a.actor, a.organizationId);
    const formB = await putTrialForm(b.actor, b.organizationId);

    const future = { u: "2100-01-01T00:00:00.000000Z", id: NIL_UUID };
    const empty = await listTrialChangesSince(
      a.actor,
      a.organizationId,
      encode({ v: 1, t: { trial_forms: future, trial_answers: future, trial_photos: future } }),
    );
    expect(empty.endringer).toEqual({ trial_forms: [], trial_answers: [], trial_photos: [] });
    expect(empty.ferdig).toBe(true);

    const foreign = await fetchAll(
      a.actor,
      a.organizationId,
      encode({ v: 1, t: { trial_forms: { u: START_POSITION.u, id: formB } } }),
    );
    expect(idsOf(foreign.rows.trial_forms)).toEqual(new Set([formA]));
  });
});

describe("subtractOverlap", () => {
  it("trekker fra 60 s og beholder mikrosekundene", () => {
    expect(subtractOverlap("2026-10-29T10:00:30.123456Z")).toBe("2026-10-29T09:59:30.123456Z");
    expect(subtractOverlap("2026-01-01T00:00:00.000001Z")).toBe("2025-12-31T23:59:00.000001Z");
  });
});
