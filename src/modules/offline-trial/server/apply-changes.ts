/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Tar imot endringsbunten fra enheten og skriver den til `trial_*`-tabellene
 * (docs/funksjoner/fase1-kandidat-powersync.md pkt. 11). Hele bunten skrives i én transaksjon og
 * avvises ved første feil, så klienten kan prøve igjen uten halvskrevne data. Idempotent: samme
 * bunt to ganger gir samme data, og `row_version` øker bare når noe faktisk endres.
 *
 * Serveren eier `organization_id`, `created_by`, `updated_by`, `row_version`, `uploaded_at`,
 * `sha256` og `storage_path`; de overses fra nyttelasten. Ukjente kolonner overses også.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { requireOrganizationAccess, type Actor, type EmployeeGrant } from "@/core/access";
import type { DbExecutor } from "@/db/client";
import { db } from "@/db/client";
import { trialAnswers, trialForms, trialPhotos } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { mergeTextStates, textOf } from "../text-merge";
import { listTrialFields, trialForm, type TrialField } from "../trial-form";
import { trialChangeOperationsSchema, type ParsedTrialChangeOperation } from "./change-schema";
import { InvalidTrialChangeError, TrialIdConflictError } from "./errors";
import type { ApplyTrialChanges, TrialChangeOperation, TrialChangesResult } from "./types";

const fieldsByKey = new Map<string, TrialField>(
  listTrialFields(trialForm).map((field) => [field.key, field]),
);

/** Feltet med denne nøkkelen, eller `InvalidTrialChangeError` (bare de 40 kjente). */
export function requireTrialField(fieldKey: string): TrialField {
  const field = fieldsByKey.get(fieldKey);
  if (!field) throw new InvalidTrialChangeError("Ukjent felt i testskjemaet.");
  return field;
}

type Data = Record<string, unknown>;

function has(data: Data, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined;
}

/** Tekst fra nyttelasten. `undefined` = ikke sendt. Feil type gir `InvalidTrialChangeError`. */
function optionalText(data: Data, key: string): string | undefined {
  if (!has(data, key)) return undefined;
  const value = data[key];
  if (typeof value !== "string") throw new InvalidTrialChangeError();
  return value;
}

function optionalNullableText(data: Data, key: string): string | null | undefined {
  if (has(data, key) && data[key] === null) return null;
  return optionalText(data, key);
}

function optionalInteger(data: Data, key: string): number | undefined {
  if (!has(data, key)) return undefined;
  const value = typeof data[key] === "string" ? Number(data[key]) : data[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidTrialChangeError();
  }
  return value;
}

/** `created_at` fra enheten, så «laget når» viser tiden på iPaden. Ugyldig dato overses. */
function optionalDate(data: Data, key: string): Date | undefined {
  const value = data[key];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function requireUuid(value: string | undefined): string {
  if (value === undefined || !isUuid(value)) {
    throw new InvalidTrialChangeError();
  }
  return value;
}

/**
 * `value` slik den kom fra enheten: JSON-tekst fra den lokale databasen. Tekst som ikke er JSON,
 * brukes som den er. JSON `null` lagres som SQL NULL («ikke besvart»).
 */
function parseValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) ?? null;
  } catch {
    return raw;
  }
}

/** JSON med sorterte nøkler, så like verdier fra jsonb sammenlignes riktig. */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

const sameJson = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Tekst ut av tilstanden, eller `InvalidTrialChangeError` (aldri tom tekst i stillhet). */
function readText(state: string): string {
  try {
    return textOf(state);
  } catch {
    throw new InvalidTrialChangeError("Ugyldig teksttilstand.");
  }
}

class ChangeWriter {
  private readonly knownForms = new Set<string>();

  constructor(
    private readonly tx: DbExecutor,
    private readonly actor: Actor,
    private readonly grant: EmployeeGrant,
  ) {}

  private get organizationId() {
    return this.grant.organizationId;
  }

  /** Tenant-vokter på id: id-en finnes i en annen organisasjon i noen av de tre tabellene. */
  async rejectForeignIds(ids: string[]) {
    if (ids.length === 0) return;
    for (const table of [trialForms, trialAnswers, trialPhotos]) {
      const [foreign] = await this.tx
        .select({ id: table.id })
        .from(table)
        .where(and(inArray(table.id, ids), ne(table.organizationId, this.organizationId)))
        .limit(1);
      if (foreign) throw new TrialIdConflictError();
    }
  }

