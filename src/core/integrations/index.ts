/*
 * Tilkoblingslaget (docs/funksjoner/fase0b-tilkoblingslag.md): faste porter, én vei til
 * hemmeligheter og tjenesten for tilkoblinger. Funksjonene uten tilgangssjekk (oppslaget på den
 * aktive tilkoblingen og laget sin egen statusoppdatering) eksporteres bevisst ikke herfra.
 */
export {
  CONNECTION_STATUSES,
  INTEGRATION_PORTS,
  PROVIDERS_BY_PORT,
  type ConnectionStatus,
  type IntegrationPort,
} from "./ports";
export { InvalidSecretRefError, readSecret, SecretNotFoundError } from "./secrets";
export {
  ConnectionNotFoundError,
  ConnectionValidationError,
  createConnection,
  listConnections,
  markConnectionDeleted,
  updateConnection,
  type ConnectionSummary,
  type CreateConnectionInput,
  type UpdateConnectionInput,
} from "./connections";
