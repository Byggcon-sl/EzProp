"use server";

import { revalidatePath } from "next/cache";
import { AccessDeniedError } from "@/core/access";
import { revokeAllEmployeeSessions } from "@/core/auth/sessions-list";
import { getActorForAction } from "@/core/auth/session";
import { findAdminOrganizationId } from "@/core/organization";
import { SIGNED_OUT_MESSAGE } from "@/shared/forms/messages";
import { isUuid } from "@/shared/lib/uuid";
import { logger } from "@/shared/lib/logger";
import { isOwnEmployee } from "../../admin-context";
import { NO_ACCESS } from "../../../form-state";
import {
  CONFIRM_SELF_FIELD,
  CONFIRM_SELF_VALUE,
  type EmployeeSessionsActionState,
} from "./sessions-state";

/*
 * «Logg ut av alle enheter» for en ansatt (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 6).
 * Bare POST (serverhandling), aldri via lenke. Organisasjonen kommer fra tilgangssjekken på
 * serveren, aldri fra adressen eller skjemaet; kjernen sjekker rettigheten og at den ansatte hører
 * til organisasjonen. Admin som velger seg selv, må krysse av (kjernen avviser uten).
 * Støtter hovedmål: de ansatte (en som slutter eller mister iPaden, stenges ute med én handling,
 * og admin stenges aldri ute ved et uhell).
 */

const ROUTE = "/admin/ansatte";
const NOT_FOUND = "Fant ikke den ansatte.";
const CONFIRM_SELF = "Kryss av for at du også blir logget ut her.";
const UNKNOWN = "Noe gikk galt. Ingen enheter er logget ut. Prøv igjen.";

function answer(
  previous: EmployeeSessionsActionState | undefined,
  status: "done" | "failed",
  message: string,
  extra: Partial<EmployeeSessionsActionState> = {},
): EmployeeSessionsActionState {
  return { status, message, attempt: (previous?.attempt ?? 0) + 1, isSelf: false, ...extra };
}

/** «1 enhet er logget ut. …», «3 enheter …», og ved 0 «Ingen enheter var logget inn.» */
function receipt(count: number): string {
  if (count === 0) return "Ingen enheter var logget inn.";
  const devices = count === 1 ? "1 enhet er" : `${count} enheter er`;
  return `${devices} logget ut. Data som ligger på enhetene, er ikke slettet.`;
}

/**
 * Logger den ansatte ut av alle enheter. `employeeId` er bundet på siden, men kommer fra klienten
 * og valideres som UUID før kjernen kalles. `confirmSelf` sendes bare når avkryssingsfeltet er
 * satt. Svaret sier om det var admin selv (avgjort på serveren), slik at klienten logger ut.
 */
export async function revokeAllEmployeeSessionsAction(
  employeeId: unknown,
  previous: EmployeeSessionsActionState | undefined,
  formData: FormData,
): Promise<EmployeeSessionsActionState> {
  const actor = await getActorForAction();
  if (!actor) return answer(previous, "failed", SIGNED_OUT_MESSAGE, { signedOut: true });
  if (typeof employeeId !== "string" || !isUuid(employeeId)) {
    return answer(previous, "failed", NOT_FOUND);
  }
  const confirmSelf = formData.get(CONFIRM_SELF_FIELD) === CONFIRM_SELF_VALUE;

  let count: number;
  let isSelf: boolean;
  try {
    const organizationId = await findAdminOrganizationId(actor);
    if (!organizationId) return answer(previous, "failed", NO_ACCESS);
    const context = { actor, organizationId };
    isSelf = await isOwnEmployee(context, employeeId);
    const result = await revokeAllEmployeeSessions(
      actor,
      organizationId,
      employeeId,
      confirmSelf ? { confirmSelf: true, reason: "manual" } : { reason: "manual" },
    );
    if (!result.ok) {
      return answer(
        previous,
        "failed",
        result.reason === "confirm_self_required" ? CONFIRM_SELF : NOT_FOUND,
      );
    }
    count = result.count;
  } catch (error) {
    if (error instanceof AccessDeniedError) return answer(previous, "failed", NO_ACCESS);
    // Bare feilnavn og rute; aldri bruker-id, ansatt-id, økt-id eller user-agent
    logger.error("Utlogging av alle enheter feilet", {
      route: ROUTE,
      errorName: error instanceof Error ? error.name : "ukjent feil",
    });
    return answer(previous, "failed", UNKNOWN);
  }

  // Admin selv er logget ut også her: siden lastes ikke på nytt (den ville sendt til innlogging
  // før klienten har tømt KI-køen). Klienten logger ut og går til innloggingssiden.
  if (!isSelf) revalidatePath(`${ROUTE}/${employeeId}`);
  return answer(previous, "done", receipt(count), { isSelf, count });
}
