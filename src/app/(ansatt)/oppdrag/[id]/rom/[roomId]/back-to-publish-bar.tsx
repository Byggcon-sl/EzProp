"use client";

import Link from "next/link";
import { buttonVariants } from "@/shared/ui/button";
import { PUBLISH_LINK_TEXTS } from "../../publiser/publish-texts";
import { useFlushedNavigation } from "./publish-link";

/*
 * «Tilbake til publisering (2 igjen)» (F2, docs/funksjoner/fase2a-publisering-badet-design.md
 * avsnitt 14). Vises når rommet er åpnet med «Gå til» fra publiser-siden (`?fra=publiser`). Tallet
 * er sperrer som ikke er rettet, regnet lokalt. Det som venter, lagres før navigering.
 * Støtter hovedmål: de ansatte (rett tilbake til listen etter retting, ingen leting).
 */

export function BackToPublishBar({
  assignmentId,
  remaining,
  beforeNavigate,
}: {
  assignmentId: string;
  remaining: number;
  beforeNavigate: () => Promise<void>;
}) {
  const navigate = useFlushedNavigation(beforeNavigate);
  const href = `/oppdrag/${assignmentId}/publiser`;
  return (
    <div className="-mx-5 -mt-4 mb-3 flex min-h-16 items-center border-b border-line bg-sand px-5 py-2 md:-mx-6 md:px-6">
      <div className="mx-auto flex w-full max-w-190">
        <Link
          href={href}
          onClick={navigate(href)}
          className={buttonVariants({ variant: "primary", size: "md" })}
        >
          {PUBLISH_LINK_TEXTS.back(remaining)}
        </Link>
      </div>
    </div>
  );
}
