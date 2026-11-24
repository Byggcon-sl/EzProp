import Link from "next/link";
import type { PublishFindingView } from "@/core/reports/publish-types";
import { buttonVariants } from "@/shared/ui/button";
import { Warning } from "@/shared/ui/warning";
import { findingDomId, findingText } from "./publish-model";
import { PUBLISH_TEXTS } from "./publish-texts";

/*
 * En advarsel i «Bør sees over» (design avsnitt 9). Samme `Warning` som rommet, med funnteksten
 * laget fra koden og punktnavnet under. Ingen bryter og ingen bekreftelse: advarsler sperrer
 * aldri. «Gå til» åpner punktet på rommet, der rettingen («Rett nå» på rommet) står.
 * Støtter hovedmål: færre reklamasjoner (det som bør sees over, står samlet) og de ansatte.
 */

export function WarningItem({
  item,
  onGoTo,
}: {
  item: PublishFindingView;
  /** Kalles før «Gå til» navigerer, så siden husker hvor den ansatte gikk fra. */
  onGoTo: (key: string) => void;
}) {
  const place = item.checkpointLabel ?? item.roomName ?? PUBLISH_TEXTS.reportGroup;
  return (
    <Warning
      id={findingDomId(item.key)}
      focusable
      action={
        item.href ? (
          <Link
            href={item.href}
            onClick={() => onGoTo(item.key)}
            aria-label={PUBLISH_TEXTS.goToLabel(place)}
            className={buttonVariants({ variant: "secondary", size: "md" })}
          >
            {PUBLISH_TEXTS.goTo}
          </Link>
        ) : undefined
      }
    >
      <span className="block font-medium">{findingText(item)}</span>
      {item.checkpointLabel && <span className="block text-slate-700">{item.checkpointLabel}</span>}
    </Warning>
  );
}
