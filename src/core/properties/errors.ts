/**
 * Oppdraget har ingen eiendom, eller eiendommen har ikke fellesdeler (`hasCommonAreas` er usann,
 * A72). Ingenting er lagret.
 */
export class CommonAreasNotApplicableError extends Error {
  constructor() {
    super("Fellesdeler gjelder bare leilighet, eierseksjon, borettslag og aksjeleilighet.");
    this.name = "CommonAreasNotApplicableError";
  }
}
