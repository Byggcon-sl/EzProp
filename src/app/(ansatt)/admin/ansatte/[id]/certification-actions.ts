"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure } from "../../action-result";
import { getAdminContext } from "../../admin-context";
import { NO_ACCESS, type FormState } from "../../form-state";
import { addCertification, removeCertification, type CertificationArea } from "@/core/organization";

const ROUTE = "/admin/ansatte";

/** Feilmeldingene ved feltet (oppgavekortet, Skjermer). Andre felt får meldingen fra kjernen. */
const MESSAGES = {
  validTo: "Velg dato for gyldig til.",
};

function readCertification(formData: FormData) {
  return {
    area: String(formData.get("area") ?? ""),
    validTo: String(formData.get("validTo") ?? ""),
    validFrom: String(formData.get("validFrom") ?? ""),
    certificateNumber: String(formData.get("certificateNumber") ?? ""),
    issuer: String(formData.get("issuer") ?? ""),
  };
}

/**
 * Ny sertifisering på en ansatt. Fornyelse er en ny rad; den gamle står som historikk (A32).
 * Organisasjonen kommer fra tilgangssjekken, aldri fra skjemaet.
 */
export async function addCertificationAction(
  employeeId: string,
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readCertification(formData);
  const context = await getAdminContext();
  if (!context || !isUuid(employeeId)) return failure(previous, values, {}, NO_ACCESS);

  try {
    await addCertification(context.actor, context.organizationId, {
      employeeId,
      // Ukjent kode stoppes av valideringen i kjernen.
      area: values.area as CertificationArea,
      validTo: values.validTo.trim(),
      validFrom: values.validFrom.trim() || null,
      certificateNumber: values.certificateNumber.trim() || null,
      issuer: values.issuer.trim() || null,
    });
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: ROUTE, userId: context.actor.id, employeeId },
      MESSAGES,
    );
  }
  redirect(`${ROUTE}/${employeeId}?lagret=sertifisering`);
}

/** «Fjern» etter bekreftelse. Myk sletting; raden står i databasen med `deleted_at`. */
export async function removeCertificationAction(
  employeeId: string,
  certificationId: string,
  previous: FormState,
): Promise<FormState> {
  const context = await getAdminContext();
  if (!context || !isUuid(employeeId) || !isUuid(certificationId)) {
    return failure(previous, {}, {}, NO_ACCESS);
  }
  try {
    await removeCertification(context.actor, context.organizationId, certificationId);
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      { route: ROUTE, userId: context.actor.id, employeeId, certificationId },
    );
  }
  redirect(`${ROUTE}/${employeeId}?lagret=sertifisering-fjernet`);
}
