/**
 * Parten som er valgt som klager, finnes ikke på oppdraget i organisasjonen, eller er fjernet.
 * Ingenting er endret.
 */
export class ClaimantPartyNotFoundError extends Error {
  constructor() {
    super("Fant ikke parten på oppdraget.");
    this.name = "ClaimantPartyNotFoundError";
  }
}
