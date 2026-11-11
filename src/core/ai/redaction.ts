/*
 * Vask før KI (docs/funksjoner/fase2a-vask-for-ki.md, punkt 2 og 3, ADR 0006 del 6).
 *
 * Hovedmål: KI i bunnen og de ansatte. All tekst vaskes her før den sendes til en leverandør, så
 * takstmannen kan skrive fritt, og navn, e-post, telefon, adresse og matrikkel sendes aldri (regel 14).
 *
 * Tre trinn: først e-post (så en adresse med et kjent navn i ikke blir delvis vasket), så de kjente
 * verdiene for oppdraget (lengste først), deretter de faste mønstrene i `@/shared/lib/pii-patterns`.
 * En verdi som er både kjent og treffer et mønster, telles én gang.
 *
 * Kjente verdier lever bare i minnet under det ene kallet: ingen mellomlagring her, og de skrives
 * aldri til logger, feilmeldinger eller svar. Feil kastes videre (A176): ingen usvasket tekst slipper
 * gjennom.
 *
 * Endring i denne filen krever gjennomgang av sikkerhet-personvern i PR-en.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignmentTeamMembers,
  assignments,
  cadastralUnits,
  commonAreas,
  contacts,
  employees,
  firms,
  orders,
  properties,
} from "@/db/schema";
import {
  normalizeForRedaction,
  PII_PLACEHOLDER,
  redactEmails,
  redactPii,
} from "@/shared/lib/pii-patterns";

export type KnownCadastralUnit = {
  gnr: string | null;
  bnr: string | null;
  fnr: string | null;
  snr: string | null;
  shareNumber: string | null;
};

export type KnownValues = {
  /** Personnavn: vaskes som hel frase og hvert ord på minst tre tegn (A174). */
  personNames: string[];
  /** Firmanavn, borettslag, sameie, forretningsfører og bestillerteksten: bare hel frase. */
  phrases: string[];
  emails: string[];
  phones: string[];
  orgNumbers: string[];
  addresses: {
    /** Hele adresser (`orders.address_text`, `properties.address`). Deles opp her. */
    full: string[];
    /** Poststed og kommunenavn, vaskes alene. */
    places: string[];
    /** Postnummer, vaskes bare sammen med et poststed. */
    postalCodes: string[];
  };
  cadastral: {
    units: KnownCadastralUnit[];
    municipalityNumbers: string[];
  };
};

export type RedactionResult = { text: string; count: number };

export function emptyKnownValues(): KnownValues {
  return {
    personNames: [],
    phrases: [],
    emails: [],
    phones: [],
    orgNumbers: [],
    addresses: { full: [], places: [], postalCodes: [] },
    cadastral: { units: [], municipalityNumbers: [] },
  };
}

// Grenser med Unicode (aldri ordgrense-forkortelsen): æ, ø og å regnes som bokstaver.
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";
// Genitiv på navn og fraser: «Hansens», «Hansen's», «Hans'».
const GENITIVE = "(?:['\u2019]s|s|['\u2019])?";
const SPACE = "[\\s\\u00A0]+";
const HYPHEN = "\\s*[-\u2010\u2013]\\s*";
const DIGIT_SEP = "[ \\u00A0.\\-]?";

const MIN_PHRASE_LENGTH = 2;
const MIN_WORD_LENGTH = 3;

const LEGAL_SUFFIX = /[\s\u00A0]+(?:AS|ASA|A\/S|BA|SA|ANS|DA|ENK|NUF|BL|SE)$/iu;

const CADASTRAL_WORDS = {
  gnr: "(?:gnr|g\\.\\s?nr|gårdsnr|gårdsnummer)",
  bnr: "(?:bnr|b\\.\\s?nr|bruksnr|bruksnummer)",
  fnr: "(?:fnr|f\\.\\s?nr|festenr|festenummer)",
  snr: "(?:snr|s\\.\\s?nr|seksjonsnr|seksjonsnummer|seksjon)",
  share: "(?:andelsnr|andelsnummer|andel\\s?nr)",
} as const;
const CADASTRAL_COMBO_WORD =
  "(?:(?:gbnr|g\\.?\\s?b\\.?\\s?nr|g/bnr|gnr|matr(?:ikkel)?(?:nr|nummer)?)\\.?:?[ \\u00A0]*)?";

