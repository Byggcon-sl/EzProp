"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { buttonVariants } from "@/shared/ui/button";
import { PUBLISH_LINK_TEXTS } from "../../publiser/publish-texts";

/*
 * «Se over og publiser» med tellemerke (docs/funksjoner/fase2a-publisering-badet-design.md
 * avsnitt 14). Tallene regnes lokalt med `computePublishCheck` (ren kode) av rommet og oppdateres
 * når et felt er lagret. Endringer i tallet leses ikke opp; de står i lenketeksten (navnet er
 * den synlige teksten, så tale-styring finner den). Før
 * navigering lagres det som venter (`beforeNavigate`), så ingenting går tapt.
 * Støtter hovedmål: de ansatte (mangler synes før man går til publisering) og færre reklamasjoner.
 */

/** Lenke til publiser-siden eller tilbake dit, som venter på lagring før den går. */
export function useFlushedNavigation(beforeNavigate: () => Promise<void>) {
  const router = useRouter();
  return (href: string) => async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    await beforeNavigate();
    router.push(href);
  };
}

export function PublishLink({
  assignmentId,
  blockers,
  warnings,
  beforeNavigate,
  className,
}: {
  assignmentId: string;
  blockers: number;
  warnings: number;
  beforeNavigate: () => Promise<void>;
  className?: string;
}) {
  const navigate = useFlushedNavigation(beforeNavigate);
  const href = `/oppdrag/${assignmentId}/publiser`;
  return (
    <Link
      href={href}
      onClick={navigate(href)}
      className={cn(
        buttonVariants({ variant: "secondary", size: "md" }),
        "flex-wrap gap-2 py-1",
        className,
      )}
    >
      {/* Navnet er den synlige teksten: «Se over og publiser 2 må rettes, 3 bør sees over». */}
      {PUBLISH_LINK_TEXTS.link}
      <Badge>{PUBLISH_LINK_TEXTS.badge(blockers, warnings)}</Badge>
    </Link>
  );
}
