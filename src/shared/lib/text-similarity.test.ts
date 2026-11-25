import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  rankBySimilarity,
  scoreTextSimilarity,
  SIMILARITY_MIN_SCORE,
  similarityTerms,
} from "./text-similarity";

/*
 * Likhetsfunksjonen (docs/funksjoner/fase2a-skriv-det-du-ser.md «Lagt til av forbedreren» punkt 1,
 * A558 og A561; testplanen avsnitt 1a). Ren test uten database. Alle tekster er oppdiktet.
 *
 * Hovedmål: best for de ansatte (takstmannen står aldri fast uten nett, og egne ord gir treff) og
 * færre reklamasjoner (et notat som ikke passer, gir «ingen passer» i stedet for feil utfall).
 */

const texts = [
  "Overflater vegger: sprukne fliser eller riss i fuger på veggene.",
  "Overflater gulv: sprukne fliser eller riss i fuger på gulvet.",
  "Ventilasjon: avtrekket trekker svakt ved test.",
  "Membran og sluk: sjiktet er registrert som fra {årstall}.",
];

function rank(query: string, items = texts, limit = 3) {
  return rankBySimilarity(query, items, (text) => text, { limit });
}

describe("likhetsfunksjonen: ordene (S1.1, S1.2)", () => {
  it("S1.1 småord gir ingen poeng, og et notat med bare småord gir tom liste", () => {
    expect(similarityTerms("i ved litt på og")).toEqual([]);
    expect(rank("i ved litt på og")).toEqual([]);
    expect(similarityTerms("litt sprekk ved sluket")).toEqual(["sprekk", "sluk"]);
  });

  it.each([
    ["sprekker", "sprekk"],
    ["sprekken", "sprekk"],
    ["sprukket", "sprekk"],
    ["sprukne", "sprekk"],
    ["flisene", "flis"],
    ["flisa", "flis"],
    ["fliser", "flis"],
    ["gulvet", "gulv"],
    ["veggen", "vegg"],
  ])("S1.2 «%s» gir stammen «%s»", (word, stem) => {
    expect(similarityTerms(word)).toEqual([stem]);
  });

  it("S1.2 store bokstaver, æøå og Unicode-form regnes likt, og ord står én gang i rekkefølge", () => {
    expect(similarityTerms("SPREKK i Flis, sprekk")).toEqual(["sprekk", "flis"]);
    expect(similarityTerms("Smøremembran")).toEqual(similarityTerms("smøremembran"));
    expect(similarityTerms("smøremembran".normalize("NFD"))).toEqual(["smøremembran"]);
  });

  it("S1.2 omtaler av TG tas bort, også «TG 3», «TG-2» og «tilstandsgrad»", () => {
    for (const note of [
      "dette er TG3",
      "TG 3",
      "tg-2",
      "TGIU",
      "tilstandsgrad 2",
      "Tilstandsgrad",
    ]) {
      expect(similarityTerms(note).filter((t) => t !== "2")).toEqual([]);
    }
    expect(similarityTerms("sprekk i flis, TG2")).toEqual(similarityTerms("sprekk i flis"));
  });

  it("tall teller som ord", () => {
    expect(similarityTerms("membran fra 1994")).toEqual(["membran", "1994"]);
  });
});

