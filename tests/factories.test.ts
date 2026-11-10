import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { isValidOrgNumber } from "@/core/contacts";
import { createLocalFileStorage } from "@/core/files/local-storage";
import { isCertificationValid } from "@/core/organization/certification-rules";
import { db } from "@/db/client";
import {
  aiUsageLog,
  assignmentParties,
  assignments,
  assignmentTeamMembers,
  cadastralUnits,
  certifications,
  commonAreas,
  contacts,
  employeePermissions,
  employees,
  files,
  firms,
  integrationConnections,
  loginAttempts,
  numberSequences,
  offices,
  orders,
  properties,
  trialAnswers,
  trialForms,
  trialPhotos,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createAiUsageLog,
  createAssignment,
  createAssignmentParty,
  createBuilding,
  createCertification,
  createClientAgreement,
  createCommonAreas,
  createContact,
  createEmployee,
  createFile,
  createFirm,
  createFloor,
  createFloorArea,
  createIntegrationConnection,
  createNumberSequence,
  createOffice,
  createOrder,
  createOrganization,
  createProperty,
  createRoom,
  createTeamMember,
  createUser,
  grantPermission,
  RESET_TABLES,
  resetDatabase,
  TEST_NOW,
} from "./factories";

// Fanger at en ny tabell glemmes i truncate-listen (testplan for oppgave 4, avsnitt 3.6).

describe("resetDatabase", () => {
  it("truncate-listen har alle tabellene i databasen (også files)", async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const tables = result.map((row) => row.table_name).sort();
    expect(tables).toContain("files");
    const listed: readonly string[] = RESET_TABLES;
    expect(tables.filter((table) => !listed.includes(table))).toEqual([]);
    expect(listed).toContain("files");
    // `files` tømmes før `organizations`, som den peker på
    expect(listed.indexOf("files")).toBeLessThan(listed.indexOf("organizations"));
  });

  it("resetDatabase tømmer files", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    await createFile(org.id);

    await resetDatabase();

    const [row] = await db.select({ n: count() }).from(files);
    expect(row!.n).toBe(0);
  });

  it("resetDatabase tømmer trial_-tabellene", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const formId = uuidv7();
    await db
      .insert(trialForms)
      .values({ id: formId, organizationId: org.id, name: "Testskjema 1" });
    await db.insert(trialAnswers).values({
      organizationId: org.id,
      trialFormId: formId,
      fieldKey: "floors",
      value: 2,
      deviceId: "enhet-1",
    });
    await db.insert(trialPhotos).values({
      organizationId: org.id,
      trialFormId: formId,
      fieldKey: "cover_photo",
      name: "test-image.png",
      sizeBytes: 120,
    });

    await resetDatabase();

    for (const table of [trialForms, trialAnswers, trialPhotos]) {
      const [row] = await db.select({ n: count() }).from(table);
      expect(row!.n).toBe(0);
    }
  });
});

describe("resetDatabase og innloggingssperren (fase 0b)", () => {
  it("o) resetDatabase tømmer login_attempts", async () => {
    await resetDatabase();
    await db.insert(loginAttempts).values([
      { emailHash: "a".repeat(64), kind: "code_requested" },
      { emailHash: "a".repeat(64), kind: "code_failed" },
      { emailHash: "a".repeat(64), kind: "login_succeeded" },
    ]);
    const [before] = await db.select({ n: count() }).from(loginAttempts);
    expect(before!.n).toBe(3);

    await resetDatabase();

    const [after] = await db.select({ n: count() }).from(loginAttempts);
    expect(after!.n).toBe(0);
  });
});

describe("grantPermission (fase 0b, roller og rettigheter)", () => {
  it("1. setter inn én rad med den ansattes organisasjon, og rettigheten virker", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const user = await createUser({ name: "Test Leder" });
    const employee = await createEmployee(user, org.id, ["manager"]);

    const row = await grantPermission(employee, "template.edit_structure");

    expect(row.organizationId).toBe(org.id);
    expect(row.employeeId).toBe(employee.id);
    expect(row.permission).toBe("template.edit_structure");
    expect(row.deletedAt).toBeNull();
    await expect(
      requireOrganizationAccess(user, org.id, "template.edit_structure"),
    ).resolves.toBeDefined();
  });

  it("2. resetDatabase tømmer employee_permissions", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["inspector"]);
    await grantPermission(employee, "report.edit");

    await resetDatabase();

    const [row] = await db.select({ n: count() }).from(employeePermissions);
    expect(row!.n).toBe(0);
  });
});

