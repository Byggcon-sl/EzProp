import {
  carryOverrideDrafts,
  checkPublishOverrideReason,
  costDisplayText,
  PUBLISH_OVERRIDE_REASON_CHECK_MESSAGES,
  publishFindingKey,
  publishFindingText,
  type PublishOverrideDraft,
  type PublishOverrideReasonCheck,
} from "@/core/reports/logic";
import type { PublishCheckView, PublishFindingView } from "@/core/reports/publish-types";
import type { PublishOverrideReasonCode } from "@/db/schema";
import { PUBLISH_TEXTS } from "./publish-texts";

/*
 * Tilstanden på publiser-siden som rene funksjoner (docs/funksjoner/fase2a-publisering-badet-design.md
 * avsnitt 6–12). Ingen nett, ingen database, ingen dagens dato: testes for seg. Sjekken selv
 * (`computePublishCheck`) regnes av serveren og av rommet; her ordnes bare det skjermen viser,
 * og hva hovedknappen sier og gjør.
 * Støtter hovedmål: færre reklamasjoner (knappen sier hvorfor den er sperret, med tall) og de
 * ansatte (valgte grunner går ikke tapt når listen endres).
 */

export type DraftCheck = Extract<PublishCheckView, { state: "draft" }>;

/** Kladden for én sperre: bryteren, grunnen og teksten. Lagres aldri før «Publiser». */
export type OverrideState = {
  on: boolean;
  reasonCode: PublishOverrideReasonCode | null;
  text: string;
  /** «Legg til en forklaring (valgfri)» er åpnet, eller grunnen er «Annet». */
  textOpen: boolean;
  /** Feilen vises når feltet er forlatt eller Publiser er trykket. */
  showError: boolean;
};

export type Overrides = ReadonlyMap<string, OverrideState>;

export const EMPTY_OVERRIDE: OverrideState = {
  on: false,
  reasonCode: null,
  text: "",
  textOpen: false,
  showError: false,
};

/** Kontrollen av grunnen for en kladd som er slått på. */
export function overrideCheck(state: OverrideState): PublishOverrideReasonCheck {
  return checkPublishOverrideReason({ reasonCode: state.reasonCode, text: state.text });
}

/** Feilteksten for kladden, eller `null` når den er gyldig. */
export function overrideError(state: OverrideState): string | null {
  const check = overrideCheck(state);
  return check === "ok" ? null : PUBLISH_OVERRIDE_REASON_CHECK_MESSAGES[check];
}

export function blockersOf(check: DraftCheck): PublishFindingView[] {
  return check.findings.filter((item) => item.severity === "blocker");
}

export function warningsOf(check: DraftCheck): PublishFindingView[] {
  return check.findings.filter((item) => item.severity === "warning");
}

/** Sperrer der bryteren er av: de må rettes eller krysses bort. */
export function openBlockers(check: DraftCheck, overrides: Overrides): PublishFindingView[] {
  return blockersOf(check).filter((item) => !overrides.get(item.key)?.on);
}

/** Sperrer der bryteren er på, men grunnen mangler eller teksten er feil. */
export function blockersMissingReason(
  check: DraftCheck,
  overrides: Overrides,
): PublishFindingView[] {
  return blockersOf(check).filter((item) => {
    const state = overrides.get(item.key);
    return state?.on === true && overrideCheck(state) !== "ok";
  });
}

/** Det som sendes til serveren: bare sperrer med bryteren på og gyldig grunn. */
export function overridesToSend(
  check: DraftCheck,
  overrides: Overrides,
): { findingKey: string; reasonCode: PublishOverrideReasonCode; text: string | null }[] {
  return blockersOf(check).flatMap((item) => {
    const state = overrides.get(item.key);
    if (!state?.on || state.reasonCode === null || overrideCheck(state) !== "ok") return [];
    const text = state.text.trim();
    return [
      { findingKey: item.key, reasonCode: state.reasonCode, text: text === "" ? null : text },
    ];
  });
}

