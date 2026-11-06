import { posix } from "node:path";
import { eq } from "drizzle-orm";
import { EVENT_TYPES } from "@/core/events";
import { db } from "@/db/client";
import {
  auditLog,
  employeeRoleAssignments,
  events,
  trialAnswers,
  trialForms,
  trialPhotos,
} from "@/db/schema";
import {
  createAssignment,
  createAssignmentParty,
  createBuilding,
  createCertification,
  createCheckpointRow,
  createClaim,
  createClientAgreement,
  createCommonAreas,
  createCompany,
  createContact,
  createDeviationQuestionRow,
  createEmployee,
  createFile,
  createFirm,
  createFloor,
  createFloorArea,
  createIntegrationConnection,
  createNumberSequence,
  createOffice,
  createOrder,
  createOutcomeRow,
  createProperty,
  createRoom,
  createRuleConditionRow,
  createRuleRow,
  createRuleTestCaseRow,
  createStandardMeasureRow,
  createTeamMember,
  createTemplateElementOptionRow,
  createTemplateElementRow,
  createTemplateFamilyRow,
  createTemplateSectionRow,
  createTemplateVersionRow,
  createUser,
  createWorkSession,
  grantPermission,
} from "./factories";

/** Malmotorens tolv tabeller har tenant-testene sine her (docs/funksjoner/fase2a-malmotor.md). */
const TEMPLATES_TEST_FILE = "src/core/templates/templates.test.ts";

/**
 * Én tabell med `organization_id`, slik den samlede tenant-testen
 * (`tests/tenant-isolation-all-tables.test.ts`) bruker den.
 */
export type TenantTableEntry = {
  /** Databasenavnet fra `pgTable("…")`, f.eks. "employee_roles". */
  table: string;
  /** Legger inn én rad (og nødvendige foreldre-rader) i organisasjonen, returnerer radens id. */
  insertRow: (organizationId: string) => Promise<string>;
  /** Testfilen med `expectTenantIsolation(`-kallet, relativt til repo-roten. */
  testFile: string | null;
  /** Påkrevd når `testFile` er null: hvorfor tabellen ikke har egen tenant-test ennå. */
  reason?: string;
};

function firstRow<T>(rows: T[], table: string): T {
  const [row] = rows;
  if (!row) throw new Error(`kunne ikke legge inn rad i ${table}`);
  return row;
}

/** En ansatt uten roller i organisasjonen (oppdiktet bruker). */
async function insertEmployee(organizationId: string) {
  const actor = await createUser();
  return createEmployee(actor, organizationId, []);
}

async function insertTrialForm(organizationId: string) {
  return firstRow(
    await db.insert(trialForms).values({ organizationId, name: "Testskjema" }).returning(),
    "trial_forms",
  );
}

/**
 * Registeret over alle tabeller med `organization_id`. Ny tabell? Før den opp her med
 * radbygger og testfilen som har `expectTenantIsolation(`-kallet, ellers blir
 * `tests/tenant-isolation-all-tables.test.ts` rød. Alle verdier er oppdiktede.
 */
