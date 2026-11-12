import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, like, sql } from "drizzle-orm";
import type { Actor } from "@/core/access";
import { AI_ENABLED_SETTING_KEY } from "@/core/ai";
import { addParty, changeAssignmentStatus, setTeamMember } from "@/core/assignments";
import { saveBuilding, saveFloor, saveFloorArea, saveRoom } from "@/core/buildings";
import { createConnection } from "@/core/integrations";
import { convertOrderToAssignment, createOrder } from "@/core/orders";
import { saveAssignmentProperty, saveCommonAreas } from "@/core/properties";
import {
  createDraftVersion,
  createTemplateFamily,
  getTemplateVersion,
  isSameTemplateContent,
  listTemplateFamilies,
  parseTemplateDocument,
  publishVersion,
  saveDraftContent,
} from "@/core/templates";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignments,
  assignmentTeamMembers,
  commonAreas,
  companies,
  employeeRoleAssignments,
  employees,
  integrationConnections,
  offices,
  orders,
  organizations,
  reportBuildings,
  users,
} from "@/db/schema";
import type { EmployeeRole } from "@/db/schema";
import {
  SAMPLE_ASSIGNMENTS,
  SAMPLE_COMPANY_NAME,
  SAMPLE_INSPECTOR,
  SAMPLE_OFFICE_NAME,
  SAMPLE_ORGANIZATION_NAME,
  type SampleAssignment,
} from "./sample-assignments.data";
import { wetRoomTemplate } from "./templates/wet-room";

/*
 * `pnpm db:seed:testoppdrag` (A130–A134): fire oppdiktede testoppdrag i prøveorganisasjonen.
 * Trygt å kjøre flere ganger.
 *
 * - Alle sjekker gjøres før noe skrives: admin fra `SEED_ADMIN_EMAIL` finnes (fra `pnpm db:seed`),
 *   og organisasjonen med navnet finnes høyst én gang og har merket `settings.sampleData = true`.
 * - Grunndataene (organisasjon, selskap, kontor, ansatte og roller) legges inn direkte, som i
 *   `runSeed`. Oppdragene lages bare gjennom tjenestene i `src/core` med admin som den som
 *   utfører, så kontrollene, nummerserien, hendelsene og regelen for utstedende selskap gjelder.
 * - Tjenestene har hver sin transaksjon. Derfor sjekkes delene av hvert testoppdrag i fast
 *   rekkefølge, og bare det som mangler lages. En del som finnes, røres ikke. Bygninger og parter
 *   vurderes samlet. Andre kjøring kaller ingen tjeneste som skriver.
 * - Et testoppdrag med avvist ordre, slettet ordre eller kansellert oppdrag hoppes over.
 * - Steget sletter aldri noe. Loggen har bare `externalRef` og resultatet, aldri e-post eller navn.
 * - KI med den falske leverandøren slås på bare i prøveorganisasjonen (`ensureSampleAi`, A160).
 *   `pnpm db:seed` (Byggcon) rører ikke KI.
 * - Systemmalen «Tilstandsrapport bolig» med badet (`ensureSampleTemplate`) publiseres bare i
 *   prøveorganisasjonen, gjennom tjenestene i `src/core/templates`. Ny versjon bare når innholdet
 *   er endret. `pnpm db:seed` (Byggcon) rører ikke maler.
 */

export class SampleOrganizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleOrganizationError";
  }
}

/** Resultatet for én del: laget nå, eller fantes fra før. */
export type SamplePartResult = "created" | "existing";
/** Resultatet for et helt testoppdrag. */
export type SampleResult = SamplePartResult | "skipped";

export type SampleAssignmentSummary = {
  externalRef: string;
  result: SampleResult;
};

export type SampleAiSummary = {
  /** `ai.enabled` satt nå, fantes fra før (også `false`), eller `skipped` uten `sampleData`. */
  setting: SampleResult;
  /**
   * Tilkoblingen `fake` laget nå, fantes det fra før en rad på porten `ai`, eller `skipped`
   * uten `sampleData`.
   */
  connection: SampleResult;
};

