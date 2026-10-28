import type { Email } from "@/core/email";
import { brand } from "@/shared/config/brand";

/** Hvor lenge en engangskode gjelder. */
export const OTP_MINUTES = 10;

/** E-posten med engangskoden. `logLine` brukes bare når koden skrives i serverloggen. */
export function otpEmail(to: string, otp: string): Email {
  return {
    to,
    subject: `Din innloggingskode til ${brand.productName}: ${otp}`,
    text: [
      `Koden din er: ${otp}`,
      "",
      `Skriv inn koden på innloggingssiden. Koden gjelder i ${OTP_MINUTES} minutter.`,
      "Har du ikke bedt om å logge inn, kan du se bort fra denne e-posten.",
      "",
      `Hilsen ${brand.companyName}`,
    ].join("\n"),
    logLine: `Engangskode til første admin: ${otp} (gyldig i ${OTP_MINUTES} minutter)`,
  };
}
