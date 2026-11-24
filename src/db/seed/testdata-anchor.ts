import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { orders, organizations } from "@/db/schema";
import { brand } from "@/shared/config/brand";
import { buildTestdataPlan } from "./testdata-plan";
import { TESTDATA_ORDER_PREFIX } from "./testdata.data";
import type { TestdataPlan } from "./testdata.types";

/*
 * Felles for del 1 og del 2 av testdataene (docs/funksjoner/fase2a-testdata-arbeidshverdag.md og
 * fase2a-testdata-del-2.md): Byggcon-organisasjonen og ankeret planen regnes fra. Begge delene
 * bygger samme plan, så badene i del 2 kjenner igjen rommene og årstallene fra del 1.
 */

/** Byggcon-organisasjonen (som `runSeed`). */
export async function findTestdataOrganization(db: Database) {
  const [row] = await db
    .select({ id: organizations.id, settings: organizations.settings })
    .from(organizations)
    .where(and(eq(organizations.name, brand.companyName), isNull(organizations.deletedAt)))
    .orderBy(asc(organizations.createdAt), asc(organizations.id))
    .limit(1);
  return row ?? null;
}

/** Ordren `TD-0001` i organisasjonen (også slettet). `created_at` er ankeret for datoene. */
export async function findAnchorOrder(
  db: Database,
  organizationId: string,
): Promise<{ id: string; createdAt: Date } | null> {
  const [row] = await db
    .select({ id: orders.id, createdAt: orders.createdAt })
    .from(orders)
    .where(
      and(
        eq(orders.organizationId, organizationId),
        eq(orders.externalRef, `${TESTDATA_ORDER_PREFIX}0001`),
      ),
    )
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(1);
  return row ?? null;
}

const DAY_MS = 86_400_000;

/**
 * Ankeret fra `created_at` på `TD-0001`. Den får mottatt-tiden fra planen rett etter at den er
 * laget, og den ligger alltid like langt fra midnatt (UTC) på ankerdagen, uansett anker. Derfor
 * gir `created_at` minus den avstanden ankerdagen. Er resultatet ikke midnatt, ble kjøringen
 * avbrutt før tiden ble flyttet, og `created_at` (tiden ordren ble laget) er ankeret.
 */
export function anchorFromCreatedAt(createdAt: Date, seed: number): Date {
  const probe = buildTestdataPlan({ seed, anchor: createdAt });
  const first = probe.orders.find((order) => order.key === `${TESTDATA_ORDER_PREFIX}0001`);
  if (!first) return createdAt;
  const probeBase = Date.UTC(
    createdAt.getUTCFullYear(),
    createdAt.getUTCMonth(),
    createdAt.getUTCDate(),
  );
  const base = createdAt.getTime() - (first.receivedAt.getTime() - probeBase);
  return base % DAY_MS === 0 ? new Date(base) : createdAt;
}

/** Planen slik del 1 bygger den: ankeret fra `TD-0001` i organisasjonen, ellers `now`. */
export async function resolveTestdataPlan(
  db: Database,
  organizationId: string,
  seed: number,
  now: Date,
): Promise<TestdataPlan> {
  const anchorOrder = await findAnchorOrder(db, organizationId);
  return buildTestdataPlan({
    seed,
    anchor: anchorOrder ? anchorFromCreatedAt(anchorOrder.createdAt, seed) : now,
  });
}
