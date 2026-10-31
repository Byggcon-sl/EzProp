import { todayInOslo } from "@/shared/lib/dates";

/*
 * Grensesakene for datoregelen til sertifiseringer, som data (testplan
 * docs/funksjoner/fase0b-sertifisering-testplan.md, del 1). Samme tabell brukes mot den rene
 * regelen, mot SQL-varianten i `employeeHasValidCertification` (3.1) og mot status i
 * `listCertificationsForEmployee` (4.4.4). Fast dato: i dag er 2026-10-31 i Oslo.
 */

/** Fast klokke i testene: 31.10.2026 kl. 11 i Oslo. */
export const NOW = new Date("2026-10-31T10:00:00Z");
/** 23:30 UTC 30.10 er allerede 31.10 i Oslo. */
export const MIDNIGHT_UTC = new Date("2026-10-30T23:30:00Z");
export const TODAY = "2026-10-31";

export type CertificationCase = {
  name: string;
  validFrom: string | null;
  validTo: string;
  deletedAt: Date | null;
  today: string;
  /** Fasit for `isCertificationValid`. */
  valid: boolean;
  /** Fasit for `expiresWithin(…, 60)`: med i listen «går ut snart». */
  expiringIn60: boolean;
  /** Fasit for status i `listCertificationsForEmployee`; `null` når raden ikke vises (slettet). */
  status: "valid" | "expiring" | "expired" | "not_started" | null;
};

export const certificationCases: readonly CertificationCase[] = [
  {
    name: "1. utløper i dag er gyldig",
    validFrom: "2025-10-31",
    validTo: "2026-10-31",
    deletedAt: null,
    today: TODAY,
    valid: true,
    expiringIn60: true,
    status: "expiring",
  },
  {
    name: "2. utløpte i går er ugyldig",
    validFrom: "2025-10-30",
    validTo: "2026-10-30",
    deletedAt: null,
    today: TODAY,
    valid: false,
    expiringIn60: true,
    status: "expired",
  },
  {
    name: "3. starter i morgen er ugyldig",
    validFrom: "2026-11-01",
    validTo: "2027-11-01",
    deletedAt: null,
    today: TODAY,
    valid: false,
    expiringIn60: false,
    status: "not_started",
  },
  {
    name: "4. starter i dag er gyldig",
    validFrom: "2026-10-31",
    validTo: "2027-10-31",
    deletedAt: null,
    today: TODAY,
    valid: true,
    expiringIn60: false,
    status: "valid",
  },
  {
    name: "5. gyldig fra tom er gyldig",
    validFrom: null,
    validTo: "2027-01-01",
    deletedAt: null,
    today: TODAY,
    valid: true,
    expiringIn60: false,
    status: "valid",
  },
  {
    name: "6. 60 dager frem er i listen",
    validFrom: null,
    validTo: "2026-12-30",
    deletedAt: null,
    today: TODAY,
    valid: true,
    expiringIn60: true,
    status: "expiring",
  },
  {
    name: "7. 61 dager frem er ikke i listen",
    validFrom: null,
    validTo: "2026-12-31",
    deletedAt: null,
    today: TODAY,
    valid: true,
    expiringIn60: false,
    status: "valid",
  },
  {
    // Datoene alene ville gitt gyldig og «går ut snart»; bare slettingen tar den bort.
    name: "8. slettet teller ikke",
    validFrom: "2025-11-15",
    validTo: "2026-11-15",
    deletedAt: new Date("2026-10-01T08:00:00Z"),
    today: TODAY,
    valid: false,
    expiringIn60: false,
    status: null,
  },
  {
    name: "9. midnatt i Oslo mot UTC: utløp 30.10 er utgått kl. 23:30 UTC 30.10",
    validFrom: null,
    validTo: "2026-10-30",
    deletedAt: null,
    today: todayInOslo(MIDNIGHT_UTC),
    valid: false,
    expiringIn60: true,
    status: "expired",
  },
];
