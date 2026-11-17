import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AI_SUGGESTION_TEXTS } from "./ai-suggestion";
import {
  AI_SUGGESTION_GROUP_TEXTS,
  AiSuggestionGroup,
  suggestionGroupView,
  type AiSuggestionGroupProps,
  type AiSuggestionGroupRow,
} from "./ai-suggestion-group";

/*
 * Forslagskortet for flere felt (docs/funksjoner/fase2a-ki-i-veien-design.md avsnitt 5, A436 og
 * A460). Rene tester uten database: markupen og `suggestionGroupView`. Tekstene er oppdiktet.
 * Støtter hovedmål: de ansatte (hele avviket med ett trykk, felt for felt) og KI i bunnen.
 */

const STOPPED =
  "KI-svaret ble stoppet fordi det endret TG eller la til tall. Teksten din er uendret.";
const noop = () => {};

const deviationRow: AiSuggestionGroupRow = {
  key: "deviation_text",
  label: "Avvik",
  ownText: "fallet mot sluk er for lite",
  sourceText: "fallet mot sluk er for lite",
  suggestionText: "Fallet mot sluket er for lite.",
  status: "suggested",
  outcome: "ok",
  aiUsageId: "0190f0f0-0000-7000-8000-000000000001",
};
const causeRow: AiSuggestionGroupRow = {
  key: "cause_text",
  label: "Årsak",
  ownText: "Feil ved utførelse.",
  sourceText: "Feil ved utførelse.",
  suggestionText: null,
  status: null,
  outcome: "no_match",
  aiUsageId: "0190f0f0-0000-7000-8000-000000000002",
};
const consequenceRow: AiSuggestionGroupRow = {
  key: "consequence_text",
  label: "Konsekvens",
  ownText: "vann blir stående",
  sourceText: "vann blir stående",
  suggestionText: null,
  status: null,
  outcome: "stopped",
  stoppedText: STOPPED,
  aiUsageId: "0190f0f0-0000-7000-8000-000000000003",
};

const base: Omit<AiSuggestionGroupProps, "rows"> = {
  source: "språkvask av avvik 1",
  pending: null,
  online: true,
  aiEnabled: true,
  onUse: noop,
  onKeep: noop,
  onUndo: noop,
  onUseAll: noop,
  onKeepAll: noop,
  onNewSuggestion: noop,
};

function render(rows: AiSuggestionGroupRow[], patch: Partial<AiSuggestionGroupProps> = {}) {
  return renderToStaticMarkup(createElement(AiSuggestionGroup, { ...base, ...patch, rows }));
}

