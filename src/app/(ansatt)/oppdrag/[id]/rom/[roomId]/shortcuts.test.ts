import { describe, expect, it } from "vitest";
import { shortcutFor, type ShortcutKeyEvent } from "./shortcuts";

/*
 * Snarveiene på PC (A383, design avsnitt 21a, testplanen B6.13a). Ingen snarvei godtar eller
 * avviser et forslag, og snarveiene tar aldri taster fra tekstfelt (Alt+pil flytter markøren, «?»
 * skrives som tegn). Støtter hovedmål: de ansatte.
 */

function key(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    inTextField: false,
    ...overrides,
  };
}

describe("shortcutFor", () => {
  it.each([
    ["Ctrl+Enter", key({ key: "Enter", ctrlKey: true }), "done"],
    ["Cmd+Enter", key({ key: "Enter", metaKey: true }), "done"],
    ["Ctrl+Enter i tekstfelt", key({ key: "Enter", ctrlKey: true, inTextField: true }), "done"],
    ["Ctrl+K", key({ key: "k", ctrlKey: true }), "search"],
    ["Cmd+K i tekstfelt", key({ key: "K", metaKey: true, inTextField: true }), "search"],
    ["Alt+pil opp", key({ key: "ArrowUp", altKey: true }), "previous"],
    ["Alt+pil ned", key({ key: "ArrowDown", altKey: true }), "next"],
    ["?", key({ key: "?", shiftKey: true }), "help"],
  ] as const)("%s gir %s", (_name, event, expected) => {
    expect(shortcutFor(event)).toBe(expected);
  });

  it.each([
    [
      "Alt+pil ned i tekstfelt flytter markøren",
      key({ key: "ArrowDown", altKey: true, inTextField: true }),
    ],
    ["? i tekstfelt skrives som tegn", key({ key: "?", inTextField: true })],
    ["Enter alene", key({ key: "Enter" })],
    ["mellomrom", key({ key: " " })],
    ["G", key({ key: "g" })],
    ["A", key({ key: "a" })],
    ["pil ned uten Alt", key({ key: "ArrowDown" })],
    ["Ctrl+Alt+Enter", key({ key: "Enter", ctrlKey: true, altKey: true })],
    ["sammensetting (IME)", key({ key: "Enter", ctrlKey: true, isComposing: true })],
  ] as const)("%s gir ingen snarvei", (_name, event) => {
    expect(shortcutFor(event)).toBeNull();
  });

  it("ingen snarvei godtar eller avviser et forslag", () => {
    const all = ["Enter", " ", "g", "G", "a", "A", "d", "D", "y", "n"].flatMap((k) =>
      [false, true].map((inTextField) => shortcutFor(key({ key: k, inTextField }))),
    );
    expect(all.every((result) => result === null)).toBe(true);
  });
});
