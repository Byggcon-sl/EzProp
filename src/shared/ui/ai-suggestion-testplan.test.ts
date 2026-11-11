import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiSuggestion, suggestionView } from "./ai-suggestion";

/*
 * Forslagskortet (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 10.1–10.14, kortet
 * Omfang 1). Rendres til ren HTML som form.test.ts. Fasiten (knapper og tekster per tilstand) er
 * skrevet inn her. Alle tekster er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (samme kort overalt, med vanlige ord, og egen tekst går aldri tapt)
 * og KI i bunnen (mønsteret alle KI-funksjoner i 2a-2 bruker).
 */

const OWN = "taket er gammelt og har noen sprekker";
const SUGGESTION = "Taket er gammelt og har noen sprekker.";
const OLD_SUGGESTION = "Taket har noen sprekker og er gammelt.";

const TEXTS = {
  heading: "Forslag fra KI",
  use: "Bruk",
  keep: "Behold min tekst",
  newSuggestion: "Nytt forslag",
  undo: "Angre",
  working: "KI jobber …",
  noMatch: "KI hadde ikke noe forslag. Teksten din er uendret.",
  error: "KI svarte ikke. Prøv igjen.",
  aiOff: "KI er av.",
  offline: "Krever nett. Teksten din er lagret og kan skrives videre.",
  queued: "Venter på KI. Forslaget kommer når nettet er tilbake.",
};

type Props = Parameters<typeof AiSuggestion>[0];
const noop = () => {};

function props(overrides: Partial<Props> = {}): Props {
  return {
    ownText: OWN,
    suggestionText: SUGGESTION,
    status: "suggested",
    outcome: "ok",
    pending: null,
    online: true,
    aiEnabled: true,
    hasNewerSuggestion: false,
    staleSuggestion: null,
    aiUsageId: "0193a6f0-0000-7000-8000-000000000001",
    onUse: noop,
    onKeep: noop,
    onNewSuggestion: noop,
    onUndo: noop,
    ...overrides,
  } as Props;
}

function render(overrides: Partial<Props> = {}): string {
  return renderToStaticMarkup(createElement(AiSuggestion, props(overrides)));
}

