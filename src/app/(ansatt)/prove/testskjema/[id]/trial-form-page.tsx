"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  countAnswered,
  type TrialAnswers,
  type TrialPhoto,
  type TrialValue,
} from "@/modules/offline-trial/answers";
import { detectForeignChanges } from "@/modules/offline-trial/foreign-change";
import { SyncIndicator } from "@/modules/offline-trial/sync-indicator";
import { rowsToAnswers } from "@/modules/offline-trial/sync/answer-rows";
import type { TrialAnswerRow, TrialFormSnapshot } from "@/modules/offline-trial/sync/types";
import { listTrialFields, trialForm } from "@/modules/offline-trial/trial-form";
import { TrialFormView } from "@/modules/offline-trial/trial-form-view";
import { useIndicatorSource, useTrialSync } from "../trial-sync-provider";

const FIELD_COUNT = listTrialFields(trialForm).length;

/** Det brukeren nettopp gjorde, vist til den lokale databasen har det (unngår hakk og tap ved raske trykk). */
interface PendingValue {
  value: TrialValue;
  written: boolean;
}

/** Når databasen har svaret (eller skrivingen er ferdig), gjelder databasen igjen. */
function withoutSaved(
  current: Record<string, PendingValue>,
  saved: TrialAnswers,
): Record<string, PendingValue> {
  const keys = Object.keys(current);
  if (keys.length === 0) return current;
  const next: Record<string, PendingValue> = {};
  for (const key of keys) {
    const entry = current[key]!;
    if (entry.written || JSON.stringify(saved[key] ?? null) === JSON.stringify(entry.value)) {
      continue;
    }
    next[key] = entry;
  }
  return Object.keys(next).length === keys.length ? current : next;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Prøve fase 1: ett testskjema. Alt lagres i den lokale databasen idet det skrives og sendes til
 * serveren i bakgrunnen. Telleren viser det som er lagret på enheten.
 */
export function TrialFormPage({ formId }: { formId: string }) {
  const { store, deviceId } = useTrialSync();
  const indicator = useIndicatorSource();
  const [snapshot, setSnapshot] = useState<TrialFormSnapshot | null>(null);
  const [foreignChanges, setForeignChanges] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [pending, setPending] = useState<Record<string, PendingValue>>({});
  const previousAnswers = useRef<TrialAnswerRow[] | null>(null);

  useEffect(() => {
    previousAnswers.current = null;
    return store.subscribe(formId, (next) => {
      const previous = previousAnswers.current;
      previousAnswers.current = next.answers;
      // Første lasting gir aldri varsel (previous er null).
      if (previous) {
        const changed = detectForeignChanges(previous, next.answers, deviceId);
        if (changed.size > 0) {
          setForeignChanges((current) => new Set([...current, ...changed]));
        }
      }
      setPending((current) => withoutSaved(current, rowsToAnswers(next.answers, next.photos)));
      setSnapshot(next);
    });
  }, [store, formId, deviceId]);

  const savedAnswers = useMemo<TrialAnswers>(
    () => (snapshot ? rowsToAnswers(snapshot.answers, snapshot.photos) : {}),
    [snapshot],
  );

  const shownAnswers = useMemo<TrialAnswers>(() => {
    const merged: TrialAnswers = { ...savedAnswers };
    for (const [key, entry] of Object.entries(pending)) merged[key] = entry.value;
    return merged;
  }, [savedAnswers, pending]);

  const handleChange = useCallback(
    (fieldKey: string, value: TrialValue) => {
      const entry: PendingValue = { value, written: false };
      setPending((current) => ({ ...current, [fieldKey]: entry }));
      store.setAnswer(formId, fieldKey, value).then(
        () => {
          entry.written = true;
        },
        (error: unknown) => {
          console.error("Kunne ikke lagre svaret på enheten.", error);
        },
      );
    },
    [store, formId],
  );

  const handleFieldTouched = useCallback((fieldKey: string) => {
    setForeignChanges((current) => {
      if (!current.has(fieldKey)) return current;
      const next = new Set(current);
      next.delete(fieldKey);
      return next;
    });
  }, []);

  const handleAddPhotos = useCallback(
    (fieldKey: string, items: ReadonlyArray<{ file: File; photo: TrialPhoto }>) => {
      void (async () => {
        for (const { file, photo } of items) {
          try {
            await store.addPhoto(formId, fieldKey, file, photo);
          } catch (error) {
            console.error("Kunne ikke lagre bildet på enheten.", error);
          }
        }
      })();
    },
    [store, formId],
  );

  const form = snapshot?.form ?? null;

  if (snapshot && !form) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link
          href="/prove/testskjema"
          className="inline-flex min-h-11 min-w-11 items-center text-brand-700 underline"
        >
          Tilbake til listen
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Testskjema</h1>
        <p className="mt-2 text-slate-600">
          Fant ikke dette testskjemaet på enheten. Er det laget på en annen iPad, kommer det hit når
          enheten har nett. Prøv igjen om litt.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <div className="sticky top-0 z-10 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-3">
        <SyncIndicator getStatus={indicator.getStatus} subscribe={indicator.subscribe} />
        <p className="text-base font-medium text-slate-900">
          {`${countAnswered(trialForm, savedAnswers)} av ${FIELD_COUNT} felt utfylt`}
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
          {form ? `${form.name}. ` : ""}
          Svarene lagres på enheten idet du skriver, og sendes til serveren når det er nett. Bare
          oppdiktede data.
        </p>
      </header>
      {snapshot ? (
        <TrialFormView
          form={trialForm}
          answers={shownAnswers}
          onChange={handleChange}
          foreignChanges={foreignChanges}
          onFieldTouched={handleFieldTouched}
          onAddPhotos={handleAddPhotos}
        />
      ) : null}
    </main>
  );
}