type Alternative = { source: string; placeholder: string; weight: number };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Normalisert (NFC, vanlige sifre) uten usynlige tegn, trimmet, mellomrom slått sammen. `null` hvis verdien er for kort eller
 * uten bokstav/siffer.
 */
function clean(value: string | null | undefined, minLength = MIN_PHRASE_LENGTH): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeForRedaction(value)
    .replace(/[\s\u00A0]+/gu, " ")
    .trim();
  if (normalized.length < minLength) return null;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return null;
  return normalized;
}

/** Mønster for en frase: mellomrom og bindestrek er fleksible, alt annet escapes. */
function phraseSource(value: string): string {
  return value
    .split(" ")
    .map((token) =>
      token
        .split(/[-\u2010\u2013]/u)
        .map(escapeRegExp)
        .join(HYPHEN),
    )
    .join(SPACE);
}

function digitsSource(digits: string): string {
  return digits.split("").join(DIGIT_SEP);
}

function stripEdges(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function addPhrase(
  alternatives: Alternative[],
  value: string | null,
  placeholder: string,
  minLength = MIN_PHRASE_LENGTH,
): void {
  const cleaned = clean(value, minLength);
  if (!cleaned) return;
  alternatives.push({
    source: `${START}${phraseSource(cleaned)}${GENITIVE}${END}`,
    placeholder,
    weight: cleaned.length,
  });
}

function addPersonName(alternatives: Alternative[], value: string): void {
  const cleaned = clean(value);
  if (!cleaned) return;
  addPhrase(alternatives, cleaned, PII_PLACEHOLDER.name);
  for (const token of cleaned.split(" ")) {
    const whole = stripEdges(token);
    if (whole.length >= MIN_WORD_LENGTH) addPhrase(alternatives, whole, PII_PLACEHOLDER.name);
    for (const part of whole.split(/[-\u2010\u2013]/u)) {
      const word = stripEdges(part);
      if (word.length >= MIN_WORD_LENGTH) addPhrase(alternatives, word, PII_PLACEHOLDER.name);
    }
  }
}

function addCompanyPhrase(alternatives: Alternative[], value: string): void {
  const cleaned = clean(value);
  if (!cleaned) return;
  addPhrase(alternatives, cleaned, PII_PLACEHOLDER.name);
  // Uten selskapsform («Testesen Bygg AS» → «Testesen Bygg»), bare når det står igjen minst to ord,
  // så et enkelt fagord («Tak AS» → «Tak») aldri vaskes alene.
  const withoutSuffix = cleaned.replace(LEGAL_SUFFIX, "").trim();
  if (withoutSuffix !== cleaned && withoutSuffix.includes(" ")) {
    addPhrase(alternatives, withoutSuffix, PII_PLACEHOLDER.name);
  }
  // Bestillerteksten kan ha flere deler med komma («Ola Testesen, Testmegling AS»).
  if (cleaned.includes(",")) {
    for (const part of cleaned.split(",")) {
      const trimmed = part.trim();
      if (trimmed.includes(" ") || trimmed.length >= MIN_WORD_LENGTH) {
        addPhrase(alternatives, trimmed, PII_PLACEHOLDER.name);
      }
    }
  }
}

function addDigits(
  alternatives: Alternative[],
  value: string,
  placeholder: string,
  prefix: string,
  suffix: string,
  normalize: (digits: string) => string = (digits) => digits,
): void {
  const digits = normalize(value.replace(/\D/g, ""));
  if (digits.length < 5) return;
  alternatives.push({
    source: `${START}${prefix}${digitsSource(digits)}${suffix}${END}`,
    placeholder,
    weight: digits.length,
  });
}

function normalizePhoneDigits(digits: string): string {
  if (digits.startsWith("0047") && digits.length > 8) return digits.slice(4);
  if (digits.startsWith("47") && digits.length === 10) return digits.slice(2);
  return digits;
}

/** Deler «Fjellia 3 8010 Bodø» i «Fjellia 3» og «8010 Bodø» (adresse uten komma). */
function splitAtPostalCode(part: string): string[] {
  const match = /^(.*?\S)\s+(\d{4}\s+\p{L}.*)$/u.exec(part);
  return match?.[1] && match[2] ? [match[1], match[2]] : [part];
}

function addAddress(alternatives: Alternative[], value: string): void {
  const cleaned = clean(value);
  if (!cleaned) return;
  addPhrase(alternatives, cleaned, PII_PLACEHOLDER.address);
  for (const rawPart of cleaned.split(",")) {
    addPhrase(alternatives, rawPart.trim(), PII_PLACEHOLDER.address);
    for (const part of splitAtPostalCode(rawPart.trim())) {
      addAddressPart(alternatives, part);
    }
  }
}

function addAddressPart(alternatives: Alternative[], part: string): void {
  addPhrase(alternatives, part, PII_PLACEHOLDER.address);
  // «8006 Bodø» gir også poststedet alene.
  const postal = /^(\d{4})\s+(.+)$/u.exec(part);
  if (postal?.[2]) {
    addPhrase(alternatives, postal[2], PII_PLACEHOLDER.address);
    return;
  }
  // «Storgata 12 B» gir gatenavn + nummer (bokstav valgfri) og gatenavnet alene. Uten krav om
  // strengslutt, så «Elvebredden 12 H0101» (med bolignummer) også gir «Elvebredden 12».
  const street = /^(.*?\p{L})\.?\s*(\d{1,4})(?!\p{N})(?:\s?([A-Za-z])(?![\p{L}\p{N}]))?/u.exec(
    part,
  );
  if (street?.[1] && street[2]) {
    const name = clean(street[1], MIN_WORD_LENGTH);
    if (!name) return;
    const letter = street[3] ? escapeRegExp(street[3]) : "[A-Ha-h]";
    alternatives.push({
      source: `${START}${phraseSource(name)}\\.?[\\s\\u00A0]*${street[2]}(?:[\\s\\u00A0]?${letter})?${END}`,
      placeholder: PII_PLACEHOLDER.address,
      weight: street[0].length,
    });
    addPhrase(alternatives, name, PII_PLACEHOLDER.address, MIN_WORD_LENGTH);
  }
}

function cadastralValue(value: string | null): string | null {
  const cleaned = clean(value, 1);
  return cleaned && /^[\p{L}\p{N}]+$/u.test(cleaned) ? escapeRegExp(cleaned) : null;
}

function addCadastral(
  alternatives: Alternative[],
  unit: KnownCadastralUnit,
  municipalityNumbers: string[],
): void {
  const gnr = cadastralValue(unit.gnr);
  const bnr = cadastralValue(unit.bnr);
  const placeholder = PII_PLACEHOLDER.cadastral;
  if (gnr && bnr) {
    // Bare som kombinasjon: «12/34», «12/34/0/5», «1804-12/34», «gnr 12/34».
    const municipality = [...municipalityNumbers.map((n) => escapeRegExp(n)), "\\d{4}"].join("|");
    alternatives.push({
      source: `${START}${CADASTRAL_COMBO_WORD}(?:(?:${municipality})\\s?[-/ ]\\s?)?${gnr}\\s?/\\s?${bnr}(?:\\s?/\\s?\\d{1,5}){0,2}${END}`,
      placeholder,
      weight: 100,
    });
  }
  const words: [string, string | null][] = [
    [CADASTRAL_WORDS.gnr, gnr],
    [CADASTRAL_WORDS.bnr, bnr],
    [CADASTRAL_WORDS.fnr, cadastralValue(unit.fnr)],
    [CADASTRAL_WORDS.snr, cadastralValue(unit.snr)],
    [CADASTRAL_WORDS.share, cadastralValue(unit.shareNumber)],
  ];
  for (const [word, value] of words) {
    if (!value) continue;
    alternatives.push({
      source: `${START}${word}\\.?:?[ \\u00A0]*${value}${END}`,
      placeholder,
      weight: 50,
    });
  }
}

function buildAlternatives(known: KnownValues): Alternative[] {
  const alternatives: Alternative[] = [];
  for (const name of known.personNames) addPersonName(alternatives, name);
  for (const phrase of known.phrases) addCompanyPhrase(alternatives, phrase);
  for (const email of known.emails) {
    const cleaned = clean(email);
    if (!cleaned?.includes("@")) continue;
    alternatives.push({
      source: `(?<![\\p{L}\\p{N}._%+\\-])${escapeRegExp(cleaned)}${END}`,
      placeholder: PII_PLACEHOLDER.email,
      weight: cleaned.length,
    });
  }
  for (const phone of known.phones) {
    addDigits(
      alternatives,
      phone,
      PII_PLACEHOLDER.phone,
      `(?:(?:\\+|00)[ \\u00A0]?47${DIGIT_SEP})?`,
      "",
      normalizePhoneDigits,
    );
  }
  for (const orgNumber of known.orgNumbers) {
    addDigits(
      alternatives,
      orgNumber,
      PII_PLACEHOLDER.orgNumber,
      "(?:NO[ \\u00A0]?)?",
      "(?:[ \\u00A0]?MVA)?",
    );
  }
  for (const address of known.addresses.full) addAddress(alternatives, address);
  for (const place of known.addresses.places) {
    addPhrase(alternatives, place, PII_PLACEHOLDER.address);
    const cleanedPlace = clean(place);
    if (!cleanedPlace) continue;
    for (const code of known.addresses.postalCodes) {
      const cleanedCode = clean(code);
      if (cleanedCode) {
        addPhrase(alternatives, `${cleanedCode} ${cleanedPlace}`, PII_PLACEHOLDER.address);
      }
    }
  }
  const municipalityNumbers = known.cadastral.municipalityNumbers
    .map((n) => clean(n, 1))
    .filter((n): n is string => n !== null && /^\d+$/.test(n));
  for (const unit of known.cadastral.units) addCadastral(alternatives, unit, municipalityNumbers);

  // Like mønstre én gang, lengste først (A174).
  const seen = new Set<string>();
  const unique: Alternative[] = [];
  for (const alternative of alternatives) {
    const key = alternative.source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(alternative);
  }
  return unique.sort((a, b) => b.weight - a.weight);
}

type KnownValueMatcher = { pattern: RegExp; placeholders: string[] } | null;

function compileKnownValues(known: KnownValues): KnownValueMatcher {
  const alternatives = buildAlternatives(known);
  if (alternatives.length === 0) return null;
  return {
    pattern: new RegExp(alternatives.map((a) => `(${a.source})`).join("|"), "giu"),
    placeholders: alternatives.map((a) => a.placeholder),
  };
}

function applyRedaction(text: string, matcher: KnownValueMatcher): RedactionResult {
  // E-post først, så «åse.testesen@eksempel.no» ikke blir «[navn].[navn]@eksempel.no».
  const emails = redactEmails(normalizeForRedaction(text));
  let result = emails.text;
  let count = emails.count;
  if (matcher) {
    const { pattern, placeholders } = matcher;
    result = result.replace(pattern, (...args: unknown[]) => {
      count += 1;
      for (let index = 0; index < placeholders.length; index += 1) {
        if (args[index + 1] !== undefined) return placeholders[index] as string;
      }
      return PII_PLACEHOLDER.name;
    });
  }
  const patterns = redactPii(result);
  return { text: patterns.text, count: count + patterns.count };
}

/**
 * Vasker én tekst: kjente verdier først (lengste først), deretter mønstrene. Ren funksjon.
 * `count` er antall byttede treff.
 */
export function redactText(text: string, known: KnownValues): RedactionResult {
  return applyRedaction(text, compileKnownValues(known));
}

function pushValue(list: string[], value: string | null | undefined): void {
  if (value !== null && value !== undefined && value.trim() !== "") list.push(value);
}

function nonNull(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v !== ""))];
}

