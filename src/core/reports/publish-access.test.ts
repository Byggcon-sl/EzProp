import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AccessDeniedError,
  canSeeOverrideReasons,
  permissions,
  requireOrganizationAccess,
  type Actor,
} from "@/core/access";
import {
  getPublishCheck,
  isReportPublishedForAssignment,
  listPendingAiSuggestions,
  listReleases,
  publishReport,
  ReportValidationError,
  startNewVersion,
  type PublishCheckView,
} from "@/core/reports";
import { db } from "@/db/client";
import { assignments, checkpointResults, employees, type EmployeeRole } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAiUsageLog,
  createCertification,
  createOrganization,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import {
  addTg3WithoutCost,
  createPublishableBathroom,
  LONG_VALID_TO,
  releasesOf,
  reportStatus,
  writeCounts,
  type PublishableBathroom,
} from "../../../tests/publish-fixtures";
import { createStaff, setInspectorsEditAll } from "../../../tests/report-fixtures";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Tilgang per rolle og tenant-isolasjon for publiseringen
 * (docs/funksjoner/fase2a-publisering-badet-testplan.md avsnitt 5; kortets I7, I8 og I16). Krav for
 * godkjenning: rollematrisen, admin stenges aldri ute, `expectTenantIsolation` for alle seks
 * oppslag, og id fra skjemaet styrer aldri organisasjonen. Alle data er oppdiktede.
 *
 * Hovedmål: færre reklamasjoner (bare en ansatt med gyldig sertifisering kan publisere, og
 * overstyringer kan vises ved en reklamasjon), de ansatte (admin stenges aldri ute, kontor ser
 * sjekken) og KI i bunnen (KI publiserer aldri; publisering krever en ansatt).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const REASON_TEXT = "Oppdiktet begrunnelse for rollematrisen";

type DraftView = Extract<PublishCheckView, { state: "draft" }>;

async function draftOf(actor: Actor, f: PublishableBathroom): Promise<DraftView> {
  const view = await getPublishCheck(actor, f.organizationId, f.assignmentId);
  if (view.state !== "draft") throw new Error(`forventet draft, fikk ${view.state}`);
  return view;
}

async function publishAs(actor: Actor, f: PublishableBathroom) {
  const view = await draftOf(actor, f);
  return publishReport(actor, f.organizationId, {
    assignmentId: f.assignmentId,
    fingerprint: view.fingerprint,
    overrides: view.findings
      .filter((x) => x.severity === "blocker")
      .map((x) => ({ findingKey: x.key, reasonCode: "other" as const, text: REASON_TEXT })),
  });
}

