import type { Metadata } from "next";
import { AccessDeniedError } from "@/core/access";
import {
  getTimeStatistics,
  secondsToDisplayMinutes,
  WORK_PHASES,
  type TimeStatistics,
} from "@/core/work-sessions";
import { Card } from "@/shared/ui/card";
import { Notice } from "@/shared/ui/notice";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { saveTimeTrackingSettingsAction } from "./actions";
import { formatDifference, phaseLabels } from "./labels";
import { TimeTrackingSettingsForm, type TimeTrackingFormValues } from "./settings-form";

export const metadata: Metadata = { title: "Tid per oppdrag" };

type Row = {
  label: string;
  averageSeconds: number;
  baselineMinutes: number | null;
  differencePercent: number | null;
};

function StatisticsTable({ rows, total }: { rows: Row[]; total: Row }) {
  const cell = "px-3 py-2.5 text-right tabular-nums";
  const head = "px-3 py-2.5 text-right font-medium text-slate-700";
  const render = (row: Row, isTotal: boolean) => (
    <tr
      key={row.label}
      className={
        isTotal ? "border-t-2 border-slate-300 font-semibold" : "border-t border-slate-200"
      }
    >
      <th scope="row" className="px-3 py-2.5 text-left font-medium text-slate-900">
        {row.label}
      </th>
      <td className={cell}>{secondsToDisplayMinutes(row.averageSeconds)}</td>
      <td className={cell}>{row.baselineMinutes ?? "–"}</td>
      <td className={cell}>{formatDifference(row.differencePercent)}</td>
    </tr>
  );
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th scope="col" className="px-3 py-2.5 text-left font-medium text-slate-700">
            Fase
          </th>
          <th scope="col" className={head}>
            Snitt minutter per oppdrag
          </th>
          <th scope="col" className={head}>
            Nullpunkt fra IVIT (min)
          </th>
          <th scope="col" className={head}>
            Forskjell
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => render(row, false))}
        {render(total, true)}
      </tbody>
    </table>
  );
}

function formValues(statistics: TimeStatistics): TimeTrackingFormValues {
  const baseline = statistics.baseline;
  return {
    enabled: statistics.enabled,
    source: baseline?.source ?? "",
    phases: WORK_PHASES.map((phase) => ({
      phase,
      label: phaseLabels[phase],
      minutes: baseline ? String(baseline[phase]) : "",
    })),
  };
}

/**
 * Samlet tid per fase for ferdige oppdrag, ved siden av nullpunktet fra IVIT
 * (docs/funksjoner/fase2a-tidsmaling.md punkt 5 og 6). Bare samlet, aldri per person
 * (arbeidsmiljøloven kapittel 9). Kjernen krever `statistics.read`; uten den vises «Ingen tilgang».
 * Skjemaet vises bare for admin. Støtter hovedmål: tid (leder ser om vi nærmer oss 50 %).
 */
export default async function TimeStatisticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;

  let statistics: TimeStatistics;
  try {
    statistics = await getTimeStatistics(context.actor, context.organizationId);
  } catch (error) {
    if (error instanceof AccessDeniedError) return <NoAccess />;
    throw error;
  }
  const saved = (await searchParams).lagret === "1";

  const rows: Row[] = statistics.phases.map((row) => ({
    label: phaseLabels[row.phase],
    averageSeconds: row.averageSeconds,
    baselineMinutes: row.baselineMinutes,
    differencePercent: row.differencePercent,
  }));
  const total: Row = { label: "Totalt", ...statistics.total };

  return (
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Tid per oppdrag</h1>
      <p className="mt-2 text-slate-600">
        Tiden måles automatisk mens oppdraget er åpent. Tallene vises bare samlet, aldri per person.
      </p>
      {!statistics.enabled && (
        <p className="mt-2 text-slate-600">Målingen er slått av. Nye økter lagres ikke.</p>
      )}
      {saved && (
        <div className="mt-4">
          <Notice message="Lagret." />
        </div>
      )}
      <Card className="mt-6">
        {statistics.assignmentCount === 0 ? (
          <p className="text-slate-700">Ingen ferdige oppdrag med målt tid ennå.</p>
        ) : (
          <>
            <p className="mb-3 text-slate-700">
              Ferdige oppdrag med målt tid:{" "}
              <span className="font-semibold tabular-nums">{statistics.assignmentCount}</span>
            </p>
            <StatisticsTable rows={rows} total={total} />
          </>
        )}
      </Card>
      {context.canManageOrganization && (
        <div className="mt-8">
          <TimeTrackingSettingsForm
            initial={formValues(statistics)}
            action={saveTimeTrackingSettingsAction}
          />
        </div>
      )}
    </main>
  );
}
