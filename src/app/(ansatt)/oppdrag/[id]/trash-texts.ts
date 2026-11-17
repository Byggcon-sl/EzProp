/*
 * Tekstene i angre-meldingen og papirkurven (docs/funksjoner/fase2a-papirkurv-design.md 3.3 og
 * 3.4). Rene funksjoner, brukt både av «Fjern» og «Gjenopprett». Navn står bare i teksten som
 * vises, aldri i logg eller lagring.
 */

export type TrashType = "building" | "floor" | "room" | "party";

/** Hva som gikk med i en slettegruppe (A414). */
export type GroupCounts = { floors: number; rooms: number };

/** Id-en til papirkurven på bygningsskjermen og ved partene (til «Mer i papirkurven»). */
export const TRASH_ID = { structure: "papirkurv-bygninger", parties: "papirkurv-parter" } as const;

const SUBJECT: Record<TrashType, string> = {
  building: "Bygningen",
  floor: "Etasjen",
  room: "Rommet",
  party: "Parten",
};

const OBJECT: Record<TrashType, string> = {
  building: "bygningen",
  floor: "etasjen",
  room: "rommet",
  party: "parten",
};

function floorsText(count: number) {
  return `${count} ${count === 1 ? "etasje" : "etasjer"}`;
}

/** «2. etasje og 4 rom», «Hovedhus med 2 etasjer og 9 rom», eller `null` når gruppen er tom. */
function groupText(type: TrashType, label: string, counts: GroupCounts): string | null {
  if (type === "floor" && counts.rooms > 0) return `${label} og ${counts.rooms} rom`;
  if (type === "building" && (counts.floors > 0 || counts.rooms > 0)) {
    const parts = [
      counts.floors > 0 ? floorsText(counts.floors) : null,
      counts.rooms > 0 ? `${counts.rooms} rom` : null,
    ].filter(Boolean);
    return `${label} med ${parts.join(" og ")}`;
  }
  return null;
}

const NO_GROUP: GroupCounts = { floors: 0, rooms: 0 };

/** «Rommet «Bad» er fjernet.», «2. etasje og 4 rom er fjernet.» */
export function removedMessage(type: TrashType, label: string, counts = NO_GROUP): string {
  const group = groupText(type, label, counts);
  return group ? `${group} er fjernet.` : `${SUBJECT[type]} «${label}» er fjernet.`;
}

/** «Rommet «Bad» er hentet tilbake.», «2. etasje og 4 rom er hentet tilbake.» */
export function restoredMessage(type: TrashType, label: string, counts = NO_GROUP): string {
  const group = groupText(type, label, counts);
  return group ? `${group} er hentet tilbake.` : `${SUBJECT[type]} «${label}» er hentet tilbake.`;
}

/** «Rommet «Bad» er allerede tilbake.» (gjentatt kall, ingen endring). */
export function alreadyRestoredMessage(type: TrashType, label: string): string {
  return `${SUBJECT[type]} «${label}» er allerede tilbake.`;
}

/** «Fikk ikke hentet tilbake rommet. Prøv igjen, eller bruk papirkurven.» */
export function restoreFailedMessage(type: TrashType): string {
  return `Fikk ikke hentet tilbake ${OBJECT[type]}. Prøv igjen, eller bruk papirkurven.`;
}

/** Antall etasjer og rom i en liste over det som ble fjernet eller hentet tilbake. */
export function countGroup(items: readonly { type: string }[]): GroupCounts {
  return {
    floors: items.filter((item) => item.type === "floor").length,
    rooms: items.filter((item) => item.type === "room").length,
  };
}

/**
 * Teksten etter «Angre» eller «Gjenopprett». Beskjedene fra kjernen (overordnet ledd kom med,
 * nytt areal står, koblingen er borte) erstatter standardteksten, fordi de sier mer.
 */
export function restoreResultMessage(
  type: TrashType,
  label: string,
  result: { changed: boolean; notices: readonly string[]; restored: readonly { type: string }[] },
): string {
  if (!result.changed) return alreadyRestoredMessage(type, label);
  if (result.notices.length > 0) return result.notices.join(" ");
  // Gruppen er det under det som ble hentet (rommene i etasjen, etasjene og rommene i bygningen)
  const counts = countGroup(result.restored);
  if (type === "floor") counts.floors = 0;
  if (type === "room") return restoredMessage(type, label);
  return restoredMessage(type, label, counts);
}