export const tenantTables: TenantTableEntry[] = [
  {
    table: "assignment_parties",
    testFile: "src/core/assignments/assignment-team-parties.test.ts",
    insertRow: async (organizationId) => (await createAssignmentParty(organizationId)).id,
  },
  {
    table: "assignment_team_members",
    testFile: "src/core/assignments/assignment-team-parties.test.ts",
    insertRow: async (organizationId) => (await createTeamMember(organizationId)).id,
  },
  {
    table: "assignments",
    testFile: "src/core/orders/orders.test.ts",
    insertRow: async (organizationId) => (await createAssignment(organizationId)).id,
  },
  {
    table: "audit_log",
    testFile: "src/core/audit/audit.test.ts",
    insertRow: async (organizationId) => {
      const row = firstRow(
        await db
          .insert(auditLog)
          .values({ organizationId, entityType: "x", entityId: "1", action: "create", changes: {} })
          .returning(),
        "audit_log",
      );
      return row.id;
    },
  },
  {
    table: "cadastral_units",
    testFile: "src/core/properties/properties.test.ts",
    insertRow: async (organizationId) => (await createProperty(organizationId)).cadastralUnit.id,
  },
  {
    table: "certifications",
    testFile: "src/core/organization/certifications.test.ts",
    insertRow: async (organizationId) => {
      const employee = await insertEmployee(organizationId);
      return (await createCertification(employee)).id;
    },
  },
  {
    table: "checkpoints",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createCheckpointRow(organizationId)).id,
  },
  {
    table: "claims",
    testFile: "src/core/claims/claims.test.ts",
    insertRow: async (organizationId) => (await createClaim(organizationId)).id,
  },
  {
    table: "client_agreements",
    testFile: "src/core/agreements/agreements.test.ts",
    insertRow: async (organizationId) => (await createClientAgreement(organizationId)).id,
  },
  {
    table: "common_areas",
    testFile: "src/core/properties/properties.test.ts",
    insertRow: async (organizationId) => (await createCommonAreas(organizationId)).id,
  },
  {
    table: "companies",
    testFile: "src/core/organization/companies.test.ts",
    insertRow: async (organizationId) => (await createCompany(organizationId)).id,
  },
  {
    table: "contacts",
    testFile: "src/core/contacts/contacts.test.ts",
    insertRow: async (organizationId) => {
      const firm = await createFirm(organizationId);
      return (await createContact(organizationId, { firmId: firm.id })).id;
    },
  },
  {
    table: "deviation_questions",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createDeviationQuestionRow(organizationId)).id,
  },
  {
    table: "employee_permissions",
    testFile: "src/core/organization/employee-permissions.test.ts",
    insertRow: async (organizationId) => {
      const employee = await insertEmployee(organizationId);
      return (await grantPermission(employee, "organization.read")).id;
    },
  },
  {
    table: "employee_roles",
    testFile: "src/core/organization/employees-admin.test.ts",
    insertRow: async (organizationId) => {
      const actor = await createUser();
      const employee = await createEmployee(actor, organizationId, ["inspector"]);
      const row = firstRow(
        await db
          .select({ id: employeeRoleAssignments.id })
          .from(employeeRoleAssignments)
          .where(eq(employeeRoleAssignments.employeeId, employee.id)),
        "employee_roles",
      );
      return row.id;
    },
  },
  {
    table: "employees",
    testFile: "src/core/organization/employees.test.ts",
    insertRow: async (organizationId) => (await insertEmployee(organizationId)).id,
  },
  {
    table: "events",
    testFile: null,
    reason:
      "Produktkoden har ingen lesespørring mot events ennå (bare recordEvent). Testfil føres opp ved første lesespørring.",
    insertRow: async (organizationId) => {
      const row = firstRow(
        await db
          .insert(events)
          .values({ organizationId, type: EVENT_TYPES[0], actorType: "system", data: {} })
          .returning(),
        "events",
      );
      return row.id;
    },
  },
  {
    table: "files",
    testFile: "src/core/files/files.service.test.ts",
    insertRow: async (organizationId) => (await createFile(organizationId)).id,
  },
  {
    table: "firms",
    testFile: "src/core/contacts/firms.test.ts",
    insertRow: async (organizationId) => (await createFirm(organizationId)).id,
  },
  {
    table: "floor_areas",
    testFile: "src/core/buildings/buildings.test.ts",
    insertRow: async (organizationId) => (await createFloorArea(organizationId)).id,
  },
  {
    table: "floors",
    testFile: "src/core/buildings/buildings.test.ts",
    insertRow: async (organizationId) => (await createFloor(organizationId)).id,
  },
  {
    table: "integration_connections",
    testFile: "src/core/integrations/connections.test.ts",
    insertRow: async (organizationId) => (await createIntegrationConnection(organizationId)).id,
  },
  {
    table: "number_sequences",
    testFile: "src/core/assignments/number-sequence.test.ts",
    insertRow: async (organizationId) => (await createNumberSequence(organizationId)).id,
  },
  {
    table: "offices",
    testFile: "src/core/organization/offices.test.ts",
    insertRow: async (organizationId) => (await createOffice(organizationId)).id,
  },
  {
    table: "orders",
    testFile: "src/core/orders/orders.test.ts",
    insertRow: async (organizationId) => (await createOrder(organizationId)).id,
  },
  {
    table: "outcomes",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createOutcomeRow(organizationId)).id,
  },
  {
    table: "properties",
    testFile: "src/core/properties/properties.test.ts",
    insertRow: async (organizationId) => (await createProperty(organizationId)).property.id,
  },
  {
    table: "report_buildings",
    testFile: "src/core/buildings/buildings.test.ts",
    insertRow: async (organizationId) => (await createBuilding(organizationId)).id,
  },
  {
    table: "rooms",
    testFile: "src/core/buildings/buildings.test.ts",
    insertRow: async (organizationId) => (await createRoom(organizationId)).id,
  },
  {
    table: "rule_conditions",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createRuleConditionRow(organizationId)).id,
  },
  {
    table: "rule_test_cases",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createRuleTestCaseRow(organizationId)).id,
  },
  {
    table: "rules",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createRuleRow(organizationId)).id,
  },
  {
    table: "standard_measures",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createStandardMeasureRow(organizationId)).id,
  },
  {
    table: "template_element_options",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createTemplateElementOptionRow(organizationId)).id,
  },
  {
    table: "template_elements",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createTemplateElementRow(organizationId)).id,
  },
  {
    table: "template_families",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createTemplateFamilyRow(organizationId)).id,
  },
  {
    table: "template_sections",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createTemplateSectionRow(organizationId)).id,
  },
  {
    table: "template_versions",
    testFile: TEMPLATES_TEST_FILE,
    insertRow: async (organizationId) => (await createTemplateVersionRow(organizationId)).id,
  },
  {
    table: "trial_answers",
    testFile: "src/modules/offline-trial/server/trial-queries.test.ts",
    insertRow: async (organizationId) => {
      const form = await insertTrialForm(organizationId);
      const row = firstRow(
        await db
          .insert(trialAnswers)
          .values({
            organizationId,
            trialFormId: form.id,
            fieldKey: "f1",
            value: null,
            deviceId: "test-device",
          })
          .returning(),
        "trial_answers",
      );
      return row.id;
    },
  },
  {
    table: "trial_forms",
    testFile: "src/modules/offline-trial/server/trial-queries.test.ts",
    insertRow: async (organizationId) => (await insertTrialForm(organizationId)).id,
  },
  {
    table: "trial_photos",
    testFile: "src/modules/offline-trial/server/photo-storage.test.ts",
    insertRow: async (organizationId) => {
      const form = await insertTrialForm(organizationId);
      const row = firstRow(
        await db
          .insert(trialPhotos)
          .values({
            organizationId,
            trialFormId: form.id,
            fieldKey: "p1",
            name: "bilde.jpg",
            sizeBytes: 7,
            deviceId: "test-device",
          })
          .returning(),
        "trial_photos",
      );
      return row.id;
    },
  },
  {
    table: "work_sessions",
    testFile: "src/core/work-sessions/record-testplan.test.ts",
    insertRow: async (organizationId) => (await createWorkSession(organizationId)).id,
  },
];