export type SampleSeedSummary = {
  organization: SamplePartResult;
  ai: SampleAiSummary;
  /** Systemmalen med badet: ny versjon publisert, uendret, eller `skipped` uten `sampleData`. */
  template: SampleResult;
  assignments: SampleAssignmentSummary[];
};

/** Det delene trenger: admin som utfører, prøveorganisasjonen, kontoret og takstmannen. */
export type SampleSeedContext = {
  actor: Actor;
  organizationId: string;
  officeId: string;
  inspectorEmployeeId: string;
  now: Date;
};

export type SampleOrderRow = {
  id: string;
  externalRef: string | null;
  status: string;
  assignmentId: string | null;
  orderDeletedAt: Date | null;
  assignmentDeletedAt: Date | null;
};

const RESULT_LABELS: Record<SampleResult, string> = {
  created: "laget",
  existing: "finnes fra før",
  skipped: "hoppet over",
};

/**
 * Ordrene med `external_ref` som starter med `sample:` i organisasjonen, også avviste, slettede
 * og med kansellert (myk-slettet) oppdrag. Filtrerer alltid på `organizationId`.
 */
export async function findSampleOrders(organizationId: string): Promise<SampleOrderRow[]> {
  return db
    .select({
      id: orders.id,
      externalRef: orders.externalRef,
      status: orders.status,
      assignmentId: orders.assignmentId,
      orderDeletedAt: orders.deletedAt,
      assignmentDeletedAt: assignments.deletedAt,
    })
    .from(orders)
    .leftJoin(
      assignments,
      and(eq(assignments.id, orders.assignmentId), eq(assignments.organizationId, organizationId)),
    )
    .where(and(eq(orders.organizationId, organizationId), like(orders.externalRef, "sample:%")))
    .orderBy(asc(orders.createdAt), asc(orders.id));
}

/** Avvist ordre, slettet ordre eller kansellert oppdrag: testoppdraget lages ikke på nytt. */
function isUnusable(order: SampleOrderRow): boolean {
  return (
    order.status === "rejected" ||
    order.orderDeletedAt !== null ||
    order.assignmentDeletedAt !== null
  );
}

// ---------------------------------------------------------------------------------------------
// Sjekker og grunndata
// ---------------------------------------------------------------------------------------------

/** Leser alt som må stemme før noe skrives. Kaster `SampleOrganizationError`. */
async function checkBeforeWriting(env: Record<string, string | undefined>) {
  const adminEmail = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) throw new SampleOrganizationError("SEED_ADMIN_EMAIL mangler");

  const [admin] = await db.select().from(users).where(eq(users.email, adminEmail));
  if (!admin) {
    throw new SampleOrganizationError("Fant ikke admin-brukeren. Kjør pnpm db:seed først.");
  }

  const found = await db
    .select({
      id: organizations.id,
      settings: organizations.settings,
      organizationDeletedAt: organizations.deletedAt,
    })
    .from(organizations)
    .where(eq(organizations.name, SAMPLE_ORGANIZATION_NAME));
  if (found.length > 1) {
    throw new SampleOrganizationError(
      "Det finnes flere organisasjoner med navnet til prøveorganisasjonen. Ingenting er endret.",
    );
  }
  const organization = found[0] ?? null;
  if (organization && organization.settings.sampleData !== true) {
    throw new SampleOrganizationError(
      "Organisasjonen med navnet til prøveorganisasjonen er ikke merket som prøvedata. Ingenting er endret.",
    );
  }
  if (organization && organization.organizationDeletedAt !== null) {
    throw new SampleOrganizationError("Prøveorganisasjonen er slettet. Ingenting er endret.");
  }
  return { admin, organization };
}

