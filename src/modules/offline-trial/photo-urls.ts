/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Adressen til visningsruten for et bilde. Bygges bare her; brukes både av bildekøen (sending) og
 * av testskjemaet (lenken «Vis fra serveren»). Bare organisasjonen står i spørrestrengen.
 */
export function displayCopyUrl(organizationId: string, photoId: string): string {
  return `/api/prove/bilder/${photoId}/visning?${new URLSearchParams({ organisasjon: organizationId })}`;
}
