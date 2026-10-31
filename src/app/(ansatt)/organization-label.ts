/**
 * Teksten etter «Du jobber for» i rammen: navnene på organisasjonene, slått sammen med komma i
 * rekkefølgen de kommer. `null` når personen ikke er ansatt noe sted, så linjen ikke vises.
 */
export function organizationLabel(organizations: { name: string }[]): string | null {
  if (organizations.length === 0) return null;
  return organizations.map((organization) => organization.name).join(", ");
}