  /** Tenant-vokter på skjema: svar og bilder krever et skjema i egen organisasjon. */
  async requireForm(trialFormId: string) {
    if (this.knownForms.has(trialFormId)) return;
    const [form] = await this.tx
      .select({ id: trialForms.id })
      .from(trialForms)
      .where(
        and(eq(trialForms.id, trialFormId), eq(trialForms.organizationId, this.organizationId)),
      )
      .limit(1);
    if (!form) throw new InvalidTrialChangeError("Testskjemaet finnes ikke.");
    this.knownForms.add(trialFormId);
  }

  async apply(operation: ParsedTrialChangeOperation) {
    switch (operation.table) {
      case "trial_forms":
        return this.applyForm(operation);
      case "trial_answers":
        return this.applyAnswer(operation);
      case "trial_photos":
        return this.applyPhoto(operation);
      default:
        throw new InvalidTrialChangeError("Ukjent tabell.");
    }
  }

  private async applyForm({ id, data }: ParsedTrialChangeOperation) {
    const name = optionalText(data, "name");
    const [existing] = await this.tx
      .select({ name: trialForms.name })
      .from(trialForms)
      .where(and(eq(trialForms.id, id), eq(trialForms.organizationId, this.organizationId)))
      .limit(1);
    if (!existing) {
      if (name === undefined) throw new InvalidTrialChangeError("Testskjemaet mangler navn.");
      await this.tx.insert(trialForms).values({
        id,
        organizationId: this.organizationId,
        name,
        createdBy: this.actor.id,
        updatedBy: this.actor.id,
        ...(optionalDate(data, "created_at") && { createdAt: optionalDate(data, "created_at") }),
      });
      this.knownForms.add(id);
      return;
    }
    this.knownForms.add(id);
    if (name === undefined || name === existing.name) return;
    await this.tx
      .update(trialForms)
      .set({ name, updatedBy: this.actor.id })
      .where(and(eq(trialForms.id, id), eq(trialForms.organizationId, this.organizationId)));
  }

  private async applyAnswer({ id, data }: ParsedTrialChangeOperation) {
    const [byId] = await this.tx
      .select({ trialFormId: trialAnswers.trialFormId, fieldKey: trialAnswers.fieldKey })
      .from(trialAnswers)
      .where(and(eq(trialAnswers.id, id), eq(trialAnswers.organizationId, this.organizationId)))
      .limit(1);
    const sentFormId = optionalText(data, "trial_form_id");
    const sentFieldKey = optionalText(data, "field_key");
    // Nøklene til et svar endres aldri
    if (byId && sentFormId !== undefined && sentFormId !== byId.trialFormId) {
      throw new InvalidTrialChangeError();
    }
    if (byId && sentFieldKey !== undefined && sentFieldKey !== byId.fieldKey) {
      throw new InvalidTrialChangeError();
    }
    const trialFormId = requireUuid(sentFormId ?? byId?.trialFormId);
    const fieldKey = sentFieldKey ?? byId?.fieldKey;
    if (fieldKey === undefined) throw new InvalidTrialChangeError("Svaret mangler felt.");
    const field = requireTrialField(fieldKey);
    await this.requireForm(trialFormId);

    // Upsert på (trial_form_id, field_key): finnes raden med en annen id, beholdes serverens id
    const [existing] = await this.tx
      .select({
        id: trialAnswers.id,
        value: trialAnswers.value,
        textState: trialAnswers.textState,
        deviceId: trialAnswers.deviceId,
      })
      .from(trialAnswers)
      .where(
        and(
          eq(trialAnswers.organizationId, this.organizationId),
          eq(trialAnswers.trialFormId, trialFormId),
          eq(trialAnswers.fieldKey, fieldKey),
        ),
      )
      .limit(1);

    const deviceId = optionalText(data, "device_id") ?? existing?.deviceId ?? "unknown";
    let value: unknown = has(data, "value") ? parseValue(data.value) : (existing?.value ?? null);
    let textState: string | null = existing?.textState ?? null;

    if (field.type === "text") {
      const incoming = optionalNullableText(data, "text_state") ?? null;
      const stored = existing?.textState ?? null;
      if (incoming !== null || stored !== null) {
        // Teksttilstanden er sannheten: flett, og `value` er den flettede teksten
        if (incoming !== null) readText(incoming);
        if (stored !== null) readText(stored);
        textState =
          incoming !== null && stored !== null
            ? mergeTextStates(stored, incoming)
            : (incoming ?? stored);
        value = readText(textState as string);
      }
    }

    if (!existing) {
      await this.tx.insert(trialAnswers).values({
        id,
        organizationId: this.organizationId,
        trialFormId,
        fieldKey,
        value,
        textState,
        deviceId,
        createdBy: this.actor.id,
        updatedBy: this.actor.id,
        ...(optionalDate(data, "created_at") && { createdAt: optionalDate(data, "created_at") }),
      });
      return;
    }
    const changed =
      !sameJson(existing.value, value) ||
      existing.textState !== textState ||
      existing.deviceId !== deviceId;
    if (!changed) return;
    await this.tx
      .update(trialAnswers)
      .set({ value, textState, deviceId, updatedBy: this.actor.id })
      .where(
        and(eq(trialAnswers.id, existing.id), eq(trialAnswers.organizationId, this.organizationId)),
      );
  }

