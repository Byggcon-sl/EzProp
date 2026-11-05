"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../../action-result";
import { getEmployeeContext } from "../../employee-context";
import { NO_ACCESS, type FormState } from "../../form-state";
import {
  addParty,
  EmployeeNotFoundError,
  PARTY_ROLES,
  removeParty,
  setTeamMember,
  TEAM_ROLES,
  updateParty,
  type PartyRole,
  type TeamRole,
} from "@/core/assignments";
import {
  CommonAreasNotApplicableError,
  saveAssignmentProperty,
  saveCommonAreas,
} from "@/core/properties";

/*
 * Server actions på oppdragssiden (team, parter, eiendom og fellesdeler). Ingen tilgangslogikk her: organisasjonen
 * kommer fra `getEmployeeContext()`, og kjernen sjekker rettigheten. Et felt `organizationId` i
 * skjemaet leses aldri. Id-er som ikke er uuid stoppes før kjernen kalles. Loggen får bare rute,
 * bruker-id, id-er og feilnavn, aldri navn, firma, e-post, telefon, grunn, adresse, matrikkel,
 * borettslag, andelsnummer, forretningsfører eller notater.
 */

const ROUTE = "/oppdrag";

/** Feilene fra kjernen som oppdragssiden viser med egen tekst. */
const TEAM_ERRORS: readonly KnownError[] = [
  { error: EmployeeNotFoundError, field: "employeeId", message: "Den ansatte finnes ikke." },
];

const COMMON_AREAS_ERRORS: readonly KnownError[] = [
  {
    error: CommonAreasNotApplicableError,
    message: new CommonAreasNotApplicableError().message,
  },
];

const PROPERTY_FIELDS = [
  "address",
  "postalCode",
  "city",
  "municipalityNumber",
  "municipalityName",
  "housingType",
  "ownershipForm",
  "gnr",
  "bnr",
  "fnr",
  "snr",
  "associationName",
  "associationOrgNumber",
  "shareNumber",
] as const;

const COMMON_AREAS_FIELDS = [
  "managingAgent",
  "conditionReportStatus",
  "maintenancePlanStatus",
  "notes",
] as const;

/** Tekstverdiene fra skjemaet. Bare de kjente feltene leses (aldri `organizationId` e.l.). */
function readFields<T extends string>(formData: FormData, fields: readonly T[]) {
  const values = {} as Record<T, string>;
  for (const name of fields) values[name] = String(formData.get(name) ?? "");
  return values;
}

const PARTY_TEXT_FIELDS = ["role", "name", "firmName", "email", "phone"] as const;
const PARTY_RECEIVES_FIELDS = ["receivesReport", "receivesInvoice", "receivesMessages"] as const;

/** Svaret når noe ble lagret: ingen feil, og `attempt` økes slik at skjemaet ser at det er lagret. */
function saved(previous: FormState): FormState {
  return { fieldErrors: {}, message: null, values: {}, attempt: previous.attempt + 1 };
}

function refresh() {
  revalidatePath("/oppdrag/[id]", "page");
}

function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

function isPartyRole(value: string): value is PartyRole {
  return (PARTY_ROLES as readonly string[]).includes(value);
}

function readParty(formData: FormData) {
  const values: Record<string, string> = {};
  for (const name of PARTY_TEXT_FIELDS) values[name] = String(formData.get(name) ?? "");
  // Avkrysningene sendes bare når de er krysset av.
  for (const name of PARTY_RECEIVES_FIELDS) {
    values[name] = formData.get(name) !== null ? "on" : "";
  }
  return values;
}

