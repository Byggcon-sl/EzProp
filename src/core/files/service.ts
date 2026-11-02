import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireOrganizationAccess, type Actor, type EmployeeGrant } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { files } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { createFileStorage } from "./config";
import {
  FileIntegrityError,
  FileNotFoundError,
  FileRetentionError,
  FileValidationError,
} from "./errors";
import { ALLOWED_MIME_TYPES, FILE_KINDS, MAX_FILE_BYTES, type FileKind } from "./kinds";

/*
 * Den felles filtjenesten (docs/funksjoner/fase0b-filtjeneste.md). Det modulene kaller for å
 * lagre og hente bilder og dokumenter. Tilgang bare via `requireOrganizationAccess`, og alle
 * spørringer filtrerer på `grant.organizationId`. Porten lages med `createFileStorage(process.env)`
 * ved hvert kall, slik at valg av adapter (og mappen i testene) følger miljøet.
 */

const saveFileSchema = z
  .object({
    kind: z.enum(FILE_KINDS),
    mimeType: z.string(),
    bytes: z.instanceof(Uint8Array),
  })
  .refine((input) => ALLOWED_MIME_TYPES[input.kind].includes(input.mimeType), {
    path: ["mimeType"],
  })
  .refine((input) => input.bytes.byteLength > 0 && input.bytes.byteLength <= MAX_FILE_BYTES, {
    path: ["bytes"],
  });

export type SaveFileInput = { kind: string; mimeType: string; bytes: Uint8Array };

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Den aktive (ikke slettede) raden i organisasjonen fra tilgangssjekken. Ugyldig id, fremmed
 * eller slettet rad gir `FileNotFoundError`. Eksportert for test (tenant-isolasjon).
 */
export async function findActiveFile(
  grant: EmployeeGrant,
  fileId: string,
  executor: DbExecutor = db,
) {
  if (!isUuid(fileId)) throw new FileNotFoundError();
  const [row] = await executor
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.organizationId, grant.organizationId),
        isNull(files.deletedAt),
      ),
    );
  if (!row) throw new FileNotFoundError();
  return row;
}

/**
 * Lagrer en fil: validerer før noe skrives, regner SHA-256, skriver innholdet via porten og så
 * raden. Nøkkelen er `<organisasjon>/<kind>/<id>`, aldri et filnavn fra brukeren. Feiler raden,
 * blir filen liggende uten rad (akseptert: ingenting slettes, og filen kan ikke nås uten rad).
 */
export async function saveFile(
  actor: Actor,
  organizationId: string,
  input: SaveFileInput,
): Promise<{ id: string; sha256: string; sizeBytes: number }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const parsed = saveFileSchema.safeParse(input);
  if (!parsed.success) throw new FileValidationError();
  const { mimeType, bytes } = parsed.data;
  const kind: FileKind = parsed.data.kind;

  const id = randomUUID();
  const sha256 = sha256Hex(bytes);
  const sizeBytes = bytes.byteLength;
  const storageKey = `${grant.organizationId}/${kind}/${id}`;

  const storage = createFileStorage(process.env);
  await storage.put(storageKey, bytes, mimeType);

  try {
    await db.insert(files).values({
      id,
      organizationId: grant.organizationId,
      storageKey,
      kind,
      mimeType,
      sizeBytes,
      sha256,
      createdBy: grant.employeeId,
      updatedBy: grant.employeeId,
    });
  } catch {
    // Den rå databasefeilen kan ha nøkkel og verdier; den kastes ikke videre.
    logger.error("Kunne ikke lagre raden for en fil", { organizationId: grant.organizationId });
    throw new Error("Kunne ikke lagre filen.");
  }

  return { id, sha256, sizeBytes };
}

/**
 * Henter en fil med innhold. Raden finnes med `grant.organizationId`, nøkkelen må begynne med
 * organisasjonen (ekstra forsvar), og fingeravtrykket må stemme.
 */
export async function readFile(
  actor: Actor,
  organizationId: string,
  fileId: string,
): Promise<{
  id: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
}> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const row = await findActiveFile(grant, fileId);
  if (!row.storageKey.startsWith(`${grant.organizationId}/`)) throw new FileNotFoundError();

  const storage = createFileStorage(process.env);
  const bytes = await storage.get(row.storageKey);
  if (bytes.byteLength !== row.sizeBytes || sha256Hex(bytes) !== row.sha256) {
    throw new FileIntegrityError();
  }

  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    bytes,
  };
}

/**
 * Merker en fil som slettet (myk sletting, A39). Bare admin (`organization.manage`). Avvises med
 * `FileRetentionError` så lenge `retain_until` er i fremtiden, også for admin. Filen i lagringen
 * røres ikke. Revisjonsloggen får bare `fileId`, `kind` og `organizationId`.
 */
export async function markFileDeleted(actor: Actor, organizationId: string, fileId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  if (!isUuid(fileId)) throw new FileNotFoundError();

  return db.transaction(async (tx) => {
    const where = and(
      eq(files.id, fileId),
      eq(files.organizationId, grant.organizationId),
      isNull(files.deletedAt),
    );
    const [before] = await tx
      .select({ id: files.id, retainUntil: files.retainUntil })
      .from(files)
      .where(where)
      .for("update");
    if (!before) throw new FileNotFoundError();
    if (before.retainUntil && before.retainUntil.getTime() > Date.now()) {
      throw new FileRetentionError();
    }

    const [row] = await tx
      .update(files)
      .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(where)
      .returning();
    if (!row) throw new FileNotFoundError();
    await recordAuditEvent(tx, grant, {
      entityType: "file",
      entityId: row.id,
      action: "delete",
      changes: { fileId: row.id, kind: row.kind, organizationId: row.organizationId },
    });
    return row;
  });
}
