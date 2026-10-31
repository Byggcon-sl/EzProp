import type { CertificationArea, GrantablePermission } from "@/core/access";
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

/** Etiketten til hvert sertifiseringsområde (fast kode i `src/core/access`). */
export const certificationAreaLabels: Record<CertificationArea, string> = {
  condition_report: "Tilstandsrapport bolig",
};

/** Etiketten til et område lest fra databasen. Ukjent (arkivert) kode vises som den er. */
export function certificationAreaLabel(area: string): string {
  return (certificationAreaLabels as Record<string, string>)[area] ?? area;
}

export type CertificationStatus = "expired" | "expiring" | null;

export const certificationStatusLabels: Record<Exclude<CertificationStatus, null>, string> = {
  expired: "Utgått",
  expiring: "Går ut snart",
};

/** «2026-10-31» pluss `days` dager, som «ÅÅÅÅ-MM-DD». Regnes i UTC, så sommertid påvirker ikke. */
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Merket på en sertifisering: «Utgått» når siste gyldige dag er passert, «Går ut snart» når den er
 * innen `warningDays` dager (utløpsdagen er siste gyldige dag). Bare visning; sjekken er i kjernen.
 */
export function certificationStatus(
  validTo: string,
  today: string,
  warningDays: number,
): CertificationStatus {
  if (validTo < today) return "expired";
  if (validTo <= addDays(today, warningDays)) return "expiring";
  return null;
}

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
  sertifisering: "Sertifiseringen er lagret.",
  "sertifisering-fjernet": "Sertifiseringen er fjernet.",
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

/** Dagens dato i Norge som «ÅÅÅÅ-MM-DD». */
export function todayInNorway(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(now);
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
