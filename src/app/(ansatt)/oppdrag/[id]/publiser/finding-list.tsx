"use client";

import type { ReactNode } from "react";
import type { PublishFindingView } from "@/core/reports/publish-types";
import { BlockerItem } from "./blocker-item";
import {
  anchorOf,
  blockersOf,
  EMPTY_OVERRIDE,
  findingDomId,
  groupByRoom,
  overrideCheck,
  quickFixOf,
  warningsOf,
  type DraftCheck,
  type Overrides,
  type OverrideState,
} from "./publish-model";
import { PUBLISH_TEXTS } from "./publish-texts";
import { WarningItem } from "./warning-item";

/*
 * Funnlisten (docs/funksjoner/fase2a-publisering-badet-design.md avsnitt 6 og 9): først «Må rettes
 * eller krysses bort» per rom, så «Bør sees over». Rekkefølgen er den faste sorteringen fra
 * sjekken; siden sorterer aldri på nytt. Rettede sperrer står som én linje til listen hentes på
 * nytt av noe annet.
 * Støtter hovedmål: de ansatte (alt som mangler på ett sted) og færre reklamasjoner.
 */

/** En sperre som nettopp ble rettet med «Rett nå». */
export type FixedLine = { anchor: string; roomId: string | null; heading: string; text: string };

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="mt-0.5 shrink-0"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

type Entry = { kind: "blocker"; item: PublishFindingView } | { kind: "fixed"; line: FixedLine };

/** Sperrene gruppert per rom, med rettede linjer i rommet de hører til. */
function blockerGroups(check: DraftCheck, fixed: readonly FixedLine[]) {
  const groups = groupByRoom(blockersOf(check)).map((group) => ({
    id: group.id,
    heading: group.heading,
    entries: group.items.map((item): Entry => ({ kind: "blocker", item })),
  }));
  for (const line of fixed) {
    const id = line.roomId ?? "report";
    const group = groups.find((g) => g.id === id);
    if (group) group.entries.push({ kind: "fixed", line });
    else groups.push({ id, heading: line.heading, entries: [{ kind: "fixed", line }] });
  }
  return groups;
}

export function FindingList({
  check,
  overrides,
  onOverride,
  addedAnchors,
  fixingAnchor,
  onToggleFix,
  renderQuickFix,
  fixed,
  renderAi,
  aiHandledCount,
  onGoTo,
}: {
  check: DraftCheck;
  overrides: Overrides;
  onOverride: (key: string, next: OverrideState) => void;
  addedAnchors: ReadonlySet<string>;
  fixingAnchor: string | null;
  onToggleFix: (anchor: string) => void;
  renderQuickFix: (item: PublishFindingView, baseId: string) => ReactNode;
  fixed: readonly FixedLine[];
  /** Forslagskortet for et KI-forslag som venter (F4). */
  renderAi: (item: PublishFindingView) => ReactNode;
  /** KI-forslag som er behandlet på siden og ikke lenger teller. */
  aiHandledCount: number;
  onGoTo: (key: string) => void;
}) {
  const canPublish = check.ability.allowed;
  const blockers = blockersOf(check);
  const remaining = blockers.filter((item) => {
    const state = overrides.get(item.key);
    return !(state?.on && overrideCheck(state) === "ok");
  }).length;
  const warnings = warningsOf(check);
  const groups = blockerGroups(check, fixed);

  return (
    <div className="space-y-6">
      <section aria-labelledby="blockers-heading" className="space-y-4">
        <h2 id="blockers-heading" className="text-xl font-semibold text-slate-900">
          {PUBLISH_TEXTS.blockersHeading(remaining)}
        </h2>
        {groups.length === 0 && (
          <p className="flex items-start gap-2 text-base text-slate-900">
            <CheckIcon />
            {PUBLISH_TEXTS.noBlockers}
          </p>
        )}
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`group-${group.id}`} className="space-y-3">
            <h3 id={`group-${group.id}`} className="text-lg font-semibold text-slate-900">
              {group.heading}
            </h3>
            <ul className="space-y-4">
              {group.entries.map((entry) => {
                if (entry.kind === "fixed") {
                  return (
                    <li
                      key={`fixed-${entry.line.anchor}`}
                      className="flex items-start gap-2 rounded-card border border-line bg-white px-5 py-3 text-base text-slate-900"
                    >
                      <CheckIcon />
                      {PUBLISH_TEXTS.fixedLine(entry.line.text)}
                    </li>
                  );
                }
                const item = entry.item;
                const anchor = anchorOf(item);
                const baseId = findingDomId(anchor);
                const fix = quickFixOf(item);
                return (
                  <li key={anchor}>
                    <BlockerItem
                      baseId={baseId}
                      item={item}
                      version={check.nextVersionNumber}
                      isNew={addedAnchors.has(anchor)}
                      canPublish={canPublish}
                      canFix={fix !== null && check.canEdit}
                      fixing={fixingAnchor === anchor && fix !== null}
                      onToggleFix={() => onToggleFix(anchor)}
                      quickFix={fix ? renderQuickFix(item, baseId) : null}
                      override={overrides.get(item.key) ?? EMPTY_OVERRIDE}
                      onOverride={(next) => onOverride(item.key, next)}
                      onGoTo={onGoTo}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </section>

      {warnings.length > 0 && (
        <section aria-labelledby="warnings-heading" className="space-y-4">
          <h2 id="warnings-heading" className="text-xl font-semibold text-slate-900">
            {PUBLISH_TEXTS.warningsHeading(Math.max(0, warnings.length - aiHandledCount))}
          </h2>
          <ul className="space-y-4">
            {warnings.map((item) => (
              <li key={item.key}>
                {item.checkCode === "ai_suggestion_pending" ? (
                  renderAi(item)
                ) : (
                  <WarningItem item={item} onGoTo={onGoTo} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
