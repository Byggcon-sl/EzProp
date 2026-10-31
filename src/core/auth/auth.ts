import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sendEmail } from "@/core/email";
import { getEnv } from "@/shared/config/env";
import { checkAndRecordAttempt, recordLoginSucceeded, throttleMessage } from "./login-throttle";
import { OTP_MINUTES, otpEmail } from "./otp-email";

const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

const REQUEST_CODE_PATH = "/email-otp/send-verification-otp";
const SIGN_IN_PATH = "/sign-in/email-otp";

/**
 * Bare bestilling av kode og innlogging med kode er åpne. Andre kode-stier (sjekk av kode,
 * e-postbekreftelse, nytt passord) stenges, slik at koden ikke kan prøves utenom sperren.
 */
function isClosedPath(path: string): boolean {
  if (path === REQUEST_CODE_PATH) return false;
  return path.startsWith("/email-otp/") || path.startsWith("/forget-password/");
}

function emailFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const email = (body as { email?: unknown }).email;
  return typeof email === "string" && email.trim() !== "" ? email : null;
}

/**
 * Innlogging med e-post og engangskode, som i Optiplan. Ingen passord.
 * Nye brukere opprettes ikke her (`disableSignUp`): en person må være lagt inn som ansatt av
 * admin (eller av seed) før koden sendes. Felles innlogging med Optiplan avgjøres i fase 0b (ADR).
 */
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
  databaseHooks: {
    session: {
      create: {
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
    // Sperre etter mange feil (login-throttle.ts). Samme svar for kjent og ukjent adresse.
    before: createAuthMiddleware(async (ctx) => {
      if (isClosedPath(ctx.path)) {
        throw new APIError("NOT_FOUND");
      }
      const action =
        ctx.path === REQUEST_CODE_PATH
          ? "request_code"
          : ctx.path === SIGN_IN_PATH
            ? "sign_in"
            : null;
      if (!action) return;
      const email = emailFromBody(ctx.body);
      // Uten e-post avviser Better Auth selv forespørselen
      if (!email) return;
      const decision = await checkAndRecordAttempt(email, action);
      if (decision.blocked) {
        throw new APIError("TOO_MANY_REQUESTS", {
          message: throttleMessage(decision.reason, decision.retryAt),
        });
      }
    }),
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
  // Better Auths fartsgrense per IP (i minnet). Slås av sammen med utviklings-postkassen (bare lokalt).
  // Den egne sperren per adresse i login-throttle.ts gjelder alltid, også lokalt og i testene.
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
