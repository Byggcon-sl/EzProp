import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalSecret = z.preprocess(emptyToUndefined, z.string().trim().optional());
const flag = z.preprocess(
  emptyToUndefined,
  z
    .enum(["0", "1"])
    .default("0")
    .transform((value) => value === "1"),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL mangler"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET må være minst 32 tegn"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  /** Utviklings-postkassen (/dev/epost). Bare lokalt. */
  DEV_MAILBOX: flag,
  /*
   * E-post: lokalt brukes DEV_MAILBOX. I drift skrives engangskoden til første admin i
   * serverloggen til alle fire (de tre Graph-verdiene og MAIL_FROM) er satt. E-post via
   * Microsoft 365 (Graph), som i Optiplan, kobles til i fase 0b. De fire må settes sammen.
   * Tomme verdier regnes som ikke satt.
   */
  MS_GRAPH_TENANT_ID: optionalSecret,
  MS_GRAPH_CLIENT_ID: optionalSecret,
  MS_GRAPH_CLIENT_SECRET: optionalSecret,
  MAIL_FROM: z.preprocess(
    emptyToUndefined,
    z.email("MAIL_FROM må være en e-postadresse").optional(),
  ),
  /** Første admin (lages av seed). */
  SEED_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().optional()),
  SEED_ADMIN_NAME: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  /** Nøkkelen for synktjenesten i prøven uten nett. Selve sjekken av den ligger i `sync-token.ts`. */
  POWERSYNC_JWT_SECRET: optionalSecret,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Leser og validerer miljøvariabler. Kaster med tydelig melding hvis noe mangler. */
export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Ugyldige miljøvariabler: ${z.prettifyError(parsed.error)}`);
    }
    // Utviklings-postkassen viser innloggingskoder åpent, så den tillates bare lokalt.
    const host = new URL(parsed.data.BETTER_AUTH_URL).hostname;
    if (parsed.data.DEV_MAILBOX && host !== "localhost" && host !== "127.0.0.1") {
      throw new Error("DEV_MAILBOX kan bare brukes når BETTER_AUTH_URL er localhost");
    }
    const graph = [
      parsed.data.MS_GRAPH_TENANT_ID,
      parsed.data.MS_GRAPH_CLIENT_ID,
      parsed.data.MS_GRAPH_CLIENT_SECRET,
    ];
    if (graph.some(Boolean) && (!graph.every(Boolean) || !parsed.data.MAIL_FROM)) {
      throw new Error(
        "E-post via Microsoft 365 er bare delvis satt opp. MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET og MAIL_FROM må alle være satt.",
      );
    }
    // Synktjenesten får nøkkelen sin; den skal aldri kunne lage innloggingsøkter (småfunn 14).
    if (
      parsed.data.POWERSYNC_JWT_SECRET !== undefined &&
      parsed.data.POWERSYNC_JWT_SECRET === parsed.data.BETTER_AUTH_SECRET.trim()
    ) {
      throw new Error(
        "POWERSYNC_JWT_SECRET kan ikke være lik BETTER_AUTH_SECRET. Bruk en egen nøkkel for synktjenesten.",
      );
    }
    cached = parsed.data;
  }
  return cached;
}

/** Tømmer hurtiglageret, så miljøvariablene leses på nytt. Bare for tester. */
export function resetEnvCache() {
  cached = undefined;
}
