import type { Metadata } from "next";
import { AccessDeniedError } from "@/core/access";
import {
  AI_REJECTED_RETENTION_MAX,
  AI_REJECTED_RETENTION_MIN,
  getAiRetentionSettings,
} from "@/core/ai";
import { Notice } from "@/shared/ui/notice";
import { NoAccess } from "../../no-access";
import { getAdminContext } from "../admin-context";
import { saveAiRetentionSettingsAction } from "./actions";
import { AiRetentionSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "KI" };

/**
 * KI-innstillinger for admin: hvor lenge avviste KI-forslag minst oppbevares (K7, oppgavekortet
 * docs/agenter/oppgaver/ki-oppbevaring-avviste.md). Organisasjonen kommer fra økten
 * (`getAdminContext`), og kjernen krever `organization.manage`. Alle andre får samme «Ingen
 * tilgang» som de andre adminsidene. Støtter hovedmål: best for de ansatte og KI i bunnen.
 */
export default async function AiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;

  let years: number;
  try {
    const settings = await getAiRetentionSettings(context.actor, context.organizationId);
    years = settings.rejectedRetentionYears;
  } catch (error) {
    if (error instanceof AccessDeniedError) return <NoAccess />;
    throw error;
  }
  const saved = (await searchParams).lagret === "1";

  return (
    <main className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">KI</h1>
      <p className="mt-1 text-slate-600">
        Forslag fra KI og hva den ansatte bestemte om dem, lagres i en logg.
      </p>
      {saved && (
        <div className="mt-4">
          <Notice message="Lagret." />
        </div>
      )}
      <div className="mt-6">
        <AiRetentionSettingsForm
          initialYears={years}
          min={AI_REJECTED_RETENTION_MIN}
          max={AI_REJECTED_RETENTION_MAX}
          action={saveAiRetentionSettingsAction}
        />
      </div>
    </main>
  );
}
