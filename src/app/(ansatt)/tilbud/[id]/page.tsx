import type { Metadata } from "next";
import Link from "next/link";
import { AccessDeniedError } from "@/core/access";
import { getContact } from "@/core/contacts";
import { listOffices } from "@/core/organization";
import {
  OFFER_EXPIRING_SOON_DAYS,
  OFFER_REJECTION_REASON_KEYS,
  OFFER_VALID_UNTIL_MAX_DAYS,
  findPossibleDuplicateOrders,
  getOrder,
  listOrderHistory,
  offerDaysLeft,
  offerDisplayStatus,
  offerRejectionReasonLabel,
} from "@/core/orders";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { Card } from "@/shared/ui/card";
import { Detail, EMPTY } from "../../detail";
import { getEmployeeContext } from "../../employee-context";
import { contactName } from "../../kontakter/contact-name";
import { NoAccess } from "../../no-access";
import {
  convertOfferAction,
  extendOfferAction,
  rejectOfferAction,
  updateOfferAction,
} from "../actions";
import { officeChoice } from "../office-choice";
import { OfferStatusBadge, canExtendOffer, offerExpiryText } from "../offer-status-badge";
import { formatIsoDate, formatOsloDateTime, osloDateTimeLocal } from "../received-at";
import {
  CreatedNotice,
  OfferActions,
  RejectedCard,
  type ConvertOffice,
  type ReasonOption,
} from "./offer-actions";
import { OfferEditSection } from "./offer-edit-form";
import { OfferHistory } from "./offer-history";
import { PossibleDuplicatesNotice } from "./possible-duplicates-notice";

export const metadata: Metadata = { title: "Tilbud" };