describe("createCertification (fase 0b, sertifisering)", () => {
  /** Samme dato ett år frem, regnet for hånd fra «ÅÅÅÅ-MM-DD». */
  function nextYear(isoDate: string): string {
    return `${Number(isoDate.slice(0, 4)) + 1}${isoDate.slice(4)}`;
  }

  it("1. uten overstyring: gyldig i dag, gyldig til ett år frem, samme organisasjon", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const employee = await createEmployee(await createUser(), org.id, ["inspector"]);

    const today = todayInOslo();
    const row = await createCertification(employee);

    expect(row.organizationId).toBe(org.id);
    expect(row.employeeId).toBe(employee.id);
    expect(row.area).toBe("condition_report");
    expect(row.validFrom).toBe(today);
    expect(row.validTo).toBe(nextYear(today));
    expect(row.deletedAt).toBeNull();
    expect(isCertificationValid(row, today)).toBe(true);
  });

  it("2. overstyring av validTo, validFrom, organizationId og employeeId brukes", async () => {
    await resetDatabase();
    const orgA = await createOrganization("Oppdiktet takst A");
    const orgB = await createOrganization("Oppdiktet takst B");
    const inA = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    const colleague = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    const inB = await createEmployee(await createUser(), orgB.id, ["inspector"]);

    const dated = await createCertification(inA, { validFrom: null, validTo: "2026-10-30" });
    expect(dated.validFrom).toBeNull();
    expect(dated.validTo).toBe("2026-10-30");

    const fromSet = await createCertification(inA, {
      validFrom: "2026-11-01",
      validTo: "2027-11-01",
    });
    expect(fromSet.validFrom).toBe("2026-11-01");
    expect(fromSet.validTo).toBe("2027-11-01");

    const other = await createCertification(inA, { employeeId: colleague.id });
    expect(other.employeeId).toBe(colleague.id);
    expect(other.organizationId).toBe(orgA.id);

    const moved = await createCertification(inA, {
      organizationId: orgB.id,
      employeeId: inB.id,
    });
    expect(moved.organizationId).toBe(orgB.id);
    expect(moved.employeeId).toBe(inB.id);
  });

  it("3. resetDatabase tømmer certifications", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const employee = await createEmployee(await createUser(), org.id, ["inspector"]);
    await createCertification(employee);

    await resetDatabase();

    const [row] = await db.select({ n: count() }).from(certifications);
    expect(row!.n).toBe(0);
  });
});

// Filtjenesten (docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 7). Innholdet skrives bare
// til en midlertidig mappe, aldri til var/files. Bytene er oppdiktet.
describe("createFile (fase 0b, filtjeneste)", () => {
  let tmp: string | undefined;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("1. gir en rad i organisasjonen med storage_key <organisasjon>/photo/<id>", async () => {
    const orgA = await createOrganization("Oppdiktet takst A");
    await createOrganization("Oppdiktet takst B");

    const row = await createFile(orgA.id);

    expect(row.organizationId).toBe(orgA.id);
    expect(row.storageKey).toBe(`${orgA.id}/photo/${row.id}`);
    const [stored] = await db.select().from(files).where(eq(files.id, row.id));
    expect(stored?.organizationId).toBe(orgA.id);
  });

  it("2. med storage: innholdet finnes i porten, og sha256 og size_bytes stemmer", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "factories-files-"));
    const storage = createLocalFileStorage(tmp);
    const orgA = await createOrganization("Oppdiktet takst A");
    const bytes = new TextEncoder().encode("oppdiktet innhold for fabrikken");

    const row = await createFile(orgA.id, {}, { storage, bytes });

    expect(Buffer.from(await storage.get(row.storageKey)).equals(Buffer.from(bytes))).toBe(true);
    expect(row.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(Number(row.sizeBytes)).toBe(bytes.byteLength);
  });

  it("3. deletedAt og deletedBy fra overstyringene står på raden", async () => {
    const orgA = await createOrganization("Oppdiktet takst A");
    const employee = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    const deletedAt = new Date("2026-11-01T08:00:00Z");

    const row = await createFile(orgA.id, { deletedAt, deletedBy: employee.id });

    expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    expect(row.deletedBy).toBe(employee.id);
  });
});

describe("login_attempts (fase 0b, sperre ved innlogging)", () => {
  it("o) resetDatabase tømmer login_attempts", async () => {
    // Lastes her, så resten av filen kjører selv om sperremodulen mangler
    const { checkAndRecordAttempt } = await import("@/core/auth/login-throttle");
    await resetDatabase();
    await checkAndRecordAttempt("ola@eksempel.no", "request_code");
    const before = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from login_attempts`,
    );
    expect(Array.from(before)[0]?.n).toBe(1);

    await resetDatabase();

    const after = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from login_attempts`,
    );
    expect(Array.from(after)[0]?.n).toBe(0);
  });
});

