import type { PublishPreviewRoom } from "@/core/reports/publish-types";
import { TgBadge, type TgBadgeValue } from "@/shared/ui/tg-badge";
import { costText, formatDate } from "./publish-model";
import { PUBLISH_TEXTS } from "./publish-texts";

/*
 * «Dette publiseres» (F4, docs/funksjoner/fase2a-publisering-badet-design.md avsnitt 5). Bygget av
 * serveren med samme funksjon som snapshot, så det som står her, er det som lagres. TG fra høyeste
 * ned; TG3 får kostnaden i parentes. Punkter uten TG telles ikke her; de står som sperrer.
 * Støtter hovedmål: færre reklamasjoner (feil TG eller et glemt punkt synes før publisering).
 */

const ORDER: TgBadgeValue[] = ["3", "2", "IU", "1", "0"];

function RoomLine({ room }: { room: PublishPreviewRoom }) {
  const counts = ORDER.filter((tg) => room.tgCounts[tg] > 0);
  const costs = room.tg3Costs.map((cost) => costText(cost)).filter((text) => text !== "");
  return (
    <div className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0 first:pt-0 md:flex-row md:gap-4">
      <dt className="font-medium text-slate-900 md:w-48 md:shrink-0">
        {room.roomName ?? PUBLISH_TEXTS.unnamedRoom}
      </dt>
      <dd className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-slate-900">
        {counts.length === 0 && <span>{PUBLISH_TEXTS.noTgYet}</span>}
        {counts.map((tg) => (
          <span key={tg} className="inline-flex items-center gap-1">
            <TgBadge tg={tg} />
            <span aria-hidden="true">×{room.tgCounts[tg]}</span>
            <span className="sr-only">{PUBLISH_TEXTS.countLabel(room.tgCounts[tg])}</span>
            {tg === "3" && costs.length > 0 && (
              <span>({PUBLISH_TEXTS.tg3Cost(costs.join(", "))})</span>
            )}
          </span>
        ))}
      </dd>
    </div>
  );
}

export function PublishSummary({
  version,
  validUntil,
  inherited,
  rooms,
}: {
  version: number;
  validUntil: string | null;
  inherited: boolean;
  rooms: readonly PublishPreviewRoom[];
}) {
  return (
    <section aria-labelledby="publish-summary-heading" className="rounded-card bg-sand p-5 md:p-6">
      <h2 id="publish-summary-heading" className="text-lg font-semibold text-slate-900">
        {PUBLISH_TEXTS.summaryHeading}
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        {PUBLISH_TEXTS.versionLine(
          version,
          validUntil === null ? null : formatDate(validUntil),
          inherited,
        )}
      </p>
      <dl className="mt-4">
        {rooms.map((room) => (
          <RoomLine key={room.roomId} room={room} />
        ))}
      </dl>
    </section>
  );
}
