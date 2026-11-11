import { count } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { getCurrentActor } from "@/core/auth/session";
import { db } from "@/db/client";
import { trialAnswers, trialPhotos } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { resetDatabase } from "../../../../../../tests/factories";
import {
  answerOp,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../../../tests/offline-trial";
import { POST } from "./route";

// Funn T-0001: ruten svarer 400 med endringen, ikke 500, og 200 for tekst med nulltegn.
// Testplan avsnitt 2b (53–57). Bare innloggingen er mocket; tilgangen kjøres ekte.
// Alle data er oppdiktet.

vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn() }));

const POISON = "Fukt\u0000 i kjeller";

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getCurrentActor).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function loggedInAs(actor: Actor | null) {
  vi.mocked(getCurrentActor).mockResolvedValue(actor);
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/prove/synk/endringer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Alt loggeren får, som tekst. */
function captureLogs() {
  const lines: string[] = [];
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      lines.push(JSON.stringify(args, (_key, value: unknown) => value));
    });
  }
  return lines;
}

async function counts() {
  const [answers] = await db.select({ n: count() }).from(trialAnswers);
  const [photos] = await db.select({ n: count() }).from(trialPhotos);
  return { answers: answers!.n, photos: photos!.n };
}

describe("POST /api/prove/synk/endringer med giftig innhold (T-0001)", () => {
  it("nulltegn gir 200", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);

    const response = await post({
      organizationId,
      operations: [
        answerOp(formId, "summary", POISON),
        answerOp(formId, "building_year", 1985),
        answerOp(formId, "general_description", "Oppdiktet"),
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 3 });
    expect(await counts()).toEqual({ answers: 3, photos: 0 });
  });

  it("for stor size_bytes gir 400 med endring, og svaret og loggen har ikke teksten", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);
    const lines = captureLogs();
    const tooBig = photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000 });

    const response = await post({
      organizationId,
      operations: [answerOp(formId, "summary", "HEMMELIG-MARKØR-77 Fukt"), tooBig],
    });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
      endring: { id: tooBig.id, table: "trial_photos", field_key: "cover_photo" },
    });
    expect(text).not.toContain("HEMMELIG-MARKØR-77");
    for (const line of lines) expect(line).not.toContain("HEMMELIG-MARKØR-77");
    expect(logger.error).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ answers: 0, photos: 0 });
  });

  it("ikke innlogget gir 401, fremmed organisasjon 403 med giftig innhold", async () => {
    const a = await setupOrganization("admin", "Oppdiktet A AS");
    const b = await setupOrganization("admin", "Oppdiktet B AS");
    const formId = await putTrialForm(a.actor, a.organizationId);
    const operations = [
      answerOp(formId, "summary", POISON),
      photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000 }),
    ];

    loggedInAs(null);
    expect((await post({ organizationId: a.organizationId, operations })).status).toBe(401);
    loggedInAs(b.actor);
    expect((await post({ organizationId: a.organizationId, operations })).status).toBe(403);
    expect(await counts()).toEqual({ answers: 0, photos: 0 });
  });

  it("annen databasefeil gir 500", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const duplicate = Object.assign(new Error("duplicate key"), { code: "23505" });
    vi.spyOn(db, "transaction").mockRejectedValueOnce(
      new Error("Failed query", { cause: duplicate }),
    );

    const response = await post({
      organizationId,
      operations: [answerOp(formId, "summary", POISON)],
    });
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("endring");
  });
});
