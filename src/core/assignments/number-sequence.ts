import { sql } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import type { DbExecutor } from "@/db/client";
import { numberSequences } from "@/db/schema";
import type { NumberSequenceScope } from "./codes";

const ASSIGNMENT_SCOPE: NumberSequenceScope = "assignment";

/**
 * Neste oppdragsnummer, for eksempel `2026-00001` (A52). Kall den i transaksjonen som lager
 * oppdraget, etter at tilgangen er sjekket.
 *
 * Numre lages bare på serveren (D9), og `number_sequences` skrives bare herfra. Én setning
 * (`INSERT … ON CONFLICT … DO UPDATE … RETURNING`) låser raden i databasen, så to samtidige
 * kall aldri får samme nummer. Det første kallet i et år lager serien (gir 1, `next_value = 2`).
 *
 * - Organisasjonen er alltid `grant.organizationId`; funksjonen tar aldri en id som parameter.
 * - `today` er «ÅÅÅÅ-MM-DD» i norsk tid (`todayInOslo(now)`); året blir prefikset `ÅÅÅÅ-`.
 * - `padding` er et minimum: nummer 100 000 blir `2026-100000`.
 */
export async function nextAssignmentNumber(
  executor: DbExecutor,
  grant: EmployeeGrant,
  today: string,
): Promise<string> {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(today);
  if (!match) throw new Error(`Ugyldig dato: ${today}`);
  const prefix = `${match[1]}-`;

  const [row] = await executor
    .insert(numberSequences)
    .values({
      organizationId: grant.organizationId,
      scope: ASSIGNMENT_SCOPE,
      prefix,
      nextValue: 2,
    })
    .onConflictDoUpdate({
      target: [numberSequences.organizationId, numberSequences.scope, numberSequences.prefix],
      set: { nextValue: sql`${numberSequences.nextValue} + 1` },
    })
    .returning({ nextValue: numberSequences.nextValue, padding: numberSequences.padding });
  if (!row) throw new Error("Fikk ikke neste oppdragsnummer. Prøv igjen.");

  // Raden har nå neste ledige verdi; nummeret som deles ut, er verdien før.
  const value = row.nextValue - 1;
  return `${prefix}${String(value).padStart(row.padding, "0")}`;
}
