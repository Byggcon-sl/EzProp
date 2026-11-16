import type { Metadata } from "next";
import Link from "next/link";
import { OFFER_VALID_DAYS, OFFER_VALID_UNTIL_MAX_DAYS } from "@/core/orders";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { createOfferAction } from "../actions";
import { osloDateTimeLocal } from "../received-at";
import { OfferForm } from "./offer-form";

export const metadata: Metadata = { title: "Nytt tilbud" };

/**
 * Nytt tilbud (en mulig jobb). «Gyldig til» er forhåndsutfylt med i dag + 30 dager. «Lagre» går
 * til tilbudssiden med kvitteringen. Kjernen sjekker `assignment.edit`.
 */
export default async function NewOfferPage() {
  const context = await getEmployeeContext();
  if (!context || !context.canEditOrders) return <NoAccess />;

  const now = new Date();
  const today = todayInOslo(now);

  return (
    <main className="max-w-2xl">
      <Link
        href="/tilbud"
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        Tilbud
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-slate-900">Nytt tilbud</h1>
      <OfferForm
        action={createOfferAction}
        receivedAtDefault={osloDateTimeLocal(now)}
        validUntil={{
          defaultValue: addDays(today, OFFER_VALID_DAYS),
          min: today,
          max: addDays(today, OFFER_VALID_UNTIL_MAX_DAYS),
        }}
      />
    </main>
  );
}
