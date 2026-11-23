import { describe, expect, it } from "vitest";
import {
  BROWSER_LABELS,
  DEVICE_LABELS,
  describeUserAgent,
  USER_AGENT_MAX_LENGTH,
} from "./user-agent";

/*
 * Tolking av user-agent (docs/funksjoner/fase2a-mine-innlogginger-testplan.md avsnitt 1).
 * User-agentene er oppdiktede tekster med de mønstrene tolkingen ser etter, ikke ekte enheter.
 * Støtter hovedmål: de ansatte (kjenner igjen egne enheter i «Mine innlogginger»).
 */

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MAC_FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0";
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_CHROME =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const IPAD_FIREFOX =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15";
const IPAD_EDGE =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0 Mobile/15E148 Safari/605.1.15";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const WINDOWS_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Oppdiktet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_EDGE =
  "Mozilla/5.0 (Linux; Android 14; Oppdiktet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0";

describe("describeUserAgent: fasit", () => {
  it.each([
    ["Macintosh + Safari", MAC_SAFARI, "iPad eller Mac", "Safari"],
    ["Macintosh + Chrome", MAC_CHROME, "Mac", "Chrome"],
    ["Macintosh + Firefox", MAC_FIREFOX, "Mac", "Firefox"],
    ["iPad + Safari", IPAD_SAFARI, "iPad", "Safari"],
    ["iPad + CriOS", IPAD_CHROME, "iPad", "Chrome"],
    ["iPad + FxiOS", IPAD_FIREFOX, "iPad", "Firefox"],
    ["iPad + EdgiOS", IPAD_EDGE, "iPad", "Edge"],
    ["iPhone + Safari", IPHONE_SAFARI, "iPhone", "Safari"],
    ["Windows + Edg/", WINDOWS_EDGE, "Windows-PC", "Edge"],
    ["Windows + Chrome", WINDOWS_CHROME, "Windows-PC", "Chrome"],
    ["Windows + Firefox", WINDOWS_FIREFOX, "Windows-PC", "Firefox"],
    ["Android + Chrome", ANDROID_CHROME, "Android", "Chrome"],
    ["Android + EdgA", ANDROID_EDGE, "Android", "Edge"],
  ])("%s", (_, ua, device, browser) => {
    expect(describeUserAgent(ua)).toEqual({ device, browser });
  });

  it.each([null, "", "   ", "x", "<script>"])("ukjent: %j", (ua) => {
    expect(describeUserAgent(ua)).toEqual({
      device: "Ukjent enhet",
      browser: "Ukjent nettleser",
    });
  });
});

describe("describeUserAgent: rekkefølge og sikkerhet", () => {
  it("Edge før Firefox før Chrome før Safari", () => {
    expect(describeUserAgent("Edg/1 Firefox/2").browser).toBe("Edge");
    expect(describeUserAgent("Firefox/2 Chrome/3").browser).toBe("Firefox");
    expect(describeUserAgent("Chrome/3 Safari/4").browser).toBe("Chrome");
  });

  it("svaret er alltid en fast verdi, aldri tekst fra user-agenten", () => {
    // Enkel fast tallrekke (lineær kongruens), så testen er lik hver gang
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const alphabet = "abcXYZ/;() <>Macintosh iPad Chrome Safari Edg Firefox Android Windows";
    const random = Array.from({ length: 20 }, () =>
      Array.from({ length: 1 + (next() % 200) }, () => alphabet[next() % alphabet.length]).join(""),
    );
    for (const ua of [MAC_SAFARI, IPAD_EDGE, WINDOWS_EDGE, ...random, "Macintosh<img src=x>"]) {
      const result = describeUserAgent(ua);
      expect(DEVICE_LABELS).toContain(result.device);
      expect(BROWSER_LABELS).toContain(result.browser);
    }
    const html = describeUserAgent("Macintosh<img src=x>");
    expect(["Mac", "iPad eller Mac"]).toContain(html.device);
    expect(JSON.stringify(html)).not.toContain("<img");
  });

  it("kuttes til 512 tegn før tolking", () => {
    expect(USER_AGENT_MAX_LENGTH).toBe(512);
    expect(describeUserAgent(`${"a".repeat(512)}iPad`).device).toBe("Ukjent enhet");
    expect(describeUserAgent(`${"a".repeat(500)}iPad`).device).toBe("iPad");
  });

  it.each([
    ["vanlige tegn", "a".repeat(10_000)],
    ["parenteser", "(".repeat(5000)],
    ["a og mellomrom", "a ".repeat(5000)],
    ["Chrome/ gjentatt", "Chrome/".repeat(1500)],
  ])("10 000 tegn (%s) er ferdig på under 50 ms", (_, ua) => {
    const started = performance.now();
    const result = describeUserAgent(ua);
    expect(performance.now() - started).toBeLessThan(50);
    expect(DEVICE_LABELS).toContain(result.device);
    expect(BROWSER_LABELS).toContain(result.browser);
  });

  it("har nøyaktig feltene device og browser (ingen os)", () => {
    expect(Object.keys(describeUserAgent(IPAD_SAFARI))).toEqual(["device", "browser"]);
  });
});
