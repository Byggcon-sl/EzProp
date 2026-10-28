import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { logger } from "@/shared/lib/logger";
import packageJson from "../../../package.json";

/*
 * Helsesjekk for hosting og overvåking: `GET /api/helse` svarer 200 når databasen svarer,
 * 503 ellers. Uten innlogging, og uten detaljer om feilen.
 */

export type HealthBody = { status: "ok" | "feil"; versjon: string; database: "ok" | "feil" };

const DATABASE_TIMEOUT_MS = 3000;

/** Versjonen som kjører: package.json (økes i hver PR), pluss commit når APP_VERSION er satt. */
export function appVersion(): string {
  const commit = process.env.APP_VERSION?.trim();
  return commit ? `${packageJson.version} (${commit})` : packageJson.version;
}

async function pingDatabase(): Promise<void> {
  await db.execute(sql`select 1`);
}

export async function checkHealth(
  ping: () => Promise<void> = pingDatabase,
): Promise<{ httpStatus: 200 | 503; body: HealthBody }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ping(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Databasen svarte ikke i tide")),
          DATABASE_TIMEOUT_MS,
        );
      }),
    ]);
    return { httpStatus: 200, body: { status: "ok", versjon: appVersion(), database: "ok" } };
  } catch (error) {
    logger.warn("Helsesjekk: databasen svarer ikke", { route: "/api/helse", error });
    return { httpStatus: 503, body: { status: "feil", versjon: appVersion(), database: "feil" } };
  } finally {
    clearTimeout(timer);
  }
}
