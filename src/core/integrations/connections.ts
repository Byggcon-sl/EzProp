import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { integrationConnections, type IntegrationConnection } from "@/db/schema";
import { logger, scrubText } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import {
  CONNECTION_STATUSES,
  isIntegrationPort,
  isProviderForPort,
  type ConnectionStatus,
  type IntegrationPort,
} from "./ports";
import { isValidSecretRef } from "./secrets";
import { providerRequiresSecret, settingsSchemaFor } from "./settings";

/*
 * Tjenesten for tilkoblinger (docs/funksjoner/fase0b-tilkoblingslag.md, Omfang 4). Bare admin
 * (`organization.manage`). Tilgang bare via `requireOrganizationAccess`, og alle spørringer
 * filtrerer på `grant.organizationId`. Hver endring admin gjør får én rad i revisjonsloggen;
 * laget sine egne skrivinger (`last_ok_at`, `last_error`, `status = error`) får ingen.
 */

const ENTITY_TYPE = "integration_connection";
const MAX_LAST_ERROR = 500;

/** Tilkoblingen finnes ikke, er merket som slettet eller tilhører en annen organisasjon. */
export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Fant ikke tilkoblingen.");
    this.name = "ConnectionNotFoundError";
  }
}

/** Tilkoblingen er ugyldig. Meldingen gjentar aldri en verdi fra skjemaet. */
export class ConnectionValidationError extends Error {
  constructor(message = "Tilkoblingen er ugyldig.") {
    super(message);
    this.name = "ConnectionValidationError";
  }
}

export type ConnectionSummary = {
  id: string;
  port: string;
  provider: string;
  status: string;
  secretRef: string | null;
  settings: Record<string, unknown>;
  lastOkAt: Date | null;
  lastError: string | null;
};

export type CreateConnectionInput = {
  port: IntegrationPort;
  provider: string;
  secretRef?: string | null;
  settings?: Record<string, unknown>;
};

export type UpdateConnectionInput = {
  status?: Exclude<ConnectionStatus, "error">;
  secretRef?: string | null;
  settings?: Record<string, unknown>;
};

const settingsField = z.record(z.string(), z.unknown());

const createSchema = z
  .object({
    port: z.string(),
    provider: z.string(),
    secretRef: z.string().nullable().optional(),
    settings: settingsField.optional(),
  })
  .strict();

const ADMIN_STATUSES = CONNECTION_STATUSES.filter((status) => status !== "error") as [
  "active",
  "disabled",
];

const updateSchema = z
  .object({
    status: z.enum(ADMIN_STATUSES).optional(),
    secretRef: z.string().nullable().optional(),
    settings: settingsField.optional(),
  })
  .strict();

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

function toSummary(row: IntegrationConnection): ConnectionSummary {
  return {
    id: row.id,
    port: row.port,
    provider: row.provider,
    status: row.status,
    secretRef: row.secretRef,
    settings: row.settings,
    lastOkAt: row.lastOkAt,
    lastError: row.lastError,
  };
}

/** Sjekker `secretRef` og `settings` mot leverandøren. Kaster `ConnectionValidationError`. */
function validateForProvider(
  provider: string,
  secretRef: string | null,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  if (secretRef !== null && !isValidSecretRef(secretRef)) {
    throw new ConnectionValidationError("Navnet på hemmeligheten er ugyldig.");
  }
  if (secretRef === null && providerRequiresSecret(provider)) {
    throw new ConnectionValidationError("Leverandøren trenger navnet på en hemmelighet.");
  }
  const schema = settingsSchemaFor(provider);
  if (!schema) throw new ConnectionValidationError("Ukjent leverandør.");
  const parsed = schema.safeParse(settings);
  if (!parsed.success) {
    throw new ConnectionValidationError("Innstillingene passer ikke til leverandøren.");
  }
  return parsed.data;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

/** Alle tilkoblinger i organisasjonen som ikke er slettet, sortert på port og leverandør. */
export async function listConnections(
  actor: Actor,
  organizationId: string,
): Promise<ConnectionSummary[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  return db
    .select(summaryColumns)
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, grant.organizationId),
        isNull(integrationConnections.deletedAt),
      ),
    )
    .orderBy(asc(integrationConnections.port), asc(integrationConnections.provider));
}

/**
 * Lager en tilkobling. Alt valideres før noe skrives. Én per organisasjon og port blant rader
 * som ikke er slettet (også `disabled` sperrer). Revisjonsloggen får port, leverandør,
 * navnet på hemmeligheten og nøklene i `settings`, aldri verdiene.
 */
export async function createConnection(
  actor: Actor,
  organizationId: string,
  input: CreateConnectionInput,
): Promise<ConnectionSummary> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new ConnectionValidationError();
  const { port, provider } = parsed.data;
  if (!isIntegrationPort(port)) throw new ConnectionValidationError("Ukjent port.");
  if (!isProviderForPort(port, provider)) {
    throw new ConnectionValidationError("Leverandøren hører ikke til porten.");
  }
  const secretRef = parsed.data.secretRef ?? null;
  const settings = validateForProvider(provider, secretRef, parsed.data.settings ?? {});

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
      if (existing) {
        throw new ConnectionValidationError("Organisasjonen har alt en tilkobling for porten.");
      }

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
        .returning();
      if (!row) throw new Error("Kunne ikke lagre tilkoblingen.");
      await recordAuditEvent(tx, grant, {
        entityType: ENTITY_TYPE,
        entityId: row.id,
        action: "create",
        changes: { port, provider, secretRef, settingsKeys: Object.keys(settings).sort() },
      });
      return toSummary(row);
    });
  } catch (error) {
    // Databasen er siste skanse mot to samtidige innsettinger
    if (isUniqueViolation(error)) {
      throw new ConnectionValidationError("Organisasjonen har alt en tilkobling for porten.");
    }
    throw error;
  }
}

