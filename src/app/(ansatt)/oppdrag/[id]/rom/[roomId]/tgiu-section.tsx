"use client";

import { useState } from "react";
import {
  CONSTRUCTION_VULNERABLE_LABELS,
  TGIU_FIELD_LABELS,
  TGIU_FIELD_MISSING_TEXT,
  type CheckpointWarning,
} from "@/core/reports/logic";
import type { ReportFieldChange, TgiuDetailsView } from "@/core/reports/types";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { ChoiceButtons } from "@/shared/ui/choice-buttons";
import { Checkbox, FormMessage } from "@/shared/ui/form";
import { TgBadge } from "@/shared/ui/tg-badge";
import { Warning } from "@/shared/ui/warning";
import { setTgDirectAction } from "./actions";
import { FieldStatus } from "./field-status";
import { useField, useRoom } from "./room-context";
import { isActionError, ROOM_TEXTS } from "./room-messages";
import {
  domId,
  TGIU_HEADING_ID,
  tgiuFieldKey,
  undoButtonId,
  visibleTgiuFields,
} from "./room-model";
import { ReportTextField } from "./report-text-field";

/*
 * TGIU på punktet (design avsnitt 12, kortet Omfang 6). Hvilke opplysninger som kreves, følger
 * grunnen; serveren regner advarslene. Skjermen viser de tre faste feltene, feltene advarselen
 * sier mangler, og feltene som alt har verdi, så det aldri kommer falske advarsler. «Fjern TGIU»
 * har ingen dialog: en linje med «Angre» står til punktet forlates, og Angre gir samme tekster
 * tilbake (serveren gjenoppretter det mykt slettede settet).
 * Støtter hovedmål: færre reklamasjoner (TGIU med begrunnelse, forskriften § 2-23).
 */

type TgiuTextField =
  | "reason"
  | "risk_assessment"
  | "how_to_examine"
  | "alternative_check_method"
  | "alternative_check_result";

const TEXT_FIELDS: { field: TgiuTextField; value: (d: TgiuDetailsView | null) => string | null }[] =
  [
    { field: "reason", value: (d) => d?.reason ?? null },
    { field: "risk_assessment", value: (d) => d?.riskAssessment ?? null },
    { field: "how_to_examine", value: (d) => d?.howToExamine ?? null },
    { field: "alternative_check_method", value: (d) => d?.alternativeCheckMethod ?? null },
    { field: "alternative_check_result", value: (d) => d?.alternativeCheckResult ?? null },
  ];

export const TGIU_TEXTS = {
  heading: "TGIU – ikke undersøkt",
  remove: "Fjern TGIU",
} as const;

export function TgiuSection({
  checkpointKey,
  details,
  warnings,
}: {
  checkpointKey: string;
  details: TgiuDetailsView | null;
  warnings: readonly CheckpointWarning[];
}) {
  const { canEdit, run, room, focus, addUndo } = useRoom();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const visible = visibleTgiuFields(details, warnings);
  const missing = new Set(
    warnings.filter((w) => w.code === "tgiu_details_missing").flatMap((w) => w.missing),
  );

  const missingWarning = (field: string) =>
    missing.has(field as CheckpointWarning["missing"][number])
      ? [
          {
            id: `${domId(tgiuFieldKey(checkpointKey, field))}-missing`,
            text: TGIU_FIELD_MISSING_TEXT,
          },
        ]
      : [];

  const removeTgiu = async () => {
    setBusy(true);
    setError(null);
    const result = await run(() =>
      setTgDirectAction(room, { checkpointKey, tgDirect: null, base: "IU" }),
    );
    setBusy(false);
    if (isActionError(result)) {
      setError(result.message);
      return;
    }
    const undoId = `tgiu-${checkpointKey}`;
    addUndo({ kind: "tgiu", id: undoId });
    focus(undoButtonId(undoId));
  };

  return (
    <Card>
      <section aria-labelledby={TGIU_HEADING_ID} className="space-y-5">
        <h3
          id={TGIU_HEADING_ID}
          tabIndex={-1}
          className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold text-slate-900"
        >
          <span>{TGIU_TEXTS.heading}</span>
          <TgBadge tg="IU" />
        </h3>
        {TEXT_FIELDS.filter((f) => visible.has(f.field)).map((f) => (
          <ReportTextField
            key={f.field}
            fieldKey={tgiuFieldKey(checkpointKey, f.field)}
            label={TGIU_FIELD_LABELS[f.field]}
            serverValue={f.value(details)}
            build={(value, base): ReportFieldChange => ({
              table: "tgiu_details",
              checkpointKey,
              field: f.field,
              value: value === "" ? null : value,
              base: base === "" ? null : base,
            })}
            warnings={missingWarning(f.field)}
          />
        ))}
        {visible.has("construction_vulnerable") && (
          <VulnerableChoice
            checkpointKey={checkpointKey}
            serverValue={details?.constructionVulnerable ?? null}
            warning={missingWarning("construction_vulnerable")[0] ?? null}
          />
        )}
        {visible.has("owner_informed") && (
          <OwnerInformed
            checkpointKey={checkpointKey}
            serverValue={details?.ownerInformed ?? null}
            warning={missingWarning("owner_informed")[0] ?? null}
          />
        )}
        {canEdit && (
          <>
            {error && <FormMessage message={error} />}
            <div className="flex justify-end border-t border-line pt-4">
              <Button variant="ghost" onClick={removeTgiu} disabled={busy}>
                {busy ? ROOM_TEXTS.saving : TGIU_TEXTS.remove}
              </Button>
            </div>
          </>
        )}
      </section>
    </Card>
  );
}

