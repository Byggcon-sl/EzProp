"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SyncIndicator } from "@/modules/offline-trial/sync-indicator";
import { writeSyncCandidate } from "@/modules/offline-trial/sync/select-store";
import type {
  TrialFormSummary,
  TrialSyncCandidate,
  TrialSyncStatus,
  TrialSyncStore,
} from "@/modules/offline-trial/sync/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useIndicatorSource, useTrialSync } from "./trial-sync-provider";

const STATUS_POLL_MS = 2000;

const CANDIDATE_LABELS: Record<TrialSyncCandidate, string> = {
  powersync: "PowerSync",
  electricsql: "ElectricSQL",
  custom: "Egenbygd",
};

/** Status fra lageret, oppdatert ved varsel og hvert 2. sekund. Null til første svar. */
function useSyncStatus(store: TrialSyncStore): TrialSyncStatus | null {
  const [status, setStatus] = useState<TrialSyncStatus | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      store.status().then(
        (next) => {
          if (active) setStatus(next);
        },
        () => undefined,
      );
    };
    const dispose = store.onStatusChange(refresh);
    const interval = setInterval(refresh, STATUS_POLL_MS);
    refresh();
    return () => {
      active = false;
      dispose();
      clearInterval(interval);
    };
  }, [store]);
  return status;
}

/**
 * Prøve fase 1: velgeren «Synkløsning». Bytte = lagre valget og last siden på nytt; bare tillatt
 * når ingenting venter på å bli sendt. Hver kandidat har sin egen lagring; ingenting slettes.
 */
function CandidatePicker() {
  const { store, candidate } = useTrialSync();
  const status = useSyncStatus(store);
  const waiting = status !== null && (status.pendingChanges > 0 || status.pendingPhotos > 0);

  function choose(next: TrialSyncCandidate) {
    if (next === candidate) return;
    writeSyncCandidate(next);
    window.location.reload();
  }

  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-medium text-slate-900">Synkløsning</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {(Object.keys(CANDIDATE_LABELS) as TrialSyncCandidate[]).map((option) => {
          const selected = option === candidate;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              disabled={!selected && (status === null || waiting)}
              onClick={() => choose(option)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-base disabled:opacity-60",
                selected
                  ? "bg-brand-50 font-semibold text-slate-900 ring-2 ring-brand-700 ring-inset"
                  : "bg-white text-slate-900 ring-1 ring-slate-300 ring-inset hover:bg-slate-50",
              )}
            >
              {selected ? <span aria-hidden="true">✓</span> : null}
              {CANDIDATE_LABELS[option]}
            </button>
          );
        })}
      </div>
      {waiting ? (
        <p className="mt-2 text-sm text-slate-700">
          Vent til alt er lagret på serveren før du bytter
        </p>
      ) : null}
    </fieldset>
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
  const indicator = useIndicatorSource();

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
      <CandidatePicker />
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
