import type { Metadata } from "next";
import Link from "next/link";
import {
  assignmentStatusLabel,
  countWorkQueueByStatus,
  listWorkQueue,
  parseWorkQueueParams,
  WORK_QUEUE_LIMIT,
} from "@/core/assignments";
import { requireActor } from "@/core/auth/session";
import { brand } from "@/shared/config/brand";
import { cn } from "@/shared/lib/cn";
import { isUuid } from "@/shared/lib/uuid";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormMessage } from "@/shared/ui/form";
import { Notice } from "@/shared/ui/notice";
import { getEmployeeContext } from "../employee-context";
import { loadListOrError } from "../list-error";
import { FocusCard } from "./focus-card";
import { QueueCard } from "./queue-card";
import { isNoteErrorCode, otherTabHits, queueHref, type NoteErrorCode } from "./queue-href";
import { QueueToolbar } from "./queue-toolbar";

export const metadata: Metadata = { title: "Arbeidskø" };

/** Plusstegnet foran «Nytt oppdrag». */
function PlusIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Kvitteringen etter kansellering. Bare et oppdragsnummer (sifre og bindestrek, kort) vises, så
 * ingen fritekst fra adressen havner på siden.
 */
function cancelledNotice(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !/^\d[\d-]{0,19}$/.test(value)) return null;
  return `Oppdrag ${value} er kansellert.`;
}

/** Tekstene til feilkodene fra «Lagre» på notatet (`?feil=`). */
const NOTE_ERROR_TEXT: Record<NoteErrorCode, string> = {
  for_langt: "Notatet kan ha høyst 200 tegn.",
  fnr: "Fødselsnummer skal ikke lagres her.",
  ikke_funnet: "Fant ikke oppdraget. Det kan være kansellert.",
  ingen_tilgang: "Du har ikke tilgang til å endre notatet.",
  ukjent: "Noe gikk galt. Ingenting er lagret. Prøv igjen.",
};

/** Feil som står ved feltet i kortet; de andre står øverst på siden. */
const FIELD_ERRORS: readonly NoteErrorCode[] = ["for_langt", "fnr"];

/** Notatfeilen fra adressen: koden, og kortet den hører til (bare en uuid). */
function noteErrorFrom(params: SearchParams) {
  const code = params.feil;
  if (!isNoteErrorCode(code)) return null;
  const id =
    typeof params.notatfeil === "string" && isUuid(params.notatfeil) ? params.notatfeil : null;
  return { code, assignmentId: id };
}

/**
 * Startsiden: arbeidskøen. Fire faner etter status med antall, Mine/Alle og søk, og ett kort per
 * oppdrag med merker og notat. Fane, filter og søk står i adressen (`?status=`, `?mine=0`, `?q=`)
 * og tolkes i kjernen; organisasjonen kommer fra `getEmployeeContext()`, og kjernen filtrerer på
 * organisasjonen fra tilgangssjekken. `?kansellert=<oppdragsnummer>` gir kvitteringen etter
 * «Kanseller» på oppdragssiden.
 */
