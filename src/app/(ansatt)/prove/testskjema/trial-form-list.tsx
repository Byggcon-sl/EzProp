"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { storageHealthText } from "@/modules/offline-trial/storage-health";
import { SyncStatus } from "@/modules/offline-trial/sync-status";
import type { TrialFormSummary } from "@/modules/offline-trial/sync/types";
import { useStickyScrollPadding } from "@/shared/lib/use-sticky-scroll-padding";
import { Button } from "@/shared/ui/button";
import { useSyncStatusSource, useTrialSync } from "./trial-sync-provider";
import { useStorageHealth } from "./use-storage-health";

/**
 * Prøve C: hvor mye plass appen bruker og får på denne iPaden, og om lagringen er varig. Måles når
 * siden åpnes, og igjen etter at appen har bedt om varig lagring. Ingen knapp; ny innlasting måler
 * på nytt.
 */
function StorageHealthBox() {
  const { health } = useStorageHealth();

  if (!health) return null;
  return (
    <section
      aria-label="Lagring på denne iPaden"
      data-testid="storage-health"
      data-storage-level={health.level}
      data-storage-persisted={health.persisted}
      className="mt-4 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200 ring-inset"
    >
      <h2 className="text-sm font-medium text-slate-900">Lagring på denne iPaden</h2>
      <p className="mt-1 text-sm text-slate-700 tabular-nums">{storageHealthText(health)}</p>
    </section>
  );
}

function formatCreatedAt(value: string): string {
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
  const [forms, setForms] = useState<TrialFormSummary[] | null>(null);
  const syncSource = useSyncStatusSource();
  const stickyBarRef = useRef<HTMLDivElement>(null);
  useStickyScrollPadding(stickyBarRef);

  useEffect(() => store.subscribeForms(setForms), [store]);

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
    <main className="mx-auto max-w-3xl px-4 pb-8">
      <div
        ref={stickyBarRef}
        data-testid="sticky-status-bar"
        className="sticky top-0 z-10 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-3"
      >
        <SyncStatus {...syncSource} />
      </div>
      <Link
        href="/arbeidskoe"
        className="mt-4 inline-flex min-h-11 min-w-11 items-center text-brand-700 underline"
      >
        Tilbake til arbeidskøen
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Testskjema</h1>
      <p className="mt-1 text-slate-600">
        Skjemaene brukes til å prøve appen på iPad uten nett. Bare oppdiktede data.
      </p>
      <StorageHealthBox />
      <Button className="mt-4 min-h-11" onClick={createForm} disabled={creating}>
        Nytt testskjema
      </Button>
      {forms === null ? null : forms.length === 0 ? (
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
                Laget {formatCreatedAt(form.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