describe("AiSuggestionGroup: før og etter per felt", () => {
  it("én rad per felt i kortets rekkefølge, med feltnavnet og overskriften med KI", () => {
    const html = render([deviationRow, causeRow, consequenceRow]);
    expect(html).toContain("Forslag fra KI · språkvask av avvik 1");
    const order = ["Avvik", "Årsak", "Konsekvens"].map((label) => html.indexOf(`>${label}</h5>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("raden med forslag har «Bruk» og «Behold min»; uendret rad sier «Ingen endring.» uten knapper", () => {
    const view = suggestionGroupView({ ...base, rows: [deviationRow, causeRow] });
    expect(view.rows[0]?.buttons).toEqual({ use: true, keep: true, undo: false });
    expect(view.rows[1]?.buttons).toEqual({ use: false, keep: false, undo: false });
    expect(view.rows[1]?.view.box).toMatchObject({ text: AI_SUGGESTION_GROUP_TEXTS.noChange });
  });

  it("samme tekst fra KI regnes som ingen endring", () => {
    const same = { ...deviationRow, suggestionText: deviationRow.ownText };
    const view = suggestionGroupView({ ...base, rows: [same] });
    expect(view.rows[0]?.open).toBe(false);
    expect(view.rows[0]?.view.box).toMatchObject({ text: AI_SUGGESTION_GROUP_TEXTS.noChange });
  });

  it("A460: stoppet felt viser meldingen i nøytral flate, aldri teksten, og de andre kan brukes", () => {
    const view = suggestionGroupView({ ...base, rows: [deviationRow, consequenceRow] });
    expect(view.rows[1]?.stopped).toBe(true);
    expect(view.rows[1]?.view.box).toEqual({ kind: "message", tone: "neutral", text: STOPPED });
    expect(view.rows[1]?.buttons).toEqual({ use: false, keep: false, undo: false });
    expect(view.rows[0]?.open).toBe(true);
    expect(view.buttons.useAll).toBe(true);
    const html = render([deviationRow, consequenceRow]);
    expect(html).toContain(STOPPED);
    expect(html).toContain("bg-snow");
    expect(html).not.toContain("bg-watch-fill");
    expect(view.readyAnnouncement).toBe("Språkvask klar: 1 forslag, 1 stoppet.");
  });

  it("etter «Bruk»: KI-merket over forslaget og «Angre» i raden", () => {
    const used = { ...deviationRow, status: "accepted" as const };
    const view = suggestionGroupView({ ...base, rows: [used] });
    expect(view.rows[0]?.buttons).toEqual({ use: false, keep: false, undo: true });
    expect(view.rows[0]?.view.box).toMatchObject({ kind: "suggestion", showMark: true });
    const html = render([used]);
    expect(html).toContain("Tekst fra KI, godkjent");
    expect(html).toContain(">Angre<");
  });

  it("etter «Behold min»: «Angre» i raden, forslaget dempet", () => {
    const kept = { ...deviationRow, status: "rejected" as const };
    const view = suggestionGroupView({ ...base, rows: [kept] });
    expect(view.rows[0]?.buttons).toEqual({ use: false, keep: false, undo: true });
    expect(view.rows[0]?.view.box).toMatchObject({ dimmed: true });
  });

  it("feltet er endret etter forslaget: ingen «Bruk» i raden (T-0004)", () => {
    const changed = { ...deviationRow, ownText: "noe annet" };
    const view = suggestionGroupView({ ...base, rows: [changed] });
    expect(view.rows[0]?.buttons.use).toBe(false);
    expect(view.rows[0]?.open).toBe(false);
  });
});

describe("AiSuggestionGroup: bunnlinjen", () => {
  it("DOM-rekkefølge: Bruk alle, Behold min tekst, Nytt forslag; «Bruk alle» med KI-fyll og 56 pt", () => {
    const html = render([deviationRow, causeRow]);
    const footer = html.slice(
      html.lastIndexOf("<div", html.indexOf('data-testid="ai-suggestion-group-buttons"')),
    );
    const useAll = footer.indexOf(">Bruk alle<");
    const keepAll = footer.indexOf(`>${AI_SUGGESTION_TEXTS.keep}<`);
    const fresh = footer.indexOf(`>${AI_SUGGESTION_TEXTS.newSuggestion}<`);
    expect(useAll).toBeGreaterThan(0);
    expect(keepAll).toBeGreaterThan(useAll);
    expect(fresh).toBeGreaterThan(keepAll);
    expect(footer).toContain("flex-row-reverse");
    expect(footer).toMatch(/bg-ai-700[^"]*min-h-14|min-h-14[^"]*bg-ai-700/);
  });

  it("ingen åpne rader igjen: bare «Nytt forslag»", () => {
    const view = suggestionGroupView({
      ...base,
      rows: [{ ...deviationRow, status: "accepted" }, causeRow],
    });
    expect(view.buttons).toEqual({ useAll: false, keepAll: false, newSuggestion: true });
  });

  it("mens KI jobber: «KI jobber …» i hver rad og alle knapper låst", () => {
    const view = suggestionGroupView({ ...base, pending: "suggestion", rows: [deviationRow] });
    expect(view.disabled).toBe(true);
    expect(view.rows[0]?.view.box).toMatchObject({ tone: "working", text: "KI jobber …" });
    const html = render([deviationRow], { pending: "suggestion" });
    expect(html).toContain("KI jobber …");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Nytt forslag</);
  });

  it("uten nett er knappene låst", () => {
    expect(suggestionGroupView({ ...base, online: false, rows: [deviationRow] }).disabled).toBe(
      true,
    );
  });

  it("ett statusområde (polite) for kortet, aldri assertive", () => {
    const html = render([deviationRow]);
    expect(html.match(/aria-live="polite"/g)?.length).toBe(1);
    expect(html).not.toContain("assertive");
  });

  it("knappene per rad er minst 44 pt", () => {
    const html = render([deviationRow]);
    const rowButtons = html.match(/<button[^>]*aria-label="(Bruk|Behold min): Avvik"[^>]*>/g) ?? [];
    expect(rowButtons).toHaveLength(2);
    for (const button of rowButtons) expect(button).toContain("min-h-11");
  });
});

describe("AiSuggestionGroup: statisk", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "ai-suggestion-group.tsx"),
    "utf8",
  );

  it("importerer ikke src/core, src/db eller moduler", () => {
    expect(source).not.toMatch(/from\s+["']@\/(core|db|modules)/);
  });

  it("ingen faste hex-farger", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});
