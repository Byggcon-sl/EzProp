export const NO_OFFICES_MESSAGE = "Legg inn et kontor i admin først.";

export type OfficeChoice<T extends { id: string }> = {
  offices: T[];
  /** Kontoret til den innloggede ansatte når det står i listen, ellers `null`. */
  defaultOfficeId: string | null;
  /** Beskjeden som vises i stedet for knappen når organisasjonen ikke har kontorer. */
  emptyMessage: string | null;
};

/**
 * Kontorvalget ved «Gjør om til oppdrag». Ren funksjon, så forhåndsvalget kan testes uten
 * database. Et slettet kontor står ikke i listen fra `listOffices`, og blir derfor ikke valgt.
 */
export function officeChoice<T extends { id: string }>(
  offices: readonly T[],
  employeeOfficeId: string | null,
): OfficeChoice<T> {
  const list = [...offices];
  const defaultOfficeId =
    employeeOfficeId !== null && list.some((office) => office.id === employeeOfficeId)
      ? employeeOfficeId
      : null;
  return {
    offices: list,
    defaultOfficeId,
    emptyMessage: list.length === 0 ? NO_OFFICES_MESSAGE : null,
  };
}
