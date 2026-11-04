/** Ordren er alt avvist eller gjort om til oppdrag. Ingenting er endret. */
export class OrderAlreadyHandledError extends Error {
  constructor() {
    super("Ordren er allerede behandlet.");
    this.name = "OrderAlreadyHandledError";
  }
}

/** Kontoret finnes ikke i organisasjonen, eller er slettet. */
export class OfficeNotFoundError extends Error {
  constructor() {
    super("Kontoret finnes ikke.");
    this.name = "OfficeNotFoundError";
  }
}
