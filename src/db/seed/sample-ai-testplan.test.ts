import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { ensureSampleAi } from "./sample-assignments";

/*
 * `ensureSampleAi` kalt direkte (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 9 og
 * 5.5, kortet Omfang 7). Funksjonen skal selv sjekke `settings.sampleData = true` i samme spørring
 * som skriver, og ikke stole på at den som kaller har sjekket det. Mot testdatabasen. Alle navn er
 * oppdiktet. 9.5 (Byggcon urørt av `pnpm db:seed`) står uendret i sample-assignments.test.ts.
 *
 * Støtter hovedmål: KI i bunnen (prøveorganisasjonen får KI med den falske leverandøren) og færre
 * reklamasjoner (KI slås aldri på i en ekte organisasjon ved en feil).
 */

beforeEach(resetDatabase);

type Settings = Record<string, unknown> | "none";

/** Organisasjon med innstillingene, admin, kontor og takstmann, og konteksten seed-steget lager. */
async function contextFor(settings: Settings) {
  const organization = await createOrganization("Oppdiktet Prøvetakst");
  if (settings !== "none") {
    await db.execute(
      sql`update organizations set settings = ${JSON.stringify(settings)}::jsonb where id = ${organization.id}`,
    );
  } else {
    await db.execute(
      sql`update organizations set settings = '{}'::jsonb where id = ${organization.id}`,
    );
  }
  const admin = await createUser({ name: "Test Admin Prøve" });
  await createEmployee(admin, organization.id, ["admin"]);
  const inspector = await createEmployee(
    await createUser({ name: "Test Takstmann Prøve" }),
    organization.id,
    ["inspector"],
  );
  const office = await createOffice(organization.id);
  return {
    organizationId: organization.id,
    context: {
      actor: admin,
      organizationId: organization.id,
      officeId: office.id,
      inspectorEmployeeId: inspector.id,
      now: TEST_NOW,
    },
  };
}

async function organizationRow(id: string) {
  const [row] = (await db.execute(
    sql`select settings, updated_at from organizations where id = ${id}`,
  )) as unknown as { settings: Record<string, unknown>; updated_at: unknown }[];
  return row!;
}

async function aiConnections(organizationId: string) {
  return (await db.execute(
    sql`select * from integration_connections where organization_id = ${organizationId} and port = 'ai' order by created_at`,
  )) as unknown as Record<string, unknown>[];
}

describe("ensureSampleAi kalt direkte (9)", () => {
  it.each<{ name: string; settings: Settings }>([
    { name: "nøkkelen sampleData mangler", settings: "none" },
    { name: "sampleData = false", settings: { sampleData: false } },
    { name: 'sampleData = "true" (tekst)', settings: { sampleData: "true" } },
    { name: "sampleData = 1", settings: { sampleData: 1 } },
  ])(
    "9.1 $name: settings og updated_at uendret, ingen tilkobling på porten ai",
    async ({ settings }) => {
      const { organizationId, context } = await contextFor(settings);
      const before = await organizationRow(organizationId);

      await ensureSampleAi(context);

      const after = await organizationRow(organizationId);
      expect(after.settings).toEqual(before.settings);
      expect(after.updated_at).toEqual(before.updated_at);
      expect(after.settings["ai.enabled"]).toBeUndefined();
      expect(await aiConnections(organizationId)).toHaveLength(0);
    },
  );

  it("9.2 prøveorganisasjonen: ai.enabled = true og én fake-tilkobling", async () => {
    const { organizationId, context } = await contextFor({ sampleData: true });

    await ensureSampleAi(context);

    const after = await organizationRow(organizationId);
    expect(after.settings["ai.enabled"]).toBe(true);
    expect(after.settings.sampleData).toBe(true);
    const connections = await aiConnections(organizationId);
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ provider: "fake", status: "active", deleted_at: null });
  });

  it("9.3 to kall gir samme resultat, og andre gang er svaret existing/existing", async () => {
    const { organizationId, context } = await contextFor({ sampleData: true });

    const first = await ensureSampleAi(context);
    const afterFirst = await organizationRow(organizationId);
    const connectionsFirst = await aiConnections(organizationId);
    const second = await ensureSampleAi(context);

    expect(first).toEqual({ setting: "created", connection: "created" });
    expect(second).toEqual({ setting: "existing", connection: "existing" });
    expect(await organizationRow(organizationId)).toEqual(afterFirst);
    const connectionsSecond = await aiConnections(organizationId);
    expect(connectionsSecond).toHaveLength(1);
    // Hele raden, også row_version og updated_at, er uendret
    expect(connectionsSecond).toEqual(connectionsFirst);
  });

  it("9.4 sampleData fjernes etter at konteksten er laget: kallet endrer ingenting og lager ingen tilkobling", async () => {
    const { organizationId, context } = await contextFor({ sampleData: true, annet: "verdi" });
    await db.execute(
      sql`update organizations set settings = settings - 'sampleData' where id = ${organizationId}`,
    );
    const before = await organizationRow(organizationId);

    await ensureSampleAi(context);

    expect(await organizationRow(organizationId)).toEqual(before);
    expect(await aiConnections(organizationId)).toHaveLength(0);
  });

  it("5.5 rører bare organisasjonen med sampleData: en annen organisasjon er uendret", async () => {
    const sample = await contextFor({ sampleData: true });
    const other = await contextFor({ annet: "verdi" });
    const otherBefore = await organizationRow(other.organizationId);

    await ensureSampleAi(sample.context);
    await ensureSampleAi(other.context);

    expect(await organizationRow(other.organizationId)).toEqual(otherBefore);
    expect(await aiConnections(other.organizationId)).toHaveLength(0);
    expect(await aiConnections(sample.organizationId)).toHaveLength(1);
  });
});
