// Måler hvor mye JavaScript hver side laster, lest fra byggmappen `.next`.
// Next.js 16 (Turbopack) skriver ikke lenger sidestørrelser i «pnpm build»-utskriften,
// så nattløkkens størrelsessjekk bruker dette skriptet i stedet.
//
// Bruk: pnpm build && pnpm size [--limit <kB>]
//
// «Egen JS» er filene siden og layoutene dens trekker inn, utenom den delte grunnpakken
// (react-dom og Next-klientkjøringen), som alle sider laster og som vi ikke rår over.
// Grensen gjelder egen JS komprimert (gzip), fordi det er det som går over nettet.
// Skriptet avslutter med feilkode hvis en side er over grensen.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const DEFAULT_LIMIT_KB = 100;
const nextDir = join(process.cwd(), ".next");
const limitArgIndex = process.argv.indexOf("--limit");
const limitKb = limitArgIndex >= 0 ? Number(process.argv[limitArgIndex + 1]) : DEFAULT_LIMIT_KB;

if (!Number.isFinite(limitKb) || limitKb <= 0) {
  console.error("Ugyldig grense. Bruk: pnpm size --limit <kB>");
  process.exit(2);
}

let buildManifest;
try {
  buildManifest = JSON.parse(readFileSync(join(nextDir, "build-manifest.json"), "utf8"));
} catch {
  console.error("Fant ikke .next/build-manifest.json. Kjør «pnpm build» først.");
  process.exit(2);
}

const sharedFiles = new Set(buildManifest.rootMainFiles ?? []);
const sizeCache = new Map();

function measure(file) {
  if (!sizeCache.has(file)) {
    const content = readFileSync(join(nextDir, file));
    sizeCache.set(file, { raw: content.length, gzip: gzipSync(content).length });
  }
  return sizeCache.get(file);
}

function sumSizes(files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const size = measure(file);
    raw += size.raw;
    gzip += size.gzip;
  }
  return { raw, gzip };
}

function findPageManifests(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...findPageManifests(path));
    } else if (entry === "page_client-reference-manifest.js") {
      found.push(path);
    }
  }
  return found;
}

function routeFromManifest(path) {
  const rel = relative(join(nextDir, "server", "app"), path).replace(
    /\/?page_client-reference-manifest\.js$/,
    "",
  );
  const route = rel
    .split("/")
    .filter((part) => part && !/^\(.*\)$/.test(part))
    .join("/");
  return `/${route}`;
}

function ownFilesFromManifest(path) {
  const source = readFileSync(path, "utf8");
  const match = source.match(/"entryJSFiles":(\{[^{}]*\})/);
  if (!match) return new Set();
  const entries = JSON.parse(match[1]);
  const files = new Set();
  for (const chunks of Object.values(entries)) {
    for (const chunk of chunks) {
      if (!sharedFiles.has(chunk)) files.add(chunk);
    }
  }
  return files;
}

const kb = (bytes) => (bytes / 1024).toFixed(1).padStart(7);
const shared = sumSizes(sharedFiles);
const rows = findPageManifests(join(nextDir, "server", "app"))
  .map((path) => ({ route: routeFromManifest(path), own: sumSizes(ownFilesFromManifest(path)) }))
  .sort((a, b) => b.own.gzip - a.own.gzip);

console.log(`Delt grunnpakke (alle sider): ${kb(shared.raw)} kB rå / ${kb(shared.gzip)} kB gzip\n`);
console.log("Egen JS per side (rå / gzip) og første last gzip:");
const overLimit = [];
for (const { route, own } of rows) {
  const flag = own.gzip / 1024 > limitKb ? "  OVER GRENSEN" : "";
  if (flag) overLimit.push(route);
  console.log(
    `${kb(own.raw)} kB / ${kb(own.gzip)} kB   første last ${kb(own.gzip + shared.gzip)} kB   ${route}${flag}`,
  );
}

if (overLimit.length > 0) {
  console.error(`\n${overLimit.length} side(r) over grensen på ${limitKb} kB egen JS (gzip).`);
  process.exit(1);
}
console.log(`\nAlle sider under grensen på ${limitKb} kB egen JS (gzip).`);