/**
 * Kladdene ført over til en ny liste (F3): samme kode og mål beholder bryter, grunn og tekst.
 * Kladder for funn som er borte, faller bort. `added` er nøklene til nye sperrer.
 */
export function carryOverrides(
  previous: readonly PublishFindingView[],
  next: readonly PublishFindingView[],
  overrides: Overrides,
): { overrides: Map<string, OverrideState>; added: Set<string> } {
  const drafts: PublishOverrideDraft[] = [...overrides.entries()].map(([findingKey, state]) => ({
    findingKey,
    reasonCode: state.reasonCode,
    text: state.text,
  }));
  const carried = carryOverrideDrafts(previous, next, drafts);
  const kept = new Map<string, OverrideState>();
  for (const draft of carried.drafts) {
    const state = overrides.get(draft.findingKey);
    if (state) kept.set(draft.findingKey, state);
  }
  return { overrides: kept, added: new Set(carried.added.map((item) => publishFindingKey(item))) };
}

/** Hva hovedknappen viser og gjør, i fast rekkefølge (design avsnitt 12). */
export type BarState =
  | { kind: "not_allowed" }
  | { kind: "offline"; status: string; label: string }
  | { kind: "waiting_for_sync"; status: string; label: string }
  | { kind: "blockers"; label: string; announcement: string; focusKey: string }
  | { kind: "missing_reason"; label: string; announcement: string; focusKey: string }
  | { kind: "publishing"; label: string }
  | { kind: "ready"; status: string; label: string };

export function barState(input: {
  check: DraftCheck;
  overrides: Overrides;
  online: boolean;
  pendingChanges: number;
  publishing: boolean;
}): BarState {
  const { check, overrides } = input;
  const version = check.nextVersionNumber;
  if (!check.ability.allowed) return { kind: "not_allowed" };
  if (input.publishing) return { kind: "publishing", label: PUBLISH_TEXTS.publishing };
  if (!input.online) {
    return {
      kind: "offline",
      status: PUBLISH_TEXTS.offline,
      label: PUBLISH_TEXTS.publish(version),
    };
  }
  if (input.pendingChanges > 0) {
    return {
      kind: "waiting_for_sync",
      status: PUBLISH_TEXTS.waitingForSync(input.pendingChanges),
      label: PUBLISH_TEXTS.publish(version),
    };
  }
  const open = openBlockers(check, overrides);
  if (open.length > 0) {
    return {
      kind: "blockers",
      label: PUBLISH_TEXTS.publishBlocked(open.length),
      announcement: PUBLISH_TEXTS.blockedAnnouncement(open.length),
      focusKey: open[0]!.key,
    };
  }
  const missing = blockersMissingReason(check, overrides);
  if (missing.length > 0) {
    return {
      kind: "missing_reason",
      label: PUBLISH_TEXTS.publishMissingReason(missing.length),
      announcement: PUBLISH_TEXTS.missingReasonAnnouncement(missing.length),
      focusKey: missing[0]!.key,
    };
  }
  return { kind: "ready", status: PUBLISH_TEXTS.allSaved, label: PUBLISH_TEXTS.publish(version) };
}

/** Funnteksten med avviksnummer og TG fra visningen. */
export function findingText(item: PublishFindingView): string {
  return publishFindingText(item, {
    deviationNumber: item.deviationNumber,
    deviationTg: item.deviationTg,
  });
}

/** Overskriften for gruppen et funn står i: «Rapporten» eller romnavnet. */
export function groupHeading(item: PublishFindingView): string {
  if (!item.target.roomId) return PUBLISH_TEXTS.reportGroup;
  return item.roomName ?? PUBLISH_TEXTS.unnamedRoom;
}

/** Funnene gruppert per rom i den faste rekkefølgen fra sjekken. Siden sorterer aldri på nytt. */
export function groupByRoom<T extends PublishFindingView>(
  items: readonly T[],
): { id: string; heading: string; items: T[] }[] {
  const groups: { id: string; heading: string; items: T[] }[] = [];
  for (const item of items) {
    const id = item.target.roomId ?? "report";
    const last = groups[groups.length - 1];
    if (last && last.id === id) last.items.push(item);
    else groups.push({ id, heading: groupHeading(item), items: [item] });
  }
  return groups;
}

