import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  createContact,
  createFirm,
  createOffice,
  createOrganization,
  resetDatabase,
} from "../../tests/factories";

/*
 * Databasen selv holder bestillingsfeltene på oppdraget i orden (testplan for «Nytt oppdrag» 3.1,
 * migrering 0034, ADR 0011). Direkte innsetting med SQL, utenom kjernen, så det er skrankene i
 * databasen som prøves. Feilkoden sjekkes, så en skrivefeil i et kolonnenavn ikke gir en falsk
 * grønn test. Testdata er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (et oppdrag har alltid adresse, peker aldri på bestiller i
 * en annen organisasjon, og samme skjema kan ikke lagre to oppdrag).
 */

beforeEach(resetDatabase);

const NOT_NULL = "23502";
const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectPgError(run: Promise<unknown>, code: string) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "databasen skulle avvist raden").not.toBeNull();
  expect(pgCode(error), `feilkode (fikk ${String(error)})`).toBe(code);
}

let numberCounter = 0;

type Values = {
  organizationId: string;
  officeId: string;
  addressText?: string | null;
  receivedAt?: string | null;
  omitReceivedAt?: boolean;
  source?: string;
  contactId?: string | null;
  firmId?: string | null;
  creationKey?: string | null;
};

function insertAssignment(values: Values) {
  numberCounter += 1;
  const number = `SKJEMA-${numberCounter}`;
  const address = values.addressText === undefined ? "Testveien 12, 8000 Bodø" : values.addressText;
  if (values.omitReceivedAt) {
    return db.execute(sql`
      insert into assignments (organization_id, number, office_id, address_text, source)
      values (${values.organizationId}, ${number}, ${values.officeId}, ${address},
        ${values.source ?? "manual"})
      returning received_at`);
  }
  return db.execute(sql`
    insert into assignments (organization_id, number, office_id, address_text, received_at,
      source, ordered_by_contact_id, ordered_by_firm_id, creation_key)
    values (${values.organizationId}, ${number}, ${values.officeId}, ${address},
      ${values.receivedAt === undefined ? "2026-11-03T10:00:00Z" : values.receivedAt},
      ${values.source ?? "manual"}, ${values.contactId ?? null}, ${values.firmId ?? null},
      ${values.creationKey ?? null})`);
}

async function orgWithOffice(name = "Oppdiktet Takst A") {
  const org = await createOrganization(name);
  const office = await createOffice(org.id);
  return { organizationId: org.id, officeId: office.id };
}

describe("3.1.1 påkrevde kolonner", () => {
  it("godtar et gyldig oppdrag (kontroll av hjelperen)", async () => {
    await insertAssignment(await orgWithOffice());
  });

  it("address_text = null avvises", async () => {
    await expectPgError(
      insertAssignment({ ...(await orgWithOffice()), addressText: null }),
      NOT_NULL,
    );
  });

  it("received_at = null avvises", async () => {
    await expectPgError(
      insertAssignment({ ...(await orgWithOffice()), receivedAt: null }),
      NOT_NULL,
    );
  });

  it("received_at får now() når den ikke sendes", async () => {
    const before = Date.now();
    const rows = (await insertAssignment({
      ...(await orgWithOffice()),
      omitReceivedAt: true,
    })) as unknown as { received_at: Date | string }[];
    const at = new Date(rows[0]!.received_at).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 60_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("kolonnene er NOT NULL i skjemaet", async () => {
    const rows = (await db.execute(sql`
      select column_name, is_nullable, column_default from information_schema.columns
      where table_name = 'assignments' and column_name in ('address_text', 'received_at', 'source')
      order by column_name`)) as unknown as {
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }[];
    expect(rows.map((row) => [row.column_name, row.is_nullable])).toEqual([
      ["address_text", "NO"],
      ["received_at", "NO"],
      ["source", "NO"],
    ]);
    expect(rows.find((row) => row.column_name === "received_at")?.column_default).toBe("now()");
    expect(rows.find((row) => row.column_name === "source")?.column_default).toBe("'manual'::text");
  });
});

describe("3.1.2 CHECK på source", () => {
  it.each(["manual", "email"])("%s godtas", async (source) => {
    await insertAssignment({ ...(await orgWithOffice()), source });
  });

  it.each(["fax", "MANUAL", ""])("«%s» avvises", async (source) => {
    await expectPgError(insertAssignment({ ...(await orgWithOffice()), source }), CHECK);
  });
});

describe("3.1.3 sammensatte fremmednøkler for bestiller", () => {
  it("kontakt og firma i egen organisasjon godtas", async () => {
    const own = await orgWithOffice();
    const firm = await createFirm(own.organizationId);
    const contact = await createContact(own.organizationId, { firmId: firm.id });
    await insertAssignment({ ...own, contactId: contact.id, firmId: firm.id });
  });

  it("kontakt fra B på oppdrag i A avvises", async () => {
    const own = await orgWithOffice("Oppdiktet Takst A");
    const other = await orgWithOffice("Oppdiktet Takst B");
    const contact = await createContact(other.organizationId);
    await expectPgError(insertAssignment({ ...own, contactId: contact.id }), FOREIGN_KEY);
  });

  it("firma fra B på oppdrag i A avvises", async () => {
    const own = await orgWithOffice("Oppdiktet Takst A");
    const other = await orgWithOffice("Oppdiktet Takst B");
    const firm = await createFirm(other.organizationId);
    await expectPgError(insertAssignment({ ...own, firmId: firm.id }), FOREIGN_KEY);
  });

  it("ukjent kontakt-id avvises", async () => {
    await expectPgError(
      insertAssignment({ ...(await orgWithOffice()), contactId: randomUUID() }),
      FOREIGN_KEY,
    );
  });
});

describe("3.1.4 creation_key er unik per organisasjon", () => {
  it("samme nøkkel to ganger i A avvises", async () => {
    const own = await orgWithOffice();
    const key = randomUUID();
    await insertAssignment({ ...own, creationKey: key });
    await expectPgError(insertAssignment({ ...own, creationKey: key }), UNIQUE);
  });

  it("samme nøkkel i A og B godtas", async () => {
    const key = randomUUID();
    await insertAssignment({ ...(await orgWithOffice("Oppdiktet Takst A")), creationKey: key });
    await insertAssignment({ ...(await orgWithOffice("Oppdiktet Takst B")), creationKey: key });
  });

  it("flere oppdrag uten nøkkel godtas", async () => {
    const own = await orgWithOffice();
    await insertAssignment({ ...own, creationKey: null });
    await insertAssignment({ ...own, creationKey: null });
    await insertAssignment({ ...own, creationKey: null });
  });
});
