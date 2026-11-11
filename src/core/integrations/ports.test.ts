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

  it("2. e-post har dev_mailbox, server_log og microsoft365; ai har fake og anthropic; de åtte andre har tom liste", () => {
    const providers = PROVIDERS_BY_PORT as Record<string, readonly string[]>;
    expect([...providers.email!]).toEqual(["dev_mailbox", "server_log", "microsoft365"]);
    // Den falske leverandøren og Anthropic (S8, docs/funksjoner/fase2a-ki-leverandor.md Omfang 2)
    expect([...providers.ai!].sort()).toEqual(["anthropic", "fake"]);
    for (const port of PORTS.filter((p) => p !== "email" && p !== "ai")) {
      expect([...(providers[port] ?? ["mangler"])], port).toEqual([]);
    }
  });

  it("3. statusene er active, disabled og error", () => {
    expect([...CONNECTION_STATUSES]).toEqual(["active", "disabled", "error"]);
  });
});