// Testplan docs/funksjoner/fase0b-tilkoblingslag-testplan.md avsnitt 10. Verdiene er oppdiktet.
describe("createIntegrationConnection (fase 0b, tilkoblingslag)", () => {
  it("10.1 uten overstyring: email/server_log, active, tomme settings, ingen secret_ref", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst A");

    const row = await createIntegrationConnection(org.id);

    expect(row.organizationId).toBe(org.id);
    expect(row.port).toBe("email");
    expect(row.provider).toBe("server_log");
    expect(row.status).toBe("active");
    expect(row.settings).toEqual({});
    expect(row.secretRef).toBeNull();
    expect(row.lastOkAt).toBeNull();
    expect(row.lastError).toBeNull();
    expect(row.deletedAt).toBeNull();
  });

  it("10.2 overstyringene står på raden, og fabrikken validerer ikke", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst A");
    const lastOkAt = new Date("2026-11-01T10:00:00.000Z");
    const deletedAt = new Date("2026-11-02T08:00:00.000Z");

    const row = await createIntegrationConnection(org.id, {
      port: "accounting",
      provider: "x",
      status: "error",
      secretRef: "ORG_HEMMELIGHET",
      settings: { from: "ikke-en-adresse" },
      lastOkAt,
      lastError: "gammel feil",
      deletedAt,
      deletedBy: "oppdiktet-ansatt",
    });

    expect(row).toMatchObject({
      organizationId: org.id,
      port: "accounting",
      provider: "x",
      status: "error",
      secretRef: "ORG_HEMMELIGHET",
      settings: { from: "ikke-en-adresse" },
      lastError: "gammel feil",
      deletedBy: "oppdiktet-ansatt",
    });
    expect(row.lastOkAt?.toISOString()).toBe(lastOkAt.toISOString());
    expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });

  it("10.3 integration_connections står i truncate-listen før organizations, og tømmes", async () => {
    const listed: readonly string[] = RESET_TABLES;
    expect(listed).toContain("integration_connections");
    expect(listed.indexOf("integration_connections")).toBeLessThan(listed.indexOf("organizations"));

    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst A");
    await createIntegrationConnection(org.id);

    await resetDatabase();

    const [row] = await db.select({ n: count() }).from(integrationConnections);
    expect(row!.n).toBe(0);
  });
});

// Manuell ordre og oppdragsnummer, docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 5.
// Testdata er oppdiktet.
describe("fabrikkene for ordre, oppdrag og nummerserie", () => {
  beforeEach(resetDatabase);

  it("5.1 createOrder uten overstyring gir mottatt, manuell, receivedAt = TEST_NOW, i organisasjonen", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const row = await createOrder(org.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      status: "received",
      source: "manual",
      requestedReportType: "condition_report",
      assignmentId: null,
      rejectedReason: null,
      deletedAt: null,
    });
    expect(row.receivedAt.toISOString()).toBe(TEST_NOW.toISOString());
    expect(row.addressText).toContain("Testveien");
  });

  it("5.1 createOrder bruker overstyring av status, rejectedReason, assignmentId og deletedAt", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const rejected = await createOrder(org.id, {
      status: "rejected",
      rejectedReason: "Feil registrering",
    });
    expect(rejected).toMatchObject({ status: "rejected", rejectedReason: "Feil registrering" });

    const received = await createOrder(org.id);
    const assignment = await createAssignment(org.id, { orderId: received.id });
    const converted = await createOrder(org.id, {
      status: "converted",
      assignmentId: assignment.id,
    });
    expect(converted).toMatchObject({ status: "converted", assignmentId: assignment.id });

    const deletedAt = new Date("2026-11-01T08:00:00Z");
    const deleted = await createOrder(org.id, { deletedAt });
    expect(deleted.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });

  it("5.2 createAssignment lager kontor selv i samme organisasjon, og to kall gir ulike nummer", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const first = await createAssignment(org.id);
    const second = await createAssignment(org.id);
    expect(first.number).not.toBe(second.number);
    expect(first.number).toMatch(/^TEST-\d{5}$/);
    expect(first).toMatchObject({
      organizationId: org.id,
      status: "ordered",
      assignmentType: "condition_report",
      orderId: null,
    });
    const [office] = await db.select().from(offices).where(eq(offices.id, first.officeId));
    expect(office?.organizationId).toBe(org.id);
    // Fabrikken bruker aldri nummerserien
    const [sequences] = await db.select({ n: count() }).from(numberSequences);
    expect(sequences!.n).toBe(0);
  });

  it("5.2 createAssignment bruker overstyring av officeId, orderId, number og deletedAt", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const office = await createOffice(org.id);
    const order = await createOrder(org.id);
    const deletedAt = new Date("2026-11-01T08:00:00Z");
    const row = await createAssignment(org.id, {
      officeId: office.id,
      orderId: order.id,
      number: "2026-09999",
      deletedAt,
    });
    expect(row).toMatchObject({ officeId: office.id, orderId: order.id, number: "2026-09999" });
    expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    // Ingen ekstra kontor når officeId er gitt
    const officeRows = await db.select().from(offices).where(eq(offices.organizationId, org.id));
    expect(officeRows).toHaveLength(1);
  });

  it("5.3 createNumberSequence gir oppdrag, 2026-, neste verdi 1 og fem sifre", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const row = await createNumberSequence(org.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      scope: "assignment",
      prefix: "2026-",
      nextValue: 1,
      padding: 5,
    });
  });

  it("5.4 RESET_TABLES har orders, assignments og number_sequences, og resetDatabase tømmer dem", async () => {
    const listed: readonly string[] = RESET_TABLES;
    expect(listed).toEqual(expect.arrayContaining(["orders", "assignments", "number_sequences"]));

    const org = await createOrganization("Oppdiktet takst A");
    const order = await createOrder(org.id);
    await createAssignment(org.id, { orderId: order.id });
    await createNumberSequence(org.id);

    await resetDatabase();

    for (const table of [orders, assignments, numberSequences]) {
      const [row] = await db.select({ n: count() }).from(table);
      expect(row!.n).toBe(0);
    }
  });
});

