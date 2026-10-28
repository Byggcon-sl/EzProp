import type { Email, EmailSender } from "./index";

/**
 * Brukes i drift før e-post er satt opp: engangskoden til første admin skrives i serverloggen.
 * Bare `logLine` skrives (aldri mottaker, emne eller tekst). Bruker `console.info` direkte,
 * fordi loggeren fjerner koder med vilje. Alle andre mottakere gir feil.
 */
export function createServerLogSender(
  firstAdminEmail: string | undefined,
  write: (line: string) => void = console.info,
): EmailSender {
  return async (email: Email) => {
    if (!firstAdminEmail || email.to.trim().toLowerCase() !== firstAdminEmail || !email.logLine) {
      throw new Error(
        "E-post er ikke satt opp ennå. Bare første admin kan logge inn til Microsoft 365 er koblet til.",
      );
    }
    write(
      `[innlogging] ${email.logLine}. E-post er ikke satt opp ennå; se docs/drift/testmiljo-azure.md`,
    );
  };
}