/** Teksten uten tagger, med HTML-tegn gjort om. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

type RenderedButton = { text: string; disabled: boolean; index: number; end: number };

function buttonsIn(html: string): RenderedButton[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    text: visibleText(match[2]!),
    disabled: /\sdisabled(=""|\s|$)/.test(match[1]!),
    index: match.index!,
    end: match.index! + match[0].length,
  }));
}

const labels = (html: string) => buttonsIn(html).map((button) => button.text);

describe("forslagskortet: knapper og tekst per tilstand (10.1–10.9)", () => {
  type Case = {
    name: string;
    overrides: Partial<Props>;
    shown: string[];
    hidden: string[];
    texts: string[];
  };
  const CASES: Case[] = [
    {
      name: "10.1 suggested, ok",
      overrides: {},
      shown: [TEXTS.use, TEXTS.keep, TEXTS.newSuggestion],
      hidden: [TEXTS.undo],
      texts: [OWN, SUGGESTION, TEXTS.heading],
    },
    {
      name: "10.2 accepted",
      overrides: { status: "accepted" },
      shown: [TEXTS.undo],
      hidden: [TEXTS.newSuggestion],
      texts: [SUGGESTION],
    },
    {
      name: "10.3 rejected",
      overrides: { status: "rejected" },
      shown: [TEXTS.undo, TEXTS.newSuggestion],
      hidden: [],
      texts: [OWN],
    },
    {
      name: "10.4 accepted med hasNewerSuggestion",
      overrides: { status: "accepted", hasNewerSuggestion: true },
      shown: [],
      hidden: [TEXTS.undo],
      texts: [],
    },
    {
      name: "10.4 rejected med hasNewerSuggestion",
      overrides: { status: "rejected", hasNewerSuggestion: true },
      shown: [TEXTS.newSuggestion],
      hidden: [TEXTS.undo],
      texts: [],
    },
    {
      name: "10.6 no_match",
      overrides: { outcome: "no_match", suggestionText: null, status: null },
      shown: [],
      hidden: [TEXTS.use, TEXTS.undo],
      texts: [TEXTS.noMatch],
    },
    {
      name: "10.7 error",
      overrides: { outcome: "error", suggestionText: null, status: null },
      shown: [],
      hidden: [TEXTS.use, TEXTS.undo],
      texts: [TEXTS.error],
    },
    {
      name: "10.8 KI av",
      overrides: { aiEnabled: false, outcome: null, suggestionText: null, status: null },
      shown: [],
      hidden: [TEXTS.use, TEXTS.keep, TEXTS.newSuggestion, TEXTS.undo, "Foreslå bedre språk"],
      texts: [TEXTS.aiOff],
    },
    {
      name: "10.9 uten nett, før første forslag",
      overrides: { online: false, outcome: null, suggestionText: null, status: null },
      shown: [],
      hidden: [TEXTS.use, TEXTS.undo],
      texts: [TEXTS.offline],
    },
    {
      name: "10.9 uten nett, med forslag",
      overrides: { online: false },
      shown: [],
      hidden: [TEXTS.undo],
      texts: [TEXTS.offline, OWN, SUGGESTION],
    },
    // Endret med KI-køen (fase2a-ki-ko K5.4): på /prove/ki legges forespørselen i kø uten nett
    {
      name: "10.9 uten nett, lagt i kø før første forslag",
      overrides: { online: false, queued: true, outcome: null, suggestionText: null, status: null },
      shown: [],
      hidden: [TEXTS.use, TEXTS.keep, TEXTS.undo],
      texts: [TEXTS.queued, OWN],
    },
    {
      name: "10.9 uten nett, lagt i kø med forslag fra før",
      overrides: { online: false, queued: true },
      shown: [],
      hidden: [TEXTS.use, TEXTS.keep, TEXTS.undo],
      texts: [TEXTS.queued],
    },
  ];

  it.each(CASES)("$name", ({ overrides, shown, hidden, texts }) => {
    const html = render(overrides);
    const visible = visibleText(html);
    for (const label of shown) expect(labels(html), label).toContain(label);
    for (const label of hidden) expect(labels(html), label).not.toContain(label);
    for (const text of texts) expect(visible, text).toContain(text);
  });

  it("10.5 pending: «KI jobber …», alle knappene er låst, og kortet har ikke noe låst tekstfelt", () => {
    for (const pending of ["suggestion", "decision"] as const) {
      const html = render({ pending });
      const buttons = buttonsIn(html);
      expect(buttons.length, pending).toBeGreaterThan(0);
      expect(
        buttons.every((button) => button.disabled),
        pending,
      ).toBe(true);
      expect(html).not.toMatch(/<textarea[^>]*\sdisabled/);
      expect(html).not.toMatch(/<input[^>]*\sdisabled/);
    }
    expect(visibleText(render({ pending: "suggestion" }))).toContain(TEXTS.working);
  });

  it("10.9 uten nett: knappen for nytt forslag (hvis den vises) og alle andre knapper er låst", () => {
    for (const overrides of [
      { online: false },
      { online: false, status: "rejected" as const },
      { online: false, outcome: null, suggestionText: null, status: null },
      { online: false, queued: true },
    ]) {
      const html = render(overrides);
      const buttons = buttonsIn(html);
      expect(buttons.every((button) => button.disabled)).toBe(true);
      // I kø: «Venter på KI …» i stedet for «Krever nett …»
      if ("queued" in overrides) {
        expect(visibleText(html)).toContain(TEXTS.queued);
        expect(visibleText(html)).not.toContain(TEXTS.offline);
      }
    }
  });

  it("10.1 ingen knapp er låst i vanlig tilstand (suggested, på nett)", () => {
    const buttons = buttonsIn(render());
    expect(buttons.map((b) => b.text).sort()).toEqual(
      [TEXTS.use, TEXTS.keep, TEXTS.newSuggestion].sort(),
    );
    expect(buttons.some((button) => button.disabled)).toBe(false);
  });
});

describe("forslagskortet: nytt forslag gav no_match eller feil (10.10, A164)", () => {
  it.each([
    { outcome: "no_match" as const, message: TEXTS.noMatch },
    { outcome: "error" as const, message: TEXTS.error },
  ])(
    "$outcome: det gamle forslaget vises fortsatt sammen med meldingen",
    ({ outcome, message }) => {
      const html = render({
        outcome,
        suggestionText: null,
        status: null,
        staleSuggestion: { text: OLD_SUGGESTION, status: "suggested" },
      });
      const visible = visibleText(html);
      expect(visible).toContain(OLD_SUGGESTION);
      expect(visible).toContain(message);
      expect(labels(html)).toContain(TEXTS.use);
    },
  );
});

describe("forslagskortet: trygg visning (10.11–10.14)", () => {
  it("10.11 forslaget og egen tekst med HTML vises som tekst, aldri som element", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const html = render({ suggestionText: `Forslag ${evil}`, ownText: `Egen ${evil}` });
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<[a-z][^>]*\sonerror=/i);
    expect(html.match(/&lt;img/g)?.length).toBe(2);
  });

  it("10.12 ingen meny: ingen select, role=menu eller knapp med teksten «Mer»", () => {
    for (const overrides of [
      {},
      { status: "accepted" as const },
      { status: "rejected" as const },
    ]) {
      const html = render(overrides);
      expect(html).not.toContain("<select");
      expect(html).not.toMatch(/role="menu"/);
      expect(labels(html)).not.toContain("Mer");
      expect(labels(html).some((label) => /^mer\b/i.test(label))).toBe(false);
    }
  });

  it("10.13 knappene ligger nederst i kortet, samlet etter tekstene", () => {
    const html = render();
    const buttons = buttonsIn(html);
    expect(buttons).toHaveLength(3);
    const lastText = Math.max(html.lastIndexOf(OWN), html.lastIndexOf(SUGGESTION));
    expect(buttons[0]!.index).toBeGreaterThan(lastText);
    // Mellom første og siste knapp står bare knapper (ingen tekst i mellom)
    const area = html.slice(buttons[0]!.index, buttons.at(-1)!.end);
    const withoutButtons = area.replace(/<button[^>]*>[\s\S]*?<\/button>/g, "");
    expect(visibleText(withoutButtons)).toBe("");
    // Ingen tekst etter knappene, utenom det skjermleseren leser opp (sr-only)
    const after = html.slice(buttons.at(-1)!.end).replace(/<p[^>]*sr-only[^>]*>[\s\S]*?<\/p>/g, "");
    expect(visibleText(after)).toBe("");
  });

  it.each([
    { status: "suggested" as const },
    { status: "accepted" as const },
    { status: "rejected" as const },
    { status: "edited" as const },
  ])("10.14 ingen engelske statuskoder synlige ($status)", ({ status }) => {
    const visible = visibleText(render({ status }));
    expect(visible).not.toMatch(/\b(accepted|rejected|suggested|edited|no_match|error)\b/);
  });
});

describe("suggestionView, den rene hjelpefunksjonen (10, tillegg)", () => {
  const base = props();

  it("Angre skjules når et nyere forslag finnes (accepted og rejected)", () => {
    for (const status of ["accepted", "rejected"] as const) {
      expect(suggestionView({ ...base, status }).buttons.undo).toBe(true);
      expect(suggestionView({ ...base, status, hasNewerSuggestion: true }).buttons.undo).toBe(
        false,
      );
    }
  });

  it("Nytt forslag vises for suggested og rejected, ikke for accepted og edited", () => {
    expect(suggestionView({ ...base, status: "suggested" }).buttons.newSuggestion).toBe(true);
    expect(suggestionView({ ...base, status: "rejected" }).buttons.newSuggestion).toBe(true);
    expect(suggestionView({ ...base, status: "accepted" }).buttons.newSuggestion).toBe(false);
    expect(suggestionView({ ...base, status: "edited" }).buttons.newSuggestion).toBe(false);
  });

  it("alle knappene er låst mens et kall pågår og uten nett", () => {
    expect(suggestionView({ ...base, pending: "decision" }).disabled).toBe(true);
    expect(suggestionView({ ...base, pending: "suggestion" }).disabled).toBe(true);
    expect(suggestionView({ ...base, online: false }).disabled).toBe(true);
    expect(suggestionView(base).disabled).toBe(false);
  });
});
