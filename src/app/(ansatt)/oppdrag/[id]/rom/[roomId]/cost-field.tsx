"use client";

import { useEffect, useState } from "react";
import {
  COST_BAND_LABELS,
  COST_BANDS,
  COST_TYPE_LABELS,
  costDisplayText,
  costNotRoundedText,
  costWarning,
  formatWholeNumber,
  nearestRoundedAmount,
  parseCostAmount,
  useRoundedAmountText as roundedAmountButtonText,
  type CostBandKey,
} from "@/core/reports/logic";
import type { DeviationCost, ReportFieldChange } from "@/core/reports/types";
import { Button } from "@/shared/ui/button";
import { ChoiceButtons } from "@/shared/ui/choice-buttons";
import { Input } from "@/shared/ui/form";
import { Warning } from "@/shared/ui/warning";
import { FieldStatus } from "./field-status";
import { useField, useRoom } from "./room-context";
import { deviationCostChoiceId, deviationFieldKey, domId } from "./room-model";

/*
 * Kostnaden på et avvik (design avsnitt 11, kortet Omfang 5): fem intervaller, eget beløp eller
 * ingen. Eget beløp rundes aldri av automatisk. Ikke rundet til nærmeste 10 000 gir advarsel rett
 * under feltet mens takstmannen skriver (300 ms), med «Bruk 40 000»; aldri sperre eller dialog
 * (regel 12). 0, negative tall og desimaltall gir feil og lagres ikke. Der beløpet står som tekst,
 * vises «ca. 40 000 kr» (oversettelsen i `@/core/reports/logic`).
 */

const APPROX = "approx";
const NONE = "none";
const WARNING_DELAY_MS = 300;

export const NO_COST_ON_TG3 = "TG3 skal ha kostnad.";

function costOf(choice: string, amount: number | null): DeviationCost {
  if (choice === NONE) return { type: "none", bandKey: null, amount: null };
  if (choice === APPROX) return { type: "approx", bandKey: null, amount };
  return { type: "band", bandKey: choice, amount: null };
}

/** Valget i knappene for en lagret kostnad. */
function choiceOf(cost: DeviationCost): string {
  if (cost.type === "band") return cost.bandKey ?? NONE;
  return cost.type;
}

/** Tallet i feltet: «40 000» med vanlig mellomrom, uten «kr». */
function amountText(amount: number | null): string {
  return amount === null ? "" : formatWholeNumber(amount).replace(/ /g, " ");
}

export function CostField({
  deviationId,
  serverValue,
  tg,
}: {
  deviationId: string;
  serverValue: DeviationCost;
  tg: 2 | 3 | null;
}) {
  const { canEdit } = useRoom();
  const key = deviationFieldKey(deviationId, "cost");
  const field = useField(key, serverValue, (value, base): ReportFieldChange => ({
    table: "deviations",
    id: deviationId,
    field: "cost",
    value: value as DeviationCost,
    base: base as DeviationCost,
  }));
  const cost = field.entry.value as DeviationCost;
  const [approxOpen, setApproxOpen] = useState(cost.type === "approx");
  const choice = approxOpen ? APPROX : choiceOf(cost);
  const [raw, setRaw] = useState<string>(amountText(cost.amount));
  const [error, setError] = useState<string | null>(null);
  const [warningAmount, setWarningAmount] = useState<number | null>(
    cost.type === "approx" && cost.amount !== null && costWarning(cost.amount) ? cost.amount : null,
  );
  const [pendingWarning, setPendingWarning] = useState<number | null>(null);

  // Advarselen kommer 300 ms etter siste tastetrykk, mens takstmannen skriver.
  useEffect(() => {
    if (pendingWarning === null) return;
    const timer = setTimeout(() => {
      setWarningAmount(costWarning(pendingWarning) ? pendingWarning : null);
    }, WARNING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pendingWarning]);

  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-700">Kostnad</p>
        <p className="text-slate-900">
          {costDisplayText(cost.type, { amount: cost.amount, bandKey: cost.bandKey }) ||
            COST_TYPE_LABELS.none}
        </p>
      </div>
    );
  }

  const groupId = deviationCostChoiceId(deviationId);
  const amountId = domId(`${key}:amount`);
  const options = [
    ...COST_BANDS.filter((band) => !band.archived || band.key === cost.bandKey).map((band) => ({
      value: band.key,
      label: COST_BAND_LABELS[band.key as CostBandKey],
    })),
    { value: APPROX, label: COST_TYPE_LABELS.approx },
    { value: NONE, label: COST_TYPE_LABELS.none },
  ];

  const typeAmount = (text: string) => {
    setRaw(text);
    const parsed = parseCostAmount(text);
    if (!parsed.ok) {
      setError(text.trim() === "" ? null : parsed.message);
      setWarningAmount(null);
      setPendingWarning(null);
      return;
    }
    setError(null);
    setPendingWarning(parsed.amount);
    field.edit(costOf(APPROX, parsed.amount));
  };

  const noCostOnTg3 = tg === 3 && choice === NONE;
  const warningId = `${groupId}-warning`;

  return (
    <div className="space-y-3">
      <ChoiceButtons
        id={groupId}
        legend="Kostnad"
        options={options}
        value={choice}
        describedBy={noCostOnTg3 ? warningId : undefined}
        onChange={(next) => {
          setApproxOpen(next === APPROX);
          if (next === APPROX) {
            setTimeout(() => document.getElementById(amountId)?.focus(), 0);
            const parsed = parseCostAmount(raw);
            if (parsed.ok) field.edit(costOf(APPROX, parsed.amount), 0);
            return;
          }
          setError(null);
          setWarningAmount(null);
          field.edit(costOf(next, null), 0);
        }}
      />
      {choice === APPROX && (
        <div className="space-y-1.5">
          <label htmlFor={amountId} className="block text-sm font-medium text-slate-700">
            Eget beløp
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={amountId}
              inputMode="numeric"
              className="w-50"
              value={raw}
              aria-invalid={error ? true : undefined}
              aria-describedby={
                [
                  error ? `${amountId}-error` : null,
                  warningAmount !== null ? `${amountId}-warning` : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onChange={(event) => typeAmount(event.target.value)}
              onBlur={() => {
                const parsed = parseCostAmount(raw);
                if (parsed.ok) setRaw(amountText(parsed.amount));
                field.commit();
              }}
            />
            <span className="text-slate-700">kr</span>
          </div>
          {error && (
            <p id={`${amountId}-error`} className="text-sm text-urgent-text">
              <span className="sr-only">Feil: </span>
              {error}
            </p>
          )}
          {warningAmount !== null && !error && (
            <Warning
              id={`${amountId}-warning`}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    const nearest = nearestRoundedAmount(warningAmount);
                    setRaw(amountText(nearest));
                    setWarningAmount(null);
                    setPendingWarning(null);
                    field.edit(costOf(APPROX, nearest), 0);
                  }}
                >
                  {roundedAmountButtonText(nearestRoundedAmount(warningAmount))}
                </Button>
              }
            >
              {costNotRoundedText(nearestRoundedAmount(warningAmount))}
            </Warning>
          )}
        </div>
      )}
      <FieldStatus
        field={field}
        formatValue={(v) => {
          const c = v as DeviationCost;
          return (
            costDisplayText(c.type, { amount: c.amount, bandKey: c.bandKey }) ||
            COST_TYPE_LABELS.none
          );
        }}
      />
      {noCostOnTg3 && <Warning id={warningId}>{NO_COST_ON_TG3}</Warning>}
    </div>
  );
}
