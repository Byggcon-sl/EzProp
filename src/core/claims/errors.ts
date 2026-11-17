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

/**
 * Regelen `reinspection_not_original`: oppdraget for ny befaring kan ikke være sakens
 * opprinnelige oppdrag. Ingenting er endret.
 */
export class ReinspectionIsOriginalAssignmentError extends Error {
  constructor() {
    super("Oppdraget er det saken gjelder. Velg et annet oppdrag for ny befaring.");
    this.name = "ReinspectionIsOriginalAssignmentError";
  }
}

/**
 * Regelen `reinspection_one_active_claim`: oppdraget er alt ny befaring for en annen sak i
 * organisasjonen (også når oppdraget ligger i papirkurven, A425). Meldingen nevner aldri hvilken
 * sak. Ingenting er endret.
 */
export class ReinspectionAlreadyLinkedError extends Error {
  constructor() {
    super("Oppdraget er allerede ny befaring for en annen sak.");
    this.name = "ReinspectionAlreadyLinkedError";
  }
}
