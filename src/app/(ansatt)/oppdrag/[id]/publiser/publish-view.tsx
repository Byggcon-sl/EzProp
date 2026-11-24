"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PublishFindingView } from "@/core/reports/publish-types";
import { buttonVariants } from "@/shared/ui/button";
import { AiSuggestion, type AiSuggestionCardStatus } from "@/shared/ui/ai-suggestion";
import { Notice } from "@/shared/ui/notice";
import { decideAiSuggestionAction, publishAction, refreshPublishCheckAction } from "./actions";
import type { AiFieldInfo } from "./ai-fields";
import { FindingList, type FixedLine } from "./finding-list";
import { reasonGroupId, reasonTextId } from "./override-reasons";
import {
  PUBLISH_BUTTON_ID,
  PUBLISH_ERROR_ID,
  PUBLISH_STATUS_ID,
  PublishBar,
  type PublishBarError,
} from "./publish-bar";
import { forgetPublishPage, peekPublishPage, rememberPublishPage } from "./publish-memory";
import {
  abilityNotice,
  addedAnchorsOf,
  anchorOf,
  barState,
  blockersMissingReason,
  blockersOf,
  carryOverrides,
  findingDomId,
  findingText,
  formatDate,
  openBlockers,
  overrideCheck,
  overridesToSend,
  quickFixOf,
  type DraftCheck,
  type OverrideState,
} from "./publish-model";
import { PublishSummary } from "./publish-summary";
import { PUBLISH_TEXTS } from "./publish-texts";
import { QuickFix, type QuickFixResult } from "./quick-fix";

/*
 * Publiser-siden (docs/funksjoner/fase2a-publisering-badet.md Omfang 5–7, F1–F5, designet
 * docs/funksjoner/fase2a-publisering-badet-design.md). Én kolonne ovenfra og ned: melding om rett
 * eller sertifisering, «Dette publiseres», sperrene, advarslene og hovedknappen nederst. Ingen
 * dialog, ingen nedtrekk. Sjekken regnes av serveren; skjermen ordner bare det som vises, og sender
 * fingeravtrykket og de valgte grunnene tilbake. Endres listen, kommer den nye listen tilbake, og
 * grunnene for samme mangel står igjen. Tilgangen sjekkes i kjernen; `ability` og `canEdit` styrer
 * bare visningen. KI setter aldri TG, krysser aldri bort og publiserer aldri.
 * Støtter hovedmål: de ansatte (2 trykk uten mangler, 4 for én sperre), færre reklamasjoner
 * (sperren passeres bare med aktiv bryter og grunn) og KI i bunnen (KI-forslag behandles her).
 */

const NOTICE_ID = "publish-list-notice";
const PUBLISHED_ID = "publish-published";
const ANNOUNCER_ID = "publish-announcer";

function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** «17.11.2026 kl. 14.05» i norsk tid. */
function formatWhen(time: Date): string {
  const parts = new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(time);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")} kl. ${part("hour")}.${part("minute")}`;
}

/**
 * Fokus på et element når det finnes. Elementet kan komme med en av de neste tegningene (for
 * eksempel «Versjon 1 er publisert» etter svaret fra serveren), så det prøves i noen bilder.
 */
function focusSoon(id: string, attempts = 10): void {
  const element = document.getElementById(id);
  if (element) {
    element.focus();
    return;
  }
  if (attempts > 0) requestAnimationFrame(() => focusSoon(id, attempts - 1));
}

type Published = {
  versionNumber: number;
  validUntil: string | null;
  when: string;
  overridden: number;
};

type AiLocal = { status: AiSuggestionCardStatus; ownTextBefore: string };

