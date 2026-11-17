import { describe, expect, it } from "vitest";
import { sessionCreatedLabel, sessionLastUsedLabel } from "./oslo-format";

/*
 * Tidsteksten for «Mine innlogginger» (docs/funksjoner/fase2a-mine-innlogginger-testplan.md
 * avsnitt 2). Fast klokke; dagen regnes i norsk tid, ikke UTC, og teksten har aldri klokkeslett.
 * Støtter hovedmål: de ansatte (teksten lover ikke mer enn dataene holder).
 */

const at = (iso: string) => new Date(iso);
/** Klokkeslett som «08:12» eller «8.12». Datoformatet «12. nov.» har mellomrom etter punktum. */
const CLOCK = /\d{1,2}[:.]\d{2}/;

describe("sessionLastUsedLabel", () => {
  it("2.1 denne enheten er alltid «Aktiv nå», også med gammel dato", () => {
    expect(sessionLastUsedLabel(at("2026-10-28T10:00Z"), at("2026-11-17T10:00Z"), true)).toBe(
      "Aktiv nå",
    );
  });

  it.each<[string, string, string, string]>([
    // 2.2 tidlig og sent samme dag i Oslo
    ["i dag, tidlig og sent", "2026-11-16T23:00:30Z", "2026-11-17T22:59:00Z", "Aktiv i dag"],
    // 2.3 like før og like etter midnatt i Oslo
    ["i går over midnatt i Oslo", "2026-11-16T22:59:30Z", "2026-11-16T23:00:30Z", "Aktiv i går"],
    // 2.4 UTC-fellen: 23:30 UTC er neste dag i Oslo
    ["UTC-felle", "2026-11-16T23:30:00Z", "2026-11-17T08:00:00Z", "Aktiv i dag"],
    // 2.5 to dager eller mer gir dato uten årstall i samme år
    ["dato samme år", "2026-11-12T09:00:00Z", "2026-11-17T08:00:00Z", "Aktiv 12. nov."],
    ["dato to dager før", "2026-11-15T09:00:00Z", "2026-11-17T08:00:00Z", "Aktiv 15. nov."],
    // 2.6 sommertid: overgang til sommertid 29.03.2026 (midnatt i Oslo er 23:00Z dagen før)
    ["sommertid inn, i går", "2026-03-28T22:59:00Z", "2026-03-28T23:01:00Z", "Aktiv i går"],
    ["sommertid inn, i dag", "2026-03-28T23:01:00Z", "2026-03-29T21:59:00Z", "Aktiv i dag"],
    // fra sommertid 25.10.2026 (midnatt i Oslo er 22:00Z dagen før)
    ["sommertid ut, i går", "2026-10-24T21:59:00Z", "2026-10-24T22:01:00Z", "Aktiv i går"],
    ["sommertid ut, i dag", "2026-10-24T22:01:00Z", "2026-10-25T22:59:00Z", "Aktiv i dag"],
    // 2.9 årsskifte: annet år gir årstall
    ["årsskifte", "2025-12-28T12:00:00Z", "2026-01-03T12:00:00Z", "Aktiv 28. des. 2025"],
    ["i går over årsskiftet", "2025-12-31T12:00:00Z", "2026-01-01T12:00:00Z", "Aktiv i går"],
  ])("%s", (_name, lastUsed, now, expected) => {
    const label = sessionLastUsedLabel(at(lastUsed), at(now), false);
    expect(label).toBe(expected);
    // 2.7 aldri klokkeslett
    expect(label).not.toMatch(CLOCK);
  });
});

describe("sessionCreatedLabel", () => {
  it("2.8 «logget inn 3. nov.» uten klokkeslett", () => {
    const label = sessionCreatedLabel(at("2026-11-03T07:12:00Z"), at("2026-11-17T08:00:00Z"));
    expect(label).toBe("logget inn 3. nov.");
    expect(label).not.toMatch(CLOCK);
  });

  it("dagen regnes i Oslo-tid", () => {
    expect(sessionCreatedLabel(at("2026-11-02T23:30:00Z"), at("2026-11-17T08:00:00Z"))).toBe(
      "logget inn 3. nov.",
    );
  });

  it("annet år gir årstall", () => {
    expect(sessionCreatedLabel(at("2025-12-20T12:00:00Z"), at("2026-01-03T12:00:00Z"))).toBe(
      "logget inn 20. des. 2025",
    );
  });
});
