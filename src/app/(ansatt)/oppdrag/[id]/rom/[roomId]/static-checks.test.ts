import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Statiske kontroller for skjermen for badet (design avsnitt 22, sjekklisten for utvikler):
 * - klientkomponentene importerer bare `@/core/reports/logic` (og typer), aldri rapportkjernen,
 *   databasen eller tilgangen;
 * - ingen nedtrekksmeny (`Select`, `<select>`);
 * - regelforslag er ikke KI: ingen «KI», ingen gnisteikon, ingen `ai-*`-tokens;
 * - ingen faste hex-farger;
 * - ingen rapportdata i localStorage eller IndexedDB (2b).
 * Støtter hovedmål: KI i bunnen (regelforslag og KI holdes adskilt), færre reklamasjoner.
 */

const dir = __dirname;
const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));
const read = (file: string) => readFileSync(join(dir, file), "utf8");
/** Filene nettleseren får: alt utenom server actions og selve siden. */
const clientFiles = files.filter((f) => f !== "actions.ts" && f !== "page.tsx");
/** Kildekoden uten kommentarer. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Importstiene i en fil, med om importen bare er typer. */
function imports(source: string): { from: string; typeOnly: boolean }[] {
  return [...source.matchAll(/import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gs)].map((m) => ({
    from: m[2]!,
    typeOnly: Boolean(m[1]),
  }));
}

describe("skjermen for badet", () => {
  it("har klientkomponenter å kontrollere", () => {
    expect(clientFiles).toEqual(
      expect.arrayContaining([
        "room-view.tsx",
        "checkpoint-panel.tsx",
        "rule-suggestion-card.tsx",
        "deviation-card.tsx",
      ]),
    );
  });

  it.each(clientFiles)("%s importerer ikke rapportkjernen, databasen eller tilgangen", (file) => {
    for (const { from, typeOnly } of imports(read(file))) {
      expect(from, `${file}: ${from}`).not.toBe("@/core/reports");
      expect(from.startsWith("@/core/access"), `${file}: ${from}`).toBe(false);
      expect(from.startsWith("@/core/ai"), `${file}: ${from}`).toBe(false);
      if (
        from.startsWith("@/db") ||
        from === "@/core/reports/types" ||
        from === "@/core/templates" ||
        from === "@/core/rules"
      ) {
        expect(typeOnly, `${file}: ${from} skal bare gi typer`).toBe(true);
      }
    }
  });

  it.each(files)("%s har ingen nedtrekksmeny, ingen hex-farger og ingen lokal lagring", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/<select\b|\bSelect\b/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(source).not.toMatch(/localStorage|indexedDB|IndexedDB/);
  });

  it("regelforslag er ikke KI", () => {
    const source = code("rule-suggestion-card.tsx");
    expect(source).not.toMatch(/\bKI\b/);
    expect(source).not.toMatch(/AiSparkIcon|ai-text-mark|ai-suggestion|\bai-\d/);
  });
});

/*
 * «Skriv det du ser» (skissen avsnitt 1, 10 og 11, testplanen S1.33, S5.6, S7.17): ingen
 * forhåndsvalgt treff, ingen mikrofonknapp, ingen tilgangslogikk i skjermen, og grensene leses fra
 * `@/shared`.
 */
describe("«Skriv det du ser» i skjermen", () => {
  const outcomeFiles = [
    "add-deviation-panel.tsx",
    "outcome-match-hits.tsx",
    "outcome-hit-button.tsx",
    "note-offer.tsx",
    "outcome-match-model.ts",
  ];

  it.each(outcomeFiles)(
    "%s har ingen forhåndsvalg, ingen mikrofon og ingen tilgangslogikk",
    (file) => {
      const source = code(file);
      expect(source).not.toMatch(/aria-(pressed|selected|current|checked)|autoFocus/u);
      expect(source).not.toMatch(/mikrofon|microphone|getUserMedia|SpeechRecognition|dikter/iu);
      expect(source).not.toMatch(
        /roles\.includes|permissions\.includes|requireOrganizationAccess/u,
      );
    },
  );

  it("grensene leses fra @/shared, aldri fra KI-kjernen", () => {
    for (const file of ["add-deviation-panel.tsx", "room-model.ts", "outcome-match-model.ts"]) {
      expect(read(file)).not.toMatch(/OUTCOME_MATCH_CANDIDATES_MAX/u);
    }
    expect(read("room-model.ts")).toMatch(
      /import \{[^}]*OUTCOME_MATCH_MAX[^}]*\} from "@\/shared\/config\/ai-targets"/u,
    );
  });

  it("de faste målene for e2e finnes (skissen avsnitt 11)", () => {
    const all = outcomeFiles.map(read).join("\n");
    for (const id of [
      "outcome-match-find",
      "outcome-match-group",
      "outcome-match-hit",
      "outcome-match-message",
      "outcome-nearest-group",
      "note-offer",
      "note-offer-add",
      "note-offer-only",
      "note-offer-undo",
    ]) {
      expect(all, id).toContain(`"${id}"`);
    }
    expect(read("outcome-hit-button.tsx")).toMatch(/data-checkpoint=/u);
    expect(read("outcome-hit-button.tsx")).toMatch(/data-registered=/u);
  });
});

/*
 * Beslutninger på KI-forslag (gjennomgangen av KI i veien): tilgangen og radsjekken ligger i
 * rapportkjernen (`decideAiText`), aldri i siden. «Ingen treff» er ikke et forslag og avvises ikke,
 * og «Angre» etter «Bruk» på et fraseforslag avviser forslaget.
 */
describe("KI-beslutninger fra rommet", () => {
  it("decideAiSuggestionAction går til decideAiText uten egen tilgangslogikk", () => {
    const source = code("actions.ts");
    const start = source.indexOf("export async function decideAiSuggestionAction");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("decideAiText(");
    expect(body).not.toMatch(/requireOrganizationAccess|recordDecision|isUuid/u);
  });

  it("fraselisten avviser bare en rangert liste, og «Angre» avviser forslaget", () => {
    const source = code("phrase-suggestions.tsx");
    // Hvert kall til rejectQuietly: vilkåret rett før nevner aldri no_match
    const calls = [...source.matchAll(/rejectQuietly\((?:open|result)\.usageId\)/gu)];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      const before = source.slice(Math.max(0, call.index - 160), call.index);
      expect(before.slice(before.lastIndexOf("if (")), "vilkåret før kallet").not.toContain(
        "no_match",
      );
    }
    expect(source).toContain('decision: "undo_and_reject"');
    expect(source).not.toContain('decision: "undo" }');
  });
});
