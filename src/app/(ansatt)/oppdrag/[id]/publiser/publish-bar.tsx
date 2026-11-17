"use client";

import Link from "next/link";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { FormMessage } from "@/shared/ui/form";
import type { BarState } from "./publish-model";
import { PUBLISH_TEXTS } from "./publish-texts";

/*
 * Nedre linje med hovedknappen (docs/funksjoner/fase2a-publisering-badet-design.md avsnitt 12).
 * Fast nederst. Er knappen sperret, brukes `aria-disabled` (ikke `disabled`), så trykk virker og
 * forklarer: fokus til statuslinjen (nett, synk) eller til første sperre som ikke er håndtert.
 * Ingen bekreftelsesdialog: siden er gjennomgangen.
 * Støtter hovedmål: færre reklamasjoner (knappen sier hvorfor, med tall) og de ansatte (2 trykk
 * uten mangler).
 */

export const PUBLISH_BUTTON_ID = "publish-button";
export const PUBLISH_STATUS_ID = "publish-bar-status";
export const PUBLISH_ERROR_ID = "publish-error";

export type PublishBarError = { message: string; releasesHref?: string };

export function PublishBar({
  state,
  notice,
  error,
  onPress,
}: {
  state: BarState;
  /** Teksten fra øverst på siden når den ansatte ikke kan publisere (F5). */
  notice: string | null;
  error: PublishBarError | null;
  onPress: () => void;
}) {
  const blocked = state.kind !== "ready";
  const status =
    state.kind === "offline" || state.kind === "waiting_for_sync" || state.kind === "ready"
      ? state.status
      : "";
  const statusTone =
    state.kind === "offline"
      ? "text-sync-offline-text"
      : state.kind === "waiting_for_sync"
        ? "text-sync-pending-text"
        : "text-slate-700";

  return (
    <div className="sticky bottom-0 z-10 border-t border-line bg-white px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-6">
      <div className="mx-auto max-w-190 space-y-2">
        {error && (
          <div id={PUBLISH_ERROR_ID} tabIndex={-1} className="space-y-1">
            <FormMessage message={error.message} />
            {error.releasesHref && (
              <Link
                href={error.releasesHref}
                className="inline-flex min-h-11 items-center font-medium text-fjord-dark underline"
              >
                {PUBLISH_TEXTS.seeReleases}
                <span aria-hidden="true">&nbsp;›</span>
              </Link>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2 lg:min-h-18 lg:flex-row lg:items-center lg:justify-end lg:gap-4">
          <p
            id={PUBLISH_STATUS_ID}
            role="status"
            aria-live="polite"
            tabIndex={-1}
            className={cn("text-sm lg:mr-auto", statusTone)}
          >
            {state.kind === "not_allowed" ? notice : status}
          </p>
          {state.kind !== "not_allowed" && (
            <Button
              id={PUBLISH_BUTTON_ID}
              size="lg"
              aria-disabled={blocked || undefined}
              className={cn(
                "w-full lg:w-auto lg:min-w-70",
                blocked && "bg-slate-500 hover:bg-slate-500",
              )}
              onClick={onPress}
            >
              {state.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