/** Legger inn én rad i tabellen for organisasjonen og returnerer id-en. */
export function insertMinimalRow(tableName: string, organizationId: string): Promise<string> {
  const entry = tenantTables.find((candidate) => candidate.table === tableName);
  if (!entry) {
    return Promise.reject(
      new Error(
        `mangler radbygger for tabellen ${tableName} (legg den til i tests/tenant-tables.ts)`,
      ),
    );
  }
  return entry.insertRow(organizationId);
}

/**
 * Sjekker registeret mot tabellene i skjemaet og testfilene. Ren funksjon: filene leses av
 * `readText` (null når filen ikke finnes). Returnerer norske feilmeldinger; tom liste er grønn.
 */
export function checkTenantRegistry(input: {
  tables: string[];
  registry: TenantTableEntry[];
  readText: (path: string) => string | null;
}): string[] {
  const { tables, registry, readText } = input;
  const errors: string[] = [];
  const registered = new Set(registry.map((entry) => entry.table));
  const known = new Set(tables);

  for (const table of tables) {
    if (!registered.has(table)) {
      errors.push(
        `Tabellen ${table} har organization_id, men står ikke i tests/tenant-tables.ts. Legg den til med radbygger og testfilen som kaller expectTenantIsolation(.`,
      );
    }
  }

  for (const entry of registry) {
    const { table, testFile } = entry;
    if (!known.has(table)) {
      errors.push(
        `Tabellen ${table} står i tests/tenant-tables.ts, men finnes ikke med organization_id i skjemaet. Fjern oppføringen eller rett navnet til databasenavnet.`,
      );
    }

    if (testFile === null) {
      if (!entry.reason || entry.reason.trim() === "") {
        errors.push(
          `Tabellen ${table} har ingen testfil i tests/tenant-tables.ts. Før opp testfilen med expectTenantIsolation(, eller skriv en begrunnelse i reason.`,
        );
      }
      continue;
    }

    if (
      !testFile.startsWith("src/") ||
      !testFile.endsWith(".test.ts") ||
      testFile.split("/").includes("..") ||
      posix.normalize(testFile) !== testFile
    ) {
      errors.push(
        `Tabellen ${table}: testfilen ${testFile} må ligge under src/ og slutte på .test.ts. Rett stien i tests/tenant-tables.ts.`,
      );
      continue;
    }
    if (testFile.endsWith(".dev.test.ts")) {
      errors.push(
        `Tabellen ${table}: testfilen ${testFile} er en utviklingstest (.dev.test.ts) som ikke kjøres i CI. Pek på en vanlig testfil i tests/tenant-tables.ts.`,
      );
      continue;
    }
    const text = readText(testFile);
    if (text === null) {
      errors.push(
        `Tabellen ${table}: testfilen ${testFile} finnes ikke. Rett stien i tests/tenant-tables.ts.`,
      );
      continue;
    }
    if (!text.includes("expectTenantIsolation(")) {
      errors.push(
        `Tabellen ${table}: testfilen ${testFile} kaller ikke expectTenantIsolation(. Legg til en tenant-test der.`,
      );
    }
  }

  return errors;
}
