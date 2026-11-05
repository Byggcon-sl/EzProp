import { FIRM_TYPES, firmTypeLabel } from "@/core/contacts";

/** Valgene i «Type», i fast rekkefølge fra kjernen. Sendes til skjemaet fra siden. */
export function firmTypeOptions(): { value: string; label: string }[] {
  return FIRM_TYPES.map((code) => ({ value: code, label: firmTypeLabel(code) }));
}
