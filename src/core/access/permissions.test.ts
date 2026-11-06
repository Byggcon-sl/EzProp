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

const allPermissions = [
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
] as const;

const notGrantable = [
  "organization.manage",
  "staff.manage",
  "claims.read",
  "claims.manage",
  "organization.read",
  "invoice.send",
  "contacts.manage",
  "statistics.read",
] as const;

type Column = "inspectorOn" | "inspectorOff" | "office" | "manager" | "admin";

/** Fasit: rettighetsmatrisen i oppgavekortet (Omfang 1). */
const expected: Record<(typeof allPermissions)[number], Record<Column, boolean>> = {
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
  // Registrere og endre reklamasjonssaker: bare leder og admin
  // (docs/funksjoner/fase2a-reklamasjoner.md, Omfang 2)
  "claims.manage": {
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
  // Fjerne og slå sammen kontakter og firma: bare leder og admin
  // (docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter.md, Omfang 1)
  "contacts.manage": {
    inspectorOn: false,
    inspectorOff: false,
    office: false,
    manager: true,
    admin: true,
  },
  // Samlet statistikk (tid per fase): bare leder og admin, aldri enkeltvis (A21)
  // (docs/funksjoner/fase2a-tidsmaling.md, Omfang 5)
  "statistics.read": {
    inspectorOn: false,
    inspectorOff: false,
    office: false,
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
    allPermissions.map((permission) => ({
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
  it("1. har nøyaktig de elleve faste kodene", () => {
    expect([...permissions].sort()).toEqual([...allPermissions].sort());
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
  it("har 96 tilfeller (4 roller × på/av × 12 rettigheter)", () => {
    expect(matrixCases).toHaveLength(96);
  });

  it.each(matrixCases)(
    "3. $role med innstillingen $editAll: $permission = $allowed",
    ({ role, editAll, permission, allowed }) => {
      const result = effectivePermissions([role], [], { inspectorsEditAll: editAll });
      expect(result.includes(permission)).toBe(allowed);
    },
  );

  it.each(roles)(
    "4. innstillingen påvirker aldri claims.read, claims.manage, organization.manage eller staff.manage (%s)",
    (role) => {
      const on = effectivePermissions([role], [], ON);
      const off = effectivePermissions([role], [], OFF);
      for (const p of [
        "claims.read",
        "claims.manage",
        "organization.manage",
        "staff.manage",
      ] as const) {
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
      granted: [
        "finnes.ikke",
        "",
        "organization.manage",
        "claims.read",
        "claims.manage",
        "REPORT.EDIT",
      ],
      settings: OFF,
    },
  ])("13. admin har alle elleve: $name", ({ granted, settings }) => {
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
  const withoutPublish = allPermissions.filter((p) => p !== "report.publish");

  it("1. alle elleve uten gyldig sertifisering gir de ti andre, uten report.publish", () => {
    expect(withPublishRequiringCertification(allPermissions, false)).toEqual(withoutPublish);
  });

  it("2. med gyldig sertifisering er listen uendret (innhold og rekkefølge)", () => {
    expect(withPublishRequiringCertification(allPermissions, true)).toEqual([...allPermissions]);
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
      fasit: allPermissions.filter((p) => expected[p][column(role, editAll)]),
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
    expect(admin).toHaveLength(11);
  });

  it("6. muterer ikke listen som sendes inn", () => {
    const input = Object.freeze([...allPermissions]) as readonly Permission[];
    expect(() => withPublishRequiringCertification(input, false)).not.toThrow();
    expect(() => withPublishRequiringCertification(input, true)).not.toThrow();
    expect(input).toEqual([...allPermissions]);
  });
});

// --- Fjerne og slå sammen kontakter og firma (testplan
// docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter-testplan.md, avsnitt 1). Matrisen over har
// fått raden `contacts.manage`; testene under navngir hvert krav for seg. Støtter hovedmål:
// reklamasjoner (bare leder og admin kan endre mange oppdrag på én gang). ---

describe("contacts.manage", () => {
  it("1.1 manager_has_contacts_manage", () => {
    expect(effectivePermissions(["manager"], [], ON)).toContain("contacts.manage");
    expect(effectivePermissions(["manager"], [], OFF)).toContain("contacts.manage");
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it.each([
    { name: "innstillingen på", settings: ON },
    { name: "innstillingen av", settings: OFF },
  ])("1.2 admin_always_has_contacts_manage: $name, uten andre roller", ({ settings }) => {
    expect(effectivePermissions(["admin"], [], settings)).toContain("contacts.manage");
    expect(effectivePermissions(["admin", "inspector"], [], settings)).toContain("contacts.manage");
    // Uten gyldig sertifisering mister admin bare report.publish
    expect(
      withPublishRequiringCertification(effectivePermissions(["admin"], [], settings), false),
    ).toContain("contacts.manage");
  });

  it.each([
    { name: "på", settings: ON },
    { name: "av", settings: OFF },
  ])("1.3 inspector_lacks_contacts_manage: innstillingen $name", ({ settings }) => {
    expect(effectivePermissions(["inspector"], [], settings)).not.toContain("contacts.manage");
  });

  it.each([ON, OFF])("1.4 office_lacks_contacts_manage (%o)", (settings) => {
    expect(effectivePermissions(["office"], [], settings)).not.toContain("contacts.manage");
    expect(effectivePermissions(["inspector", "office"], [], settings)).not.toContain(
      "contacts.manage",
    );
  });

  it("1.5 contacts_manage_not_grantable", () => {
    expect(grantablePermissions as readonly string[]).not.toContain("contacts.manage");
    for (const settings of [ON, OFF]) {
      expect(effectivePermissions(["inspector"], ["contacts.manage"], settings)).toEqual(
        effectivePermissions(["inspector"], [], settings),
      );
      expect(effectivePermissions(["office"], ["contacts.manage"], settings)).not.toContain(
        "contacts.manage",
      );
      expect([...effectivePermissions([], ["contacts.manage"], settings)]).toEqual([]);
    }
  });

  // Skrevet ut for hånd. En ny rolle eller ny rettighet må føres inn her, slik at ingen får
  // contacts.manage ved et uhell.
  it("1.6 permission_list_snapshot", () => {
    const sorted = (role: EmployeeRole, settings: typeof ON) =>
      [...effectivePermissions([role], [], settings)].sort();
    expect({
      inspectorOn: sorted("inspector", ON),
      inspectorOff: sorted("inspector", OFF),
      officeOn: sorted("office", ON),
      officeOff: sorted("office", OFF),
      managerOn: sorted("manager", ON),
      managerOff: sorted("manager", OFF),
      adminOn: sorted("admin", ON),
      adminOff: sorted("admin", OFF),
    }).toEqual({
      inspectorOn: [
        "assignment.edit",
        "invoice.send",
        "organization.read",
        "report.edit",
        "report.publish",
      ],
      inspectorOff: ["invoice.send", "organization.read", "report.publish"],
      officeOn: ["assignment.edit", "invoice.send", "organization.read"],
      officeOff: ["assignment.edit", "invoice.send", "organization.read"],
      managerOn: [
        "assignment.edit",
        "claims.manage",
        "claims.read",
        "contacts.manage",
        "invoice.send",
        "organization.read",
        "report.edit",
        "report.publish",
        "staff.manage",
        "statistics.read",
      ],
      managerOff: [
        "assignment.edit",
        "claims.manage",
        "claims.read",
        "contacts.manage",
        "invoice.send",
        "organization.read",
        "report.edit",
        "report.publish",
        "staff.manage",
        "statistics.read",
      ],
      adminOn: [...allPermissions].sort(),
      adminOff: [...allPermissions].sort(),
    });
  });
});

// --- Reklamasjoner med enkelt skjema (testplan docs/funksjoner/fase2a-reklamasjoner-testplan.md,
// avsnitt 1). Matrisen og fasitene over har fått raden `claims.manage`; testene under navngir hvert
// krav for seg. Støtter hovedmål: reklamasjoner (bare leder og admin ser og fører sakene, Ståle
// 27.10.2026, og ingen kan få rettigheten ved et uhell). ---

describe("claims.manage", () => {
  it("1.1 claims.manage står rett etter claims.read i den faste listen", () => {
    const list = [...permissions] as string[];
    expect(list).toContain("claims.manage");
    expect(list.indexOf("claims.manage")).toBe(list.indexOf("claims.read") + 1);
  });

  const roleTable = [
    { role: "inspector", read: false, manage: false },
    { role: "office", read: false, manage: false },
    { role: "manager", read: true, manage: true },
    { role: "admin", read: true, manage: true },
  ] as const;
  const roleCases = roleTable.flatMap((row) =>
    [
      { name: "på", settings: ON },
      { name: "av", settings: OFF },
    ].map((setting) => ({ ...row, setting: setting.name, settings: setting.settings })),
  );

  it.each(roleCases)(
    "1.2 $role med innstillingen $setting: claims.read = $read, claims.manage = $manage",
    ({ role, settings, read, manage }) => {
      const result = effectivePermissions([role as EmployeeRole], [], settings);
      expect(result.includes("claims.read")).toBe(read);
      expect(result.includes("claims.manage")).toBe(manage);
    },
  );

  it.each(roles)(
    "1.3 innstillingen påvirker aldri claims.read eller claims.manage (%s)",
    (role) => {
      const on = effectivePermissions([role], [], ON);
      const off = effectivePermissions([role], [], OFF);
      expect(on.includes("claims.read")).toBe(off.includes("claims.read"));
      expect(on.includes("claims.manage")).toBe(off.includes("claims.manage"));
    },
  );

  it("1.4 claims.manage kan ikke gis som enkeltrettighet", () => {
    expect(grantablePermissions as readonly string[]).not.toContain("claims.manage");
    expect(grantablePermissions as readonly string[]).not.toContain("claims.read");
    for (const settings of [ON, OFF]) {
      const inspector = effectivePermissions(
        ["inspector"],
        ["claims.manage", "claims.read"],
        settings,
      );
      expect(inspector).not.toContain("claims.manage");
      expect(inspector).not.toContain("claims.read");
      expect(inspector).toEqual(effectivePermissions(["inspector"], [], settings));
      expect(
        effectivePermissions(["office"], ["claims.manage", "claims.read"], settings),
      ).not.toContain("claims.manage");
      expect([...effectivePermissions([], ["claims.manage", "claims.read"], settings)]).toEqual([]);
    }
  });

  it.each([
    { name: "på", settings: ON },
    { name: "av", settings: OFF },
  ])(
    "1.5 uten gyldig sertifisering tas bare report.publish bort for leder (innstillingen $name)",
    ({ settings }) => {
      const manager = effectivePermissions(["manager"], [], settings);
      const result = withPublishRequiringCertification(manager, false);
      expect(result).toContain("claims.read");
      expect(result).toContain("claims.manage");
      expect(result).toEqual(manager.filter((p) => p !== "report.publish"));
    },
  );

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it.each([
    { name: "innstillingen på", settings: ON },
    { name: "innstillingen av", settings: OFF },
  ])(
    "1.6 admin uten andre roller og uten sertifisering har claims.read og claims.manage: $name",
    ({ settings }) => {
      for (const certified of [true, false]) {
        const admin = withPublishRequiringCertification(
          effectivePermissions(["admin"], [], settings),
          certified,
        );
        expect(admin).toContain("claims.read");
        expect(admin).toContain("claims.manage");
      }
    },
  );

  it.each([ON, OFF])(
    "1.7 flere roller: takstmann + leder har begge, takstmann + kontor ingen (%o)",
    (settings) => {
      const inspectorManager = effectivePermissions(["inspector", "manager"], [], settings);
      expect(inspectorManager).toContain("claims.read");
      expect(inspectorManager).toContain("claims.manage");
      const inspectorOffice = effectivePermissions(["inspector", "office"], [], settings);
      expect(inspectorOffice).not.toContain("claims.read");
      expect(inspectorOffice).not.toContain("claims.manage");
    },
  );
});

// --- Malmotoren (docs/funksjoner/fase2a-malmotor-testplan.md, 1.1) ---------------------------------

describe("malmotoren gir ingen ny rettighet", () => {
  it("1.1 antallet rettigheter er uendret (12), og template.edit_structure kan fortsatt gis", () => {
    expect(permissions).toHaveLength(12);
    expect(grantablePermissions).toContain("template.edit_structure");
    expect(grantablePermissions).toHaveLength(4);
  });

  it("1.1b bare admin har template.edit_structure fra rollen, med innstillingen på og av", () => {
    for (const settings of [ON, OFF]) {
      expect(effectivePermissions(["admin"], [], settings)).toContain("template.edit_structure");
      for (const role of ["inspector", "office", "manager"] as const) {
        expect(effectivePermissions([role], [], settings)).not.toContain("template.edit_structure");
      }
    }
  });
});
