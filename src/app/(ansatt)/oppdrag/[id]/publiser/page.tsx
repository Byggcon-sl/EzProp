import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { getAssignment } from "@/core/assignments";
import { getPublishCheck } from "@/core/reports";
import type { PublishCheckView } from "@/core/reports/publish-types";
import { isUuid } from "@/shared/lib/uuid";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { getEmployeeContext } from "../../../employee-context";
import { NoAccess } from "../../../no-access";
import { aiFieldsOf, type AiFieldInfo } from "./ai-fields";
import { NewVersionButton } from "./new-version-button";
import { PUBLISH_TEXTS } from "./publish-texts";
import { PublishView } from "./publish-view";

export const metadata: Metadata = { title: PUBLISH_TEXTS.title };

/*
 * «Se over og publiser» for oppdragets rapport (docs/funksjoner/fase2a-publisering-badet.md
 * Omfang 5–7). Siden leser bare: `getPublishCheck` sjekker tilgangen (`organization.read`) og
 * regner sjekken på lagrede data; rader i `publish_check_results` lages bare ved publisering.
 * Ugyldig id eller oppdrag i en annen organisasjon gir «Fant ikke siden». Ingen parter, adresse
 * eller matrikkel sendes til nettleseren.
 * Støtter hovedmål: de ansatte, færre reklamasjoner og KI i bunnen (se `publish-view.tsx`).
 */

/** «17.11.2026 kl. 14.05» i norsk tid. */
function formatWhen(iso: string): string {
  const parts = new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")} kl. ${part("hour")}.${part("minute")}`;
}

function Header({ assignmentId, number }: { assignmentId: string; number: string | null }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white px-5 py-3 lg:px-8">
      <div className="flex min-w-0 items-start gap-2">
        <Link
          href={`/oppdrag/${assignmentId}`}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg text-slate-900 hover:bg-slate-100"
        >
          <span aria-hidden="true">‹</span>
          <span className="sr-only">{PUBLISH_TEXTS.backLabel}</span>
        </Link>
        <div className="min-w-0">
          <p className="text-sm text-stone">
            {number ? `Oppdrag ${number} · ` : ""}
            {PUBLISH_TEXTS.reportType}
          </p>
          <h1 className="font-heading text-xl font-semibold text-slate-900">
            {PUBLISH_TEXTS.title}
          </h1>
        </div>
      </div>
    </header>
  );
}

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  if (!isUuid(id)) notFound();

  let check: PublishCheckView;
  let number: string | null;
  let aiFields: Record<string, AiFieldInfo> = {};
  try {
    const [view, assignment] = await Promise.all([
      getPublishCheck(context.actor, context.organizationId, id),
      getAssignment(context.actor, context.organizationId, id),
    ]);
    check = view;
    number = assignment.number;
    aiFields = await aiFieldsOf(context.actor, context.organizationId, id, check);
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }

  const body = (() => {
    if (check.state === "not_started") {
      return (
        <div className="mx-auto max-w-190 px-5 pt-5 md:px-6">
          <Card>
            <p className="text-slate-900">{PUBLISH_TEXTS.notStarted}</p>
            <Link
              href={`/oppdrag/${id}/bygninger`}
              className="mt-3 inline-flex min-h-11 items-center font-medium text-fjord-dark underline"
            >
              {PUBLISH_TEXTS.toBuildings}
              <span aria-hidden="true">&nbsp;›</span>
            </Link>
          </Card>
        </div>
      );
    }
    if (check.state === "published") {
      return (
        <div className="mx-auto max-w-190 space-y-6 px-5 pt-5 pb-8 md:px-6">
          <section
            aria-labelledby="published-heading"
            className="space-y-4 rounded-card bg-sand p-5 md:p-6"
          >
            <h2 id="published-heading" className="text-xl font-semibold text-slate-900">
              {PUBLISH_TEXTS.publishedHeading(check.versionNumber)}
            </h2>
            <p className="text-slate-900">
              {PUBLISH_TEXTS.alreadyPublishedLine(formatWhen(check.releasedAt))}
            </p>
            <Link
              href={`/oppdrag/${id}`}
              className={`${buttonVariants({ variant: "primary", size: "lg" })} lg:min-w-70`}
            >
              {PUBLISH_TEXTS.toAssignment}
            </Link>
          </section>
          {check.canStartNewVersion && (
            <NewVersionButton assignmentId={id} currentVersion={check.versionNumber} />
          )}
        </div>
      );
    }
    if (!check.hasWetRoom) {
      return (
        <div className="mx-auto max-w-190 px-5 pt-5 md:px-6">
          <Card>
            <p className="text-slate-900">{PUBLISH_TEXTS.noWetRoom}</p>
            <Link
              href={`/oppdrag/${id}/bygninger`}
              className="mt-3 inline-flex min-h-11 items-center font-medium text-fjord-dark underline"
            >
              {PUBLISH_TEXTS.toBuildings}
              <span aria-hidden="true">&nbsp;›</span>
            </Link>
          </Card>
        </div>
      );
    }
    return (
      <PublishView
        key={`${check.reportId}-${check.nextVersionNumber}`}
        assignmentId={id}
        assignmentNumber={number}
        initial={check}
        initialAiFields={aiFields}
      />
    );
  })();

  return (
    <div className="-mx-5 -mt-6 min-h-dvh bg-snow lg:-mx-8 lg:-mt-8">
      <Header assignmentId={id} number={number} />
      <main>{body}</main>
    </div>
  );
}
