import { AccessDeniedError } from "@/core/access";
import { logger } from "@/shared/lib/logger";

/** Meldingen brukeren ser når listen ikke kan hentes. */
export const LIST_ERROR_MESSAGE = "Kunne ikke hente listen. Prøv igjen.";

export type ListResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Henter en liste (ordre, arbeidskø) og fanger databasefeil, så siden viser en vanlig
 * feilmelding i stedet for å krasje. Loggen får bare rute, bruker-id og feilnavnet: aldri
 * feilteksten, stakken, spørringen eller søketeksten, siden søket kan inneholde navn og adresser.
 * `AccessDeniedError` kastes videre uendret; den er ikke en databasefeil.
 */
export async function loadListOrError<T>(
  route: string,
  userId: string,
  load: () => Promise<T>,
): Promise<ListResult<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    if (error instanceof AccessDeniedError) throw error;
    logger.error("Kunne ikke hente listen", {
      route,
      userId,
      errorName: error instanceof Error ? error.name : "ukjent feil",
    });
    return { ok: false, message: LIST_ERROR_MESSAGE };
  }
}
