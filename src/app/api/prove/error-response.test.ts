import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { applyTrialChanges } from "@/modules/offline-trial/server/apply-changes";
import {
  TrialIdConflictError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
} from "@/modules/offline-trial/server/errors";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../../tests/factories";
import {
  answerOp,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../tests/offline-trial";
import { trialErrorResponse } from "./error-response";

/*
 * Oversetting av databasefeil til 400 eller 500 (funn T-0001, oppgavekortet Omfang 4, testplan
 * avsnitt 1b). Feil i verdien (SQLSTATE-klasse 22 og 23514) gir 400; andre databasefeil gir 500
 * som før. Testen 14 bruker en ekte feil fra `applyTrialChanges` mot testdatabasen, så den ikke
 * gjetter navnet på feilklassen. All tekst er oppdiktet.
 * Støtter hovedmål: de ansatte (én endring som ikke kan lagres, stopper ikke de andre).
 */

const ROUTE = "/api/prove/synk/endringer";
const USER = "0192d3a0-0000-7000-8000-0000000000c1";
const POISON = "Fukt\u0000 i kjeller GIFTIG-MARKØR-5521";

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

/** En feil slik `postgres` gir den: `code` er SQLSTATE. */
function pgError(code: string): Error {
  return Object.assign(new Error(`databasefeil ${code}`), { code, severity: "ERROR" });
}

/** Samme feil pakket i `cause`, slik Drizzle gjør. */
function wrapped(code: string): Error {
  return new Error("Failed query: insert into ...", { cause: pgError(code) });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("trialErrorResponse: databasefeil", () => {
  it.each(["22003", "22P02", "22021"])("11 SQLSTATE %s i klasse 22 gir 400", async (code) => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    for (const error of [pgError(code), wrapped(code)]) {
      const response = trialErrorResponse(error, ROUTE, USER);
      expect(response.status).toBe(400);
      expect(typeof (await bodyOf(response)).feil).toBe("string");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  it("12 23514 (sjekkregel) gir 400", () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    expect(trialErrorResponse(pgError("23514"), ROUTE, USER).status).toBe(400);
    expect(trialErrorResponse(wrapped("23514"), ROUTE, USER).status).toBe(400);
  });

  it.each([
    ["23505 (unik)", pgError("23505")],
    ["23505 pakket i cause", wrapped("23505")],
    ["08006 (brutt forbindelse)", pgError("08006")],
    ["40001 (serialisering)", pgError("40001")],
    ["uten SQLSTATE", new Error("noe annet")],
    ["ikke en Error", "tekst"],
  ])("13 andre databasefeil gir 500: %s", (_name, error) => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    expect(trialErrorResponse(error, ROUTE, USER).status).toBe(500);
  });

  it("14 svaret på 400 har feil og endring, aldri teksten", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();
    const error = await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "summary", POISON),
      photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000, name: POISON }, photoId),
    ]).then(
      () => {
        throw new Error("bunten skulle gitt feil");
      },
      (caught: unknown) => caught,
    );
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const response = trialErrorResponse(error, ROUTE, USER);

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(Object.keys(body).sort()).toEqual(["endring", "feil"]);
    expect(typeof body.feil).toBe("string");
    expect(body.endring).toEqual({ id: photoId, table: "trial_photos", field_key: "cover_photo" });
    const json = JSON.stringify(body);
    expect(json).not.toContain("GIFTIG-MARKØR-5521");
    expect(json).not.toContain("\\u0000");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("GIFTIG-MARKØR-5521");
  });

  it.each([
    ["AccessDeniedError", new AccessDeniedError(), 403],
    ["TrialIdConflictError", new TrialIdConflictError(), 409],
    ["TrialPhotoTooLargeError", new TrialPhotoTooLargeError(), 413],
    ["TrialPhotoNotFoundError", new TrialPhotoNotFoundError(), 404],
  ] as const)("15 uendret for %s", (_name, error, status) => {
    expect(trialErrorResponse(error, ROUTE, USER).status).toBe(status);
  });
});
