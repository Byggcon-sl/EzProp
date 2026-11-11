import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyQueueOutcome,
  type AiQueueOutcome,
  type AiQueueSendAttempt,
  type AiQueueSendResult,
} from ".";

/*
 * Utfallet av ett kall fra KI-køen (docs/funksjoner/fase2a-ki-ko-testplan.md avsnitt 2,
 * K2.1–K2.5). Testsaker som data: `[navn, forsøk, online, forventet]`.
 * Støtter hovedmål: KI i bunnen (KI virker likt med og uten nett) og de ansatte (én dårlig post
 * stopper aldri resten, og nettfeil gir aldri tap).
 */

const here = path.dirname(fileURLToPath(import.meta.url));

type Attempt = AiQueueSendAttempt<AiQueueSendResult>;
type Case = [string, Attempt, boolean, AiQueueOutcome];

const answered = (result: AiQueueSendResult): Attempt => ({ kind: "answered", result });

const cases: Case[] = [
  // K2.1 prøv senere
  ["K2.1 uten nett, forslag", answered({ kind: "suggestion" }), false, "retry_later"],
  ["K2.1 uten nett, no_match", answered({ kind: "no_match" }), false, "retry_later"],
  [
    "K2.1 uten nett, failed unknown",
    answered({ kind: "failed", reason: "unknown" }),
    false,
    "retry_later",
  ],
  [
    "K2.1 uten nett, failed no_access",
    answered({ kind: "failed", reason: "no_access" }),
    false,
    "retry_later",
  ],
  ["K2.1 uten nett, kastet Error", { kind: "threw", error: new Error("x") }, false, "retry_later"],
  [
    "K2.1 på nett, kastet TypeError (fetch feilet)",
    { kind: "threw", error: new TypeError("Failed to fetch") },
    true,
    "retry_later",
  ],
  ["K2.1 tidsavbrudd på nett", { kind: "timed_out" }, true, "retry_later"],
  ["K2.1 tidsavbrudd uten nett", { kind: "timed_out" }, false, "retry_later"],
  // K2.2 ferdig
  ["K2.2 suggestion", answered({ kind: "suggestion" }), true, "done"],
  ["K2.2 no_match", answered({ kind: "no_match" }), true, "done"],
  ["K2.2 error", answered({ kind: "error" }), true, "done"],
  ["K2.2 disabled", answered({ kind: "disabled" }), true, "done"],
  ["K2.2 failed invalid", answered({ kind: "failed", reason: "invalid" }), true, "done"],
  ["K2.2 failed no_access", answered({ kind: "failed", reason: "no_access" }), true, "done"],
  // K2.3 serverfeil
  ["K2.3 kastet Error på nett", { kind: "threw", error: new Error("x") }, true, "server_error"],
  [
    "K2.3 kastet RangeError på nett",
    { kind: "threw", error: new RangeError("x") },
    true,
    "server_error",
  ],
  ["K2.3 kastet noe som ikke er Error", { kind: "threw", error: "streng" }, true, "server_error"],
  ["K2.3 failed unknown", answered({ kind: "failed", reason: "unknown" }), true, "server_error"],
  // K2.5 fremtidige svar
  [
    "K2.5 ukjent kind",
    answered({ kind: "brand_new" } as unknown as AiQueueSendResult),
    true,
    "server_error",
  ],
  [
    "K2.5 failed med ukjent reason",
    answered({ kind: "failed", reason: "later" } as unknown as AiQueueSendResult),
    true,
    "server_error",
  ],
  ["K2.5 svar uten kind", answered({} as unknown as AiQueueSendResult), true, "server_error"],
];

describe("classifyQueueOutcome (K2.1–K2.3, K2.5)", () => {
  it.each(cases)("%s", (_name, attempt, online, expected) => {
    expect(classifyQueueOutcome(attempt, online)).toBe(expected);
  });

  it("K2.5 kaster aldri, heller ikke for svar som er null", () => {
    expect(() =>
      classifyQueueOutcome(answered(null as unknown as AiQueueSendResult), true),
    ).not.toThrow();
    expect(classifyQueueOutcome(answered(null as unknown as AiQueueSendResult), true)).toBe(
      "server_error",
    );
  });

  it("leser ikke feilmeldingen: samme utfall uansett tekst i feilen", () => {
    const a = classifyQueueOutcome({ kind: "threw", error: new Error("Fukt i kjeller") }, true);
    const b = classifyQueueOutcome({ kind: "threw", error: new Error("") }, true);
    expect(a).toBe(b);
  });
});

describe("K2.4 statisk", () => {
  it("outcome.ts leser ikke navigator", () => {
    const source = readFileSync(path.join(here, "outcome.ts"), "utf8");
    expect(source).toContain("classifyQueueOutcome");
    expect(source).not.toMatch(/navigator/);
  });
});
