import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { employees, trialAnswers, trialForms, users } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../../tests/factories";
import {
  ALL_ROLES,
  answerOp,
  createDeactivatedEmployee,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../tests/offline-trial";
import { expectTenantIsolation } from "../../../../tests/tenant-isolation";
import { localColumnsOf, type TrialTableName } from "../sync/local-columns";
import { normalizeLocalRow } from "../sync/local/normalize-row";
import { applyTrialChanges } from "./apply-changes";
import { listTrialChangesSince } from "./changes-since";
import { InvalidTrialCursorError } from "./errors";
import { TRIAL_PULL_LIMIT, type TrialChangesSinceResult } from "./types";

// «Endringer siden sist» for kandidat 3, egenbygd (docs/funksjoner/fase1-kandidat-egenbygd.md
// pkt. 10 og 12, forarbeid pkt. 2). Testplan avsnitt 3.1. Rader lages med applyTrialChanges der
// det går, og med SQL der testen må styre updated_at eller deleted_at (myk sletting finnes ikke
// som skriveoperasjon). Alle data er oppdiktet.

beforeEach(resetDatabase);

const TABLES: TrialTableName[] = ["trial_forms", "trial_answers", "trial_photos"];
const MAX_PAGES = 20;

/**
 * Andre tilkobling til testdatabasen, for transaksjonen som ikke er committet. `testDatabaseUrl()`
 * kan ikke brukes her: setup-env.ts har satt DATABASE_URL lik testdatabasen, og da kaster den.
 */
const other = postgres(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "", {
  max: 1,
  onnotice: () => {},
});

afterAll(async () => {
  await other.end({ timeout: 5 });
});

type Rows = Record<TrialTableName, Record<string, unknown>[]>;

/** Henter side for side til `ferdig: true`. Flere enn 20 sider betyr at sidene går i ring. */
async function fetchAll(actor: Actor, organizationId: string, cursor: string | null) {
  const rows: Rows = { trial_forms: [], trial_answers: [], trial_photos: [] };
  const pages: TrialChangesSinceResult[] = [];
  let markor = cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await listTrialChangesSince(actor, organizationId, markor);
    pages.push(page);
    for (const table of TABLES) rows[table].push(...page.endringer[table]);
    markor = page.markor;
    if (page.ferdig) return { rows, markor: page.markor, pages };
  }
  throw new Error("sidene går i ring");
}

function idsOf(rows: Record<string, unknown>[]): Set<string> {
  return new Set(rows.map((row) => String(row.id)));
}

function allIds(rows: Rows): Set<string> {
  return new Set(TABLES.flatMap((table) => [...idsOf(rows[table])]));
}

function decode(markor: string): unknown {
  return JSON.parse(Buffer.from(markor, "base64url").toString("utf8"));
}

function encode(value: unknown): string {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8").toString(
    "base64url",
  );
}

interface DecodedCursor {
  v: number;
  t: Partial<Record<TrialTableName, { u: string; id: string }>>;
}

/** Admin-innloggingen i grant-ens organisasjon (expectTenantIsolation bruker admin i begge). */
async function actorFor(grant: EmployeeGrant): Promise<Actor> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, grant.employeeId));
  if (!row) throw new Error("fant ikke den ansatte");
  return row;
}

/** Skjema med ett svar og ett bilde. */
async function seedFormWithRows(actor: Actor, organizationId: string) {
  const formId = await putTrialForm(actor, organizationId);
  const answerId = uuidv7();
  const photoId = uuidv7();
  await applyTrialChanges(actor, organizationId, [
    answerOp(formId, "floors", 2, {}, answerId),
    photoOp(formId, "cover_photo", {}, photoId),
  ]);
  return { formId, answerId, photoId };
}

/** Mange skjemaer i én INSERT, så alle får samme `now()`. */
async function insertManyForms(organizationId: string, count: number) {
  await db.execute(sql`
    insert into trial_forms (id, organization_id, name)
    select gen_random_uuid(), ${organizationId}::uuid, 'Testskjema ' || g
    from generate_series(1, ${count}) as g
  `);
}

