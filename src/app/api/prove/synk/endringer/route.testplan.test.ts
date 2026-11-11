import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { getCurrentActor } from "@/core/auth/session";
import { db } from "@/db/client";
import { trialAnswers, trialForms, trialPhotos } from "@/db/schema";
import { applyTextEdit, createTextState } from "@/modules/offline-trial/text-merge";
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
 * Skriveruten POST /api/prove/synk/endringer etter funn T-0001
 * (docs/agenter/oppgaver/rett-t0001-synkko.md Omfang 2 og 4, testplan avsnitt 2b, 53–57).
 * Bare innloggingen er mocket; tilgangssjekken i src/core/access og databasen er ekte. Alle data
 * er oppdiktet.
 * Støtter hovedmål: de ansatte (tekst med nulltegn kommer fram, og én endring som ikke kan
 * lagres, får 400 som klienten kan legge til side) og færre reklamasjoner (svarene kommer fram).
 */

vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn() }));

const URL_PATH = "http://localhost/api/prove/synk/endringer";
const MARKER = "HEMMELIG-T0001";
const POISON = `Fukt\u0000 i kjeller ${MARKER}`;

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
    new Request(URL_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Bunten fra funnet: nulltegn i «Generell beskrivelse» først, så byggeår og samlet kommentar. */
function poisonedBatch(formId: string) {
  return [
    formOp(formId),
    answerOp(formId, "general_description", POISON, {
      text_state: applyTextEdit(createTextState(""), POISON),
    }),
    answerOp(formId, "building_year", 1985),
    answerOp(formId, "summary", `Oppdiktet kommentar ${MARKER}`),
  ];
}

async function countAll() {
  const [forms] = await db.select({ n: count() }).from(trialForms);
  const [answers] = await db.select({ n: count() }).from(trialAnswers);
  const [photos] = await db.select({ n: count() }).from(trialPhotos);
  return { forms: forms!.n, answers: answers!.n, photos: photos!.n };
}

/** Det som faktisk skrives ut under kallet (loggeren og console). */
async function captureOutput<T>(call: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const write = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  const capture = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation(write),
    vi.spyOn(process.stderr, "write").mockImplementation(write),
    ...(["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(capture),
    ),
  ];
  try {
    return { result: await call(), lines };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

describe("POST /api/prove/synk/endringer etter T-0001", () => {
  it("nulltegn gir 200 og tre lagrede svar uten nulltegn", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    const formId = uuidv7();

    const response = await post({ organizationId, operations: poisonedBatch(formId) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 4 });
    const rows = await db.select().from(trialAnswers).where(eq(trialAnswers.trialFormId, formId));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(JSON.stringify(row.value)).not.toContain("\\u0000");
  });

  it("for stor size_bytes gir 400 med endring, ikke 500", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();

    const response = await post({
      organizationId,
      operations: [
        answerOp(formId, "summary", `Oppdiktet ${MARKER}`),
        photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000 }, photoId),
      ],
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.feil).toBe("string");
    expect(body.endring).toEqual({ id: photoId, table: "trial_photos", field_key: "cover_photo" });
    expect(Object.keys(body).sort()).toEqual(["endring", "feil"]);
  });

  it("ukjent felt i én endring gir 400 med endring", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    const formId = await putTrialForm(actor, organizationId);
    const badId = uuidv7();

    const response = await post({
      organizationId,
      operations: [answerOp(formId, "unknown_key", `Oppdiktet ${MARKER}`, {}, badId)],
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    // Ukjent feltkode sendes ikke tilbake (den kan være hva som helst fra klienten).
    expect(body.endring).toEqual({ id: badId, table: "trial_answers", field_key: null });
  });

  it("svaret og loggen har ikke teksten fra bunten", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    const formId = await putTrialForm(actor, organizationId);

    const { result: bodies, lines } = await captureOutput(async () => {
      const ok = await post({ organizationId, operations: poisonedBatch(uuidv7()) });
      const bad = await post({
        organizationId,
        operations: [
          answerOp(formId, "summary", POISON),
          photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000, name: `${MARKER}.png` }),
        ],
      });
      return [await ok.text(), await bad.text()];
    });

    for (const body of bodies) {
      expect(body).not.toContain(MARKER);
      expect(body).not.toContain("Fukt");
    }
    for (const line of lines) {
      expect(line).not.toContain(MARKER);
      expect(line).not.toContain("Fukt");
    }
  });

  it("én transaksjon: etter 400 er ingenting fra bunten lagret", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    const formId = uuidv7();

    const response = await post({
      organizationId,
      operations: [
        ...poisonedBatch(formId),
        photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000 }),
      ],
    });

    expect(response.status).toBe(400);
    expect(await countAll()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("ikke innlogget gir 401", async () => {
    loggedInAs(null);
    const response = await post({ organizationId: uuidv7(), operations: poisonedBatch(uuidv7()) });
    expect(response.status).toBe(401);
    expect(await countAll()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("fremmed organisasjon gir 403 med giftig innhold, og ingen rader i noen organisasjon", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    loggedInAs(b.actor);
    const formId = uuidv7();

    for (const operations of [
      poisonedBatch(formId),
      [...poisonedBatch(formId), photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000 })],
      [answerOp(formId, "unknown\u0000", POISON)],
    ]) {
      const response = await post({ organizationId: a.organizationId, operations });
      expect(response.status).toBe(403);
      expect(JSON.stringify(await response.json())).not.toContain(MARKER);
    }
    expect(await countAll()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("admin i egen organisasjon får 200 med giftig innhold", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    loggedInAs(actor);
    const response = await post({ organizationId, operations: poisonedBatch(uuidv7()) });
    expect(response.status).toBe(200);
  });

  it("annen databasefeil (unique_violation fra en trigger) gir 500", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    loggedInAs(actor);
    const formId = await putTrialForm(actor, organizationId);
    await db.execute(sql`
      create or replace function t0001_test_fail() returns trigger language plpgsql as $$
      begin
        raise exception 'tvunget feil i test' using errcode = 'unique_violation';
      end $$`);
    await db.execute(sql`
      create trigger t0001_test_fail before insert on trial_answers
      for each row execute function t0001_test_fail()`);
    try {
      const { result: response } = await captureOutput(() =>
        post({ organizationId, operations: [answerOp(formId, "building_year", 1985)] }),
      );
      expect(response.status).toBe(500);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.endring).toBeUndefined();
    } finally {
      await db.execute(sql`drop trigger if exists t0001_test_fail on trial_answers`);
      await db.execute(sql`drop function if exists t0001_test_fail()`);
    }
  });
});
