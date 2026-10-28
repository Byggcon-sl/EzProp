import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { organizations, users } from "@/db/schema";
import { resetDatabase } from "../../../tests/factories";
import { runSeed } from "./run";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

describe("seed", () => {
  it("lager Byggcon og admin, og kan kjøres to ganger uten duplikater", async () => {
    const env = { SEED_ADMIN_EMAIL: "Admin@Example.com", SEED_ADMIN_NAME: "Test Admin" };
    await runSeed(env);
    await runSeed(env);
    const orgs = await db.select().from(organizations);
    const people = await db.select().from(users);
    expect(orgs).toHaveLength(1);
    expect(people).toHaveLength(1);
    const admin = people[0]!;
    const grant = await requireOrganizationAccess(
      { id: admin.id, email: admin.email, name: admin.name },
      orgs[0]!.id,
      "organization.manage",
    );
    expect(grant.roles).toEqual(["admin"]);
  });

  it("skriver aldri e-postadressen i loggen", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const env = { SEED_ADMIN_EMAIL: "Admin@Example.com", SEED_ADMIN_NAME: "Test Admin" };
    await runSeed(env);
    const firstRun = log.mock.calls.map((args) => args.map(String).join(" "));
    log.mockClear();
    await runSeed(env);
    const secondRun = log.mock.calls.map((args) => args.map(String).join(" "));
    for (const line of [...firstRun, ...secondRun]) expect(line).not.toContain("@");
    expect(firstRun.some((line) => line.includes("opprettet"))).toBe(true);
    expect(secondRun.some((line) => line.includes("finnes fra før"))).toBe(true);
  });
});