/*
 * Fabrikkene for team og parter på oppdraget
 * (docs/funksjoner/fase2a-oppdrag-team-parter-testplan.md avsnitt 5). Oppdiktede data.
 * Støtter hovedmål: reklamasjoner (testene for teamhistorikk og parter bygger på disse radene).
 */
describe("fabrikkene for team og parter (fase 2a)", () => {
  beforeEach(resetDatabase);

  it("5.1 createTeamMember uten overstyring: aktiv responsible fra TEST_NOW, oppdrag og ansatt i samme organisasjon", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const row = await createTeamMember(org.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      teamRole: "responsible",
      toAt: null,
      handedOverReason: null,
      deletedAt: null,
    });
    expect(row.fromAt.toISOString()).toBe(TEST_NOW.toISOString());
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, row.assignmentId));
    expect(assignment?.organizationId).toBe(org.id);
    const [employee] = await db
      .select({ organizationId: employees.organizationId })
      .from(employees)
      .where(eq(employees.id, row.employeeId));
    expect(employee?.organizationId).toBe(org.id);
  });

  it("5.1 createTeamMember bruker overstyring av rolle, oppdrag, ansatt, toAt, grunn og deletedAt", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    const employee = await createEmployee(await createUser(), org.id, ["inspector"]);
    const toAt = new Date(TEST_NOW.getTime() + 60 * 60 * 1000);
    const deletedAt = new Date("2026-11-03T12:00:00Z");
    const row = await createTeamMember(org.id, {
      assignmentId: assignment.id,
      employeeId: employee.id,
      teamRole: "peer_reviewer",
      toAt,
      handedOverReason: "Ferie",
      deletedAt,
    });
    expect(row).toMatchObject({
      assignmentId: assignment.id,
      employeeId: employee.id,
      teamRole: "peer_reviewer",
      handedOverReason: "Ferie",
    });
    expect(row.toAt?.toISOString()).toBe(toAt.toISOString());
    expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    // Ikke noe ekstra oppdrag når assignmentId er gitt
    const rows = await db.select().from(assignments).where(eq(assignments.organizationId, org.id));
    expect(rows).toHaveLength(1);
  });

  it("5.2 createAssignmentParty uten overstyring: megler «Megler Test», tomme felt og alle mottar = false", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const row = await createAssignmentParty(org.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      role: "broker",
      name: "Megler Test",
      firmName: null,
      email: null,
      phone: null,
      receivesReport: false,
      receivesInvoice: false,
      receivesMessages: false,
      deletedAt: null,
    });
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, row.assignmentId));
    expect(assignment?.organizationId).toBe(org.id);
  });

  it("5.2 createAssignmentParty bruker overstyringene", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    const deletedAt = new Date("2026-11-03T12:00:00Z");
    const row = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      role: "invoice_recipient",
      name: "Faktura Test",
      firmName: "Testmegling AS",
      email: "megler@example.com",
      phone: "00000000",
      receivesInvoice: true,
      deletedAt,
    });
    expect(row).toMatchObject({
      assignmentId: assignment.id,
      role: "invoice_recipient",
      name: "Faktura Test",
      firmName: "Testmegling AS",
      email: "megler@example.com",
      phone: "00000000",
      receivesReport: false,
      receivesInvoice: true,
      receivesMessages: false,
    });
    expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });

  it("5.3 RESET_TABLES har assignment_team_members og assignment_parties, og resetDatabase tømmer dem", async () => {
    const listed: readonly string[] = RESET_TABLES;
    expect(listed).toEqual(
      expect.arrayContaining(["assignment_team_members", "assignment_parties"]),
    );

    const org = await createOrganization("Oppdiktet takst A");
    await createTeamMember(org.id);
    await createAssignmentParty(org.id);

    await resetDatabase();

    for (const table of [assignmentTeamMembers, assignmentParties]) {
      const [row] = await db.select({ n: count() }).from(table);
      expect(row!.n).toBe(0);
    }
  });
});

