/*
 * Feilene fra filtjenesten. Meldingene er på norsk og inneholder aldri sti, lagringsnøkkel,
 * tilkoblingsstreng eller annen hemmelighet, slik at de trygt kan logges og vises.
 */

/** Filen finnes ikke, er merket som slettet eller tilhører en annen organisasjon. */
export class FileNotFoundError extends Error {
  constructor() {
    super("Fant ikke filen.");
    this.name = "FileNotFoundError";
  }
}

/** Filen eller nøkkelen er ugyldig (type, størrelse, tom fil, ulovlig nøkkel). */
export class FileValidationError extends Error {
  constructor(message = "Filen er ugyldig.") {
    super(message);
    this.name = "FileValidationError";
  }
}

/** Innholdet stemmer ikke med fingeravtrykket som ble lagret. */
export class FileIntegrityError extends Error {
  constructor() {
    super("Filen er endret etter at den ble lagret.");
    this.name = "FileIntegrityError";
  }
}

/** Filen kan ikke merkes som slettet før oppbevaringstiden er ute. */
export class FileRetentionError extends Error {
  constructor() {
    super("Filen kan ikke slettes før oppbevaringstiden er ute.");
    this.name = "FileRetentionError";
  }
}

/** Det finnes alt en fil med denne nøkkelen. Filer skrives aldri over. */
export class FileAlreadyExistsError extends Error {
  constructor() {
    super("Det finnes alt en fil med denne nøkkelen.");
    this.name = "FileAlreadyExistsError";
  }
}

/** Fillagringen er ikke satt opp riktig. Meldingen nevner variabelnavnet, aldri verdien. */
export class FileStorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileStorageConfigError";
  }
}

/**
 * Fillagringen svarte med en feil. Den opprinnelige feilen legges bevisst ikke ved (heller ikke
 * som `cause`), fordi den kan inneholde nøkler, stier eller adresser med signatur.
 */
export class FileStorageError extends Error {
  constructor() {
    super("Fillagringen svarte med en feil. Prøv igjen senere.");
    this.name = "FileStorageError";
  }
}
