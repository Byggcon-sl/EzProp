import { CLAIM_OUTCOMES, CLAIM_TYPES, claimOutcomeLabel, claimTypeLabel } from "@/core/claims";
import { partyRoleLabel } from "@/core/assignments";
import type { Option } from "./claim-form";

/** Typene og utfallene i fast rekkefølge med norsk etikett. */
export const CLAIM_TYPE_OPTIONS: Option[] = CLAIM_TYPES.map((code) => ({
  value: code,
  label: claimTypeLabel(code),
}));

export const CLAIM_OUTCOME_OPTIONS: Option[] = CLAIM_OUTCOMES.map((code) => ({
  value: code,
  label: claimOutcomeLabel(code),
}));

/** Partene på oppdraget som valg: «Navn (rolle)». */
export function partyOptions(
  parties: readonly { id: string; name: string; role: Parameters<typeof partyRoleLabel>[0] }[],
): Option[] {
  return parties.map((party) => ({
    value: party.id,
    label: `${party.name} (${partyRoleLabel(party.role)})`,
  }));
}
