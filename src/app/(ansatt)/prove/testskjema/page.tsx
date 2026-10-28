import type { Metadata } from "next";
import { requireActor } from "@/core/auth/session";
import { TrialFormPage } from "./trial-form-page";

export const metadata: Metadata = { title: "Testskjema" };

/** Testskjemaet for prøven uten nett i fase 1. Krever innlogget ansatt. */
export default async function TrialFormRoute() {
  await requireActor();
  return <TrialFormPage />;
}
