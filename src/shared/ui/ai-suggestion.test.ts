import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AI_SUGGESTION_TEXTS,
  AiSuggestion,
  suggestionView,
  undoAfterEdit,
  type AiSuggestionProps,
  type AiSuggestionState,
} from "./ai-suggestion";

/*
 * Forslagskortet (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 10, punkt 1–14).
 * Rene tester uten database: markupen fra `renderToStaticMarkup` og hjelpefunksjonen
 * `suggestionView`. Teksten er oppdiktet.
 * Støtter hovedmål: de ansatte (samme knapper overalt, egen tekst går aldri tapt) og KI i bunnen.
 */

const OWN = "taket er gammelt og har noen sprekker";
const SUGGESTION = "Taket er gammelt og har noen sprekker.";
const USAGE_ID = "6f1c2a4e-1b7d-4c55-9a0e-3d2b1c0a9f87";

const base: AiSuggestionState = {
  ownText: OWN,
  suggestionText: SUGGESTION,
  status: "suggested",
  outcome: "ok",
  pending: null,
  online: true,
  aiEnabled: true,
  hasNewerSuggestion: false,
  staleSuggestion: null,
  aiUsageId: USAGE_ID,
};

const noop = () => {};

function render(patch: Partial<AiSuggestionState> = {}): string {
  const props: AiSuggestionProps = {
    ...base,
    ...patch,
    source: "språkvask",
    onUse: noop,
    onKeep: noop,
    onNewSuggestion: noop,
    onUndo: noop,
  };
  return renderToStaticMarkup(createElement(AiSuggestion, props));
}

/** Knappene i markupen: tekst og om de er låst. */
function buttons(html: string): { label: string; disabled: boolean }[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    label: match[2]!.replace(/<[^>]+>/g, "").trim(),
    disabled: /\sdisabled=""/.test(match[1]!),
  }));
}

function labels(html: string): string[] {
  return buttons(html).map((button) => button.label);
}

const { use, keep, newSuggestion, undo } = AI_SUGGESTION_TEXTS;

describe("forslagskortet: knapper og tekster per tilstand (10.1–10.4)", () => {
  it.each<[string, Partial<AiSuggestionState>, string[]]>([
    ["10.1 suggested, ok", {}, [use, keep, newSuggestion]],
    ["10.2 accepted", { status: "accepted" }, [undo]],
    ["10.2 edited", { status: "edited" }, [undo]],
    ["10.3 rejected", { status: "rejected" }, [undo, newSuggestion]],
    ["10.4 accepted med nyere forslag", { status: "accepted", hasNewerSuggestion: true }, []],
    [
      "10.4 rejected med nyere forslag",
      { status: "rejected", hasNewerSuggestion: true },
      [newSuggestion],
    ],
  ])("%s", (_name, patch, expected) => {
    const html = render(patch);
    expect(labels(html)).toEqual(expected);
    expect(html).toContain(OWN);
    expect(html).toContain(SUGGESTION);
    expect(html).toContain("Forslag fra KI · språkvask");
  });

  it("10.1 suggested: ingen «Angre»", () => {
    expect(labels(render())).not.toContain(undo);
  });

  it("accepted: «Din tekst før» og KI-merket", () => {
    const html = render({ status: "accepted" });
    expect(html).toContain("Din tekst før");
    expect(html).toContain("Tekst fra KI, godkjent");
  });

  it("rejected: «Du beholdt din tekst.» og forslaget nedtonet, ikke KI-merket", () => {
    const html = render({ status: "rejected" });
    expect(html).toContain("Du beholdt din tekst.");
    expect(html).toContain("opacity-70");
    expect(html).not.toContain("Tekst fra KI, godkjent");
  });
});

