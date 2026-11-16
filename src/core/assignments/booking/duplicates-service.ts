import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { assignments } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { PossibleDuplicatesLookupError } from "../errors";
import type { DuplicateReason } from "./codes";
import {
  POSSIBLE_DUPLICATES_LIMIT,
  type FindPossibleDuplicatesFor,
  type FindPossibleDuplicatesForAssignment,
  type PossibleDuplicate,
  type PossibleDuplicateFields,
  type PossibleDuplicates,
} from "./contract";
import {
  possibleDuplicatesQuery,
  type PossibleDuplicateRow,
  type PossibleDuplicatesCriteria,
} from "./duplicate-sql";
import { cadastreKey, normalizeAddressKey } from "./duplicates";

/*
 * Varsel om mulig dublett (T3) på tvers av ordre og oppdrag (ADR 0011). Fast regel uten KI
 * (docs/05-domenemodell.md 4.3). Treffene beregnes hver gang og lagres ikke; ingenting skrives,
 * slettes eller sendes til KI.
 *
 * Personvern: loggen får bare antall treff, id-er og organisasjonen, aldri adresse, nøkkel, gnr,
 * bnr, snr eller SQL med parametre, heller ikke når oppslaget feiler.
 */

const INVALID_INPUT = "Ugyldige felt for oppslaget om mulig dublett.";

const optionalId = z
  .string()
  .nullish()
  .refine((value) => value === null || value === undefined || isUuid(value), {
    error: INVALID_INPUT,
  });

const fieldsSchema = z.object({
  addressText: z.string().max(1000).nullish(),
  gnr: z.string().max(100).nullish(),
  bnr: z.string().max(100).nullish(),
  snr: z.string().max(100).nullish(),
  receivedAt: z.union([z.date(), z.string()]).transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: INVALID_INPUT });
      return z.NEVER;
    }
    return date;
  }),
  excludeOrderId: optionalId,
  excludeAssignmentId: optionalId,
});

/** Rettigheten for oppslaget: den samme som for å lese ordren og oppdraget. */
const PERMISSION = "organization.read";

/**
 * Radene fra oppslaget, med `orderId` for oppdrag som kom fra en ordre (brukes av ordresiden
 * i `@/core/orders`). Kall den bare med `grant` fra `requireOrganizationAccess`; den filtrerer på
 * `grant.organizationId`. Eksporteres ikke fra `@/core/assignments`. Ugyldige felt gir `ZodError`.
 */
export async function lookupPossibleDuplicateRows(
  grant: EmployeeGrant,
  fields: PossibleDuplicateFields,
): Promise<{ rows: PossibleDuplicateRow[]; hasMore: boolean }> {
  const values = fieldsSchema.parse(fields);

  const criteria: PossibleDuplicatesCriteria = {
    addressKey: normalizeAddressKey(values.addressText),
    cadastre: cadastreKey({
      gnr: values.gnr ?? null,
      bnr: values.bnr ?? null,
      snr: values.snr ?? null,
    }),
    receivedAt: values.receivedAt,
    excludeOrderId: values.excludeOrderId ?? null,
    excludeAssignmentId: values.excludeAssignmentId ?? null,
  };
  if (criteria.addressKey === null && criteria.cadastre === null) {
    return { rows: [], hasMore: false };
  }

  let rows: PossibleDuplicateRow[];
  try {
    rows = await possibleDuplicatesQuery(grant.organizationId, criteria);
  } catch (error) {
    // Bare feilnavn og PostgreSQL-kode: feilteksten kan ha SQL og parametre (adresse, matrikkel).
    logger.error("Oppslaget om mulig dublett feilet", {
      organizationId: grant.organizationId,
      errorName: error instanceof Error ? error.name : typeof error,
      errorCode: databaseErrorCode(error),
    });
    throw new PossibleDuplicatesLookupError();
  }

  const hasMore = rows.length > POSSIBLE_DUPLICATES_LIMIT;
  const shown = rows.slice(0, POSSIBLE_DUPLICATES_LIMIT);
  logger.debug("Oppslag om mulig dublett", {
    organizationId: grant.organizationId,
    count: shown.length,
    hasMore,
    hitIds: shown.map((row) => row.id),
  });
  return { rows: shown, hasMore };
}

/** Grunnene i fast rekkefølge (`address`, så `cadastre`). */
export function rowReasons(row: Pick<PossibleDuplicateRow, "addressMatch" | "cadastreMatch">) {
  const reasons: DuplicateReason[] = [];
  if (row.addressMatch) reasons.push("address");
  if (row.cadastreMatch) reasons.push("cadastre");
  return reasons;
}

/** Fast nøkkelliste: aldri matrikkel, bestiller, kontakter eller reklamasjon. */
function toPossibleDuplicate(row: PossibleDuplicateRow): PossibleDuplicate {
  return {
    kind: row.kind,
    id: row.id,
    number: row.number ?? null,
    status: row.status,
    receivedAt: row.receivedAt,
    addressText: row.addressText,
    reasons: rowReasons(row),
  };
}

async function lookup(
  grant: EmployeeGrant,
  fields: PossibleDuplicateFields,
): Promise<PossibleDuplicates> {
  const { rows, hasMore } = await lookupPossibleDuplicateRows(grant, fields);
  return { items: rows.map(toPossibleDuplicate), hasMore };
}

/**
 * Ordre og oppdrag i organisasjonen som kan være samme bestilling som feltene, også for et skjema
 * som ikke er lagret. Kontrakten står i `./contract.ts`.
 */
export const findPossibleDuplicatesFor: FindPossibleDuplicatesFor = async (
  actor,
  organizationId,
  fields,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, PERMISSION);
  return lookup(grant, fields);
};

/**
 * Mulige dubletter for et lagret oppdrag (varselet på oppdragssiden). Oppdraget selv og ordren
 * det kom fra er aldri med. Fremmed, ukjent, slettet eller ugyldig id gir `AccessDeniedError`.
 */
export const findPossibleDuplicatesForAssignment: FindPossibleDuplicatesForAssignment = async (
  actor,
  organizationId,
  assignmentId,
) => {
  const grant = await requireOrganizationAccess(actor, organizationId, PERMISSION);
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const [assignment] = await db
    .select({
      id: assignments.id,
      orderId: assignments.orderId,
      addressText: assignments.addressText,
      gnr: assignments.gnr,
      bnr: assignments.bnr,
      snr: assignments.snr,
      receivedAt: assignments.receivedAt,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    );
  if (!assignment) throw new AccessDeniedError();

  return lookup(grant, {
    addressText: assignment.addressText,
    gnr: assignment.gnr,
    bnr: assignment.bnr,
    snr: assignment.snr,
    receivedAt: assignment.receivedAt,
    excludeAssignmentId: assignment.id,
    excludeOrderId: assignment.orderId,
  });
};

/** PostgreSQL-koden (f.eks. `57014`) fra feilen eller årsaken, uten tekst. */
function databaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = current.cause;
  }
  return undefined;
}
