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
  /** Bare forhåndsvisningen (tillegget til ADR 0016): over `PDF_PREVIEW_LIMITS`. Ruten gir 413. */
  "too_many_pages",
  "pages_too_large",
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

// --- Levende forhåndsvisning (tillegget til ADR 0016, A603–A612) ---------------------------------

/** Hva motoren lager: PDF-en, eller sidene som SVG med sidekart (bare forhåndsvisningen). */
export const PDF_ENGINE_OUTPUTS = ["pdf", "pages"] as const;

/**
 * Hva et avsnitt i siden er (A604). Sammen med id-ene i `PdfPageAnchor` peker koden på ett felt i
 * skjemaet. Kodene er faste (regel 6): de endres aldri og tas aldri bort, de arkiveres. Nye
 * avsnitt får ny kode nederst. `checkpoint` og `deviation` er hele kortet (overskriften).
 */
export const PDF_PAGE_ANCHOR_KINDS = [
  "checkpoint",
  "checkpoint.description",
  "checkpoint.answer",
  "deviation",
  "deviation.text",
  "deviation.cause",
  "deviation.consequence",
  "deviation.measures",
  "deviation.cost",
  "tgiu",
] as const;

/**
 * Utkastmerket på et avsnitt: «Ikke satt» (TG mangler), «Mangler» og «Sjekk». Samme funn som
 * publiseringssjekken gir PDF-utkastet (`tgNotSet` og `PDF_DRAFT_NOTE_KINDS`). Har et avsnitt
 * flere, gjelder det første i denne rekkefølgen.
 */
export const PDF_DRAFT_MARK_KINDS = ["tg_not_set", "missing", "check"] as const;

/**
 * Formkravene til et anker. Alt annet avvises før det brukes, både på serveren og i nettleseren.
 * `elementKey` følger tegnsettet til `field_key` i malene (`TEMPLATE_KEY_PATTERN` i
 * `src/db/schema/templates.ts`; kopiert hit fordi filen ikke har importer).
 */
export const PDF_PAGE_ANCHOR_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PDF_PAGE_ANCHOR_ELEMENT_KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** Tegnene i `RenderedPage.hash`: de første 32 heksadesimale tegnene av SHA-256 av SVG-en. */
export const PDF_PAGE_HASH_LENGTH = 32;

/**
 * Grensene for forhåndsvisningen (A612), i tillegg til `PDF_DEFAULT_LIMITS`. Over grensen gir
 * `too_many_pages` eller `pages_too_large`, aldri et halvt svar. `maxSvgBytesTotal` er foreløpig
 * til «Bilder på PC» i 2a-3 (bildene blir base64 inne i SVG-en).
 */
export const PDF_PREVIEW_LIMITS = {
  ...PDF_DEFAULT_LIMITS,
  maxPages: 80,
  maxSvgBytesTotal: 12 * 1024 * 1024,
} as const;

/**
 * Forhåndsvisningens eget tak (A606): én pågående per prosess, tatt før datalesingen og før
 * plassen i det felles taket (`PDF_MAX_CONCURRENT`). Da er det alltid minst én plass til PDF-ene.
 */
export const PDF_PREVIEW_MAX_CONCURRENT = 1;

/** Nøkkelen i forhåndsvisningens tak er `preview:<employeeId>`. */
export const PDF_PREVIEW_LIMITER_KEY_PREFIX = "preview:";
