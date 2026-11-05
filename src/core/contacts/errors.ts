/**
 * Det finnes alt et aktivt firma med dette organisasjonsnummeret i organisasjonen. Id og navn
 * gjør at skjermen kan lenke til firmaet som finnes. Ingenting er lagret.
 */
export class FirmDuplicateError extends Error {
  readonly firmId: string;
  readonly firmName: string;

  constructor(firmId: string, firmName: string) {
    super("Et firma med dette organisasjonsnummeret finnes allerede.");
    this.name = "FirmDuplicateError";
    this.firmId = firmId;
    this.firmName = firmName;
  }
}

/** Firmaet på kontakten finnes ikke i organisasjonen, eller er slettet. */
export class FirmNotFoundError extends Error {
  constructor() {
    super("Firmaet finnes ikke.");
    this.name = "FirmNotFoundError";
  }
}
