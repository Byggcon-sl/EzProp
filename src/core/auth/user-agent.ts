/*
 * Enhet og nettleser fra user-agent, lest på serveren (docs/funksjoner/fase2a-mine-innlogginger.md,
 * Omfang 2, A425). Egen enkel tolking med en fast tabell, ingen avhengighet. Svaret er alltid en
 * av de faste verdiene under, aldri tekst fra user-agenten. Ingen KI: user-agent er persondata.
 */

/** User-agenten kuttes til så mange tegn før tolking. */
export const USER_AGENT_MAX_LENGTH = 512;

/** Faste verdier for enheten. Teksten vises i grensesnittet. */
export const DEVICE_LABELS = [
  "iPad",
  "iPad eller Mac",
  "Mac",
  "iPhone",
  "Windows-PC",
  "Android",
  "Ukjent enhet",
] as const;
export type DeviceLabel = (typeof DEVICE_LABELS)[number];

/** Faste verdier for nettleseren. Teksten vises i grensesnittet. */
export const BROWSER_LABELS = ["Edge", "Firefox", "Chrome", "Safari", "Ukjent nettleser"] as const;
export type BrowserLabel = (typeof BROWSER_LABELS)[number];

export type DescribedUserAgent = { device: DeviceLabel; browser: BrowserLabel };

function hasAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

/** Rekkefølgen er viktig: Edge og Chrome melder også Safari, og Edge melder også Chrome. */
function browserOf(ua: string): BrowserLabel {
  if (hasAny(ua, ["Edg/", "EdgiOS", "EdgA"])) return "Edge";
  if (hasAny(ua, ["Firefox/", "FxiOS"])) return "Firefox";
  if (hasAny(ua, ["Chrome/", "CriOS"])) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  return "Ukjent nettleser";
}

function deviceOf(ua: string, browser: BrowserLabel): DeviceLabel {
  if (ua.includes("iPad")) return "iPad";
  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("Windows")) return "Windows-PC";
  if (ua.includes("Macintosh")) {
    // Safari på iPad melder seg som Mac. Uten berøringsinfo kan serveren ikke skille dem.
    return browser === "Safari" ? "iPad eller Mac" : "Mac";
  }
  return "Ukjent enhet";
}

/**
 * Enhet og nettleser fra user-agenten. Kutter til `USER_AGENT_MAX_LENGTH` tegn først, og bruker
 * bare `includes` (ingen regex, så ingen ReDoS). Tom eller ukjent tekst gir «Ukjent enhet» og
 * «Ukjent nettleser».
 */
export function describeUserAgent(ua: string | null): DescribedUserAgent {
  const text = (ua ?? "").slice(0, USER_AGENT_MAX_LENGTH);
  const browser = browserOf(text);
  return { device: deviceOf(text, browser), browser };
}
