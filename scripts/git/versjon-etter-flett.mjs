// Løser en flettekonflikt i package.json når BARE versjonslinjen er i konflikt.
// Ny versjon: den høyeste av de to, og én patch over grunnens versjon hvis grunnen er like høy eller høyere.
// Avslutter med kode 1 (uten å endre filen) hvis noe annet enn versjonen er i konflikt.
import { readFileSync, writeFileSync } from "node:fs";

const file = "package.json";
const text = readFileSync(file, "utf8");
const hunk = /<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g;
const versionLine = /^\s*"version":\s*"(\d+)\.(\d+)\.(\d+)",?\s*$/;

const parse = (side) => {
  const lines = side.split("\n").filter((l) => l.trim() !== "");
  if (lines.length !== 1) return null;
  const m = versionLine.exec(lines[0]);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

let ok = true;
let count = 0;
const out = text.replace(hunk, (_, ours, theirs) => {
  count += 1;
  const a = parse(ours); // PR-branchen
  const b = parse(theirs); // grunnen (main)
  if (!a || !b) {
    ok = false;
    return _;
  }
  const next = cmp(a, b) > 0 ? a : [b[0], b[1], b[2] + 1];
  return `  "version": "${next.join(".")}",\n`;
});

if (!ok || count === 0) {
  console.error(
    "package.json har konflikter som ikke bare gjelder versjonen. Rettes av hovedløkken.",
  );
  process.exit(1);
}
writeFileSync(file, out);
console.log("Versjon i package.json løst automatisk.");
