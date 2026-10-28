import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sendEmail } from "@/core/email";
import { getEnv } from "@/shared/config/env";
import { OTP_MINUTES, otpEmail } from "./otp-email";

const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

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
