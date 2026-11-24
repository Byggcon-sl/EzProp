/*
 * «Aldri»-listen (docs/adr/0006-ki-i-bunnen.md del 6, ad-7, A175): kolonner som aldri kan være
 * kilde for en feltkode på tillatt-listen til en KI-funksjon. Kontrollen ligger i
 * `findFieldSourceViolations` i features.ts og prøves av testene i src/core/ai/features/.
 *
 * GJENNOMGANG KREVES: endring i denne listen eller i tillatt-listene i features.ts krever
 * gjennomgang av sikkerhet-personvern i PR-en (A175). En kolonne fjernes aldri uten den
 * gjennomgangen. Testen har sin egen faste kopi av minimumslisten.
 *
 * Fødselsnummer står ikke her fordi ingen kolonne skal ha det; mønsteret vaskes i fritekst.
 */
export const NEVER_FIELDS: readonly string[] = [
  // contacts
  "contacts.first_name",
  "contacts.last_name",
  "contacts.email",
  "contacts.phone",
  "contacts.notes",
  // firms (enkeltpersonforetak har personnavn i firmanavnet)
  "firms.name",
  "firms.org_number",
  "firms.notes",
  // assignment_parties (partene på oppdraget)
  "assignment_parties.name",
  "assignment_parties.firm_name",
  "assignment_parties.email",
  "assignment_parties.phone",
  // orders
  "orders.address_text",
  "orders.gnr",
  "orders.bnr",
  "orders.snr",
  "orders.housing_association_name",
  "orders.ordered_by_text",
  "orders.external_ref",
  "orders.rejected_reason",
  // properties
  "properties.address",
  "properties.postal_code",
  "properties.city",
  // cadastral_units (matrikkel, borettslag og sameie)
  "cadastral_units.gnr",
  "cadastral_units.bnr",
  "cadastral_units.fnr",
  "cadastral_units.snr",
  "cadastral_units.share_number",
  "cadastral_units.association_name",
  "cadastral_units.association_org_number",
  // common_areas
  "common_areas.managing_agent",
  "common_areas.notes",
  // claims (fritekstene i reklamasjonssaken)
  "claims.claimant_text",
  "claims.description",
  "claims.building_part_text",
  // employees og users
  "employees.name",
  "users.name",
  "users.email",
  // assignments
  "assignments.internal_note",
  "assignments.number",
  // assignments: bestillingsopplysningene (ADR 0011, samme felt som på ordren)
  "assignments.address_text",
  "assignments.gnr",
  "assignments.bnr",
  "assignments.snr",
  "assignments.housing_association_name",
  "assignments.ordered_by_text",
  "assignments.external_ref",
  // Utvidet i fase 2a-1 (vask før KI)
  "assignment_team_members.handed_over_reason",
  "certifications.certificate_number",
  // Utvidet i 2a-2 «KI i veien» (sikkerhet 6): sendes aldri med fraseforslag, språkvask eller
  // sammendrag. Romnavn, etasje og bygning kan ha navn på personer («Kari sitt rom»), og
  // kostnaden hører ikke hjemme i KI-teksten (A434).
  "rooms.name",
  "floors.name",
  "report_buildings.name",
  "tgiu_details.owner_informed",
  "tgiu_details.owner_informed_at",
  "deviations.cost_amount",
  "deviations.cost_text",
  "deviations.cost_band_key",
  // Utvidet med sporet (docs/funksjoner/fase2a-tg-spor.md): fritekstbegrunnelsen ved Endre og
  // Avvis kan ha navn og opplysninger om eier. Bare koden og knappeteksten sendes.
  "rule_suggestion_decisions.override_reason",
  // Bildetekster har ingen kolonne ennå (`files` har ingen tekst). Kommer de, føres de her.
];
