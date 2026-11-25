import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEW_NOTE_WORDS, wordDiff, type WordDiffPart } from "./word-diff";

/*
 * Ordmarkeringen (docs/funksjoner/fase2a-ga-gjennom-tekstene-testplan.md GT1.10–GT1.15). Ren
 * test, ingen database. Alle tekster er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (endringene markert ord for ord, lesbart for skjermleser) og færre
 * reklamasjoner (merknad når «ikke», «bør» o.l. er endret).
 */

const parts = (before: string, after: string) =>
  wordDiff(before, after).parts.map((part) => [part.kind, part.text]);

/** Teksten slik den sto før: like og fjernede deler. */
const beforeOf = (list: WordDiffPart[]) =>
  list
    .filter((part) => part.kind !== "added")
    .map((part) => part.text)
    .join(" ");
/** Teksten slik den står etter: like og lagt til-deler. */
const afterOf = (list: WordDiffPart[]) =>
  list
    .filter((part) => part.kind !== "removed")
    .map((part) => part.text)
    .join(" ");

describe("ordmarkering: sammenligning ord for ord (GT1.10)", () => {
  it("like tekster gir ingen endring", () => {
    const diff = wordDiff("Fliser er løse ved sluket.", "Fliser er løse ved sluket.");
    expect(diff.unchanged).toBe(true);
    expect(diff.notes).toEqual([]);
    expect(diff.parts).toEqual([{ kind: "same", text: "Fliser er løse ved sluket.", srLabel: "" }]);
  });

  it("to tomme tekster gir ingen deler og ingen endring", () => {
    expect(wordDiff("", "")).toEqual({ parts: [], unchanged: true, notes: [] });
    expect(wordDiff("  \n ", "")).toEqual({ parts: [], unchanged: true, notes: [] });
  });

  it("tom før gir alt lagt til", () => {
    const diff = wordDiff("", "Membranen er skadet.");
    expect(diff.unchanged).toBe(false);
    expect(diff.parts).toEqual([
      { kind: "added", text: "Membranen er skadet.", srLabel: "lagt til" },
    ]);
  });

  it("tom etter gir alt fjernet", () => {
    const diff = wordDiff("Membranen er skadet.", "   ");
    expect(diff.unchanged).toBe(false);
    expect(diff.parts).toEqual([
      { kind: "removed", text: "Membranen er skadet.", srLabel: "fjernet" },
    ]);
  });

  it("æøå beholdes, og et rettet ord gir fjernet og lagt til", () => {
    expect(parts("fukt på flisene i båderommet", "fukt på flisene i baderommet")).toEqual([
      ["same", "fukt på flisene i"],
      ["removed", "båderommet"],
      ["added", "baderommet"],
    ]);
  });

  it("stor forbokstav regnes som endring i markeringen", () => {
    expect(parts("sluket er tett", "Sluket er tett")).toEqual([
      ["removed", "sluket"],
      ["added", "Sluket"],
      ["same", "er tett"],
    ]);
  });

  it("tegnsetting: «fuktskade,» mot «fuktskade.» er en endring", () => {
    expect(parts("Det er fuktskade, i veggen", "Det er fuktskade. i veggen")).toEqual([
      ["same", "Det er"],
      ["removed", "fuktskade,"],
      ["added", "fuktskade."],
      ["same", "i veggen"],
    ]);
  });

  it("ord som flyttes, gir fjernet og lagt til", () => {
    const diff = wordDiff("ved sluket er fliser løse", "fliser er løse ved sluket");
    expect(diff.unchanged).toBe(false);
    const kinds = new Set(diff.parts.map((part) => part.kind));
    expect(kinds).toEqual(new Set(["same", "removed", "added"]));
    expect(beforeOf(diff.parts)).toBe("ved sluket er fliser løse");
    expect(afterOf(diff.parts)).toBe("fliser er løse ved sluket");
  });

  it("delene gjenskaper begge tekstene, med fjernet før lagt til i hver endring", () => {
    const before = "fugene i dusjen har sprekker og må fornyes snart";
    const after = "Fugene i dusjsonen har sprekker, og de må fornyes.";
    const diff = wordDiff(before, after);
    expect(beforeOf(diff.parts)).toBe(before);
    expect(afterOf(diff.parts)).toBe(after);
    for (let i = 1; i < diff.parts.length; i += 1) {
      expect(diff.parts[i - 1]!.kind === "added" && diff.parts[i]!.kind === "removed").toBe(false);
      expect(diff.parts[i - 1]!.kind === diff.parts[i]!.kind).toBe(false);
    }
  });

  it("NFC: samme ord i ulik Unicode-form er likt", () => {
    const composed = "Fukt på veggen";
    const decomposed = "Fukt på veggen";
    expect(wordDiff(composed, decomposed).unchanged).toBe(true);
  });
});

