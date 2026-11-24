import { PUBLISH_OVERRIDE_REASON_LABELS, publishFindingText } from "@/core/reports/logic";
import type { ReleaseView } from "@/core/reports/publish-types";
import { Card } from "@/shared/ui/card";
import { NewVersionButton } from "./publiser/new-version-button";
import { formatDate } from "./publiser/publish-model";
import { RELEASES_TEXTS } from "./publiser/publish-texts";

/*
 * «Utgivelser» på oppdraget (docs/funksjoner/fase2a-publisering-badet.md Omfang 13,
 * designet avsnitt 15). Hver versjon med hvem som publiserte, når, og hvilke sperrer som ble
 * krysset bort med grunn. Begrunnelsesteksten fjernes i kjernen for den som ikke har
 * `canSeeOverrideReasons` (kontor), så den aldri når nettleseren. Ingen knapper for endring
 * eller sletting; utgivelser endres aldri.
 * Støtter hovedmål: færre reklamasjoner (leder ser hvem som krysset bort hva og hvorfor).
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

export const RELEASES_ANCHOR = "utgivelser";

export function ReleasesCard({
  assignmentId,
  releases,
  newVersion,
  canSeeReasons,
}: {
  assignmentId: string;
  /** Bare visning: kjernen har alt fjernet teksten for den som ikke får se den. */
  canSeeReasons: boolean;
  /** Nyeste først, som `listReleases` gir dem. */
  releases: readonly ReleaseView[];
  /** Satt når rapporten er publisert og den ansatte har `report.edit`. */
  newVersion: { currentVersion: number } | null;
}) {
  if (releases.length === 0) return null;
  return (
    <section
      id={RELEASES_ANCHOR}
      tabIndex={-1}
      aria-labelledby="releases-heading"
      className="mb-8 scroll-mt-4 rounded-xl"
    >
      <h2 id="releases-heading" className="mb-3 text-xl font-semibold text-slate-900">
        {RELEASES_TEXTS.heading}
      </h2>
      <Card className="space-y-2 p-0">
        <ul>
          {releases.map((release) => (
            <li key={release.id} className="border-t border-line first:border-t-0">
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fjord">
                  <span className="font-medium text-slate-900">
                    {RELEASES_TEXTS.version(release.versionNumber)}
                  </span>
                  <span className="text-sm text-slate-700">
                    {formatWhen(release.releasedAt)} · {release.releasedByName}
                  </span>
                  <span className="text-sm text-slate-700">
                    {RELEASES_TEXTS.overriddenCount(release.overrides.length)}
                  </span>
                  <span aria-hidden="true" className="ml-auto text-slate-700 group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <div className="space-y-3 px-6 pb-5 text-sm text-slate-900">
                  <p>
                    {RELEASES_TEXTS.validUntil(
                      release.validUntil ? formatDate(release.validUntil) : null,
                    )}
                  </p>
                  {release.versionNumber > 1 && (
                    <p>{RELEASES_TEXTS.firstRelease(formatDate(release.originalReleaseDate))}</p>
                  )}
                  {release.overrides.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="font-medium">{RELEASES_TEXTS.overridesHeading}</h3>
                      <ul className="space-y-3">
                        {release.overrides.map((override, index) => (
                          <li
                            key={`${override.checkCode}-${index}`}
                            className="rounded-lg bg-sand px-4 py-3"
                          >
                            <p className="font-medium">
                              {publishFindingText({
                                checkCode: override.checkCode,
                                target: override.target,
                              })}
                            </p>
                            {(override.checkpointLabel ?? override.roomName) && (
                              <p className="text-slate-700">
                                {[override.roomName, override.checkpointLabel]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                            <p>
                              {RELEASES_TEXTS.reason(
                                PUBLISH_OVERRIDE_REASON_LABELS[override.reasonCode],
                              )}
                              {override.reason && <> «{override.reason}»</>}
                            </p>
                            {!canSeeReasons && (
                              <p className="text-slate-700">{RELEASES_TEXTS.reasonHidden}</p>
                            )}
                            <p className="text-slate-700">
                              {RELEASES_TEXTS.by(override.overriddenByName)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
        {newVersion && (
          <div className="border-t border-line px-6 py-4">
            <NewVersionButton
              assignmentId={assignmentId}
              currentVersion={newVersion.currentVersion}
            />
          </div>
        )}
      </Card>
    </section>
  );
}
