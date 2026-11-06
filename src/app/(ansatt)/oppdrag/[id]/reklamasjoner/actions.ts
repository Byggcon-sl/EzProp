"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import {
  ClaimantPartyNotFoundError,
  createClaim,
  getClaim,
  removeClaim,
  updateClaim,
} from "@/core/claims";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure, type KnownError } from "../../../action-result";
import { getEmployeeContext } from "../../../employee-context";
import type { FormState } from "../../../form-state";

/*
 * Server actions for reklamasjonssaker på oppdraget. Ingen tilgangslogikk her: organisasjon og
 * aktør kommer fra `getEmployeeContext()`, og kjernen sjekker `claims.manage`. Et felt
 * `organizationId` i skjemaet leses aldri. Id-er som ikke er uuid stoppes før kjernen kalles.
 * Mangler tilgang, eller finnes ikke saken eller oppdraget, er svaret det samme: «finnes ikke».
 * Loggen får bare rute, bruker-id, id-er og feilnavn, aldri klager, beskrivelse eller bygningsdel.
 */

const ROUTE = "/oppdrag/[id]/reklamasjoner";
const NOT_FOUND = "Saken eller oppdraget finnes ikke.";

const TEXT_FIELDS = [
  "claimType",
  "receivedAt",
  "claimantPartyId",
  "claimantText",
  "description",
  "buildingPartText",
] as const;

const CLAIM_ERRORS: readonly KnownError[] = [
  { error: AccessDeniedError, message: NOT_FOUND },
  {
    error: ClaimantPartyNotFoundError,
    field: "claimantPartyId",
    message: "Parten finnes ikke på oppdraget. Velg en annen eller skriv hvem som klaget.",
  },
];

/** Tekstverdiene fra skjemaet. Bare de kjente feltene leses. */
function readFields<T extends string>(formData: FormData, fields: readonly T[]) {
  const values = {} as Record<T, string>;
  for (const name of fields) values[name] = String(formData.get(name) ?? "");
  return values;
}

/** Tom tekst blir `null`, så valgfrie felt lagres som tomme. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Beløpet i hele kroner. Mellomrom («20 000») tas bort. Tomt gir `null`, ugyldig gir `undefined`. */
function parseAmount(value: string): number | null | undefined {
  const digits = value.replace(/[\s ]/g, "");
  if (digits === "") return null;
  return /^\d{1,12}$/.test(digits) ? Number(digits) : undefined;
}

function refresh(assignmentId: string) {
  revalidatePath(`/oppdrag/${assignmentId}`);
}

/** Feltene fra skjemaet i formen kjernen tar imot. */
function claimInput(values: Record<(typeof TEXT_FIELDS)[number], string>) {
  return {
    claimType: values.claimType,
    receivedAt: values.receivedAt,
    claimantPartyId: orNull(values.claimantPartyId),
    claimantText: orNull(values.claimantText),
    description: values.description.trim(),
    buildingPartText: orNull(values.buildingPartText),
  };
}

/** «Lagre» på /oppdrag/[id]/reklamasjoner/ny. Saken registreres som åpen. */
export async function createClaimAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const values = readFields(formData, TEXT_FIELDS);
  const context = await getEmployeeContext();
  if (!context || !isUuid(assignmentId)) return failure(previous, values, {}, NOT_FOUND);

  try {
    await createClaim(context.actor, context.organizationId, assignmentId, {
      ...claimInput(values),
      outcome: "open",
      amount: null,
    });
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id, assignmentId },
      { known: CLAIM_ERRORS },
    );
  }
  refresh(assignmentId);
  redirect(`/oppdrag/${assignmentId}`);
}

/** «Lagre» på /oppdrag/[id]/reklamasjoner/[claimId]. Lukking og gjenåpning er en vanlig endring. */
export async function updateClaimAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const claimId = String(formData.get("claimId") ?? "");
  const values = {
    ...readFields(formData, TEXT_FIELDS),
    ...readFields(formData, ["outcome", "amount"] as const),
  };
  const context = await getEmployeeContext();
  if (!context || !isUuid(claimId)) return failure(previous, values, {}, NOT_FOUND);

  const amount = parseAmount(values.amount);
  if (amount === undefined) {
    return failure(previous, values, {
      amount: "Skriv beløpet i hele kroner, for eksempel 20000.",
    });
  }

  let assignmentId: string;
  try {
    const claim = await updateClaim(context.actor, context.organizationId, claimId, {
      ...claimInput(values),
      outcome: values.outcome,
      amount,
    });
    assignmentId = claim.assignmentId;
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id, claimId },
      { known: CLAIM_ERRORS },
    );
  }
  refresh(assignmentId);
  redirect(`/oppdrag/${assignmentId}`);
}

/** «Ja, fjern saken» i bekreftelsen. Myk sletting i kjernen. */
export async function removeClaimAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const claimId = String(formData.get("claimId") ?? "");
  const context = await getEmployeeContext();
  if (!context || !isUuid(claimId)) return failure(previous, {}, {}, NOT_FOUND);

  let assignmentId: string;
  try {
    // Oppdraget hentes før saken fjernes, så vi vet hvor vi skal sende brukeren.
    const claim = await getClaim(context.actor, context.organizationId, claimId);
    assignmentId = claim.assignmentId;
    await removeClaim(context.actor, context.organizationId, claimId);
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      { route: ROUTE, userId: context.actor.id, claimId },
      { known: CLAIM_ERRORS },
    );
  }
  refresh(assignmentId);
  redirect(`/oppdrag/${assignmentId}`);
}
