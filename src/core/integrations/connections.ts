import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { ConnectionNotFoundError, ConnectionValidationError } from "./errors";
import { INTEGRATION_PORTS, PROVIDERS_BY_PORT, type ConnectionStatus } from "./ports";
import { isValidSecretRef } from "./secrets";

export { ConnectionNotFoundError, ConnectionValidationError } from "./errors";

/*
 * Tjenesten for tilkoblinger (docs/funksjoner/fase0b-tilkoblingslag.md). Bare admin
 * (`organization.manage`). Tilgang bare via `requireOrganizationAccess`, og alle spørringer
 * filtrerer på `grant.organizationId`. Revisjonsloggen får aldri verdier fra `settings` (der kan
 * det stå en adresse), bare nøklene.
 */

const ENTITY_TYPE = "integration_connection";
const UNIQUE_INDEX = "integration_connections_organization_id_port_unique";

export type ConnectionSummary = {
  id: string;
  port: string;
  provider: string;
  status: ConnectionStatus;
  secretRef: string | null;
  settings: Record<string, unknown>;
  lastOkAt: Date | null;
  lastError: string | null;
};

export type CreateConnectionInput = {
  port: string;
  provider: string;
  secretRef?: string;
  settings?: Record<string, unknown>;
};

export type UpdateConnectionInput = {
  status?: "active" | "disabled";
  secretRef?: string | null;
  settings?: Record<string, unknown>;
};

/** Leverandører som krever navnet på en hemmelighet. */
const PROVIDERS_REQUIRING_SECRET = ["microsoft365"];

/** `settings` for `microsoft365`. Brukes også av e-postporten når senderen lages fra raden. */
export const microsoft365SettingsSchema = z
  .object({
    from: z.email(),
    tenantId: z.string().regex(/^[A-Za-z0-9.-]{1,64}$/),
    clientId: z.string().min(1),
  })
  .strict();
const emptySettingsSchema = z.object({}).strict();

/**
 * Zod-skjemaet for `settings` til leverandøren, eller `null` for en ukjent leverandør.
 * Brukes også når e-postporten lager en sender fra raden.
 */
export function settingsSchemaFor(provider: string) {
  switch (provider) {
    case "microsoft365":
      return microsoft365SettingsSchema;
    case "dev_mailbox":
    case "server_log":
      return emptySettingsSchema;
    default:
      return null;
  }
}

const secretRefSchema = z.string().refine(isValidSecretRef);
const settingsInputSchema = z.record(z.string(), z.unknown());

const createInputSchema = z
  .object({
    port: z.enum(INTEGRATION_PORTS),
    provider: z.string(),
    secretRef: secretRefSchema.optional(),
    settings: settingsInputSchema.optional(),
  })
  .strict();

const updateInputSchema = z
  .object({
    status: z.enum(["active", "disabled"]).optional(),
    secretRef: secretRefSchema.nullable().optional(),
    settings: settingsInputSchema.optional(),
  })
  .strict();

function validateSettings(provider: string, settings: unknown): Record<string, unknown> {
  const schema = settingsSchemaFor(provider);
  if (!schema) throw new ConnectionValidationError();
  const parsed = schema.safeParse(settings);
  if (!parsed.success) throw new ConnectionValidationError();
  return parsed.data as Record<string, unknown>;
}

const summaryColumns = {
  id: integrationConnections.id,
  port: integrationConnections.port,
  provider: integrationConnections.provider,
  status: integrationConnections.status,
  secretRef: integrationConnections.secretRef,
  settings: integrationConnections.settings,
  lastOkAt: integrationConnections.lastOkAt,
  lastError: integrationConnections.lastError,
};

type SummaryRow = {
  id: string;
  port: string;
  provider: string;
  status: string;
  secretRef: string | null;
  settings: Record<string, unknown>;
  lastOkAt: Date | null;
  lastError: string | null;
};

function toSummary(row: SummaryRow): ConnectionSummary {
  return {
    id: row.id,
    port: row.port,
    provider: row.provider,
    status: row.status as ConnectionStatus,
    secretRef: row.secretRef,
    settings: row.settings,
    lastOkAt: row.lastOkAt,
    lastError: row.lastError,
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint_name === UNIQUE_INDEX) return true;
    current = candidate.cause;
  }
  return false;
}

/** Nøklene som er lagt til, fjernet eller har fått ny verdi. Sortert, uten verdier. */
function changedSettingsKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

/** Alle tilkoblinger i organisasjonen som ikke er slettet, sortert på port og leverandør. */
export async function listConnections(
  actor: Actor,
  organizationId: string,
): Promise<ConnectionSummary[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const rows = await db
    .select(summaryColumns)
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, grant.organizationId),
        isNull(integrationConnections.deletedAt),
      ),
    )
    .orderBy(asc(integrationConnections.port), asc(integrationConnections.provider));
  return rows.map(toSummary);
}

/**
 * Lager en tilkobling. Alt valideres før noe skrives. Én tilkobling per organisasjon og port
 * blant rader som ikke er slettet, uansett status.
 */
