import { and, count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import type { EmployeeRole } from "@/db/schema";
import { db } from "@/db/client";
import { trialAnswers, trialForms, trialPhotos } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { createEmployee, createUser, resetDatabase } from "../../../../tests/factories";
import {
  ALL_ROLES,
  answerOp,
  createDeactivatedEmployee,
  formOp,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../tests/offline-trial";
import { applyTextEdit, createTextState, mergeTextStates, textOf } from "../text-merge";
import { applyTrialChanges } from "./apply-changes";
import { InvalidTrialChangeError, TrialChangeRejectedError, TrialIdConflictError } from "./errors";
import type { TrialChangeOperation } from "./types";

// Mottak av endringsbunter fra enhetene (docs/funksjoner/fase1-kandidat-powersync.md pkt. 11).
// Testplan avsnitt 3.2. Testene merket «Obligatorisk» i planen er tilgang og tenant-isolasjon.

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

async function countRows(organizationId?: string) {
  const where = <T extends { organizationId: unknown }>(table: T) =>
    organizationId ? eq(table.organizationId as never, organizationId) : undefined;
  const [forms] = await db.select({ n: count() }).from(trialForms).where(where(trialForms));
  const [answers] = await db.select({ n: count() }).from(trialAnswers).where(where(trialAnswers));
  const [photos] = await db.select({ n: count() }).from(trialPhotos).where(where(trialPhotos));
  return { forms: forms!.n, answers: answers!.n, photos: photos!.n };
}

async function formRow(id: string) {
  const [row] = await db.select().from(trialForms).where(eq(trialForms.id, id));
  return row;
}

async function answerRows(trialFormId: string, fieldKey?: string) {
  return db
    .select()
    .from(trialAnswers)
    .where(
      fieldKey
        ? and(eq(trialAnswers.trialFormId, trialFormId), eq(trialAnswers.fieldKey, fieldKey))
        : eq(trialAnswers.trialFormId, trialFormId),
    );
}

async function photoRow(id: string) {
  const [row] = await db.select().from(trialPhotos).where(eq(trialPhotos.id, id));
  return row;
}

describe("applyTrialChanges", () => {
  it("skriver skjema, svar og bilde med organization_id fra grant", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = uuidv7();
    const answerId = uuidv7();
    const photoId = uuidv7();

    const result = await applyTrialChanges(actor, organizationId, [
      formOp(formId),
      answerOp(formId, "floors", 2, {}, answerId),
      photoOp(formId, "cover_photo", {}, photoId),
    ]);
    expect(result).toEqual({ applied: 3 });

    const form = await formRow(formId);
    const [answer] = await answerRows(formId);
    const photo = await photoRow(photoId);
    for (const row of [form, answer, photo]) {
      expect(row).toBeDefined();
      expect(row!.organizationId).toBe(organizationId);
      expect(row!.createdBy).toBe(actor.id);
      expect(row!.updatedBy).toBe(actor.id);
    }
    expect(form!.name).toBe("Testskjema 1");
    expect(answer!.id).toBe(answerId);
    expect(answer!.value).toBe(2);
    expect(answer!.deviceId).toBe("enhet-1");
    expect(photo!.fieldKey).toBe("cover_photo");
    expect(photo!.sizeBytes).toBe(120);
  });

  it("bruker aldri organization_id fra nyttelasten", async () => {
    const a = await setupOrganization("inspector", "Organisasjon A");
    const b = await setupOrganization("inspector", "Organisasjon B");
    const formId = uuidv7();
    const photoId = uuidv7();
    const foreign = { organization_id: b.organizationId, organizationId: b.organizationId };

    await applyTrialChanges(a.actor, a.organizationId, [
      formOp(formId, foreign),
      answerOp(formId, "floors", 2, foreign),
      photoOp(formId, "cover_photo", foreign, photoId),
    ]);

    expect((await formRow(formId))!.organizationId).toBe(a.organizationId);
    expect((await answerRows(formId))[0]!.organizationId).toBe(a.organizationId);
    expect((await photoRow(photoId))!.organizationId).toBe(a.organizationId);
    expect(await countRows(b.organizationId)).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("fremmed organisasjon gir AccessDeniedError og ingen skriving", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formId = uuidv7();

    await expect(
      applyTrialChanges(a.actor, b.organizationId, [
        formOp(formId),
        answerOp(formId, "floors", 2),
        photoOp(formId),
      ]),
    ).rejects.toThrow(AccessDeniedError);
    expect(await countRows()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  describe("fremmed id gir 409-feil og raden i den andre organisasjonen er uendret", () => {
    const tables = ["trial_forms", "trial_answers", "trial_photos"] as const;

    it.each(tables)(
      "fremmed id gir 409-feil og raden i den andre organisasjonen er uendret (%s)",
      async (table) => {
        const a = await setupOrganization("inspector", "Organisasjon A");
        const b = await setupOrganization("inspector", "Organisasjon B");
        const formB = uuidv7();
        const answerB = uuidv7();
        const photoB = uuidv7();
        await applyTrialChanges(b.actor, b.organizationId, [
          formOp(formB, { name: "Skjema B" }),
          answerOp(formB, "floors", 3, {}, answerB),
          photoOp(formB, "cover_photo", { name: "b.png" }, photoB),
        ]);
        const formA = await putTrialForm(a.actor, a.organizationId, "Skjema A");
        const before = {
          form: await formRow(formB),
          answer: (await answerRows(formB))[0],
          photo: await photoRow(photoB),
        };

        const operation: TrialChangeOperation =
          table === "trial_forms"
            ? formOp(formB, { name: "kapret" })
            : table === "trial_answers"
              ? answerOp(formA, "floors", 9, {}, answerB)
              : photoOp(formA, "cover_photo", { name: "kapret.png" }, photoB);

        await expect(applyTrialChanges(a.actor, a.organizationId, [operation])).rejects.toThrow(
          TrialIdConflictError,
        );

        expect(await formRow(formB)).toEqual(before.form);
        expect((await answerRows(formB))[0]).toEqual(before.answer);
        expect(await photoRow(photoB)).toEqual(before.photo);
        // A fikk ingen rad med den fremmede id-en, og ingenting nytt ellers
        expect(await countRows(a.organizationId)).toEqual({ forms: 1, answers: 0, photos: 0 });
      },
    );
  });

  it("fremmed trial_form_id gir InvalidTrialChangeError og ingen rad", async () => {
    const a = await setupOrganization("inspector", "Organisasjon A");
    const b = await setupOrganization("inspector", "Organisasjon B");
    const formB = await putTrialForm(b.actor, b.organizationId, "Skjema B");

    await expect(
      applyTrialChanges(a.actor, a.organizationId, [answerOp(formB, "floors", 2)]),
    ).rejects.toThrow(InvalidTrialChangeError);
    await expect(applyTrialChanges(a.actor, a.organizationId, [photoOp(formB)])).rejects.toThrow(
      InvalidTrialChangeError,
    );

    expect(await countRows(a.organizationId)).toEqual({ forms: 0, answers: 0, photos: 0 });
    expect(await countRows(b.organizationId)).toEqual({ forms: 1, answers: 0, photos: 0 });
  });

  it("ukjent trial_form_id gir InvalidTrialChangeError", async () => {
    const { actor, organizationId } = await setupOrganization();
    await expect(
      applyTrialChanges(actor, organizationId, [answerOp(uuidv7(), "floors", 2)]),
    ).rejects.toThrow(InvalidTrialChangeError);
    await expect(applyTrialChanges(actor, organizationId, [photoOp(uuidv7())])).rejects.toThrow(
      InvalidTrialChangeError,
    );
    expect(await countRows()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("DELETE, ukjent tabell og ukjent felt gir InvalidTrialChangeError og ingen skriving", async () => {
    const { actor, organizationId } = await setupOrganization();
    const existing = await putTrialForm(actor, organizationId, "Finnes fra før");

    const cases: TrialChangeOperation[] = [
      { op: "DELETE" as never, table: "trial_forms", id: existing, data: {} },
      { op: "PUT", table: "users" as never, id: uuidv7(), data: { name: "Oppdiktet" } },
      answerOp(existing, "unknown_key", "x"),
    ];
    for (const bad of cases) {
      const validForm = uuidv7();
      await expect(
        applyTrialChanges(actor, organizationId, [
          formOp(validForm, { name: "Skal ikke skrives" }),
          bad,
        ]),
        `${bad.op} ${bad.table}`,
      ).rejects.toThrow(InvalidTrialChangeError);
      // Hele bunten avvises: heller ikke den gyldige PUT-en før den ugyldige er skrevet
      expect(await formRow(validForm)).toBeUndefined();
    }
    expect(await countRows()).toEqual({ forms: 1, answers: 0, photos: 0 });
    expect((await formRow(existing))!.deletedAt).toBeNull();
  });

  it("serverstyrte kolonner i nyttelasten overses", async () => {
    const { actor, organizationId } = await setupOrganization();
    const other = await setupOrganization("admin", "Annen organisasjon");
    const serverOwned = {
      organization_id: other.organizationId,
      created_by: "kapret-bruker",
      updated_by: "kapret-bruker",
      row_version: 99,
      uploaded_at: "2026-10-28T12:00:00.000Z",
      sha256: "0".repeat(64),
      storage_path: "/etc/passwd",
    };
    const formId = uuidv7();
    const photoId = uuidv7();

    await applyTrialChanges(actor, organizationId, [
      formOp(formId, serverOwned),
      answerOp(formId, "floors", 2, serverOwned),
      photoOp(formId, "cover_photo", serverOwned, photoId),
    ]);

    const form = await formRow(formId);
    const [answer] = await answerRows(formId);
    const photo = await photoRow(photoId);
    for (const row of [form, answer, photo]) {
      expect(row!.organizationId).toBe(organizationId);
      expect(row!.createdBy).toBe(actor.id);
      expect(row!.updatedBy).toBe(actor.id);
      expect(row!.rowVersion).toBe(1);
    }
    expect(photo!.uploadedAt).toBeNull();
    expect(photo!.sha256).toBeNull();
    expect(photo!.storagePath).toBeNull();
  });

  it("samme bunt to ganger gir samme data og øker ikke row_version", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = uuidv7();
    const photoId = uuidv7();
    const batch = [
      formOp(formId),
      answerOp(formId, "floors", 2),
      answerOp(formId, "roof_tg", "TG2"),
      photoOp(formId, "cover_photo", {}, photoId),
    ];

    await applyTrialChanges(actor, organizationId, batch);
    const first = {
      form: await formRow(formId),
      answers: await answerRows(formId),
      photo: await photoRow(photoId),
    };
    await applyTrialChanges(actor, organizationId, batch);

    expect(await countRows()).toEqual({ forms: 1, answers: 2, photos: 1 });
    const form = await formRow(formId);
    const answers = await answerRows(formId);
    const photo = await photoRow(photoId);
    expect(form!.name).toBe(first.form!.name);
    expect(form!.rowVersion).toBe(1);
    expect(photo!.rowVersion).toBe(1);
    expect(photo!.name).toBe(first.photo!.name);
    for (const answer of answers) {
      const before = first.answers.find((row) => row.id === answer.id);
      expect(before).toBeDefined();
      expect(answer.value).toEqual(before!.value);
      expect(answer.rowVersion).toBe(1);
    }
  });

  it("en faktisk endring øker row_version", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const answerId = uuidv7();

    await applyTrialChanges(actor, organizationId, [answerOp(formId, "floors", 7, {}, answerId)]);
    expect((await answerRows(formId, "floors"))[0]!.rowVersion).toBe(1);

    await applyTrialChanges(actor, organizationId, [answerOp(formId, "floors", 8, {}, answerId)]);
    const [row] = await answerRows(formId, "floors");
    expect(row!.rowVersion).toBe(2);
    expect(row!.value).toBe(8);
  });

  it("PATCH oppdaterer bare feltene som sendes", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = uuidv7();
    const photoId = uuidv7();
    await applyTrialChanges(actor, organizationId, [
      formOp(formId, { name: "Gammelt navn" }),
      photoOp(formId, "roof_photo", { name: "tak.png", size_bytes: 345 }, photoId),
    ]);
    const formBefore = await formRow(formId);

    await applyTrialChanges(actor, organizationId, [
      { op: "PATCH", table: "trial_forms", id: formId, data: { name: "Nytt navn" } },
      { op: "PATCH", table: "trial_photos", id: photoId, data: { name: "tak-2.png" } },
    ]);

    const form = await formRow(formId);
    expect(form!.name).toBe("Nytt navn");
    expect(form!.createdAt).toEqual(formBefore!.createdAt);
    expect(form!.createdBy).toBe(actor.id);
    const photo = await photoRow(photoId);
    expect(photo!.name).toBe("tak-2.png");
    expect(photo!.fieldKey).toBe("roof_photo");
    expect(photo!.sizeBytes).toBe(345);
    expect(photo!.trialFormId).toBe(formId);

    // PATCH på rad som ikke finnes: fullstendige data gir ny rad (upsert)
    const newForm = uuidv7();
    await applyTrialChanges(actor, organizationId, [
      { op: "PATCH", table: "trial_forms", id: newForm, data: { name: "Fra PATCH" } },
    ]);
    expect((await formRow(newForm))!.name).toBe("Fra PATCH");

    // ... ufullstendige data gir feil, ikke en halv rad
    const missing = uuidv7();
    await expect(
      applyTrialChanges(actor, organizationId, [
        { op: "PATCH", table: "trial_photos", id: missing, data: { name: "uten skjema.png" } },
      ]),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(await photoRow(missing)).toBeUndefined();
  });

  it("trial_answers med annen id for samme (trial_form_id, field_key) beholder serverens id", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const serverId = uuidv7();
    const otherDeviceId = uuidv7();

    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "floors", 2, { device_id: "enhet-1" }, serverId),
    ]);
    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "floors", 9, { device_id: "enhet-2" }, otherDeviceId),
    ]);

    const rows = await answerRows(formId, "floors");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(serverId);
    expect(rows[0]!.value).toBe(9);
    expect(rows[0]!.deviceId).toBe("enhet-2");
    const [stray] = await db.select().from(trialAnswers).where(eq(trialAnswers.id, otherDeviceId));
    expect(stray).toBeUndefined();
  });

  it("to enheters text_state for samme felt flettes på serveren og value er den flettede teksten", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const a = applyTextEdit(createTextState(""), "Taket er tett.");
    const b = applyTextEdit(createTextState(""), "Merk: ");
    const merged = textOf(mergeTextStates(a, b));

    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "roof_description", "Taket er tett.", {
        text_state: a,
        device_id: "enhet-1",
      }),
    ]);
    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "roof_description", "bare enhet 2", { text_state: b, device_id: "enhet-2" }),
    ]);

    const rows = await answerRows(formId, "roof_description");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.value).toBe(merged);
    expect(row.value).toContain("Taket er tett.");
    expect(row.value).toContain("Merk: ");
    expect(row.value).not.toContain("bare enhet 2");
    expect(row.textState).toBeTruthy();
    expect(textOf(row.textState!)).toBe(merged);
  });

  it("text_state null på begge sider gir siste endring vinner", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);

    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "roof_description", "Første oppdiktede tekst", { device_id: "enhet-1" }),
    ]);
    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "roof_description", "Andre oppdiktede tekst", { device_id: "enhet-2" }),
    ]);

    const rows = await answerRows(formId, "roof_description");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("Andre oppdiktede tekst");
    expect(rows[0]!.textState).toBeNull();
  });

  it("ugyldig text_state gir InvalidTrialChangeError", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);

    await expect(
      applyTrialChanges(actor, organizationId, [
        answerOp(formId, "roof_description", "Oppdiktet", { text_state: "ikke base64!!" }),
      ]),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(await answerRows(formId)).toHaveLength(0);
  });

  it("siste endring vinner for tg, valg, tall og tabell", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const tableRow = (value: number) => [
      {
        id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c",
        cells: { location: "Oppdiktet sted", value, note: null },
      },
    ];
    const cases: [string, unknown, unknown][] = [
      ["roof_tg", "TG1", "TG3"],
      ["leak_stopper", "yes", "no"],
      ["moisture_floor", 12, 18.5],
      ["drill_measurements", tableRow(12), tableRow(20)],
    ];

    for (const [fieldKey, first] of cases) {
      await applyTrialChanges(actor, organizationId, [
        answerOp(formId, fieldKey, first, { device_id: "enhet-1" }),
      ]);
    }
    for (const [fieldKey, , last] of cases) {
      await applyTrialChanges(actor, organizationId, [
        answerOp(formId, fieldKey, last, { device_id: "enhet-2" }),
      ]);
    }

    for (const [fieldKey, , last] of cases) {
      const rows = await answerRows(formId, fieldKey);
      expect(rows, fieldKey).toHaveLength(1);
      expect(rows[0]!.value, fieldKey).toEqual(last);
      expect(rows[0]!.rowVersion, fieldKey).toBe(2);
    }
  });

  it("bunter over 500 operasjoner og value over 64 kB gir InvalidTrialChangeError", async () => {
    const { actor, organizationId } = await setupOrganization();
    const tooMany = Array.from({ length: 501 }, (_, i) =>
      formOp(uuidv7(), { name: `Skjema ${i}` }),
    );
    await expect(applyTrialChanges(actor, organizationId, tooMany)).rejects.toThrow(
      InvalidTrialChangeError,
    );
    expect(await countRows()).toEqual({ forms: 0, answers: 0, photos: 0 });

    const formId = await putTrialForm(actor, organizationId);
    await expect(
      applyTrialChanges(actor, organizationId, [
        answerOp(formId, "summary", "a".repeat(64 * 1024)),
      ]),
    ).rejects.toThrow(InvalidTrialChangeError);
    await expect(
      applyTrialChanges(actor, organizationId, [
        answerOp(formId, "floors", 2, { device_id: "d".repeat(65) }),
      ]),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(await answerRows(formId)).toHaveLength(0);
  });

  describe("alle fire roller kan skrive, deaktivert ansatt nektes", () => {
    it.each(ALL_ROLES)(
      "alle fire roller kan skrive, deaktivert ansatt nektes (%s)",
      async (role: EmployeeRole) => {
        const owner = await setupOrganization("admin");
        const actor = await createUser({ name: `Oppdiktet ${role}` });
        await createEmployee(actor, owner.organizationId, [role]);
        const formId = uuidv7();

        await expect(
          applyTrialChanges(actor, owner.organizationId, [
            formOp(formId),
            answerOp(formId, "floors", 2),
          ]),
        ).resolves.toEqual({ applied: 2 });
        expect((await formRow(formId))!.organizationId).toBe(owner.organizationId);
      },
    );

    it("alle fire roller kan skrive, deaktivert ansatt nektes (deaktivert)", async () => {
      const owner = await setupOrganization("admin");
      const gone = await createDeactivatedEmployee(owner.organizationId);
      await expect(
        applyTrialChanges(gone, owner.organizationId, [formOp(uuidv7())]),
      ).rejects.toThrow(AccessDeniedError);
      expect(await countRows()).toEqual({ forms: 0, answers: 0, photos: 0 });
    });
  });

  it("logger aldri innholdet i endringene", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    const { actor, organizationId } = await setupOrganization();
    const formId = uuidv7();
    const textState = applyTextEdit(createTextState(""), "HEMMELIG-MARKØR-1234 i tekst");
    try {
      await applyTrialChanges(actor, organizationId, [
        formOp(formId, { name: "HEMMELIG-MARKØR-1234 navn" }),
        answerOp(formId, "summary", "HEMMELIG-MARKØR-1234"),
        answerOp(formId, "roof_description", "HEMMELIG-MARKØR-1234 i tekst", {
          text_state: textState,
        }),
      ]);
      // Også når bunten avvises skal innholdet holdes ute av loggen
      await applyTrialChanges(actor, organizationId, [
        answerOp(formId, "unknown_key", "HEMMELIG-MARKØR-1234"),
      ]).catch(() => undefined);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    for (const line of lines) {
      expect(line).not.toContain("HEMMELIG-MARKØR-1234");
      expect(line).not.toContain(textState);
    }
  });
});

