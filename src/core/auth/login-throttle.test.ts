import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_CODE_REQUESTS,
  MAX_FAILED_CODES,
  THROTTLE_WINDOW_MS,
  decideThrottle,
  hashEmail,
  normalizeEmail,
  throttleMessage,
  type LoginAttemptKind,
} from "./login-throttle";

// Regeltester for innloggingssperren (docs/funksjoner/fase0b-sperre-innlogging-testplan.md
// avsnitt 1). Ren funksjon, ingen database. Fast tid: T0 er 14:20 i Oslo (vintertid).
// Testene setter ikke TZ: klokkeslettet skal være norsk tid uansett serverens tidssone.

const T0 = new Date("2026-10-31T13:20:00Z");
const MINUTE = 60_000;
/** Tidspunkt som minutter fra T0 (kan være brøk, f.eks. 14 + 59/60 for 14:59). */
const at = (minutes: number) => new Date(T0.getTime() + Math.round(minutes * MINUTE));
const SECOND_IN_MINUTES = 1 / 60;

type Attempt = { kind: LoginAttemptKind; createdAt: Date };
const rows = (kind: LoginAttemptKind, ...minutes: number[]): Attempt[] =>
  minutes.map((m) => ({ kind, createdAt: at(m) }));
const failed = (...minutes: number[]) => rows("code_failed", ...minutes);
const requested = (...minutes: number[]) => rows("code_requested", ...minutes);
const succeeded = (...minutes: number[]) => rows("login_succeeded", ...minutes);

/** `count` feil, ett minutt fra hverandre, der den siste er ved minutt `last`. */
const failuresEndingAt = (count: number, last: number) =>
  failed(...Array.from({ length: count }, (_, i) => last - (count - 1 - i)));

type Case = {
  name: string;
  attempts: Attempt[];
  action: "request_code" | "sign_in";
  now: Date;
  blocked: boolean;
  reason?: "failed_codes" | "code_requests";
  retryAt?: Date;
};

// Rader til regeltest 13 og 14: begge grenser nådd, med ulike tidspunkt for når de går ut.
const bothLimits = [...failed(-4, -3, -2, -1, 0), ...requested(-10, -9, -8, -7, -6)];
// Fast stokking (ingen tilfeldighet i testene)
const shuffled = [7, 2, 9, 0, 5, 3, 8, 1, 6, 4].map((i) => bothLimits[i]!);