/**
 * Henter de kjente verdiene for oppdraget, bare i organisasjonen til `grant`.
 * Mykt slettede parter, kontakter, firma, teammedlemmer, matrikkel og fellesareal tas med (A170).
 * Finnes ikke oppdraget i organisasjonen, kastes en feil (feil skal stenge, A176), så teksten
 * aldri sendes vasket bare med mønstrene når et oppdrag er oppgitt.
 */
export async function loadKnownValues(
  grant: EmployeeGrant,
  assignmentId: string,
): Promise<KnownValues> {
  const organizationId = grant.organizationId;
  const known = emptyKnownValues();

  const [assignment] = await db
    .select({ orderId: assignments.orderId, propertyId: assignments.propertyId })
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.organizationId, organizationId)))
    .limit(1);
  if (!assignment) throw new Error("Oppdraget finnes ikke i organisasjonen.");

  const orderMatch = assignment.orderId
    ? or(eq(orders.id, assignment.orderId), eq(orders.assignmentId, assignmentId))
    : eq(orders.assignmentId, assignmentId);
  const [orderRows, partyRows, teamRows, propertyRows, commonAreaRows] = await Promise.all([
    db
      .select({
        orderedByText: orders.orderedByText,
        orderedByContactId: orders.orderedByContactId,
        orderedByFirmId: orders.orderedByFirmId,
        addressText: orders.addressText,
        gnr: orders.gnr,
        bnr: orders.bnr,
        snr: orders.snr,
        housingAssociationName: orders.housingAssociationName,
      })
      .from(orders)
      .where(and(eq(orders.organizationId, organizationId), orderMatch)),
    db
      .select({
        name: assignmentParties.name,
        firmName: assignmentParties.firmName,
        email: assignmentParties.email,
        phone: assignmentParties.phone,
        contactId: assignmentParties.contactId,
        firmId: assignmentParties.firmId,
      })
      .from(assignmentParties)
      .where(
        and(
          eq(assignmentParties.organizationId, organizationId),
          eq(assignmentParties.assignmentId, assignmentId),
        ),
      ),
    db
      .select({ name: employees.name })
      .from(assignmentTeamMembers)
      .innerJoin(
        employees,
        and(
          eq(employees.id, assignmentTeamMembers.employeeId),
          eq(employees.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(assignmentTeamMembers.organizationId, organizationId),
          eq(assignmentTeamMembers.assignmentId, assignmentId),
        ),
      ),
    assignment.propertyId
      ? db
          .select({
            address: properties.address,
            postalCode: properties.postalCode,
            city: properties.city,
            municipalityName: properties.municipalityName,
            municipalityNumber: properties.municipalityNumber,
          })
          .from(properties)
          .where(
            and(
              eq(properties.organizationId, organizationId),
              eq(properties.id, assignment.propertyId),
            ),
          )
      : Promise.resolve([]),
    db
      .select({ managingAgent: commonAreas.managingAgent })
      .from(commonAreas)
      .where(
        and(
          eq(commonAreas.organizationId, organizationId),
          eq(commonAreas.assignmentId, assignmentId),
        ),
      ),
  ]);

  const contactIds = nonNull([
    ...partyRows.map((p) => p.contactId),
    ...orderRows.map((o) => o.orderedByContactId),
  ]);
  const contactRows =
    contactIds.length > 0
      ? await db
          .select({
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            phone: contacts.phone,
            firmId: contacts.firmId,
          })
          .from(contacts)
          .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.id, contactIds)))
      : [];

  const firmIds = nonNull([
    ...partyRows.map((p) => p.firmId),
    ...orderRows.map((o) => o.orderedByFirmId),
    ...contactRows.map((c) => c.firmId),
  ]);
  const firmRows =
    firmIds.length > 0
      ? await db
          .select({ name: firms.name, orgNumber: firms.orgNumber })
          .from(firms)
          .where(and(eq(firms.organizationId, organizationId), inArray(firms.id, firmIds)))
      : [];

  const cadastralRows = assignment.propertyId
    ? await db
        .select({
          gnr: cadastralUnits.gnr,
          bnr: cadastralUnits.bnr,
          fnr: cadastralUnits.fnr,
          snr: cadastralUnits.snr,
          shareNumber: cadastralUnits.shareNumber,
          associationName: cadastralUnits.associationName,
          associationOrgNumber: cadastralUnits.associationOrgNumber,
        })
        .from(cadastralUnits)
        .where(
          and(
            eq(cadastralUnits.organizationId, organizationId),
            eq(cadastralUnits.propertyId, assignment.propertyId),
          ),
        )
    : [];

  for (const party of partyRows) {
    pushValue(known.personNames, party.name);
    pushValue(known.phrases, party.firmName);
    pushValue(known.emails, party.email);
    pushValue(known.phones, party.phone);
  }
  for (const contact of contactRows) {
    pushValue(known.personNames, [contact.firstName, contact.lastName].filter(Boolean).join(" "));
    pushValue(known.emails, contact.email);
    pushValue(known.phones, contact.phone);
  }
  for (const firm of firmRows) {
    pushValue(known.phrases, firm.name);
    pushValue(known.orgNumbers, firm.orgNumber);
  }
  for (const order of orderRows) {
    pushValue(known.phrases, order.orderedByText);
    pushValue(known.phrases, order.housingAssociationName);
    pushValue(known.addresses.full, order.addressText);
    known.cadastral.units.push({
      gnr: order.gnr,
      bnr: order.bnr,
      fnr: null,
      snr: order.snr,
      shareNumber: null,
    });
  }
  for (const member of teamRows) pushValue(known.personNames, member.name);
  for (const property of propertyRows) {
    pushValue(known.addresses.full, property.address);
    pushValue(known.addresses.places, property.city);
    pushValue(known.addresses.places, property.municipalityName);
    pushValue(known.addresses.postalCodes, property.postalCode);
    pushValue(known.cadastral.municipalityNumbers, property.municipalityNumber);
  }
  for (const unit of cadastralRows) {
    known.cadastral.units.push({
      gnr: unit.gnr,
      bnr: unit.bnr,
      fnr: unit.fnr,
      snr: unit.snr,
      shareNumber: unit.shareNumber,
    });
    pushValue(known.phrases, unit.associationName);
    pushValue(known.orgNumbers, unit.associationOrgNumber);
  }
  for (const area of commonAreaRows) pushValue(known.phrases, area.managingAgent);

  return known;
}

/**
 * Vasker alle feltene i en forespørsel. Med `assignmentId` brukes de kjente verdiene for oppdraget
 * i tillegg til mønstrene; uten oppdrag bare mønstrene, uten databaseoppslag. Kaster ved feil.
 */
export async function redactFields(
  grant: EmployeeGrant,
  assignmentId: string | null,
  fields: Record<string, string>,
): Promise<{ fields: Record<string, string>; count: number }> {
  const known = assignmentId === null ? null : await loadKnownValues(grant, assignmentId);
  const matcher = known === null ? null : compileKnownValues(known);
  const redacted: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(fields)) {
    const result = applyRedaction(value, matcher);
    redacted[key] = result.text;
    count += result.count;
  }
  return { fields: redacted, count };
}
