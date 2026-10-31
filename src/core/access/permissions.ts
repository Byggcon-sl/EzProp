import type { EmployeeRole } from "@/db/schema";
import { logger } from "@/shared/lib/logger";

/**
 * Rettigheter (docs/05-domenemodell.md avsnitt 5). Rettighetene lagres som rettigheter, ikke
 * rollenavn i koden: en rolle er en fast samling rettigheter, og admin kan gi enkeltrettigheter
 * i tillegg (`employee_permissions`). Bare det fase 0b–2a trenger. Kodene er faste (regel 6).
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
  /** Endre ordre, oppdrag, parter, befaringstid og dokumenter. */
  "assignment.edit",
  /** Endre rapportinnhold. */
  "report.edit",
  /** Publisere rapport og overstyre sperre. Krever alltid en person (KI publiserer aldri). */
  "report.publish",
  /** Endre strukturen i systemmalen (maltilgang). Admin, eller gitt som enkeltrettighet. */
  "template.edit_structure",
  /** Sende fakturagrunnlag. Alle roller (27.10.2026). */
  "invoice.send",
] as const;
export type Permission = (typeof permissions)[number];

/**
 * Rettighetene admin kan gi som enkeltrettighet (A21). Andre navn i `employee_permissions`
 * gir ingen rettighet, slik at ingen kan omgå adminrollen eller se reklamasjonssaker.
 */
export const grantablePermissions = [
  "template.edit_structure",
  "assignment.edit",
  "report.edit",
  "report.publish",
] as const satisfies readonly Permission[];
export type GrantablePermission = (typeof grantablePermissions)[number];

/** Innstillingen i `organizations.settings`: alle takstmenn kan endre alt (Ståle 27.10.2026). */
const INSPECTORS_EDIT_ALL_KEY = "access.inspectors_edit_all";

export type AccessSettings = { inspectorsEditAll: boolean };

function permissionsForRole(role: EmployeeRole, settings: AccessSettings): readonly Permission[] {
  switch (role) {
    case "inspector":
      return settings.inspectorsEditAll
        ? ["organization.read", "assignment.edit", "report.edit", "report.publish", "invoice.send"]
        : ["organization.read", "report.publish", "invoice.send"];
    case "office":
      return ["organization.read", "assignment.edit", "invoice.send"];
    case "manager":
      return [
        "organization.read",
        "claims.read",
        "staff.manage",
        "assignment.edit",
        "report.edit",
        "report.publish",
        "invoice.send",
      ];
    case "admin":
      // Admin stenges aldri ute: alltid alle rettigheter.
      return [...permissions];
  }
}

function isGrantable(name: string): name is GrantablePermission {
  return (grantablePermissions as readonly string[]).includes(name);
}

/**
 * Rettighetene en ansatt har: rollene (med innstillingen) pluss enkeltrettigheter som står i
 * `grantablePermissions`. Andre navn ignoreres (fail-closed). Ingen duplikater, i samme
 * rekkefølge som `permissions`. Admin får alltid alle.
 */
export function effectivePermissions(
  roles: readonly EmployeeRole[],
  grantedPermissions: readonly string[],
  settings: AccessSettings,
): readonly Permission[] {
  const result = new Set<Permission>();
  for (const role of roles) {
    for (const permission of permissionsForRole(role, settings)) result.add(permission);
  }
  for (const name of grantedPermissions) {
    if (isGrantable(name)) result.add(name);
  }
  return permissions.filter((permission) => result.has(permission));
}

/**
 * Leser `access.inspectors_edit_all` fra `organizations.settings`. Standard på: bare boolean
 * `false` slår den av. Er verdien noe annet enn boolean, logges en advarsel (bare organisasjon og
 * nøkkel), slik at en skrivefeil ved innstramming blir oppdaget.
 */
export function readInspectorsEditAll(organizationId: string, settings: unknown): boolean {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return true;
  if (!Object.prototype.hasOwnProperty.call(settings, INSPECTORS_EDIT_ALL_KEY)) return true;
  const value = (settings as Record<string, unknown>)[INSPECTORS_EDIT_ALL_KEY];
  if (typeof value !== "boolean") {
    logger.warn("Ugyldig verdi i innstillingen, bruker standard (på)", {
      organizationId,
      key: INSPECTORS_EDIT_ALL_KEY,
    });
    return true;
  }
  return value;
}

/** Innlogget bruker slik tilgangslaget ser den. Kommer fra sesjonen, ikke fra databasen. */
export type Actor = {
  id: string;
  email: string;
  name: string;
};

/** Den ansatte med roller og rettigheter i én organisasjon (resultatet av tilgangssjekken). */
export type EmployeeGrant = {
  employeeId: string;
  organizationId: string;
  roles: readonly EmployeeRole[];
  permissions: readonly Permission[];
};

/** Om tilgangssjekken ga `permission`. Leser bare `grant.permissions`. */
export function grantHasPermission(grant: EmployeeGrant, permission: Permission): boolean {
  return grant.permissions.includes(permission);
}

/** Admin stenges aldri ute (regel fra Optiplan, videreført i CLAUDE.md). */
export function isAdmin(grant: EmployeeGrant) {
  return grant.roles.includes("admin");
}
