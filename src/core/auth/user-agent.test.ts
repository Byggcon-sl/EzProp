import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROWSER_LABELS,
  DEVICE_LABELS,
  describeUserAgent,
  USER_AGENT_MAX_LENGTH,
} from "./user-agent";

/*
 * Tolking av user-agent på serveren for «Mine innlogginger»
 * (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 2, testplan avsnitt 1).
 * Regeltester som data: fasiten er tabellen i kortet. Alle user-agentene er oppdiktede tekster
 * med samme form som ekte (merket «Oppdiktet/9.9»); ingen er hentet fra ekte enheter.
 *
 * Støtter hovedmål: de ansatte (den ansatte kjenner igjen sine egne enheter og oppdager en ukjent
 * innlogging) og KI i bunnen (ingen tekst fra user-agenten slipper ut; den er persondata og når
 * aldri KI).
 */

const MARK = "Oppdiktet/9.9";

const UA = {
  macSafari: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15 ${MARK}`,
  macChrome: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 ${MARK}`,
  macFirefox: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0 ${MARK}`,
  iPadSafari: `Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1 ${MARK}`,
  iPadChrome: `Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1 ${MARK}`,
  iPadFirefox: `Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15 ${MARK}`,
  iPadEdge: `Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0.0.0 Mobile/15E148 Safari/605.1.15 ${MARK}`,
  iPhoneSafari: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1 ${MARK}`,
  windowsEdge: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0 ${MARK}`,
  windowsChrome: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 ${MARK}`,
  windowsFirefox: `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0 ${MARK}`,
  androidChrome: `Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 ${MARK}`,
  androidEdge: `Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0.0.0 ${MARK}`,
};

const UNKNOWN = { device: "Ukjent enhet", browser: "Ukjent nettleser" };

// 1.1 Fasit fra kortet, Omfang 2
const CASES: [string, string, { device: string; browser: string }][] = [
  ["Macintosh + Version/… Safari", UA.macSafari, { device: "iPad eller Mac", browser: "Safari" }],
  ["Macintosh + Chrome", UA.macChrome, { device: "Mac", browser: "Chrome" }],
  ["Macintosh + Firefox", UA.macFirefox, { device: "Mac", browser: "Firefox" }],
  ["iPad + Safari", UA.iPadSafari, { device: "iPad", browser: "Safari" }],
  ["iPad + CriOS", UA.iPadChrome, { device: "iPad", browser: "Chrome" }],
  ["iPad + FxiOS", UA.iPadFirefox, { device: "iPad", browser: "Firefox" }],
  ["iPad + EdgiOS", UA.iPadEdge, { device: "iPad", browser: "Edge" }],
  ["iPhone + Safari", UA.iPhoneSafari, { device: "iPhone", browser: "Safari" }],
  ["Windows + Edg/ (har også Chrome/ og Safari/)", UA.windowsEdge, { device: "Windows-PC", browser: "Edge" }],
  ["Windows + Chrome", UA.windowsChrome, { device: "Windows-PC", browser: "Chrome" }],
  ["Windows + Firefox", UA.windowsFirefox, { device: "Windows-PC", browser: "Firefox" }],
  ["Android + Chrome", UA.androidChrome, { device: "Android", browser: "Chrome" }],
  ["Android + EdgA", UA.androidEdge, { device: "Android", browser: "Edge" }],
];

const GARBAGE: [string, string | null][] = [
  ["null", null],
  ["tom tekst", ""],
  ["bare mellomrom", "   "],
  ["søppel «x»", "x"],
  ["søppel «<script>»", "<script>"],
];

/** Fast frø, så de «tilfeldige» tekstene er like hver gang (mulberry32). */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTexts(count: number): string[] {
  const random = seededRandom(20261117);
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ;/()<>.:_-æøåÆØÅ";
  const words = ["iPad", "Macintosh", "Windows", "Android", "Chrome/", "Safari/", "Edg/", "CriOS"];
  return Array.from({ length: count }, () => {
    const length = 1 + Math.floor(random() * 300);
    let text = "";
    while (text.length < length) {
      text +=
        random() < 0.15
          ? words[Math.floor(random() * words.length)]
          : alphabet[Math.floor(random() * alphabet.length)];
    }
    return text;
  });
}

describe("1.1 fasit for describeUserAgent", () => {
  it.each(CASES)("%s", (_name, ua, expected) => {
    expect(describeUserAgent(ua)).toEqual(expected);
  });

  it.each(GARBAGE)("%s gir Ukjent enhet og Ukjent nettleser", (_name, ua) => {
    expect(describeUserAgent(ua)).toEqual(UNKNOWN);
  });
});

