/**
 * Faste koder for PDF-gjengivelsen (ADR 0016). En kode endres aldri, den arkiveres (regel 6).
 * Rent blad: ingen importer.
 */

/** Profilkoden kobles mot `client_agreements.report_profile_code` (A115) og senere `report_profiles`. */
export const DEFAULT_PDF_PROFILE_CODE = "byggcon_standard";

export const PDF_ORIENTATIONS = ["portrait", "landscape"] as const;

/**
 * Delene i PDF-en. Profilen bestemmer rekkefølgen. `summary` er reservert til 2a-3 og gir ingen
 * side nå. `missing` («Ikke med i PDF-en») finnes bare i utkast.
 */
export const PDF_SECTION_CODES = [
  "cover",
  "toc",
  "summary",
  "tg_explanation",
  "room",
  "missing",
] as const;

/** Samme verdier som `CHECKPOINT_TG_VALUES` i rapportkjernen (holdt like av en typesjekk der). */
export const PDF_TG_VALUES = ["0", "1", "2", "3", "IU"] as const;

/** Delene bunnteksten settes sammen av, i profilens rekkefølge. Aldri fri tekst med flettefelt. */
export const PDF_FOOTER_PARTS = ["legal_company", "assignment_number", "page_of_pages"] as const;

/** Merknader som bare står i utkastet (A536). Teksten kommer fra publiseringssjekken. */
export const PDF_DRAFT_NOTE_KINDS = ["missing", "check"] as const;

export const PDF_IMAGE_FORMATS = ["jpeg", "png"] as const;

/** Markering på bilde: faste former med tall, aldri SVG eller HTML fra klienten. */
export const PDF_MARKING_TYPES = ["arrow", "circle", "rectangle"] as const;

/**
 * Feilkodene fra `renderReportPdf`. Loggen får koden, aldri `error.message` fra motoren (den kan
 * sitere rapporttekst).
 */
export const PDF_RENDER_ERROR_CODES = [
  "timeout",
  "too_many_images",
  "images_too_large",
  "invalid_image",
  "invalid_marking",
  "engine_failed",
] as const;

/**
 * Grensene i ADR 0016 punkt 9 (A539). Gjelder per prosess. Tallene for bilder er foreløpige til
 * målingen med ekte visningskopier i 2a-3.
 */
export const PDF_DEFAULT_LIMITS = {
  timeoutMs: 20_000,
  maxImages: 60,
  maxImageBytesTotal: 25 * 1024 * 1024,
  maxImageEdgePx: 2400,
} as const;

/** Felles tak for pågående PDF-er per prosess, og per ansatt (A539). */
export const PDF_MAX_CONCURRENT = 2;
export const PDF_MAX_CONCURRENT_PER_EMPLOYEE = 1;
