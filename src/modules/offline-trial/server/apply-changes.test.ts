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
import { InvalidTrialChangeError, TrialIdConflictError } from "./errors";
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
