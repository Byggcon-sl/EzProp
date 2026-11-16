import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  createCompany,
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { createAssignment as createAssignmentService } from "./index";

/*
 * «Nytt oppdrag» er én transaksjon (testplan for «Nytt oppdrag» 4.3). En midlertidig trigger
 * stopper ett steg; da skal ingenting være lagret og nummerserien være uendret. Triggeren fjernes
 * alltid i `finally`. Oppdiktede data.
 *
 * Støtter hovedmål: færre reklamasjoner (aldri et halvt oppdrag uten ansvarlig eller uten spor
 * i loggen) og de ansatte (nummeret brukes ikke når lagringen feiler).
 */

beforeEach(resetDatabase);

async function counts() {
  const [row] = (await db.execute(sql`
    select
      (select count(*)::int from assignments) as assignments,
      (select count(*)::int from assignment_team_members) as team,
      (select count(*)::int from events) as events,
      (select count(*)::int from audit_log) as audit,
      (select coalesce(sum(next_value), 0)::int from number_sequences) as sequence`)) as unknown as Record<
    string,
    number
  >[];
  return row!;
}

/** Midlertidig trigger som kaster ved innsetting i tabellen (eventuelt bare når `when` er sann). */
async function withFailingInsert<T>(table: string, when: string, run: () => Promise<T>) {
  const name = `test_fail_${table}_tx`;
  await db.execute(
    sql.raw(`create or replace function ${name}() returns trigger language plpgsql as $$
      begin
        if ${when} then raise exception 'oppdiktet feil i testen'; end if;
        return new;
      end $$`),
  );
  await db.execute(
    sql.raw(
      `create trigger ${name} before insert on ${table} for each row execute function ${name}()`,
    ),
  );
  try {
    return await run();
  } finally {
    await db.execute(sql.raw(`drop trigger if exists ${name} on ${table}`));
    await db.execute(sql.raw(`drop function if exists ${name}()`));
  }
}

async function setup() {
  const org = await createOrganization("Oppdiktet Takst A");
  const company = await createCompany(org.id);
  const office = await createOffice(org.id);
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const inspector = await createEmployee(await createUser(), org.id, ["inspector"], {
    companyId: company.id,
  });
  return {
    run: () =>
      createAssignmentService(admin, org.id, {
        addressText: "Testveien 12, 8000 Bodø",
        officeId: office.id,
        responsibleEmployeeId: inspector.id,
      }),
  };
}

describe("4.3 én transaksjon", () => {
  it.each([
    ["4.3.1 hendelsen", "events", "new.type = 'assignment.created'"],
    ["4.3.2 revisjonsloggen", "audit_log", "new.entity_type = 'assignment'"],
    ["4.3.3 teammedlemmet", "assignment_team_members", "true"],
  ])("feiler %s, lagres ingenting og nummeret brukes ikke", async (_name, table, when) => {
    const { run } = await setup();
    // Én vellykket først, så nummerserien finnes og endringen i den kan sees
    await run();
    const before = await counts();

    const error = await withFailingInsert(table, when, () =>
      run().then(
        () => null,
        (caught: unknown) => caught,
      ),
    );

    expect(error).toBeInstanceOf(Error);
    expect(await counts()).toEqual(before);

    // Etterpå virker det igjen, med neste nummer (det feilede ble ikke brukt)
    const next = await run();
    expect(next.number).toBe("2026-00002");
  });
});
