import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { fakeAiProvider, recordDecision, requestSuggestion } from "@/core/ai";
import { db } from "@/db/client";
import { brand } from "@/shared/config/brand";
import { TEST_NOW, resetDatabase } from "../../../tests/factories";
import { polishRequest, usageRow } from "../../../tests/ai";
import { runSeed } from "./run";
import { runSampleSeed } from "./sample-assignments";
import { SAMPLE_INSPECTOR } from "./sample-assignments.data";

/*
 * Helhetstest for KI i prøveorganisasjonen etter seed (testplan
 * docs/funksjoner/fase2a-ki-modul-logg-testplan.md 13.8). De andre seed-sakene (13.1–13.7) står i
 * sample-assignments.test.ts og run.test.ts. Alle data er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (KI kan prøves i testmiljøet uten kostnad rett etter
 * `pnpm db:seed:testoppdrag`) og KI i bunnen (seed gir samme vei som i drift: tilkobling og
 * innstilling, ikke miljøvariabler).
 */

const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };

async function actorByEmail(email: string): Promise<Actor> {
  const rows = (await db.execute(
    sql`select id, name, email from users where email = ${email.toLowerCase()}`,
  )) as unknown as Actor[];
  if (!rows[0]) throw new Error("Fant ikke brukeren");
  return rows[0];
}

async function organizationId(name: string): Promise<string> {
  const rows = (await db.execute(
    sql`select id from organizations where name = ${name}`,
  )) as unknown as { id: string }[];
  expect(rows).toHaveLength(1);
  return rows[0]!.id;
}

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(fakeAiProvider, "complete");
});
afterEach(() => vi.restoreAllMocks());

describe("seed: KI i prøveorganisasjonen (13.8)", () => {
  it("13.8 etter seed gir requestSuggestion for prøvetakstmannen et forslag mot fake", async () => {
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    const sampleId = await organizationId(`${brand.companyName} prøve`);
    const inspector = await actorByEmail(SAMPLE_INSPECTOR.email);
    const grant = await requireOrganizationAccess(inspector, sampleId, "report.edit");
    const request = polishRequest();

    const result = await requestSuggestion(grant, request);

    expect(result.kind).toBe("suggestion");
    expect(fakeAiProvider.complete).toHaveBeenCalledTimes(1);
    const row = (await usageRow(request.requestId))!;
    expect(row.organizationId).toBe(sampleId);
    expect(row.provider).toBe("fake");
    expect(Number(row.cost)).toBe(0);

    await recordDecision(grant, request.requestId, "accepted");
    expect((await usageRow(request.requestId))!.status).toBe("accepted");
  });

  it("13.8 admin i Byggcon får disabled etter seed (KI er ikke slått på der)", async () => {
    await runSeed(env);
    await runSampleSeed(env, TEST_NOW);
    const byggconId = await organizationId(brand.companyName);
    const admin = await actorByEmail(env.SEED_ADMIN_EMAIL);
    const grant = await requireOrganizationAccess(admin, byggconId, "report.edit");

    expect(await requestSuggestion(grant, polishRequest())).toEqual({ kind: "disabled" });
    expect(fakeAiProvider.complete).not.toHaveBeenCalled();
  });
});
