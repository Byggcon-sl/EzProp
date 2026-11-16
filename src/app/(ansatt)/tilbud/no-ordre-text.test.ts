import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Ingen synlig «ordre» om tilbud, ingen lenker til /ordre, og menyen i riktig rekkefølge
 * (docs/funksjoner/fase2a-tilbud-testplan.md 1.6 og 4.4). Kildetekst-sjekk: ser på strenger og
 * JSX-tekst, ikke på kommentarer og kode (tabellen og modulen heter fortsatt `orders`, ADR 0012).
 * Unntak: «meglerens ordrenummer» og «ordrenr.» (meglerens eget nummer).
 * Støtter hovedmål: de ansatte (ett ord for én ting: tilbud).
 */

const APP = path.resolve(__dirname, "..", "..");
const EMPLOYEE = path.join(APP, "(ansatt)");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Kildeteksten uten kommentarer. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Strenger og JSX-tekst i kildeteksten (grovt, men nok til å finne et synlig ord). */
function visibleTexts(source: string): string[] {
  const code = withoutComments(source);
  const strings = [...code.matchAll(/"([^"\n]*)"|`([^`]*)`|'([^'\n]*)'/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  const jsxText = [...code.matchAll(/>([^<>{}]+)</g)].map((match) => match[1] ?? "");
  return [...strings, ...jsxText];
}

/** «ordre» som ord, men ikke «ordrenummer»/«ordrenr.» og ikke i stier og koder (`order`). */
const ORDER_WORD = /\bordre(?!nummer|nr)/i;

/** Filene der synlig tekst om tilbud står (testplan 1.6.1). Bit 3 eier de to siste. */
const TEXT_FILES = [
  ...filesUnder(path.join(EMPLOYEE, "tilbud")),
  path.join(EMPLOYEE, "layout.tsx"),
  path.join(EMPLOYEE, "possible-duplicates-notice.tsx"),
  path.join(EMPLOYEE, "oppdrag", "[id]", "page.tsx"),
];

describe("1.6 ingen synlig «ordre» om tilbud", () => {
  it.each(TEXT_FILES.map((file) => [path.relative(APP, file), file]))("1.6.1 %s", (_name, file) => {
    const offending = visibleTexts(readFileSync(file, "utf8")).filter((text) =>
      ORDER_WORD.test(text),
    );
    expect(offending).toEqual([]);
  });

  it("1.6.2 ingen lenke, videresending eller revalidatePath til /ordre i src/app", () => {
    const offending = filesUnder(APP).filter((file) =>
      /["'`]\/ordre(\/|["'`?#])/.test(withoutComments(readFileSync(file, "utf8"))),
    );
    expect(offending.map((file) => path.relative(APP, file))).toEqual([]);
  });

  it("1.6.3 mappen (ansatt)/ordre finnes ikke, og order-values.ts står felles (A362)", () => {
    expect(existsSync(path.join(EMPLOYEE, "ordre"))).toBe(false);
    expect(existsSync(path.join(EMPLOYEE, "order-values.ts"))).toBe(true);
    for (const file of ["booking-card.tsx", "booking-actions.ts"]) {
      const source = readFileSync(path.join(EMPLOYEE, "oppdrag", "[id]", file), "utf8");
      expect(source).toContain('from "../../order-values"');
    }
  });

  it("unntaket for meglerens ordrenummer står (kontroll av mønsteret)", () => {
    expect(ORDER_WORD.test("Meglerens ordrenummer")).toBe(false);
    expect(ORDER_WORD.test("Meglerens ordrenr. 55-1234")).toBe(false);
    expect(ORDER_WORD.test("Ny ordre")).toBe(true);
    expect(ORDER_WORD.test("Ordren er endret")).toBe(true);
  });
});

describe("4.4 menyen", () => {
  const layout = withoutComments(readFileSync(path.join(EMPLOYEE, "layout.tsx"), "utf8"));
  const mainMenu = layout.slice(0, layout.indexOf('id="nav-group-trials"'));

  it("4.4.1 rekkefølgen er Nytt oppdrag, Arbeidskø, Kontakter, Firma, Tilbud, Statistikk", () => {
    const hrefs = [...mainMenu.matchAll(/<NavLink href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual([
      "/oppdrag/ny",
      "/arbeidskoe",
      "/kontakter",
      "/firma",
      "/tilbud",
      "/statistikk/tid",
    ]);
    expect(mainMenu).toMatch(/<NavLink href="\/tilbud" matchChildren>[\s\S]*?Tilbud\s*<\/NavLink>/);
  });

  it("4.4.2 ingen «Nytt tilbud» og ingen /tilbud/ny i menyen", () => {
    expect(layout).not.toContain("Nytt tilbud");
    expect(layout).not.toContain("/tilbud/ny");
  });
});
