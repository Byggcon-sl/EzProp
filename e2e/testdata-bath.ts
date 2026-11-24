import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import { ADMIN_EMAIL, e2eDatabaseUrl } from "./helpers";

/*
 * Oppslag for e2e av testdata del 2 (docs/funksjoner/fase2a-testdata-del-2-testplan.md avsnitt
 * 5). Badene finnes på innholdet i databasen, aldri på rekkefølge eller antall, med samme kriterier
 * som `findShowcaseBathReport` i `src/db/seed/testdata-bath.ts` (under arbeid, TG3 og TGIU i
 * samme bad, organisasjonen Byggcon). Oppslaget er skrevet mot databasen her, så e2e ikke laster
 * seed-modulene (og databaseklienten deres) inn i Playwright; Vitest-testen
 * `testdata-bath.acceptance.test.ts` viser at `findShowcaseBathReport` gir samme bad.
 *
 * Bare lokal database eller testdatabasen (`assertLocalOrTestDatabase`). Bare lesing, unntatt
 * `setCheckpointDescription`, som brukes til å sjekke og gjenopprette admin-lagringen.
 */

function sql() {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Organisasjonen til admin fra seed (Byggcon), ikke prøveorganisasjonen. */
const BYGGCON = (db: postgres.Sql) => db`
  select e.organization_id from employees e join users u on u.id = e.user_id
  where u.email = ${ADMIN_EMAIL} and e.deleted_at is null
    and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true')
  limit 1`;

export type E2eBath = {
  assignmentId: string;
  roomId: string;
  number: string;
  roomName: string | null;
  status: string;
};

type BathRow = {
  assignment_id: string;
  room_id: string;
  number: string;
  room_name: string | null;
  status: string;
};

function toBath(row: BathRow): E2eBath {
  return {
    assignmentId: row.assignment_id,
    roomId: row.room_id,
    number: row.number,
    roomName: row.room_name,
    status: row.status,
  };
}

/** Adressen til badskjermen, eventuelt med et punkt åpent. */
export function bathUrl(bath: E2eBath, punkt?: string): string {
  const base = `/oppdrag/${bath.assignmentId}/rom/${bath.roomId}`;
  return punkt ? `${base}?punkt=${encodeURIComponent(punkt)}` : base;
}

/** Badene i TD-oppdragene i Byggcon som har en rapport med svar, med punktene sine. */
const BATHS = (db: postgres.Sql) => db`
  select distinct a.id as assignment_id, r.id as room_id, a.number, r.name as room_name, a.status,
    rep.id as report_id
  from reports rep
  join assignments a on a.id = rep.assignment_id and a.organization_id = rep.organization_id
  join orders o on o.assignment_id = a.id and o.organization_id = a.organization_id
    and o.external_ref like 'TD-%' and o.deleted_at is null
  join checkpoint_results c on c.report_id = rep.id and c.organization_id = rep.organization_id
    and c.deleted_at is null
  join rooms r on r.id = c.room_id and r.organization_id = c.organization_id
  where rep.organization_id = (${BYGGCON(db)}) and rep.deleted_at is null
    and rep.status <> 'superseded' and a.deleted_at is null`;

export type ShowcaseFacts = E2eBath & {
  /** Kostnadsintervallet på TG3-avviket (fast kode). */
  tg3CostBandKey: string | null;
  /** Teksten på avviket med fast TG2 og endret tekst. */
  editedTg2Text: string | null;
  doneCount: number;
};

/** Visningsbadet: under arbeid, TG3 med kostnad, TGIU, HMS uten TG og TG2 med endret tekst. */
export async function findShowcaseBath(): Promise<ShowcaseFacts> {
  const db = sql();
  try {
    const [row] = await db<
      (BathRow & {
        tg3_cost_band_key: string | null;
        edited_tg2_text: string | null;
        done_count: number;
      })[]
    >`
      with baths as (${BATHS(db)})
      select b.assignment_id, b.room_id, b.number, b.room_name, b.status,
        (select d.cost_band_key from deviations d join checkpoint_results c on c.id = d.checkpoint_result_id
          where c.report_id = b.report_id and c.room_id = b.room_id and d.deleted_at is null
            and c.deleted_at is null and d.tg = 3 order by d.sort_order limit 1) as tg3_cost_band_key,
        (select d.deviation_text from deviations d join checkpoint_results c on c.id = d.checkpoint_result_id
          where c.report_id = b.report_id and c.room_id = b.room_id and d.deleted_at is null
            and c.deleted_at is null and d.tg = 2 and d.text_source = 'edited'
          order by d.sort_order limit 1) as edited_tg2_text,
        (select count(*)::int from checkpoint_results c where c.report_id = b.report_id
          and c.room_id = b.room_id and c.done and c.deleted_at is null) as done_count
      from baths b
      where b.status = 'in_progress'
        and exists (select 1 from deviations d join checkpoint_results c on c.id = d.checkpoint_result_id
          where c.report_id = b.report_id and c.room_id = b.room_id and d.deleted_at is null
            and c.deleted_at is null and d.tg = 3 and d.cost_type <> 'none')
        and exists (select 1 from checkpoint_results c where c.report_id = b.report_id
          and c.room_id = b.room_id and c.deleted_at is null and c.tg_direct = 'IU')
        and exists (select 1 from deviations d join checkpoint_results c on c.id = d.checkpoint_result_id
          where c.report_id = b.report_id and c.room_id = b.room_id and d.deleted_at is null
            and c.deleted_at is null and d.kind = 'hms' and d.tg is null)
        and exists (select 1 from deviations d join checkpoint_results c on c.id = d.checkpoint_result_id
          where c.report_id = b.report_id and c.room_id = b.room_id and d.deleted_at is null
            and c.deleted_at is null and d.tg = 2 and d.text_source = 'edited')
      order by b.number, b.room_name
      limit 1`;
    if (!row) throw new Error("Fant ikke visningsbadet (kjør pnpm db:seed:testdata)");
    return {
      ...toBath(row),
      tg3CostBandKey: row.tg3_cost_band_key,
      editedTg2Text: row.edited_tg2_text,
      doneCount: row.done_count,
    };
  } finally {
    await db.end();
  }
}

/** Badet uten avvik: åtte punkt ferdige, sju med TG1 og ett med TG0, ingen avvik. */
export async function findBathWithoutDeviations(): Promise<E2eBath> {
  return findOne(
    (db) => db`
      with baths as (${BATHS(db)})
      select b.assignment_id, b.room_id, b.number, b.room_name, b.status from baths b
      where b.status in ('completed', 'invoiced')
        and (select count(*) from checkpoint_results c where c.report_id = b.report_id
          and c.room_id = b.room_id and c.done and c.deleted_at is null and c.tg_direct = '1') = 7
        and (select count(*) from checkpoint_results c where c.report_id = b.report_id
          and c.room_id = b.room_id and c.done and c.deleted_at is null and c.tg_direct = '0') = 1
        and not exists (select 1 from deviations d join checkpoint_results c on c.id = d.checkpoint_result_id
          where c.report_id = b.report_id and c.room_id = b.room_id and d.deleted_at is null)
      order by b.number, b.room_name limit 1`,
    "badet uten avvik",
  );
}

/** Et ferdig eller fakturert bad med åtte punkt ferdige. */
export async function findFinishedBath(): Promise<E2eBath> {
  return findOne(
    (db) => db`
      with baths as (${BATHS(db)})
      select b.assignment_id, b.room_id, b.number, b.room_name, b.status from baths b
      where b.status in ('completed', 'invoiced')
        and (select count(*) from checkpoint_results c where c.report_id = b.report_id
          and c.room_id = b.room_id and c.done and c.deleted_at is null) = 8
        and exists (select 1 from deviations d join checkpoint_results c on c.id = d.checkpoint_result_id
          where c.report_id = b.report_id and c.room_id = b.room_id and d.deleted_at is null and d.tg = 3)
      order by b.number, b.room_name limit 1`,
    "ferdig bad med TG3",
  );
}

/** Badet med «Ukjent» byggeår. */
export async function findUnknownYearBath(): Promise<E2eBath> {
  return findOne(
    (db) => db`
      with baths as (${BATHS(db)})
      select b.assignment_id, b.room_id, b.number, b.room_name, b.status from baths b
      where b.status = 'in_progress'
        and exists (select 1 from field_answers fa
          join template_elements te on te.id = fa.element_id and te.organization_id = fa.organization_id
          where fa.report_id = b.report_id and fa.room_id = b.room_id and fa.deleted_at is null
            and te.key = 'wet_room.build_year_source' and fa.value_option_keys = array['unknown'])
      order by b.number, b.room_name limit 1`,
    "badet med «Ukjent» byggeår",
  );
}

/** Badet med avvist TG0-forslag (målt på nytt). */
export async function findRejectedSuggestionBath(): Promise<E2eBath> {
  return findOne(
    (db) => db`
      with baths as (${BATHS(db)})
      select b.assignment_id, b.room_id, b.number, b.room_name, b.status from baths b
      where b.status = 'in_progress'
        and exists (select 1 from rule_suggestion_decisions rsd
          join checkpoint_results c on c.id = rsd.checkpoint_result_id
          where c.report_id = b.report_id and c.room_id = b.room_id and rsd.deleted_at is null
            and rsd.decision = 'rejected' and rsd.override_reason_code = 'measured_again')
      order by b.number, b.room_name limit 1`,
    "badet med avvist forslag",
  );
}

async function findOne(
  query: (db: postgres.Sql) => postgres.PendingQuery<postgres.Row[]>,
  what: string,
): Promise<E2eBath> {
  const db = sql();
  try {
    const [row] = (await query(db)) as unknown as BathRow[];
    if (!row) throw new Error(`Fant ikke ${what} (kjør pnpm db:seed:testdata)`);
    return toBath(row);
  } finally {
    await db.end();
  }
}

/** Beskrivelsen på et punkt i badet, og om punktet er ferdig. Bare lesing. */
export async function checkpointState(
  bath: E2eBath,
  checkpointKey: string,
): Promise<{ description: string | null; done: boolean } | null> {
  const db = sql();
  try {
    const [row] = await db<{ description_text: string | null; done: boolean }[]>`
      select c.description_text, c.done from checkpoint_results c
      join checkpoints cp on cp.id = c.checkpoint_id and cp.organization_id = c.organization_id
      join reports rep on rep.id = c.report_id and rep.organization_id = c.organization_id
      where rep.assignment_id = ${bath.assignmentId} and c.room_id = ${bath.roomId}
        and cp.key = ${checkpointKey} and c.deleted_at is null and rep.deleted_at is null`;
    return row ? { description: row.description_text, done: row.done } : null;
  } finally {
    await db.end();
  }
}

/** Punktene i badet som ikke står ferdige (faste koder). Bare lesing. */
export async function openCheckpointKeys(bath: E2eBath): Promise<string[]> {
  const db = sql();
  try {
    const rows = await db<{ key: string }[]>`
      select cp.key from checkpoints cp
      join reports rep on rep.template_version_id = cp.version_id
        and rep.organization_id = cp.organization_id
      where rep.assignment_id = ${bath.assignmentId} and rep.deleted_at is null
        and rep.status <> 'superseded' and cp.key like 'wet_room.%'
        and not exists (select 1 from checkpoint_results c where c.report_id = rep.id
          and c.room_id = ${bath.roomId} and c.checkpoint_id = cp.id and c.done
          and c.deleted_at is null)
      order by cp.sort_order`;
    return rows.map((row) => row.key);
  } finally {
    await db.end();
  }
}
