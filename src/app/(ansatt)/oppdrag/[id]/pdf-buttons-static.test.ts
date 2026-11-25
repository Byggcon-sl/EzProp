import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkpointAnchorId,
  deviationAnchorId,
  draftPdfHref,
  PDF_BUTTON_TEXTS,
  RELEASE_PDF_TEXTS,
  releasePdfHref,
} from "./pdf-texts";

/*
 * PDF-knappene på skjermen (docs/funksjoner/fase2a-pdf-badet-testplan.md 11.4.2 og 7): vanlig
 * `<a>` i ny fane, aldri `next/link` (ingen forhåndshenting som lager PDF og tar plass i taket),
 * ingen tilgangslogikk og ingen kjerne i komponentene, og adressene har bare id-er.
 * Støtter hovedmål: de ansatte (ett trykk, ny fane som ikke blokkeres).
 */

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");
const COMPONENTS = ["pdf-draft-button.tsx", "release-pdf-link.tsx"] as const;
const ID = "0190a3b4-0000-7000-8000-000000000001";
const OTHER = "0190a3b4-0000-7000-8000-000000000002";

describe("PDF-knappene", () => {
  it.each(COMPONENTS)("%s bruker vanlig <a> i ny fane, ikke next/link", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/from\s+["']next\/link["']/);
    expect(source).toMatch(/<a\b[\s\S]*?target="_blank"[\s\S]*?rel="noopener"/);
  });

  it.each(COMPONENTS)("%s har ingen tilgangslogikk og importerer ikke kjernen", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/from\s+["']@\/core\//);
    expect(source).not.toMatch(/from\s+["']@\/db/);
    expect(source).not.toMatch(/requireOrganizationAccess|grantHasPermission|permission/);
  });

  it.each(COMPONENTS)("%s har tekstene i pdf-texts.ts, ikke i komponenten", (file) => {
    const source = read(file);
    for (const text of [
      PDF_BUTTON_TEXTS.create,
      PDF_BUTTON_TEXTS.offline,
      PDF_BUTTON_TEXTS.creating,
      RELEASE_PDF_TEXTS.open,
    ]) {
      expect(source).not.toContain(`"${text}"`);
    }
  });

  it("adressene og ankrene har bare id-er og faste ord", () => {
    expect(draftPdfHref(ID)).toBe(`/oppdrag/${ID}/pdf`);
    expect(releasePdfHref(ID, OTHER)).toBe(`/oppdrag/${ID}/utgivelser/${OTHER}/pdf`);
    expect(checkpointAnchorId(ID)).toBe(`punkt-${ID}`);
    expect(deviationAnchorId(ID)).toBe(`avvik-${ID}`);
  });

  it("tilgjengelig navn per utgivelse, og teksten lover ikke mer enn teksten og TG", () => {
    expect(RELEASE_PDF_TEXTS.openLabel(2)).toBe("Åpne PDF av versjon 2 (åpnes i ny fane)");
    expect(RELEASE_PDF_TEXTS.hint).toBe("PDF-en viser teksten og TG slik de ble publisert.");
    expect(PDF_BUTTON_TEXTS.offline).toBe("Krever nett. PDF-en kan lages når du er på nett igjen.");
  });
});
