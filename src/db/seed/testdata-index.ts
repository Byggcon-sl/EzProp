import "dotenv/config";
import { pathToFileURL } from "node:url";
import { db } from "@/db/client";
import { TestdataNotAllowedError } from "./testdata-guard";
import { TESTDATA_SEED } from "./testdata.data";
import {
  TESTDATA_TABLES,
  TestdataSetupError,
  TestdataStepError,
  seedTestdata,
  type Db,
  type TestdataSummary,
} from "./testdata";

/*
 * `pnpm db:seed:testdata`: testdata som ligner en ekte arbeidshverdag i Byggcon-organisasjonen
 * (docs/funksjoner/fase2a-testdata-arbeidshverdag.md). Kjøres etter `pnpm db:seed`, og bare i
 * utviklings- og testmiljøet (vakten i `testdata-guard.ts`). Kan kjøres flere ganger: andre
 * kjøring lager ingenting.
 *
 * Loggen har bare antall og `TD-`-nøkler. Ved feil skrives bare feiltypen, SQLSTATE og nøkkelen
 * steget sto på, aldri meldingen fra databasen, parametre, vert eller stakk. Vakt- og
 * oppsettfeil skriver den norske meldingen, som aldri har adresse, vert eller e-post.
 */

export type TestdataCliDeps = {
  db: Db;
  now: () => Date;
  seed: number;
  log: (message: string) => void;
  error: (message: string) => void;
};

const TABLE_LABELS: Record<(typeof TESTDATA_TABLES)[number], string> = {
  users: "Brukere",
  employees: "Ansatte",
  certifications: "Sertifiseringer",
  firms: "Firma",
  contacts: "Kontakter",
  orders: "Ordre",
  assignments: "Oppdrag",
  teamMembers: "Team",
  parties: "Parter",
  properties: "Eiendommer",
  commonAreas: "Fellesdeler",
  schedules: "Befaring og frist",
  buildings: "Bygninger",
  floors: "Etasjer",
  floorAreas: "Arealer",
  rooms: "Rom",
  statusChanges: "Statusbytter",
  workSessions: "Arbeidsøkter",
  claims: "Reklamasjoner",
};

/** Linjene i loggen: bare tall og `TD-`-nøkler. */
export function summaryLines(summary: TestdataSummary): string[] {
  const lines = TESTDATA_TABLES.map(
    (table) =>
      `${TABLE_LABELS[table]}: ${summary.created[table]} nye, ${summary.existing[table]} fantes fra før`,
  );
  if (summary.skippedOrders.length > 0) {
    lines.push(
      `Hoppet over (slettet, avvist eller kansellert): ${summary.skippedOrders.join(", ")}`,
    );
  }
  return lines;
}

/** SQLSTATE fra databasen (fem tegn), eller `null`. Ser også på `cause`. */
function sqlState(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Navnet på feiltypen (konstruktøren), aldri meldingen. */
function typeName(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof name === "string" && /^[A-Za-z0-9_$]{1,60}$/.test(name)) return name;
  }
  return "UkjentFeil";
}

/** Feillinjen: norsk melding for vakt og oppsett, ellers bare type, SQLSTATE og nøkkel. */
export function errorLine(error: unknown): string {
  if (error instanceof TestdataNotAllowedError || error instanceof TestdataSetupError) {
    return `Testdata ble ikke lagt inn: ${error.message}`;
  }
  if (error instanceof TestdataStepError) {
    const cause = error.cause;
    const state = sqlState(cause);
    return `Testdata stoppet ved ${error.key}: ${typeName(cause)}${state ? ` (SQLSTATE ${state})` : ""}. Kjør skriptet på nytt for å fylle ut resten.`;
  }
  const state = sqlState(error);
  return `Testdata stoppet: ${typeName(error)}${state ? ` (SQLSTATE ${state})` : ""}.`;
}

/** Kjører testdataene med dagens tid og det faste frøet. Gir 0 ved suksess og 1 ved feil. */
export async function runTestdataCli(
  deps: TestdataCliDeps = {
    db,
    now: () => new Date(),
    seed: TESTDATA_SEED,
    log: console.log,
    error: console.error,
  },
): Promise<number> {
  try {
    const summary = await seedTestdata({ db: deps.db, now: deps.now(), seed: deps.seed });
    for (const line of summaryLines(summary)) deps.log(line);
    return 0;
  } catch (caught) {
    deps.error(errorLine(caught));
    return 1;
  }
}

// Bare når filen kjøres direkte (`tsx src/db/seed/testdata-index.ts`), ikke når testene importerer den
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runTestdataCli());
}
