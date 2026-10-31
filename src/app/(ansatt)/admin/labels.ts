import type { GrantablePermission } from "@/core/access";
import type { EmployeeRole } from "@/db/schema";

/** Rollene i den rekkefølgen de står i skjemaene (oftest brukt først). */
export const roleFormOrder: readonly EmployeeRole[] = ["inspector", "office", "manager", "admin"];

/** Rekkefølgen på rollemerkene i listen (skisse avsnitt 3). */
export const roleBadgeOrder: readonly EmployeeRole[] = ["admin", "manager", "office", "inspector"];

export const roleLabels: Record<EmployeeRole, string> = {
  inspector: "Takstmann",
  office: "Kontor",
  manager: "Leder",
  admin: "Admin",
};

/** Kort forklaring under hver rolle på siden til den ansatte. Ikke en liste over rettigheter. */
export const roleDescriptions: Record<EmployeeRole, string> = {
  inspector: "Befaring og rapporter.",
  office: "Ordre og oppdrag.",
  manager: "Også reklamasjonssaker og rutiner.",
  admin: "Alt, også ansatte og selskaper.",
};

export const permissionLabels: Record<GrantablePermission, string> = {
  "template.edit_structure": "Endre malstruktur",
  "assignment.edit": "Endre oppdrag",
  "report.edit": "Endre rapport",
  "report.publish": "Publisere rapport",
};

/** Kvitteringene etter lagring. Bare faste nøkler fra adressen; ukjent nøkkel gir ingen tekst. */
const notices = {
  selskap: "Selskapet er lagret.",
  kontor: "Kontoret er lagret.",
  "ny-ansatt": "Den ansatte er lagt inn.",
  endret: "Endringene er lagret.",
  roller: "Rollene er lagret.",
  rettigheter: "Rettighetene er lagret.",
  sluttet: "Markert som sluttet.",
  angret: "Sluttet er angret.",
} as const;

export type NoticeKey = keyof typeof notices;

export function noticeText(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !Object.hasOwn(notices, value)) return null;
  return notices[value as NoticeKey];
}

/** «123456789» blir «123 456 789». Annet vises som det er. */
export function formatOrgNumber(orgNumber: string): string {
  return /^\d{9}$/.test(orgNumber) ? orgNumber.replace(/(\d{3})(?=\d)/g, "$1 ") : orgNumber;
}

/** «2027-12-31» blir «31.12.2027». */
export function formatIsoDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDate;
}

/** Et tidspunkt som norsk dato, «31.10.2026». */
export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

/** Norske navn på `entity_type` i revisjonsloggen. Dekker alt som skrives i `src/core/organization`. */
const auditEntityLabels: Record<string, string> = {
  employee: "Ansatt",
  employee_permission: "Enkeltrettighet",
  company: "Selskap",
  office: "Kontor",
  certification: "Sertifisering",
};

/** Norske navn på `action` i revisjonsloggen. */
const auditActionLabels: Record<string, string> = {
  create: "Opprettet",
  update: "Endret",
  delete: "Slettet",
  role_change: "Roller endret",
  permission_change: "Rettigheter endret",
  deactivate: "Deaktivert",
  reactivate: "Aktivert igjen",
};

/** Norske navn på feltene som står i `changes`. Ukjent felt vises med koden. */
const auditFieldLabels: Record<string, string> = {
  name: "Navn",
  email: "E-post",
  jobTitle: "Stilling",
  companyId: "Selskap",
  officeId: "Kontor",
  street: "Gate",
  address: "Adresse",
  postalCode: "Postnummer",
  city: "Sted",
  sortOrder: "Rekkefølge",
  legalName: "Navn",
  orgNumber: "Org.nr.",
  vatRegistered: "MVA-registrert",
  companyText: "Tekst om selskapet",
  liabilityInsurer: "Forsikringsselskap",
  liabilityPolicyNumber: "Polisenummer",
  liabilityValidTo: "Forsikring gyldig til",
};

function labelFrom(labels: Record<string, string>, code: string): string {
  return (Object.hasOwn(labels, code) ? labels[code] : undefined) ?? code;
}

export function auditEntityLabel(entityType: string): string {
  return labelFrom(auditEntityLabels, entityType);
}

export function auditActionLabel(action: string): string {
  return labelFrom(auditActionLabels, action);
}

/** Én verdi som tekst. Tomme verdier blir «(tom)»; objekter og lister gir `null` (vises ikke). */
function auditValueText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "(tom)";
  if (typeof value === "boolean") return value ? "Ja" : "Nei";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

function isFromTo(value: unknown): value is { from: unknown; to: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "from") &&
    Object.hasOwn(value, "to")
  );
}

/**
 * Endringene i en rad i revisjonsloggen som korte linjer: «Gate: Storgata 1 → Storgata 2» for
 * fra/til, «Endret: Navn, Stilling» for en liste med feltkoder. Alt annet (id-er, lister over
 * roller, objekter) hoppes over, så det aldri står «null», «undefined» eller «[object Object]».
 */
export function formatAuditChanges(changes: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [field, value] of Object.entries(changes)) {
    if (field === "fields" && Array.isArray(value)) {
      const names = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => labelFrom(auditFieldLabels, item));
      if (names.length > 0) lines.push(`Endret: ${names.join(", ")}`);
      continue;
    }
    if (!isFromTo(value)) continue;
    const from = auditValueText(value.from);
    const to = auditValueText(value.to);
    if (from === null || to === null) continue;
    lines.push(`${labelFrom(auditFieldLabels, field)}: ${from} → ${to}`);
  }
  return lines;
}