// Funn T-0001: tegn databasen ikke tar, vaskes; en verdi som likevel ikke kan lagres, gir en feil
// som peker på endringen. Testplan docs/agenter/oppgaver/rett-t0001-synkko-testplan.md, 41-49.
describe("applyTrialChanges med tegn og verdier databasen ikke tar", () => {
  const POISON = "Fukt\u0000 i kjeller";

  /** Falsk transaksjon: alle oppslag gir ingen rader, og `insert` feiler med `error`. */
  function failingInsertTransaction(error: Error) {
    const query = { from: () => query, where: () => query, limit: () => Promise.resolve([]) };
    const tx = {
      select: () => query,
      insert: () => ({ values: () => Promise.reject(error) }),
    };
    return vi
      .spyOn(db, "transaction")
      .mockImplementation(((callback: (t: unknown) => Promise<unknown>) => callback(tx)) as never);
  }

  it("nulltegn i Generell beskrivelse først i bunten gir tre lagrede svar uten nulltegn", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const textState = applyTextEdit(createTextState(""), POISON);

    await expect(
      applyTrialChanges(actor, organizationId, [
        answerOp(formId, "general_description", POISON, { text_state: textState }),
        answerOp(formId, "building_year", 1985),
        answerOp(formId, "summary", `Samlet ${POISON}`),
      ]),
    ).resolves.toEqual({ applied: 3 });

    const rows = await answerRows(formId);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(JSON.stringify(row.value)).not.toContain("\\u0000");
    const byKey = Object.fromEntries(rows.map((row) => [row.fieldKey, row]));
    expect(byKey.general_description!.value).toBe("Fukt i kjeller");
    expect(byKey.building_year!.value).toBe(1985);
    expect(byKey.summary!.value).toBe("Samlet Fukt i kjeller");
  });

  it("ensomt surrogat i jsonb-verdi og i navn fjernes", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = uuidv7();
    await applyTrialChanges(actor, organizationId, [
      formOp(formId, { name: "Skjema a\uD800b" }),
      answerOp(formId, "drill_measurements", [{ location: "a\uD800b", value: 3, note: null }]),
    ]);
    expect((await formRow(formId))!.name).toBe("Skjema ab");
    const [row] = await answerRows(formId, "drill_measurements");
    expect(row!.value).toEqual([{ location: "ab", value: 3, note: null }]);
  });

  it("text_state lagres urørt og kan flettes etterpå", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const first = applyTextEdit(createTextState(""), POISON);
    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "general_description", POISON, { text_state: first }),
    ]);
    const [stored] = await answerRows(formId, "general_description");
    expect(stored!.textState).toBe(first);

    const second = applyTextEdit(first, `${POISON} og loft`);
    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "general_description", "", { text_state: second }),
    ]);
    const [merged] = await answerRows(formId, "general_description");
    expect(textOf(merged!.textState!)).toBe(textOf(mergeTextStates(first, second)));
    expect(merged!.value).toBe("Fukt i kjeller og loft");
  });

  it("field_key og id vaskes ikke: nulltegn i dem gir feil, ikke stille lagring", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const answerId = uuidv7();
    const error = await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "floors\u0000", 2, {}, answerId),
    ]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TrialChangeRejectedError);
    expect((error as TrialChangeRejectedError).change).toEqual({
      id: answerId,
      table: "trial_answers",
      field_key: null,
    });

    await expect(
      applyTrialChanges(actor, organizationId, [
        answerOp(formId, "floors", 2, {}, `${answerId}\u0000`),
      ]),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(await answerRows(formId)).toHaveLength(0);
  });

  it("for stor size_bytes gir feil som peker på endringen, og ingen av de gode er lagret", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();
    const before = await countRows();

    const good = [answerOp(formId, "floors", 2), answerOp(formId, "summary", "Tett tak")];
    const error = await applyTrialChanges(actor, organizationId, [
      ...good,
      photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000 }, photoId),
    ]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TrialChangeRejectedError);
    expect((error as TrialChangeRejectedError).change).toEqual({
      id: photoId,
      table: "trial_photos",
      field_key: "cover_photo",
    });
    expect(await countRows()).toEqual(before);

    // Sendt på nytt uten den giftige blir alle lagret
    await expect(applyTrialChanges(actor, organizationId, good)).resolves.toEqual({ applied: 2 });
    expect(await answerRows(formId)).toHaveLength(2);
  });

  it("fremmed organisasjon gir AccessDeniedError også med giftig innhold", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formId = uuidv7();
    await expect(
      applyTrialChanges(b.actor, a.organizationId, [
        formOp(formId, { name: POISON }),
        answerOp(formId, "summary", POISON),
        photoOp(formId, "cover_photo", { size_bytes: 3_000_000_000 }),
      ]),
    ).rejects.toThrow(AccessDeniedError);
    expect(await countRows()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("admin kan synke tekst med nulltegn", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    const formId = uuidv7();
    await expect(
      applyTrialChanges(actor, organizationId, [
        formOp(formId, { name: POISON }),
        answerOp(formId, "summary", POISON),
      ]),
    ).resolves.toEqual({ applied: 2 });
    expect((await formRow(formId))!.name).toBe("Fukt i kjeller");
  });

  it("databasefeil i klasse 22 fra en operasjon pakkes inn, 23505 kastes videre uendret", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = uuidv7();

    const wrapped = new Error("Failed query", {
      cause: Object.assign(new Error("ugyldig verdi"), { code: "22021" }),
    });
    failingInsertTransaction(wrapped);
    const rejected = await applyTrialChanges(actor, organizationId, [formOp(formId)]).catch(
      (caught: unknown) => caught,
    );
    expect(rejected).toBeInstanceOf(TrialChangeRejectedError);
    expect((rejected as TrialChangeRejectedError).change).toEqual({
      id: formId,
      table: "trial_forms",
      field_key: null,
    });
    vi.restoreAllMocks();

    const unique = Object.assign(new Error("duplicate key"), { code: "23505" });
    failingInsertTransaction(unique);
    await expect(applyTrialChanges(actor, organizationId, [formOp(formId)])).rejects.toBe(unique);
  });
});