export default async function WorkQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const notice = cancelledNotice(params.kansellert);
  const context = await getEmployeeContext();

  return (
    <main className="max-w-3xl">
      <FocusCard />
      {notice && (
        <div className="mb-4">
          <Notice message={notice} />
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900">Arbeidskø</h1>
          <p className="mt-1 text-slate-600">Hei, {actor.name}.</p>
        </div>
        {context?.canCreateAssignments && (
          <Link href="/oppdrag/ny" className={buttonVariants({ variant: "primary", size: "lg" })}>
            <PlusIcon />
            Nytt oppdrag
          </Link>
        )}
      </div>
      {context ? (
        <WorkQueue
          actor={context.actor}
          organizationId={context.organizationId}
          canEdit={context.canEditOrders}
          canCreate={context.canCreateAssignments}
          defaultMine={context.defaultMineOnly}
          params={params}
        />
      ) : (
        <div className="mt-6">
          <Card>
            <h2 className="text-lg font-medium">Du er ikke registrert som ansatt</h2>
            <p className="mt-2 text-slate-600">
              Innloggingen virker, men ingen har lagt deg inn som ansatt. Kontakt{" "}
              {brand.companyName} på {brand.supportEmail}.
            </p>
          </Card>
        </div>
      )}
    </main>
  );
}

async function WorkQueue({
  actor,
  organizationId,
  canEdit,
  canCreate,
  defaultMine,
  params,
}: {
  actor: Awaited<ReturnType<typeof requireActor>>;
  organizationId: string;
  canEdit: boolean;
  /** Viser «Nytt oppdrag» i tom fane «Bestilt». Selve sjekken skjer i kjernen. */
  canCreate: boolean;
  /** Fra rollene i tilgangssjekken (`defaultMineOnly(grant.roles)`), aldri fra adressen. */
  defaultMine: boolean;
  params: SearchParams;
}) {
  const queue = parseWorkQueueParams(params, { defaultMineOnly: defaultMine });
  const result = await loadListOrError("/arbeidskoe", actor.id, () =>
    Promise.all([
      listWorkQueue(actor, organizationId, queue),
      countWorkQueueByStatus(actor, organizationId, {
        mineOnly: queue.mineOnly,
        query: queue.query,
      }),
    ]),
  );
  if (!result.ok) {
    return (
      <>
        <QueueToolbar queue={queue} />
        <div className="mt-6">
          <FormMessage message={result.message} />
        </div>
      </>
    );
  }
  const [{ items }, counts] = result.value;
  const total = counts[queue.status];
  const statusLabel = assignmentStatusLabel(queue.status);
  const noteError = noteErrorFrom(params);
  const fieldError = noteError && FIELD_ERRORS.includes(noteError.code) ? noteError : null;
  const pageError = noteError && !fieldError ? NOTE_ERROR_TEXT[noteError.code] : null;
  const now = new Date();
  const hitsElsewhere =
    items.length === 0 && queue.query !== "" ? otherTabHits(counts, queue.status) : [];

  return (
    <>
      <QueueToolbar queue={queue} counts={counts} />
      {pageError && (
        <div className="mt-4">
          <FormMessage message={pageError} />
        </div>
      )}
      <div className="mt-6">
        {items.length === 0 ? (
          <Card data-testid="work-queue-empty">
            {hitsElsewhere.length > 0 ? (
              <p
                data-testid="work-queue-hits"
                className="flex flex-wrap items-center text-slate-900"
              >
                <span>Ingen treff i denne fanen. Treff i:{"\u00a0"}</span>
                {hitsElsewhere.map((hit, index) => (
                  <span key={hit.status} className="inline-flex items-center">
                    <Link
                      href={queueHref({ ...queue, status: hit.status })}
                      data-testid={`work-queue-hits-${hit.status}`}
                      className="inline-flex min-h-11 items-center font-medium text-brand-700 hover:underline"
                    >
                      {assignmentStatusLabel(hit.status)} ({hit.count})
                    </Link>
                    {index < hitsElsewhere.length - 1 ? <span>,{"\u00a0"}</span> : "."}
                  </span>
                ))}
              </p>
            ) : (
              <p className="text-slate-900">Ingen oppdrag med status {statusLabel}.</p>
            )}
            {/* Sekundær: hovedknappen «Nytt oppdrag» står allerede øverst (én hovedhandling). */}
            {queue.status === "ordered" && canCreate && (
              <Link
                href="/oppdrag/ny"
                className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-4")}
              >
                Nytt oppdrag
              </Link>
            )}
          </Card>
        ) : (
          <ul aria-label={`Oppdrag med status ${statusLabel}`} className="space-y-3">
            {items.map((item) => (
              <QueueCard
                key={item.id}
                item={item}
                queue={queue}
                canEdit={canEdit}
                noteError={
                  fieldError?.assignmentId === item.id ? NOTE_ERROR_TEXT[fieldError.code] : null
                }
                now={now}
              />
            ))}
          </ul>
        )}
        {total > items.length && items.length >= WORK_QUEUE_LIMIT && (
          <p data-testid="work-queue-limit" className="mt-4 text-sm text-slate-600">
            Viser {items.length} av {total}. Bruk søket for å finne flere.
          </p>
        )}
      </div>
    </>
  );
}