describe("forslagskortet: tilstander (10.5–10.10)", () => {
  it("10.5 pending: «KI jobber …», alle knappene låst, egen tekst ikke låst", () => {
    const html = render({ pending: "suggestion", suggestionText: null, status: null });
    expect(html).toContain("KI jobber …");
    const found = buttons(html);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((button) => button.disabled)).toBe(true);
    expect(html).not.toMatch(/<textarea[^>]*disabled/);
    expect(html).toContain(OWN);
  });

  it("10.5 et valg pågår: alle knappene låst", () => {
    const found = buttons(render({ pending: "decision" }));
    expect(found.map((button) => button.label)).toEqual([use, keep, newSuggestion]);
    expect(found.every((button) => button.disabled)).toBe(true);
  });

  it("10.6 no_match", () => {
    const html = render({ outcome: "no_match", suggestionText: null, status: null });
    expect(html).toContain("KI hadde ikke noe forslag. Teksten din er uendret.");
    expect(labels(html)).toEqual([newSuggestion]);
  });

  it("10.7 error", () => {
    const html = render({ outcome: "error", suggestionText: null, status: null });
    expect(html).toContain("KI svarte ikke. Prøv igjen.");
    expect(html).toContain("bg-amber-50");
    expect(labels(html)).toEqual([newSuggestion]);
  });

  it("10.8 KI av: «KI er av.» og ingen knapp", () => {
    const html = render({ aiEnabled: false });
    expect(html).toContain("KI er av.");
    expect(labels(html)).toEqual([]);
  });

  it("10.9 uten nett: «Krever nett …» og knappen for nytt forslag låst", () => {
    const html = render({ online: false, outcome: "error", suggestionText: null, status: null });
    expect(html).toContain("Krever nett. Teksten din er lagret og kan skrives videre.");
    const found = buttons(html);
    expect(found.map((button) => button.label)).toEqual([newSuggestion]);
    expect(found.every((button) => button.disabled)).toBe(true);
  });

  it("10.9 uten nett med forslag: forslaget står, meldingen under, alle knapper låst", () => {
    const html = render({ online: false });
    expect(html).toContain(SUGGESTION);
    expect(html).toContain("Krever nett. Teksten din er lagret og kan skrives videre.");
    expect(buttons(html).every((button) => button.disabled)).toBe(true);
  });

  it.each([
    ["no_match", "KI hadde ikke noe forslag. Teksten din er uendret."],
    ["error", "KI svarte ikke. Prøv igjen."],
  ] as const)("10.10 nytt forslag ga %s: det gamle står igjen med meldingen", (outcome, text) => {
    const html = render({
      outcome,
      suggestionText: null,
      status: null,
      staleSuggestion: { text: "Gammelt forslag om taket.", status: "suggested" },
    });
    expect(html).toContain("Gammelt forslag om taket.");
    expect(html).toContain(text);
    expect(labels(html)).toEqual([use, keep, newSuggestion]);
  });

  it("10.10 det gamle var avvist: knappene følger det gamle", () => {
    const html = render({
      outcome: "no_match",
      suggestionText: null,
      status: null,
      staleSuggestion: { text: "Gammelt forslag om taket.", status: "rejected" },
    });
    expect(labels(html)).toEqual([undo, newSuggestion]);
  });
});

