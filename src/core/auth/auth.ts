import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import type { MicrosoftEntraIDProfile } from "better-auth/social-providers";
import { emailOTP } from "better-auth/plugins/email-otp";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { hasActiveEmployment } from "@/core/access";
import { sendEmail } from "@/core/email";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import { checkAndRecordAttempt, recordLoginSucceeded, throttleMessage } from "./login-throttle";
import {
  checkMicrosoftProfile,
  getMicrosoftLoginConfig,
  MICROSOFT_ERROR_CALLBACK_PATH,
  MICROSOFT_LOGIN_SCOPES,
  MICROSOFT_PROVIDER_ID,
  type MicrosoftIdTokenClaims,
  type MicrosoftLoginConfig,
  type MicrosoftRejectionReason,
} from "./microsoft-login";
import { OTP_MINUTES, otpEmail } from "./otp-email";

const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

const REQUEST_CODE_PATH = "/email-otp/send-verification-otp";
const SIGN_IN_PATH = "/sign-in/email-otp";

/**
 * Endepunkter i Better Auth vi ikke bruker, er stengt: andre kode-endepunkter (så koden bare kan
 * prøves der sperren gjelder), og kobling, frakobling og tokens for Microsoft (ADR 0008 punkt 14).
 * Ingen kobler til eller fra selv, så ingenting slettes i `accounts` (regel 3).
 */
const CLOSED_PATHS = [
  "/link-social",
  "/unlink-account",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
];
const SOCIAL_SIGN_IN_PATH = "/sign-in/social";

function isClosedPath(path: string, body: unknown): boolean {
  if (CLOSED_PATHS.includes(path)) return true;
  if (path === SOCIAL_SIGN_IN_PATH) {
    // Bare omdirigeringsflyten til Microsoft er åpen; ikke ID-token fra klienten, ikke andre
    const { idToken, provider } = (body ?? {}) as { idToken?: unknown; provider?: unknown };
    return idToken !== undefined || provider !== MICROSOFT_PROVIDER_ID;
  }
  return (
    (path.startsWith("/email-otp/") || path.startsWith("/forget-password/")) &&
    path !== REQUEST_CODE_PATH
  );
}

function emailFromBody(body: unknown): string | null {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email.trim() !== "" ? email : null;
}

/** Logger en avvist Microsoft-innlogging med bare årsakskoden (A215). */
function logMicrosoftRejected(reason: MicrosoftRejectionReason) {
  logger.warn("Microsoft-innlogging avvist", { reason });
}

/** Om databasekallet skjer i tilbakekallet fra Microsoft (`/callback/microsoft`). */
function isMicrosoftCallback(ctx: unknown): boolean {
  const c = ctx as { path?: unknown; params?: { id?: unknown } } | null | undefined;
  if (!c || typeof c.path !== "string") return false;
  if (c.path === `/callback/${MICROSOFT_PROVIDER_ID}`) return true;
  return c.path.startsWith("/callback/") && c.params?.id === MICROSOFT_PROVIDER_ID;
}

/**
 * Leser ID-tokenet fra Microsoft og kjører vår egen sperre før noe slås opp (ADR 0008 punkt 3
 * og 17). Tokenet kommer rett fra Microsofts token-adresse over TLS med klienthemmeligheten, så
 * signaturen sjekkes ikke; `aud`, `iss` og `exp` sjekkes i `checkMicrosoftProfile`. Avvist gir
 * `null`, som Better Auth sender videre til `/logg-inn?error=…`. Navn og bilde brukes ikke.
 */
