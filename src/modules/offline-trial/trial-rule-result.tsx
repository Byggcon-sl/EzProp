"use client";

import { cn } from "@/shared/lib/cn";
import type { TrialAnswers } from "./answers";
import { evaluateTrialRules, trialRules } from "./rules";

/**
 * Viser svaret fra prøvereglene for ett felt, regnet ut lokalt fra svarene (også uten nett).
 * Gir null hvis feltet ikke har noen regel. Tolker ingen tall selv; alt kommer fra regelmotoren.
 */
export function TrialRuleResult({
  fieldKey,
  answers,
}: {
  fieldKey: string;
  answers: TrialAnswers;
}) {
  const fieldRuleKeys = new Set(
    trialRules.filter((rule) => rule.field === fieldKey).map((rule) => rule.key),
  );
  if (fieldRuleKeys.size === 0) return null;
  const results = evaluateTrialRules(trialRules, answers).filter((result) =>
    fieldRuleKeys.has(result.key),
  );
  return (
    <>
      {results.map((result) => (
        <p
          key={result.key}
          data-rule-key={result.key}
          data-rule-state={result.state}
          aria-live="polite"
          className={cn(
            "mt-1.5 text-sm",
            result.state === "triggered" ? "font-medium text-slate-900" : "text-slate-600",
          )}
        >
          {result.message}
        </p>
      ))}
    </>
  );
}
