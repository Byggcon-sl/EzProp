import type {
  REPORT_SUMMARY_MAX_LENGTH,
  SummaryBasisEntry,
  SummaryFindingSource,
  SummaryGroup,
} from "@/db/schema";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import { containsNationalId } from "@/shared/validation/free-text";
import { normalizeSearchText } from "./deviation-search";
import { tgFullLabel } from "./labels";
import type {
  CollectSummaryFindings,
  SummaryCheckpointInput,
  SummaryFinding,
  SummaryTextCheck,
} from "./types";

/*
 * Sammendraget for hele rapporten (docs/funksjoner/fase2a-ki-i-veien.md, A425, A434, A435, A461,
 * A462 og A465). Rent blad: samme regler i nettleseren og på serveren. Koden avgjør hvilke funn
 * som er med, gruppene og rekkefølgen; KI skriver bare teksten per funn under TG3, TG2 og HMS.
 * Ingenting her setter TG.
 */

/**
 * Gruppene i fast rekkefølge. Samme liste som `SUMMARY_GROUPS` i `@/db/schema` (verdien kan ikke
 * hentes derfra i nettleseren); typesjekken under stopper hvis de kommer i utakt.
 */
export const SUMMARY_GROUP_ORDER = ["tg3", "tg2", "tgiu", "hms"] as const satisfies readonly SummaryGroup[];

type SameCodes<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type SummaryGroupOrderMatchesSchema = Assert<
  SameCodes<(typeof SUMMARY_GROUP_ORDER)[number], SummaryGroup>
>;

/** Øvre lengde på sammendraget. Samme tall som CHECK-regelen (`REPORT_SUMMARY_MAX_LENGTH`). */
export const SUMMARY_TEXT_MAX_LENGTH = 10000 satisfies typeof REPORT_SUMMARY_MAX_LENGTH;

/** Kodens overskrifter (A434). KI ser dem aldri; de settes på av kjernen. */
export const SUMMARY_GROUP_HEADINGS: Readonly<Record<SummaryGroup, string>> = {
  tg3: tgFullLabel("3"),
  tg2: tgFullLabel("2"),
  tgiu: tgFullLabel("IU"),
  hms: "HMS Forhold som gjelder helse, miljø og sikkerhet",
};

function hasText(text: string | null): text is string {
  return text !== null && text.trim() !== "";
}

function compareOrder(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function groupOfDeviation(deviation: SummaryCheckpointInput["deviations"][number]) {
  if (deviation.kind === "hms") return "hms" as const;
  if (deviation.tg === 3) return "tg3" as const;
  if (deviation.tg === 2) return "tg2" as const;
  return null;
}

/** Se `CollectSummaryFindings` i `./types`. */
export const collectSummaryFindings: CollectSummaryFindings = (checkpoints) => {
  type Sorted = { finding: SummaryFinding; order: number[] };
  const sorted: Sorted[] = [];
  let missingTgCount = 0;
  const checkpointList = [...checkpoints].sort(
    (a, b) => compareOrder(a.order, b.order) || a.resultId.localeCompare(b.resultId),
  );
  checkpointList.forEach((checkpoint, checkpointIndex) => {
    const base = {
      checkpointKey: checkpoint.checkpointKey,
      checkpointName: checkpoint.checkpointName,
      roomId: checkpoint.roomId,
    };
    if (checkpoint.tgDirect === "IU") {
      sorted.push({
        finding: {
          ...base,
          source: "checkpoint_result",
          id: checkpoint.resultId,
          group: "tgiu",
          rowVersion: checkpoint.resultRowVersion,
          parts: checkpoint.tgiu
            ? [{ id: checkpoint.tgiu.id, rowVersion: checkpoint.tgiu.rowVersion }]
            : [],
          deviationText: null,
          causeText: null,
          consequenceText: null,
          measures: [],
          tgiuReason: hasText(checkpoint.tgiu?.reason ?? null)
            ? (checkpoint.tgiu?.reason ?? null)
            : null,
        },
        order: [SUMMARY_GROUP_ORDER.indexOf("tgiu"), checkpointIndex, -1],
      });
    }
    const deviations = [...checkpoint.deviations].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    );
    deviations.forEach((deviation, deviationIndex) => {
      const group = groupOfDeviation(deviation);
      if (group === null) {
        if (deviation.kind === "tg" && deviation.tg === null) missingTgCount += 1;
        return;
      }
      const measures = [...deviation.measures].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
      );
      sorted.push({
        finding: {
          ...base,
          source: "deviation",
          id: deviation.id,
          group,
          rowVersion: deviation.rowVersion,
          parts: measures.map((m) => ({ id: m.id, rowVersion: m.rowVersion })),
          deviationText: hasText(deviation.deviationText) ? deviation.deviationText : null,
          causeText: hasText(deviation.causeText) ? deviation.causeText : null,
          consequenceText: hasText(deviation.consequenceText) ? deviation.consequenceText : null,
          measures: measures.map((m) => m.text).filter(hasText),
          tgiuReason: null,
        },
        order: [SUMMARY_GROUP_ORDER.indexOf(group), checkpointIndex, deviationIndex],
      });
    });
  });
  sorted.sort((a, b) => compareOrder(a.order, b.order));
  return { findings: sorted.map((s) => s.finding), missingTgCount };
};

/** Funnene gruppert i fast rekkefølge. Tomme grupper er ikke med. */
export function groupSummaryFindings(
  findings: readonly SummaryFinding[],
): { group: SummaryGroup; heading: string; findings: SummaryFinding[] }[] {
  return SUMMARY_GROUP_ORDER.map((group) => ({
    group,
    heading: SUMMARY_GROUP_HEADINGS[group],
    findings: findings.filter((f) => f.group === group),
  })).filter((g) => g.findings.length > 0);
}