function microsoftUserInfo(config: MicrosoftLoginConfig) {
  return async (tokens: { idToken?: string | undefined }) => {
    if (!tokens.idToken) {
      logMicrosoftRejected("invalid_token");
      return null;
    }
    let claims: MicrosoftIdTokenClaims;
    try {
      claims = decodeJwt(tokens.idToken);
    } catch {
      logMicrosoftRejected("invalid_token");
      return null;
    }
    const check = checkMicrosoftProfile(claims, {
      tenantId: config.tenantId,
      clientId: config.clientId,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (!check.ok) {
      logMicrosoftRejected(check.reason);
      return null;
    }
    return {
      user: { name: "", email: check.email, emailVerified: false },
      // `oid` er konto-id-en (`accountSubject` i Better Auth). Ingenting annet fra tokenet.
      data: { oid: check.oid } as MicrosoftEntraIDProfile,
    };
  };
}

/** Microsoft-leverandøren, bare når oppsettet er komplett og gyldig (A219). */
function microsoftProvider(config: MicrosoftLoginConfig | null) {
  if (!config) return {};
  return {
    microsoft: {
      tenantId: config.tenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      disableSignUp: true,
      disableDefaultScope: true,
      scope: [...MICROSOFT_LOGIN_SCOPES],
      disableProfilePhoto: true,
      getUserInfo: microsoftUserInfo(config),
    },
  };
}

/** Tokens fra Microsoft lagres ikke (A218). */
const NO_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
};

/** Kobler logglinjene fra Better Auth til vår logger. Bare meldingen og navnet på en feil. */
function logFromBetterAuth(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  ...args: unknown[]
) {
  const error = args.find((arg): arg is Error => arg instanceof Error);
  logger[level](`Innlogging: ${message}`, error ? { errorName: error.name } : undefined);
}

/**
 * Innlogging med e-post og engangskode, som i Optiplan. Ingen passord.
 * Nye brukere opprettes ikke her (`disableSignUp`): en person må være lagt inn som ansatt av
 * admin (eller av seed) før koden sendes. Felles innlogging med Optiplan avgjøres i fase 0b (ADR).
 *
 * Logg inn med Microsoft 365 (ADR 0008) når oppsettet er komplett: én tenant, ingen ny bruker,
 * kobling på e-post første gang og deretter på `oid`, aktivt ansattforhold ved hver innlogging.
 * Engangskoden er reserven og er uendret (regel 11).
 */
const microsoftConfig = getMicrosoftLoginConfig();

export const auth = betterAuth({
  secret: getEnv().BETTER_AUTH_SECRET,
  baseURL: getEnv().BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  logger: { log: logFromBetterAuth },
  // Adresser utenfor appen (`callbackURL`, `errorCallbackURL`) følges aldri. Better Auth slår
  // sjekken av når NODE_ENV er «test»; den står på her, så testene prøver det samme som drift.
  advanced: { disableOriginCheck: false },
  onAPIError: { errorURL: MICROSOFT_ERROR_CALLBACK_PATH },
  socialProviders: microsoftProvider(microsoftConfig),
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: [MICROSOFT_PROVIDER_ID],
      // Entra sender normalt ikke `email_verified`, og ansatte lagt inn av admin har ikke
      // bekreftet e-post. Trygt fordi brukere bare lages av admin og seed, og `tid` er sjekket.
      requireLocalEmailVerified: false,
      updateUserInfoOnLink: false,
    },
  },
  databaseHooks: {
    account: {
      create: {
        async before(account) {
          if (account.providerId !== MICROSOFT_PROVIDER_ID) return;
          // Ingen kobling for den som ikke er aktiv ansatt (samme sjekk som for økten under)
          if (!(await hasActiveEmployment(account.userId))) {
            logMicrosoftRejected("no_active_employment");
            return false;
          }
          return { data: { ...account, ...NO_TOKENS } };
        },
      },
      update: {
        async before(account) {
          // Uten `providerId` i endringen vet vi ikke hvilken konto; tokens brukes uansett ikke
          if (account.providerId !== undefined && account.providerId !== MICROSOFT_PROVIDER_ID) {
            return;
          }
          return { data: { ...account, ...NO_TOKENS } };
        },
      },
    },
    session: {
      create: {
        // Aktivt ansattforhold ved hver Microsoft-innlogging (A217). Kodeflyten får ikke sjekken.
        async before(session, ctx) {
          if (!isMicrosoftCallback(ctx)) return;
          if (!(await hasActiveEmployment(session.userId))) {
            logMicrosoftRejected("no_active_employment");
            return false;
          }
          logger.info("Microsoft-innlogging godkjent", { userId: session.userId });
        },
        // Siste innlogging, til tilgangslistene
        async after(session) {
          await db
            .update(schema.users)
            .set({ lastLoginAt: new Date() })
            .where(eq(schema.users.id, session.userId));
        },
      },
    },
  },
  hooks: {
    // Innloggingssperre (login-throttle.ts). Telles før Better Auth slår opp brukeren, så
    // svaret er likt for kjent og ukjent adresse.
    before: createAuthMiddleware(async (ctx) => {
      if (isClosedPath(ctx.path, ctx.body)) throw new APIError("NOT_FOUND");
      const action =
        ctx.path === REQUEST_CODE_PATH
          ? "request_code"
          : ctx.path === SIGN_IN_PATH
            ? "sign_in"
            : null;
      if (!action) return;
      const email = emailFromBody(ctx.body);
      if (!email) return;
      const decision = await checkAndRecordAttempt(email, action);
      if (decision.blocked) {
        throw new APIError("TOO_MANY_REQUESTS", {
          message: throttleMessage(decision.reason, decision.retryAt),
        });
      }
    }),
    // Riktig kode nullstiller sperren for adressen
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGN_IN_PATH || !ctx.context.newSession) return;
      const email = emailFromBody(ctx.body);
      if (email) await recordLoginSucceeded(email);
    }),
  },
  session: {
    expiresIn: THIRTY_DAYS_IN_SECONDS,
    updateAge: 60 * 60 * 24,
  },
  // Begrenser antall innloggingsforsøk. Slås av sammen med utviklings-postkassen (bare lokalt).
  rateLimit: {
    enabled: getEnv().NODE_ENV === "production" && !getEnv().DEV_MAILBOX,
  },
  plugins: [
    emailOTP({
      disableSignUp: true,
      otpLength: 6,
      expiresIn: OTP_MINUTES * 60,
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") {
          throw new APIError("BAD_REQUEST", { message: "Bare innlogging er støttet." });
        }
        await sendEmail(otpEmail(email, otp));
      },
    }),
    nextCookies(),
  ],
});