/*
 * Fabrikkene for eiendom, matrikkel og fellesdeler
 * (docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 5). Oppdiktede data.
 * Støtter hovedmål: reklamasjoner (testene for boligtype, eierform og fellesdeler bygger på disse
 * radene).
 */
describe("fabrikkene for eiendom og fellesdeler (fase 2a)", () => {
  beforeEach(resetDatabase);

  it("5.1 createProperty uten overstyring: enebolig, selveier, «Testveien 1», manual og én matrikkelrad 999/999", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const { property, cadastralUnit } = await createProperty(org.id);
    expect(property).toMatchObject({
      organizationId: org.id,
      address: "Testveien 1",
      housingType: "detached",
      ownershipForm: "freehold",
      dataSource: "manual",
      deletedAt: null,
    });
    expect(cadastralUnit).toMatchObject({
      organizationId: org.id,
      propertyId: property.id,
      gnr: "999",
      bnr: "999",
      fnr: null,
      snr: null,
      associationName: null,
      associationOrgNumber: null,
      shareNumber: null,
    });
    const units = await db
      .select()
      .from(cadastralUnits)
      .where(eq(cadastralUnits.propertyId, property.id));
    expect(units).toHaveLength(1);
    // Uten assignmentId lages ikke noe oppdrag
    const rows = await db.select().from(assignments).where(eq(assignments.organizationId, org.id));
    expect(rows).toHaveLength(0);
  });

  it("5.1 createProperty med assignmentId setter property_id på oppdraget, og overstyringene brukes", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    const deletedAt = new Date("2026-11-03T12:00:00Z");
    const { property, cadastralUnit } = await createProperty(org.id, {
      assignmentId: assignment.id,
      address: "Testveien 2",
      postalCode: "0000",
      city: "Testby",
      municipalityNumber: "0000",
      municipalityName: "Testkommune",
      housingType: "apartment",
      ownershipForm: "cooperative",
      gnr: "998",
      bnr: "997",
      fnr: "0",
      snr: "9",
      associationName: "Borettslaget Test",
      associationOrgNumber: "000000000",
      shareNumber: "0-0",
      deletedAt,
    });
    expect(property).toMatchObject({
      address: "Testveien 2",
      postalCode: "0000",
      city: "Testby",
      municipalityNumber: "0000",
      municipalityName: "Testkommune",
      housingType: "apartment",
      ownershipForm: "cooperative",
    });
    expect(property.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    expect(cadastralUnit).toMatchObject({
      gnr: "998",
      bnr: "997",
      fnr: "0",
      snr: "9",
      associationName: "Borettslaget Test",
      associationOrgNumber: "000000000",
      shareNumber: "0-0",
    });
    const [row] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(row?.propertyId).toBe(property.id);
  });

  it("5.2 createCommonAreas uten overstyring: lager oppdrag med leilighet i borettslag og en rad med unknown/unknown", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const row = await createCommonAreas(org.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      managingAgent: null,
      conditionReportStatus: "unknown",
      maintenancePlanStatus: "unknown",
      notes: null,
      deletedAt: null,
    });
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, row.assignmentId));
    expect(assignment?.organizationId).toBe(org.id);
    expect(assignment?.propertyId).toBeTruthy();
    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, assignment!.propertyId!));
    expect(property).toMatchObject({
      organizationId: org.id,
      housingType: "apartment",
      ownershipForm: "cooperative",
    });
  });

  it("5.2 createCommonAreas bruker overstyringene og lager ikke eget oppdrag når assignmentId er gitt", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    const deletedAt = new Date("2026-11-03T12:00:00Z");
    const row = await createCommonAreas(org.id, {
      assignmentId: assignment.id,
      managingAgent: "Forvalter Test",
      conditionReportStatus: "yes",
      maintenancePlanStatus: "no",
      notes: "Sett trapperom og kjeller",
      deletedAt,
    });
    expect(row).toMatchObject({
      assignmentId: assignment.id,
      managingAgent: "Forvalter Test",
      conditionReportStatus: "yes",
      maintenancePlanStatus: "no",
      notes: "Sett trapperom og kjeller",
    });
    expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    const rows = await db.select().from(assignments).where(eq(assignments.organizationId, org.id));
    expect(rows).toHaveLength(1);
    expect(await db.select().from(properties)).toHaveLength(0);
  });

  it("5.3 RESET_TABLES har properties, cadastral_units og common_areas, barna før foreldrene, og resetDatabase tømmer dem", async () => {
    const listed: readonly string[] = RESET_TABLES;
    expect(listed).toEqual(
      expect.arrayContaining(["properties", "cadastral_units", "common_areas"]),
    );
    expect(listed.indexOf("cadastral_units")).toBeLessThan(listed.indexOf("properties"));
    expect(listed.indexOf("common_areas")).toBeLessThan(listed.indexOf("assignments"));
    expect(listed.indexOf("properties")).toBeLessThan(listed.indexOf("organizations"));
    expect(listed.indexOf("assignments")).toBeLessThan(listed.indexOf("properties"));

    const org = await createOrganization("Oppdiktet takst A");
    await createCommonAreas(org.id);
    await createProperty(org.id);

    await resetDatabase();

    for (const table of [properties, cadastralUnits, commonAreas]) {
      const [row] = await db.select({ n: count() }).from(table);
      expect(row!.n).toBe(0);
    }
  });
});

