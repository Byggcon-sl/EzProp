/** Fornavn og etternavn med ett mellomrom. Etternavnet er valgfritt. */
export function contactName(contact: { firstName: string; lastName: string | null }): string {
  return [contact.firstName, contact.lastName ?? ""].join(" ").trim();
}
