/*
 * Tastatursnarveiene på PC (A383, docs/funksjoner/fase2a-badet-pc-design.md avsnitt 21a). Ren
 * funksjon, testet i shortcuts.test.ts. Ingen snarvei godtar eller avviser et forslag, og ingen
 * énkastsnarvei finnes utenom «?» utenfor tekstfelt. Snarveiene tar aldri taster fra tekstfelt:
 * der flytter Alt+piltast markøren, og «?» skrives som tegn.
 * Støtter hovedmål: de ansatte (raskere på PC uten å miste noe).
 */

export type RoomShortcut = "done" | "previous" | "next" | "search" | "help";

export type ShortcutKeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Om fokus står i et felt der man skriver (input, textarea, contenteditable). */
  inTextField: boolean;
  /** Tastetrykket er en del av en sammensetting (IME). */
  isComposing?: boolean;
};

export const SHORTCUT_LIST: readonly { keys: string; text: string }[] = [
  { keys: "Ctrl/Cmd + Enter", text: "Ferdig med punktet (lagrer det som venter først)" },
  { keys: "Alt + pil opp / pil ned", text: "Forrige eller neste punkt (ikke i tekstfelt)" },
  { keys: "Ctrl/Cmd + K", text: "Søk etter avvik" },
  { keys: "?", text: "Vis snarveiene (ikke i tekstfelt)" },
];

export function shortcutFor(event: ShortcutKeyEvent): RoomShortcut | null {
  if (event.isComposing) return null;
  const command = event.ctrlKey || event.metaKey;
  if (command && !event.altKey && event.key === "Enter") return "done";
  if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
    return "search";
  }
  if (event.inTextField) return null;
  if (event.altKey && !command && !event.shiftKey) {
    if (event.key === "ArrowUp") return "previous";
    if (event.key === "ArrowDown") return "next";
  }
  if (!command && !event.altKey && event.key === "?") return "help";
  return null;
}

/** Om elementet er et felt der man skriver. Radioknapper og avkrysning er ikke tekstfelt. */
export function isTextField(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return !["radio", "checkbox", "button", "submit", "reset", "range", "color", "file"].includes(
      type,
    );
  }
  return (element as HTMLElement).isContentEditable === true;
}
