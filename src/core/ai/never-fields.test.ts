import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_FEATURES, findFieldSourceViolations } from "./features";
import { NEVER_FIELDS } from "./never-fields";

/*
 * «Aldri»-listen og feltkildene (docs/funksjoner/fase2a-vask-for-ki.md omfang punkt 7, ad-7).
 * Ren test, ingen database. Støtter hovedmål: KI i bunnen (ingen ny KI-funksjon kan hente fra en
 * «aldri»-kolonne) og færre feil i personvernet.
 */

describe("«aldri»-listen og feltkildene", () => {
  it("alle funksjonsdefinisjonene har kilde for hver feltkode, og ingen kilde er på «aldri»-listen", () => {
    expect(findFieldSourceViolations(Object.values(AI_FEATURES))).toEqual([]);
  });

  it("kontrollen fanger kilde på «aldri»-listen, manglende kilde og ugyldig kilde", () => {
    const found = findFieldSourceViolations([
      {
        code: "invented_feature",
        allowedFields: ["text", "mail", "missing", "odd"],
        fieldSources: { text: "free_text", mail: "contacts.email", odd: "email" },
      },
      { code: "no_sources", allowedFields: ["text"] },
    ]);
    expect(found).toEqual([
      "invented_feature.mail: contacts.email står i «aldri»-listen",
      "invented_feature.missing: mangler kilde",
      "invented_feature.odd: ugyldig kilde email",
      "no_sources.text: mangler kilde",
    ]);
  });

  it("listen har de tre nye kolonnene og ingen dubletter", () => {
    expect(NEVER_FIELDS).toEqual(
      expect.arrayContaining([
        "assignment_team_members.handed_over_reason",
        "certifications.certificate_number",
        "assignments.number",
      ]),
    );
    expect(new Set(NEVER_FIELDS).size).toBe(NEVER_FIELDS.length);
  });

  it("kommentaren over listene krever gjennomgang av sikkerhet-personvern (A175)", () => {
    for (const name of ["never-fields.ts", "features.ts"]) {
      expect(readFileSync(join(__dirname, name), "utf8"), name).toMatch(
        /gjennomgang av sikkerhet-personvern/,
      );
    }
  });
});
