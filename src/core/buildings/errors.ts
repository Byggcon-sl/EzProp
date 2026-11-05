/** En ny bygning krever aktiv eiendom på oppdraget. Ingenting er lagret. */
export class PropertyMissingError extends Error {
  constructor() {
    super("Legg inn eiendommen før du legger til bygninger.");
    this.name = "PropertyMissingError";
  }
}

/** Bygningen har aktive etasjer og kan ikke fjernes (A88). Ingenting er endret. */
export class BuildingNotEmptyError extends Error {
  constructor() {
    super("Fjern etasjene først.");
    this.name = "BuildingNotEmptyError";
  }
}

/** Etasjen har aktive rom og kan ikke fjernes (A88). Ingenting er endret. */
export class FloorNotEmptyError extends Error {
  constructor() {
    super("Fjern rommene først.");
    this.name = "FloorNotEmptyError";
  }
}