describe("forslagskortet: sikkerhet og oppbygging (10.11–10.14)", () => {
  it("10.11 forslag og egen tekst vises som tekst, aldri som element", () => {
    const attack = "<img src=x onerror=alert(1)>";
    const html = render({ ownText: attack, suggestionText: attack });
    expect(html).not.toContain("<img");
    expect(html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g)).toHaveLength(2);
  });

  it("10.12 ingen meny", () => {
    for (const html of [render(), render({ status: "accepted" }), render({ status: "rejected" })]) {
      expect(html).not.toContain("<select");
      expect(html).not.toContain('role="menu"');
      expect(labels(html)).not.toContain("Mer");
    }
  });

  it("10.13 knappene ligger nederst i kortet, etter tekstene", () => {
    const html = render();
    const buttonArea = html.indexOf('data-testid="ai-suggestion-buttons"');
    expect(buttonArea).toBeGreaterThan(html.indexOf(OWN));
    expect(buttonArea).toBeGreaterThan(html.indexOf(SUGGESTION));
    expect(html.indexOf("<button")).toBeGreaterThan(buttonArea);
    expect(html).toContain("border-t");
  });

  it("10.14 ingen engelske statuskoder i markupen", () => {
    for (const status of ["suggested", "accepted", "rejected", "edited"] as const) {
      const html = render({ status });
      expect(html).not.toMatch(/\b(suggested|accepted|rejected|edited|no_match)\b/);
    }
  });

  it("«Bruk» er hovedknapp (ai, lg), de andre minst 44 pt", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*bg-ai-700[^>]*min-h-14[^>]*>Bruk<\/button>/);
    expect(html).toMatch(/<button[^>]*min-h-11[^>]*>Behold min tekst<\/button>/);
    expect(html).toMatch(/<button[^>]*min-h-11[^>]*>Nytt forslag<\/button>/);
  });

  it("to kolonner fra lg, statusområde med aria-live polite og skjult overskrift", () => {
    const html = render();
    expect(html).toContain("lg:grid-cols-2");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("assertive");
    expect(html).toMatch(/<section aria-labelledby="[^"]+">/);
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("suggestionView", () => {
  it("KI av går foran alt", () => {
    const view = suggestionView({ ...base, aiEnabled: false, pending: "suggestion" });
    expect(view.box).toEqual({ kind: "message", tone: "neutral", text: "KI er av." });
    expect(view.disabled).toBe(true);
  });

  it("melder statusendringen til skjermleseren", () => {
    expect(suggestionView(base).announcement).toBe("Forslag klart");
    expect(suggestionView({ ...base, status: "accepted" }).announcement).toBe("Forslaget er brukt");
    expect(suggestionView({ ...base, status: "rejected" }).announcement).toBe(
      "Du beholdt din tekst",
    );
    expect(suggestionView({ ...base, pending: "suggestion" }).announcement).toBe("KI jobber");
  });

  it("uten forespørsel: ingen boks og ingen knapper", () => {
    const view = suggestionView({ ...base, outcome: null, suggestionText: null, status: null });
    expect(view.box).toBeNull();
    expect(Object.values(view.buttons).some(Boolean)).toBe(false);
  });
});

describe("KI-fargene", () => {
  const css = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"),
    "utf8",
  );

  function color(name: string): string {
    const match = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`, "i").exec(css);
    if (!match) throw new Error(`mangler ${name}`);
    return match[1]!;
  }

  function luminance(hex: string): number {
    const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
    const [r, g, b] = channels.map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }

  function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light! + 0.05) / (dark! + 0.05);
  }

  it("tokenene finnes og har kontrast minst 4,5:1 (designfilen avsnitt 2)", () => {
    expect(color("ai-50")).toBe("#f3ecf8");
    expect(color("ai-200")).toBe("#d9d2ea");
    expect(contrast("#ffffff", color("ai-700"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", color("ai-900"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color("ai-50"), color("ai-900"))).toBeGreaterThanOrEqual(4.5);
  });

  it("komponentene har ingen faste hex-verdier", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    for (const file of ["ai-suggestion.tsx", "ai-text-mark.tsx"]) {
      expect(readFileSync(path.join(dir, file), "utf8")).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });
});

/*
 * KI-køen og forslag på eldre tekst (docs/funksjoner/fase2a-ki-ko-testplan.md avsnitt 5,
 * K5.1–K5.4, T-0004 og T-0005). Avtalte navn: `queued` og `currentText` i `AiSuggestionState`
 * (feltet slik det er nå; `ownText` er teksten forslaget ble laget fra), og den rene funksjonen
 * `undoAfterEdit(currentText, appliedText)`. Teksten er oppdiktet.
 * Støtter hovedmål: færre reklamasjoner (et sent forslag overskriver aldri nyere egen tekst) og
 * de ansatte (ett trykk uten nett, og «Angre» tar aldri bort det man har skrevet).
 */
const QUEUED_TEXT = "Venter på KI. Forslaget kommer når nettet er tilbake.";
const STALE_TEXT = "Forslaget gjelder teksten før du skrev videre.";
const UNDO_STATUS_ONLY_TEXT = "Statusen er satt tilbake. Teksten din er uendret.";

/** Tilstanden mens forespørselen venter i køen: ingen forslag ennå. */
const queuedState: Partial<AiSuggestionState> = {
  queued: true,
  online: false,
  outcome: null,
  suggestionText: null,
  status: null,
  currentText: OWN,
};

describe("K5.1 køtekst", () => {
  it("AI_SUGGESTION_TEXTS.queued er den faste teksten", () => {
    expect(AI_SUGGESTION_TEXTS.queued).toBe(QUEUED_TEXT);
  });

  it("kortet i tilstanden queued viser teksten og ingen «Bruk»", () => {
    const html = render(queuedState);
    expect(html).toContain(QUEUED_TEXT);
    expect(labels(html)).not.toContain(use);
    expect(suggestionView({ ...base, ...queuedState }).buttons.use).toBe(false);
  });

  it("queued med nett (sendingen er i gang) viser heller ikke «Bruk»", () => {
    const view = suggestionView({ ...base, ...queuedState, online: true });
    expect(view.buttons.use).toBe(false);
  });
});

describe("K5.2 T-0004 forslag på eldre tekst", () => {
  it.each<[string, Partial<AiSuggestionState>]>([
    ["vanlig forslag", {}],
    ["forslag fra køen", { queued: false }],
  ])(
    "%s: feltet er endret etterpå, ingen «Bruk», men «Nytt forslag» og forklaring",
    (_n, extra) => {
      const patch = { ...extra, ownText: "A", suggestionText: "A.", currentText: "A og mer" };
      const view = suggestionView({ ...base, ...patch });
      expect(view.buttons.use).toBe(false);
      expect(view.buttons.newSuggestion).toBe(true);
      const html = render(patch);
      expect(html).toContain(STALE_TEXT);
      expect(labels(html)).not.toContain(use);
      expect(labels(html)).toContain(newSuggestion);
      // Egen tekst står: ingenting i visningen erstatter den
      expect(html).not.toContain("A og mer.");
    },
  );

  it.each<[string, Partial<AiSuggestionState>]>([
    ["vanlig forslag", {}],
    ["forslag fra køen", { queued: false }],
  ])("%s: feltet uendret gir «Bruk» som før", (_n, extra) => {
    const patch = { ...extra, ownText: "A", suggestionText: "A.", currentText: "A" };
    const view = suggestionView({ ...base, ...patch });
    expect(view.buttons.use).toBe(true);
    const html = render(patch);
    expect(labels(html)).toContain(use);
    expect(html).not.toContain(STALE_TEXT);
  });

  it("forklaringen står i AI_SUGGESTION_TEXTS (fast tekst, ikke satt sammen)", () => {
    expect(Object.values(AI_SUGGESTION_TEXTS)).toContain(STALE_TEXT);
  });

  it("uten currentText (andre bruk av kortet) er alt som før", () => {
    const view = suggestionView(base);
    expect(view.buttons).toEqual({ use: true, keep: true, newSuggestion: true, undo: false });
  });
});

describe("K5.3 T-0005 «Angre» etter at teksten er endret", () => {
  it("feltet endret etter «Bruk»: bare status settes tilbake, teksten står", () => {
    expect(undoAfterEdit("Taket er gammelt og har noen sprekker. Og mose.", SUGGESTION)).toBe(
      "status_only",
    );
  });

  it("feltet uendret etter «Bruk»: gammel tekst kommer tilbake som før", () => {
    expect(undoAfterEdit(SUGGESTION, SUGGESTION)).toBe("restore");
  });

  it("meldingen er fast", () => {
    expect(Object.values(AI_SUGGESTION_TEXTS)).toContain(UNDO_STATUS_ONLY_TEXT);
  });
});

describe("K5.4 «Krever nett …» og køen", () => {
  it("i kø uten nett vises køteksten, ikke «Krever nett …»", () => {
    const view = suggestionView({ ...base, ...queuedState });
    const shownTexts = [
      view.box?.kind === "message" ? view.box.text : "",
      ...view.notes,
      view.announcement,
    ].join(" ");
    expect(shownTexts).toContain(QUEUED_TEXT);
    expect(shownTexts).not.toContain(AI_SUGGESTION_TEXTS.offline);
  });

  it("teksten offline beholdes for andre bruk av kortet (10.9 gjelder fortsatt uten kø)", () => {
    expect(AI_SUGGESTION_TEXTS.offline).toBe(
      "Krever nett. Teksten din er lagret og kan skrives videre.",
    );
    const html = render({ online: false, outcome: "error", suggestionText: null, status: null });
    expect(html).toContain(AI_SUGGESTION_TEXTS.offline);
  });
});
