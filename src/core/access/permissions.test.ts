import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmployeeRole } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  effectivePermissions,
  grantablePermissions,
  grantHasPermission,
  isAdmin,
  permissions,
  readInspectorsEditAll,
  withPublishRequiringCertification,
  type EmployeeGrant,
  type Permission,
} from "./permissions";

// Testplan: docs/funksjoner/fase0b-roller-rettigheter-testplan.md, seksjon 1.
// Fasiten under er skrevet ut for hånd og skal ikke regnes ut fra `permissionsByRole`.

const ON = { inspectorsEditAll: true };
const OFF = { inspectorsEditAll: false };

const allNine = [
  "organization.read",
  "organization.manage",
  "claims.read",
  "staff.manage",
  "assignment.edit",
  "report.edit",
  "report.publish",
  "template.edit_structure",
  "invoice.send",
] as const;

const notGrantable = [
  "organization.manage",
  "staff.manage",
  "claims.read",
  "organization.read",
  "invoice.send",
] as const;

type Column = "inspectorOn" | "inspectorOff" | "office" | "manager" | "admin";

/** Fasit: rettighetsmatrisen i oppgavekortet (Omfang 1). */
const expected: Record<(typeof allNine)[number], Record<Column, boolean>> = {
  "organization.read": {
    inspectorOn: true,
    inspectorOff: true,
    office: true,
    manager: true,
    admin: true,
  },
  "organization.manage": {
    inspectorOn: false,
    inspectorOff: false,
    office: false,
    manager: false,
    admin: true,
  },
  "claims.read": {
    inspectorOn: false,
    inspectorOff: false,
    office: false,
    manager: true,
    admin: true,
  },
  "staff.manage": {
    inspectorOn: false,
    inspectorOff: false,
    office: false,
    manager: true,
    admin: true,
  },
  "assignment.edit": {
    inspectorOn: true,
    inspectorOff: false,
    office: true,
    manager: true,
    admin: true,
  },
  "report.edit": {
    inspectorOn: true,
    inspectorOff: false,
    office: false,
    manager: true,
    admin: true,
  },
  "report.publish": {
    inspectorOn: true,
    inspectorOff: true,
    office: false,
    manager: true,
    admin: true,
  },
  "template.edit_structure": {
    inspectorOn: false,
    inspectorOff: false,
    office: false,
    manager: false,
    admin: true,
  },
  "invoice.send": {
    inspectorOn: true,
    inspectorOff: true,
    office: true,
    manager: true,
    admin: true,
  },
};

function column(role: EmployeeRole, editAll: boolean): Column {
  if (role === "inspector") return editAll ? "inspectorOn" : "inspectorOff";
  return role;
}

const roles: EmployeeRole[] = ["inspector", "office", "manager", "admin"];

