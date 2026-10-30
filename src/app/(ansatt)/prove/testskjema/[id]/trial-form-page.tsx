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
import {
  LOW_STORAGE_WARNING_TEXT,
  storageErrorLog,
  storageErrorMessage,
} from "@/modules/offline-trial/storage-health";
import { throwIfStorageFailHook } from "@/modules/offline-trial/storage-test-hook";
import { SyncStatus } from "@/modules/offline-trial/sync-status";
import { rowsToAnswers } from "@/modules/offline-trial/sync/answer-rows";
import {
  listDisplayFailedPhotoIds,
  onDisplayFailedChange,
} from "@/modules/offline-trial/sync/photo-store";
import type { TrialAnswerRow, TrialFormSnapshot } from "@/modules/offline-trial/sync/types";
import { listTrialFields, trialForm } from "@/modules/offline-trial/trial-form";
import { TrialFormView } from "@/modules/offline-trial/trial-form-view";
import { useStickyScrollPadding } from "@/shared/lib/use-sticky-scroll-padding";
import { Button } from "@/shared/ui/button";
import { useSyncStatusSource, useTrialSync } from "../trial-sync-provider";
import { useStorageHealth } from "../use-storage-health";

const FIELD_COUNT = listTrialFields(trialForm).length;
const FIELD_LABELS = new Map(listTrialFields(trialForm).map((field) => [field.key, field.label]));

/** Et svar eller bilde som ikke ble lagret på enheten (prøve C). Svarverdien står i `pending`. */
interface FailedSave {
  kind: "answer" | "photo";
  fieldKey: string;
  error: unknown;
}

function withoutFailure(
  current: FailedSave[],
  kind: FailedSave["kind"],
  fieldKey: string,
): FailedSave[] {
  const next = current.filter((item) => !(item.kind === kind && item.fieldKey === fieldKey));
  return next.length === current.length ? current : next;
}

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

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((item) => b.has(item));
}

/**
 * Prøve fase 1: ett testskjema. Alt lagres i den lokale databasen idet det skrives og sendes til
 * serveren i bakgrunnen. Telleren viser det som er lagret på enheten.
 */
