import { and, eq, isNull, ne } from "drizzle-orm";
import { reports } from "@/db/schema";
import type { IsReportPublishedForAssignment } from "./publish-types";

/*
 * Låsen etter publisering (docs/funksjoner/fase2a-publisering-badet.md Omfang 10, ADR 0015 punkt
 * 15, A447). Én kjernefunksjon som skrivetjenestene i `src/core/buildings` spør før de endrer rom,
 * etasjer eller bygninger. Filen importerer bare skjemaet, så `src/core/buildings` kan bruke den
 * uten å hente hele rapportkjernen (rapportkjernen importerer selv fra `src/core/buildings`).
 * Støtter hovedmål: færre reklamasjoner (en publisert rapport endres ikke i det stille).
 */

/** Meldingen når noe skrives i en publisert rapport. Står bare her. */
export const REPORT_PUBLISHED_MESSAGE = "Rapporten er publisert. Lag ny versjon for å rette.";

/**
 * Om oppdragets gjeldende rapport er publisert. Ingen egen tilgangssjekk: kalleren har alt sjekket
 * tilgangen og sender `grant.organizationId`. Kalles i samme transaksjon som skrivingen.
 * Rapportraden låses med `FOR SHARE`, så en publisering som pågår blir ferdig før svaret gis, og
 * ingen endring kan smette inn mellom snapshot og `status = published`. Oppdrag uten rapport gir
 * `false`.
 */
export const isReportPublishedForAssignment: IsReportPublishedForAssignment = async (
  executor,
  organizationId,
  assignmentId,
) => {
  const [row] = await executor
    .select({ status: reports.status })
    .from(reports)
    .where(
      and(
        eq(reports.organizationId, organizationId),
        eq(reports.assignmentId, assignmentId),
        isNull(reports.deletedAt),
        ne(reports.status, "superseded"),
      ),
    )
    .for("share");
  return row?.status === "published";
};