async function ensureEmployee(
  organizationId: string,
  userId: string,
  name: string,
  placement: { companyId: string | null; officeId: string | null },
): Promise<string> {
  const [existing] = await db
    .select({ id: employees.id, companyId: employees.companyId })
    .from(employees)
    .where(and(eq(employees.organizationId, organizationId), eq(employees.userId, userId)));
  if (existing) {
    // Selskapet må være satt før takstmannen blir ansvarlig (A67). Bare når det mangler.
    if (placement.companyId !== null && existing.companyId === null) {
      await db
        .update(employees)
        .set({ companyId: placement.companyId })
        .where(and(eq(employees.id, existing.id), eq(employees.organizationId, organizationId)));
    }
    return existing.id;
  }
  const [created] = await db
    .insert(employees)
    .values({ organizationId, userId, name, ...placement })
    .returning({ id: employees.id });
  if (!created) throw new Error("kunne ikke opprette ansatt");
  return created.id;
}

async function ensureRole(organizationId: string, employeeId: string, role: EmployeeRole) {
  const [existing] = await db
    .select({ id: employeeRoleAssignments.id })
    .from(employeeRoleAssignments)
    .where(
      and(
        eq(employeeRoleAssignments.organizationId, organizationId),
        eq(employeeRoleAssignments.employeeId, employeeId),
        eq(employeeRoleAssignments.role, role),
        isNull(employeeRoleAssignments.deletedAt),
      ),
    );
  if (!existing) {
    await db.insert(employeeRoleAssignments).values({ organizationId, employeeId, role });
  }
}

/**
 * Sjekkene, så grunndataene i prøveorganisasjonen (idempotent). Gir det delene trenger, og om
 * organisasjonen ble laget nå.
 */
export async function prepareSampleSeed(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): Promise<{ context: SampleSeedContext; organization: SamplePartResult }> {
  const { admin, organization: found } = await checkBeforeWriting(env);

  let organizationResult: SamplePartResult = "existing";
  let organizationId = found?.id ?? null;
  if (organizationId === null) {
    const [created] = await db
      .insert(organizations)
      .values({
        name: SAMPLE_ORGANIZATION_NAME,
        brandName: SAMPLE_ORGANIZATION_NAME,
        settings: { sampleData: true },
      })
      .returning({ id: organizations.id });
    if (!created) throw new Error("kunne ikke opprette prøveorganisasjonen");
    organizationId = created.id;
    organizationResult = "created";
  }

  let [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, organizationId),
        eq(companies.legalName, SAMPLE_COMPANY_NAME),
        isNull(companies.deletedAt),
      ),
    );
  if (!company) {
    [company] = await db
      .insert(companies)
      .values({ organizationId, legalName: SAMPLE_COMPANY_NAME })
      .returning({ id: companies.id });
  }
  if (!company) throw new Error("kunne ikke opprette prøveselskapet");

  let [office] = await db
    .select({ id: offices.id })
    .from(offices)
    .where(
      and(
        eq(offices.organizationId, organizationId),
        eq(offices.name, SAMPLE_OFFICE_NAME),
        isNull(offices.deletedAt),
      ),
    );
  if (!office) {
    [office] = await db
      .insert(offices)
      .values({ organizationId, name: SAMPLE_OFFICE_NAME, sortOrder: 1 })
      .returning({ id: offices.id });
  }
  if (!office) throw new Error("kunne ikke opprette prøvekontoret");

  // Admin fra `SEED_ADMIN_EMAIL`: den som utfører kallene til tjenestene
  const adminEmployeeId = await ensureEmployee(organizationId, admin.id, admin.name, {
    companyId: null,
    officeId: null,
  });
  await ensureRole(organizationId, adminEmployeeId, "admin");

  // Prøvetakstmannen, ansatt i prøveselskapet før han settes som ansvarlig (A67)
  const inspectorEmail = SAMPLE_INSPECTOR.email.toLowerCase();
  let [inspectorUser] = await db.select().from(users).where(eq(users.email, inspectorEmail));
  if (!inspectorUser) {
    [inspectorUser] = await db
      .insert(users)
      .values({ id: randomUUID(), email: inspectorEmail, name: SAMPLE_INSPECTOR.name })
      .returning();
  }
  if (!inspectorUser) throw new Error("kunne ikke opprette prøvetakstmannen");
  const inspectorEmployeeId = await ensureEmployee(
    organizationId,
    inspectorUser.id,
    SAMPLE_INSPECTOR.name,
    { companyId: company.id, officeId: office.id },
  );
  await ensureRole(organizationId, inspectorEmployeeId, "inspector");

  return {
    context: {
      actor: { id: admin.id, email: admin.email, name: admin.name },
      organizationId,
      officeId: office.id,
      inspectorEmployeeId,
      now,
    },
    organization: organizationResult,
  };
}