describe("fabrikkene for bygninger, etasjer, areal og rom (fase 2a)", () => {
  // docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 5. Oppdiktede data.
  beforeEach(resetDatabase);

  async function scalar(query: ReturnType<typeof sql>): Promise<Record<string, unknown>> {
    const [row] = (await db.execute(query)) as unknown as Record<string, unknown>[];
    return row!;
  }

  it("5.1 createBuilding uten overstyring: «Bolighus» på nytt oppdrag med eiendom i samme organisasjon", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const building = await createBuilding(org.id);
    expect(building).toMatchObject({ organizationId: org.id, name: "Bolighus", deletedAt: null });
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, building.assignmentId));
    expect(assignment!.organizationId).toBe(org.id);
    expect(assignment!.propertyId).toBeTruthy();
    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, assignment!.propertyId!));
    expect(property!.organizationId).toBe(org.id);
  });

  it("5.1 createBuilding bruker overstyring av oppdrag, navn og deletedAt", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await createAssignment(org.id);
    const deletedAt = new Date("2026-11-03T09:00:00Z");
    const building = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: "Garasje test",
      deletedAt,
    });
    expect(building).toMatchObject({ assignmentId: assignment.id, name: "Garasje test" });
    expect(building.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    // Oppdraget som ble sendt med, får ingen eiendom av fabrikken
    const [row] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    expect(row!.propertyId).toBeNull();
  });

  it("5.1 createFloor uten overstyring: «1. etasje», nivå 1, over terreng, i ny bygning i samme organisasjon", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const floor = await createFloor(org.id);
    expect(floor).toMatchObject({
      organizationId: org.id,
      name: "1. etasje",
      level: 1,
      belowGround: false,
      deletedAt: null,
    });
    const building = await scalar(
      sql`select organization_id from report_buildings where id = ${floor.reportBuildingId}`,
    );
    expect(building.organization_id).toBe(org.id);
  });

  it("5.1 createFloor bruker overstyringene", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const building = await createBuilding(org.id);
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      name: "Kjeller",
      level: -1,
      belowGround: true,
      deletedAt: new Date("2026-11-03T09:00:00Z"),
    });
    expect(floor).toMatchObject({
      reportBuildingId: building.id,
      name: "Kjeller",
      level: -1,
      belowGround: true,
    });
    expect(floor.deletedAt).not.toBeNull();
  });

  it("5.1 createFloorArea uten overstyring: alle felt tomme, i ny etasje i samme organisasjon", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const area = await createFloorArea(org.id);
    expect(area).toMatchObject({
      organizationId: org.id,
      braI: null,
      braE: null,
      braB: null,
      alh: null,
      measuredBy: null,
      method: null,
      comment: null,
    });
    const floor = await scalar(sql`select organization_id from floors where id = ${area.floorId}`);
    expect(floor.organization_id).toBe(org.id);
  });

  it("5.1 createFloorArea bruker overstyringene, og arealet kommer tilbake som tall", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const floor = await createFloor(org.id);
    const measurer = await createEmployee(await createUser({ name: "Test Måler" }), org.id, [
      "inspector",
    ]);
    const area = await createFloorArea(org.id, {
      floorId: floor.id,
      braI: 123.4,
      braE: 56.7,
      braB: 8.9,
      alh: 210.3,
      measuredBy: measurer.id,
      method: "laser",
      comment: "Målt langs innvendig vegg test",
    });
    expect(area).toMatchObject({
      floorId: floor.id,
      braI: 123.4,
      braE: 56.7,
      braB: 8.9,
      alh: 210.3,
      measuredBy: measurer.id,
      method: "laser",
      comment: "Målt langs innvendig vegg test",
    });
  });

  it("5.1 createRoom uten overstyring: bad, BRA-i, over terreng, uten navn, i ny etasje i samme organisasjon", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const room = await createRoom(org.id);
    expect(room).toMatchObject({
      organizationId: org.id,
      roomType: "bathroom",
      name: null,
      areaType: "bra_i",
      belowGround: false,
    });
    const floor = await scalar(sql`select organization_id from floors where id = ${room.floorId}`);
    expect(floor.organization_id).toBe(org.id);
  });

  it("5.1 createRoom bruker overstyringene", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const floor = await createFloor(org.id, { belowGround: true, level: -1, name: "Kjeller" });
    const room = await createRoom(org.id, {
      floorId: floor.id,
      roomType: "garage",
      name: "Rom test",
      areaType: "bra_e",
      belowGround: true,
      deletedAt: new Date("2026-11-03T09:00:00Z"),
    });
    expect(room).toMatchObject({
      floorId: floor.id,
      roomType: "garage",
      name: "Rom test",
      areaType: "bra_e",
      belowGround: true,
    });
    expect(room.deletedAt).not.toBeNull();
  });

  it("5.2 RESET_TABLES har de fire tabellene, barna før foreldrene, og resetDatabase tømmer dem", async () => {
    const listed: readonly string[] = RESET_TABLES;
    expect(listed).toEqual(
      expect.arrayContaining(["report_buildings", "floors", "floor_areas", "rooms"]),
    );
    expect(listed.indexOf("rooms")).toBeLessThan(listed.indexOf("floors"));
    expect(listed.indexOf("floor_areas")).toBeLessThan(listed.indexOf("floors"));
    expect(listed.indexOf("floor_areas")).toBeLessThan(listed.indexOf("employees"));
    expect(listed.indexOf("floors")).toBeLessThan(listed.indexOf("report_buildings"));
    expect(listed.indexOf("report_buildings")).toBeLessThan(listed.indexOf("assignments"));
    expect(listed.indexOf("report_buildings")).toBeLessThan(listed.indexOf("organizations"));

    const org = await createOrganization("Oppdiktet takst A");
    const floor = await createFloor(org.id);
    await createFloorArea(org.id, { floorId: floor.id });
    await createRoom(org.id, { floorId: floor.id });

    await resetDatabase();

    for (const table of ["report_buildings", "floors", "floor_areas", "rooms"]) {
      const row = await scalar(sql.raw(`select count(*)::int as n from ${table}`));
      expect(row.n, table).toBe(0);
    }
  });
});

