import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import type { AssignmentStatus } from "@/core/assignments";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import {
  DUPLICATE_REASONS,
  MAX_DUPLICATE_WINDOW_DAYS,
  type DuplicateReason,
  type OrderStatus,
} from "./codes";
import { POSSIBLE_DUPLICATES_SHOWN, possibleDuplicatesQuery } from "./duplicate-sql";

/*
 * Varsel om mulig dublett (T3, Ståle 12.11.2026: «fast regel uten KI, og varselet stopper ikke
 * lagringen»). Regelen står i docs/funksjoner/fase2a-varsel-dublett.md og
 * docs/05-domenemodell.md 4.3. De rene funksjonene her og SQL-uttrykkene i `duplicate-sql.ts` er
 * samme regel; paritetstesten holder dem like.
 *
 * Tjenestene leser bare. Lesing krever `organization.read`, og spørringen filtrerer på
 * `grant.organizationId`. Adressen og matrikkelen logges aldri og sendes aldri til KI; loggen har
 * bare antall og id-er.
 *
 * Støtter hovedmål: færre reklamasjoner (samme bolig blir ikke bestilt eller tatt to ganger), de
 * ansatte (kontoret ser det med en gang på ordren) og KI i bunnen (`findPossibleDuplicateOrdersFor`
 * kan kalles for et ordreforslag fra e-post som ikke er lagret).
 */

export { MAX_DUPLICATE_WINDOW_DAYS };

const WINDOW_MS = MAX_DUPLICATE_WINDOW_DAYS * 24 * 3600 * 1000;

/**
 * Adressenøkkel: delen før første komma, små bokstaver, bare bokstaver og tall (æ, ø og å
 * beholdes). Tom nøkkel gir `null` og gir aldri treff. Samme regel som `ORDER_ADDRESS_KEY_SQL`.
 */
export function normalizeAddressKey(text: string | null | undefined): string | null {
  if (!text) return null;
  const key = (text.split(",")[0] ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return key === "" ? null : key;
}

/**
 * Gårds-, bruks- eller seksjonsnummer uten mellomrom og innledende nuller («012» = «12»). Tomt
 * eller bare nuller gir `null` (ikke utfylt). Samme regel som `ORDER_GNR_KEY_SQL` med flere.
 */
export function normalizeCadastreNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const number = value.replace(/\s/g, "").replace(/^0+/, "");
  return number === "" ? null : number;
}

/** Er avstanden mellom de to tidspunktene høyst 90 × 24 timer? Grensen teller med. */
export function isWithinDuplicateWindow(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= WINDOW_MS;
}

type DuplicateFields = {
  addressText: string | null;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
};

/** Normalisert matrikkel, eller `null` når gnr eller bnr ikke er utfylt. Uten seksjon er `snr` "". */
function cadastreKey(fields: Omit<DuplicateFields, "addressText">) {
  const gnr = normalizeCadastreNumber(fields.gnr);
  const bnr = normalizeCadastreNumber(fields.bnr);
  if (gnr === null || bnr === null) return null;
  return { gnr, bnr, snr: normalizeCadastreNumber(fields.snr) ?? "" };
}

/**
 * Hvorfor to ordre er mulige dubletter, i fast rekkefølge (adresse, matrikkel). Tom liste betyr
 * ingen likhet. Tidsvinduet og statusen er ikke med her; de står i spørringen.
 */
export function duplicateReasons(mine: DuplicateFields, other: DuplicateFields): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  const myAddress = normalizeAddressKey(mine.addressText);
  if (myAddress !== null && myAddress === normalizeAddressKey(other.addressText)) {
    reasons.push("address");
  }
  const myCadastre = cadastreKey(mine);
  const otherCadastre = cadastreKey(other);
  if (
    myCadastre !== null &&
    otherCadastre !== null &&
    myCadastre.gnr === otherCadastre.gnr &&
    myCadastre.bnr === otherCadastre.bnr &&
    myCadastre.snr === otherCadastre.snr
  ) {
    reasons.push("cadastre");
  }
  return DUPLICATE_REASONS.filter((reason) => reasons.includes(reason));
}

/** Én annen ordre som kan være samme bestilling. Ingen matrikkel og ingen kontakter. */
export type PossibleDuplicateOrder = {
  id: string;
  receivedAt: Date;
  /** Vises på skjermen i samme organisasjon. Logges aldri og sendes aldri til KI. */
  addressText: string;
  status: OrderStatus;
  /** Når ordren er gjort om til oppdrag. */
  assignmentNumber: string | null;
  assignmentStatus: AssignmentStatus | null;
  reasons: DuplicateReason[];
};

/** Høyst 10 treff; `hasMore` når det finnes flere. */
export type PossibleDuplicates = { items: PossibleDuplicateOrder[]; hasMore: boolean };

