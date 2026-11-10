import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { MIGRATIONS_FOLDER, runMigrations } from "@/db/run-migrations";
import { trialAnswers, trialForms } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { createOrganization, resetDatabase } from "../../tests/factories";

// Migreringen 0001_prove-uten-nett (docs/funksjoner/fase1-kandidat-powersync.md pkt. 10).
// Testplan avsnitt 3.5. Publikasjonene og REPLICA IDENTITY FULL fra 0001 og 0002 er fjernet igjen
// av 0026_fjern-synkpublikasjoner, fordi PowerSync og ElectricSQL er tatt ut (ADR 0004).

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

  it("ingen publikasjoner finnes (PowerSync og ElectricSQL er fjernet)", async () => {
    const rows = Array.from(
      await db.execute<{ pubname: string }>(sql`select pubname from pg_publication`),
    ).map((row) => row.pubname);
    expect(rows).toEqual([]);
  });

  it("ingen tabeller har REPLICA IDENTITY FULL", async () => {
    const rows = Array.from(
      await db.execute<{ relname: string; relreplident: string }>(
        sql`select c.relname, c.relreplident from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'`,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    const changed = rows.filter((row) => row.relreplident !== "d").map((row) => row.relname);
    expect(changed).toEqual([]);
  });

  // Migreringen 0002 er ikke idempotent (CREATE PUBLICATION uten IF NOT EXISTS). Testen viser derfor
  // at Drizzle-journalen hindrer dobbeltkjøring: en ny kjøring gir ingen feil, og 0002 står én gang.
  it("migreringen kjører to ganger uten feil", async () => {
    const url = process.env.TEST_DATABASE_URL;
    expect(url, "TEST_DATABASE_URL").toBeTruthy();
    await expect(runMigrations(url!)).resolves.toBeUndefined();

    const file = readdirSync(MIGRATIONS_FOLDER).find((name) => /^0002_.*\.sql$/.test(name));
    expect(file, "0002_*.sql").toBeDefined();
    const hash = createHash("sha256")
      .update(readFileSync(path.join(MIGRATIONS_FOLDER, file!), "utf8"))
      .digest("hex");
    const rows = Array.from(
      await db.execute<{ hash: string }>(sql`select hash from drizzle.__drizzle_migrations`),
    );
    expect(rows.filter((row) => row.hash === hash)).toHaveLength(1);
    const sqlFiles = readdirSync(MIGRATIONS_FOLDER).filter((name) => name.endsWith(".sql"));
    expect(rows).toHaveLength(sqlFiles.length);

    // Replikaidentiteten er uendret etter andre kjøring, og ingen publikasjon er kommet tilbake
    const identities = Array.from(
      await db.execute<{ relreplident: string }>(
        sql`select relreplident from pg_class
            where relname in ('trial_forms', 'trial_answers', 'trial_photos') and relkind = 'r'`,
      ),
    ).map((row) => row.relreplident);
    expect(identities).toEqual(["d", "d", "d"]);
    const publications = Array.from(
      await db.execute<{ pubname: string }>(sql`select pubname from pg_publication`),
    );
    expect(publications).toEqual([]);
  });
});
