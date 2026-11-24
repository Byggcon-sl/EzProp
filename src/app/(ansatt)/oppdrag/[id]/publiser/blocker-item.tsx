"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PUBLISH_OVERRIDE_REASON_LABELS } from "@/core/reports/logic";
import type { PublishFindingView } from "@/core/reports/publish-types";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { OverrideReasons, reasonGroupId } from "./override-reasons";
import { findingText, overrideCheck, type OverrideState } from "./publish-model";
import { PUBLISH_TEXTS } from "./publish-texts";

/*
 * En sperre (docs/funksjoner/fase2a-publisering-badet-design.md avsnitt 6). Hvitt kort med 4 px
 * venstrekant i `night` og ordet «Må rettes», ikke rød tone (rødt er TG3). Funnteksten lages fra
 * koden. «Rett nå» der rettingen er opplagt, «Gå til» med sti bygget på serveren, og bryteren
 * «Publiser likevel» med grunnene rett under (ingen dialog). Uten `report.edit` ingen «Rett nå»;
 * uten `report.publish` ingen bryter.
 * Støtter hovedmål: færre reklamasjoner (sperren passeres bare med aktiv bryter og grunn) og de
 * ansatte (alt for én mangel på ett kort).
 */

export function switchId(baseId: string): string {
  return `${baseId}-switch`;
}

function StopIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-night"
    >
      <path d="M8 2.5h8l5.5 5.5v8L16 21.5H8L2.5 16V8z" />
      <path d="M7.5 12h9" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function BlockerItem({
  baseId,
  item,
  version,
  isNew,
  canPublish,
  canFix,
  fixing,
  onToggleFix,
  quickFix,
  override,
  onOverride,
  onGoTo,
}: {
  baseId: string;
  item: PublishFindingView;
  /** Versjonen som publiseres. */
  version: number;
  isNew: boolean;
  canPublish: boolean;
  /** «Rett nå» finnes for sperren og den ansatte har `report.edit`. */
  canFix: boolean;
  fixing: boolean;
  onToggleFix: () => void;
  /** `QuickFix` når «Rett nå» er åpen. */
  quickFix: ReactNode;
  override: OverrideState;
  onOverride: (next: OverrideState) => void;
  onGoTo: (key: string) => void;
}) {
  const headingId = `${baseId}-heading`;
  const hintId = `${baseId}-hint`;
  const handled = override.on && overrideCheck(override) === "ok";
  const place = item.checkpointLabel ?? item.roomName ?? PUBLISH_TEXTS.reportGroup;
  const previous = item.previousOverride;

  const usePrevious = () => {
    if (!previous) return;
    onOverride({
      on: true,
      reasonCode: previous.reasonCode,
      text: previous.reason ?? "",
      textOpen: previous.reason !== null || previous.reasonCode === "other",
      showError: false,
    });
  };

  return (
    <article
      id={baseId}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={cn(
        "rounded-card border border-l-4 border-line bg-white p-5 md:p-6",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fjord",
        handled ? "border-l-line-strong" : "border-l-night",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {handled ? (
          <Badge>
            <CheckIcon />
            {PUBLISH_TEXTS.overridden}
          </Badge>
        ) : (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <StopIcon />
            {PUBLISH_TEXTS.mustFix}
          </p>
        )}
        {isNew && <Badge tone="brand">{PUBLISH_TEXTS.newSinceOpened}</Badge>}
      </div>
      <h4 id={headingId} className="mt-2 text-base font-medium break-words text-slate-900">
        {findingText(item)}
      </h4>
      {item.checkpointLabel && <p className="text-sm text-slate-700">{item.checkpointLabel}</p>}

      <div className="mt-4 flex flex-wrap gap-2 md:gap-3">
        {canFix && (
          <Button
            id={`${baseId}-fix-toggle`}
            variant={fixing ? "ghost" : "secondary"}
            aria-expanded={fixing}
            onClick={onToggleFix}
          >
            {fixing ? PUBLISH_TEXTS.close : PUBLISH_TEXTS.fixNow}
          </Button>
        )}
        {item.href && (
          <Link
            href={item.href}
            onClick={() => onGoTo(item.key)}
            aria-label={PUBLISH_TEXTS.goToLabel(place)}
            className={buttonVariants({ variant: "secondary", size: "md" })}
          >
            {PUBLISH_TEXTS.goTo}
          </Link>
        )}
      </div>
      {fixing && <div className="mt-4">{quickFix}</div>}

      {canPublish && (
        <div className="mt-4 border-t border-line pt-3">
          {previous && !override.on && (
            <div className="mb-3 space-y-2">
              <p className="line-clamp-2 text-sm text-slate-900">
                {PUBLISH_TEXTS.previousOverride(
                  previous.versionNumber,
                  PUBLISH_OVERRIDE_REASON_LABELS[previous.reasonCode],
                )}
                {previous.reason && <> «{previous.reason}»</>}
              </p>
              <Button variant="secondary" onClick={usePrevious}>
                {PUBLISH_TEXTS.useSameReason}
              </Button>
            </div>
          )}
          <Switch
            id={switchId(baseId)}
            label={PUBLISH_TEXTS.publishAnyway}
            checked={override.on}
            describedBy={hintId}
            onChange={(on) => {
              onOverride({ ...override, on, showError: false });
              if (on) {
                requestAnimationFrame(() =>
                  document.getElementById(`${reasonGroupId(baseId)}-0`)?.focus(),
                );
              }
            }}
          />
          <p id={hintId} className="mt-1 text-sm text-slate-600">
            {PUBLISH_TEXTS.overrideHint(version)}
          </p>
          {override.on && (
            <OverrideReasons baseId={baseId} state={override} onChange={onOverride} />
          )}
        </div>
      )}
    </article>
  );
}
