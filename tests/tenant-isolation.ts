import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { createEmployee, createOrganization, createUser } from "./factories";

/** Kastes når en spørring lekker data mellom organisasjoner, eller ikke nekter fremmed id. */
export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

export type TenantIsolationOptions<Row> = {
  /** Legger rader i begge organisasjonene og returnerer id-ene per organisasjon. */
  seed: (grantA: EmployeeGrant, grantB: EmployeeGrant) => Promise<{ a: string[]; b: string[] }>;
  /** Spørringen som skal bevises. Tar innlogget bruker og organisasjons-id. */
  query: (actor: Actor, organizationId: string) => Promise<Row[]>;
  /** Id-en til en rad, slik at radene kan sammenlignes med det `seed` la inn. */
  idOf: (row: Row) => string;
};

/**
 * Viser at en spørring aldri gir data fra en annen organisasjon:
 * 1. bruker i A mot A får alle A-rader (minst én) og ingen B-rader,
 * 2. bruker i B mot B får det samme speilvendt,
 * 3. bruker i A mot B sin id får `AccessDeniedError`,
 * 4. bruker i B mot A sin id får `AccessDeniedError`.
 * Admin brukes i begge, så isolasjonen må holde selv for admin. Kall `resetDatabase` i `beforeEach`.
 */
export async function expectTenantIsolation<Row>(options: TenantIsolationOptions<Row>) {
  const { seed, query, idOf } = options;
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const adminA = await createUser({ name: "Admin A" });
  const adminB = await createUser({ name: "Admin B" });
  await createEmployee(adminA, orgA.id, ["admin"]);
  await createEmployee(adminB, orgB.id, ["admin"]);
  const grantA = await requireOrganizationAccess(adminA, orgA.id);
  const grantB = await requireOrganizationAccess(adminB, orgB.id);

  const seeded = await seed(grantA, grantB);
  if (seeded.a.length === 0 || seeded.b.length === 0) {
    throw new TenantIsolationError(
      "seed må legge inn minst én rad i både organisasjon A og organisasjon B",
    );
  }

  const sides = [
    { name: "A", actor: adminA, organizationId: orgA.id, own: seeded.a, foreign: seeded.b },
    { name: "B", actor: adminB, organizationId: orgB.id, own: seeded.b, foreign: seeded.a },
  ] as const;

  for (const side of sides) {
    const other = side.name === "A" ? "B" : "A";
    const ids = new Set((await query(side.actor, side.organizationId)).map(idOf));
    for (const id of side.foreign) {
      if (ids.has(id)) {
        throw new TenantIsolationError(
          `Lekkasje: bruker i organisasjon ${side.name} fikk rad ${id} fra organisasjon ${other}`,
        );
      }
    }
    for (const id of side.own) {
      if (!ids.has(id)) {
        throw new TenantIsolationError(
          `Mangler egne rader: bruker i organisasjon ${side.name} fikk ikke rad ${id} fra egen organisasjon`,
        );
      }
    }
  }

  for (const side of sides) {
    const other = side.name === "A" ? "B" : "A";
    const foreignOrganizationId = side.name === "A" ? orgB.id : orgA.id;
    let denied = false;
    try {
      await query(side.actor, foreignOrganizationId);
    } catch (error) {
      if (error instanceof AccessDeniedError) denied = true;
      else throw error;
    }
    if (!denied) {
      throw new TenantIsolationError(
        `Ikke nektet: bruker i organisasjon ${side.name} ble ikke avvist med AccessDeniedError mot organisasjon ${other} sin id`,
      );
    }
  }
}