describe("1.2 rekkefølge og sikkerhet", () => {
  it("1. Edge før Firefox før Chrome før Safari", () => {
    const base = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    expect(describeUserAgent(`${base} Firefox/140.0 Edg/140.0`).browser).toBe("Edge");
    expect(describeUserAgent(`${base} Chrome/140.0 Firefox/140.0`).browser).toBe("Firefox");
    expect(describeUserAgent(`${base} Chrome/140.0 Safari/537.36`).browser).toBe("Chrome");
    expect(describeUserAgent(`${base} Version/18.1 Safari/605.1.15`).browser).toBe("Safari");
  });

  it("2. svaret er alltid en fast verdi, også for tilfeldige tekster (fast frø)", () => {
    const devices = new Set<string>(Object.values(DEVICE_LABELS));
    const browsers = new Set<string>(Object.values(BROWSER_LABELS));
    for (const label of ["iPad eller Mac", "Mac", "iPad", "iPhone", "Windows-PC", "Android", "Ukjent enhet"]) {
      expect(devices.has(label), `DEVICE_LABELS har «${label}»`).toBe(true);
    }
    for (const label of ["Safari", "Chrome", "Firefox", "Edge", "Ukjent nettleser"]) {
      expect(browsers.has(label), `BROWSER_LABELS har «${label}»`).toBe(true);
    }
    const inputs: (string | null)[] = [
      ...CASES.map(([, ua]) => ua),
      ...GARBAGE.map(([, ua]) => ua),
      ...randomTexts(20),
    ];
    for (const ua of inputs) {
      const result = describeUserAgent(ua);
      expect(devices.has(result.device), `enhet «${result.device}» er fast`).toBe(true);
      expect(browsers.has(result.browser), `nettleser «${result.browser}» er fast`).toBe(true);
    }
  });

  it("2. ingen tekst fra inndata slipper gjennom", () => {
    const result = describeUserAgent(
      `Mozilla/5.0 (Macintosh<img src=x onerror=alert(1)>; Intel Mac OS X) ${MARK}`,
    );
    expect(["Mac", "iPad eller Mac"]).toContain(result.device);
    expect(JSON.stringify(result)).not.toContain("<img");
    expect(JSON.stringify(result)).not.toContain(MARK);
  });

  it("3. inndata kuttes til 512 tegn", () => {
    expect(USER_AGENT_MAX_LENGTH).toBe(512);
    expect(describeUserAgent(`${"a".repeat(512)}iPad`).device).toBe("Ukjent enhet");
    expect(describeUserAgent(`iPad${"a".repeat(600)}`).device).toBe("iPad");
    expect(describeUserAgent(`${"a".repeat(500)}iPad`).device).toBe("iPad");
  });

  it.each([
    ["vanlige tegn", "a".repeat(10_000)],
    ["åpne parenteser", "(".repeat(10_000)],
    ["«a » gjentatt", "a ".repeat(5_000)],
    ["«Chrome/» gjentatt", "Chrome/".repeat(1_500)],
    ["iPad-tekst lang", `${UA.iPadSafari} `.repeat(70).slice(0, 10_000)],
  ])("4. 10 000 tegn (%s) er ferdig på under 50 ms med fast svar", (_name, ua) => {
    // Én oppvarming, så første kall ikke måler at modulen lastes
    describeUserAgent("x");
    const start = performance.now();
    const result = describeUserAgent(ua);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(Object.values(DEVICE_LABELS)).toContain(result.device);
    expect(Object.values(BROWSER_LABELS)).toContain(result.browser);
  });

  it("5. ingen ny avhengighet for user-agent i package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const known = [
      "ua-parser-js",
      "my-ua-parser",
      "bowser",
      "useragent",
      "express-useragent",
      "detect-browser",
      "platform",
      "device-detector-js",
      "ua-parser",
      "next-useragent",
    ];
    expect(names.filter((name) => known.includes(name) || /user-?agent|ua-?parser/i.test(name)))
      .toEqual([]);
  });

  it("5. user-agent.ts importerer bare fra egen kode", () => {
    const source = readFileSync(path.join(process.cwd(), "src/core/auth/user-agent.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    for (const name of imports) {
      expect(name, `import «${name}»`).toMatch(/^(\.|@\/)/);
    }
  });

  it("6. svaret har nøyaktig feltene device og browser (ingen os)", () => {
    for (const [, ua] of CASES) {
      expect(Object.keys(describeUserAgent(ua)).sort()).toEqual(["browser", "device"]);
    }
    expect(Object.keys(describeUserAgent(null)).sort()).toEqual(["browser", "device"]);
  });
});
