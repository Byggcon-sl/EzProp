"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure } from "../action-result";
import { getAdminContext } from "../admin-context";
import { NO_ACCESS, type FormState } from "../form-state";
import { createCompany, updateCompany } from "../organization";

const TEXT_FIELDS = [
  "legalName",
  "orgNumber",
  "address",
  "postalCode",
  "city",
  "companyText",
  "liabilityInsurer",
  "liabilityPolicyNumber",
  "liabilityValidTo",
] as const;

function readCompanyForm(formData: FormData) {
  const values: Record<string, string> = {};
  for (const name of TEXT_FIELDS) values[name] = String(formData.get(name) ?? "");
  values.vatRegistered = formData.get("vatRegistered") === "on" ? "on" : "";

  const optional = (value: string) => value.trim() || null;
  const input = {
    legalName: values.legalName!.trim(),
    // Mellomrom i org.nr. fjernes før sjekken (skisse avsnitt 4)
    orgNumber: optional(values.orgNumber!.replace(/\s+/g, "")),
    vatRegistered: values.vatRegistered === "on",
    address: optional(values.address!),
    postalCode: optional(values.postalCode!),
    city: optional(values.city!),
    companyText: optional(values.companyText!),
    liabilityInsurer: optional(values.liabilityInsurer!),
    liabilityPolicyNumber: optional(values.liabilityPolicyNumber!),
    liabilityValidTo: optional(values.liabilityValidTo!),
  };
  return { values, input };
}

/**
 * Lagrer et selskap. `companyId` er `null` for nytt selskap. Organisasjonen hentes alltid på
 * serveren; id-en sjekkes her og i kjernen.
 */
export async function saveCompanyAction(
  companyId: string | null,
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { values, input } = readCompanyForm(formData);
  const context = await getAdminContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);
  if (companyId !== null && !isUuid(companyId)) return failure(previous, values, {}, NO_ACCESS);

  try {
    if (companyId === null) await createCompany(context.actor, context.organizationId, input);
    else await updateCompany(context.actor, context.organizationId, companyId, input);
  } catch (error) {
    return errorResult(error, previous, values, {
      route: "/admin/selskaper",
      userId: context.actor.id,
      ...(companyId && { companyId }),
    });
  }
  redirect("/admin/selskaper?lagret=selskap");
}
