"use client";

import { useState } from "react";
import { ChoiceGroup, Field, Input, Radio } from "@/shared/ui/form";

/** Søkefeltet vises når det er flere takstmenn enn dette. */
const SEARCH_THRESHOLD = 8;

export const NO_INSPECTORS_MESSAGE =
  "Ingen takstmenn er lagt inn. Admin legger dem inn under Ansatte.";

/**
 * «Ansvarlig takstmann» i «Nytt oppdrag» (docs/funksjoner/fase2a-nytt-oppdrag-design.md 4.4).
 * Radioknapper, ingen nedtrekksliste. Den innloggede står først med «(deg)» når hen er takstmann,
 * deretter alfabetisk. Med mer enn åtte takstmenn står et søkefelt over listen; søket filtrerer i
 * nettleseren på navn, og den valgte står alltid synlig. Listen kommer fra kjernen (aktive
 * takstmenn i organisasjonen); kjernen sjekker valget igjen ved lagring.
 */
export function InspectorChoice({
  candidates,
  currentEmployeeId,
  defaultId,
  error,
}: {
  candidates: readonly { id: string; name: string }[];
  /** Den innloggede når hen er takstmann, ellers `null`. */
  currentEmployeeId: string | null;
  /** Forhåndsvalget, eller valget fra forrige forsøk. */
  defaultId: string | null;
  error?: string;
}) {
  const [selected, setSelected] = useState<string | null>(defaultId);
  const [query, setQuery] = useState("");

  if (candidates.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-slate-700">Ansvarlig takstmann</p>
        <p className="text-slate-600">{NO_INSPECTORS_MESSAGE}</p>
      </div>
    );
  }

  const ordered = [...candidates].sort((a, b) => {
    if (a.id === currentEmployeeId) return -1;
    if (b.id === currentEmployeeId) return 1;
    return a.name.localeCompare(b.name, "nb");
  });
  const showSearch = candidates.length > SEARCH_THRESHOLD;
  const needle = query.trim().toLocaleLowerCase("nb");
  const matches = (name: string) => needle === "" || name.toLocaleLowerCase("nb").includes(needle);
  const visibleCount = ordered.filter((c) => c.id === selected || matches(c.name)).length;

  return (
    <div className="space-y-3">
      {showSearch && (
        <Field label="Finn takstmann" htmlFor="inspector-search">
          <Input
            id="inspector-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // Enter i søket skal ikke sende skjemaet.
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
        </Field>
      )}
      <ChoiceGroup id="responsibleEmployeeId" legend="Ansvarlig takstmann" columns error={error}>
        {ordered.map((candidate) => (
          // Skjult med `hidden` (ikke fjernet), så valget og skjemaverdien står.
          <div key={candidate.id} hidden={candidate.id !== selected && !matches(candidate.name)}>
            <Radio
              name="responsibleEmployeeId"
              value={candidate.id}
              label={
                candidate.id === currentEmployeeId ? `${candidate.name} (deg)` : candidate.name
              }
              defaultChecked={candidate.id === defaultId}
              onChange={() => setSelected(candidate.id)}
            />
          </div>
        ))}
        {visibleCount === 0 && (
          <p className="py-2.5 text-slate-600">Ingen takstmenn passer søket.</p>
        )}
      </ChoiceGroup>
    </div>
  );
}