describe("fabrikkene for firma og kontakter (fase 2a)", () => {
  beforeEach(resetDatabase);

  it("6.1 createFirm uten overstyring: «Testmegling AS», broker_firm, gyldig nummer; to kall gir ikke unik-feil", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const first = await createFirm(org.id);
    const second = await createFirm(org.id);

    expect(first).toMatchObject({
      organizationId: org.id,
      name: "Testmegling AS",
      firmType: "broker_firm",
      notes: null,
      deletedAt: null,
    });
    for (const firm of [first, second]) {
      expect(firm.orgNumber).toMatch(/^000\d{6}$/);
      expect(isValidOrgNumber(firm.orgNumber!)).toBe(true);
    }
    expect(first.orgNumber).not.toBe(second.orgNumber);
  });

  it("6.1 createFirm bruker overstyringene, også orgNumber null og deletedAt", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const deletedAt = new Date("2026-11-01T08:00:00Z");
    const firm = await createFirm(org.id, {
      name: "Testforsikring ASA",
      orgNumber: null,
      firmType: "insurer",
      notes: "Vil ha rapport før kl. 12",
      deletedAt,
    });
    expect(firm).toMatchObject({
      name: "Testforsikring ASA",
      orgNumber: null,
      firmType: "insurer",
      notes: "Vil ha rapport før kl. 12",
    });
    expect(firm.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    const withNumber = await createFirm(org.id, { orgNumber: "000000027" });
    expect(withNumber.orgNumber).toBe("000000027");
  });

  it("6.2 createContact uten overstyring: «Megler Test», manual, uten firma", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const contact = await createContact(org.id);
    expect(contact).toMatchObject({
      organizationId: org.id,
      firstName: "Megler",
      lastName: "Test",
      source: "manual",
      firmId: null,
      email: null,
      phone: null,
      notes: null,
      deletedAt: null,
    });
  });

  it("6.2 createContact bruker overstyringene, også firmId og deletedAt", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const firm = await createFirm(org.id);
    const deletedAt = new Date("2026-11-01T08:00:00Z");
    const contact = await createContact(org.id, {
      firstName: "Kari",
      lastName: "Testvik",
      email: "megler@example.com",
      phone: "00000000",
      firmId: firm.id,
      notes: "Vil ha rapport før kl. 12",
      source: "order",
      deletedAt,
    });
    expect(contact).toMatchObject({
      firstName: "Kari",
      lastName: "Testvik",
      email: "megler@example.com",
      phone: "00000000",
      firmId: firm.id,
      notes: "Vil ha rapport før kl. 12",
      source: "order",
    });
    expect(contact.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });

  it("6.3 RESET_TABLES har contacts før firms (fremmednøkkelen), og resetDatabase tømmer dem", async () => {
    const listed: readonly string[] = RESET_TABLES;
    expect(listed).toEqual(expect.arrayContaining(["contacts", "firms"]));
    expect(listed.indexOf("contacts")).toBeLessThan(listed.indexOf("firms"));
    expect(listed.indexOf("firms")).toBeLessThan(listed.indexOf("organizations"));

    const org = await createOrganization("Oppdiktet takst A");
    const firm = await createFirm(org.id);
    await createContact(org.id, { firmId: firm.id });

    await resetDatabase();

    for (const table of [contacts, firms]) {
      const [row] = await db.select({ n: count() }).from(table);
      expect(row!.n).toBe(0);
    }
  });
});

