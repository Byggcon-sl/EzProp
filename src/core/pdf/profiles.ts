import { DEFAULT_PDF_PROFILE_CODE, PDF_FOOTER_PARTS, PDF_SECTION_CODES } from "./codes";
import type { GetPdfProfile, PdfProfile } from "./types";

/*
 * PDF-profilene som kodedata (A530, docs/funksjoner/fase2a-pdf-badet-design.md avsnitt 1).
 * Profilen har bare utseende: aldri selskapsnavn og aldri fagtekst. Fargene er de samme som
 * tokenene i `src/app/globals.css` (en test holder dem like). Tabellen `report_profiles` kommer
 * med «Flere PDF-utgaver» i 2a-3. En kode endres aldri; den arkiveres (regel 6).
 */

/** Nøkkelen for Byggcon-logoen i `PdfAssets.logos` (`public/brand/byggcon-logo.png`). */
export const BYGGCON_LOGO_KEY = "byggcon";

/** Byggcons standardprofil: stående A4, Fjord-fargene, Inter og Schibsted Grotesk. */
export const BYGGCON_STANDARD_PROFILE: PdfProfile = {
  code: DEFAULT_PDF_PROFILE_CODE,
  version: 1,
  name: "Byggcon standard",
  orientation: "portrait",
  colors: {
    text: "#0f1924", // night
    muted: "#5d6774", // stone
    accent: "#316aa0", // fjord
    rule: "#c6c3bb", // line-strong
    link: "#255a8c", // fjord-dark
    panel: "#eeebe3", // sand
    tg: {
      "0": { background: "#cdeedd", text: "#155e3e", stroke: "#1f8a5b" },
      "1": { background: "#cdeedd", text: "#155e3e", stroke: "#1f8a5b" },
      "2": { background: "#fbe7b5", text: "#6b4405", stroke: "#b7791f" },
      "3": { background: "#f8d0cc", text: "#8b2a1f", stroke: "#c0392b" },
      IU: { background: "#e4e1d8", text: "#4a463f", stroke: "#6e6a62" },
    },
    marking: "#c0392b", // urgent-line
    watermark: "#e7e9ec", // night ca. 8 % på hvit
  },
  fonts: { heading: "Schibsted Grotesk", body: "Inter" },
  logo: BYGGCON_LOGO_KEY,
  coverLayout: "standard",
  sections: PDF_SECTION_CODES,
  footer: PDF_FOOTER_PARTS,
};

/** Alle profiler i appen. En kode som forsvinner herfra, gjør testen rød (regel 6). */
export const PDF_PROFILES: readonly PdfProfile[] = [BYGGCON_STANDARD_PROFILE];

/** Profilen for koden, eller `null` for ukjent kode. */
export const getPdfProfile: GetPdfProfile = (code) =>
  PDF_PROFILES.find((profile) => profile.code === code) ?? null;
