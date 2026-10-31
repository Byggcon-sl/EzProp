import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decideThrottle,
  hashEmail,
  MAX_CODE_REQUESTS,
  MAX_FAILED_CODES,
  normalizeEmail,
  THROTTLE_WINDOW_MS,
  throttleMessage,
  type LoginAttemptKind,
} from "./login-throttle";

/*
 * Regeltester for sperren ved innlogging (docs/funksjoner/fase0b-sperre-innlogging-testplan.md
 * avsnitt 1). Ren funksjon, ingen database. Fast tid: T0 er 14:20 i Oslo (vintertid).
 * Støtter hovedmål reklamasjoner (ingen kan gjette seg inn i en takstmanns navn) og tid
 * (riktig kode nullstiller, så den som skriver riktig ikke merker noe).
 */

const T0 = new Date("2026-10-31T13:20:00Z");
const MINUTE = 60 * 1000;

/** Tidspunkt `minutes` minutter (og `seconds` sekunder) fra T0. Negativt er før T0. */
function at(minutes: number, seconds = 0): Date {
  return new Date(T0.getTime() + minutes * MINUTE + seconds * 1000);
}

type Attempt = { kind: LoginAttemptKind; createdAt: Date };

const fail = (minutes: number, seconds = 0): Attempt => ({
  kind: "code_failed",
  createdAt: at(minutes, seconds),
});
const request = (minutes: number, seconds = 0): Attempt => ({
  kind: "code_requested",
  createdAt: at(minutes, seconds),
});
const succeeded = (minutes: number, seconds = 0): Attempt => ({
  kind: "login_succeeded",
  createdAt: at(minutes, seconds),
});

/** `count` rader av samme slag, ett minutt mellom, der den siste er ved `last` minutter. */
function series(make: (minutes: number) => Attempt, count: number, last = 0): Attempt[] {
  return Array.from({ length: count }, (_, i) => make(last - (count - 1 - i)));
}

type Case = {
  name: string;
  attempts: Attempt[];
  action: "request_code" | "sign_in";
  now: Date;
  blocked: boolean;
  reason?: "failed_codes" | "code_requests";
  retryAt?: Date;
};

const fiveFailures = series(fail, MAX_FAILED_CODES); // -4 … 0 min
const fiveRequests = [request(-10), request(-8), request(-6), request(-4), request(-2)];

