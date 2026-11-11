/*
 * Portene i tilkoblingslaget (docs/05-domenemodell.md 4.10). Faste koder: de endres aldri, de
 * arkiveres (regel 6). Hver port har en fast liste over leverandører som koden kjenner. E-posten
 * har leverandører, og KI har den falske leverandøren `fake` og den ekte `anthropic` (S8, Ståle
 * 10.11.2026, ADR 0006). De andre portene fylles ut når tilkoblingen bygges.
 */

export const INTEGRATION_PORTS = [
  "accounting",
  "email",
  "broker",
  "property_data",
  "sms",
  "speech_to_text",
  "ai",
  "file_storage",
  "energy_label",
  "scanning",
] as const;

export type IntegrationPort = (typeof INTEGRATION_PORTS)[number];

export const PROVIDERS_BY_PORT: Record<IntegrationPort, readonly string[]> = {
  accounting: [],
  email: ["dev_mailbox", "server_log", "microsoft365"],
  broker: [],
  property_data: [],
  sms: [],
  speech_to_text: [],
  ai: ["fake", "anthropic"],
  file_storage: [],
  energy_label: [],
  scanning: [],
};

/** `error` settes bare av laget selv; admin velger `active` eller `disabled`. */
export const CONNECTION_STATUSES = ["active", "disabled", "error"] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
