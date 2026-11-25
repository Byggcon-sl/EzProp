/*
 * Ordmarkering: sammenligner to tekster ord for ord (lengste felles delsekvens) og gir delene som
 * er like, fjernet og lagt til, med tekst for skjermleser. Gir også en merknad når et av ordene som
 * kan snu meningen («ikke», «ingen», «uten», «bør», «må», «kan») er fjernet, lagt til eller byttet
 * (docs/funksjoner/fase2a-ga-gjennom-tekstene.md, «Ordmarkering» og «Merknad på skjermen (A610)»).
 *
 * Merknaden er en hjelp på skjermen. Den er ikke en KI-vakt og ikke en fagregel, og den stopper
 * ingenting.
 *
 * Støtter hovedmål: de ansatte (takstmannen ser nøyaktig hva som er endret, også med skjermleser),
 * færre reklamasjoner (en endret nektelse eller «bør»/«må» blir synlig før teksten brukes) og KI i
 * bunnen (KI-forslaget kontrolleres raskt før det godtas).
 *
 * Ren TypeScript uten avhengigheter, så den kan brukes både i nettleseren og på serveren.
 */

export type WordDiffPart = {
  kind: "same" | "removed" | "added";
  /** Ordene i delen, skilt med ett mellomrom. Sett ett mellomrom mellom delene ved visning. */
  text: string;
  /** Tekst for skjermleser. Tom for like deler. */
  srLabel: "" | "fjernet" | "lagt til";
};

export type WordDiffNote = {
  word: "ikke" | "ingen" | "uten" | "bør" | "må" | "kan";
  change: "removed" | "added" | "replaced";
  /** For eksempel «Sjekk: «ikke» er fjernet». */
  message: string;
};

export type WordDiff = {
  parts: WordDiffPart[];
  /** Sann når tekstene har de samme ordene (bare mellomrom eller linjeskift er endret). */
  unchanged: boolean;
  notes: WordDiffNote[];
};

/** Ordene som gir merknad når de er fjernet, lagt til eller byttet (A610). */
export const REVIEW_NOTE_WORDS: readonly WordDiffNote["word"][] = [
  "ikke",
  "ingen",
  "uten",
  "bør",
  "må",
  "kan",
];

const SR_LABEL: Record<WordDiffPart["kind"], WordDiffPart["srLabel"]> = {
  same: "",
  removed: "fjernet",
  added: "lagt til",
};

/** Ordene i teksten, delt på alle slags mellomrom og linjeskift. Tegnsetting følger ordet. */
function tokenize(text: string): string[] {
  return text
    .normalize("NFC")
    .split(/\s+/u)
    .filter((token) => token !== "");
}

/** Ordet uten tegnsetting foran og bak, med små bokstaver. «Ikke,» blir «ikke». */
function coreWord(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLocaleLowerCase("nb-NO");
}

function isNoteWord(word: string): word is WordDiffNote["word"] {
  return (REVIEW_NOTE_WORDS as readonly string[]).includes(word);
}

type Op = { kind: WordDiffPart["kind"]; token: string };

/**
 * Parene (indeks i `a`, indeks i `b`) i en lengste felles delsekvens av to tallrekker. Klassisk
 * tabell bakfra, så parene kan leses ut forfra.
 */