const criteriaSchema = z.object({
  addressText: z.string().max(1000).nullish(),
  gnr: z.string().max(100).nullish(),
  bnr: z.string().max(100).nullish(),
  snr: z.string().max(100).nullish(),
  receivedAt: z
    .union([z.date(), z.string()])
    .transform((value) => new Date(value))
    .pipe(z.date()),
  excludeOrderId: z.string().refine(isUuid).nullish(),
});

/** Ordrefeltene regelen ser på. Tar også et forslag som ikke er lagret (uten `excludeOrderId`). */
export type PossibleDuplicateCriteria = {
  addressText: string | null;
  gnr: string | null;
  bnr: string | null;
  snr: string | null;
  /** `Date` eller ISO-tekst (som fra et forslag). */
  receivedAt: Date | string;
  /** Ordren selv, som aldri gir treff. */
  excludeOrderId?: string | null;
};

const EMPTY: PossibleDuplicates = { items: [], hasMore: false };

/**
 * Feil i oppslaget kastes som en ny feil uten SQL, parametre eller verdier, og logges uten dem.
 * Den opprinnelige feilen kan ha adresse og matrikkel i teksten (databasefeil har spørringen med).
 */
function lookupFailed(organizationId: string, error: unknown): Error {
  const code =
    error !== null && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  logger.error("Oppslaget av mulige dubletter feilet", {
    organizationId,
    errorCode: code && /^[0-9A-Z]{5}$/.test(code) ? code : undefined,
  });
  const failure = new Error("Oppslaget av mulige dubletter feilet.");
  failure.name = "PossibleDuplicatesLookupError";
  return failure;
}

async function lookup(
  organizationId: string,
  criteria: z.output<typeof criteriaSchema>,
): Promise<PossibleDuplicates> {
  const addressKey = normalizeAddressKey(criteria.addressText);
  const cadastre = cadastreKey({
    gnr: criteria.gnr ?? null,
    bnr: criteria.bnr ?? null,
    snr: criteria.snr ?? null,
  });
  if (addressKey === null && cadastre === null) return EMPTY;

  let rows;
  try {
    rows = await possibleDuplicatesQuery(organizationId, {
      addressKey,
      cadastre,
      receivedAt: criteria.receivedAt,
      excludeOrderId: criteria.excludeOrderId ?? null,
    });
  } catch (error) {
    throw lookupFailed(organizationId, error);
  }

  const items = rows.slice(0, POSSIBLE_DUPLICATES_SHOWN).map(
    (row): PossibleDuplicateOrder => ({
      id: row.id,
      receivedAt: row.receivedAt,
      addressText: row.addressText,
      status: row.status as OrderStatus,
      assignmentNumber: row.assignmentNumber,
      assignmentStatus: row.assignmentStatus as AssignmentStatus | null,
      reasons: DUPLICATE_REASONS.filter((reason) =>
        reason === "address" ? row.addressMatch === true : row.cadastreMatch === true,
      ),
    }),
  );
  const result = { items, hasMore: rows.length > POSSIBLE_DUPLICATES_SHOWN };
  logger.debug("Mulige dubletter slått opp", {
    organizationId,
    excludeOrderId: criteria.excludeOrderId ?? null,
    count: items.length,
    hasMore: result.hasMore,
    orderIds: items.map((item) => item.id),
  });
  return result;
}

/**
 * Mulige dubletter for ordrefelt, lagret eller ikke. Ordren `excludeOrderId` er aldri med. Krever
 * `organization.read`. Ugyldig inndata gir `ZodError`.
 */
export async function findPossibleDuplicateOrdersFor(
  actor: Actor,
  organizationId: string,
  input: PossibleDuplicateCriteria,
): Promise<PossibleDuplicates> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const criteria = criteriaSchema.parse(input);
  return lookup(grant.organizationId, criteria);
}

/**
 * Mulige dubletter for en lagret ordre. Fremmed, ukjent, myk-slettet eller ugyldig id gir
 * `AccessDeniedError`. Er ordren avvist, er listen tom.
 */
export async function findPossibleDuplicateOrders(
  actor: Actor,
  organizationId: string,
  orderId: string,
): Promise<PossibleDuplicates> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(orderId)) throw new AccessDeniedError();

  let order;
  try {
    [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.organizationId, grant.organizationId),
          isNull(orders.deletedAt),
        ),
      );
  } catch (error) {
    throw lookupFailed(grant.organizationId, error);
  }
  if (!order) throw new AccessDeniedError();
  if (order.status === "rejected") return EMPTY;

  return lookup(grant.organizationId, {
    addressText: order.addressText,
    gnr: order.gnr,
    bnr: order.bnr,
    snr: order.snr,
    receivedAt: order.receivedAt,
    excludeOrderId: order.id,
  });
}
