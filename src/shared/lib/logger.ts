/*
 * Strukturert logging (som i Optiplan): én JSON-linje per hendelse på
 * standard ut (info) eller standard feil (warn/error), med nivå, tid, melding og felt som rute,
 * bruker-id og referansekode. Hostingen samler linjene; ingen ekstern tjeneste.
 *
 * Aldri personopplysninger eller hemmeligheter i loggen: felt med følsomme navn (e-post, navn,
 * telefon, passord, token, cookie …) fjernes, og e-postadresser, telefonnumre, «Bearer»-tokener
 * og parameterne i databasefeil vaskes bort fra tekst. Bruk bruker-id, aldri e-post.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = {
  /** Ruten, f.eks. «/styre/[organizationId]». Ikke hele adressen (den kan ha søkeord o.l.). */
  route?: string;
  method?: string;
  /** Bruker-id (aldri e-post eller navn). */
  userId?: string | null;
  /** Referansekoden brukeren ser på feilsiden. */
  ref?: string;
  error?: unknown;
  [key: string]: unknown;
};

export const REDACTED = "[fjernet]";

/** Feltnavn som aldri skal i loggen (sammenlignes uten store bokstaver, «-» og «_»). */
const SENSITIVE_KEY =
  /^(e?mail|epost|emailaddress|to|from|cc|bcc|name|navn|fullname|firstname|lastname|phone|telefon|mobil|mobile|address|adresse|ip|ipaddress|useragent|password|passord|secret|clientsecret|token|accesstoken|refreshtoken|apikey|authorization|cookie|cookies|setcookie|otp|code|kode|session|sessiontoken|headers|body|formdata|details)$/;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.toLowerCase().replace(/[-_]/g, ""));
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
// Norske telefonnumre: +47 / 0047 foran, eller åtte siffer med mellomrom (12 34 56 78)
const PHONE = /(?:\+|00)47(?:[\s-]?\d){8}|\b\d{3} \d{2} \d{3}\b|\b\d{2} \d{2} \d{2} \d{2}\b/g;
const MAX_TEXT = 500;

/** Fjerner personopplysninger og hemmeligheter fra en tekst, og korter den ned. */
export function scrubText(text: string): string {
  // Databasefeil (Drizzle/postgres) har verdiene etter «params:»
  const withoutParams = text.replace(/params:[\s\S]*$/i, "params: " + REDACTED);
  const scrubbed = withoutParams
    .replace(EMAIL, "[e-post]")
    .replace(BEARER, "$1 " + REDACTED)
    .replace(PHONE, "[telefon]");
  return scrubbed.length > MAX_TEXT ? `${scrubbed.slice(0, MAX_TEXT)} …` : scrubbed;
}

function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { message: scrubText(String(error)) };
  const digest = (error as Error & { digest?: unknown }).digest;
  return {
    name: error.name,
    message: scrubText(error.message),
    ...(typeof digest === "string" && { digest }),
    // Bare linjene med «at …» (ikke meldingen på nytt), de første 10
    ...(error.stack && {
      stack: error.stack
        .split("\n")
        .filter((line) => line.trim().startsWith("at "))
        .slice(0, 10)
        .map((line) => scrubText(line.trim())),
    }),
  };
}

/** Vasker feltene før de logges: følsomme navn fjernes, tekst vaskes, dybden begrenses. */
export function sanitizeFields(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (depth >= 4) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeFields(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : sanitizeFields(field, depth + 1);
    }
    return out;
  }
  return String(value);
}

export type LogLine = {
  level: LogLevel;
  time: string;
  msg: string;
} & Record<string, unknown>;

/** Lager logglinjen (uten å skrive den). Egen funksjon så den kan testes. */
export function formatLogLine(level: LogLevel, msg: string, fields: LogFields = {}): LogLine {
  const { error, ...rest } = fields;
  const clean = sanitizeFields(rest) as Record<string, unknown>;
  return {
    level,
    time: new Date().toISOString(),
    msg: scrubText(msg),
    ...clean,
    ...(error !== undefined && { error: serializeError(error) }),
  };
}

type Writer = (level: LogLevel, line: string) => void;

const defaultWriter: Writer = (level, line) => {
  if (level === "warn" || level === "error") console.error(line);
  else console.log(line);
};

export function createLogger(write: Writer = defaultWriter) {
  const emit = (level: LogLevel, msg: string, fields?: LogFields) => {
    // Testene skal ikke fylle utskriften med logglinjer (med mindre de sender egen writer)
    if (write === defaultWriter && process.env.NODE_ENV === "test") return;
    try {
      write(level, JSON.stringify(formatLogLine(level, msg, fields)));
    } catch {
      // Loggingen skal aldri velte det den logger fra
    }
  };
  return {
    debug: (msg: string, fields?: LogFields) => {
      if (process.env.NODE_ENV !== "production") emit("debug", msg, fields);
    },
    info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
    warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
    error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
  };
}

/** Loggeren for serveren. Kun på serveren (bruk den ikke i klientkomponenter). */
export const logger = createLogger();
