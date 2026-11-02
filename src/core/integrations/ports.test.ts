import { describe, expect, it } from "vitest";
import { CONNECTION_STATUSES, INTEGRATION_PORTS, PROVIDERS_BY_PORT } from "./index";

/*
 * Testplan docs/funksjoner/fase0b-tilkoblingslag-testplan.md avsnitt 1. Fasiten er skrevet inn
 * her og importeres aldri fra koden: faste koder endres aldri, de arkiveres (regel 6).
 */

const PORTS = [
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
];

describe("faste koder for tilkoblingslaget", () => {
  it("1. portene er nøyaktig de ti, i fast rekkefølge", () => {
    expect([...INTEGRATION_PORTS]).toEqual(PORTS);
  });

  it("2. e-post har dev_mailbox, server_log og microsoft365; de ni andre har tom liste", () => {
    const providers = PROVIDERS_BY_PORT as Record<string, readonly string[]>;
    expect([...providers.email!]).toEqual(["dev_mailbox", "server_log", "microsoft365"]);
    for (const port of PORTS.filter((p) => p !== "email")) {
      expect([...(providers[port] ?? ["mangler"])], port).toEqual([]);
    }
  });

  it("3. statusene er active, disabled og error", () => {
    expect([...CONNECTION_STATUSES]).toEqual(["active", "disabled", "error"]);
  });

  it("4. alle porter har en oppføring i leverandørlisten, ingen ekstra", () => {
    expect(Object.keys(PROVIDERS_BY_PORT)).toEqual([...INTEGRATION_PORTS]);
  });
});
