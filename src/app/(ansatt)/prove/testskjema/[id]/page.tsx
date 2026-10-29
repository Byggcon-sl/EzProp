import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireActor } from "@/core/auth/session";
import { isUuid } from "@/shared/lib/uuid";
import { TrialFormPage } from "./trial-form-page";

export const metadata: Metadata = { title: "Testskjema" };

/**
 * Prøve fase 1: ett testskjema. Svarene leses fra den lokale databasen på enheten; skjemaet kan
 * være laget på en annen iPad og kommet hit med synk.
 */
export default async function TrialFormRoute({ params }: { params: Promise<{ id: string }> }) {
  await requireActor();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <TrialFormPage formId={id} />;
}