describe("likhetsfunksjonen: poeng (S1.3, S1.4)", () => {
  it("S1.3 én bokstav feil treffer i ord på minst fem bokstaver", () => {
    expect(scoreTextSimilarity(similarityTerms("membarn"), "membran")).toBe(1);
    expect(scoreTextSimilarity(similarityTerms("fuktmerker"), "fuktmerke")).toBe(1);
    expect(scoreTextSimilarity(similarityTerms("fuktmerkr"), "fuktmerker")).toBe(1);
    expect(scoreTextSimilarity(similarityTerms("ventilasjn"), "ventilasjon")).toBe(1);
  });

  it("S1.3 én bokstav feil i ord under fem bokstaver treffer ikke", () => {
    expect(scoreTextSimilarity(similarityTerms("flus"), "flis")).toBe(0);
    expect(scoreTextSimilarity(similarityTerms("vagg"), "vegg")).toBe(0);
  });

  it("S1.3 to bokstaver feil treffer ikke", () => {
    expect(scoreTextSimilarity(similarityTerms("mebmarn"), "membran")).toBe(0);
  });

  it("sammensatte ord: første del på minst fire og siste del på minst fem bokstaver", () => {
    expect(scoreTextSimilarity(["hull"], "hulltaking i veggen")).toBe(1);
    expect(scoreTextSimilarity(["smøremembran"], "membran")).toBe(1);
    expect(scoreTextSimilarity(["gulvflis"], "gulv")).toBe(1);
    // «merk» og «flis» er for korte som siste del
    expect(scoreTextSimilarity(["bruksmerk"], "merker etter varme")).toBe(0);
    expect(scoreTextSimilarity(["gulvflis"], "fliser")).toBe(0);
  });

  it("et tall i notatet finnes når teksten har et flettefelt", () => {
    expect(scoreTextSimilarity(["1994"], "registrert som fra {årstall}")).toBe(1);
    expect(scoreTextSimilarity(["1994"], "registrert som fra 1994")).toBe(1);
    expect(scoreTextSimilarity(["1994"], "registrert som fra 2001")).toBe(0);
  });

  it("S1.4 poeng er andelen av notatets ord som finnes, og ikke alle må finnes", () => {
    const terms = similarityTerms("sprekk flis gulv dusj");
    expect(scoreTextSimilarity(terms, texts[1]!)).toBe(0.75);
    expect(scoreTextSimilarity(terms, texts[0]!)).toBe(0.5);
    expect(scoreTextSimilarity([], texts[0]!)).toBe(0);
  });

  it("S1.4 flere treffende ord gir høyere plass", () => {
    const hits = rank("sprukne fliser på gulvet", texts);
    expect(hits.map((hit) => hit.item)).toEqual([texts[1], texts[0]]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("S1.4 lik poengsum beholder rekkefølgen i listen (stabil)", () => {
    expect(rank("sprekk i flis").map((hit) => hit.item)).toEqual([texts[0], texts[1]]);
    const reversed = [texts[1]!, texts[0]!];
    expect(rank("sprekk i flis", reversed).map((hit) => hit.item)).toEqual(reversed);
  });

  it("rekkefølgen på ordene teller ikke", () => {
    expect(scoreTextSimilarity(similarityTerms("flis sprekk"), texts[0]!)).toBe(
      scoreTextSimilarity(similarityTerms("sprekk flis"), texts[0]!),
    );
  });
});

describe("likhetsfunksjonen: grensen og listen (S1.5, S1.6)", () => {
  it("S1.5 grensen er én navngitt konstant mellom 0 og 1", () => {
    expect(SIMILARITY_MIN_SCORE).toBeGreaterThan(0.5);
    expect(SIMILARITY_MIN_SCORE).toBeLessThan(1);
  });

  it("S1.5 under grensen gir tom liste («ingen passer»), aldri alle", () => {
    expect(rank("litt slitt fuge")).toEqual([]);
    expect(rank("helt annet ord her")).toEqual([]);
    expect(rank("")).toEqual([]);
  });

  it("S1.5 `minScore` kan settes, og poeng 0 er aldri et treff", () => {
    expect(rankBySimilarity("slitt fuge", texts, (t) => t, { limit: 3, minScore: 0.5 })).toEqual([
      { item: texts[0], score: 0.5 },
      { item: texts[1], score: 0.5 },
    ]);
    expect(rankBySimilarity("helt annet", texts, (t) => t, { limit: 3, minScore: 0 })).toEqual([]);
  });

  it("S1.6 høyst `limit` treff", () => {
    const many = Array.from({ length: 10 }, (_, i) => `sprekk i flis nummer ${i}`);
    expect(rank("sprekk i flis", many, 3)).toHaveLength(3);
    expect(rank("sprekk i flis", many, 1)).toHaveLength(1);
  });

  it("S1.6 samme inndata gir samme svar hver gang", () => {
    const first = rank("avtrekk trekker svakt");
    for (let i = 0; i < 5; i++) expect(rank("avtrekk trekker svakt")).toEqual(first);
  });

  it("S1.6 «dette er TG3» endrer ikke rekkefølgen", () => {
    expect(rank("sprekk i flis, dette er TG3")).toEqual(rank("sprekk i flis"));
    expect(rank("avtrekk trekker svakt TG 2")).toEqual(rank("avtrekk trekker svakt"));
  });

  it("kaster aldri: ugyldig grense, tom liste og `textOf` som kaster gir tom liste eller hopper over", () => {
    expect(rankBySimilarity("sprekk", texts, (t) => t, { limit: 0 })).toEqual([]);
    expect(rankBySimilarity("sprekk", texts, (t) => t, { limit: Number.NaN })).toEqual([]);
    expect(rankBySimilarity("sprekk", [], (t: string) => t, { limit: 3 })).toEqual([]);
    const hits = rankBySimilarity(
      "sprekk i flis",
      texts,
      (t) => {
        if (t === texts[0]) throw new Error("oppdiktet feil");
        return t;
      },
      { limit: 3 },
    );
    expect(hits.map((hit) => hit.item)).toEqual([texts[1]]);
    expect(similarityTerms(undefined as unknown as string)).toEqual([]);
    expect(scoreTextSimilarity(["sprekk"], null as unknown as string)).toBe(0);
  });
});

describe("likhetsfunksjonen: kan kjøres overalt (S1.9)", () => {
  it("S1.9 filen har ingen importer (nettleser, iPad og server)", () => {
    const source = readFileSync(join(__dirname, "text-similarity.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/mu);
    expect(source).not.toMatch(/require\(|import\(/u);
    expect(source).not.toMatch(/server-only|@\/db|@\/core/u);
  });

  it("S1.9 logger aldri", () => {
    const source = readFileSync(join(__dirname, "text-similarity.ts"), "utf8");
    expect(source).not.toMatch(/console\./u);
  });
});