const cases: Case[] = [
  // 1. Regel 1
  {
    name: "1. 4 feil på 15 min slipper gjennom (sign_in)",
    attempts: failed(-3, -2, -1, 0),
    action: "sign_in",
    now: at(1),
    blocked: false,
  },
  {
    name: "1. 4 feil på 15 min slipper gjennom (request_code)",
    attempts: failed(-3, -2, -1, 0),
    action: "request_code",
    now: at(1),
    blocked: false,
  },
  // 2. Regel 2. Bygges med konstanten, så testen følger om den endres.
  {
    name: "2. MAX_FAILED_CODES feil på 15 min sperrer innlogging til siste feil + 15 min",
    attempts: failuresEndingAt(MAX_FAILED_CODES, 0),
    action: "sign_in",
    now: T0,
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  // 3.
  {
    name: "3. 5 feil sperrer også bestilling, med samme tidspunkt",
    attempts: failed(-4, -3, -2, -1, 0),
    action: "request_code",
    now: T0,
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  // 4. Regel 3
  {
    name: "4. 14:59 etter siste feil er fortsatt sperret",
    attempts: failed(-4, -3, -2, -1, 0),
    action: "sign_in",
    now: at(15 - SECOND_IN_MINUTES),
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  {
    name: "4. 15:00 etter siste feil slipper gjennom",
    attempts: failed(-4, -3, -2, -1, 0),
    action: "sign_in",
    now: at(15),
    blocked: false,
  },
  // 5. Vinduet mellom eldste og nyeste av de 5
  {
    name: "5. nøyaktig 15:00 mellom eldste og nyeste feil sperrer",
    attempts: failed(-15, -10, -5, -2, 0),
    action: "sign_in",
    now: T0,
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  {
    name: "5. 15:01 mellom eldste og nyeste feil sperrer ikke",
    attempts: failed(-15 - SECOND_IN_MINUTES, -10, -5, -2, 0),
    action: "sign_in",
    now: T0,
    blocked: false,
  },
  // 6. Bare de siste 5 feilene teller
  {
    name: "6. 8 feil over 2 timer, de siste 5 innen 15 min: sperrer",
    attempts: failed(-120, -90, -60, -4, -3, -2, -1, 0),
    action: "sign_in",
    now: T0,
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  {
    name: "6. 8 feil over 2 timer, de siste 5 spredt over 20 min: sperrer ikke",
    attempts: failed(-120, -90, -60, -20, -15, -10, -5, 0),
    action: "sign_in",
    now: T0,
    blocked: false,
  },
  // 7. Regel 5
  {
    name: "7. riktig kode nullstiller feil (sign_in)",
    attempts: [...failed(-5, -4, -3, -2, -1), ...succeeded(0)],
    action: "sign_in",
    now: at(1),
    blocked: false,
  },
  {
    name: "7. riktig kode nullstiller feil (request_code)",
    attempts: [...failed(-5, -4, -3, -2, -1), ...succeeded(0)],
    action: "request_code",
    now: at(1),
    blocked: false,
  },
  // 8. Regel 5
  {
    name: "8. riktig kode nullstiller bestillinger",
    attempts: [...requested(-5, -4, -3, -2, -1), ...succeeded(0)],
    action: "request_code",
    now: at(1),
    blocked: false,
  },
  // 9. Presisering 2
  {
    name: "9. feil med samme tid som riktig kode telles ikke",
    attempts: [...failed(0), ...succeeded(0), ...failed(1, 2, 3, 4)],
    action: "sign_in",
    now: at(5),
    blocked: false,
  },
  // 10. Regel 6
  {
    name: "10. 5 bestillinger: den 6. avvises til eldste + 15 min",
    attempts: requested(-10, -8, -6, -4, -2),
    action: "request_code",
    now: T0,
    blocked: true,
    reason: "code_requests",
    retryAt: at(5),
  },
  // 11. Glidende vindu
  {
    name: "11. eldste bestilling nøyaktig 15:00 før telles ikke",
    attempts: requested(-15, -8, -6, -4, -2),
    action: "request_code",
    now: T0,
    blocked: false,
  },
  {
    name: "11. eldste bestilling 14:59 før telles",
    attempts: requested(-15 + SECOND_IN_MINUTES, -8, -6, -4, -2),
    action: "request_code",
    now: T0,
    blocked: true,
    reason: "code_requests",
    retryAt: at(SECOND_IN_MINUTES),
  },
  // 12.
  {
    name: "12. bestillingsgrensen stopper ikke innlogging",
    attempts: requested(-10, -8, -6, -4, -2),
    action: "sign_in",
    now: T0,
    blocked: false,
  },
  // 13. Presisering 1
  {
    name: "13. begge grenser nådd: bestilling viser feilsperren med dens tidspunkt",
    attempts: bothLimits,
    action: "request_code",
    now: T0,
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  // 14.
  {
    name: "14. stokkede rader gir samme svar (begge grenser)",
    attempts: shuffled,
    action: "request_code",
    now: T0,
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  {
    name: "14. baklengs rader gir samme svar (bare de siste 5 feilene teller)",
    attempts: failed(-120, -90, -60, -4, -3, -2, -1, 0).reverse(),
    action: "sign_in",
    now: T0,
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  {
    name: "14. riktig kode først i listen nullstiller fortsatt",
    attempts: [...succeeded(0), ...requested(-5, -4, -3, -2, -1)],
    action: "request_code",
    now: at(1),
    blocked: false,
  },
  // 15.
  {
    name: "15. tom liste slipper gjennom (request_code)",
    attempts: [],
    action: "request_code",
    now: T0,
    blocked: false,
  },
  {
    name: "15. tom liste slipper gjennom (sign_in)",
    attempts: [],
    action: "sign_in",
    now: T0,
    blocked: false,
  },
];

describe("decideThrottle (regeltester 1–15)", () => {
  it.each(cases)("$name", ({ attempts, action, now, blocked, reason, retryAt }) => {
    const result = decideThrottle(attempts, action, now);
    if (blocked) {
      expect(result).toEqual({ blocked: true, reason, retryAt });
    } else {
      expect(result).toEqual({ blocked: false });
    }
  });

  it("14. samme rader i opprinnelig og stokket rekkefølge gir likt svar", () => {
    expect(decideThrottle(shuffled, "request_code", T0)).toEqual(
      decideThrottle(bothLimits, "request_code", T0),
    );
    expect(decideThrottle(shuffled, "sign_in", T0)).toEqual(
      decideThrottle(bothLimits, "sign_in", T0),
    );
  });
});

describe("normalizeEmail og hashEmail", () => {
  it("16. normalizeEmail fjerner mellomrom og gjør om til små bokstaver (regel 7)", () => {
    expect(normalizeEmail(" Ola@Eksempel.no ")).toBe("ola@eksempel.no");
  });

  it("17. hashEmail normaliserer, skiller adresser og hemmeligheter, og bruker avledet nøkkel", () => {
    const secret = "testhemmelighet-bare-for-regeltestene";
    const ola = hashEmail("ola@eksempel.no", secret);

    expect(hashEmail("Ola@Eksempel.no ", secret)).toBe(ola);
    expect(hashEmail("kari@eksempel.no", secret)).not.toBe(ola);
    expect(hashEmail("ola@eksempel.no", "en-annen-testhemmelighet")).not.toBe(ola);
    // Den rå hemmeligheten brukes ikke som nøkkel
    const rawKeyHmac = createHmac("sha256", secret).update("ola@eksempel.no").digest("hex");
    expect(ola).not.toBe(rawKeyHmac);

    expect(ola).toMatch(/^[0-9a-f]{64}$/);
    expect(ola).not.toContain("ola");
    expect(ola).not.toContain("eksempel");
  });
});

describe("throttleMessage (norsk tid)", () => {
  it("18. vintertid: feil koder", () => {
    expect(throttleMessage("failed_codes", new Date("2026-10-26T13:35:00Z"))).toBe(
      "For mange feil koder. Du kan prøve igjen kl. 14:35.",
    );
  });

  it("19. sommertid: bestillinger", () => {
    expect(throttleMessage("code_requests", new Date("2026-10-24T12:35:00Z"))).toBe(
      "For mange koder bestilt. Du kan be om ny kode kl. 14:35.",
    );
  });

  it("20. natten klokken stilles tilbake: begge 02:05 vises som 02:05 (Oslo, ikke serverens tid)", () => {
    // 01:05Z er 02:05 vintertid, 00:05Z er 02:05 sommertid (25.10.2026)
    expect(throttleMessage("failed_codes", new Date("2026-10-25T01:05:00Z"))).toBe(
      "For mange feil koder. Du kan prøve igjen kl. 02:05.",
    );
    expect(throttleMessage("failed_codes", new Date("2026-10-25T00:05:00Z"))).toBe(
      "For mange feil koder. Du kan prøve igjen kl. 02:05.",
    );
  });
});

describe("konstanter og tekst", () => {
  it("21. grensene er 5 feil, 5 bestillinger og 15 minutter", () => {
    expect(MAX_FAILED_CODES).toBe(5);
    expect(MAX_CODE_REQUESTS).toBe(5);
    expect(THROTTLE_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it("21. én feil færre enn MAX_FAILED_CODES slipper, MAX_FAILED_CODES sperrer", () => {
    expect(decideThrottle(failuresEndingAt(MAX_FAILED_CODES - 1, 0), "sign_in", T0)).toEqual({
      blocked: false,
    });
    expect(decideThrottle(failuresEndingAt(MAX_FAILED_CODES, 0), "sign_in", T0)).toMatchObject({
      blocked: true,
      reason: "failed_codes",
    });
  });

  it("22. meldingene har ingen gjetteord og ikke «Vent ett minutt»", () => {
    for (const reason of ["failed_codes", "code_requests"] as const) {
      const message = throttleMessage(reason, T0);
      expect(message).not.toMatch(/antas|trolig|kanskje|muligens|sannsynligvis/i);
      expect(message).not.toMatch(/vent ett minutt/i);
      expect(message).toMatch(/kl\. \d{2}:\d{2}\.$/);
    }
  });
});
