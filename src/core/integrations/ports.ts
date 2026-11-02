/*
 * Faste koder for tilkoblingslaget (docs/05-domenemodell.md 4.10). En fast kode endres aldri,
 * den arkiveres (regel 6). Nye leverandører legges til i listen for porten sin når adapteren
 * bygges; nå er bare e-post fylt ut.
 */

/** Portene: hva EzProp snakker med, uavhengig av leverandør. */
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

/** Leverandørene som er kjent i koden, per port. En tilkobling med ukjent leverandør avvises. */
export const PROVIDERS_BY_PORT = {
  accounting: [],
  email: ["dev_mailbox", "server_log", "microsoft365"],
  broker: [],
  property_data: [],
  sms: [],
  speech_to_text: [],
  ai: [],
  file_storage: [],
  energy_label: [],
  scanning: [],
} as const satisfies Record<IntegrationPort, readonly string[]>;

/** `error` settes bare av laget selv; admin kan sette `active` og `disabled`. */
export const CONNECTION_STATUSES = ["active", "disabled", "error"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export function isIntegrationPort(value: unknown): value is IntegrationPort {
  return typeof value === "string" && (INTEGRATION_PORTS as readonly string[]).includes(value);
}

/** Om leverandøren er kjent for porten. */
export function isProviderForPort(port: IntegrationPort, provider: unknown): boolean {
  return (
    typeof provider === "string" &&
    (PROVIDERS_BY_PORT[port] as readonly string[]).includes(provider)
  );
}
