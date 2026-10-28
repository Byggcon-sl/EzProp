import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { trialAnswers, trialForms } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { createOrganization, resetDatabase } from "../../tests/factories";

// Migreringen 0001_prove-uten-nett og publikasjonen for synktjenesten
// (docs/funksjoner/fase1-kandidat-powersync.md pkt. 10). Testplan avsnitt 3.5.
// Migreringen 0002_electric-utsnitt (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 11,
// avgjørelse C): replikaidentitet og Electrics publikasjon.

beforeEach(resetDatabase);

const BASE_COLUMNS = [
  "id",
  "organization_id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "deleted_at",
  "deleted_by",
  "row_version",
];

async function columnsOf(table: string): Promise<string[]> {
  const rows = await db.execute<{ column_name: string }>(
    sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`,
  );
  return Array.from(rows).map((row) => row.column_name);
}

describe("migreringen for prøven uten nett", () => {
  it("migreringen lager trial_forms, trial_answers og trial_photos med baseColumns", async () => {
    for (const table of ["trial_forms", "trial_answers", "trial_photos"]) {
      const columns = await columnsOf(table);
      expect(columns.length, table).toBeGreaterThan(0);
      for (const column of BASE_COLUMNS) expect(columns, `${table}.${column}`).toContain(column);
    }
  });

  it("trial_answers er unik på (trial_form_id, field_key)", async () => {
    const org = await createOrganization("Oppdiktet takst AS");
    const formId = uuidv7();
    await db
      .insert(trialForms)
      .values({ id: formId, organizationId: org.id, name: "Testskjema 1" });
    const row = {
      organizationId: org.id,
      trialFormId: formId,
      fieldKey: "floors",
      value: 2,
      deviceId: "enhet-1",
    };
    await db.insert(trialAnswers).values({ ...row, id: uuidv7() });
    await expect(
      db.insert(trialAnswers).values({ ...row, id: uuidv7(), value: 3 }),
    ).rejects.toThrow();
  });

  it("publikasjonen powersync har nøyaktig trial_forms, trial_answers og trial_photos", async () => {
    const rows = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_publication_tables where pubname = 'powersync'`,
    );
    const tables = Array.from(rows)
      .map((row) => row.tablename)
      .sort();
    expect(tables).toEqual(["trial_answers", "trial_forms", "trial_photos"]);
    for (const secret of ["users", "sessions", "verifications", "accounts"]) {
      expect(tables).not.toContain(secret);
    }
  });

  it("publikasjonen er ikke FOR ALL TABLES", async () => {
    const rows = Array.from(
      await db.execute<{ puballtables: boolean }>(
        sql`select puballtables from pg_publication where pubname = 'powersync'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.puballtables).toBe(false);
  });

  it("migreringen 0002 gir REPLICA IDENTITY FULL på de tre trial-tabellene", async () => {
    const rows = await db.execute<{ relname: string; relreplident: string }>(
      sql`select relname, relreplident from pg_class
          where relname in ('trial_forms', 'trial_answers', 'trial_photos') and relkind = 'r'`,
    );
    const identities = Object.fromEntries(
      Array.from(rows).map((row) => [row.relname, row.relreplident]),
    );
    expect(identities).toEqual({ trial_forms: "f", trial_answers: "f", trial_photos: "f" });
  });

  it("publikasjonen electric_publication_default har nøyaktig de tre trial-tabellene, ikke FOR ALL TABLES", async () => {
    const tables = Array.from(
      await db.execute<{ tablename: string }>(
        sql`select tablename from pg_publication_tables where pubname = 'electric_publication_default'`,
      ),
    )
      .map((row) => row.tablename)
      .sort();
    expect(tables).toEqual(["trial_answers", "trial_forms", "trial_photos"]);
    const publication = Array.from(
      await db.execute<{ puballtables: boolean }>(
        sql`select puballtables from pg_publication where pubname = 'electric_publication_default'`,
      ),
    );
    expect(publication).toHaveLength(1);
    expect(publication[0]!.puballtables).toBe(false);
  });
});
