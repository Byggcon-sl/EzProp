import { count, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { getCurrentActor } from "@/core/auth/session";
import { db } from "@/db/client";
import { trialAnswers, trialForms, trialPhotos } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../../../../tests/factories";
import {
  answerOp,
  formOp,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../../../tests/offline-trial";
import { POST } from "./route";

/*
 * Ruten POST /api/prove/synk/endringer med en «giftig» bunt (funn T-0001, oppgavekortet Omfang 2
 * og 4, testplan avsnitt 2b, 53–57). Bare innloggingen er mocket; tilgang og lagring kjøres ekte mot
 * testdatabasen. All tekst er oppdiktet.
 * Støtter hovedmål: de ansatte (serveren svarer 400 med endringen, ikke 500, så iPaden kan legge
 * den til side og sende resten) og færre reklamasjoner (svarene kommer fram).
 */

vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn() }));

const URL_PATH = "http://localhost/api/prove/synk/endringer";
const NUL = "\u0000";
const MARKER = "GIFTIG-MARKØR-9034";
const POISON = `Fukt${NUL} i kjeller`;

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

async function post(organizationId: string, operations: unknown[]): Promise<Response> {
  return POST(
    new Request(URL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId, operations }),
    }),
  );
}

async function totalRows() {
  const [forms] = await db.select({ n: count() }).from(trialForms);
  const [answers] = await db.select({ n: count() }).from(trialAnswers);
  const [photos] = await db.select({ n: count() }).from(trialPhotos);
  return { forms: forms!.n, answers: answers!.n, photos: photos!.n };
}

function spyOnLogger() {
  return (["debug", "info", "warn", "error"] as const).map((method) =>
    vi.spyOn(logger, method).mockImplementation(() => undefined),
  );
}

function loggedText(spies: ReturnType<typeof spyOnLogger>): string {
  return JSON.stringify(
    spies.flatMap((spy) => spy.mock.calls),
    (_key, value: unknown) =>
      value instanceof Error
        ? { name: value.name, message: value.message, cause: String(value.cause) }
        : value,
  );
}

/** Bunten fra 41: Generell beskrivelse med nulltegn først, byggeår og samlet kommentar. */
function poisonedOperations(formId: string) {
  return [
    answerOp(formId, "general_description", `Fukt${NUL} i kjeller ${MARKER}`),
    answerOp(formId, "building_year", 1985),
    answerOp(formId, "summary", `Oppdiktet samlet kommentar${NUL}`),
  ];
}

describe("POST /api/prove/synk/endringer med giftig innhold (T-0001)", () => {
  it("53 nulltegn gir 200", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);

    const response = await post(organizationId, poisonedOperations(formId));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 3 });
    expect((await totalRows()).answers).toBe(3);
  });

  it("54 for stor size_bytes gir 400 med endring", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();
    loggedInAs(actor);
    spyOnLogger();

    const response = await post(organizationId, [
      ...poisonedOperations(formId),
      photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000 }, photoId),
    ]);

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.feil).toBe("string");
    expect(body.endring).toEqual({ id: photoId, table: "trial_photos", field_key: "cover_photo" });
    // Én transaksjon: ingen av svarene er lagret
    expect((await totalRows()).answers).toBe(0);
  });

  it("55 svaret og loggen har ikke teksten fra bunten", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);
    const spies = spyOnLogger();

    const rejected = await post(organizationId, [
      ...poisonedOperations(formId),
      photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000, name: `${MARKER}.png` }),
    ]);
    const accepted = await post(organizationId, poisonedOperations(formId));

    expect(rejected.status).toBe(400);
    expect(accepted.status).toBe(200);
    for (const text of [await rejected.text(), await accepted.text(), loggedText(spies)]) {
      expect(text).not.toContain(MARKER);
      expect(text).not.toContain("Fukt");
      expect(text).not.toContain("Oppdiktet samlet kommentar");
    }
  });

  it("56 ikke innlogget gir 401, fremmed organisasjon gir 403 med giftig innhold", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formId = uuidv7();
    const operations = [
      formOp(formId, { name: `Skjema${NUL}` }),
      ...poisonedOperations(formId),
      photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000 }),
    ];

    loggedInAs(null);
    expect((await post(a.organizationId, operations)).status).toBe(401);

    loggedInAs(b.actor);
    const response = await post(a.organizationId, operations);
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("endring");
    expect(await totalRows()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("57 annen databasefeil gir 500", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);
    spyOnLogger();
    await db.execute(
      sql.raw(`create or replace function t0001_force_unique() returns trigger as $$
        begin raise exception 'tvunget i test' using errcode = 'unique_violation'; end;
        $$ language plpgsql`),
    );
    await db.execute(
      sql.raw(`create trigger t0001_force_unique before insert on trial_answers
        for each row execute function t0001_force_unique()`),
    );
    try {
      const response = await post(organizationId, [answerOp(formId, "building_year", 1985)]);
      expect(response.status).toBe(500);
      expect(await response.json()).not.toHaveProperty("endring");
    } finally {
      await db.execute(sql.raw("drop trigger if exists t0001_force_unique on trial_answers"));
      await db.execute(sql.raw("drop function if exists t0001_force_unique()"));
    }
  });
});

// Utviklerens tester for samme rute (testplan avsnitt 2b).

function postBody(body: unknown): Promise<Response> {
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

describe("POST /api/prove/synk/endringer: svarets form og loggen (T-0001)", () => {
  it("nulltegn gir 200", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);

    const response = await postBody({
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

    const response = await postBody({
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
    expect((await postBody({ organizationId: a.organizationId, operations })).status).toBe(401);
    loggedInAs(b.actor);
    expect((await postBody({ organizationId: a.organizationId, operations })).status).toBe(403);
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

    const response = await postBody({
      organizationId,
      operations: [answerOp(formId, "summary", POISON)],
    });
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("endring");
  });
});
