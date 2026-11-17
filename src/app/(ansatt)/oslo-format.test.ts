import { describe, expect, it } from "vitest";
import { sessionCreatedLabel, sessionLastUsedLabel } from "./oslo-format";

/*
 * Tidsteksten i «Mine innlogginger» (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 4 og
 * «Avklart før bygging» punkt 3, testplan avsnitt 2). Rene funksjoner med fast klokke: `now`
 * sendes inn. Datoene er i norsk tid (Europe/Oslo), også rundt midnatt og ved sommertid.
 * «Sist brukt» får aldri klokkeslett, fordi `updated_at` fornyes høyst én gang i døgnet.
 *
 * Avtalt signatur: `sessionLastUsedLabel(lastUsed, now, isCurrent)` og
 * `sessionCreatedLabel(createdAt, now)` (`now` trengs for å vite om årstallet skal med).
 *
 * Støtter hovedmål: de ansatte (teksten lover ikke mer enn dataene holder, så den ansatte kan
 * stole på den når hen ser etter en ukjent innlogging).
 */

const at = (iso: string) => new Date(iso);
/** Intl kan gi hardt mellomrom; sammenlign med vanlige mellomrom. */
const normal = (text: string) => text.replace(/\s+/g, " ").trim();

const CLOCK = /\d{1,2}[:.]\d{2}/;

type Case = [name: string, lastUsed: string, now: string, isCurrent: boolean, expected: string];

const CASES: Case[] = [
  // 2.1 «denne enheten» er alltid «Aktiv nå»
  ["1. isCurrent med lastUsed i dag", "2026-11-17T07:00:00Z", "2026-11-17T08:00:00Z", true, "Aktiv nå"],
  ["1. isCurrent med lastUsed 20 dager tilbake", "2026-10-28T07:00:00Z", "2026-11-17T08:00:00Z", true, "Aktiv nå"],
  // 2.2 «Aktiv i dag» hele døgnet i Oslo
  ["2. 00:00:30 og 23:59 samme dag i Oslo", "2026-11-16T23:00:30Z", "2026-11-17T22:59:00Z", false, "Aktiv i dag"],
  // 2.3 midnatt i Oslo, ikke UTC
  ["3. 23:59:30 i går og 00:00:30 i dag (Oslo)", "2026-11-16T22:59:30Z", "2026-11-16T23:00:30Z", false, "Aktiv i går"],
  // 2.4 UTC-felle: 23:30 UTC er 00:30 dagen etter i Oslo
  ["4. 16.11 23:30 UTC er 17.11 i Oslo", "2026-11-16T23:30:00Z", "2026-11-17T08:00:00Z", false, "Aktiv i dag"],
  // Mer enn 24 timer, men i går i Oslo; og mindre enn 24 timer, men i går
  ["4. over 24 timer siden, men i går", "2026-11-15T23:30:00Z", "2026-11-17T08:00:00Z", false, "Aktiv i går"],
  ["4. under 24 timer siden, men i går", "2026-11-16T07:00:00Z", "2026-11-17T06:00:00Z", false, "Aktiv i går"],
  // 2.5 dato ellers, uten årstall i samme år
  ["5. to dager eller mer: dato", "2026-11-15T10:00:00Z", "2026-11-17T08:00:00Z", false, "Aktiv 15. nov."],
  ["5. fem dager: dato", "2026-11-12T10:00:00Z", "2026-11-17T08:00:00Z", false, "Aktiv 12. nov."],
  // 2.6 sommertid: 29.03.2026 (23 timer) og 25.10.2026 (25 timer)
  ["6. 29.03: 00:00:30 og 23:59 samme dag", "2026-03-28T23:00:30Z", "2026-03-29T21:59:00Z", false, "Aktiv i dag"],
  ["6. 29.03 23:59:30 og 30.03 00:00:30", "2026-03-29T21:59:30Z", "2026-03-29T22:00:30Z", false, "Aktiv i går"],
  ["6. 28.03 23:59:30 og 29.03 23:59", "2026-03-28T22:59:30Z", "2026-03-29T21:59:00Z", false, "Aktiv i går"],
  ["6. 25.10: 00:00:30 og 23:59 samme dag (25 timer)", "2026-10-24T22:00:30Z", "2026-10-25T22:59:00Z", false, "Aktiv i dag"],
  ["6. 25.10 23:59:30 og 26.10 00:00:30", "2026-10-25T22:59:30Z", "2026-10-25T23:00:30Z", false, "Aktiv i går"],
  ["6. 24.10 23:59:30 og 25.10 23:59", "2026-10-24T21:59:30Z", "2026-10-25T22:59:00Z", false, "Aktiv i går"],
  // 2.9 årsskifte: med årstall når året er et annet (avklart punkt 3)
  ["9. 28.12.2025 sett 03.01.2026", "2025-12-28T10:00:00Z", "2026-01-03T10:00:00Z", false, "Aktiv 28. des. 2025"],
  ["9. 31.12 23:59:30 og 01.01 00:00:30 er i går", "2025-12-31T22:59:30Z", "2025-12-31T23:00:30Z", false, "Aktiv i går"],
];

describe("2. sessionLastUsedLabel", () => {
  it.each(CASES)("%s", (_name, lastUsed, now, isCurrent, expected) => {
    expect(normal(sessionLastUsedLabel(at(lastUsed), at(now), isCurrent))).toBe(expected);
  });

  it("7. aldri klokkeslett i noen av sakene", () => {
    for (const [name, lastUsed, now, isCurrent] of CASES) {
      const text = sessionLastUsedLabel(at(lastUsed), at(now), isCurrent);
      expect(text, name).not.toMatch(CLOCK);
      expect(text, name).not.toMatch(/\bkl\./);
    }
  });

  it("7. aldri klokkeslett for hver time gjennom to døgn", () => {
    const now = at("2026-11-17T12:00:00Z");
    for (let hours = 0; hours <= 72; hours += 1) {
      const lastUsed = new Date(now.getTime() - hours * 3_600_000 - 17 * 60_000);
      const text = sessionLastUsedLabel(lastUsed, now, false);
      expect(text, `${hours} timer`).not.toMatch(CLOCK);
      expect(text, `${hours} timer`).toMatch(/^Aktiv /);
    }
  });
});

describe("2.8 sessionCreatedLabel", () => {
  it.each([
    ["3. nov. i samme år", "2026-11-03T10:00:00Z", "2026-11-17T08:00:00Z", "logget inn 3. nov."],
    ["UTC-felle: 02.11 23:30 UTC er 3. nov. i Oslo", "2026-11-02T23:30:00Z", "2026-11-17T08:00:00Z", "logget inn 3. nov."],
    ["annet år: med årstall", "2025-12-28T10:00:00Z", "2026-01-03T10:00:00Z", "logget inn 28. des. 2025"],
  ])("%s", (_name, createdAt, now, expected) => {
    const text = sessionCreatedLabel(at(createdAt), at(now));
    expect(normal(text)).toBe(expected);
    expect(text).not.toMatch(CLOCK);
  });
});