// --- Funn T-0001: tegn databasen ikke tar, og en endring som ikke kan lagres. Testplan
// docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 2a (test 41–52). Mot testdatabasen.
// Den giftige teksten bygges her. Alle data er oppdiktet.
// Støtter hovedmål: de ansatte (svarene fra iPaden kommer fram selv om ett felt har et usynlig
// tegn) og færre reklamasjoner (rapporten får ikke hull).

const NUL = "\u0000";
const POISON_TEXT = `Fukt${NUL} i kjeller`;
const CLEAN_TEXT = "Fukt i kjeller";
const TOO_BIG = 3_000_000_000;

/** Ingen U+0000 og ingen ensomme surrogater noe sted i verdien (også i jsonb). */
function expectStorable(value: unknown, label = "verdi") {
  const json = JSON.stringify(value) ?? "";
  expect(json, label).not.toContain("\\u0000");
  // JSON.stringify skriver ensomme surrogater som \udxxx; gyldige par skrives som tegnet selv
  expect(json, label).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
  if (typeof value === "string") {
    expect(value.includes(NUL), label).toBe(false);
    expect(value.isWellFormed(), label).toBe(true);
  }
}

/**
 * Endringen feilen peker på: et objekt med `id`, `table` og `field_key` blant feilens egne
 * egenskaper (navnet på egenskapen er ikke låst i kortet). Null når feilen ikke peker på noe.
 */