async function outcome<T>(
  action: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Avvist med tilgangsfeil eller valideringsfeil (for eksempel manglende sertifisering). */
function expectDenied(result: { ok: boolean; error?: unknown }) {
  expect(result.ok).toBe(false);
  const error = (result as { error: unknown }).error;
  expect(
    error instanceof AccessDeniedError || error instanceof ReportValidationError,
    String(error),
  ).toBe(true);
}

type Cert = "valid" | "none" | "expired";

type RoleCase = {
  name: string;
  roles: EmployeeRole[];
  certification: Cert;
  extraPermission?: "report.publish";
  canPublish: boolean;
  canStartNewVersion: boolean;
  seesReasonText: boolean;
};

const ROLE_CASES: RoleCase[] = [
  {
    name: "takstmann med gyldig sertifisering",
    roles: ["inspector"],
    certification: "valid",
    canPublish: true,
    canStartNewVersion: true,
    seesReasonText: true,
  },
  {
    name: "takstmann uten sertifisering",
    roles: ["inspector"],
    certification: "none",
    canPublish: false,
    canStartNewVersion: true,
    seesReasonText: true,
  },
  {
    name: "takstmann med utløpt sertifisering",
    roles: ["inspector"],
    certification: "expired",
    canPublish: false,
    canStartNewVersion: true,
    seesReasonText: true,
  },
  {
    name: "kontor (med sertifisering)",
    roles: ["office"],
    certification: "valid",
    canPublish: false,
    canStartNewVersion: false,
    seesReasonText: false,
  },
  {
    name: "leder med gyldig sertifisering",
    roles: ["manager"],
    certification: "valid",
    canPublish: true,
    canStartNewVersion: true,
    seesReasonText: true,
  },
  {
    name: "admin med gyldig sertifisering",
    roles: ["admin"],
    certification: "valid",
    canPublish: true,
    canStartNewVersion: true,
    seesReasonText: true,
  },
  {
    name: "admin uten sertifisering",
    roles: ["admin"],
    certification: "none",
    canPublish: false,
    canStartNewVersion: true,
    seesReasonText: true,
  },
  {
    name: "kontor med enkeltrettighet report.publish uten sertifisering",
    roles: ["office"],
    certification: "none",
    extraPermission: "report.publish",
    canPublish: false,
    canStartNewVersion: false,
    seesReasonText: false,
  },
  {
    name: "kontor med enkeltrettighet report.publish og sertifisering",
    roles: ["office"],
    certification: "valid",
    extraPermission: "report.publish",
    canPublish: true,
    canStartNewVersion: false,
    seesReasonText: false,
  },
];

async function staffWith(organizationId: string, c: RoleCase) {
  const { actor, employee } = await createStaff(organizationId, c.roles, `Test ${c.name}`);
  if (c.certification === "valid") {
    await createCertification(
      { id: employee.id, organizationId },
      { validFrom: null, validTo: LONG_VALID_TO },
    );
  } else if (c.certification === "expired") {
    await createCertification(
      { id: employee.id, organizationId },
      { validFrom: "2020-01-01", validTo: "2021-01-01" },
    );
  }
  if (c.extraPermission)
    await grantPermission({ id: employee.id, organizationId }, c.extraPermission);
  return { actor, employee };
}

describe("5.1 (I7) rollematrisen", () => {
  it.each(ROLE_CASES)("$name", async (c) => {
    // Eieren av badet er en sertifisert takstmann; badet har én sperre (TG3 uten kostnad)
    const owner = await createPublishableBathroom();
    await addTg3WithoutCost(owner);
    const { actor } = await staffWith(owner.organizationId, c);

    // Se sjekken: alle kan
    const view = await draftOf(actor, owner);
    expect(view.findings.some((x) => x.checkCode === "tg3_missing_cost")).toBe(true);
    expect(view.ability.allowed).toBe(c.canPublish);

    // Publisere og krysse bort
    const before = await writeCounts(owner.organizationId);
    const published = await outcome(() => publishAs(actor, owner));
    if (c.canPublish) {
      expect(published.ok).toBe(true);
      expect(published.ok && published.value.status).toBe("published");
    } else {
      expectDenied(published);
      expect(await writeCounts(owner.organizationId)).toEqual(before);
      expect(await reportStatus(owner.organizationId, owner.reportId)).toBe("draft");
      // Eieren publiserer, så resten av matrisen kan prøves
      const byOwner = await publishAs(owner.actor, owner);
      expect(byOwner.status).toBe("published");
    }

    // Se utgivelsene, med eller uten begrunnelsestekst
    const releases = await listReleases(actor, owner.organizationId, owner.assignmentId);
    expect(releases).toHaveLength(1);
    const overrides = releases[0]!.overrides;
    expect(overrides.length).toBeGreaterThan(0);
    for (const o of overrides) {
      expect(o.reasonCode).toBe("other");
      expect(o.reason).toBe(c.seesReasonText ? REASON_TEXT : null);
    }
    if (!c.seesReasonText) expect(JSON.stringify(releases)).not.toContain(REASON_TEXT);

    // Lage ny versjon
    const newVersion = await outcome(() =>
      startNewVersion(actor, owner.organizationId, owner.assignmentId),
    );
    if (c.canStartNewVersion) {
      expect(newVersion.ok).toBe(true);
      expect(await reportStatus(owner.organizationId, owner.reportId)).toBe("draft");
    } else {
      expectDenied(newVersion);
      expect(await reportStatus(owner.organizationId, owner.reportId)).toBe("published");
      await startNewVersion(owner.actor, owner.organizationId, owner.assignmentId);
    }

    // Forrige overstyring på sjekken: tekst bare for den som får se den
    const again = await draftOf(actor, owner);
    const previous = again.findings.find(
      (x) => x.checkCode === "tg3_missing_cost",
    )!.previousOverride;
    expect(previous).toMatchObject({ versionNumber: 1, reasonCode: "other" });
    expect(previous!.reason).toBe(c.seesReasonText ? REASON_TEXT : null);
    if (!c.seesReasonText) expect(JSON.stringify(again)).not.toContain(REASON_TEXT);
  });

  it("kontor kan ikke bruke «Rett nå» (canEdit er usann); takstmann kan", async () => {
    const owner = await createPublishableBathroom();
    const office = await staffWith(owner.organizationId, ROLE_CASES[3]!);
    expect((await draftOf(office.actor, owner)).canEdit).toBe(false);
    expect((await draftOf(owner.actor, owner)).canEdit).toBe(true);
  });

  it("utløpt sertifisering gir grunnen og datoen i ability", async () => {
    const owner = await createPublishableBathroom();
    const { actor } = await staffWith(owner.organizationId, ROLE_CASES[2]!);
    const view = await draftOf(actor, owner);
    expect(view.ability).toEqual({
      allowed: false,
      reason: "no_valid_certification",
      expiredOn: "2021-01-01",
    });
    const office = await staffWith(owner.organizationId, ROLE_CASES[3]!);
    expect((await draftOf(office.actor, owner)).ability).toEqual({
      allowed: false,
      reason: "missing_permission",
    });
  });

  it("access.inspectors_edit_all av: takstmann kan ikke lage ny versjon; admin kan fortsatt", async () => {
    const owner = await createPublishableBathroom();
    expect((await publishAs(owner.actor, owner)).status).toBe("published");
    await setInspectorsEditAll(owner.organizationId, false);
    expectDenied(
      await outcome(() => startNewVersion(owner.actor, owner.organizationId, owner.assignmentId)),
    );
    expect(await reportStatus(owner.organizationId, owner.reportId)).toBe("published");
    const admin = await staffWith(owner.organizationId, ROLE_CASES[6]!);
    await startNewVersion(admin.actor, owner.organizationId, owner.assignmentId);
    expect(await reportStatus(owner.organizationId, owner.reportId)).toBe("draft");
  });
});

describe("5.2 admin stenges aldri ute (regel 11)", () => {
  it("admin uten andre roller og uten sertifisering ser sjekk og utgivelser og lager ny versjon, også når alle takstmenn er sperret", async () => {
    const owner = await createPublishableBathroom();
    await addTg3WithoutCost(owner);
    expect((await publishAs(owner.actor, owner)).status).toBe("published");
    // Takstmannen er deaktivert
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, owner.employeeId));
    const admin = await staffWith(owner.organizationId, ROLE_CASES[6]!);

    const view = await getPublishCheck(admin.actor, owner.organizationId, owner.assignmentId);
    expect(view.state).toBe("published");
    const releases = await listReleases(admin.actor, owner.organizationId, owner.assignmentId);
    expect(releases[0]!.overrides.every((o) => o.reason === REASON_TEXT)).toBe(true);
    expect(releases[0]!.releasedByName.length).toBeGreaterThan(0);
    await startNewVersion(admin.actor, owner.organizationId, owner.assignmentId);
    const draft = await draftOf(admin.actor, owner);
    expect(draft.ability).toMatchObject({ allowed: false });
    expect(draft.findings.length).toBeGreaterThan(0);
  });
});

