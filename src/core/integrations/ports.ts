/*
 * Portene i tilkoblingslaget (docs/05-domenemodell.md 4.10). Faste koder: de endres aldri, de
 * arkiveres (regel 6). Hver port har en fast liste over leverandører som koden kjenner. Bare
 * e-posten og KI (bare `fake`) har leverandører nå; de andre portene fylles ut når tilkoblingen
 * bygges.
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
  // Bare den falske leverandøren til vasken og S8 er på plass (ADR 0006, A160)
  ai: ["fake"],
  file_storage: [],
  energy_label: [],
  scanning: [],
};

/** `error` settes bare av laget selv; admin velger `active` eller `disabled`. */
export const CONNECTION_STATUSES = ["active", "disabled", "error"] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
