import { describe, expect, it } from "vitest";
import { nextSavedAt, rejectedText, syncStatusKind, syncStatusText } from "./sync-status-text";
import type { TrialRejectedChange, TrialSyncStatus } from "./sync/types";
import { listTrialFields, trialForm } from "./trial-form";

// Funn T-0001: statuslinjen viser «Kunne ikke sendes: <feltnavn>» for endringer serveren avviste.
// Testplan docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 1e (36–40).

const labelOf = (key: string) =>
  listTrialFields(trialForm).find((field) => field.key === key)!.label;

describe("rejectedText (sync-status-text.ts)", () => {
  it("Kunne ikke sendes: <feltnavn> med navn fra skjemaet", () => {
    expect(rejectedText([{ table: "trial_answers", fieldKey: "general_description" }])).toBe(
      `Kunne ikke sendes: ${labelOf("general_description")}`,
    );
    expect(labelOf("general_description")).toBe("Generell beskrivelse");
  });

  it("bilde gir «bilde i <feltnavn>»", () => {
    expect(rejectedText([{ table: "trial_photos", fieldKey: "cover_photo" }])).toBe(
      `Kunne ikke sendes: bilde i ${labelOf("cover_photo")}`,
    );
  });

  it("skjemaet gir «testskjemaet»", () => {
    expect(rejectedText([{ table: "trial_forms", fieldKey: null }])).toBe(
      "Kunne ikke sendes: testskjemaet",
    );
  });

  it("flere felt skilles med komma, samme felt nevnes én gang", () => {
    const rejected: TrialRejectedChange[] = [
      { table: "trial_answers", fieldKey: "general_description" },
      { table: "trial_answers", fieldKey: "summary" },
      { table: "trial_answers", fieldKey: "general_description" },
    ];
    expect(rejectedText(rejected)).toBe(
      "Kunne ikke sendes: Generell beskrivelse, Samlet kommentar",
    );
  });

  it("ukjent felt gir «ukjent felt», aldri koden", () => {
    expect(rejectedText([{ table: "trial_answers", fieldKey: "no_such_field" }])).toBe(
      "Kunne ikke sendes: ukjent felt",
    );
  });

  it("ingen melding når ingenting er avvist (eller alt er løst)", () => {
    expect(rejectedText(undefined)).toBeNull();
    expect(rejectedText([])).toBeNull();
  });
});

describe("statusen med avviste endringer", () => {
  const base: TrialSyncStatus = {
    online: true,
    serverConfirmed: true,
    pendingChanges: 0,
    pendingPhotos: 0,
  };
  const withRejected: TrialSyncStatus = {
    ...base,
    rejected: [{ table: "trial_answers", fieldKey: "general_description" }],
  };

  it("avvist endring gir aldri «Alt er lagret», og ventetallet teller den ikke", () => {
    expect(syncStatusKind(withRejected)).toBe("pending");
    expect(syncStatusText(withRejected)).toBe("Venter: 0 endringer, 0 bilder");
  });

  it("«Lagret kl.» flyttes ikke mens noe er avvist", () => {
    const now = new Date("2026-11-11T10:00:00.000Z");
    expect(nextSavedAt(withRejected, null, now)).toBeNull();
    expect(nextSavedAt({ ...base, rejected: [] }, null, now)).toBe(now.toISOString());
  });
});