describe("fabrikken for avtale med oppdragsgiver (fase 2a)", () => {
  beforeEach(resetDatabase);

  it("10.1 createClientAgreement uten overstyring: gyldig på TEST_NOW, løpende, med eget firma i organisasjonen", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const agreement = await createClientAgreement(org.id);

    expect(agreement).toMatchObject({
      organizationId: org.id,
      name: "Testavtale forsikring",
      validFrom: "2026-01-01",
      validTo: null,
      premiseText: null,
      reportProfileCode: null,
      deletedAt: null,
    });
    expect(agreement.validFrom <= todayInOslo(TEST_NOW)).toBe(true);
    const [firm] = await db.select().from(firms).where(eq(firms.id, agreement.firmId));
    expect(firm?.organizationId).toBe(org.id);
    expect(firm?.deletedAt).toBeNull();

    // To kall lager to firma uten unik-feil
    const second = await createClientAgreement(org.id);
    expect(second.firmId).not.toBe(agreement.firmId);
  });

  it("10.1 createClientAgreement bruker overstyringene, også firmId, validTo og deletedAt", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const firm = await createFirm(org.id, { name: "Testforsikring AS", orgNumber: "000000019" });
    const deletedAt = new Date("2026-11-01T08:00:00Z");
    const agreement = await createClientAgreement(org.id, {
      firmId: firm.id,
      name: "Testavtale utløpt",
      validFrom: "2026-03-01",
      validTo: "2026-10-31",
      premiseText: "Premiss for test. Ikke ekte tekst.",
      reportProfileCode: "test-profil",
      deletedAt,
    });
    expect(agreement).toMatchObject({
      organizationId: org.id,
      firmId: firm.id,
      name: "Testavtale utløpt",
      validFrom: "2026-03-01",
      validTo: "2026-10-31",
      premiseText: "Premiss for test. Ikke ekte tekst.",
      reportProfileCode: "test-profil",
    });
    expect(agreement.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    const [{ n } = { n: -1 }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from firms where organization_id = ${org.id}`,
    );
    expect(n).toBe(1);
  });

  it("10.2 RESET_TABLES har client_agreements etter assignments og før firms, og resetDatabase tømmer den", async () => {
    const listed: readonly string[] = RESET_TABLES;
    expect(listed).toContain("client_agreements");
    expect(listed.indexOf("assignments")).toBeLessThan(listed.indexOf("client_agreements"));
    expect(listed.indexOf("client_agreements")).toBeLessThan(listed.indexOf("firms"));
    expect(listed.indexOf("firms")).toBeLessThan(listed.indexOf("organizations"));

    const org = await createOrganization("Oppdiktet takst A");
    await createClientAgreement(org.id);

    await resetDatabase();

    const [{ n } = { n: -1 }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from client_agreements`,
    );
    expect(n).toBe(0);
  });
});

describe("fabrikken for KI-loggen (fase 2a-1)", () => {
  it("lager en rad i riktig organisasjon med ansatt fra samme organisasjon", async () => {
    await resetDatabase();
    const orgA = await createOrganization("Oppdiktet takst A");
    const orgB = await createOrganization("Oppdiktet takst B");

    const row = await createAiUsageLog(orgA.id);

    expect(row.organizationId).toBe(orgA.id);
    expect(row.outcome).toBe("ok");
    expect(row.status).toBe("suggested");
    expect(row.provider).toBe("fake");
    expect(row.model).toBe("fake-v1");
    expect(row.cost).toBe("0.0000");
    expect(row.currency).toBe("NOK");
    expect(row.retainUntil.getTime()).toBeGreaterThan(Date.now() + 9 * 365 * 24 * 3600 * 1000);
    const [employee] = await db.select().from(employees).where(eq(employees.id, row.employeeId));
    expect(employee?.organizationId).toBe(orgA.id);
    const inB = await db.select().from(aiUsageLog).where(eq(aiUsageLog.organizationId, orgB.id));
    expect(inB).toEqual([]);
  });
});