// ---------------------------------------------------------------------------------------------
// KI i prøveorganisasjonen (docs/funksjoner/fase2a-ki-modul-logg.md Omfang 8, A160)
// ---------------------------------------------------------------------------------------------

/** Porten for KI. Strengen er bare lov her og i `src/core/ai` (statisk test der). */
const AI_PORT = "ai";

/** Organisasjonen har merket `settings.sampleData = true` (boolsk, ikke tekst). */
const IS_SAMPLE_ORGANIZATION = sql`${organizations.settings} -> 'sampleData' = 'true'::jsonb`;

/**
 * Organisasjonen finnes og har merket `settings.sampleData = true`. Samme vilkår som
 * `ensureSampleAi` (`IS_SAMPLE_ORGANIZATION`), så alle deler av seed sjekker merket likt.
 */
export async function isSampleOrganization(organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), IS_SAMPLE_ORGANIZATION))
    .limit(1);
  return row !== undefined;
}

/**
 * Slår på KI med den falske leverandøren i prøveorganisasjonen, slik at de ansatte kan prøve
 * KI-forslag i testmiljøet uten kostnad og uten at data sendes ut. Kalles etter
 * `prepareSampleSeed`, men sjekker merket `settings.sampleData = true` selv, i samme spørring som
 * skriver eller avgjør (docs/funksjoner/fase2a-forslagsmonster.md Omfang 7). Uten merket gjøres
 * ingenting, og svaret er `skipped`.
 *
 * - `ai.enabled = true` settes bare når nøkkelen mangler. Én spørring slår nøkkelen sammen med de
 *   andre (`settings || …`), så ingen annen nøkkel endres. Har admin satt `false`, står det.
 * - Tilkoblingen lages med `createConnection` (validering og revisjonslogg) bare når
 *   organisasjonen har merket og ikke har noen rad på porten, heller ikke deaktivert, med feil,
 *   med annen leverandør eller mykt slettet. En rad som finnes, røres ikke.
 */
export async function ensureSampleAi(context: SampleSeedContext): Promise<SampleAiSummary> {
  const { organizationId } = context;
  const updated = await db
    .update(organizations)
    .set({
      settings: sql`${organizations.settings} || ${JSON.stringify({ [AI_ENABLED_SETTING_KEY]: true })}::jsonb`,
      updatedAt: context.now,
    })
    .where(
      and(
        eq(organizations.id, organizationId),
        IS_SAMPLE_ORGANIZATION,
        sql`${organizations.settings} -> ${AI_ENABLED_SETTING_KEY} is null`,
      ),
    )
    .returning({ id: organizations.id });

  // Merket og tilkoblingen leses i samme spørring: ingen rad betyr at merket mangler
  const [sample] = await db
    .select({ connectionId: integrationConnections.id })
    .from(organizations)
    .leftJoin(
      integrationConnections,
      and(
        eq(integrationConnections.organizationId, organizations.id),
        eq(integrationConnections.port, AI_PORT),
      ),
    )
    .where(and(eq(organizations.id, organizationId), IS_SAMPLE_ORGANIZATION))
    .limit(1);
  if (!sample) {
    return { setting: updated.length > 0 ? "created" : "skipped", connection: "skipped" };
  }
  const setting: SampleResult = updated.length > 0 ? "created" : "existing";
  if (sample.connectionId !== null) return { setting, connection: "existing" };

  await createConnection(context.actor, organizationId, { port: AI_PORT, provider: "fake" });
  return { setting, connection: "created" };
}

// ---------------------------------------------------------------------------------------------
// Systemmalen med badet i prøveorganisasjonen (docs/funksjoner/fase2a-mal-bad.md Omfang 6)
// ---------------------------------------------------------------------------------------------