const cases: Case[] = [
  // 1. Regel 1
  {
    name: "1. 4 feil på 15 min slipper gjennom (sign_in)",
    attempts: series(fail, MAX_FAILED_CODES - 1),
    action: "sign_in",
    now: at(1),
    blocked: false,
  },
  {
    name: "1. 4 feil på 15 min slipper gjennom (request_code)",
    attempts: series(fail, MAX_FAILED_CODES - 1),
    action: "request_code",
    now: at(1),
    blocked: false,
  },
  // 2. Regel 2, bygd med konstanten
  {
    name: "2. 5 feil på 15 min sperrer innlogging til 5. feil + 15 min",
    attempts: fiveFailures,
    action: "sign_in",
    now: at(1),
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  // 3.
  {
    name: "3. 5 feil sperrer også bestilling, samme tidspunkt",
    attempts: fiveFailures,
    action: "request_code",
    now: at(1),
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  // 4. Regel 3
  {
    name: "4. 14:59 etter siste feil er fortsatt sperret",
    attempts: fiveFailures,
    action: "sign_in",
    now: at(14, 59),
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  {
    name: "4. nøyaktig 15:00 etter siste feil slipper gjennom",
    attempts: fiveFailures,
    action: "sign_in",
    now: at(15),
    blocked: false,
  },
  {
    name: "4. nøyaktig 15:00 etter siste feil slipper bestilling gjennom",
    attempts: fiveFailures,
    action: "request_code",
    now: at(15),
    blocked: false,
  },
  // 5. Vinduet mellom eldste og nyeste feil
  {
    name: "5. 5 feil med nøyaktig 15:00 mellom eldste og nyeste sperrer",
    attempts: [fail(-15), fail(-10), fail(-5), fail(-2), fail(0)],
    action: "sign_in",
    now: at(1),
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  {
    name: "5. 5 feil med 15:01 mellom eldste og nyeste sperrer ikke",
    attempts: [fail(-15, -1), fail(-10), fail(-5), fail(-2), fail(0)],
    action: "sign_in",
    now: at(1),
    blocked: false,
  },
  // 6. Bare de siste 5 feilene teller
  {
    name: "6. 8 feil over 2 timer, de siste 5 innen 15 min, sperrer",
    attempts: [fail(-120), fail(-90), fail(-60), fail(-14), fail(-10), fail(-5), fail(-2), fail(0)],
    action: "sign_in",
    now: at(1),
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  {
    name: "6. 8 feil over 2 timer, de siste 5 spredt over 20 min, sperrer ikke",
    attempts: [
      fail(-120),
      fail(-90),
      fail(-60),
      fail(-20),
      fail(-15),
      fail(-10),
      fail(-5),
      fail(0),
    ],
    action: "sign_in",
    now: at(1),
    blocked: false,
  },
  // 7. Regel 5, feil
  {
    name: "7. riktig kode nullstiller feil (sign_in)",
    attempts: [...fiveFailures, succeeded(1)],
    action: "sign_in",
    now: at(2),
    blocked: false,
  },
  {
    name: "7. riktig kode nullstiller feil (request_code)",
    attempts: [...fiveFailures, succeeded(1)],
    action: "request_code",
    now: at(2),
    blocked: false,
  },
  // 8. Regel 5, bestillinger
  {
    name: "8. riktig kode nullstiller bestillinger",
    attempts: [...fiveRequests, succeeded(-1)],
    action: "request_code",
    now: at(0),
    blocked: false,
  },
  // 9. Presisering 2: lik tid som suksessen teller ikke
  {
    name: "9. feil med samme tid som riktig kode teller ikke, pluss 4 nye feil",
    attempts: [fail(0), succeeded(0), fail(1), fail(2), fail(3), fail(4)],
    action: "sign_in",
    now: at(5),
    blocked: false,
  },
  // 10. Regel 6
  {
    name: "10. 5 bestillinger: den 6. avvises til eldste + 15 min",
    attempts: fiveRequests,
    action: "request_code",
    now: at(0),
    blocked: true,
    reason: "code_requests",
    retryAt: at(5),
  },
  // 11. Glidende vindu for bestillinger
  {
    name: "11. eldste bestilling nøyaktig 15:00 før telles ikke",
    attempts: [request(-15), request(-8), request(-6), request(-4), request(-2)],
    action: "request_code",
    now: at(0),
    blocked: false,
  },
  {
    name: "11. eldste bestilling 14:59 før telles",
    attempts: [request(-14, -59), request(-8), request(-6), request(-4), request(-2)],
    action: "request_code",
    now: at(0),
    blocked: true,
    reason: "code_requests",
    retryAt: at(0, 1),
  },
  // 12.
  {
    name: "12. bestillingsgrensen stopper ikke innlogging",
    attempts: fiveRequests,
    action: "sign_in",
    now: at(0),
    blocked: false,
  },
  // 13. Presisering 1
  {
    name: "13. begge grenser nådd: bestilling viser feilsperren",
    attempts: [request(-10), request(-9), request(-8), request(-7), request(-6), ...fiveFailures],
    action: "request_code",
    now: at(1),
    blocked: true,
    reason: "failed_codes",
    retryAt: at(15),
  },
  // 15.
  { name: "15. tom liste (sign_in)", attempts: [], action: "sign_in", now: T0, blocked: false },
  {
    name: "15. tom liste (request_code)",
    attempts: [],
    action: "request_code",
    now: T0,
    blocked: false,
  },
];

function expected(c: Case) {
  return c.blocked ? { blocked: true, reason: c.reason, retryAt: c.retryAt } : { blocked: false };
}

describe("decideThrottle: regeltester", () => {
  it.each(cases)("$name", (c) => {
    expect(decideThrottle(c.attempts, c.action, c.now)).toEqual(expected(c));
  });

  // 14. Rekkefølgen på radene spiller ingen rolle
  it.each(cases.filter((c) => c.attempts.length > 1))(
    "14. samme svar med radene i omvendt og stokket rekkefølge: $name",
    (c) => {
      const reversed = [...c.attempts].reverse();
      // Fast stokking (ingen tilfeldighet): partall først, så oddetall baklengs
      const shuffled = [
        ...c.attempts.filter((_, i) => i % 2 === 0),
        ...c.attempts.filter((_, i) => i % 2 === 1).reverse(),
      ];
      expect(decideThrottle(reversed, c.action, c.now)).toEqual(expected(c));
      expect(decideThrottle(shuffled, c.action, c.now)).toEqual(expected(c));
    },
  );

  it("endrer ikke listen den får", () => {
    const attempts = [...fiveFailures].reverse();
    const copy = attempts.map((a) => ({ ...a }));
    decideThrottle(attempts, "sign_in", at(1));
    expect(attempts).toEqual(copy);
  });
});

describe("normalizeEmail og hashEmail", () => {
  const secret = "test-hemmelighet-som-er-lang-nok-0123456789";

  // 16. Regel 7
  it("16. normalizeEmail trimmer og gjør om til små bokstaver", () => {
    expect(normalizeEmail(" Ola@Eksempel.no ")).toBe("ola@eksempel.no");
    expect(normalizeEmail("ola@eksempel.no")).toBe("ola@eksempel.no");
  });

  // 17.
  it("17. hashEmail er lik for samme adresse med store bokstaver og mellomrom", () => {
    expect(hashEmail("Ola@Eksempel.no ", secret)).toBe(hashEmail("ola@eksempel.no", secret));
  });

  it("17. hashEmail er ulik for en annen adresse og med en annen hemmelighet", () => {
    const ola = hashEmail("ola@eksempel.no", secret);
    expect(hashEmail("kari@eksempel.no", secret)).not.toBe(ola);
    expect(hashEmail("ola@eksempel.no", `${secret}-annen`)).not.toBe(ola);
  });

  it("17. hashEmail er HMAC-SHA256 i hex med avledet nøkkel, ikke den rå hemmeligheten", () => {
    const hash = hashEmail("ola@eksempel.no", secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const withRawSecret = createHmac("sha256", secret).update("ola@eksempel.no").digest("hex");
    expect(hash).not.toBe(withRawSecret);
  });

  it("17. svaret inneholder ikke adressen", () => {
    const hash = hashEmail("Ola@Eksempel.no", secret);
    expect(hash.toLowerCase()).not.toContain("ola");
    expect(hash).not.toContain("eksempel");
    expect(hash).not.toContain("@");
  });
});

describe("throttleMessage: norsk melding med klokkeslett i Oslo-tid", () => {
  // 18. Vintertid (CET, UTC+1)
  it("18. feil koder, vintertid", () => {
    expect(throttleMessage("failed_codes", new Date("2026-10-26T13:35:00Z"))).toBe(
      "For mange feil koder. Du kan prøve igjen kl. 14:35.",
    );
  });

  // 19. Sommertid (CEST, UTC+2)
  it("19. bestillinger, sommertid", () => {
    expect(throttleMessage("code_requests", new Date("2026-10-24T12:35:00Z"))).toBe(
      "For mange koder bestilt. Du kan be om ny kode kl. 14:35.",
    );
  });

  // 20. Natten 25.10.2026 stilles klokken fra 03:00 til 02:00. Testen setter ikke TZ.
  it("20. natten klokken stilles: begge 02:05 vises riktig", () => {
    expect(throttleMessage("failed_codes", new Date("2026-10-25T01:05:00Z"))).toBe(
      "For mange feil koder. Du kan prøve igjen kl. 02:05.",
    );
    expect(throttleMessage("failed_codes", new Date("2026-10-25T00:05:00Z"))).toBe(
      "For mange feil koder. Du kan prøve igjen kl. 02:05.",
    );
  });

  it("T0-eksempelet: 5. feil kl. 14:20 gir sperre til 14:35", () => {
    const decision = decideThrottle(fiveFailures, "sign_in", at(1));
    expect(decision.blocked).toBe(true);
    if (!decision.blocked) return;
    expect(throttleMessage(decision.reason, decision.retryAt)).toBe(
      "For mange feil koder. Du kan prøve igjen kl. 14:35.",
    );
  });

  // 22.
  it("22. ingen gjetteord og ingen «Vent ett minutt» i meldingene", () => {
    for (const reason of ["failed_codes", "code_requests"] as const) {
      const message = throttleMessage(reason, T0);
      expect(message).not.toMatch(/antas|trolig|kanskje|sannsynligvis/i);
      expect(message).not.toContain("Vent ett minutt");
    }
  });
});

// 21.
describe("konstantene", () => {
  it("21. grensene er 5 feil, 5 bestillinger og 15 minutter", () => {
    expect(MAX_FAILED_CODES).toBe(5);
    expect(MAX_CODE_REQUESTS).toBe(5);
    expect(THROTTLE_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it("21. sperren følger konstantene: MAX_FAILED_CODES - 1 slipper, MAX_FAILED_CODES sperrer", () => {
    const lastFailure = at(0);
    expect(decideThrottle(series(fail, MAX_FAILED_CODES - 1), "sign_in", at(1))).toEqual({
      blocked: false,
    });
    expect(decideThrottle(series(fail, MAX_FAILED_CODES), "sign_in", at(1))).toEqual({
      blocked: true,
      reason: "failed_codes",
      retryAt: new Date(lastFailure.getTime() + THROTTLE_WINDOW_MS),
    });
    expect(decideThrottle(series(request, MAX_CODE_REQUESTS - 1), "request_code", at(1))).toEqual({
      blocked: false,
    });
    expect(decideThrottle(series(request, MAX_CODE_REQUESTS), "request_code", at(1))).toEqual({
      blocked: true,
      reason: "code_requests",
      retryAt: new Date(at(-(MAX_CODE_REQUESTS - 1)).getTime() + THROTTLE_WINDOW_MS),
    });
  });
});