/** Nøklene som er lagt til, tatt bort eller har fått ny verdi. */
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

/**
 * Endrer status (`active`/`disabled`), navnet på hemmeligheten eller `settings`. Port og
 * leverandør kan ikke endres. `settings` sjekkes mot leverandøren på raden. `last_error` røres
 * ikke. Input som ikke endrer noe, skriver ingenting.
 */
export async function updateConnection(
  actor: Actor,
  organizationId: string,
  connectionId: string,
  input: UpdateConnectionInput,
): Promise<ConnectionSummary> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new ConnectionValidationError();
  if (!isUuid(connectionId)) throw new ConnectionNotFoundError();

  return db.transaction(async (tx) => {
    const where = and(
      eq(integrationConnections.id, connectionId),
      eq(integrationConnections.organizationId, grant.organizationId),
      isNull(integrationConnections.deletedAt),
    );
    const [before] = await tx.select().from(integrationConnections).where(where).for("update");
    if (!before) throw new ConnectionNotFoundError();

    const status = parsed.data.status ?? before.status;
    const secretRef =
      parsed.data.secretRef === undefined ? before.secretRef : parsed.data.secretRef;
    const touchesSecretOrSettings =
      parsed.data.secretRef !== undefined || parsed.data.settings !== undefined;
    const settings = touchesSecretOrSettings
      ? validateForProvider(
          before.provider,
          secretRef,
          parsed.data.settings === undefined ? before.settings : parsed.data.settings,
        )
      : before.settings;

    const changes: Record<string, unknown> = {};
    if (status !== before.status) changes.status = { from: before.status, to: status };
    if (secretRef !== before.secretRef) {
      changes.secretRef = { from: before.secretRef, to: secretRef };
    }
    const keys = parsed.data.settings === undefined ? [] : changedKeys(before.settings, settings);
    if (keys.length > 0) changes.settings = { keys };
    if (Object.keys(changes).length === 0) return toSummary(before);

    const [row] = await tx
      .update(integrationConnections)
      .set({
        status,
        secretRef,
        ...(keys.length > 0 && { settings }),
        updatedBy: grant.employeeId,
      })
      .where(where)
      .returning();
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

/** Merker tilkoblingen som slettet (myk sletting, regel 3). */
export async function markConnectionDeleted(
  actor: Actor,
  organizationId: string,
  connectionId: string,
): Promise<void> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  if (!isUuid(connectionId)) throw new ConnectionNotFoundError();

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(integrationConnections)
      .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(
        and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.organizationId, grant.organizationId),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new ConnectionNotFoundError();
    await recordAuditEvent(tx, grant, {
      entityType: ENTITY_TYPE,
      entityId: row.id,
      action: "delete",
      changes: { port: row.port, provider: row.provider },
    });
  });
}

/**
 * Den aktive tilkoblingen for porten (status ulik `disabled`, ikke slettet), eller `null`.
 * Intern: uten tilgangssjekk, brukes bare av laget selv. Kalles alltid med `grant.organizationId`
 * eller en organisasjon laget selv kjenner, aldri med en id fra adresse eller skjema.
 * Eksporteres ikke fra `index.ts`.
 */
export async function findActiveConnection(
  organizationId: string,
  port: IntegrationPort,
): Promise<IntegrationConnection | null> {
  if (!isUuid(organizationId)) return null;
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.port, port),
        ne(integrationConnections.status, "disabled"),
        isNull(integrationConnections.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Laget sin egen oppdatering etter bruk av en tilkobling: suksess setter `last_ok_at`, tømmer
 * `last_error` og setter `error` tilbake til `active`; feil setter `last_error` (vasket, høyst
 * 500 tegn) og `status = error`. En `disabled` eller slettet rad røres ikke. Ingen rad i
 * revisjonsloggen (systemets egne skrivinger). Feiler skrivingen, logges det, og ingenting kastes.
 * Intern, eksporteres ikke fra `index.ts`.
 */
export async function recordConnectionResult(
  organizationId: string,
  connectionId: string,
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  const where = and(
    eq(integrationConnections.id, connectionId),
    eq(integrationConnections.organizationId, organizationId),
    ne(integrationConnections.status, "disabled"),
    isNull(integrationConnections.deletedAt),
  );
  try {
    if (result.ok) {
      await db
        .update(integrationConnections)
        .set({ lastOkAt: new Date(), lastError: null, status: "active" })
        .where(where);
    } else {
      await db
        .update(integrationConnections)
        .set({ lastError: scrubText(result.error).slice(0, MAX_LAST_ERROR), status: "error" })
        .where(where);
    }
  } catch {
    logger.error("Kunne ikke oppdatere status på en tilkobling", { connectionId });
  }
}
