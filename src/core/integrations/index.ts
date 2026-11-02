/*
 * Tilkoblingslaget (docs/funksjoner/fase0b-tilkoblingslag.md). `findActiveConnection` eksporteres
 * bevisst ikke herfra: den har ingen tilgangssjekk og brukes bare av laget selv.
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
