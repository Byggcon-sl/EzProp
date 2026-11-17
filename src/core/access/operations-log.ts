import { logger } from "@/shared/lib/logger";

/*
 * Logging av avviste kall til driftsendepunkter (ADR 0014). Egen liten hjelper slik at ruten bare
 * importerer `@/core/access` og ryddefunksjonen, og slik at det som logges styres her.
 */

/**
 * Én advarsel om at et kall til et driftsendepunkt ble avvist. Bare ruten (fast tekst) logges:
 * aldri headere, hemmelighet, IP eller adresseparametre.
 */
export function logRejectedOperationsCall(route: string): void {
  logger.warn("Avvist kall til driftsendepunkt", { route });
}
