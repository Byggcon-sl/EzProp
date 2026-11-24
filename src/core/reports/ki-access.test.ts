import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AccessDeniedError, effectivePermissions, type Actor } from "@/core/access";
import {
  applyPhrase,
  draftSummary,
  getReportSummary,
  polishDescription,
  polishDeviation,
  saveField,
  saveSummary,
  suggestPhrases,
} from "@/core/reports";
import { db } from "@/db/client";
import { employees, type EmployeeRole } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { aiRowCount, captureError } from "../../../tests/ai";
import { createUser, grantPermission, resetDatabase } from "../../../tests/factories";
import { addPlaceDeviation, kiBathroom, PLACE } from "../../../tests/report-ki-fixtures";
import { CP, createStaff, setInspectorsEditAll } from "../../../tests/report-fixtures";

/*
 * Tilgang per rolle for «KI i veien» (docs/funksjoner/fase2a-ki-i-veien-testplan.md 5a,
 * K5.1–K5.6). Alt går gjennom `requireOrganizationAccess` i `src/core/access`: KI åpner aldri mer
 * enn vanlig redigering. Admin stenges aldri ute (regel 11). Oppdiktede data.
 */

beforeEach(resetDatabase);

type Prepared = Awaited<ReturnType<typeof prepare>>;

/** Bad med KI på, et avvik med tiltak, en beskrivelse og et forslag fra admin. */
async function prepare() {
  const f = await kiBathroom({ roles: ["admin"] });
  const deviationId = await addPlaceDeviation(f, PLACE.membraneTg2);
  await saveField(f.actor, f.organizationId, f.room, {
    table: "checkpoint_results",
    checkpointKey: CP.membrane,
    field: "description_text",
    value: "mxq beskrivelse",
    base: null,
  });
  const suggestion = await suggestPhrases(f.actor, f.organizationId, f.room, {
    requestId: uuidv7(),
    deviationId,
    field: "new_measure",
    text: "",
  });
  if (suggestion.status !== "ranked") throw new Error(`fikk ${suggestion.status}`);
  return { ...f, deviationId, adminSuggestion: suggestion };
}

/** Handlingene som krever `report.edit`. Hver gir et svar når tilgangen er der. */
const ACTIONS: [string, (actor: Actor, p: Prepared) => Promise<unknown>][] = [
  [
    "be om fraseforslag",
    (actor, p) =>
      suggestPhrases(actor, p.organizationId, p.room, {
        requestId: uuidv7(),
        deviationId: p.deviationId,
        field: "cause_text",
        text: "",
      }),
  ],
  [
    "bruke et fraseforslag (beslutning)",
    async (actor, p) => {
      const own = await suggestPhrases(actor, p.organizationId, p.room, {
        requestId: uuidv7(),
        deviationId: p.deviationId,
        field: "new_measure",
        text: "",
      }).catch(() => null);
      const suggestion = own?.status === "ranked" ? own : p.adminSuggestion;
      const candidate = suggestion.candidates[0];
      if (!candidate) throw new Error("mangler kandidat");
      return applyPhrase(actor, p.organizationId, p.room, {
        usageId: suggestion.usageId,
        candidate: candidate.ref,
        base: null,
        measureId: uuidv7(),
      });
    },
  ],
  [
    "språkvask avviket",
    (actor, p) =>
      polishDeviation(actor, p.organizationId, p.room, {
        deviationId: p.deviationId,
        items: [
          {
            requestId: uuidv7(),
            target: { type: "deviation", id: p.deviationId, fieldKey: "cause_text" },
            text: "mxq årsak",
          },
        ],
      }),
  ],
  [
    "språkvask beskrivelsen",
    (actor, p) =>
      polishDescription(actor, p.organizationId, p.room, {
        requestId: uuidv7(),
        checkpointKey: CP.membrane,
        text: "mxq beskrivelse",
      }),
  ],
  [
    "utkast til sammendrag",
    (actor, p) => draftSummary(actor, p.organizationId, p.assignmentId, { requestId: uuidv7() }),
  ],
  [
    "lagre sammendraget",
    async (actor, p) => {
      const current = await getReportSummary(actor, p.organizationId, p.assignmentId);
      return saveSummary(actor, p.organizationId, p.assignmentId, {
        text: "Mxq sammendrag",
        baseRowVersion: current?.rowVersion ?? 1,
      });
    },
  ],
];

