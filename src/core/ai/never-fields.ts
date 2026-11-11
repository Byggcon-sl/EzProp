/*
 * «Aldri»-kolonnene (docs/adr/0006-ki-i-bunnen.md del 6, ad-7). Ingen feltkode på en tillatt-liste
 * kan hente fra disse kolonnene. Hver funksjonsdefinisjon sier i `fieldSources` hvor hver feltkode
 * henter fra (`tabell.kolonne`, eller `free_text` for tekst skrevet av den ansatte), og
 * `fieldSourceViolations` stopper kilder i denne listen.
 *
 * Endring i tillatt-listen eller «aldri»-listen krever gjennomgang av sikkerhet-personvern i
 * PR-en (A175). En kolonne fjernes aldri fra listen uten den gjennomgangen.
 */

/** Kilden for tekst den ansatte skriver selv. Vaskes alltid før den sendes (A174). */
export const FREE_TEXT_SOURCE = "free_text";

export const NEVER_FIELDS: readonly string[] = [
  "contacts.first_name",
  "contacts.last_name",
  "contacts.email",
  "contacts.phone",
  "contacts.notes",
  "firms.name",
  "firms.org_number",
  "firms.notes",
  "assignment_parties.name",
  "assignment_parties.firm_name",
  "assignment_parties.email",
  "assignment_parties.phone",
  "orders.address_text",
  "orders.gnr",
  "orders.bnr",
  "orders.snr",
  "orders.housing_association_name",
  "orders.ordered_by_text",
  "orders.external_ref",
  "orders.rejected_reason",
  "properties.address",
  "properties.postal_code",
  "properties.city",
  "cadastral_units.gnr",
  "cadastral_units.bnr",
  "cadastral_units.fnr",
  "cadastral_units.snr",
  "cadastral_units.share_number",
  "cadastral_units.association_name",
  "cadastral_units.association_org_number",
  "common_areas.managing_agent",
  "common_areas.notes",
  "claims.claimant_text",
  "claims.description",
  "claims.building_part_text",
  "employees.name",
  "users.name",
  "users.email",
  "assignments.internal_note",
  "assignments.number",
  "assignment_team_members.handed_over_reason",
  "certifications.certificate_number",
];

const NEVER_FIELD_SET = new Set(NEVER_FIELDS);

/** Formen `tabell.kolonne` med små bokstaver, tall og understrek. */
const COLUMN_SOURCE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * Feilene i en funksjonsdefinisjon: feltkode uten kilde, kilde som ikke er `tabell.kolonne` eller
 * `free_text`, og kilde i «aldri»-listen. Tom liste betyr at definisjonen er i orden.
 */
export function fieldSourceViolations(definition: {
  code: string;
  allowedFields: readonly string[];
  fieldSources?: Readonly<Record<string, string>>;
}): string[] {
  const sources = definition.fieldSources ?? {};
  const out: string[] = [];
  for (const field of definition.allowedFields) {
    const source = Object.prototype.hasOwnProperty.call(sources, field)
      ? sources[field]
      : undefined;
    if (source === undefined || source === "") {
      out.push(`${definition.code}.${field}: mangler kilde`);
      continue;
    }
    if (source === FREE_TEXT_SOURCE) continue;
    if (!COLUMN_SOURCE.test(source)) {
      out.push(`${definition.code}.${field}: ugyldig kilde ${source}`);
      continue;
    }
    if (NEVER_FIELD_SET.has(source)) {
      out.push(`${definition.code}.${field}: kilden ${source} står på «aldri»-listen`);
    }
  }
  return out;
}