describe("ordmarkering: bare mellomrom er endret (GT1.11, A609)", () => {
  it.each([
    ["flere mellomrom", "Sluket  er   tett.", "Sluket er tett."],
    ["linjeskift", "Sluket er\ntett.", "Sluket er tett."],
    ["mellomrom først og sist", "  Sluket er tett. ", "Sluket er tett."],
    ["tabulator og hardt mellomrom", "Sluket\ter tett.", "Sluket er tett."],
    ["tomme linjer", "Sluket er tett.\n\nFugen er hel.", "Sluket er tett. Fugen er hel."],
  ])("%s gir uten endring", (_name, before, after) => {
    const diff = wordDiff(before, after);
    expect(diff.unchanged).toBe(true);
    expect(diff.notes).toEqual([]);
    expect(diff.parts.every((part) => part.kind === "same")).toBe(true);
  });
});

describe("ordmarkering: merknad (GT1.12, A610)", () => {
  it("de seks ordene er de som står i kortet", () => {
    expect([...REVIEW_NOTE_WORDS]).toEqual(["ikke", "ingen", "uten", "bør", "må", "kan"]);
  });

  it.each(REVIEW_NOTE_WORDS)("«%s» fjernet gir merknad", (word) => {
    const diff = wordDiff(`Sluket ${word} rengjøres nå`, "Sluket rengjøres nå");
    expect(diff.notes).toEqual([
      { word, change: "removed", message: `Sjekk: «${word}» er fjernet` },
    ]);
  });

  it.each(REVIEW_NOTE_WORDS)("«%s» lagt til gir merknad", (word) => {
    const diff = wordDiff("Sluket rengjøres nå", `Sluket ${word} rengjøres nå`);
    expect(diff.notes).toEqual([
      { word, change: "added", message: `Sjekk: «${word}» er lagt til` },
    ]);
  });

  it.each(REVIEW_NOTE_WORDS)("«%s» byttet med et annet merknadsord gir merknad", (word) => {
    const other = word === "må" ? "bør" : "må";
    const diff = wordDiff(`Fugen ${word} skiftes`, `Fugen ${other} skiftes`);
    expect(diff.notes).toEqual([
      { word, change: "replaced", message: `Sjekk: «${word}» er byttet med «${other}»` },
    ]);
  });

  it("«bør» → «må» gir én merknad: byttet", () => {
    const diff = wordDiff("silikonfugen bør skiftes", "Silikonfugen må skiftes.");
    expect(diff.notes).toEqual([
      { word: "bør", change: "replaced", message: "Sjekk: «bør» er byttet med «må»" },
    ]);
  });

  it("«ikke påvist» som blir «påvist» gir merknad om «ikke»", () => {
    const diff = wordDiff("Det er ikke påvist fukt.", "Det er påvist fukt.");
    expect(diff.notes.map((note) => note.message)).toEqual(["Sjekk: «ikke» er fjernet"]);
  });

  it.each(REVIEW_NOTE_WORDS)("«%s» med stor forbokstav regnes likt", (word) => {
    const upper = word.charAt(0).toLocaleUpperCase("nb-NO") + word.slice(1);
    expect(wordDiff(`${upper} fukt i veggen.`, "Fukt i veggen.").notes).toEqual([
      { word, change: "removed", message: `Sjekk: «${word}» er fjernet` },
    ]);
    // Bare forbokstaven endret: samme ord, ingen merknad
    expect(wordDiff(`${word} fukt i veggen`, `${upper} fukt i veggen.`).notes).toEqual([]);
  });

  it("ordet med tegnsetting rundt regnes likt («ikke,» og «(ikke)»)", () => {
    expect(wordDiff("Målt, ikke, vurdert", "Målt, vurdert").notes).toHaveLength(1);
    expect(wordDiff("Fukt (ikke) påvist", "Fukt påvist").notes).toHaveLength(1);
    expect(wordDiff("Fukt ikke, påvist", "Fukt ikke påvist").notes).toEqual([]);
  });

  it.each([
    ["kanal", "Ventilasjonskanal er tett", "Kanalen er tett", "kanal"],
    ["kanalen", "Avtrekk i kanalen", "Avtrekk i kanal", "kan"],
    ["uteliggende", "Uteliggende rør er isolert", "Rør er isolert", "uten"],
    ["ikkje i navn", "Ikkjeli rør er isolert", "Rør er isolert", "ikke"],
    ["måling", "Måling ved sluket viste tørt", "Ved sluket viste tørt", "må"],
    ["ingenting", "Ingenting å bemerke", "Ikke noe å bemerke", "ingen"],
    ["børste", "Fugen rengjøres med børste", "Fugen rengjøres", "bør"],
  ])("delord «%s» gir ikke merknad", (_name, before, after, word) => {
    const notes = wordDiff(before, after).notes.filter((note) => note.word === word);
    expect(notes).toEqual([]);
  });

  it("endringer i andre ord gir ikke merknad", () => {
    const diff = wordDiff(
      "fugene i dusjen har sprekker og må fornyes",
      "Fugene i dusjsonen har sprekker, og de må fornyes.",
    );
    expect(diff.unchanged).toBe(false);
    expect(diff.notes).toEqual([]);
  });

  it("ordet flyttet i setningen gir ikke merknad", () => {
    expect(wordDiff("Fukt ikke påvist i veggen", "I veggen ikke påvist fukt").notes).toEqual([]);
  });

  it("ett av to like ord fjernet gir merknad", () => {
    expect(wordDiff("Ikke fukt og ikke råte", "Ikke fukt og råte").notes).toEqual([
      { word: "ikke", change: "removed", message: "Sjekk: «ikke» er fjernet" },
    ]);
  });

  it("flere ord: én merknad per ord, i fast rekkefølge", () => {
    const diff = wordDiff(
      "Det er ikke fukt og fugen bør skiftes",
      "Det er fukt og fugen må skiftes",
    );
    expect(diff.notes.map((note) => [note.word, note.change])).toEqual([
      ["bør", "replaced"],
      ["ikke", "removed"],
    ]);
  });

  it("ingen merknad når teksten er uendret", () => {
    expect(wordDiff("Fugen bør skiftes", "Fugen  bør\nskiftes").notes).toEqual([]);
  });
});

