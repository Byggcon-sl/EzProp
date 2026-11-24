import type { EmployeeGrant } from "@/core/access";
import type { DbExecutor } from "@/db/client";

/**
 * Oppslag i revisjonsloggen for bestemte rader (docs/funksjoner/fase2a-tg-spor.md, ADR 0013 punkt
 * 9c). Støtter hovedmålene færre reklamasjoner og de ansatte: sporet bak en TG kan vises uten at
 * noen må lete i loggen.
 */
export type EntityAuditEventFilter = {
  /** `entity_type`, for eksempel `deviation` og `checkpoint_result`. 1–10 faste koder. */
  entityTypes: readonly string[];
  /** `entity_id`. Høyst `ENTITY_AUDIT_EVENT_IDS_MAX`; tom liste gir tomt svar uten spørring. */
  entityIds: readonly string[];
  /** Rapporten radene hører til: bare hendelser med `changes.reportId` lik denne tas med. */
  reportId: string;
};

/** Én rad fra revisjonsloggen. Ingen navn og ingen enhets-id. */
export type EntityAuditEvent = {
  /** UUID v7: avgjør rekkefølgen ved lik tid. */
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  /**
   * Rå `changes`. **Bare for kjernen:** kalleren tolker den strengt (for sporet:
   * `ParseTgTrailAuditEvent`) og sender den aldri videre til en skjerm, en logg eller KI.
   */
  changes: Readonly<Record<string, unknown>>;
  /** Bare for rolleoppslag i kjernen. Går aldri ut av tjenesten som kaller. */
  actorEmployeeId: string | null;
  /** Tiden på enheten. `received_at` gis aldri ut. */
  occurredAt: Date;
};

/**
 * Hendelsene for bestemte rader i én rapport, eldst først (`occurred_at`, så `id`).
 *
 * - **Kjernefunksjon uten egen rettighetssjekk** (som `isReportPublishedForAssignment`): kalles
 *   bare av en tjeneste i `src/core` som alt har sjekket tilgang, med den tjenestens `grant`.
 *   Eksporteres fra `@/core/audit`, men kalles aldri fra en side, en serverhandling eller en modul.
 * - Filtrerer alltid på `grant.organizationId`, på `entity_type` og `entity_id` (indeksen
 *   `audit_log_entity_idx`) og på `changes->>'reportId'`. En id fra en annen organisasjon eller en
 *   annen rapport gir ingen rader. Egen `expectTenantIsolation`.
 * - Kalleren har slått opp id-ene med organisasjon og rapport først (også mykt slettede avvik).
 * - Bare lesing. Ingen kode endrer eller sletter rader i revisjonsloggen.
 * - Flere id-er enn grensen, eller en id som ikke er en UUID, gir tomt svar (feiler lukket).
 */
export type ListEntityAuditEvents = (
  executor: DbExecutor,
  grant: EmployeeGrant,
  filter: EntityAuditEventFilter,
) => Promise<EntityAuditEvent[]>;
