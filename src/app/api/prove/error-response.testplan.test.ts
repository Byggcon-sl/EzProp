import { ZodError } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import {
  InvalidTrialChangeError,
  TrialIdConflictError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
} from "@/modules/offline-trial/server/errors";
import { logger } from "@/shared/lib/logger";
import { trialErrorResponse } from "./error-response";

/*
 * Oversetting av feil til svar i prøven uten nett (funn T-0001, kortet Omfang 4, testplan
 * avsnitt 1b). Ren funksjon: ingen database. Feilene er laget i testen med SQLSTATE slik
 * PostgreSQL-driveren gir dem, både rett og pakket i `cause` (slik Drizzle gjør). Teksten er
 * oppdiktet. Svaret med `endring` (id, tabell, felt) prøves i apply-changes.test.ts og
 * route.test.ts, der feilen kommer fra en ekte bunt.
 * Støtter hovedmål: de ansatte (en verdi databasen ikke tar, stopper ikke resten av køen) og
 * færre reklamasjoner (svarene kommer fram).
 */

const ROUTE = "/api/prove/synk/endringer";
const USER = "0192d3a0-0000-7000-8000-0000000000u1";
const POISON = "Fukt\u0000 i kjeller HEMMELIG-T0001";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Feil slik driveren gir den: `code` er SQLSTATE. Meldingen bærer teksten fra bunten. */
function pgError(code: string): Error {
  return Object.assign(new Error(`feil i verdien «${POISON}»`), { code, severity: "ERROR" });
}

/** Samme feil pakket slik Drizzle gjør (`cause`). */
function wrapped(code: string): Error {
  return new Error(`Failed query: insert ... params: ${POISON}`, { cause: pgError(code) });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("trialErrorResponse: verdifeil fra databasen", () => {
  it.each(["22003", "22P02", "22021", "22P05", "22001"])(
    "SQLSTATE i klasse 22 gir 400 (%s, rett og pakket i cause)",
    async (code) => {
      for (const error of [pgError(code), wrapped(code)]) {
        const response = trialErrorResponse(error, ROUTE, USER);
        expect(response.status).toBe(400);
        const body = await bodyOf(response);
        expect(typeof body.feil).toBe("string");
        expect(JSON.stringify(body)).not.toContain("HEMMELIG-T0001");
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
    },
  );

  it("23514 (sjekkregel) gir 400", async () => {
    for (const error of [pgError("23514"), wrapped("23514")]) {
      const response = trialErrorResponse(error, ROUTE, USER);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await bodyOf(response))).not.toContain("HEMMELIG-T0001");
    }
  });

  it.each([
    ["23505 (unik)", () => pgError("23505")],
    ["23505 pakket", () => wrapped("23505")],
    ["08006 (brutt forbindelse)", () => pgError("08006")],
    ["40001 (serialisering)", () => pgError("40001")],
    ["23503 (fremmednøkkel)", () => pgError("23503")],
    ["feil uten SQLSTATE", () => new Error(`noe annet ${POISON}`)],
    ["ikke en Error", () => "tekst som kastes"],
  ])("andre databasefeil gir 500: %s", async (_name, make) => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const response = trialErrorResponse(make(), ROUTE, USER);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await bodyOf(response))).not.toContain("HEMMELIG-T0001");
  });

  it("svaret på 400 har aldri teksten, og loggen får den heller ikke", async () => {
    // Det loggeren faktisk skriver ut (standard ut og feil)
    const lines: string[] = [];
    const write = (chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(write);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(write);
    let text: string;
    try {
      const pg = Object.assign(new Error("unsupported Unicode escape sequence"), {
        code: "22P05",
        detail: `${POISON} cannot be converted to text.`,
      });
      const response = trialErrorResponse(
        new Error(`Failed query: insert ... params: ${POISON}`, { cause: pg }),
        ROUTE,
        USER,
      );
      expect(response.status).toBe(400);
      text = JSON.stringify(await bodyOf(response));
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
    expect(text).not.toContain("HEMMELIG-T0001");
    expect(text).not.toContain("\\u0000");
    for (const line of lines) expect(line).not.toContain("HEMMELIG-T0001");
  });
});

describe("trialErrorResponse: uendret for andre feil", () => {
  it.each([
    ["AccessDeniedError", () => new AccessDeniedError(), 403],
    ["InvalidTrialChangeError", () => new InvalidTrialChangeError(), 400],
    ["ZodError", () => new ZodError([]), 400],
    ["TrialIdConflictError", () => new TrialIdConflictError(), 409],
    ["TrialPhotoNotFoundError", () => new TrialPhotoNotFoundError(), 404],
    ["TrialPhotoTooLargeError", () => new TrialPhotoTooLargeError(), 413],
  ] as const)("%s gir %i som i dag", async (_name, make, status) => {
    const response = trialErrorResponse(make(), ROUTE, USER);
    expect(response.status).toBe(status);
    expect(typeof (await bodyOf(response)).feil).toBe("string");
  });
});