  private async applyPhoto({ id, data }: ParsedTrialChangeOperation) {
    const [existing] = await this.tx
      .select({
        trialFormId: trialPhotos.trialFormId,
        fieldKey: trialPhotos.fieldKey,
        name: trialPhotos.name,
        sizeBytes: trialPhotos.sizeBytes,
        deviceId: trialPhotos.deviceId,
      })
      .from(trialPhotos)
      .where(and(eq(trialPhotos.id, id), eq(trialPhotos.organizationId, this.organizationId)))
      .limit(1);
    const sentFormId = optionalText(data, "trial_form_id");
    const sentFieldKey = optionalText(data, "field_key");
    const name = optionalText(data, "name");
    const sizeBytes = optionalInteger(data, "size_bytes");
    const deviceId = optionalNullableText(data, "device_id");

    if (!existing) {
      const trialFormId = requireUuid(sentFormId);
      if (sentFieldKey === undefined || name === undefined || sizeBytes === undefined) {
        throw new InvalidTrialChangeError("Bildet mangler opplysninger.");
      }
      requireTrialField(sentFieldKey);
      await this.requireForm(trialFormId);
      await this.tx.insert(trialPhotos).values({
        id,
        organizationId: this.organizationId,
        trialFormId,
        fieldKey: sentFieldKey,
        name,
        sizeBytes,
        deviceId: deviceId ?? null,
        createdBy: this.actor.id,
        updatedBy: this.actor.id,
        ...(optionalDate(data, "created_at") && { createdAt: optionalDate(data, "created_at") }),
      });
      return;
    }

    // Skjema og felt for et bilde endres aldri
    if (sentFormId !== undefined && sentFormId !== existing.trialFormId) {
      throw new InvalidTrialChangeError();
    }
    if (sentFieldKey !== undefined && sentFieldKey !== existing.fieldKey) {
      throw new InvalidTrialChangeError();
    }
    await this.requireForm(existing.trialFormId);
    const next = {
      name: name ?? existing.name,
      sizeBytes: sizeBytes ?? existing.sizeBytes,
      deviceId: deviceId === undefined ? existing.deviceId : deviceId,
    };
    if (
      next.name === existing.name &&
      next.sizeBytes === existing.sizeBytes &&
      next.deviceId === existing.deviceId
    ) {
      return;
    }
    await this.tx
      .update(trialPhotos)
      .set({ ...next, updatedBy: this.actor.id })
      .where(and(eq(trialPhotos.id, id), eq(trialPhotos.organizationId, this.organizationId)));
  }
}

export const applyTrialChanges: ApplyTrialChanges = async (
  actor: Actor,
  organizationId: string,
  operations: readonly TrialChangeOperation[],
): Promise<TrialChangesResult> => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const parsed = trialChangeOperationsSchema.safeParse(operations);
  if (!parsed.success) throw new InvalidTrialChangeError();
  const batch = parsed.data;

  await db.transaction(async (tx) => {
    const writer = new ChangeWriter(tx, actor, grant);
    await writer.rejectForeignIds([...new Set(batch.map((operation) => operation.id))]);
    for (const operation of batch) await writer.apply(operation);
  });

  // Bare antall og tabellnavn, aldri innholdet (fritekst fra skjemaet)
  const tables = [...new Set(batch.map((operation) => operation.table))].sort();
  logger.info("Endringer fra testskjemaet lagret", {
    route: "/api/prove/synk/endringer",
    userId: actor.id,
    count: batch.length,
    tables,
  });
  return { applied: batch.length };
};