/** Hva «Rett nå» kan gjøre for en sperre (design avsnitt 7), eller `null` for bare «Gå til». */
export type QuickFixKind =
  | { kind: "hole_drilling"; roomId: string }
  | { kind: "cost"; roomId: string; deviationId: string }
  | { kind: "checkpoint_tg"; roomId: string; checkpointKey: string }
  | { kind: "deviation_tg"; roomId: string; deviationId: string };

export function quickFixOf(item: PublishFindingView): QuickFixKind | null {
  const { roomId, checkpointKey, deviationId, missing } = item.target;
  if (!roomId) return null;
  switch (item.checkCode) {
    case "wet_or_below_ground_missing_hole":
      // «Annet» uten forklaring krever tekst: bare «Gå til».
      return missing.includes("hole_drilling_reason_note")
        ? null
        : { kind: "hole_drilling", roomId };
    case "tg3_missing_cost":
      return deviationId ? { kind: "cost", roomId, deviationId } : null;
    case "mandatory_without_tg":
      if (deviationId) return { kind: "deviation_tg", roomId, deviationId };
      if (missing.includes("reason") || !checkpointKey) return null;
      return { kind: "checkpoint_tg", roomId, checkpointKey };
    default:
      return null;
  }
}

/** «Avvik 1» eller «Avviket». */
export function deviationName(number: number | null): string {
  return number === null ? "Avviket" : `Avvik ${number}`;
}

/** Kostnaden som tekst («50 000–100 000 kr» eller «ca. 40 000 kr»). */
export function costText(cost: {
  type: "band" | "approx" | "none";
  bandKey: string | null;
  amount: number | null;
}): string {
  return costDisplayText(cost.type, { bandKey: cost.bandKey, amount: cost.amount });
}

/** ÅÅÅÅ-MM-DD som DD.MM.ÅÅÅÅ. Ugyldig dato gis tilbake som den er. */
export function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDate;
}

/** Siste gyldige dag som «01.11» (design avsnitt 4 viser dag og måned; punktum står i teksten). */
export function formatDayMonth(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}.${match[2]}` : isoDate;
}

/** Meldingen øverst når den ansatte ikke kan publisere (F5), eller `null`. */
export function abilityNotice(check: DraftCheck): string | null {
  const ability = check.ability;
  if (ability.allowed) return null;
  if (ability.reason === "missing_permission") return PUBLISH_TEXTS.noPermission;
  return ability.expiredOn
    ? PUBLISH_TEXTS.certificationExpired(formatDayMonth(ability.expiredOn))
    : PUBLISH_TEXTS.certificationMissing;
}

/** Kort, stabil DOM-id fra funnets nøkkel, til fokus og `aria-*`. */
export function findingDomId(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return `finding-${(hash >>> 0).toString(36)}`;
}

/**
 * Mangelen uten `missing`: kode, rom, punkt og avvik. Brukes til å holde «Rett nå» åpen når
 * mangelen endrer form (for eksempel «ikke besvart» → «grunn mangler»), og til merket «Ny siden
 * du åpnet siden», som bare gis når mangelen er ny på stedet.
 */
export function anchorOf(item: PublishFindingView): string {
  const { roomId, checkpointId, deviationId, ruleKey, aiUsageId } = item.target;
  return [item.checkCode, roomId, checkpointId, deviationId, ruleKey, aiUsageId]
    .map((part) => part ?? "")
    .join("|");
}

/** Sperrer i den nye listen som ikke fantes på samme sted før («Ny siden du åpnet siden»). */
export function addedAnchorsOf(
  previous: readonly PublishFindingView[],
  next: readonly PublishFindingView[],
): Set<string> {
  const before = new Set(previous.map(anchorOf));
  return new Set(
    next.filter((item) => item.severity === "blocker" && !before.has(anchorOf(item))).map(anchorOf),
  );
}