describe("listTrialChangesSince: tilgang og tenant-isolasjon", () => {
  // Obligatorisk
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

  // Obligatorisk
  it("en markør laget for B og sendt av A gir 0 B-rader", async () => {
    const a = await setupOrganization("inspector", "Organisasjon A");
    const b = await setupOrganization("inspector", "Organisasjon B");
    const seededB = await seedFormWithRows(b.actor, b.organizationId);
    const { markor: markorB } = await fetchAll(b.actor, b.organizationId, null);
    const seededA = await seedFormWithRows(a.actor, a.organizationId);

    const { rows } = await fetchAll(a.actor, a.organizationId, markorB);
    const ids = allIds(rows);
    for (const id of Object.values(seededB)) expect(ids.has(id), `B-rad ${id}`).toBe(false);
    // A sine rader fra etter markørens tid kommer med: markøren gir ingen tilgang, bare posisjon
    for (const id of Object.values(seededA)) expect(ids.has(id), `A-rad ${id}`).toBe(true);
  });

  // Obligatorisk (admin stenges aldri ute)
  it.each(ALL_ROLES)("alle fire roller får hente, deaktivert ansatt nektes (%s)", async (role) => {
    const { actor, organizationId } = await setupOrganization(role);
    const formId = await putTrialForm(actor, organizationId);
    const result = await listTrialChangesSince(actor, organizationId, null);
    expect(idsOf(result.endringer.trial_forms).has(formId)).toBe(true);

    const deactivated = await createDeactivatedEmployee(organizationId);
    await expect(listTrialChangesSince(deactivated, organizationId, null)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it("fremmed organisasjon gir AccessDeniedError før markøren leses", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    await putTrialForm(b.actor, b.organizationId);
    for (const cursor of ["søppel", encode({ v: 2 }), null]) {
      await expect(
        listTrialChangesSince(a.actor, b.organizationId, cursor),
        String(cursor),
      ).rejects.toBeInstanceOf(AccessDeniedError);
    }
  });

  it("markøren har ingen organisasjons-ID og ingen andre felt enn v og t", async () => {
    const { actor, organizationId } = await setupOrganization();
    await seedFormWithRows(actor, organizationId);
    const { markor } = await fetchAll(actor, organizationId, null);
    expect(typeof markor).toBe("string");
    expect(markor).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decode(markor) as DecodedCursor & Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(["t", "v"]);
    expect(decoded.v).toBe(1);
    expect(Object.keys(decoded.t).sort()).toEqual([...TABLES].sort());
    for (const table of TABLES) {
      const position = decoded.t[table]!;
      expect(Object.keys(position).sort(), table).toEqual(["id", "u"]);
      expect(typeof position.u).toBe("string");
      expect(position.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    const text = Buffer.from(markor, "base64url").toString("utf8");
    expect(text).not.toContain(organizationId);
    expect(text).not.toContain("organization");
  });
});

describe("listTrialChangesSince: ingen rad hoppes over", () => {
  // Obligatorisk (tap av data)
  it("ingen rad hoppes over når en eldre transaksjon committer etter hentingen", async () => {
    const { actor, organizationId } = await setupOrganization();
    const s1 = uuidv7();
    let inserted!: () => void;
    let commit!: () => void;
    const insertedPromise = new Promise<void>((resolve) => (inserted = resolve));
    const commitPromise = new Promise<void>((resolve) => (commit = resolve));

    // tx1 på den andre tilkoblingen: setter inn S1 (får tx1s now()) og venter med commit
    const tx1 = other.begin(async (tx) => {
      await tx`insert into trial_forms (id, organization_id, name)
               values (${s1}::uuid, ${organizationId}::uuid, 'Testskjema eldre')`;
      inserted();
      await commitPromise;
    });

    try {
      await insertedPromise;
      await new Promise((resolve) => setTimeout(resolve, 50));
      // tx2 (vanlig db): S2 settes inn og committes etter at tx1 startet
      const s2 = await putTrialForm(actor, organizationId, "Testskjema nyere");

      const first = await fetchAll(actor, organizationId, null);
      const firstIds = idsOf(first.rows.trial_forms);
      expect(firstIds.has(s2)).toBe(true);
      expect(firstIds.has(s1)).toBe(false);

      commit();
      await tx1;

      const next = await fetchAll(actor, organizationId, first.markor);
      expect(idsOf(next.rows.trial_forms).has(s1)).toBe(true);
    } finally {
      commit();
      await tx1.catch(() => {});
    }
  });

  // Obligatorisk
  it("oppdatering med updated_at bakover i tid innenfor 60 s kommer med", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { answerId } = await seedFormWithRows(actor, organizationId);
    const first = await fetchAll(actor, organizationId, null);

    await db.execute(sql`
      update trial_answers
      set value = '5'::jsonb,
          updated_at = (select max(updated_at) from trial_answers
                        where organization_id = ${organizationId}::uuid) - interval '30 seconds'
      where id = ${answerId}::uuid
    `);

    const next = await fetchAll(actor, organizationId, first.markor);
    const row = next.rows.trial_answers.find((answer) => answer.id === answerId);
    expect(row, "svaret med bakdatert updated_at").toBeDefined();
    expect(row!.value).toBe("5");
  });

  it("oppdatering mer enn 60 s bakover kommer ikke med (kjent grense)", async () => {
    // Kjent grense, se resultatfilen (docs/funksjoner/fase1-prove-ab-egenbygd.md): overlappet er 60 s.
    const { actor, organizationId } = await setupOrganization();
    const { answerId } = await seedFormWithRows(actor, organizationId);
    const first = await fetchAll(actor, organizationId, null);

    await db.execute(sql`
      update trial_answers
      set value = '5'::jsonb,
          updated_at = (select max(updated_at) from trial_answers
                        where organization_id = ${organizationId}::uuid) - interval '90 seconds'
      where id = ${answerId}::uuid
    `);

    const next = await fetchAll(actor, organizationId, first.markor);
    expect(next.rows.trial_answers.some((answer) => answer.id === answerId)).toBe(false);
  });

  // Obligatorisk
  it("501 rader med samme updated_at gir ferdig: false og resten i neste svar", async () => {
    const { actor, organizationId } = await setupOrganization();
    await insertManyForms(organizationId, 501);
    const counted = (await db.execute(sql`
      select count(distinct updated_at)::int as distinct from trial_forms
      where organization_id = ${organizationId}::uuid
    `)) as unknown as { distinct: number }[];
    expect(counted[0]?.distinct).toBe(1);

    const first = await listTrialChangesSince(actor, organizationId, null);
    expect(first.endringer.trial_forms).toHaveLength(TRIAL_PULL_LIMIT);
    expect(first.ferdig).toBe(false);

    const second = await listTrialChangesSince(actor, organizationId, first.markor);
    expect(second.ferdig).toBe(true);
    expect(second.endringer.trial_forms.length).toBeGreaterThanOrEqual(1);

    const union = new Set([
      ...idsOf(first.endringer.trial_forms),
      ...idsOf(second.endringer.trial_forms),
    ]);
    expect(union.size).toBe(501);
  });

  // Obligatorisk
  it("rader som skiller seg med ett mikrosekund hoppes ikke over ved sidegrensen", async () => {
    const { actor, organizationId } = await setupOrganization();
    await insertManyForms(organizationId, 501);
    // 500 rader på samme tid med mikrosekunder, den siste ett mikrosekund senere
    await db.execute(sql`
      update trial_forms set updated_at = '2026-10-29 10:00:00.123456+00'
      where organization_id = ${organizationId}::uuid
    `);
    await db.execute(sql`
      update trial_forms set updated_at = '2026-10-29 10:00:00.123457+00'
      where id = (select id from trial_forms where organization_id = ${organizationId}::uuid
                  order by id desc limit 1)
    `);

    const { rows } = await fetchAll(actor, organizationId, null);
    expect(idsOf(rows.trial_forms).size).toBe(501);
  });

  it("grensen 500 gjelder hele svaret, og tabellene leses i fast rekkefølge", async () => {
    const { actor, organizationId } = await setupOrganization();
    const start = decode(
      (await listTrialChangesSince(actor, organizationId, null)).markor,
    ) as DecodedCursor;

    await insertManyForms(organizationId, 300);
    await db.execute(sql`
      insert into trial_answers (organization_id, trial_form_id, field_key, value, device_id)
      select ${organizationId}::uuid, id, 'floors', '2'::jsonb, 'enhet-1'
      from trial_forms where organization_id = ${organizationId}::uuid
    `);
    const formId = (
      (await db.execute(sql`
        select id from trial_forms where organization_id = ${organizationId}::uuid limit 1
      `)) as unknown as { id: string }[]
    )[0]!.id;
    await applyTrialChanges(actor, organizationId, [photoOp(formId)]);

    const first = await listTrialChangesSince(actor, organizationId, null);
    expect(first.endringer.trial_forms).toHaveLength(300);
    expect(first.endringer.trial_answers).toHaveLength(200);
    expect(first.endringer.trial_photos).toHaveLength(0);
    expect(first.ferdig).toBe(false);
    const cursor = decode(first.markor) as DecodedCursor;
    // Bildene ble ikke nådd: markøren for dem står der den startet
    expect(cursor.t.trial_photos).toEqual(start.t.trial_photos);

    const { rows } = await fetchAll(actor, organizationId, null);
    expect(idsOf(rows.trial_forms).size).toBe(300);
    expect(idsOf(rows.trial_answers).size).toBe(300);
    expect(idsOf(rows.trial_photos).size).toBe(1);
  });

  it("ferdig henting leser de siste 60 s på nytt", async () => {
    const { actor, organizationId } = await setupOrganization();
    const seeded = await seedFormWithRows(actor, organizationId);
    const first = await fetchAll(actor, organizationId, null);
    expect(allIds(first.rows)).toEqual(new Set(Object.values(seeded)));

    const again = await listTrialChangesSince(actor, organizationId, first.markor);
    expect(again.ferdig).toBe(true);
    expect(idsOf(again.endringer.trial_forms).has(seeded.formId)).toBe(true);
    expect(idsOf(again.endringer.trial_answers).has(seeded.answerId)).toBe(true);
    expect(idsOf(again.endringer.trial_photos).has(seeded.photoId)).toBe(true);
  });

  it("uten markør hentes alt fra start", async () => {
    const { actor, organizationId } = await setupOrganization();
    const first = await listTrialChangesSince(actor, organizationId, null);
    expect(first.endringer).toEqual({ trial_forms: [], trial_answers: [], trial_photos: [] });
    expect(first.ferdig).toBe(true);
    expect(typeof first.markor).toBe("string");
    expect(first.markor.length).toBeGreaterThan(0);

    const second = await listTrialChangesSince(actor, organizationId, first.markor);
    expect(second.ferdig).toBe(true);
    expect(second.endringer).toEqual({ trial_forms: [], trial_answers: [], trial_photos: [] });
  });
});

describe("listTrialChangesSince: form på radene", () => {
  // Obligatorisk (sikkerhet)
  it.each(TABLES)("nøklene i hver rad er nøyaktig localColumnsOf(table) (%s)", async (table) => {
    const { actor, organizationId } = await setupOrganization();
    await seedFormWithRows(actor, organizationId);
    await db.execute(sql`
      update trial_photos set storage_path = 'oppdiktet/sti', sha256 = 'abc'
      where organization_id = ${organizationId}::uuid
    `);
    const { rows } = await fetchAll(actor, organizationId, null);
    expect(rows[table].length).toBeGreaterThan(0);
    const expected = [...localColumnsOf(table)].sort();
    for (const row of rows[table]) {
      expect(Object.keys(row).sort()).toEqual(expected);
      for (const forbidden of [
        "storage_path",
        "organization_id",
        "created_by",
        "updated_by",
        "deleted_by",
        "row_version",
      ]) {
        expect(row).not.toHaveProperty(forbidden);
      }
    }
    expect(JSON.stringify(rows)).not.toContain("oppdiktet/sti");
  });

  it("radene har samme form som normalizeShapeRow gir", async () => {
    const { actor, organizationId } = await setupOrganization();
    await seedFormWithRows(actor, organizationId);
    const { rows } = await fetchAll(actor, organizationId, null);
    for (const table of TABLES) {
      for (const row of rows[table]) {
        expect(normalizeLocalRow(table, row), table).toEqual(row);
        for (const column of ["created_at", "updated_at"]) {
          expect(String(row[column]), `${table}.${column}`).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
          );
        }
      }
    }
    const answer = rows.trial_answers[0]!;
    expect(typeof answer.value).toBe("string");
    expect(JSON.parse(String(answer.value))).toBe(2);
    const photo = rows.trial_photos[0]!;
    expect(photo.size_bytes).toBe(120);
    expect(typeof photo.size_bytes).toBe("number");
  });

  // Obligatorisk
  it("myk slettede rader kommer med deleted_at", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { formId, answerId } = await seedFormWithRows(actor, organizationId);
    const first = await fetchAll(actor, organizationId, null);

    await db.execute(sql`
      update trial_forms set deleted_at = now(), updated_at = now() where id = ${formId}::uuid
    `);
    await db.execute(sql`
      update trial_answers set deleted_at = now(), updated_at = now() where id = ${answerId}::uuid
    `);

    const next = await fetchAll(actor, organizationId, first.markor);
    const form = next.rows.trial_forms.find((row) => row.id === formId);
    const answer = next.rows.trial_answers.find((row) => row.id === answerId);
    expect(form?.deleted_at, "skjemaet").toBeTruthy();
    expect(answer?.deleted_at, "svaret").toBeTruthy();

    // Serveren beholder radene (regel 3)
    expect(await db.select().from(trialForms).where(eq(trialForms.id, formId))).toHaveLength(1);
    expect(await db.select().from(trialAnswers).where(eq(trialAnswers.id, answerId))).toHaveLength(
      1,
    );
  });
});

describe("listTrialChangesSince: forfalsket markør (aldri 500)", () => {
  const validU = "2026-10-29 10:00:00.123456+00";
  const nil = "00000000-0000-0000-0000-000000000000";
  const position = { u: validU, id: nil };

  // Obligatorisk
  it.each<[string, string]>([
    ["søppel", "søppel"],
    ["feil base64url", "!!!"],
    ["ikke json", encode("ikke json")],
    ["v: 2", encode({ v: 2, t: { trial_forms: position } })],
    ["mangler t", encode({ v: 1 })],
    [
      "ugyldig tid",
      encode({
        v: 1,
        t: {
          trial_forms: { u: "i går", id: "x" },
          trial_answers: position,
          trial_photos: position,
        },
      }),
    ],
    [
      "id som ikke er uuid",
      encode({
        v: 1,
        t: {
          trial_forms: { u: validU, id: "ikke-en-uuid" },
          trial_answers: position,
          trial_photos: position,
        },
      }),
    ],
    ["10 000 tegn", "a".repeat(10_000)],
  ])("ugyldig markør gir InvalidTrialCursorError (%s)", async (_name, cursor) => {
    const { actor, organizationId } = await setupOrganization();
    await putTrialForm(actor, organizationId);
    await expect(listTrialChangesSince(actor, organizationId, cursor)).rejects.toBeInstanceOf(
      InvalidTrialCursorError,
    );
  });

  it("markør med fremtidig tid eller fremmed id gir bare egne rader", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const seededA = await seedFormWithRows(a.actor, a.organizationId);
    const seededB = await seedFormWithRows(b.actor, b.organizationId);
    const real = decode((await fetchAll(a.actor, a.organizationId, null)).markor) as DecodedCursor;
    const realU = real.t.trial_forms!.u;

    // Fremtidig tid: ingen rader, ingen feil
    const futureU = realU.replace(/^\d{4}/, "2100");
    const future = await listTrialChangesSince(
      a.actor,
      a.organizationId,
      encode({
        v: 1,
        t: Object.fromEntries(TABLES.map((table) => [table, { u: futureU, id: nil }])),
      }),
    );
    expect(future.endringer).toEqual({ trial_forms: [], trial_answers: [], trial_photos: [] });

    // Fremmed id i markøren: bare egne rader
    const pastU = realU.replace(/^\d{4}/, "2000");
    const foreign = await fetchAll(
      a.actor,
      a.organizationId,
      encode({
        v: 1,
        t: {
          trial_forms: { u: pastU, id: seededB.formId },
          trial_answers: { u: pastU, id: seededB.answerId },
          trial_photos: { u: pastU, id: seededB.photoId },
        },
      }),
    );
    const ids = allIds(foreign.rows);
    for (const id of Object.values(seededB)) expect(ids.has(id), `B-rad ${id}`).toBe(false);
    for (const id of Object.values(seededA)) expect(ids.has(id), `A-rad ${id}`).toBe(true);
  });
});
