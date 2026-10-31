/** Kastes når en endring ville gitt en organisasjon uten aktiv admin (A25). */
export class LastAdminError extends Error {
  constructor() {
    super("Organisasjonen må ha minst én admin.");
    this.name = "LastAdminError";
  }
}

/** Det finnes alt en ansatt i samme organisasjon med denne innloggingen (også om hen har sluttet). */
export class DuplicateEmployeeEmailError extends Error {
  constructor() {
    super("Det finnes alt en ansatt med denne e-posten");
    this.name = "DuplicateEmployeeEmailError";
  }
}

/** Navnet er brukt av et annet aktivt kontor i organisasjonen. */
export class DuplicateOfficeNameError extends Error {
  constructor() {
    super("Det finnes alt et kontor med dette navnet");
    this.name = "DuplicateOfficeNameError";
  }
}

/** Org.nr. er brukt av et annet aktivt selskap i organisasjonen. */
export class DuplicateOrgNumberError extends Error {
  constructor() {
    super("Det finnes alt et selskap med dette org.nr.");
    this.name = "DuplicateOrgNumberError";
  }
}

/**
 * Sjekker om feilen er brudd på en unik indeks med navnet `constraint`. Drizzle pakker feilen
 * fra PostgreSQL inn i `cause`, så hele kjeden gjennomgås.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint_name === constraint) return true;
    current = candidate.cause;
  }
  return false;
}
