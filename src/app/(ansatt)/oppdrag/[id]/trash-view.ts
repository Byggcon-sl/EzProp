import type { TrashLine, TrashPathPart } from "@/core/buildings";
import type { TrashType } from "./trash-texts";

/*
 * Linjene i papirkurven, gjort klare på serveren (docs/funksjoner/fase2a-papirkurv-design.md
 * 4.3). Tiden regnes i norsk tid her, så PC og iPad viser det samme uansett tidssone. For parter
 * brukes bare navn, rolle og firmanavn (aldri e-post eller telefon).
 */

/** En del av en slettegruppe som kan hentes tilbake for seg (A410). */
export type TrashChildView = { type: "floor" | "room"; id: string; label: string; where: string };

export type TrashEntryView = {
  type: TrashType;
  id: string;
  /** Navnet i meldingene: «Bad», «2. etasje», «Ola Testmann». */
  label: string;
  /** Linje 1: navnet, for grupper med innholdet: «2. etasje (4 rom)». */
  title: string;
  /** Linje 2: hvor det lå, areal for etasjer, rolle og firma for parter. Tom når ingenting. */
  where: string;
  /** Linje 3 før tiden: «Fjernet av Kari Testesen » (uten navn: «Fjernet »). */
  removedPrefix: string;
  /** Tidspunktet som ISO-tekst til `<time dateTime>`. */
  removedAtIso: string;
  /** Den delen av linje 3 som står i `<time>`: «i dag 14:02». */
  removedAtText: string;
  /** «Vis rommene (4)», eller `null` uten gruppe. */
  childrenLabel: string | null;
  children: TrashChildView[];
};

/** Kjernen gir høyst så mange linjer (A413); da sier papirkurven fra. */
export const TRASH_VIEW_LIMIT = 200;

/** Om listen fra kjernen er kuttet ved grensen. */
export function isTrashTruncated(lines: readonly unknown[]): boolean {
  return lines.length >= TRASH_VIEW_LIMIT;
}

const osloParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(date: Date) {
  const map = Object.fromEntries(
    osloParts.formatToParts(date).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    day: `${map.year}-${map.month}-${map.day}`,
    date: `${map.day}.${map.month}.${map.year}`,
    time: `${map.hour}:${map.minute}`,
  };
}

/** Datoen dagen før («ÅÅÅÅ-MM-DD»), regnet uten tidssone. */
function dayBefore(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year!, month! - 1, date!));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

/** «i dag 14:02», «i går 09:15» eller «12.11.2026 08:30», i norsk tid. */
export function formatRemovedAt(removedAt: Date, now: Date): string {
  const at = parts(removedAt);
  const today = parts(now).day;
  if (at.day === today) return `i dag ${at.time}`;
  if (at.day === dayBefore(today)) return `i går ${at.time}`;
  return `${at.date} ${at.time}`;
}

/** «Hovedhus › 1. etasje (fjernet)». */
export function pathText(path: readonly TrashPathPart[]): string {
  return path.map((part) => (part.removed ? `${part.label} (fjernet)` : part.label)).join(" › ");
}

/** Areal med én desimal og komma, som på bygningsskjermen. */
function formatArea(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

function countText(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function removedPrefix(name: string | null): string {
  return name ? `Fjernet av ${name} ` : "Fjernet ";
}

/**
 * Linjene fra `listTrash` som visning. `roleLabel` gir rollen på norsk. Rekkefølgen fra kjernen
 * (nyeste først) beholdes.
 */
export function toTrashEntries(
  lines: readonly TrashLine[],
  now: Date,
  roleLabel: (role: string) => string,
): TrashEntryView[] {
  return lines.map((line): TrashEntryView => {
    const removedAtText = formatRemovedAt(line.removedAt, now);
    const common = {
      id: line.id,
      removedAtIso: line.removedAt.toISOString(),
      removedAtText,
      removedPrefix: removedPrefix(line.removedByName),
    };
    if (line.type === "party") {
      return {
        ...common,
        type: "party",
        label: line.name,
        title: line.name,
        where: [roleLabel(line.role), line.firmName].filter(Boolean).join(" · "),
        childrenLabel: null,
        children: [],
      };
    }

    const { floors, rooms } = line.contents;
    let title = line.label;
    if (line.type === "floor" && rooms > 0) title = `${line.label} (${rooms} rom)`;
    if (line.type === "building" && (floors > 0 || rooms > 0)) {
      const inside = [
        floors > 0 ? countText(floors, "etasje", "etasjer") : null,
        rooms > 0 ? `${rooms} rom` : null,
      ].filter(Boolean);
      title = `${line.label} (${inside.join(", ")})`;
    }
    const where = [
      pathText(line.path),
      line.area && line.area.bra > 0 ? `BRA ${formatArea(line.area.bra)} m²` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const children = line.children.map((child) => ({
      type: child.type,
      id: child.id,
      label: child.label,
      where: pathText(child.path),
    }));
    const childrenLabel =
      children.length === 0
        ? null
        : floors > 0
          ? `Vis etasjene og rommene (${children.length})`
          : `Vis rommene (${children.length})`;
    return { ...common, type: line.type, label: line.label, title, where, childrenLabel, children };
  });
}
