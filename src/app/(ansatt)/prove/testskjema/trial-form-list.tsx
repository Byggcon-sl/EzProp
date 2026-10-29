"use client";

import { useQuery } from "@powersync/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SyncIndicator } from "@/modules/offline-trial/sync-indicator";
import { Button } from "@/shared/ui/button";
import { useIndicatorSource, useTrialSync } from "./trial-sync-provider";

interface FormRow {
  id: string;
  name: string;
  created_at: string | null;
}

function formatCreatedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" });
}

/** Prøve fase 1: testskjemaene på denne enheten (og de som er synket hit), nyeste først. */
export function TrialFormList() {
  const { store } = useTrialSync();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { data: forms } = useQuery<FormRow>(
    `SELECT id, name, created_at FROM trial_forms
     WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
  );
  const indicator = useIndicatorSource();

  async function createForm() {
    setCreating(true);
    try {
      const id = await store.createForm("");
      router.push(`/prove/testskjema/${id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/arbeidskoe"
        className="inline-flex min-h-11 min-w-11 items-center text-brand-700 underline"
      >
        Tilbake til arbeidskøen
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Testskjema</h1>
      <p className="mt-1 text-slate-600">
        Skjemaene brukes til å prøve appen på iPad uten nett. Bare oppdiktede data.
      </p>
      <div className="mt-3">
        <SyncIndicator getStatus={indicator.getStatus} subscribe={indicator.subscribe} />
      </div>
      <Button className="mt-4 min-h-11" onClick={createForm} disabled={creating}>
        Nytt testskjema
      </Button>
      {forms.length === 0 ? (
        <p className="mt-6 text-slate-600">Ingen testskjemaer ennå.</p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {forms.map((form) => (
            <li key={form.id} className="flex items-center justify-between gap-4 px-4 py-1">
              <a
                href={`/prove/testskjema/${form.id}`}
                className="inline-flex min-h-11 min-w-11 items-center font-medium text-brand-700 underline"
              >
                {form.name}
              </a>
              <span className="text-sm text-slate-600">
                Laget {formatCreatedAt(form.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