export function TrialFormPage({ formId }: { formId: string }) {
  const { store, deviceId, organizationId } = useTrialSync();
  const syncSource = useSyncStatusSource();
  const [snapshot, setSnapshot] = useState<TrialFormSnapshot | null>(null);
  const [foreignChanges, setForeignChanges] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [pending, setPending] = useState<Record<string, PendingValue>>({});
  const previousAnswers = useRef<TrialAnswerRow[] | null>(null);
  /** Prøve C: plassen måles når skjemaet åpnes, før hvert bilde og etter hver lagringsfeil. */
  const { health, measure: measureStorage } = useStorageHealth();
  const [failures, setFailures] = useState<FailedSave[]>([]);
  const [errorHidden, setErrorHidden] = useState(false);
  /** Siste skriving per felt (samme objekt som i `pending`), så en eldre feil ikke overstyrer en nyere. */
  const latestWrite = useRef<Record<string, PendingValue>>({});
  const failuresRef = useRef<FailedSave[]>(failures);
  /** Prøve D: bilder der visningskopien er endelig feilet («Bare originalen er lagret»). */
  const [displayFailed, setDisplayFailed] = useState<ReadonlySet<string>>(EMPTY_SET);

  useEffect(() => {
    failuresRef.current = failures;
  }, [failures]);

  const recordFailure = useCallback(
    (kind: FailedSave["kind"], fieldKey: string, error: unknown) => {
      // Samme svarfelt står én gang, sist i listen; hvert bilde står for seg.
      setFailures((current) => [
        ...(kind === "answer" ? withoutFailure(current, kind, fieldKey) : current),
        { kind, fieldKey, error },
      ]);
      setErrorHidden(false);
      measureStorage();
    },
    [measureStorage],
  );

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

  // Leses ved åpning, når bildene endres og når bildekøen setter en merknad.
  const photoRows = snapshot?.photos;
  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    const read = () => {
      listDisplayFailedPhotoIds().then(
        (ids) => {
          if (active) setDisplayFailed((current) => (sameSet(current, ids) ? current : ids));
        },
        () => undefined,
      );
    };
    read();
    const dispose = onDisplayFailedChange(read);
    return () => {
      active = false;
      dispose();
    };
  }, [organizationId, photoRows]);

  const savedAnswers = useMemo<TrialAnswers>(
    () => (snapshot ? rowsToAnswers(snapshot.answers, snapshot.photos) : {}),
    [snapshot],
  );

  const shownAnswers = useMemo<TrialAnswers>(() => {
    const merged: TrialAnswers = { ...savedAnswers };
    for (const [key, entry] of Object.entries(pending)) merged[key] = entry.value;
    return merged;
  }, [savedAnswers, pending]);

  const writeAnswerRef = useRef<(fieldKey: string, value: TrialValue, retry: boolean) => void>(
    () => undefined,
  );

  /**
   * Skriver svaret på enheten. Feiler det, vises meldingen og feltet merkes; verdien blir stående
   * i `pending`. Lykkes et nytt svar, prøves svarene som feilet, på nytt (bare én runde).
   */
  const writeAnswer = useCallback(
    (fieldKey: string, value: TrialValue, retry: boolean) => {
      const entry: PendingValue = { value, written: false };
      latestWrite.current[fieldKey] = entry;
      setPending((current) => ({ ...current, [fieldKey]: entry }));
      const write = async () => {
        throwIfStorageFailHook("answer");
        await store.setAnswer(formId, fieldKey, value);
      };
      write().then(
        () => {
          entry.written = true;
          if (latestWrite.current[fieldKey] === entry) {
            setFailures((current) => withoutFailure(current, "answer", fieldKey));
          }
          if (retry) return;
          for (const failed of failuresRef.current) {
            if (failed.kind !== "answer" || failed.fieldKey === fieldKey) continue;
            const latest = latestWrite.current[failed.fieldKey];
            if (latest) writeAnswerRef.current(failed.fieldKey, latest.value, true);
          }
        },
        (error: unknown) => {
          console.error("Kunne ikke lagre svaret på enheten.", storageErrorLog(error));
          // En nyere skriving i samme felt avgjør om feltet er lagret.
          if (latestWrite.current[fieldKey] === entry) recordFailure("answer", fieldKey, error);
        },
      );
    },
    [store, formId, recordFailure],
  );
  useEffect(() => {
    writeAnswerRef.current = writeAnswer;
  }, [writeAnswer]);

  const handleChange = useCallback(
    (fieldKey: string, value: TrialValue) => writeAnswer(fieldKey, value, false),
    [writeAnswer],
  );

  /** «Prøv igjen»: skriver svarene som feilet, på nytt med verdien som står i feltet. */
  const retryFailedAnswers = useCallback(() => {
    for (const failed of failuresRef.current) {
      if (failed.kind !== "answer") continue;
      const latest = latestWrite.current[failed.fieldKey];
      if (latest) writeAnswer(failed.fieldKey, latest.value, true);
    }
  }, [writeAnswer]);

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
          measureStorage();
          try {
            throwIfStorageFailHook("photo");
            await store.addPhoto(formId, fieldKey, file, photo);
            setFailures((current) => withoutFailure(current, "photo", fieldKey));
          } catch (error) {
            console.error("Kunne ikke lagre bildet på enheten.", storageErrorLog(error));
            recordFailure("photo", fieldKey, error);
          }
        }
      })();
    },
    [store, formId, measureStorage, recordFailure],
  );

  const unsavedFields = useMemo<ReadonlySet<string>>(
    () => (failures.length === 0 ? EMPTY_SET : new Set(failures.map((item) => item.fieldKey))),
    [failures],
  );
  const showError = failures.length > 0 && !errorHidden;
  const errorHasAnswers = failures.some((item) => item.kind === "answer");

  const form = snapshot?.form ?? null;
  const stickyBarRef = useRef<HTMLDivElement>(null);
  useStickyScrollPadding(stickyBarRef);

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
      <div
        ref={stickyBarRef}
        data-testid="sticky-status-bar"
        className="sticky top-0 z-10 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-3"
        data-storage-level={health?.level}
        data-storage-persisted={health?.persisted}
      >
        <SyncStatus {...syncSource} />
        {health?.level === "low" ? (
          <p
            role="status"
            data-testid="storage-low-warning"
            className="mt-2 rounded-xl bg-[#fbe7b5] px-3 py-2 text-sm font-medium text-[#6b4405]"
          >
            {LOW_STORAGE_WARNING_TEXT}
          </p>
        ) : null}
        {showError ? (
          <div
            role="alert"
            data-testid="storage-error"
            className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-red-800"
          >
            {/* Fast høyde: linjen vokser ikke når det kommer flere feil. */}
            <p className="h-15 overflow-y-auto text-sm leading-5">
              {storageErrorMessage(
                failures.map((item) => ({
                  kind: item.kind,
                  fieldLabel: FIELD_LABELS.get(item.fieldKey) ?? item.fieldKey,
                  error: item.error,
                })),
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {errorHasAnswers ? (
                <Button className="min-h-11" onClick={retryFailedAnswers}>
                  Prøv igjen
                </Button>
              ) : null}
              <Button variant="secondary" className="min-h-11" onClick={() => setErrorHidden(true)}>
                Lukk
              </Button>
            </div>
          </div>
        ) : null}
        <p className="mt-2 text-base font-medium text-slate-900">
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
          unsavedFields={unsavedFields}
          organizationId={organizationId}
          displayFailedPhotoIds={organizationId ? displayFailed : EMPTY_SET}
        />
      ) : null}
    </main>
  );
}