describe("5.3 (I16) canSeeOverrideReasons", () => {
  it.each([
    { roles: ["inspector"] as EmployeeRole[], expected: true },
    { roles: ["manager"] as EmployeeRole[], expected: true },
    { roles: ["admin"] as EmployeeRole[], expected: true },
    { roles: ["office"] as EmployeeRole[], expected: false },
    { roles: ["office", "admin"] as EmployeeRole[], expected: true },
  ])("$roles → $expected", async ({ roles, expected }) => {
    const org = await createOrganization();
    const { actor } = await createStaff(org.id, roles);
    const grant = await requireOrganizationAccess(actor, org.id);
    expect(canSeeOverrideReasons(grant)).toBe(expected);
  });
});

describe("5.4 (I8) expectTenantIsolation per oppslag", () => {
  /** Ett publiserbart bad med én sperre per organisasjon, laget av admin i hver. */
  async function seedBoth(
    grantA: { organizationId: string; employeeId: string },
    grantB: { organizationId: string; employeeId: string },
  ) {
    // Admin i hver organisasjon (fra expectTenantIsolation) får gyldig sertifisering (A29)
    for (const grant of [grantA, grantB]) {
      await createCertification(
        { id: grant.employeeId, organizationId: grant.organizationId },
        { validFrom: null, validTo: LONG_VALID_TO },
      );
    }
    const a = await createPublishableBathroom({ organizationId: grantA.organizationId });
    const b = await createPublishableBathroom({ organizationId: grantB.organizationId });
    await addTg3WithoutCost(a);
    await addTg3WithoutCost(b);
    const byOrg = new Map([
      [a.organizationId, a],
      [b.organizationId, b],
    ]);
    return { a, b, of: (organizationId: string) => byOrg.get(organizationId)! };
  }

  it("getPublishCheck", async () => {
    let of: (id: string) => PublishableBathroom = () => {
      throw new Error("ikke sådd");
    };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const s = await seedBoth(grantA, grantB);
        of = s.of;
        return { a: [s.a.reportId], b: [s.b.reportId] };
      },
      query: async (actor, organizationId) => {
        const view = await getPublishCheck(actor, organizationId, of(organizationId).assignmentId);
        return view.state === "not_started" ? [] : [{ id: view.reportId }];
      },
      idOf: (row) => row.id,
    });
  });

  it("publishReport", async () => {
    let of: (id: string) => PublishableBathroom = () => {
      throw new Error("ikke sådd");
    };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const s = await seedBoth(grantA, grantB);
        of = s.of;
        return { a: [s.a.reportId], b: [s.b.reportId] };
      },
      query: async (actor, organizationId) => {
        const f = of(organizationId);
        const result = await publishAs(actor, f);
        if (result.status !== "published") return [];
        const releases = await releasesOf(organizationId, f.reportId);
        return releases.map((r) => ({ id: r.reportId }));
      },
      idOf: (row) => row.id,
    });
  });

  it("startNewVersion", async () => {
    let of: (id: string) => PublishableBathroom = () => {
      throw new Error("ikke sådd");
    };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const s = await seedBoth(grantA, grantB);
        of = s.of;
        await publishAs(s.a.actor, s.a);
        await publishAs(s.b.actor, s.b);
        return { a: [s.a.reportId], b: [s.b.reportId] };
      },
      query: async (actor, organizationId) => {
        const result = await startNewVersion(
          actor,
          organizationId,
          of(organizationId).assignmentId,
        );
        return [{ id: result.reportId }];
      },
      idOf: (row) => row.id,
    });
  });

  it("listReleases", async () => {
    let of: (id: string) => PublishableBathroom = () => {
      throw new Error("ikke sådd");
    };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const s = await seedBoth(grantA, grantB);
        of = s.of;
        await publishAs(s.a.actor, s.a);
        await publishAs(s.b.actor, s.b);
        const [ra] = await releasesOf(s.a.organizationId, s.a.reportId);
        const [rb] = await releasesOf(s.b.organizationId, s.b.reportId);
        return { a: [ra!.id], b: [rb!.id] };
      },
      query: (actor, organizationId) =>
        listReleases(actor, organizationId, of(organizationId).assignmentId),
      idOf: (row) => row.id,
    });
  });

  it("listPendingAiSuggestions", async () => {
    let of: (id: string) => PublishableBathroom = () => {
      throw new Error("ikke sådd");
    };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const s = await seedBoth(grantA, grantB);
        of = s.of;
        const ai = async (f: PublishableBathroom) => {
          const [result] = await db
            .select({ id: checkpointResults.id })
            .from(checkpointResults)
            .where(eq(checkpointResults.reportId, f.reportId))
            .limit(1);
          return (
            await createAiUsageLog(f.organizationId, {
              employeeId: f.employeeId,
              assignmentId: f.assignmentId,
              reportId: f.reportId,
              targetRef: {
                type: "checkpoint_result",
                id: result!.id,
                fieldKey: "description_text",
              },
            })
          ).id;
        };
        return { a: [await ai(s.a)], b: [await ai(s.b)] };
      },
      query: (actor, organizationId) =>
        listPendingAiSuggestions(actor, organizationId, of(organizationId).assignmentId),
      idOf: (row) => row.aiUsageId,
    });
  });

  it("isReportPublishedForAssignment", async () => {
    let of: (id: string) => PublishableBathroom = () => {
      throw new Error("ikke sådd");
    };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const s = await seedBoth(grantA, grantB);
        of = s.of;
        await publishAs(s.a.actor, s.a);
        await publishAs(s.b.actor, s.b);
        return { a: [s.a.reportId], b: [s.b.reportId] };
      },
      query: async (actor, organizationId) => {
        // Kalles bak en tilgangssjekk, med grant.organizationId
        const grant = await requireOrganizationAccess(actor, organizationId);
        const f = of(grant.organizationId);
        return (await isReportPublishedForAssignment(db, grant.organizationId, f.assignmentId))
          ? [{ id: f.reportId }]
          : [];
      },
      idOf: (row) => row.id,
    });
  });

  it("isReportPublishedForAssignment: sann bare for publisert, usann for draft, uten rapport og med annen organisasjons id", async () => {
    const a = await createPublishableBathroom();
    const b = await createPublishableBathroom();
    expect(await isReportPublishedForAssignment(db, a.organizationId, a.assignmentId)).toBe(false);
    await publishAs(a.actor, a);
    await publishAs(b.actor, b);
    expect(await isReportPublishedForAssignment(db, a.organizationId, a.assignmentId)).toBe(true);
    // Oppdraget i B sett fra organisasjon A
    expect(await isReportPublishedForAssignment(db, a.organizationId, b.assignmentId)).toBe(false);
    expect(await isReportPublishedForAssignment(db, a.organizationId, uuidv7())).toBe(false);
    await startNewVersion(a.actor, a.organizationId, a.assignmentId);
    expect(await isReportPublishedForAssignment(db, a.organizationId, a.assignmentId)).toBe(false);
  });
});