/** Familien for systemmalen for tilstandsrapport. */
const SAMPLE_TEMPLATE_FAMILY = {
  name: "Tilstandsrapport bolig",
  kind: "system",
  report_type: "condition_report",
} as const;

const SAMPLE_TEMPLATE_CHANGE_NOTE =
  "Lagt inn av seed i prøveorganisasjonen. Tekstene er utkast, ikke godkjent av fagrådet.";

/**
 * Publiserer systemmalen «Tilstandsrapport bolig» med badet i prøveorganisasjonen, slik at
 * regler, skjerm og PDF kan prøves på testoppdragene. Admin fra `context` utfører, og alt går
 * gjennom tjenestene i `src/core/templates` (tilgang, validering, revisjonslogg).
 *
 * - Uten merket `settings.sampleData = true` (`isSampleOrganization`): `skipped`, ingenting skrives.
 * - Familien finnes ikke: `createTemplateFamily` (lager tomt utkast v1).
 * - Siste publiserte versjon har samme innhold som `document`: `existing`. Ingenting skrives, og
 *   et utkast som finnes, står.
 * - Ellers brukes utkastet som finnes, eller et nytt lages med `createDraftVersion`. Innholdet
 *   lagres og publiseres: `created`. Forrige publiserte versjon blir `retired` av tjenesten.
 *
 * `document` er et argument, så testene kan prøve endret innhold uten å endre malfilen.
 */
export async function ensureSampleTemplate(
  context: SampleSeedContext,
  document: unknown = wetRoomTemplate,
): Promise<SampleResult> {
  const { actor, organizationId, now } = context;
  if (!(await isSampleOrganization(organizationId))) return "skipped";

  const parsed = parseTemplateDocument(document);
  if (!parsed.success) {
    throw new Error(
      `Malen for badet er ugyldig (${parsed.issues.length} feil). Ingenting er endret.`,
    );
  }

  const families = await listTemplateFamilies(actor, organizationId);
  let family = families.find(
    (candidate) =>
      candidate.name === SAMPLE_TEMPLATE_FAMILY.name &&
      candidate.kind === SAMPLE_TEMPLATE_FAMILY.kind &&
      candidate.reportType === SAMPLE_TEMPLATE_FAMILY.report_type,
  );
  if (!family) {
    const { familyId } = await createTemplateFamily(actor, organizationId, SAMPLE_TEMPLATE_FAMILY);
    family = (await listTemplateFamilies(actor, organizationId)).find((f) => f.id === familyId);
    if (!family) throw new Error("fant ikke malfamilien etter at den ble laget");
  }

  // Versjonene kommer med høyeste versjonsnummer først
  const published = family.versions.find((version) => version.status === "published");
  if (published) {
    const current = await getTemplateVersion(actor, organizationId, published.id);
    if (isSameTemplateContent(current.document, parsed.document)) return "existing";
  }

  const draft = family.versions.find((version) => version.status === "draft");
  const versionId =
    draft?.id ?? (await createDraftVersion(actor, organizationId, family.id, now)).versionId;
  await saveDraftContent(actor, organizationId, versionId, parsed.document, now);
  await publishVersion(actor, organizationId, versionId, SAMPLE_TEMPLATE_CHANGE_NOTE, now);
  return "created";
}

// ---------------------------------------------------------------------------------------------
// Delene av ett testoppdrag, i fast rekkefølge. Hver del lager bare det som mangler.
// ---------------------------------------------------------------------------------------------

/** Ordren. Finnes den avvist, slettet eller med kansellert oppdrag: `skipped`. */
export async function ensureSampleOrder(
  context: SampleSeedContext,
  sample: SampleAssignment,
): Promise<{ result: SampleResult; order: SampleOrderRow | null }> {
  const matching = (await findSampleOrders(context.organizationId)).filter(
    (order) => order.externalRef === sample.externalRef,
  );
  if (matching.some(isUnusable)) return { result: "skipped", order: null };
  const [existing] = matching;
  if (existing) return { result: "existing", order: existing };

  const created = await createOrder(
    context.actor,
    context.organizationId,
    { ...sample.order, externalRef: sample.externalRef },
    context.now,
  );
  return {
    result: "created",
    order: {
      id: created.id,
      externalRef: created.externalRef,
      status: created.status,
      assignmentId: created.assignmentId,
      orderDeletedAt: created.deletedAt,
      assignmentDeletedAt: null,
    },
  };
}