type Case = {
  name: string;
  role: EmployeeRole;
  editAll: boolean;
  single: boolean;
  allowed: boolean;
};

const CASES: Case[] = [
  // Alle takstmenn kan endre alt (`access.inspectors_edit_all`), også utenfor teamet (K5.1)
  {
    name: "takstmann, alle kan endre",
    role: "inspector",
    editAll: true,
    single: false,
    allowed: true,
  },
  // Med innstillingen av: samme svar som `saveField` gir i dag (KI åpner ikke mer)
  {
    name: "takstmann, innstillingen av",
    role: "inspector",
    editAll: false,
    single: false,
    allowed: false,
  },
  {
    name: "takstmann med enkeltrettighet",
    role: "inspector",
    editAll: false,
    single: true,
    allowed: true,
  },
  { name: "kontor", role: "office", editAll: true, single: false, allowed: false },
  { name: "leder med report.edit", role: "manager", editAll: false, single: false, allowed: true },
  { name: "admin uten andre roller", role: "admin", editAll: false, single: false, allowed: true },
];

describe("5a tilgang per rolle", () => {
  const matrix = CASES.flatMap((c) => ACTIONS.map(([action, run]) => ({ ...c, action, run })));

  it.each(matrix)(
    "K5.1–K5.4 $name: $action (lov: $allowed)",
    async ({ role, editAll, single, allowed, run }) => {
      const p = await prepare();
      await setInspectorsEditAll(p.organizationId, editAll);
      const { actor, employee } = await createStaff(p.organizationId, [role]);
      if (single) await grantPermission(employee, "report.edit");
      const rowsBefore = await aiRowCount();
      if (allowed) {
        await expect(run(actor, p)).resolves.toBeDefined();
      } else {
        await expect(run(actor, p)).rejects.toBeInstanceOf(AccessDeniedError);
        expect(await aiRowCount()).toBe(rowsBefore);
      }
      // Alle i organisasjonen kan lese sammendraget; knappene følger `report.edit`
      const summary = await getReportSummary(actor, p.organizationId, p.assignmentId);
      expect(summary?.canEdit).toBe(allowed);
    },
  );
});

describe("5a nei", () => {
  it("K5.5 uten ansatt-rad, deaktivert og i en annen organisasjon: likt avslag og ingen rad", async () => {
    const p = await prepare();
    const noEmployee = await createUser({ name: "Uten ansatt" });
    const deactivated = await createStaff(p.organizationId, ["inspector"], "Sluttet Testesen");
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, deactivated.employee.id));
    const elsewhere = await kiBathroom();
    const rowsBefore = await aiRowCount();
    for (const actor of [noEmployee, deactivated.actor, elsewhere.actor]) {
      for (const [, run] of ACTIONS) {
        const error = await captureError(() => run(actor, p));
        expect(error).toBeInstanceOf(AccessDeniedError);
      }
      const read = await captureError(() =>
        getReportSummary(actor, p.organizationId, p.assignmentId),
      );
      expect(read).toBeInstanceOf(AccessDeniedError);
    }
    expect(await aiRowCount()).toBe(rowsBefore);
  });

  it("K5.4 statisk: report.edit er blant admins rettigheter, også med innstillingen av", () => {
    for (const inspectorsEditAll of [true, false]) {
      expect(effectivePermissions(["admin"], [], { inspectorsEditAll })).toContain("report.edit");
    }
  });
});
