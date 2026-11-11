import { count, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentActor } from "@/core/auth/session";
import { db } from "@/db/client";
import { trialAnswers, trialPhotos } from "@/db/schema";
import { applyTextEdit, createTextState } from "@/modules/offline-trial/text-merge";
import type { TrialChangeOperation } from "@/modules/offline-trial/server/types";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../../../../tests/factories";
import {
  answerOp,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../../../tests/offline-trial";
import { POST } from "./route";

/*
 * Ruten POST /api/prove/synk/endringer med tegn databasen ikke tar (funn T-0001, testplan
 * docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 2b, test 53–57). Bare innloggingen
 * er byttet ut; tilgangen i src/core/access kjøres ekte mot testdatabasen. All tekst er oppdiktet.
 * Støtter hovedmål: de ansatte (ett rart tegn stopper ikke synken) og færre reklamasjoner.
 */

vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn() }));

const NUL = "\u0000";
const POISON = `Fukt${NUL} i kjeller`;
const MARKER = "MARKØR-RUTE-5150";
const TOO_BIG = 3_000_000_000;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getCurrentActor).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function post(organizationId: string, operations: TrialChangeOperation[]) {
  return POST(
    new Request("http://localhost/api/prove/synk/endringer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, operations }),
    }),
  );
}

function poisonBatch(formId: string) {
  return [
    answerOp(formId, "general_description", POISON, {
      text_state: applyTextEdit(createTextState(""), POISON),
    }),
    answerOp(formId, "building_year", 1985),
    answerOp(formId, "summary", `${MARKER}${NUL}`),
  ];
}

async function answerCount() {
  const [row] = await db.select({ n: count() }).from(trialAnswers);
  return row!.n;
}

/** Fanger alt loggeren får. */
function spyLogger() {
  const calls: unknown[] = [];
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      calls.push(args);
    });
  }
  return calls;
}

describe("POST /api/prove/synk/endringer (T-0001)", () => {
  it("nulltegn gir 200", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    vi.mocked(getCurrentActor).mockResolvedValue(actor);

    const response = await post(organizationId, poisonBatch(formId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 3 });
    expect(await answerCount()).toBe(3);
  });

  it("for stor size_bytes gir 400 med endring", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();
    vi.mocked(getCurrentActor).mockResolvedValue(actor);
    spyLogger();

    const response = await post(organizationId, [
      ...poisonBatch(formId),
      photoOp(formId, "cover_photo", { size_bytes: TOO_BIG }, photoId),
    ]);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      feil: expect.any(String),
      endring: { id: photoId, table: "trial_photos", field_key: "cover_photo" },
    });
    // Én transaksjon: heller ikke de gode svarene er lagret
    expect(await answerCount()).toBe(0);
    const [photos] = await db.select({ n: count() }).from(trialPhotos);
    expect(photos!.n).toBe(0);
  });

  it("svaret og loggen har ikke teksten fra bunten", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    vi.mocked(getCurrentActor).mockResolvedValue(actor);
    const calls = spyLogger();

    const ok = await post(organizationId, poisonBatch(formId));
    const bad = await post(organizationId, [
      ...poisonBatch(formId),
      photoOp(formId, "cover_photo", { size_bytes: TOO_BIG, name: MARKER }),
    ]);
    const unknownField = await post(organizationId, [answerOp(formId, "unknown_key", MARKER)]);

    expect(ok.status).toBe(200);
    expect(bad.status).toBe(400);
    expect(unknownField.status).toBe(400);
    const bodies = JSON.stringify([await bad.json(), await unknownField.json()]);
    const logged = JSON.stringify(calls);
    for (const text of [bodies, logged]) {
      expect(text).not.toContain(MARKER);
      expect(text).not.toContain("Fukt");
      expect(text).not.toContain(String(TOO_BIG));
    }
    expect(calls.length).toBeGreaterThan(0);
  });

  it("ikke innlogget 401, fremmed organisasjon 403 med giftig innhold", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formA = await putTrialForm(a.actor, a.organizationId);

    vi.mocked(getCurrentActor).mockResolvedValue(null);
    expect((await post(a.organizationId, poisonBatch(formA))).status).toBe(401);

    vi.mocked(getCurrentActor).mockResolvedValue(b.actor);
    const response = await post(a.organizationId, [
      ...poisonBatch(formA),
      photoOp(formA, "cover_photo", { size_bytes: TOO_BIG }),
    ]);
    expect(response.status).toBe(403);
    expect(Object.keys((await response.json()) as object)).toEqual(["feil"]);
    expect(await answerCount()).toBe(0);
  });

  it("annen databasefeil gir 500", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    vi.mocked(getCurrentActor).mockResolvedValue(actor);
    spyLogger();

    // Tvunget feil utenfor klasse 22 og 23514: trigger som kaster unique_violation (23505)
    await db.execute(sql`
      create or replace function t0001_force_unique_violation() returns trigger as $$
      begin
        raise exception 'tvunget feil i test' using errcode = '23505';
      end;
      $$ language plpgsql
    `);
    await db.execute(sql`
      create trigger t0001_force_unique_violation before insert on trial_answers
      for each row execute function t0001_force_unique_violation()
    `);
    try {
      const response = await post(organizationId, poisonBatch(formId));
      expect(response.status).toBe(500);
      expect(Object.keys((await response.json()) as object)).toEqual(["feil"]);
    } finally {
      await db.execute(sql`drop trigger if exists t0001_force_unique_violation on trial_answers`);
      await db.execute(sql`drop function if exists t0001_force_unique_violation()`);
    }
    expect(await answerCount()).toBe(0);
  });
});
