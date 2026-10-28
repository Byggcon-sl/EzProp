"use client";

import Link from "next/link";
import { useState } from "react";
import { countAnswered, type TrialAnswers, type TrialValue } from "@/modules/offline-trial/answers";
import { listTrialFields, trialForm } from "@/modules/offline-trial/trial-form";
import { TrialFormView } from "@/modules/offline-trial/trial-form-view";

const FIELD_COUNT = listTrialFields(trialForm).length;

/** Holder svarene i minnet. Ingen lagring i denne prøven (oppgave 4 og 5). */
export function TrialFormPage() {
  const [answers, setAnswers] = useState<TrialAnswers>({});

  function handleChange(fieldKey: string, value: TrialValue) {
    setAnswers((prev) => ({ ...prev, [fieldKey]: value }));
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <div className="sticky top-0 z-10 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-3">
        <p className="text-base font-medium text-slate-900">
          {`${countAnswered(trialForm, answers)} av ${FIELD_COUNT} felt utfylt`}
        </p>
      </div>
      <header className="mb-6 mt-4">
        <Link
          href="/arbeidskoe"
          className="inline-flex min-h-11 min-w-11 items-center text-brand-700 underline"
        >
          Tilbake til arbeidskøen
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Testskjema</h1>
        <p className="mt-1 text-slate-600">
          Dette skjemaet brukes til å prøve appen på iPad. Svarene lagres ikke i denne prøven.
        </p>
      </header>
      <TrialFormView form={trialForm} answers={answers} onChange={handleChange} />
    </main>
  );
}
