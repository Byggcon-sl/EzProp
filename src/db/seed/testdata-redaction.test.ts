import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { emptyKnownValues } from "@/core/ai/redaction";
import { db } from "@/db/client";
import { brand } from "@/shared/config/brand";
import { fakeAiProvider } from "../../../tests/ai";
import { TEST_NOW, resetDatabase } from "../../../tests/factories";
import { loadKnownValues, redactText } from "../../../tests/redaction";
import { runSeed } from "./run";
import { seedTestdata } from "./testdata";
import { TESTDATA_SEED } from "./testdata.data";
import { buildTestdataPlan } from "./testdata-plan";

/*
 * Vasken før KI på testdataene. Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 4.9 (44–45).
 *
 * Et TD-oppdrag med selger, kjøper, megler og matrikkel hentes fra testdatabasen, vaskekonteksten
 * lages med `loadKnownValues` som i dag, og `redactText` kjøres på en tekst med partens navn,
 * e-post, telefon, gateadresse og matrikkel. Ingen KI-kall. Alle data er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (navn, e-post, telefon, adresse og matrikkel sendes aldri til KI,
 * regel 14, også når dataene ligner ekte).
 */

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const env = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
const plan = buildTestdataPlan({ seed: TESTDATA_SEED, anchor: TEST_NOW });

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Et TD-oppdrag i planen med selger, kjøper og megler (bestiller i kontaktregisteret). */
function targetOrder() {
  const order = plan.orders.find(
    (o) =>
      o.converted !== false &&
      o.orderedByContactKey !== null &&
      ["seller", "buyer"].every(
        (role) =>
          o.converted !== false && o.converted.assignment.parties.some((p) => p.role === role),
      ),
  );
  if (!order || order.converted === false) {
    throw new Error("Planen har ikke et oppdrag med selger, kjøper og megler");
  }
  return { order, assignment: order.converted.assignment };
}

async function setup() {
  await runSeed(env);
  const [org] = await rows<{ id: string }>(
    sql`select id from organizations where name = ${brand.companyName}`,
  );
  const aiRowsBefore = (
    await rows<{ n: number }>(sql`select count(*)::int as n from ai_usage_log`)
  )[0]!.n;
  await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
  const { order, assignment } = targetOrder();
  const [row] = await rows<{ assignment_id: string }>(sql`
    select assignment_id from orders where organization_id = ${org!.id} and external_ref = ${order.externalRef}`);
  const [admin] = await rows<Actor>(
    sql`select id, name, email from users where email = ${env.SEED_ADMIN_EMAIL}`,
  );
  const grant = await requireOrganizationAccess(admin!, org!.id, "organization.read");
  return {
    orgId: org!.id,
    assignmentId: row!.assignment_id,
    order,
    assignment,
    grant,
    aiRowsBefore,
  };
}

describe("testdata: vasken før KI (4.9)", () => {
  it("4.9.44 navn, e-post, telefon, gateadresse og matrikkel i en tekst om et TD-oppdrag byttes ut", async () => {
    const { assignmentId, assignment, grant } = await setup();
    const seller = assignment.parties.find((p) => p.role === "seller")!;
    const buyer = assignment.parties.find((p) => p.role === "buyer")!;
    const broker = assignment.parties.find((p) => p.contactKey !== null) ?? null;
    const property = assignment.property;
    const street = property.address;
    const text = [
      `Selger ${seller.name} viste rundt, og kjøper ${buyer.name} var til stede.`,
      `Ring ${seller.phone} eller skriv til ${seller.email}.`,
      broker ? `Megler ${broker.name} (${broker.email}, ${broker.phone}) hadde nøkler.` : "",
      `Befaringen gjaldt ${street}, ${property.postalCode} ${property.city}.`,
      `Matrikkel gnr ${property.gnr}/${property.bnr} og gnr 9012/34.`,
      "Fukt målt i vegg bak dusj.",
    ].join(" ");
    const known = await loadKnownValues(grant, assignmentId);
    const result = redactText(text, known);

    const secrets = [
      seller.name,
      buyer.name,
      ...seller.name.split(" "),
      ...buyer.name.split(" "),
      seller.email,
      seller.phone,
      seller.phone.replace(/\s/g, ""),
      street,
      `${property.gnr}/${property.bnr}`,
      "9012/34",
      ...(broker ? [broker.name, broker.email, broker.phone, ...broker.name.split(" ")] : []),
    ];
    for (const secret of secrets) {
      expect(result.text, `«${secret}» står igjen`).not.toContain(secret);
    }
    expect(result.text).toMatch(/\[[a-zæøå_ -]+\]/i);
    expect(result.count).toBeGreaterThan(0);
    // Fagteksten står igjen
    expect(result.text).toContain("Fukt målt i vegg bak dusj.");
  });

  it("4.9.44 telefonnummeret +47 000 NN NNN vaskes også av mønsteret alene (uten kjente verdier)", async () => {
    const { assignment } = await setup();
    const seller = assignment.parties.find((p) => p.role === "seller")!;
    const result = redactText(`Ring ${seller.phone} i morgen.`, emptyKnownValues());
    expect(result.text).not.toContain(seller.phone);
    expect(result.text).not.toMatch(/000 \d{2} \d{3}/);
  });

  it("4.9.45 ingen KI-kall og ingen nye rader i ai_usage_log", async () => {
    const complete = vi.spyOn(fakeAiProvider, "complete");
    const { assignmentId, assignment, grant, aiRowsBefore } = await setup();
    const seller = assignment.parties.find((p) => p.role === "seller")!;
    const known = await loadKnownValues(grant, assignmentId);
    redactText(`Selger ${seller.name}`, known);
    expect(complete).not.toHaveBeenCalled();
    const [after] = await rows<{ n: number }>(sql`select count(*)::int as n from ai_usage_log`);
    expect(after!.n).toBe(aiRowsBefore);
  });
});
