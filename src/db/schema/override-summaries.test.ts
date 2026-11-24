import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { overrideSummaries } from "@/db/schema";
import {
  createAiUsageLog,
  createClaim,
  createEmployee,
  createOrganization,
  createOverrideSummaryRow,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Databasen selv holder månedsoppsummeringen og kontrollpunktet på reklamasjonen riktige
 * (migrering `0039_overstyringer-leder`, docs/funksjoner/fase2a-overstyringer-leder.md, A564 og
 * A567). Rå innsetting med radbyggerne, utenom kjernen og Zod. Feilkoden sjekkes, så en skrivefeil
 * gir ikke falsk grønn test.
 *
 * Støtter hovedmål: KI i bunnen (teksten som gjelder, peker alltid på forslaget den kom fra, i
 * samme organisasjon) og færre reklamasjoner (reklamasjonen kobles til punktet med en fast kode).
 * Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectPgError(action: () => Promise<unknown>, code: string) {
  let found: string | undefined = "ingen feil";
  try {
    await action();
  } catch (error) {
    found = pgCode(error);
  }
  expect(found).toBe(code);
}

type SummaryRow = Partial<typeof overrideSummaries.$inferInsert>;

const DECIDED_AT = new Date("2026-11-24T09:00:00Z");

/** Organisasjon med en leder og et KI-forslag som raden kan peke på. */
async function fixture(name = "Oppdiktet Takst A") {
  const org = await createOrganization(name);
  const employee = await createEmployee(await createUser(), org.id, ["manager"]);
  const usage = await createAiUsageLog(org.id, { employeeId: employee.id });
  return { org, employee, usage };
}

describe("CHECK-reglene i override_summaries", () => {
  type Ids = { employeeId: string; usageId: string };
  type Case = { name: string; row: (ids: Ids) => SummaryRow; ok: boolean };

  const accepted = ({ employeeId, usageId }: Ids): SummaryRow => ({
    status: "accepted",
    source: "ai",
    text: "Oppdiktet oppsummering.",
    aiUsageLogId: usageId,
    decidedBy: employeeId,
    decidedAt: DECIDED_AT,
  });
  const manual = ({ employeeId }: Ids): SummaryRow => ({
    status: "manual",
    source: "manual",
    text: "Oppdiktet tekst skrevet av leder.",
    decidedBy: employeeId,
    decidedAt: DECIDED_AT,
  });

  const CASES: Case[] = [
    { name: "tom rad", row: () => ({}), ok: true },
    { name: "godtatt forslag", row: accepted, ok: true },
    { name: "endret forslag", row: (ids) => ({ ...accepted(ids), status: "edited" }), ok: true },
    { name: "tekst skrevet av leder", row: manual, ok: true },
    {
      name: "avvist forslag uten tekst",
      row: (ids) => ({ ...accepted(ids), status: "rejected", text: null }),
      ok: true,
    },
    {
      name: "tekst på 2000 tegn",
      row: (ids) => ({ ...manual(ids), text: "a".repeat(2000) }),
      ok: true,
    },
    {
      name: "tekst på 2001 tegn",
      row: (ids) => ({ ...manual(ids), text: "a".repeat(2001) }),
      ok: false,
    },
    { name: "blank tekst", row: (ids) => ({ ...manual(ids), text: "   " }), ok: false },
    { name: "ukjent status", row: () => ({ status: "published" as never }), ok: false },
    {
      name: "ukjent kilde",
      row: (ids) => ({ ...manual(ids), source: "import" as never }),
      ok: false,
    },
    { name: "måned 13", row: () => ({ month: "2026-13" }), ok: false },
    { name: "måned med dag", row: () => ({ month: "2026-10-01" }), ok: false },
    { name: "måned uten null foran", row: () => ({ month: "2026-9" }), ok: false },
    { name: "tom rad med tekst", row: () => ({ text: "Oppdiktet." }), ok: false },
    { name: "godtatt uten tekst", row: (ids) => ({ ...accepted(ids), text: null }), ok: false },
    {
      name: "avvist med tekst",
      row: (ids) => ({ ...accepted(ids), status: "rejected" }),
      ok: false,
    },
    {
      name: "godtatt uten forslag",
      row: (ids) => ({ ...accepted(ids), aiUsageLogId: null }),
      ok: false,
    },
    {
      name: "godtatt med kilden manual",
      row: (ids) => ({ ...accepted(ids), source: "manual" }),
      ok: false,
    },
    { name: "godtatt uten kilde", row: (ids) => ({ ...accepted(ids), source: null }), ok: false },
    {
      name: "skrevet av leder med forslag",
      row: (ids) => ({ ...manual(ids), aiUsageLogId: ids.usageId }),
      ok: false,
    },
    {
      name: "skrevet av leder uten kilde",
      row: (ids) => ({ ...manual(ids), source: null }),
      ok: false,
    },
    {
      name: "tom rad med kilde",
      row: () => ({ source: "ai" }),
      ok: false,
    },
    {
      name: "tom rad med beslutning",
      row: ({ employeeId }) => ({ decidedBy: employeeId, decidedAt: DECIDED_AT }),
      ok: false,
    },
    {
      name: "godtatt uten hvem som avgjorde",
      row: (ids) => ({ ...accepted(ids), decidedBy: null }),
      ok: false,
    },
    {
      name: "godtatt uten tidspunkt",
      row: (ids) => ({ ...accepted(ids), decidedAt: null }),
      ok: false,
    },
  ];

  it.each(CASES)("$name", async ({ row, ok }) => {
    const { org, employee, usage } = await fixture();
    const insert = () =>
      createOverrideSummaryRow(org.id, row({ employeeId: employee.id, usageId: usage.id }));
    if (ok) {
      await expect(insert()).resolves.toMatchObject({ organizationId: org.id });
    } else {
      await expectPgError(insert, CHECK);
    }
  });
});

describe("nøkler og unik indeks i override_summaries", () => {
  it("én rad per organisasjon og måned, men en fjernet rad sperrer ikke", async () => {
    const { org } = await fixture();
    const first = await createOverrideSummaryRow(org.id);
    await expectPgError(() => createOverrideSummaryRow(org.id), UNIQUE);

    await db
      .update(overrideSummaries)
      .set({ deletedAt: new Date() })
      .where(eq(overrideSummaries.id, first.id));
    await expect(createOverrideSummaryRow(org.id)).resolves.toMatchObject({ month: "2026-10" });
  });

  it("samme måned i to organisasjoner går bra", async () => {
    const a = await fixture("Oppdiktet Takst A");
    const b = await fixture("Oppdiktet Takst B");
    await createOverrideSummaryRow(a.org.id);
    await expect(createOverrideSummaryRow(b.org.id)).resolves.toMatchObject({
      organizationId: b.org.id,
    });
  });

  it("forslaget må høre til samme organisasjon", async () => {
    const a = await fixture("Oppdiktet Takst A");
    const b = await fixture("Oppdiktet Takst B");
    await expectPgError(
      () =>
        createOverrideSummaryRow(a.org.id, {
          status: "accepted",
          source: "ai",
          text: "Oppdiktet oppsummering.",
          aiUsageLogId: b.usage.id,
          decidedBy: a.employee.id,
          decidedAt: DECIDED_AT,
        }),
      FOREIGN_KEY,
    );
  });

  it("den som avgjorde, må høre til samme organisasjon", async () => {
    const a = await fixture("Oppdiktet Takst A");
    const b = await fixture("Oppdiktet Takst B");
    await expectPgError(
      () =>
        createOverrideSummaryRow(a.org.id, {
          status: "manual",
          source: "manual",
          text: "Oppdiktet tekst.",
          decidedBy: b.employee.id,
          decidedAt: DECIDED_AT,
        }),
      FOREIGN_KEY,
    );
  });
});

describe("claims.checkpoint_key", () => {
  it.each([
    { name: "tomt felt", key: null, ok: true },
    { name: "enkel kode", key: "membrane", ok: true },
    { name: "kode med punktum", key: "wet_room.hole_drilling", ok: true },
    { name: "store bokstaver", key: "Wet_room.membrane", ok: false },
    { name: "mellomrom", key: "wet room", ok: false },
    { name: "tom tekst", key: "", ok: false },
    { name: "punktum til slutt", key: "wet_room.", ok: false },
    { name: "fritekst", key: "Bad 1. etg, sluk", ok: false },
  ])("$name", async ({ key, ok }) => {
    const org = await createOrganization("Oppdiktet Takst A");
    const insert = () => createClaim(org.id, { checkpointKey: key });
    if (ok) {
      await expect(insert()).resolves.toMatchObject({ checkpointKey: key });
    } else {
      await expectPgError(insert, CHECK);
    }
  });

  it("en sak som fantes før migreringen, har tomt kontrollpunkt", async () => {
    const org = await createOrganization("Oppdiktet Takst A");
    // Uten kolonnen i setningen, slik radene så ut før `0039`
    const assignmentId = (await createClaim(org.id)).assignmentId;
    await db.execute(sql`
      insert into claims (organization_id, assignment_id, claim_type, received_at, description,
        created_by)
      values (${org.id}, ${assignmentId}, 'complaint', '2026-11-02'::date, 'Oppdiktet sak',
        gen_random_uuid())`);
    const rows = await db.execute(
      sql`select checkpoint_key from claims where organization_id = ${org.id}`,
    );
    expect([...rows].map((row) => row.checkpoint_key)).toEqual([null, null]);
  });
});