/** Ordren gjort om til oppdrag (nummer fra nummerserien). */
export async function ensureSampleConversion(
  context: SampleSeedContext,
  order: SampleOrderRow,
): Promise<{ result: SamplePartResult; assignmentId: string }> {
  if (order.assignmentId !== null) return { result: "existing", assignmentId: order.assignmentId };
  const { assignment } = await convertOrderToAssignment(
    context.actor,
    context.organizationId,
    order.id,
    { officeId: context.officeId, now: context.now },
  );
  return { result: "created", assignmentId: assignment.id };
}

/** Prøvetakstmannen som ansvarlig. Har oppdraget hatt en ansvarlig, røres ikke teamet. */
export async function ensureSampleTeam(
  context: SampleSeedContext,
  assignmentId: string,
): Promise<SamplePartResult> {
  const [existing] = await db
    .select({ id: assignmentTeamMembers.id })
    .from(assignmentTeamMembers)
    .where(
      and(
        eq(assignmentTeamMembers.organizationId, context.organizationId),
        eq(assignmentTeamMembers.assignmentId, assignmentId),
        eq(assignmentTeamMembers.teamRole, "responsible"),
      ),
    )
    .limit(1);
  if (existing) return "existing";
  await setTeamMember(context.actor, context.organizationId, assignmentId, {
    teamRole: "responsible",
    employeeId: context.inspectorEmployeeId,
    now: context.now,
  });
  return "created";
}

/** Statusen fra datafilen. Bare fra Bestilt til Under arbeid; annen status røres ikke. */
export async function ensureSampleStatus(
  context: SampleSeedContext,
  assignmentId: string,
  sample: SampleAssignment,
): Promise<SamplePartResult> {
  if (sample.status !== "in_progress") return "existing";
  const [assignment] = await db
    .select({ status: assignments.status })
    .from(assignments)
    .where(
      and(eq(assignments.id, assignmentId), eq(assignments.organizationId, context.organizationId)),
    );
  if (assignment?.status !== "ordered") return "existing";
  await changeAssignmentStatus(context.actor, context.organizationId, assignmentId, {
    expectedStatus: "ordered",
    toStatus: "in_progress",
    now: context.now,
  });
  return "created";
}

/** Eiendommen med matrikkel, og fellesdelene der datafilen har dem. Hver sjekkes for seg. */
export async function ensureSampleProperty(
  context: SampleSeedContext,
  assignmentId: string,
  sample: SampleAssignment,
): Promise<SamplePartResult> {
  let result: SamplePartResult = "existing";
  const [assignment] = await db
    .select({ propertyId: assignments.propertyId })
    .from(assignments)
    .where(
      and(eq(assignments.id, assignmentId), eq(assignments.organizationId, context.organizationId)),
    );
  if (!assignment?.propertyId) {
    await saveAssignmentProperty(context.actor, context.organizationId, assignmentId, {
      ...sample.property,
    });
    result = "created";
  }

  if (sample.commonAreas !== null) {
    const [existing] = await db
      .select({ id: commonAreas.id })
      .from(commonAreas)
      .where(
        and(
          eq(commonAreas.organizationId, context.organizationId),
          eq(commonAreas.assignmentId, assignmentId),
        ),
      )
      .limit(1);
    if (!existing) {
      await saveCommonAreas(context.actor, context.organizationId, assignmentId, {
        ...sample.commonAreas,
      });
      result = "created";
    }
  }
  return result;
}

/**
 * Bygningene med etasjer, areal og rom, vurdert samlet: finnes noen bygning på oppdraget (også
 * fjernet), røres ingenting. «Målt av» er prøvetakstmannen.
 */