const matrixCases = roles.flatMap((role) =>
  [true, false].flatMap((editAll) =>
    allNine.map((permission) => ({
      role,
      editAll,
      permission,
      allowed: expected[permission][column(role, editAll)],
    })),
  ),
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("permissions", () => {
  it("1. har nøyaktig de ni faste kodene", () => {
    expect([...permissions].sort()).toEqual([...allNine].sort());
  });

  it("2. grantablePermissions er nøyaktig de fire, og en delmengde av permissions", () => {
    expect([...grantablePermissions].sort()).toEqual(
      ["assignment.edit", "report.edit", "report.publish", "template.edit_structure"].sort(),
    );
    for (const p of grantablePermissions) expect(permissions).toContain(p);
    for (const p of notGrantable)
      expect(grantablePermissions as readonly string[]).not.toContain(p);
  });
});

describe("effectivePermissions: rettighetsmatrisen", () => {
  it("har 72 tilfeller (4 roller × på/av × 9 rettigheter)", () => {
    expect(matrixCases).toHaveLength(72);
  });

  it.each(matrixCases)(
    "3. $role med innstillingen $editAll: $permission = $allowed",
    ({ role, editAll, permission, allowed }) => {
      const result = effectivePermissions([role], [], { inspectorsEditAll: editAll });
      expect(result.includes(permission)).toBe(allowed);
    },
  );

  it.each(roles)(
    "4. innstillingen påvirker aldri claims.read, organization.manage eller staff.manage (%s)",
    (role) => {
      const on = effectivePermissions([role], [], ON);
      const off = effectivePermissions([role], [], OFF);
      for (const p of ["claims.read", "organization.manage", "staff.manage"] as const) {
        expect(on.includes(p)).toBe(off.includes(p));
      }
    },
  );

  it.each(["office", "manager", "admin"] as const)(
    "%s er lik med innstillingen på og av",
    (role) => {
      expect([...effectivePermissions([role], [], ON)].sort()).toEqual(
        [...effectivePermissions([role], [], OFF)].sort(),
      );
    },
  );

  it.each([ON, OFF])("5. kontor har aldri report.edit eller report.publish (%o)", (settings) => {
    const result = effectivePermissions(["office"], [], settings);
    expect(result).not.toContain("report.edit");
    expect(result).not.toContain("report.publish");
  });

  it("6. flere roller gir unionen", () => {
    const result = effectivePermissions(["inspector", "office"], [], OFF);
    expect(result).toContain("assignment.edit");
    expect(result).not.toContain("report.edit");
  });
});

describe("effectivePermissions: enkeltrettigheter", () => {
  it("7. leder får template.edit_structure bare når den er gitt", () => {
    expect(effectivePermissions(["manager"], ["template.edit_structure"], ON)).toContain(
      "template.edit_structure",
    );
    expect(effectivePermissions(["manager"], [], ON)).not.toContain("template.edit_structure");
  });

  it("8. enkeltrettighet virker med innstillingen av", () => {
    const result = effectivePermissions(["inspector"], ["report.edit"], OFF);
    expect(result).toContain("report.edit");
    expect(result).not.toContain("assignment.edit");
  });

  it("9. ingen roller, bare enkeltrettighet, gir bare den", () => {
    expect([...effectivePermissions([], ["template.edit_structure"], ON)]).toEqual([
      "template.edit_structure",
    ]);
  });

  it.each(notGrantable)("10. ikke-tillatt navn %s gir ingen rettighet (fail-closed)", (name) => {
    expect([...effectivePermissions([], [name], ON)]).toEqual([]);
    expect([...effectivePermissions([], [name], OFF)]).toEqual([]);
  });

  it.each(["report.delete", "", "REPORT.EDIT", " report.edit"])(
    "11. ukjent navn %j gir ingen ekstra rettighet og krasjer ikke",
    (name) => {
      expect([...effectivePermissions([], [name], ON)]).toEqual([]);
      expect([...effectivePermissions(["inspector"], [name], OFF)].sort()).toEqual(
        [...effectivePermissions(["inspector"], [], OFF)].sort(),
      );
    },
  );

  it("12. ingen duplikater", () => {
    const result = effectivePermissions(["manager"], ["report.edit"], ON);
    expect(result.filter((p) => p === "report.edit")).toHaveLength(1);
    expect(new Set(result).size).toBe(result.length);
  });
});

describe("Admin stenges aldri ute, skal aldri fjernes", () => {
  it.each([
    { name: "innstillingen av, uten enkeltrettigheter", granted: [] as string[], settings: OFF },
    { name: "innstillingen på, uten enkeltrettigheter", granted: [] as string[], settings: ON },
    {
      name: "innstillingen av, med ukjente og ikke-tillatte navn",
      granted: ["finnes.ikke", "", "organization.manage", "claims.read", "REPORT.EDIT"],
      settings: OFF,
    },
  ])("13. admin har alle ni: $name", ({ granted, settings }) => {
    expect([...effectivePermissions(["admin"], granted, settings)].sort()).toEqual(
      [...permissions].sort(),
    );
  });
});

describe("readInspectorsEditAll", () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  const key = "access.inspectors_edit_all";

  it.each([
    { name: "settings er {}", settings: {} },
    { name: "settings er null", settings: null },
    { name: "settings er undefined", settings: undefined },
    { name: "settings er tekst", settings: "på" },
    { name: "settings er tall", settings: 1 },
    { name: "settings mangler nøkkelen", settings: { "annen.nokkel": false } },
  ])("14. $name gir true uten advarsel", ({ settings }) => {
    const warn = vi.spyOn(logger, "warn");
    expect(readInspectorsEditAll(orgId, settings)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("14. true gir true uten advarsel", () => {
    const warn = vi.spyOn(logger, "warn");
    expect(readInspectorsEditAll(orgId, { [key]: true })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("14. false gir false uten advarsel", () => {
    const warn = vi.spyOn(logger, "warn");
    expect(readInspectorsEditAll(orgId, { [key]: false })).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    { name: "null", value: null },
    { name: '"false"', value: "false" },
    { name: "0", value: 0 },
    { name: "1", value: 1 },
    { name: "{}", value: {} },
    { name: "[]", value: [] },
  ])("14. ugyldig verdi $name gir true og én advarsel", ({ value }) => {
    const warn = vi.spyOn(logger, "warn");
    expect(readInspectorsEditAll(orgId, { [key]: value })).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("15. advarselen har bare organisasjons-id og nøkkel, ingen verdi eller persondata", () => {
    const warn = vi.spyOn(logger, "warn");
    readInspectorsEditAll(orgId, { [key]: "false" });
    expect(warn).toHaveBeenCalledTimes(1);
    const fields = warn.mock.calls[0]![1] as Record<string, unknown>;
    // Nøyaktig to felt: organisasjons-id og nøkkelen (feltnavnet for nøkkelen er fritt)
    expect(Object.keys(fields)).toHaveLength(2);
    expect(fields.organizationId).toBe(orgId);
    const other = Object.entries(fields).filter(([name]) => name !== "organizationId");
    expect(other.map(([, value]) => value)).toEqual([key]);
    // Verdien («false») står ikke i kallet
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('"false"');
  });
});

describe("grantHasPermission og isAdmin", () => {
  it("16. grantHasPermission leser bare grant.permissions", () => {
    const grant: EmployeeGrant = {
      employeeId: "e",
      organizationId: "o",
      roles: ["admin"],
      permissions: ["invoice.send"],
    };
    expect(grantHasPermission(grant, "invoice.send")).toBe(true);
    // Rollen admin står i grant.roles, men rettigheten står ikke i grant.permissions
    expect(grantHasPermission(grant, "organization.manage")).toBe(false);

    const noRoles: EmployeeGrant = {
      employeeId: "e",
      organizationId: "o",
      roles: [],
      permissions: ["template.edit_structure"],
    };
    expect(grantHasPermission(noRoles, "template.edit_structure")).toBe(true);
  });

  it("16. isAdmin leser bare grant.roles", () => {
    const allPermissions: readonly Permission[] = [...permissions];
    expect(
      isAdmin({ employeeId: "e", organizationId: "o", roles: [], permissions: allPermissions }),
    ).toBe(false);
    expect(
      isAdmin({ employeeId: "e", organizationId: "o", roles: ["admin"], permissions: [] }),
    ).toBe(true);
  });
});

// --- Sertifisering (testplan docs/funksjoner/fase0b-sertifisering-testplan.md, del 2). Bare nye
// tester; rollematrisen og fasitene over er urørt. ---

describe("withPublishRequiringCertification", () => {
  const withoutPublish = allNine.filter((p) => p !== "report.publish");

  it("1. alle ni uten gyldig sertifisering gir de åtte andre, uten report.publish", () => {
    expect(withPublishRequiringCertification(allNine, false)).toEqual(withoutPublish);
  });

  it("2. med gyldig sertifisering er listen uendret (innhold og rekkefølge)", () => {
    expect(withPublishRequiringCertification(allNine, true)).toEqual([...allNine]);
  });

  it("3. uten report.publish i listen og uten sertifisering er listen uendret", () => {
    const list: Permission[] = ["organization.read", "assignment.edit", "invoice.send"];
    expect(withPublishRequiringCertification(list, false)).toEqual(list);
    expect(withPublishRequiringCertification([], false)).toEqual([]);
  });

  const fasitCases = roles.flatMap((role) =>
    [true, false].map((editAll) => ({
      role,
      editAll,
      fasit: allNine.filter((p) => expected[p][column(role, editAll)]),
    })),
  );

  it.each(fasitCases)(
    "4. rører ingen andre rettigheter: $role med innstillingen $editAll",
    ({ fasit }) => {
      expect(withPublishRequiringCertification(fasit, false)).toEqual(
        fasit.filter((p) => p !== "report.publish"),
      );
      expect(withPublishRequiringCertification(fasit, true)).toEqual(fasit);
    },
  );

  // Admin stenges aldri ute (regel 11). Testen skal aldri fjernes.
  it("5. admin uten sertifisering beholder organization.manage og staff.manage", () => {
    const admin = withPublishRequiringCertification(
      effectivePermissions(["admin"], [], OFF),
      false,
    );
    expect(admin).toContain("organization.manage");
    expect(admin).toContain("staff.manage");
    expect(admin).toContain("organization.read");
    expect(admin).not.toContain("report.publish");
    expect(admin).toHaveLength(8);
  });

  it("6. muterer ikke listen som sendes inn", () => {
    const input = Object.freeze([...allNine]) as readonly Permission[];
    expect(() => withPublishRequiringCertification(input, false)).not.toThrow();
    expect(() => withPublishRequiringCertification(input, true)).not.toThrow();
    expect(input).toEqual([...allNine]);
  });
});
