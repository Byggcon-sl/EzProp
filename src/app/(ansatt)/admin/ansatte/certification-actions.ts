"use server";

import { redirect } from "next/navigation";
import { certificationAreas } from "@/core/access";
import { createCertification, deleteCertification } from "@/core/organization";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure } from "../action-result";
import { getAdminContext } from "../admin-context";
import { NO_ACCESS, type FormState } from "../form-state";

const ROUTE = "/admin/ansatte";

/**
 * Feilmeldingene ved feltet (oppgavekortet, Skjermer). Kjernen gir de samme i `ZodError`.
 * Ikke eksportert: en fil med «use server» kan bare eksportere async-funksjoner.
 */
const CERTIFICATION_MESSAGES = {
  validToMissing: "Velg dato for gyldig til.",
  validFromAfterValidTo: "Gyldig fra kan ikke være etter gyldig til.",
} as const;

function readCertification(formData: FormData) {
  return {
    area: String(formData.get("area") ?? ""),
    validTo: String(formData.get("validTo") ?? "").trim(),
    validFrom: String(formData.get("validFrom") ?? "").trim(),
    certificateNumber: String(formData.get("certificateNumber") ?? "").trim(),
    issuer: String(formData.get("issuer") ?? "").trim(),
  };
}

/**
 * «Legg til sertifisering» på en ansatt. Organisasjonen kommer fra serveren; kjernen sjekker at
 * den ansatte hører til den. Fornyelse er en ny rad.
 */
export async function createCertificationAction(
  employeeId: string,
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readCertification(formData);
  const context = await getAdminContext();
  if (!context || !isUuid(employeeId)) return failure(previous, values, {}, NO_ACCESS);

  // Bare én kode nå; ukjent verdi fra skjemaet gir den forhåndsvalgte.
  const area = certificationAreas.find((code) => code === values.area) ?? certificationAreas[0];

  // Samme regler som i kjernen, her for at meldingen skal stå ved riktig felt.
  if (!values.validTo) {
    return failure(previous, values, { validTo: CERTIFICATION_MESSAGES.validToMissing });
  }
  if (values.validFrom && values.validFrom > values.validTo) {
    return failure(previous, values, { validFrom: CERTIFICATION_MESSAGES.validFromAfterValidTo });
  }

  try {
    await createCertification(context.actor, context.organizationId, {
      employeeId,
      area,
      validTo: values.validTo,
      validFrom: values.validFrom || null,
      certificateNumber: values.certificateNumber || null,
      issuer: values.issuer || null,
    });
  } catch (error) {
    return errorResult(error, previous, values, {
      route: ROUTE,
      userId: context.actor.id,
      employeeId,
    });
  }
  redirect(`${ROUTE}/${employeeId}?lagret=sertifisering`);
}

/** «Fjern» (etter bekreftelse). Myk sletting i kjernen; raden står som historikk. */
export async function deleteCertificationAction(
  employeeId: string,
  certificationId: string,
  previous: FormState,
): Promise<FormState> {
  const context = await getAdminContext();
  if (!context || !isUuid(employeeId) || !isUuid(certificationId)) {
    return failure(previous, {}, {}, NO_ACCESS);
  }
  try {
    await deleteCertification(context.actor, context.organizationId, certificationId);
  } catch (error) {
    return errorResult(
      error,
      previous,
      {},
      {
        route: ROUTE,
        userId: context.actor.id,
        employeeId,
        certificationId,
      },
    );
  }
  redirect(`${ROUTE}/${employeeId}?lagret=sertifisering-fjernet`);
}
