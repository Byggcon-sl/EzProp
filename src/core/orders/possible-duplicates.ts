import { z } from "zod";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import type { DuplicateReason, OrderStatus } from "./codes";
import {
  POSSIBLE_DUPLICATES_LIMIT,
  possibleDuplicatesQuery,
  type PossibleDuplicatesCriteria,
} from "./duplicate-sql";
import { cadastreKey, normalizeAddressKey } from "./duplicates";
import { selectOrder } from "./orders";

/*
 * Varsel om mulig dublett (T3). Fast regel uten KI (docs/05-domenemodell.md 4.3). Treffene
 * beregnes hver gang og lagres ikke; ingenting skrives, slettes eller sendes til KI.
 *
 * `findPossibleDuplicateOrdersFor` tar ordrefeltene, også for en ordre som ikke er lagret, slik at
 * e-post-til-ordre (krok A1) kan kalle den før forslaget vises. `findPossibleDuplicateOrders` er en
 * tynn innpakning for en lagret ordre.
 *
 * Personvern: loggen får bare antall treff, id-er og organisasjonen, aldri adresse, nøkkel, gnr,
 * bnr, snr eller SQL med parametre, heller ikke når oppslaget feiler.
 */

/** Én annen ordre som kan være samme bestilling. Fast nøkkelliste, uten matrikkel og kontakter. */
export type PossibleDuplicateOrder = {
  id: string;
  receivedAt: Date;
  /** Vises bare på skjermen i samme organisasjon (A290). Logges aldri og sendes aldri til KI. */
  addressText: string;
  status: OrderStatus;
  /** Oppdragsnummeret når ordren er gjort om, ellers `null`. */
  assignmentNumber: string | null;
  /** Oppdragsstatusen når ordren er gjort om, ellers `null`. */
  assignmentStatus: string | null;
  reasons: DuplicateReason[];
};

export type PossibleDuplicateOrders = { items: PossibleDuplicateOrder[]; hasMore: boolean };

/** Ordrefeltene regelen ser på. `excludeOrderId` er ordren selv når den er lagret. */
export type PossibleDuplicateFields = {
  addressText: string | null;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  receivedAt: Date | string;
  excludeOrderId?: string | null;
};

/** Oppslaget feilet. Meldingen har aldri verdier fra ordren eller SQL-teksten. */
export class PossibleDuplicatesLookupError extends Error {
  constructor() {
    super("Oppslaget om mulig dublett feilet.");
    this.name = "PossibleDuplicatesLookupError";
  }
}

const INVALID_INPUT = "Ugyldige felt for oppslaget om mulig dublett.";

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
  excludeOrderId: z
    .string()
    .nullish()
    .refine((value) => value === null || value === undefined || isUuid(value), {
      error: INVALID_INPUT,
    }),
});

const EMPTY: PossibleDuplicateOrders = { items: [], hasMore: false };

/** Rettigheten for oppslaget: den samme som for å lese ordren. */
const PERMISSION = "organization.read";

/**
 * Andre ordre i organisasjonen som kan være samme bestilling som ordrefeltene. Høyst 10, nyeste
 * mottatt først og så `id`; `hasMore` når det finnes flere. Ugyldige felt gir `ZodError` (ugyldig
 * dato, `excludeOrderId` som ikke er uuid), aldri en databasefeil.
 */
export async function findPossibleDuplicateOrdersFor(
  actor: Actor,
  organizationId: string,
  fields: PossibleDuplicateFields,
): Promise<PossibleDuplicateOrders> {
  const grant = await requireOrganizationAccess(actor, organizationId, PERMISSION);
  return lookupPossibleDuplicates(grant, fields);
}

/** Selve oppslaget etter tilgangssjekken. Filtrerer bare på `grant.organizationId`. */
async function lookupPossibleDuplicates(
  grant: EmployeeGrant,
  fields: PossibleDuplicateFields,
): Promise<PossibleDuplicateOrders> {
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
  };
  if (criteria.addressKey === null && criteria.cadastre === null) return EMPTY;

  let rows: Awaited<ReturnType<typeof possibleDuplicatesQuery>>;
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

  const items: PossibleDuplicateOrder[] = rows.slice(0, POSSIBLE_DUPLICATES_LIMIT).map((row) => {
    const reasons: DuplicateReason[] = [];
    if (row.addressMatch) reasons.push("address");
    if (row.cadastreMatch) reasons.push("cadastre");
    return {
      id: row.id,
      receivedAt: row.receivedAt,
      addressText: row.addressText,
      status: row.status as OrderStatus,
      assignmentNumber: row.assignmentNumber ?? null,
      assignmentStatus: row.assignmentStatus ?? null,
      reasons,
    };
  });
  const hasMore = rows.length > POSSIBLE_DUPLICATES_LIMIT;
  logger.debug("Oppslag om mulig dublett", {
    organizationId: grant.organizationId,
    count: items.length,
    hasMore,
    orderIds: items.map((item) => item.id),
  });
  return { items, hasMore };
}

/**
 * Mulige dubletter for en lagret ordre. Ukjent, fremmed, myk-slettet eller ugyldig ordre-id gir
 * `AccessDeniedError`. En avvist ordre gir tom liste. Ordren selv er aldri med.
 */
export async function findPossibleDuplicateOrders(
  actor: Actor,
  organizationId: string,
  orderId: string,
): Promise<PossibleDuplicateOrders> {
  const grant = await requireOrganizationAccess(actor, organizationId, PERMISSION);
  if (!isUuid(orderId)) throw new AccessDeniedError();
  const order = await selectOrder(db, grant, orderId);
  if (!order) throw new AccessDeniedError();
  if (order.status === "rejected") return EMPTY;

  return lookupPossibleDuplicates(grant, {
    addressText: order.addressText,
    gnr: order.gnr,
    bnr: order.bnr,
    snr: order.snr,
    receivedAt: order.receivedAt,
    excludeOrderId: order.id,
  });
}

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
