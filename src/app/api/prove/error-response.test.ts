import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  InvalidTrialChangeError,
  TrialChangeValueError,
  TrialIdConflictError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
} from "@/modules/offline-trial/server/errors";
import { logger } from "@/shared/lib/logger";
import { trialErrorResponse } from "./error-response";

/*
 * Oversettingen av feil til svar i prøven (funn T-0001, testplan
 * docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 1b, test 11–15).
 * 400 betyr «kan aldri lagres» og får klienten til å legge endringen til side; alt annet prøves på
 * nytt. Støtter hovedmål: de ansatte (ett rart tegn stopper ikke synken) og færre reklamasjoner.
 * All tekst er oppdiktet.
 */

const ROUTE = "/api/prove/synk/endringer";
const POISON = "Fukt\u0000 i kjeller";
const CHANGE = {
  id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b",
  table: "trial_answers",
  field_key: "general_description",
};

/** Databasefeil slik `postgres` lager den (`code`), med meldingen som kan ha verdier. */
function pgError(code: string) {
  return Object.assign(new Error(`feil fra databasen med ${POISON}`), { code });
}

/** Slik Drizzle pakker den inn: egen feil med databasefeilen i `cause`. */
function wrapped(code: string) {
  return new Error(`Failed query: insert ... params: ${POISON}`, { cause: pgError(code) });
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("trialErrorResponse", () => {
  it.each(["22003", "22P02", "22021"])("SQLSTATE i klasse 22 gir 400 (%s)", async (code) => {
    for (const error of [pgError(code), wrapped(code)]) {
      const response = trialErrorResponse(error, ROUTE, "bruker-1");
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({ feil: expect.any(String) });
    }
  });

  it("23514 (sjekkregel) gir 400", () => {
    expect(trialErrorResponse(pgError("23514"), ROUTE, "bruker-1").status).toBe(400);
    expect(trialErrorResponse(wrapped("23514"), ROUTE, "bruker-1").status).toBe(400);
  });

  it.each([
    ["23505", pgError("23505")],
    ["23505 pakket", wrapped("23505")],
    ["08006 (brutt forbindelse)", pgError("08006")],
    ["40001", wrapped("40001")],
    ["uten SQLSTATE", new Error("noe annet")],
    ["ikke en Error", "tekst"],
  ])("andre databasefeil gir 500 (%s)", (_name, error) => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    expect(trialErrorResponse(error, ROUTE, "bruker-1").status).toBe(500);
  });

  it("svaret på 400 har feil og endring, aldri teksten", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const responses = [
      trialErrorResponse(new TrialChangeValueError("22003", CHANGE), ROUTE, "bruker-1"),
      trialErrorResponse(new InvalidTrialChangeError(undefined, CHANGE), ROUTE, "bruker-1"),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const json = await body(response);
      expect(Object.keys(json).sort()).toEqual(["endring", "feil"]);
      expect(json.endring).toEqual(CHANGE);
      expect(JSON.stringify(json)).not.toContain("Fukt");
    }
    // Uten peker: bare `feil`
    expect(await body(trialErrorResponse(new InvalidTrialChangeError(), ROUTE, "u"))).toEqual({
      feil: expect.any(String),
    });
    expect(await body(trialErrorResponse(new ZodError([]), ROUTE, "u"))).toEqual({
      feil: expect.any(String),
    });
    // Loggeren får rute, bruker og kode, aldri meldingen fra databasen
    trialErrorResponse(wrapped("22021"), ROUTE, "bruker-1");
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Fukt");
    expect(warn).toHaveBeenLastCalledWith(expect.any(String), {
      route: ROUTE,
      userId: "bruker-1",
      sqlState: "22021",
    });
  });

  it.each<[string, unknown, number]>([
    ["AccessDeniedError", new AccessDeniedError(), 403],
    ["TrialIdConflictError", new TrialIdConflictError(), 409],
    ["TrialPhotoTooLargeError", new TrialPhotoTooLargeError(), 413],
    ["TrialPhotoNotFoundError", new TrialPhotoNotFoundError(), 404],
  ])("uendret for tilgang, konflikt og bildefeil (%s)", async (_name, error, status) => {
    const response = trialErrorResponse(error, ROUTE, "bruker-1");
    expect(response.status).toBe(status);
    expect(Object.keys(await body(response))).toEqual(["feil"]);
  });
});