/** «Gnr. 12, bnr. 34, snr. 5», eller `null` når ingen av dem er fylt ut. */
function cadastreText(order: { gnr: string | null; bnr: string | null; snr: string | null }) {
  const parts = [
    order.gnr && `Gnr. ${order.gnr}`,
    order.bnr && `bnr. ${order.bnr}`,
    order.snr && `snr. ${order.snr}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Tilbudssiden (docs/funksjoner/fase2a-tilbud-design.md avsnitt 5). Rekkefølgen er låst: tittel og
 * merke, «Gyldig til», kvittering, handlingsblokken med «Gjør om til oppdrag» øverst (ett trykk
 * uten rulling på iPad), «Avslå tilbudet», dublettvarselet (A369), detaljkortet, «Endre tilbudet»
 * og «Endringer». Ugyldig, ukjent, slettet og fremmed id gir samme svar som manglende tilgang.
 * `?ny=1` viser «Tilbudet er laget.» én gang (A373); andre kvitteringer kommer fra handlingene.
 */
export default async function OfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { ny } = await searchParams;
  const context = await getEmployeeContext();
  if (!context || !isUuid(id)) return <NoAccess />;

  let order: Awaited<ReturnType<typeof getOrder>>;
  let history: Awaited<ReturnType<typeof listOrderHistory>>;
  try {
    order = await getOrder(context.actor, context.organizationId, id);
    history = await listOrderHistory(context.actor, context.organizationId, id);
  } catch (error) {
    if (error instanceof AccessDeniedError) return <NoAccess />;
    throw error;
  }

  const today = todayInOslo();
  const displayStatus = offerDisplayStatus(order.status, order.validUntil, today);
  const daysLeft = displayStatus === "open" ? offerDaysLeft(order.validUntil, today) : null;
  const expiryText = offerExpiryText(daysLeft, OFFER_EXPIRING_SOON_DAYS);
  const handleable = order.status === "received";

  // Velgeren viser navnet fra kontaktregisteret, ikke friteksten om bestilleren.
  let linkedContactName: string | null = null;
  if (order.orderedByContactId && context.canEditOrders) {
    try {
      const contact = await getContact(
        context.actor,
        context.organizationId,
        order.orderedByContactId,
      );
      linkedContactName = contactName(contact);
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) throw error;
    }
  }

  // Varselet «Mulig dublett» (T3) skal aldri gjøre siden utilgjengelig: feiler oppslaget, vises
  // siden uten varsel. Loggen får bare id-er og feilnavnet, aldri adresse, matrikkel eller tekst.
  let duplicates: Awaited<ReturnType<typeof findPossibleDuplicateOrders>> = {
    items: [],
    hasMore: false,
  };
  try {
    duplicates = await findPossibleDuplicateOrders(context.actor, context.organizationId, order.id);
  } catch (error) {
    logger.error("Kunne ikke sjekke mulig dublett", {
      route: "/tilbud/[id]",
      orderId: order.id,
      userId: context.actor.id,
      errorName: error instanceof Error ? error.name : "ukjent feil",
    });
  }

  let actions = null;
  if (handleable && context.canEditOrders) {
    const choice = officeChoice(
      await listOffices(context.actor, context.organizationId),
      context.officeId,
    );
    const offices = choice.offices.map((office) => ({ id: office.id, name: office.name }));
    const own = offices.find((office) => office.id === choice.defaultOfficeId);
    const office: ConvertOffice = choice.emptyMessage
      ? { kind: "none", message: choice.emptyMessage }
      : own
        ? {
            kind: "preselected",
            officeId: own.id,
            officeName: own.name,
            others: offices.length > 1 ? offices : [],
          }
        : { kind: "choose", offices };
    const reasons: ReasonOption[] = OFFER_REJECTION_REASON_KEYS.map((key) => ({
      key,
      label: offerRejectionReasonLabel(key),
    }));
    actions = (
      <OfferActions
        orderId={order.id}
        rowVersion={order.rowVersion}
        office={office}
        canExtend={canExtendOffer(displayStatus, daysLeft, OFFER_EXPIRING_SOON_DAYS)}
        hasDuplicates={duplicates.items.length > 0}
        reasons={reasons}
        convertAction={convertOfferAction}
        extendAction={extendOfferAction}
        rejectAction={rejectOfferAction}
      />
    );
  }

  const assignmentLink =
    order.assignmentId && order.assignmentNumber && !order.assignmentCancelled
      ? { id: order.assignmentId, number: order.assignmentNumber }
      : null;

  const details = (
    <>
      <PossibleDuplicatesNotice items={duplicates.items} hasMore={duplicates.hasMore} />
      <Card>
        <h2 className="sr-only">Tilbudet</h2>
        <dl>
          <Detail label="Adresse">{order.addressText}</Detail>
          <Detail label="Matrikkel">{cadastreText(order) ?? EMPTY}</Detail>
          <Detail label="Hvem bestilte">
            {order.orderedByText || EMPTY}
            {order.orderedByContactId && (
              <Link
                href={`/kontakter/${order.orderedByContactId}`}
                className="mt-1 flex min-h-11 w-fit items-center font-medium text-brand-700 underline"
              >
                Kontakt i registeret
              </Link>
            )}
          </Detail>
          <Detail label="Meglerens ordrenummer">{order.externalRef || EMPTY}</Detail>
          <Detail label="Borettslag eller sameie">{order.housingAssociationName || EMPTY}</Detail>
          <Detail label="Mottatt">{formatOsloDateTime(order.receivedAt)}</Detail>
          <Detail label="Gyldig til">{formatIsoDate(order.validUntil)}</Detail>
          <Detail label="Egenerklæring mottatt">
            {order.sellerDeclarationReceived ? "Ja" : "Nei"}
          </Detail>
        </dl>
      </Card>
    </>
  );

  return (
    <main className="max-w-2xl">
      <Link
        href="/tilbud"
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        Tilbud
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-2xl font-semibold text-slate-900 [overflow-wrap:anywhere]">
          {order.addressText}
        </h1>
        <OfferStatusBadge
          displayStatus={displayStatus}
          validUntil={order.validUntil}
          expiryText={expiryText}
        />
      </div>
      {displayStatus === "open" && (
        <p className="mt-1 text-sm text-slate-600">Gyldig til {formatIsoDate(order.validUntil)}</p>
      )}
      <div className="mb-6" />

      <CreatedNotice
        show={ny === "1"}
        message={`Tilbudet er laget. Gyldig til ${formatIsoDate(order.validUntil)}.`}
      />

      {order.status === "converted" && order.assignmentNumber && (
        <Card className="mb-6">
          {assignmentLink ? (
            <Link
              href={`/oppdrag/${assignmentLink.id}`}
              className="inline-flex min-h-11 items-center text-lg font-medium text-brand-700 underline"
            >
              Gjort om til oppdrag&nbsp;
              <span className="tabular-nums">{assignmentLink.number}</span>
            </Link>
          ) : (
            // Kansellert oppdrag har ingen side lenger, så ingen lenke (T-0031).
            <p className="text-lg font-medium text-slate-900">
              Gjort om til oppdrag <span className="tabular-nums">{order.assignmentNumber}</span>
              {order.assignmentCancelled && " (kansellert)"}
            </p>
          )}
        </Card>
      )}
      {order.status === "rejected" && (
        <RejectedCard orderId={order.id}>
          <p className="text-lg font-medium text-slate-900">
            Avslått: {offerRejectionReasonLabel(order.rejectedReasonKey ?? "other")}
          </p>
          {order.rejectedReason && (
            <p className="mt-1 break-words whitespace-pre-line text-slate-700">
              {order.rejectedReason}
            </p>
          )}
        </RejectedCard>
      )}

      {context.canEditOrders ? (
        <OfferEditSection
          orderId={order.id}
          rowVersion={order.rowVersion}
          converted={order.status === "converted"}
          assignmentLink={assignmentLink}
          validUntil={
            handleable
              ? {
                  defaultValue: order.validUntil,
                  min: today,
                  max: addDays(today, OFFER_VALID_UNTIL_MAX_DAYS),
                }
              : null
          }
          action={updateOfferAction}
          actions={actions}
          defaults={{
            addressText: order.addressText,
            receivedAt: osloDateTimeLocal(new Date(order.receivedAt)),
            externalRef: order.externalRef ?? "",
            orderedByText: order.orderedByText ?? "",
            orderedByContact: order.orderedByContactId
              ? { id: order.orderedByContactId, name: linkedContactName ?? "(fjernet kontakt)" }
              : null,
            gnr: order.gnr ?? "",
            bnr: order.bnr ?? "",
            snr: order.snr ?? "",
            housingAssociationName: order.housingAssociationName ?? "",
            sellerDeclarationReceived: order.sellerDeclarationReceived,
          }}
        >
          {details}
        </OfferEditSection>
      ) : (
        details
      )}

      <OfferHistory entries={history} />
    </main>
  );
}
