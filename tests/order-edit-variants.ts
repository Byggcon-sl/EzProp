import type { Actor } from "@/core/access";
import type { EmployeeRole } from "@/db/schema";
import { createUser, grantPermission } from "./factories";
import { person, setEmployee, setInspectorsEditAll } from "./order-edit";

/*
 * Rettighetsmatrisen for «Endre ordren» (docs/funksjoner/fase2a-rette-ordre-testplan.md avsnitt 6).
 * Brukes både mot tjenesten (src/core/orders/update-order-access.test.ts) og mot `canEditOrders`
 * i sidekonteksten (src/app/(ansatt)/ordre/can-edit-orders.test.ts), slik at begge prøver samme
 * tabell. Fasiten (`read`, `edit`) står her, ikke i koden.
 */

export type AccessVariant = {
  name: string;
  read: boolean;
  edit: boolean;
  /** Lager personen i organisasjonen og gir innloggingen. */
  setup: (organizationId: string) => Promise<Actor>;
};

function withRoles(roles: EmployeeRole[], editAll: boolean) {
  return async (organizationId: string) => {
    await setInspectorsEditAll(organizationId, editAll);
    return (await person(organizationId, roles)).actor;
  };
}

export const ACCESS_VARIANTS: AccessVariant[] = [
  {
    name: "takstmann, access.inspectors_edit_all på",
    read: true,
    edit: true,
    setup: withRoles(["inspector"], true),
  },
  {
    name: "takstmann, innstillingen av",
    read: true,
    edit: false,
    setup: withRoles(["inspector"], false),
  },
  { name: "kontor", read: true, edit: true, setup: withRoles(["office"], false) },
  { name: "leder", read: true, edit: true, setup: withRoles(["manager"], false) },
  { name: "admin, innstillingen av", read: true, edit: true, setup: withRoles(["admin"], false) },
  {
    name: "bruker uten ansattrad",
    read: false,
    edit: false,
    setup: async () => createUser(),
  },
  {
    name: "deaktivert ansatt (admin)",
    read: false,
    edit: false,
    setup: async (organizationId) => {
      const { actor, employee } = await person(organizationId, ["admin"]);
      await setEmployee(employee.id, { deactivatedAt: new Date("2026-11-01T08:00:00Z") });
      return actor;
    },
  },
  {
    name: "myk-slettet ansatt (admin)",
    read: false,
    edit: false,
    setup: async (organizationId) => {
      const { actor, employee } = await person(organizationId, ["admin"]);
      await setEmployee(employee.id, { deletedAt: new Date("2026-11-01T08:00:00Z") });
      return actor;
    },
  },
  {
    name: "takstmann, innstillingen av, med enkeltrettigheten assignment.edit",
    read: true,
    edit: true,
    setup: async (organizationId) => {
      await setInspectorsEditAll(organizationId, false);
      const { actor, employee } = await person(organizationId, ["inspector"]);
      await grantPermission(employee, "assignment.edit");
      return actor;
    },
  },
];
