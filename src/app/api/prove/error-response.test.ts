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
 * Oversetting av databasefeil til svar (funn T-0001, testplan
 * docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 1b, test 11–15). Feil i verdien
 * (SQLSTATE klasse 22 og 23514) gir 400; andre databasefeil gir 500 som før. Test 14 lager feilen
 * ekte mot testdatabasen, så den ikke bygger på navnet på feilklassen. Alle data er oppdiktet.
 * Støtter hovedmål: de ansatte (én endring som ikke kan lagres stopper ikke resten av køen).
 */

const ROUTE = "/api/prove/synk/endringer";
const USER = "0192d3a0-0000-7000-8000-00000000beef";

/** Feil slik postgres-js gir dem: `code` er SQLSTATE. */
function pgError(code: string): Error {
  return Object.assign(new Error(`oppdiktet databasefeil ${code}`), { code, severity: "ERROR" });
}

/** Feil slik Drizzle pakker dem: databasefeilen ligger i `cause`. */
function wrapped(code: string): Error {
  return new Error("Failed query: insert into ...", { cause: pgError(code) });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trialErrorResponse: feil i verdien gir 400", () => {
  beforeEach(() => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  it.each(["22003", "22P02", "22021"])(
    "11 SQLSTATE i klasse 22 gir 400 (%s, rett og pakket i cause)",
    async (code) => {
      for (const error of [pgError(code), wrapped(code)]) {
        const response = trialErrorResponse(error, ROUTE, USER);
        expect(response.status).toBe(400);
        const body = await bodyOf(response);
        expect(typeof body.feil).toBe("string");
        expect(String(body.feil).length).toBeGreaterThan(0);
      }
    },
  );

  it("12 23514 (sjekkregel) gir 400", () => {
    expect(trialErrorResponse(pgError("23514"), ROUTE, USER).status).toBe(400);
    expect(trialErrorResponse(wrapped("23514"), ROUTE, USER).status).toBe(400);
  });

  it.each(["23505", "08006", "40001"])("13 andre databasefeil gir 500 (%s)", (code) => {
    expect(trialErrorResponse(pgError(code), ROUTE, USER).status).toBe(500);
    expect(trialErrorResponse(wrapped(code), ROUTE, USER).status).toBe(500);
  });

  it("13 feil uten SQLSTATE gir 500", () => {
    expect(trialErrorResponse(new Error("oppdiktet"), ROUTE, USER).status).toBe(500);
    expect(
      trialErrorResponse(new Error("Failed query", { cause: new Error("x") }), ROUTE, USER).status,
    ).toBe(500);
    expect(trialErrorResponse("ikke en feil", ROUTE, USER).status).toBe(500);
    expect(trialErrorResponse({ code: 22003 }, ROUTE, USER).status).toBe(500);
  });
});

describe("trialErrorResponse: svaret peker på endringen (14)", () => {
  beforeEach(resetDatabase);

  const POISON = "GIFTIG-MARKØR\u0000 oppdiktet";

  it("14 svaret på 400 har feil og endring, aldri teksten (for stor size_bytes)", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();
    let caught: unknown = null;
    try {
      await applyTrialChanges(actor, organizationId, [
        answerOp(formId, "summary", POISON),
        photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000, name: POISON }, photoId),
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught, "bunten skal avvises").not.toBeNull();

    const response = trialErrorResponse(caught, ROUTE, USER);
    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(Object.keys(body).sort()).toEqual(["endring", "feil"]);
    expect(typeof body.feil).toBe("string");
    expect(body.endring).toEqual({ id: photoId, table: "trial_photos", field_key: "cover_photo" });
    const json = JSON.stringify(body);
    expect(json).not.toContain("GIFTIG-MARKØR");
    expect(json).not.toContain("\\u0000");
    expect(json).not.toContain("3000000000");
  });

  it("14 ugyldig endring fra én operasjon (ukjent felt) peker på den operasjonen", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const badId = uuidv7();
    let caught: unknown = null;
    try {
      await applyTrialChanges(actor, organizationId, [
        answerOp(formId, "floors", 2),
        answerOp(formId, "unknown_key", POISON, {}, badId),
      ]);
    } catch (error) {
      caught = error;
    }
    const response = trialErrorResponse(caught, ROUTE, USER);
    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.endring).toEqual({ id: badId, table: "trial_answers", field_key: "unknown_key" });
    expect(JSON.stringify(body)).not.toContain("GIFTIG-MARKØR");
  });
});

describe("trialErrorResponse: uendret for tilgang, konflikt og bilder (15)", () => {
  it.each<[string, Error, number]>([
    ["AccessDeniedError", new AccessDeniedError(), 403],
    ["TrialIdConflictError", new TrialIdConflictError(), 409],
    ["TrialPhotoTooLargeError", new TrialPhotoTooLargeError(), 413],
    ["TrialPhotoNotFoundError", new TrialPhotoNotFoundError(), 404],
  ])("15 %s gir %i som i dag", async (_name, error, status) => {
    const response = trialErrorResponse(error, ROUTE, USER);
    expect(response.status).toBe(status);
    const body = await bodyOf(response);
    expect(Object.keys(body)).toEqual(["feil"]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