/** Tomme valgfrie felt sendes ikke til kjernen. */
function optional(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

function partyInput(values: Record<string, string>, role: PartyRole) {
  return {
    role,
    name: (values.name ?? "").trim(),
    firmName: optional(values.firmName),
    email: optional(values.email),
    phone: optional(values.phone),
    receivesReport: values.receivesReport === "on",
    receivesInvoice: values.receivesInvoice === "on",
    receivesMessages: values.receivesMessages === "on",
  };
}

/** «Lagre» på én linje i teamet. «Ingen» (tom verdi) fjerner personen fra rollen. */
export async function setTeamMemberAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const teamRole = String(formData.get("teamRole") ?? "");
  const values = {
    employeeId: String(formData.get("employeeId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  };
  const context = await getEmployeeContext();
  const employeeId = values.employeeId.trim() === "" ? null : values.employeeId.trim();
  if (
    !context ||
    !isUuid(assignmentId) ||
    !isTeamRole(teamRole) ||
    (employeeId !== null && !isUuid(employeeId))
  ) {
    return failure(previous, values, {}, NO_ACCESS);
  }

  try {
    await setTeamMember(context.actor, context.organizationId, assignmentId, {
      teamRole,
      employeeId,
      reason: optional(values.reason),
    });
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: `${ROUTE}/[id]`, userId: context.actor.id, assignmentId },
      { known: TEAM_ERRORS, zodField: "reason" },
    );
  }
  refresh();
  return saved(previous);
}

/** «Lagre» i skjemaet «Legg til part». */
export async function addPartyAction(previous: FormState, formData: FormData): Promise<FormState> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const values = readParty(formData);
  const context = await getEmployeeContext();
  if (!context || !isUuid(assignmentId)) return failure(previous, values, {}, NO_ACCESS);

  const role = values.role ?? "";
  if (!isPartyRole(role)) return failure(previous, values, { role: "Velg en rolle." });

  try {
    await addParty(context.actor, context.organizationId, assignmentId, partyInput(values, role));
  } catch (error) {
    return errorResult(error, previous, values, {
      route: `${ROUTE}/[id]`,
      userId: context.actor.id,
      assignmentId,
    });
  }
  refresh();
  return saved(previous);
}

/** «Lagre» når en part endres. */
export async function updatePartyAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const partyId = String(formData.get("partyId") ?? "");
  const values = readParty(formData);
  const context = await getEmployeeContext();
  if (!context || !isUuid(partyId)) return failure(previous, values, {}, NO_ACCESS);

  const role = values.role ?? "";
  if (!isPartyRole(role)) return failure(previous, values, { role: "Velg en rolle." });

  try {
    await updateParty(context.actor, context.organizationId, partyId, partyInput(values, role));
  } catch (error) {
    return errorResult(error, previous, values, {
      route: `${ROUTE}/[id]`,
      userId: context.actor.id,
      partyId,
    });
  }
  refresh();
  return saved(previous);
}

/** «Fjern» på en part. Myk sletting i kjernen; parten kan legges inn igjen. Ingen dialog. */
export async function removePartyAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const partyId = String(formData.get("partyId") ?? "");
  const context = await getEmployeeContext();
  if (!context || !isUuid(partyId)) return failure(previous, {}, {}, NO_ACCESS);

  try {
    await removeParty(context.actor, context.organizationId, partyId);
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      {
        route: `${ROUTE}/[id]`,
        userId: context.actor.id,
        partyId,
      },
    );
  }
  refresh();
  return saved(previous);
}

/** «Lagre eiendom». Kjernen lager eiendommen første gang og oppdaterer den ellers. */
export async function savePropertyAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const values = readFields(formData, PROPERTY_FIELDS);
  const context = await getEmployeeContext();
  if (!context || !isUuid(assignmentId)) return failure(previous, values, {}, NO_ACCESS);

  try {
    await saveAssignmentProperty(context.actor, context.organizationId, assignmentId, values);
  } catch (error) {
    return errorResult(error, previous, values, {
      route: `${ROUTE}/[id]`,
      userId: context.actor.id,
      assignmentId,
    });
  }
  refresh();
  return saved(previous);
}

/** «Lagre fellesdeler». Bare når eiendommen har fellesdeler; ellers en norsk melding. */
export async function saveCommonAreasAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const values = readFields(formData, COMMON_AREAS_FIELDS);
  const context = await getEmployeeContext();
  if (!context || !isUuid(assignmentId)) return failure(previous, values, {}, NO_ACCESS);

  try {
    await saveCommonAreas(context.actor, context.organizationId, assignmentId, values);
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: `${ROUTE}/[id]`, userId: context.actor.id, assignmentId },
      { known: COMMON_AREAS_ERRORS },
    );
  }
  refresh();
  return saved(previous);
}