function VulnerableChoice({
  checkpointKey,
  serverValue,
  warning,
}: {
  checkpointKey: string;
  serverValue: TgiuDetailsView["constructionVulnerable"];
  warning: { id: string; text: string } | null;
}) {
  const { canEdit } = useRoom();
  const key = tgiuFieldKey(checkpointKey, "construction_vulnerable");
  const field = useField(key, serverValue, (value, base): ReportFieldChange => ({
    table: "tgiu_details",
    checkpointKey,
    field: "construction_vulnerable",
    value: value as TgiuDetailsView["constructionVulnerable"],
    base: base as TgiuDetailsView["constructionVulnerable"],
  }));
  const value = field.entry.value as TgiuDetailsView["constructionVulnerable"];
  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-700">
          {TGIU_FIELD_LABELS.construction_vulnerable}
        </p>
        <p className="text-slate-900">{value ? CONSTRUCTION_VULNERABLE_LABELS[value] : "–"}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <ChoiceButtons
        id={domId(key)}
        legend={TGIU_FIELD_LABELS.construction_vulnerable}
        options={(
          Object.keys(
            CONSTRUCTION_VULNERABLE_LABELS,
          ) as (keyof typeof CONSTRUCTION_VULNERABLE_LABELS)[]
        ).map((option) => ({ value: option, label: CONSTRUCTION_VULNERABLE_LABELS[option] }))}
        value={value}
        describedBy={warning?.id}
        onChange={(next) => field.edit(next, 0)}
      />
      <FieldStatus
        field={field}
        formatValue={(v) =>
          v ? CONSTRUCTION_VULNERABLE_LABELS[v as keyof typeof CONSTRUCTION_VULNERABLE_LABELS] : ""
        }
      />
      {warning && <Warning id={warning.id}>{warning.text}</Warning>}
    </div>
  );
}

function OwnerInformed({
  checkpointKey,
  serverValue,
  warning,
}: {
  checkpointKey: string;
  serverValue: boolean | null;
  warning: { id: string; text: string } | null;
}) {
  const { canEdit } = useRoom();
  const key = tgiuFieldKey(checkpointKey, "owner_informed");
  const field = useField(key, serverValue, (value, base): ReportFieldChange => ({
    table: "tgiu_details",
    checkpointKey,
    field: "owner_informed",
    value: value as boolean | null,
    base: base as boolean | null,
  }));
  const checked = field.entry.value === true;
  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-700">{TGIU_FIELD_LABELS.owner_informed}</p>
        <p className="text-slate-900">{checked ? "Ja" : "Nei"}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Checkbox
        id={domId(key)}
        label={TGIU_FIELD_LABELS.owner_informed}
        checked={checked}
        aria-describedby={warning?.id}
        onChange={(event) => field.edit(event.target.checked, 0)}
      />
      <FieldStatus field={field} formatValue={(v) => (v === true ? "Ja" : "Nei")} />
      {warning && <Warning id={warning.id}>{warning.text}</Warning>}
    </div>
  );
}