export async function ensureSampleBuildings(
  context: SampleSeedContext,
  assignmentId: string,
  sample: SampleAssignment,
): Promise<SamplePartResult> {
  const [existing] = await db
    .select({ id: reportBuildings.id })
    .from(reportBuildings)
    .where(
      and(
        eq(reportBuildings.organizationId, context.organizationId),
        eq(reportBuildings.assignmentId, assignmentId),
      ),
    )
    .limit(1);
  if (existing) return "existing";

  const { actor, organizationId } = context;
  for (const building of sample.buildings) {
    const savedBuilding = await saveBuilding(actor, organizationId, assignmentId, null, {
      name: building.name,
    });
    for (const floor of building.floors) {
      const savedFloor = await saveFloor(actor, organizationId, savedBuilding.id, null, {
        name: floor.name,
        level: floor.level,
        belowGround: floor.belowGround,
      });
      await saveFloorArea(actor, organizationId, savedFloor.id, {
        braI: floor.area.braI,
        braE: floor.area.braE,
        braB: floor.area.braB,
        alh: floor.area.alh,
        method: floor.area.method,
        comment: floor.area.comment,
        measuredBy: context.inspectorEmployeeId,
      });
      for (const room of floor.rooms) {
        await saveRoom(actor, organizationId, savedFloor.id, null, {
          roomType: room.roomType,
          name: room.name,
          areaType: room.areaType,
          belowGround: room.belowGround,
        });
      }
    }
  }
  return "created";
}

/** Partene, vurdert samlet: finnes noen part på oppdraget (også fjernet), røres ingenting. */
export async function ensureSampleParties(
  context: SampleSeedContext,
  assignmentId: string,
  sample: SampleAssignment,
): Promise<SamplePartResult> {
  const [existing] = await db
    .select({ id: assignmentParties.id })
    .from(assignmentParties)
    .where(
      and(
        eq(assignmentParties.organizationId, context.organizationId),
        eq(assignmentParties.assignmentId, assignmentId),
      ),
    )
    .limit(1);
  if (existing) return "existing";
  for (const party of sample.parties) {
    await addParty(context.actor, context.organizationId, assignmentId, { ...party });
  }
  return "created";
}

/** Ett testoppdrag: delene i fast rekkefølge. `created` når minst én del ble laget nå. */
export async function ensureSampleAssignment(
  context: SampleSeedContext,
  sample: SampleAssignment,
): Promise<SampleResult> {
  const { result: orderResult, order } = await ensureSampleOrder(context, sample);
  if (orderResult === "skipped" || order === null) return "skipped";

  const { result: conversionResult, assignmentId } = await ensureSampleConversion(context, order);
  const parts: SamplePartResult[] = [orderResult as SamplePartResult, conversionResult];
  parts.push(await ensureSampleTeam(context, assignmentId));
  parts.push(await ensureSampleStatus(context, assignmentId, sample));
  parts.push(await ensureSampleProperty(context, assignmentId, sample));
  parts.push(await ensureSampleBuildings(context, assignmentId, sample));
  parts.push(await ensureSampleParties(context, assignmentId, sample));
  return parts.includes("created") ? "created" : "existing";
}

/** `pnpm db:seed:testoppdrag`. `now` gir faste datoer i testene. */
export async function runSampleSeed(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): Promise<SampleSeedSummary> {
  const { context, organization } = await prepareSampleSeed(env, now);
  console.log(`Prøveorganisasjon: ${RESULT_LABELS[organization]}`);

  const ai = await ensureSampleAi(context);
  console.log(
    `KI på (falsk leverandør): ${RESULT_LABELS[ai.setting]}, tilkobling: ${RESULT_LABELS[ai.connection]}`,
  );

  const template = await ensureSampleTemplate(context);
  console.log(`Systemmal med bad: ${RESULT_LABELS[template]}`);

  const summary: SampleSeedSummary = { organization, ai, template, assignments: [] };
  for (const sample of SAMPLE_ASSIGNMENTS) {
    const result = await ensureSampleAssignment(context, sample);
    summary.assignments.push({ externalRef: sample.externalRef, result });
    console.log(`Testoppdrag ${sample.externalRef}: ${RESULT_LABELS[result]}`);
  }
  return summary;
}
