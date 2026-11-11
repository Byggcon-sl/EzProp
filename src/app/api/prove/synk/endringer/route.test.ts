import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { getCurrentActor } from "@/core/auth/session";
import { db } from "@/db/client";
import { trialAnswers, trialForms, trialPhotos } from "@/db/schema";
import { applyTextEdit, createTextState } from "@/modules/offline-trial/text-merge";
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
 * Ruten POST /api/prove/synk/endringer (funn T-0001, testplan
 * docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 2b, test 53–57). Bare innloggingen
 * er mocket; tilgangen sjekkes ekte mot testdatabasen. Den giftige teksten bygges her. Alle data
 * er oppdiktet.
 * Støtter hovedmål: de ansatte (én endring som ikke kan lagres gir 400 som peker på den, så
 * iPaden kan sende resten) og færre reklamasjoner (svarene kommer fram).
 */

vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn() }));

const URL_PATH = "http://localhost/api/prove/synk/endringer";
const NUL = "\u0000";
const MARKER = "GIFTIG-MARKØR-5355";
const TOO_BIG = 3_000_000_000;

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

async function post(body: unknown): Promise<Response> {
  return POST(
    new Request(URL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function spyOnLogger() {
  return [
    vi.spyOn(logger, "debug").mockImplementation(() => undefined),
    vi.spyOn(logger, "info").mockImplementation(() => undefined),
    vi.spyOn(logger, "warn").mockImplementation(() => undefined),
    vi.spyOn(logger, "error").mockImplementation(() => undefined),
  ];
}

function loggedText(spies: ReturnType<typeof spyOnLogger>): string {
  return JSON.stringify(
    spies.flatMap((spy) => spy.mock.calls),
    (_key, value: unknown) =>
      value instanceof Error
        ? {
            name: value.name,
            message: value.message,
            stack: value.stack,
            cause: String(value.cause),
          }
        : value,
  );
}

async function totalRows() {
  const [forms] = await db.select({ n: count() }).from(trialForms);
  const [answers] = await db.select({ n: count() }).from(trialAnswers);
  const [photos] = await db.select({ n: count() }).from(trialPhotos);
  return { forms: forms!.n, answers: answers!.n, photos: photos!.n };
}

/** Bunten fra funnet: nulltegn i Generell beskrivelse først, så byggeår og samlet kommentar. */
function poisonOperations(formId: string) {
  const text = `Fukt${NUL} i kjeller ${MARKER}`;
  return [
    answerOp(formId, "general_description", text, {
      text_state: applyTextEdit(createTextState(""), text),
    }),
    answerOp(formId, "building_year", 1985),
    answerOp(formId, "summary", `Oppdiktet samlet kommentar ${MARKER}`),
  ];
}

describe("POST /api/prove/synk/endringer (T-0001)", () => {
  it("53 nulltegn gir 200", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);

    const response = await post({ organizationId, operations: poisonOperations(formId) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 3 });
    const rows = await db.select().from(trialAnswers).where(eq(trialAnswers.trialFormId, formId));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(JSON.stringify(row.value)).not.toContain("\\u0000");
  });

  it("54 for stor size_bytes gir 400 med endring", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();
    loggedInAs(actor);
    spyOnLogger();

    const response = await post({
      organizationId,
      operations: [
        answerOp(formId, "building_year", 1985),
        photoOp(formId, "cover_photo", { size_bytes: TOO_BIG }, photoId),
      ],
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["endring", "feil"]);
    expect(typeof body.feil).toBe("string");
    expect(body.endring).toEqual({ id: photoId, table: "trial_photos", field_key: "cover_photo" });
    // Én transaksjon: byggeåret ble heller ikke lagret
    expect((await totalRows()).answers).toBe(0);
  });

  it("55 svaret og loggen har ikke teksten fra bunten", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);
    const spies = spyOnLogger();

    const response = await post({
      organizationId,
      operations: [
        ...poisonOperations(formId),
        photoOp(formId, "cover_photo", { size_bytes: TOO_BIG, name: `${MARKER}.png` }),
      ],
    });

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("Fukt");
    expect(text).not.toContain(String(TOO_BIG));
    const logged = loggedText(spies);
    expect(logged).not.toContain(MARKER);
    expect(logged).not.toContain("Fukt");
    expect(logged).not.toContain(String(TOO_BIG));
  });

  it("56 ikke innlogget gir 401", async () => {
    const { organizationId } = await setupOrganization("inspector");
    loggedInAs(null);
    const response = await post({ organizationId, operations: poisonOperations(uuidv7()) });
    expect(response.status).toBe(401);
    expect(await totalRows()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("56 fremmed organisasjon gir 403 med giftig innhold", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formId = uuidv7();
    loggedInAs(b.actor);
    spyOnLogger();

    const response = await post({
      organizationId: a.organizationId,
      operations: [
        formOp(formId, { name: `Skjema${NUL}` }),
        ...poisonOperations(formId),
        photoOp(formId, "cover_photo", { size_bytes: TOO_BIG }),
      ],
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("endring");
    expect(await totalRows()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("57 annen databasefeil gir 500", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    loggedInAs(actor);
    spyOnLogger();
    await db.execute(sql`
      create or replace function t0001_test_unique() returns trigger language plpgsql as $$
      begin raise exception 'oppdiktet' using errcode = 'unique_violation'; end $$`);
    await db.execute(sql`
      create trigger t0001_test_unique before insert on trial_answers
      for each row execute function t0001_test_unique()`);
    try {
      const response = await post({
        organizationId,
        operations: [answerOp(formId, "building_year", 1985)],
      });
      expect(response.status).toBe(500);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("endring");
    } finally {
      await db.execute(sql`drop trigger if exists t0001_test_unique on trial_answers`);
      await db.execute(sql`drop function if exists t0001_test_unique()`);
    }
  });
});