function lcsPairs(a: Int32Array, b: Int32Array): [number, number][] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const size = (n + 1) * width;
  // Lengden er høyst min(n, m); 16 bit holder for alle vanlige tekstfelt og halverer minnet
  const lengths = Math.min(n, m) < 0xffff ? new Uint16Array(size) : new Uint32Array(size);
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = i * width;
    const next = row + width;
    const ai = a[i]!;
    for (let j = m - 1; j >= 0; j -= 1) {
      if (ai === b[j]) {
        lengths[row + j] = lengths[next + j + 1]! + 1;
      } else {
        const down = lengths[next + j]!;
        const right = lengths[row + j + 1]!;
        lengths[row + j] = down >= right ? down : right;
      }
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * Lengste felles delsekvens på ordene. For å holde tabellen liten tas felles start og slutt ut
 * først (vanlige språkvaskede tekster er mest like), og ord som bare står i den ene teksten, tas
 * ikke med i tabellen (de kan ikke være felles). Ordene sammenlignes som tall.
 */
function diffTokens(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  // Ordene i midten som tall; bare ord som står i begge tekstene, går inn i tabellen
  const ids = new Map<string, number>();
  for (let k = start; k < endA; k += 1) if (!ids.has(a[k]!)) ids.set(a[k]!, ids.size);
  const inB = new Set<number>();
  for (let k = start; k < endB; k += 1) {
    const id = ids.get(b[k]!);
    if (id !== undefined) inB.add(id);
  }
  const keptA: number[] = [];
  for (let k = start; k < endA; k += 1) if (inB.has(ids.get(a[k]!)!)) keptA.push(k);
  const keptB: number[] = [];
  for (let k = start; k < endB; k += 1) if (ids.has(b[k]!)) keptB.push(k);
  const pairs = lcsPairs(
    Int32Array.from(keptA, (k) => ids.get(a[k]!)!),
    Int32Array.from(keptB, (k) => ids.get(b[k]!)!),
  );

  const ops: Op[] = [];
  for (let k = 0; k < start; k += 1) ops.push({ kind: "same", token: a[k]! });
  let i = start;
  let j = start;
  const emitUntil = (untilA: number, untilB: number) => {
    for (; i < untilA; i += 1) ops.push({ kind: "removed", token: a[i]! });
    for (; j < untilB; j += 1) ops.push({ kind: "added", token: b[j]! });
  };
  for (const [pa, pb] of pairs) {
    emitUntil(keptA[pa]!, keptB[pb]!);
    ops.push({ kind: "same", token: a[i]! });
    i += 1;
    j += 1;
  }
  emitUntil(endA, endB);
  for (let k = endA; k < a.length; k += 1) ops.push({ kind: "same", token: a[k]! });
  return ops;
}

/**
 * Slår sammen ordene til deler. I hver endring står det fjernede før det som er lagt til, så
 * «fuktskade,» → «fuktskade.» leses som «fjernet fuktskade, lagt til fuktskade.».
 */
function toParts(ops: readonly Op[]): WordDiffPart[] {
  const parts: WordDiffPart[] = [];
  const push = (kind: WordDiffPart["kind"], tokens: string[]) => {
    if (tokens.length === 0) return;
    parts.push({ kind, text: tokens.join(" "), srLabel: SR_LABEL[kind] });
  };
  let index = 0;
  while (index < ops.length) {
    if (ops[index]!.kind === "same") {
      const same: string[] = [];
      while (index < ops.length && ops[index]!.kind === "same") same.push(ops[index++]!.token);
      push("same", same);
    } else {
      const removed: string[] = [];
      const added: string[] = [];
      while (index < ops.length && ops[index]!.kind !== "same") {
        const op = ops[index++]!;
        (op.kind === "removed" ? removed : added).push(op.token);
      }
      push("removed", removed);
      push("added", added);
    }
  }
  return parts;
}

function countNoteWords(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    const word = coreWord(token);
    if (isNoteWord(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

/**
 * Merknadene. Et ord som står færre ganger etter enn før, er fjernet; flere ganger, lagt til. Et
 * fjernet og et lagt til ord i samme endring er byttet («bør» → «må»). Flyttes ordet, eller får
 * det stor forbokstav, er antallet det samme og det gis ingen merknad. Delord («kanal»,
 * «uteliggende») teller ikke.
 */
function notesOf(before: readonly string[], after: readonly string[], ops: readonly Op[]) {
  const countBefore = countNoteWords(before);
  const countAfter = countNoteWords(after);
  const removed = new Set<WordDiffNote["word"]>();
  const added = new Set<WordDiffNote["word"]>();
  for (const word of REVIEW_NOTE_WORDS) {
    const diff = (countAfter.get(word) ?? 0) - (countBefore.get(word) ?? 0);
    if (diff < 0) removed.add(word);
    if (diff > 0) added.add(word);
  }

  const notes: WordDiffNote[] = [];
  // Byttet: et fjernet og et lagt til merknadsord i samme endring
  let index = 0;
  while (index < ops.length) {
    if (ops[index]!.kind === "same") {
      index += 1;
      continue;
    }
    const hunkRemoved: WordDiffNote["word"][] = [];
    const hunkAdded: WordDiffNote["word"][] = [];
    while (index < ops.length && ops[index]!.kind !== "same") {
      const op = ops[index++]!;
      const word = coreWord(op.token);
      if (op.kind === "removed" && isNoteWord(word) && removed.has(word)) hunkRemoved.push(word);
      if (op.kind === "added" && isNoteWord(word) && added.has(word)) hunkAdded.push(word);
    }
    while (hunkRemoved.length > 0 && hunkAdded.length > 0) {
      const from = hunkRemoved.shift()!;
      const to = hunkAdded.shift()!;
      if (!removed.has(from) || !added.has(to)) continue;
      removed.delete(from);
      added.delete(to);
      notes.push({
        word: from,
        change: "replaced",
        message: `Sjekk: «${from}» er byttet med «${to}»`,
      });
    }
  }
  for (const word of REVIEW_NOTE_WORDS) {
    if (removed.has(word)) {
      notes.push({ word, change: "removed", message: `Sjekk: «${word}» er fjernet` });
    }
    if (added.has(word)) {
      notes.push({ word, change: "added", message: `Sjekk: «${word}» er lagt til` });
    }
  }
  return notes;
}

/**
 * Sammenligner `before` og `after` ord for ord. Like tekster, og tekster der bare mellomrom eller
 * linjeskift er endret, gir `unchanged: true`. Store og små bokstaver og tegnsetting regnes som
 * endring i markeringen («fuktskade,» mot «fuktskade.»), men ikke i merknaden.
 */
export function wordDiff(before: string, after: string): WordDiff {
  const a = tokenize(before);
  const b = tokenize(after);
  const ops = diffTokens(a, b);
  const unchanged = ops.every((op) => op.kind === "same");
  return { parts: toParts(ops), unchanged, notes: unchanged ? [] : notesOf(a, b, ops) };
}
