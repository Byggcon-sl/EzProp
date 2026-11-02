import { logger } from "@/shared/lib/logger";

/**
 * Oppbevaringstider for bilder i `organizations.settings` (docs/05-domenemodell.md 4.8, A42).
 * Standardverdiene er Ståles (25.10.2026 og 27.10.2026). Utregning av `retain_until` kommer i
 * fase 2 sammen med utgivelsen.
 */
const RETENTION_SETTINGS = {
  deviationOriginalYears: { key: "photo.retention.deviation_original_years", defaultYears: 10 },
  otherOriginalYears: { key: "photo.retention.other_original_years", defaultYears: 2 },
  displayYears: { key: "photo.retention.display_years", defaultYears: 10 },
} as const;

const MIN_YEARS = 1;
const MAX_YEARS = 100;

export type FileRetention = {
  deviationOriginalYears: number;
  otherOriginalYears: number;
  displayYears: number;
};

function isValidYears(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= MIN_YEARS && value <= MAX_YEARS
  );
}

/**
 * Leser oppbevaringstidene. Mangler en nøkkel, brukes standard. Er verdien ikke et heltall fra 1
 * til og med 100, brukes standard og det logges en advarsel med bare organisasjon og nøkkel
 * (ikke verdien). Samme mønster som `readInspectorsEditAll` i `src/core/access`.
 */
export function readFileRetention(organizationId: string, settings: unknown): FileRetention {
  const record =
    settings !== null && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};

  const read = ({ key, defaultYears }: { key: string; defaultYears: number }): number => {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return defaultYears;
    const value = record[key];
    if (isValidYears(value)) return value;
    logger.warn("Ugyldig oppbevaringstid i innstillingen, bruker standard", {
      organizationId,
      key,
    });
    return defaultYears;
  };

  return {
    deviationOriginalYears: read(RETENTION_SETTINGS.deviationOriginalYears),
    otherOriginalYears: read(RETENTION_SETTINGS.otherOriginalYears),
    displayYears: read(RETENTION_SETTINGS.displayYears),
  };
}