export async function createConnection(
  actor: Actor,
  organizationId: string,
  input: CreateConnectionInput,
): Promise<ConnectionSummary> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) throw new ConnectionValidationError();
  const { port, provider } = parsed.data;
  if (!PROVIDERS_BY_PORT[port].includes(provider)) {
    throw new ConnectionValidationError("Leverandøren er ukjent for denne porten.");
  }
  const secretRef = parsed.data.secretRef ?? null;
  if (PROVIDERS_REQUIRING_SECRET.includes(provider) && !secretRef) {
    throw new ConnectionValidationError("Tilkoblingen må ha navnet på en hemmelighet.");
  }
  const settings = validateSettings(provider, parsed.data.settings ?? {});

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: integrationConnections.id })
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.organizationId, grant.organizationId),
            eq(integrationConnections.port, port),
            isNull(integrationConnections.deletedAt),
          ),
        );
      if (existing) throw duplicateError();

      const [row] = await tx
        .insert(integrationConnections)
        .values({
          organizationId: grant.organizationId,
          port,
          provider,
          status: "active",
          secretRef,
          settings,
          createdBy: grant.employeeId,
          updatedBy: grant.employeeId,
        })
        .returning(summaryColumns);
      if (!row) throw new Error("Kunne ikke lagre tilkoblingen.");
      await recordAuditEvent(tx, grant, {
        entityType: ENTITY_TYPE,
        entityId: row.id,
        action: "create",
        changes: { port, provider, secretRef, settingsKeys: Object.keys(settings) },
      });
      return toSummary(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateError();
    throw error;
  }
}

function duplicateError() {
  return new ConnectionValidationError("Det finnes alt en tilkobling for denne porten.");
}

/**
 * Endrer status (`active`/`disabled`), navnet på hemmeligheten eller `settings`. Port og
 * leverandør kan ikke endres. `last_error` og `last_ok_at` røres ikke. Ingen endring gir ingen
 * loggrad.
 */
export async function updateConnection(
  actor: Actor,
  organizationId: string,
  connectionId: string,
  input: UpdateConnectionInput,
): Promise<ConnectionSummary> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  if (!isUuid(connectionId)) throw new ConnectionNotFoundError();
  const parsed = updateInputSchema.safeParse(input);
  if (!parsed.success) throw new ConnectionValidationError();
  const patch = parsed.data;

  return db.transaction(async (tx) => {
    const where = and(
      eq(integrationConnections.id, connectionId),
      eq(integrationConnections.organizationId, grant.organizationId),
      isNull(integrationConnections.deletedAt),
    );
    const [before] = await tx
      .select(summaryColumns)
      .from(integrationConnections)
      .where(where)
      .for("update");
    if (!before) throw new ConnectionNotFoundError();

    const settings =
      patch.settings === undefined ? undefined : validateSettings(before.provider, patch.settings);
    if (patch.secretRef === null && PROVIDERS_REQUIRING_SECRET.includes(before.provider)) {
      throw new ConnectionValidationError("Tilkoblingen må ha navnet på en hemmelighet.");
    }

    const changes: Record<string, unknown> = {};
    const values: Partial<typeof integrationConnections.$inferInsert> = {};
    if (patch.status !== undefined && patch.status !== before.status) {
      changes.status = { from: before.status, to: patch.status };
      values.status = patch.status;
    }
    if (patch.secretRef !== undefined && patch.secretRef !== before.secretRef) {
      changes.secretRef = { from: before.secretRef, to: patch.secretRef };
      values.secretRef = patch.secretRef;
    }
    if (settings !== undefined) {
      const keys = changedSettingsKeys(before.settings, settings);
      if (keys.length > 0) {
        changes.settings = { keys };
        values.settings = settings;
      }
    }
    if (Object.keys(values).length === 0) return toSummary(before);

    const [row] = await tx
      .update(integrationConnections)
      .set({ ...values, updatedBy: grant.employeeId })
      .where(where)
      .returning(summaryColumns);
    if (!row) throw new ConnectionNotFoundError();
    await recordAuditEvent(tx, grant, {
      entityType: ENTITY_TYPE,
      entityId: row.id,
      action: "update",
      changes,
    });
    return toSummary(row);
  });
}

/** Merker tilkoblingen som slettet (myk sletting). */
export async function markConnectionDeleted(
  actor: Actor,
  organizationId: string,
  connectionId: string,
): Promise<ConnectionSummary> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  if (!isUuid(connectionId)) throw new ConnectionNotFoundError();

  return db.transaction(async (tx) => {
    const where = and(
      eq(integrationConnections.id, connectionId),
      eq(integrationConnections.organizationId, grant.organizationId),
      isNull(integrationConnections.deletedAt),
    );
    const [before] = await tx
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(where)
      .for("update");
    if (!before) throw new ConnectionNotFoundError();

    const [row] = await tx
      .update(integrationConnections)
      .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(where)
      .returning(summaryColumns);
    if (!row) throw new ConnectionNotFoundError();
    await recordAuditEvent(tx, grant, {
      entityType: ENTITY_TYPE,
      entityId: row.id,
      action: "delete",
      changes: { port: row.port, provider: row.provider },
    });
    return toSummary(row);
  });
}

/**
 * Tilkoblingen laget selv bruker for porten: ikke slettet og ikke `disabled`, eller `null`.
 * Uten tilgangssjekk. Kalles bare med `grant.organizationId` eller organisasjonen laget selv
 * kjenner, aldri med en id fra adressen eller skjemaet. Eksporteres ikke fra `index.ts`.
 */
export async function findActiveConnection(
  organizationId: string,
  port: (typeof INTEGRATION_PORTS)[number],
  executor: DbExecutor = db,
) {
  if (!isUuid(organizationId)) return null;
  const [row] = await executor
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.port, port),
        isNull(integrationConnections.deletedAt),
        ne(integrationConnections.status, "disabled"),
      ),
    );
  return row ?? null;
}
