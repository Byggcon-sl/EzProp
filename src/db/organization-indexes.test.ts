import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";

// Nattløkken 12.11.2026 (alvorlig punkt 1): oppslag fra oppdraget til ordren tok over 30 sekunder
// ved 20 000 oppdrag uten indeks. Hver tabell med `organization_id` skal ha minst én indeks som
// starter med kolonnen, fordi alle spørringer filtrerer på organisasjonen først.

describe("indekser på organization_id", () => {
  it("hver tabell med organization_id har en indeks som starter med kolonnen", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id'
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not exists (
          select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum
        )
      order by 1
    `);
    expect(rows.map((row) => row.table_name)).toEqual([]);
  });

  it("ordren kan slås opp fra oppdraget med indeks", async () => {
    const rows = await db.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes
      where tablename = 'orders' and indexname = 'orders_organization_id_assignment_id_idx'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("(organization_id, assignment_id)");
  });
});