function changeCarriedBy(error: unknown): Record<string, unknown> | null {
  if (error === null || typeof error !== "object") return null;
  const candidates: unknown[] = [error, ...Object.values(error as Record<string, unknown>)];
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    if ("id" in record && "table" in record && ("field_key" in record || "fieldKey" in record)) {
      return {
        id: record.id,
        table: record.table,
        field_key: "field_key" in record ? record.field_key : record.fieldKey,
      };
    }
  }
  return null;
}

async function capture(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error("kallet skulle gitt feil, men gikk gjennom");
}

async function softDeletedCount(): Promise<number> {
  const rows = [
    ...(await db.select({ d: trialForms.deletedAt }).from(trialForms)),
    ...(await db.select({ d: trialAnswers.deletedAt }).from(trialAnswers)),
    ...(await db.select({ d: trialPhotos.deletedAt }).from(trialPhotos)),
  ];
  return rows.filter((row) => row.d !== null).length;
}

/** Bunten fra funnet: giftig tekst i Generell beskrivelse først, så byggeår og samlet kommentar. */
function poisonBatch(formId: string) {
  const textState = applyTextEdit(createTextState(""), POISON_TEXT);
  return {
    textState,
    operations: [
      answerOp(formId, "general_description", POISON_TEXT, { text_state: textState }),
      answerOp(formId, "building_year", 1985),
      answerOp(formId, "summary", "Oppdiktet samlet kommentar"),
    ],
  };
}