describe("ordmarkering: skjermleser (GT1.13)", () => {
  it("hver fjernet og lagt til-del har tekst, like deler har ingen", () => {
    const diff = wordDiff(
      "membranen er ikke klemt fast i sluket, klemringen manlger",
      "Membranen er ikke klemt fast i sluket, og klemringen mangler.",
    );
    expect(diff.parts.length).toBeGreaterThan(2);
    for (const part of diff.parts) {
      const expected = { same: "", removed: "fjernet", added: "lagt til" }[part.kind];
      expect(part.srLabel, part.text).toBe(expected);
      expect(part.text.trim()).not.toBe("");
    }
    expect(diff.parts.some((part) => part.srLabel === "fjernet")).toBe(true);
    expect(diff.parts.some((part) => part.srLabel === "lagt til")).toBe(true);
  });
});

describe("ordmarkering: ytelse (GT1.14)", () => {
  const WORDS = [
    "fliser",
    "membran",
    "sluket",
    "fukt",
    "veggen",
    "gulvet",
    "dusjsonen",
    "fugen",
    "sprekker",
    "ventil",
    "avtrekk",
    "råte",
  ];

  /** Oppdiktet tekst på `length` tegn, fast ut fra `seed`. */
  function text(length: number, seed: number): string {
    const out: string[] = [];
    let state = seed;
    let size = 0;
    while (size < length) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const word = WORDS[state % WORDS.length]!;
      out.push(word);
      size += word.length + 1;
    }
    return out.join(" ").slice(0, length);
  }

  it.each([
    ["helt ulike", text(4000, 1), text(4000, 2)],
    ["nesten like", text(4000, 3), text(4000, 3).replace(/fukt/gu, "Fukt.")],
    ["korte ord helt ulike", "a ".repeat(2000), "b ".repeat(2000)],
    ["mange like korte ord", "a ".repeat(2000), "a b ".repeat(1000)],
  ])("to tekster på 4000 tegn (%s) sammenlignes innen 50 ms", (_name, before, after) => {
    expect(before.length).toBeGreaterThanOrEqual(3999);
    expect(after.length).toBeGreaterThanOrEqual(3999);
    wordDiff(before, after); // oppvarming
    const started = performance.now();
    const diff = wordDiff(before, after);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(50);
    expect(beforeOf(diff.parts)).toBe(before.trim().split(/\s+/u).join(" "));
    expect(afterOf(diff.parts)).toBe(after.trim().split(/\s+/u).join(" "));
  });
});

describe("ordmarkering: ingen avhengighet (GT1.15)", () => {
  const source = readFileSync(join(__dirname, "word-diff.ts"), "utf8");

  it("filen importerer ingenting: ingen pakke, ikke server-only og ikke @/db", () => {
    expect(source).not.toMatch(/^\s*import\s/mu);
    expect(source).not.toMatch(/\brequire\s*\(/u);
    expect(source).not.toMatch(/\bimport\s*\(/u);
    expect(source).not.toMatch(/server-only/u);
    expect(source).not.toMatch(/@\/db/u);
  });
});
