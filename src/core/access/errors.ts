/** Kastes når en bruker forsøker noe de ikke har tilgang til. */
export class AccessDeniedError extends Error {
  constructor(message = "Du har ikke tilgang til dette.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}