describe("applyTrialChanges: tegn databasen ikke tar (T-0001)", () => {
  it("41 nulltegn i Generell beskrivelse først i bunten gir tre lagrede svar uten nulltegn", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const { operations } = poisonBatch(formId);

    await expect(applyTrialChanges(actor, organizationId, operations)).resolves.toEqual({
      applied: 3,
    });

    const rows = await answerRows(formId);
    expect(rows).toHaveLength(3);
    for (const row of rows) expectStorable(row.value, row.fieldKey);
    const byKey = new Map(rows.map((row) => [row.fieldKey, row.value]));
    expect(byKey.get("general_description")).toBe(CLEAN_TEXT);
    expect(byKey.get("building_year")).toBe(1985);
    expect(byKey.get("summary")).toBe("Oppdiktet samlet kommentar");
  });

  it("42 ensomt surrogat i tekst og i jsonb-verdi fjernes", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const tableValue = [
      {
        id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c",
        cells: { location: "Kjeller\uD800 nord", value: 12, note: `Merk${NUL}` },
      },
    ];

    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "roof_description", "a\uD800b"),
      answerOp(formId, "drill_measurements", tableValue),
    ]);

    const [roof] = await answerRows(formId, "roof_description");
    expect(roof!.value).toBe("ab");
    const [drill] = await answerRows(formId, "drill_measurements");
    expectStorable(drill!.value, "drill_measurements");
    expect(drill!.value).toEqual([
      {
        id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c",
        cells: { location: "Kjeller nord", value: 12, note: "Merk" },
      },
    ]);
  });

  it("43 text_state lagres urørt og kan flettes etterpå", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const { textState, operations } = poisonBatch(formId);
    await applyTrialChanges(actor, organizationId, operations);

    const [stored] = await answerRows(formId, "general_description");
    expect(stored!.textState).toBe(textState);

    // En annen enhet skriver videre på samme tilstand
    const next = applyTextEdit(textState, `${POISON_TEXT}, tørr nå`);
    const merged = mergeTextStates(stored!.textState!, next);
    expect(textOf(merged)).toBe(`${POISON_TEXT}, tørr nå`);

    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "general_description", `${POISON_TEXT}, tørr nå`, {
        text_state: next,
        device_id: "enhet-2",
      }),
    ]);
    const rows = await answerRows(formId, "general_description");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(`${CLEAN_TEXT}, tørr nå`);
    expectStorable(rows[0]!.value);
    expect(textOf(rows[0]!.textState!)).toBe(`${POISON_TEXT}, tørr nå`);
  });

  it("44 id, trial_form_id, field_key og text_state vaskes ikke", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);

    // field_key med nulltegn: ukjent felt, ikke stille vasket til «summary»
    await expect(
      applyTrialChanges(actor, organizationId, [answerOp(formId, `summary${NUL}`, "Oppdiktet")]),
    ).rejects.toThrow(InvalidTrialChangeError);
    // id med nulltegn
    await expect(
      applyTrialChanges(actor, organizationId, [
        answerOp(formId, "summary", "Oppdiktet", {}, `${uuidv7()}${NUL}`),
      ]),
    ).rejects.toThrow(InvalidTrialChangeError);
    // trial_form_id med nulltegn
    await expect(
      applyTrialChanges(actor, organizationId, [
        answerOp(formId, "summary", "Oppdiktet", { trial_form_id: `${formId}${NUL}` }),
      ]),
    ).rejects.toThrow(InvalidTrialChangeError);
    // Bilde med field_key med nulltegn
    await expect(
      applyTrialChanges(actor, organizationId, [photoOp(formId, `cover_photo${NUL}`)]),
    ).rejects.toThrow(InvalidTrialChangeError);

    expect(await answerRows(formId)).toHaveLength(0);
    expect(await countRows(organizationId)).toEqual({ forms: 1, answers: 0, photos: 0 });
  });

  it("45 verdi databasen ikke tar gir feil som peker på endringen", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();

    const error = await capture(() =>
      applyTrialChanges(actor, organizationId, [
        photoOp(formId, "cover_photo", { size_bytes: TOO_BIG }, photoId),
      ]),
    );

    expect(changeCarriedBy(error)).toEqual({
      id: photoId,
      table: "trial_photos",
      field_key: "cover_photo",
    });
    // Feilen bærer ikke verdien eller teksten fra bunten i meldingen
    expect(String((error as Error).message)).not.toContain(String(TOO_BIG));
  });

  it("46 én transaksjon: etter feil er ingen av de gode endringene lagret", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const before = await countRows(organizationId);

    await capture(() =>
      applyTrialChanges(actor, organizationId, [
        answerOp(formId, "building_year", 1985),
        answerOp(formId, "summary", "Oppdiktet samlet kommentar"),
        photoOp(formId, "cover_photo", { size_bytes: TOO_BIG }),
      ]),
    );

    expect(await countRows(organizationId)).toEqual(before);
    expect(await answerRows(formId)).toHaveLength(0);
  });

  it("47 sendt på nytt uten den giftige blir alle lagret", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const good = [
      answerOp(formId, "building_year", 1985),
      answerOp(formId, "summary", "Oppdiktet samlet kommentar"),
    ];
    await capture(() =>
      applyTrialChanges(actor, organizationId, [
        ...good,
        photoOp(formId, "cover_photo", { size_bytes: TOO_BIG }),
      ]),
    );

    await expect(applyTrialChanges(actor, organizationId, good)).resolves.toEqual({ applied: 2 });
    expect(await answerRows(formId)).toHaveLength(2);
  });

  it("48 fremmed organisasjon gir AccessDeniedError også med giftig innhold", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formId = uuidv7();

    await expect(
      applyTrialChanges(b.actor, a.organizationId, [
        formOp(formId, { name: `Skjema${NUL}` }),
        answerOp(formId, "general_description", POISON_TEXT),
        answerOp(formId, `ukjent${NUL}`, POISON_TEXT),
        photoOp(formId, "cover_photo", { size_bytes: TOO_BIG }),
      ]),
    ).rejects.toThrow(AccessDeniedError);
    // Også med en bunt som ikke en gang er en liste
    await expect(
      applyTrialChanges(
        b.actor,
        a.organizationId,
        POISON_TEXT as unknown as TrialChangeOperation[],
      ),
    ).rejects.toThrow(AccessDeniedError);
    expect(await countRows()).toEqual({ forms: 0, answers: 0, photos: 0 });
  });

  it("49 admin kan synke tekst med nulltegn", async () => {
    const { actor, organizationId } = await setupOrganization("admin");
    const formId = await putTrialForm(actor, organizationId);
    const { operations } = poisonBatch(formId);

    await expect(applyTrialChanges(actor, organizationId, operations)).resolves.toEqual({
      applied: 3,
    });
    const [row] = await answerRows(formId, "general_description");
    expect(row!.value).toBe(CLEAN_TEXT);
  });

  it.each(ALL_ROLES)("50 alle fire roller kan skrive vasket tekst (%s)", async (role) => {
    const owner = await setupOrganization("admin");
    const actor = await createUser({ name: `Oppdiktet ${role}` });
    await createEmployee(actor, owner.organizationId, [role]);
    const formId = uuidv7();

    await expect(
      applyTrialChanges(actor, owner.organizationId, [
        formOp(formId),
        answerOp(formId, "summary", `${role}${NUL} skrev dette`),
      ]),
    ).resolves.toEqual({ applied: 2 });
    const [row] = await answerRows(formId, "summary");
    expect(row!.value).toBe(`${role} skrev dette`);
  });

  it("51 logger aldri innholdet, heller ikke ved 400", async () => {
    const MARKER = "GIFTIG-MARKØR-5150";
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(
        args
          .map((arg) =>
            typeof arg === "string"
              ? arg
              : JSON.stringify(arg, (_k, v: unknown) =>
                  v instanceof Error
                    ? { message: v.message, stack: v.stack, cause: String(v.cause) }
                    : v,
                ),
          )
          .join(" "),
      );
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    const { actor, organizationId } = await setupOrganization();
    const formId = uuidv7();
    try {
      await applyTrialChanges(actor, organizationId, [
        formOp(formId),
        answerOp(formId, "general_description", `${MARKER}${NUL} tekst`),
      ]);
      // Avvist bunt (400): verken den giftige verdien eller resten av bunten i loggen
      await applyTrialChanges(actor, organizationId, [
        answerOp(formId, "summary", `${MARKER} resten av bunten`),
        photoOp(formId, "cover_photo", { size_bytes: TOO_BIG, name: `${MARKER}.png` }),
      ]).catch(() => undefined);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    for (const line of lines) {
      expect(line).not.toContain(MARKER);
      expect(line).not.toContain(String(TOO_BIG));
    }
  });

  it("52 myk sletting: ingenting slettes", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    await applyTrialChanges(actor, organizationId, poisonBatch(formId).operations);
    const before = await countRows();

    await capture(() =>
      applyTrialChanges(actor, organizationId, [
        answerOp(formId, "summary", "Oppdiktet ny kommentar"),
        photoOp(formId, "cover_photo", { size_bytes: TOO_BIG }),
      ]),
    );
    await applyTrialChanges(actor, organizationId, [
      answerOp(formId, "summary", `Oppdiktet ny kommentar${NUL}`),
      answerOp(formId, "floors", 2),
    ]);

    const after = await countRows();
    expect(after.forms).toBeGreaterThanOrEqual(before.forms);
    expect(after.answers).toBeGreaterThanOrEqual(before.answers);
    expect(after.photos).toBeGreaterThanOrEqual(before.photos);
    expect(after.answers).toBe(before.answers + 1);
    expect(await softDeletedCount()).toBe(0);
  });
});
