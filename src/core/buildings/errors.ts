/** En ny bygning krever aktiv eiendom på oppdraget. Ingenting er lagret. */
export class PropertyMissingError extends Error {
  constructor() {
    super("Legg inn eiendommen før du legger til bygninger.");
    this.name = "PropertyMissingError";
  }
}
