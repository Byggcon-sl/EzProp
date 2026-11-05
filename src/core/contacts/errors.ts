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

/**
 * Kontakten som skal kobles til en part eller en ordre, finnes ikke i organisasjonen, eller er
 * slettet. Ingenting er lagret.
 */
export class ContactNotFoundError extends Error {
  constructor() {
    super("Kontakten finnes ikke.");
    this.name = "ContactNotFoundError";
  }
}

/**
 * Sammenslåing med samme kontakt (eller samme firma) på begge sider. Sjekkes før databasen, så
 * ingenting er endret.
 */
export class MergeSameRecordError extends Error {
  readonly kind: "contact" | "firm";

  constructor(kind: "contact" | "firm") {
    super(kind === "contact" ? "Velg to ulike kontakter." : "Velg to ulike firma.");
    this.name = "MergeSameRecordError";
    this.kind = kind;
  }
}