describe("5.5 id fra skjemaet styrer aldri organisasjonen", () => {
  it("bruker i B med A sitt oppdrag får AccessDeniedError, og ingenting endres i A", async () => {
    const a = await createPublishableBathroom();
    await addTg3WithoutCost(a);
    const b = await createPublishableBathroom();
    const viewA = await draftOf(a.actor, a);
    const before = await writeCounts(a.organizationId);
    const overrides = viewA.findings
      .filter((x) => x.severity === "blocker")
      .map((x) => ({ findingKey: x.key, reasonCode: "described_elsewhere" as const }));

    const calls: [string, () => Promise<unknown>][] = [
      ["getPublishCheck", () => getPublishCheck(b.actor, b.organizationId, a.assignmentId)],
      [
        "publishReport",
        () =>
          publishReport(b.actor, b.organizationId, {
            assignmentId: a.assignmentId,
            fingerprint: viewA.fingerprint,
            overrides,
          }),
      ],
      ["startNewVersion", () => startNewVersion(b.actor, b.organizationId, a.assignmentId)],
      ["listReleases", () => listReleases(b.actor, b.organizationId, a.assignmentId)],
      [
        "listPendingAiSuggestions",
        () => listPendingAiSuggestions(b.actor, b.organizationId, a.assignmentId),
      ],
      // Bs bruker mot organisasjon A
      ["getPublishCheck mot A", () => getPublishCheck(b.actor, a.organizationId, a.assignmentId)],
      [
        "publishReport mot A",
        () =>
          publishReport(b.actor, a.organizationId, {
            assignmentId: a.assignmentId,
            fingerprint: viewA.fingerprint,
            overrides,
          }),
      ],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toBeInstanceOf(AccessDeniedError);
    }
    expect(await writeCounts(a.organizationId)).toEqual(before);
    expect(await reportStatus(a.organizationId, a.reportId)).toBe("draft");
  });

  it("A sin publiserte rapport kan ikke åpnes for ny versjon fra B", async () => {
    const a = await createPublishableBathroom();
    const b = await createPublishableBathroom();
    await publishAs(a.actor, a);
    await expect(startNewVersion(b.actor, b.organizationId, a.assignmentId)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await reportStatus(a.organizationId, a.reportId)).toBe("published");
  });

  it.each(["ugyldig id", "ukjent id", "mykt slettet oppdrag"])(
    "%s gir AccessDeniedError",
    async (kind) => {
      const a = await createPublishableBathroom();
      let assignmentId = a.assignmentId;
      if (kind === "ugyldig id") assignmentId = "ikke-en-id";
      if (kind === "ukjent id") assignmentId = uuidv7();
      if (kind === "mykt slettet oppdrag") {
        await db
          .update(assignments)
          .set({ deletedAt: new Date() })
          .where(eq(assignments.id, a.assignmentId));
      }
      await expect(getPublishCheck(a.actor, a.organizationId, assignmentId)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      await expect(
        publishReport(a.actor, a.organizationId, {
          assignmentId,
          fingerprint: null,
          overrides: [],
        }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await releasesOf(a.organizationId, a.reportId)).toEqual([]);
    },
  );
});

describe("5.6 «Gå til» bygges på serveren", () => {
  it("lenken er en intern sti fra id-er, og klientens href brukes aldri", async () => {
    const f = await createPublishableBathroom();
    await addTg3WithoutCost(f);
    const view = await getPublishCheck(f.actor, f.organizationId, f.assignmentId);
    if (view.state !== "draft") throw new Error("forventet draft");
    const roomFindings = view.findings.filter((x) => x.target.roomId !== null);
    expect(roomFindings.length).toBeGreaterThan(0);
    for (const finding of roomFindings) {
      expect(finding.href).not.toBeNull();
      expect(finding.href!.startsWith(`/oppdrag/${f.assignmentId}/`)).toBe(true);
      expect(finding.href).toContain(f.roomId);
      expect(finding.href).not.toMatch(/^[a-z]+:|\/\//iu);
    }
    // Klienten kan sende href og sti i publiseringen; de ignoreres eller avvises
    const forged = await outcome(() =>
      publishReport(f.actor, f.organizationId, {
        assignmentId: f.assignmentId,
        fingerprint: view.fingerprint,
        overrides: view.findings
          .filter((x) => x.severity === "blocker")
          .map((x) => ({
            findingKey: x.key,
            reasonCode: "described_elsewhere" as const,
            href: "https://example.invalid/",
          })),
      } as never),
    );
    if (!forged.ok) expect(forged.error).toBeInstanceOf(ReportValidationError);
    else expect(JSON.stringify(forged.value)).not.toContain("example.invalid");
  });
});

describe("5.7 ingen nye rettigheter", () => {
  it("listen over rettigheter er uendret (bare hjelperen canSeeOverrideReasons er ny)", () => {
    expect([...permissions].sort()).toEqual(
      [
        "organization.read",
        "organization.manage",
        "claims.read",
        "claims.manage",
        "staff.manage",
        "assignment.edit",
        "report.edit",
        "report.publish",
        "template.edit_structure",
        "invoice.send",
        "contacts.manage",
        "statistics.read",
      ].sort(),
    );
  });
});

describe("I17 utgivelser slår ikke opp i reklamasjoner", () => {
  it("publiseringstjenesten nevner ikke claims", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files = readdirSync(__dirname).filter(
      (f) => /^publish/u.test(f) && f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      // Kommentarene kan nevne reklamasjoner; koden skal ikke
      const code = readFileSync(join(__dirname, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/\/\/.*$/gmu, "");
      expect(code, file).not.toMatch(/\bclaims\b|claim_|@\/core\/claims/u);
    }
  });
});