export function PublishView({
  assignmentId,
  assignmentNumber,
  initial,
  initialAiFields,
}: {
  assignmentId: string;
  assignmentNumber: string | null;
  initial: DraftCheck;
  initialAiFields: Record<string, AiFieldInfo>;
}) {
  // Tilbake fra «Gå til»: kladdene står igjen for samme mangel, og listen sier at den er
  // oppdatert (F3). Lest én gang ved første visning.
  const [restored] = useState(() => {
    const memory = peekPublishPage(assignmentId);
    if (!memory) return null;
    const carried = carryOverrides(memory.findings, initial.findings, memory.overrides);
    const added = addedAnchorsOf(memory.findings, initial.findings);
    return { overrides: carried.overrides, added, fromKey: memory.fromKey };
  });
  const [check, setCheck] = useState<DraftCheck>(initial);
  const [overrides, setOverrides] = useState<Map<string, OverrideState>>(
    () => restored?.overrides ?? new Map(),
  );
  const [addedAnchors, setAddedAnchors] = useState<Set<string>>(() => restored?.added ?? new Set());
  const [fixingAnchor, setFixingAnchor] = useState<string | null>(null);
  const [fixed, setFixed] = useState<FixedLine[]>([]);
  const [aiFields, setAiFields] = useState(initialAiFields);
  const [aiLocal, setAiLocal] = useState<Map<string, AiLocal>>(() => new Map());
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<PublishBarError | null>(null);
  const [notice, setNotice] = useState<string | null>(() =>
    restored ? PUBLISH_TEXTS.listUpdated(restored.added.size) : null,
  );
  const [announcement, setAnnouncement] = useState("");
  const [published, setPublished] = useState<Published | null>(null);
  const [alreadyPublished, setAlreadyPublished] = useState(false);
  const online = useOnline();
  const router = useRouter();
  const checkRef = useRef(check);
  const overridesRef = useRef(overrides);
  useEffect(() => {
    checkRef.current = check;
    overridesRef.current = overrides;
  }, [check, overrides]);

  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => (previous === text ? `${text}​` : text));
  }, []);

  useEffect(() => {
    document.title = PUBLISH_TEXTS.documentTitle(assignmentNumber);
  }, [assignmentNumber]);

  /** Ny liste fra serveren: grunner for samme mangel står igjen, nye sperrer merkes. */
  const applyCheck = useCallback((next: DraftCheck) => {
    const previous = checkRef.current.findings;
    const carried = carryOverrides(previous, next.findings, overridesRef.current);
    const added = addedAnchorsOf(previous, next.findings);
    overridesRef.current = carried.overrides;
    checkRef.current = next;
    setOverrides(carried.overrides);
    setAddedAnchors((current) => {
      const kept = new Set(
        [...current].filter((a) => next.findings.some((f) => anchorOf(f) === a)),
      );
      for (const anchor of added) kept.add(anchor);
      return kept;
    });
    setCheck(next);
    return added.size;
  }, []);

  useEffect(() => {
    if (!restored) return;
    forgetPublishPage(assignmentId);
    const from = restored.fromKey
      ? initial.findings.find((item) => item.key === restored.fromKey)
      : undefined;
    focusSoon(
      from ? findingDomId(from.severity === "blocker" ? anchorOf(from) : from.key) : NOTICE_ID,
    );
    // Bare ved første visning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onGoTo = useCallback(
    (key: string) => {
      rememberPublishPage(assignmentId, {
        findings: checkRef.current.findings,
        overrides: new Map(overridesRef.current),
        fromKey: key,
      });
    },
    [assignmentId],
  );

  const track = useCallback(async <T,>(call: () => Promise<T>): Promise<T> => {
    setPending((count) => count + 1);
    try {
      return await call();
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  }, []);

  /** Henter listen på nytt (ren lesing). Gir den nye listen, eller `null` ved feil. */
  const refresh = useCallback(async (): Promise<DraftCheck | null> => {
    try {
      const response = await refreshPublishCheckAction(assignmentId);
      if (response.status !== "ok") {
        setError({ message: response.message });
        return null;
      }
      if (response.check.state === "published") {
        setAlreadyPublished(true);
        return null;
      }
      if (response.check.state !== "draft") return null;
      setAiFields(response.aiFields);
      setAiLocal(new Map());
      applyCheck(response.check);
      return response.check;
    } catch {
      setError({ message: PUBLISH_TEXTS.publishFailed });
      return null;
    }
  }, [assignmentId, applyCheck]);

  /** Neste sperre som ikke er håndtert, eller hovedknappen. */
  const focusNextUnhandled = useCallback(
    (next: DraftCheck, overridesNow: Map<string, OverrideState>) => {
      const open = blockersOf(next).find((item) => {
        const state = overridesNow.get(item.key);
        return !(state?.on && overrideCheck(state) === "ok");
      });
      focusSoon(open ? findingDomId(anchorOf(open)) : PUBLISH_BUTTON_ID);
    },
    [],
  );

  const onQuickFixResult = useCallback(
    async (item: PublishFindingView, result: QuickFixResult) => {
      if (result.kind === "failed") return;
      const anchor = anchorOf(item);
      const next = await refresh();
      if (!next) return;
      if (result.kind === "conflict") {
        announce(PUBLISH_TEXTS.conflict);
        return;
      }
      const stillThere = next.findings.some((f) => anchorOf(f) === anchor);
      if (stillThere) return;
      setFixingAnchor(null);
      setFixed((lines) => [
        ...lines.filter((line) => line.anchor !== anchor),
        {
          anchor,
          roomId: item.target.roomId,
          heading: item.roomName ?? PUBLISH_TEXTS.unnamedRoom,
          text: result.fixedText,
        },
      ]);
      const remaining = openBlockers(next, overridesRef.current).length;
      announce(PUBLISH_TEXTS.fixedAnnouncement(remaining));
      focusNextUnhandled(next, overridesRef.current);
    },
    [refresh, announce, focusNextUnhandled],
  );

  const setOverride = useCallback((key: string, next: OverrideState) => {
    setOverrides((current) => {
      const copy = new Map(current);
      copy.set(key, next);
      return copy;
    });
  }, []);

  const bar = barState({ check, overrides, online, pendingChanges: pending, publishing });

  const press = async () => {
    setError(null);
    switch (bar.kind) {
      case "not_allowed":
      case "publishing":
        return;
      case "offline":
      case "waiting_for_sync":
        focusSoon(PUBLISH_STATUS_ID);
        return;
      case "blockers": {
        announce(bar.announcement);
        const item = check.findings.find((f) => f.key === bar.focusKey);
        if (item) focusSoon(findingDomId(anchorOf(item)));
        return;
      }
      case "missing_reason": {
        announce(bar.announcement);
        const missing = blockersMissingReason(check, overrides);
        setOverrides((current) => {
          const copy = new Map(current);
          for (const item of missing) {
            const state = copy.get(item.key);
            if (state) copy.set(item.key, { ...state, showError: true });
          }
          return copy;
        });
        const first = missing[0];
        if (first) {
          const baseId = findingDomId(anchorOf(first));
          const state = overrides.get(first.key);
          focusSoon(
            state?.reasonCode === null || state === undefined
              ? `${reasonGroupId(baseId)}-0`
              : reasonTextId(baseId),
          );
        }
        return;
      }
      case "ready":
        break;
    }

    setPublishing(true);
    const toSend = overridesToSend(check, overrides);
    try {
      const result = await publishAction({
        assignmentId,
        fingerprint: check.fingerprint,
        overrides: toSend,
      });
      if (result.status === "published") {
        setPublished({
          versionNumber: result.versionNumber,
          validUntil: result.validUntil,
          when: formatWhen(new Date()),
          overridden: toSend.length,
        });
        focusSoon(PUBLISHED_ID);
        return;
      }
      if (result.status === "check_changed") {
        const added = applyCheck(result.check);
        setNotice(PUBLISH_TEXTS.listUpdated(added));
        setError({ message: PUBLISH_TEXTS.listChangedOnPublish });
        focusSoon(NOTICE_ID);
        return;
      }
      if (result.status === "blockers_remaining") {
        const next = await refresh();
        setError({ message: PUBLISH_TEXTS.listChangedOnPublish });
        if (next) focusNextUnhandled(next, overridesRef.current);
        return;
      }
      setError(
        result.code === "already_published"
          ? { message: result.message, releasesHref: `/oppdrag/${assignmentId}#utgivelser` }
          : { message: result.message },
      );
      focusSoon(PUBLISH_ERROR_ID);
    } catch {
      setError({ message: PUBLISH_TEXTS.publishFailed });
      focusSoon(PUBLISH_ERROR_ID);
    } finally {
      setPublishing(false);
    }
  };

  // --- KI-forslag (F4) --------------------------------------------------------------------------

  const decideAi = useCallback(
    async (
      aiUsageId: string,
      roomId: string,
      decision: "accepted" | "rejected" | "undo",
      ownText: string,
    ) => {
      setAiBusy(aiUsageId);
      const before = aiLocal.get(aiUsageId);
      try {
        const response = await track(() =>
          decideAiSuggestionAction({
            assignmentId,
            aiUsageId,
            roomId,
            decision,
            restoreText:
              decision === "undo" && before?.status === "accepted"
                ? before.ownTextBefore
                : undefined,
          }),
        );
        if (response.status !== "decided") {
          announce(response.message);
          return;
        }
        setAiLocal((current) => {
          const copy = new Map(current);
          copy.set(aiUsageId, { status: response.aiStatus, ownTextBefore: ownText });
          return copy;
        });
        announce(
          response.aiStatus === "suggested" ? PUBLISH_TEXTS.aiUndone : PUBLISH_TEXTS.aiHandled,
        );
      } catch {
        announce(PUBLISH_TEXTS.aiFailed);
      } finally {
        setAiBusy(null);
      }
    },
    [aiLocal, assignmentId, track, announce],
  );

  const aiHandledCount = useMemo(
    () => [...aiLocal.values()].filter((local) => local.status !== "suggested").length,
    [aiLocal],
  );

  const renderAi = (item: PublishFindingView) => {
    const aiUsageId = item.target.aiUsageId;
    const suggestion = check.pendingAiSuggestions.find((s) => s.aiUsageId === aiUsageId);
    if (!aiUsageId || !suggestion) return null;
    const roomId = suggestion.target.roomId;
    if (!roomId) return null;
    const info = aiFields[aiUsageId];
    const local = aiLocal.get(aiUsageId);
    const ownText = info?.currentText ?? "";
    const label = info?.label ?? item.checkpointLabel ?? PUBLISH_TEXTS.unnamedRoom;
    const place = item.checkpointLabel ?? item.roomName;
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-900">
          <span className="block font-medium">{PUBLISH_TEXTS.aiPendingLine(label, place)}</span>
          <span className="block text-slate-700">{findingText(item)}</span>
        </p>
        <AiSuggestion
          ownText={local?.status === "accepted" ? suggestion.outputText : ownText}
          suggestionText={suggestion.outputText}
          status={local?.status ?? "suggested"}
          outcome="ok"
          pending={aiBusy === aiUsageId ? "decision" : null}
          online={online}
          aiEnabled
          hasNewerSuggestion={false}
          aiUsageId={aiUsageId}
          onUse={() => void decideAi(aiUsageId, roomId, "accepted", ownText)}
          onKeep={() => void decideAi(aiUsageId, roomId, "rejected", ownText)}
          onUndo={() => void decideAi(aiUsageId, roomId, "undo", ownText)}
          onNewSuggestion={() => {
            // «Endre»: feltet åpnes på rommet. Ingen nye KI-kall herfra.
            if (item.href) {
              onGoTo(item.key);
              router.push(item.href);
            }
          }}
        />
      </div>
    );
  };

  // --- Visning ------------------------------------------------------------------------------------

  const roomHref = check.preview[0]
    ? `/oppdrag/${assignmentId}/rom/${check.preview[0].roomId}`
    : null;

  if (published) {
    return (
      <div className="mx-auto max-w-190 space-y-4 px-5 pt-5 pb-8 md:px-6">
        <section
          id={PUBLISHED_ID}
          tabIndex={-1}
          aria-labelledby="published-heading"
          className="space-y-4 rounded-card bg-sand p-5 md:p-6"
        >
          <h2 id="published-heading" className="text-xl font-semibold text-slate-900">
            {PUBLISH_TEXTS.publishedHeading(published.versionNumber)}
          </h2>
          <p className="text-slate-900">
            {PUBLISH_TEXTS.publishedLine(
              published.when,
              published.validUntil ? formatDate(published.validUntil) : null,
              published.overridden,
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <Link
              href={`/oppdrag/${assignmentId}`}
              className={buttonVariants({ variant: "primary", size: "lg" }) + " lg:min-w-70"}
            >
              {PUBLISH_TEXTS.toAssignment}
            </Link>
            {roomHref && (
              <Link
                href={roomHref}
                className={buttonVariants({ variant: "secondary", size: "md" })}
              >
                {PUBLISH_TEXTS.seeBathroom}
              </Link>
            )}
          </div>
        </section>
      </div>
    );
  }

  const topNotice = abilityNotice(check);
  return (
    <>
      <div className="mx-auto max-w-190 space-y-6 px-5 pt-5 pb-32 md:px-6">
        <div id={ANNOUNCER_ID} role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
        {topNotice && <Notice message={topNotice} />}
        {alreadyPublished && (
          <Notice
            message={PUBLISH_TEXTS.alreadyPublished}
            link={{ href: `/oppdrag/${assignmentId}#utgivelser`, label: PUBLISH_TEXTS.seeReleases }}
          />
        )}
        <PublishSummary
          version={check.nextVersionNumber}
          validUntil={check.validUntil}
          inherited={check.validUntilInherited}
          rooms={check.preview}
        />
        {notice && (
          <div id={NOTICE_ID} tabIndex={-1}>
            <Notice message={notice} />
          </div>
        )}
        <FindingList
          check={check}
          overrides={overrides}
          onOverride={setOverride}
          addedAnchors={addedAnchors}
          fixingAnchor={fixingAnchor}
          onToggleFix={(anchor) => {
            setFixingAnchor((current) => {
              if (current === anchor) {
                focusSoon(`${findingDomId(anchor)}-fix-toggle`);
                return null;
              }
              return anchor;
            });
          }}
          renderQuickFix={(item, baseId) => {
            const fix = quickFixOf(item);
            if (!fix) return null;
            return (
              <QuickFix
                key={`${baseId}-${fix.kind}`}
                baseId={baseId}
                assignmentId={assignmentId}
                item={item}
                fix={fix}
                track={track}
                onResult={(result) => void onQuickFixResult(item, result)}
              />
            );
          }}
          fixed={fixed}
          renderAi={renderAi}
          aiHandledCount={aiHandledCount}
          onGoTo={onGoTo}
        />
      </div>
      <PublishBar state={bar} notice={topNotice} error={error} onPress={() => void press()} />
    </>
  );
}
