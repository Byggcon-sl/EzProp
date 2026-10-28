import type { EmployeeRole } from "@/db/schema";

/**
 * Rettigheter (docs/05-domenemodell.md avsnitt 5). Rettighetene lagres som rettigheter, ikke
 * rollenavn i koden: en rolle er en fast samling rettigheter, og admin kan senere gi
 * enkeltrettigheter i tillegg (`employee_permissions`, fase 0b). Utvides fase for fase.
 */
export const permissions = [
  /** Se organisasjonen, oppdrag og data. Alle ansatte (27.10.2026: alle takstmenn ser alt). */
  "organization.read",
  /** Ansatte, roller, rettigheter, selskaper, kontorer og innstillinger. Bare admin. */
  "organization.manage",
  /** Se reklamasjonssaker. Bare leder og admin (unntak fra «alle ser alt», 27.10.2026). */
  "claims.read",
  /** Krav om sidemannskontroll, rutiner for alle, sperring av enheter. Leder og admin. */
  "staff.manage",
] as const;
export type Permission = (typeof permissions)[number];

const permissionsByRole: Record<EmployeeRole, readonly Permission[]> = {
  inspector: ["organization.read"],
  office: ["organization.read"],
  manager: ["organization.read", "claims.read", "staff.manage"],
  admin: [...permissions],
};

/** Innlogget bruker slik tilgangslaget ser den. Kommer fra sesjonen, ikke fra databasen. */
export type Actor = {
  id: string;
  email: string;
  name: string;
};

/** Den ansatte med rollene sine i én organisasjon (resultatet av tilgangssjekken). */
export type EmployeeGrant = {
  employeeId: string;
  organizationId: string;
  roles: readonly EmployeeRole[];
};

export function rolesHavePermission(roles: readonly EmployeeRole[], permission: Permission) {
  return roles.some((role) => permissionsByRole[role].includes(permission));
}

/** Admin stenges aldri ute (regel fra Optiplan, videreført i CLAUDE.md). */
export function isAdmin(grant: EmployeeGrant) {
  return grant.roles.includes("admin");
}
