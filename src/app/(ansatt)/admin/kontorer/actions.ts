"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/shared/lib/uuid";
import { errorResult, failure } from "../action-result";
import { getAdminContext } from "../admin-context";
import { NO_ACCESS, type FormState } from "../form-state";
import { createOffice, updateOffice } from "../organization";

/**
 * Lagrer et kontor. `officeId` er `null` for nytt kontor. Organisasjonen hentes alltid på
 * serveren; id-en sjekkes her og i kjernen.
 */
export async function saveOfficeAction(
  officeId: string | null,
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    address: String(formData.get("address") ?? ""),
    sortOrder: String(formData.get("sortOrder") ?? ""),
  };
  const context = await getAdminContext();
  if (!context) return failure(previous, values, {}, NO_ACCESS);
  if (officeId !== null && !isUuid(officeId)) return failure(previous, values, {}, NO_ACCESS);

  // Tomt felt er 0. Annet enn et helt tall stoppes her, så Zod får et tall.
  const sortOrderText = values.sortOrder.trim();
  if (sortOrderText !== "" && !/^-?\d{1,9}$/.test(sortOrderText)) {
    return failure(previous, values, { sortOrder: "Skriv inn et helt tall." });
  }
  const input = {
    name: values.name.trim(),
    address: values.address.trim() || null,
    sortOrder: sortOrderText === "" ? 0 : Number(sortOrderText),
  };

  try {
    if (officeId === null) await createOffice(context.actor, context.organizationId, input);
    else await updateOffice(context.actor, context.organizationId, officeId, input);
  } catch (error) {
    return errorResult(
      error,
      previous,
      values,
      { route: "/admin/kontorer", userId: context.actor.id, ...(officeId && { officeId }) },
      { name: "Skriv inn navnet på kontoret.", sortOrder: "Skriv inn et helt tall." },
    );
  }
  redirect("/admin/kontorer?lagret=kontor");
}