/** Om utkastet trenger KI: bare når det finnes funn under TG3, TG2 eller HMS (A462). */
export function summaryNeedsAi(findings: readonly SummaryFinding[]): boolean {
  return findings.some((f) => f.group !== "tgiu");
}

/** Én TGIU-linje skrevet av koden: punktets navn og grunnen (A462). Aldri «uten funn». */
export function tgiuSummaryLine(finding: Pick<SummaryFinding, "checkpointName" | "tgiuReason">) {
  const reason = finding.tgiuReason?.trim() ?? "";
  return reason === "" ? finding.checkpointName : `${finding.checkpointName}: ${reason}`;
}

/**
 * Utkastet når rapporten bare har TGIU-funn: koden skriver alt, uten KI (A462). Samme form som
 * kjernen bruker: overskriften, så én linje per funn, og tom linje mellom gruppene.
 */
export function assembleCodeOnlySummary(findings: readonly SummaryFinding[]): string {
  return groupSummaryFindings(findings)
    .map((group) => [group.heading, ...group.findings.map(tgiuSummaryLine)].join("\n"))
    .join("\n\n");
}

/** `summary_basis` for funnene: bare id-er, faste koder og `row_version`, aldri tekst (A435). */
export function summaryBasisOf(findings: readonly SummaryFinding[]): SummaryBasisEntry[] {
  return findings.map((f) => ({
    source: f.source,
    id: f.id,
    group: f.group,
    rowVersion: f.rowVersion,
    parts: f.parts.map((p) => ({ id: p.id, rowVersion: p.rowVersion })),
  }));
}

function findingKey(source: SummaryFindingSource, id: string): string {
  return `${source}|${id}`;
}

function samePartList(
  a: readonly { id: string; rowVersion: number }[],
  b: readonly { id: string; rowVersion: number }[],
): boolean {
  if (a.length !== b.length) return false;
  const left = new Map(a.map((p) => [p.id, p.rowVersion]));
  return b.every((p) => left.get(p.id) === p.rowVersion);
}

export type SummaryChanges = {
  added: SummaryFinding[];
  changed: SummaryFinding[];
  removedCount: number;
};

/**
 * «Funnene er endret etter sammendraget» (A435): forskjellen mellom `summary_basis` og dagens
 * funn. Nytt funn, fjernet funn, annen gruppe (TG endret), annen `row_version` på avviket (tekst
 * endret) og endrede deler (tiltak eller TGIU-opplysninger). For et kontrollpunkt med TGIU teller
 * bare gruppen og opplysningene: punktets egen `row_version` endres også når det merkes ferdig, og
 * det skal ikke gi advarselen. `null` når grunnlaget er tomt eller ingenting er endret.
 */
export function compareSummaryBasis(
  basis: readonly SummaryBasisEntry[] | null,
  findings: readonly SummaryFinding[],
): SummaryChanges | null {
  if (!basis || basis.length === 0) return null;
  const before = new Map(basis.map((entry) => [findingKey(entry.source, entry.id), entry]));
  const added: SummaryFinding[] = [];
  const changed: SummaryFinding[] = [];
  const current = new Set<string>();
  for (const finding of findings) {
    const key = findingKey(finding.source, finding.id);
    current.add(key);
    const entry = before.get(key);
    if (!entry) {
      added.push(finding);
      continue;
    }
    const rowChanged = finding.source === "deviation" && entry.rowVersion !== finding.rowVersion;
    if (entry.group !== finding.group || rowChanged || !samePartList(entry.parts, finding.parts)) {
      changed.push(finding);
    }
  }
  const removedCount = [...before.keys()].filter((key) => !current.has(key)).length;
  if (added.length === 0 && changed.length === 0 && removedCount === 0) return null;
  return { added, changed, removedCount };
}

/**
 * Dekningssjekken (A435, A462): TG3- og TGIU-funn der punktets navn ikke står i teksten. Store og
 * små bokstaver og mellomrom regnes likt. Gjelder også tekst skrevet for hånd. Tom tekst gir tom
 * liste (da mangler hele sammendraget, og det er en egen sak). Bare advarsel, aldri sperre.
 */
export function uncoveredSummaryFindings(
  text: string | null,
  findings: readonly SummaryFinding[],
): SummaryFinding[] {
  if (!hasText(text)) return [];
  const normalized = normalizeSearchText(text);
  return findings.filter(
    (f) =>
      (f.group === "tg3" || f.group === "tgiu") &&
      !normalized.includes(normalizeSearchText(f.checkpointName)),
  );
}

/** Om teksten har en av de åtte plassholderne fra vasken (A466). Store og små bokstaver likt. */
export function containsPiiPlaceholder(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLocaleLowerCase("nb");
  return PII_PLACEHOLDERS.some((placeholder) => lower.includes(placeholder));
}

/**
 * Inndatakontrollen for `summary_text` (K1.26): øvre lengde, ingen fødselsnummer (elleve sifre,
 * også med mellomrom eller punktum mellom) og ingen plassholder fra vasken. Tom tekst er lov.
 */
export function checkSummaryText(text: string | null): SummaryTextCheck {
  if (text === null || text === "") return "ok";
  if (text.length > SUMMARY_TEXT_MAX_LENGTH) return "too_long";
  if (containsNationalId(text)) return "national_id";
  if (containsPiiPlaceholder(text)) return "placeholder";
  return "ok";
}
