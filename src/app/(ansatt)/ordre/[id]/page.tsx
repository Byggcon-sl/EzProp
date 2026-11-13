import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AccessDeniedError } from "@/core/access";
import { getContact } from "@/core/contacts";
import { listOffices } from "@/core/organization";
import { findPossibleDuplicateOrders, getOrder, listOrderHistory } from "@/core/orders";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { Card } from "@/shared/ui/card";
import { Notice } from "@/shared/ui/notice";
import { getEmployeeContext } from "../../employee-context";
import { contactName } from "../../kontakter/contact-name";
import { NoAccess } from "../../no-access";
import { convertOrderAction, rejectOrderAction, updateOrderAction } from "../actions";
import { officeChoice } from "../office-choice";
import { OrderStatusBadge } from "../order-status-badge";
import { formatOsloDateTime, osloDateTimeLocal } from "../received-at";
import { ConvertOrderForm, RejectOrderForm } from "./order-actions";
import { OrderEditSection } from "./order-edit-form";
import { OrderHistory } from "./order-history";
import { PossibleDuplicatesNotice } from "./possible-duplicates-notice";

export const metadata: Metadata = { title: "Ordre" };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-slate-500">Ikke oppgitt</span>;

/**
 * Ordren med «Endre ordren» (alle statuser, T1) og «Gjør om til oppdrag» og «Avvis» når den er
 * mottatt, når den ansatte kan endre. Under ordren står «Endringer». Ugyldig, ukjent og fremmed id
 * gir samme svar som manglende tilgang. `?endret=1` viser kvitteringen etter «Lagre». Varselet
 * «Mulig dublett» står under kvitteringen når kjernen finner andre ordre på samme bolig.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { endret } = await searchParams;
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

  // Varselet «Mulig dublett» (T3) skal aldri gjøre ordresiden utilgjengelig: feiler oppslaget,
  // vises siden uten varsel. Loggen får bare ordre-id, bruker-id og feilnavnet, aldri adresse,
  // matrikkel eller feilteksten.
  let duplicates: Awaited<ReturnType<typeof findPossibleDuplicateOrders>> = {
    items: [],
    hasMore: false,
  };
  try {
    duplicates = await findPossibleDuplicateOrders(context.actor, context.organizationId, order.id);
  } catch (error) {
    logger.error("Kunne ikke sjekke mulig dublett", {
      route: "/ordre/[id]",
      orderId: order.id,
      userId: context.actor.id,
      errorName: error instanceof Error ? error.name : "ukjent feil",
    });
  }

  const canHandle = order.status === "received" && context.canEditOrders;
  const choice = canHandle
    ? officeChoice(await listOffices(context.actor, context.organizationId), context.officeId)
    : null;

  // «Gjør om» og «Avvis» skjules mens «Endre ordren» er åpent (bare én «Lagre» på siden).
  const handling = choice && (
    <div className="mt-6 space-y-6">
      <ConvertOrderForm
        orderId={order.id}
        offices={choice.offices.map((office) => ({ id: office.id, name: office.name }))}
        defaultOfficeId={choice.defaultOfficeId}
        emptyMessage={choice.emptyMessage}
        action={convertOrderAction}
      />
      <RejectOrderForm orderId={order.id} action={rejectOrderAction} />
    </div>
  );

  return (
    <main className="max-w-2xl">
      <Link
        href="/ordre"
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        Tilbake til ordre
      </Link>
      <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-2xl font-semibold break-words text-slate-900">
          {order.addressText}
        </h1>
        <OrderStatusBadge status={order.status} />
      </div>

      {endret === "1" && (
        <div className="mb-6">
          <Notice message="Endringene er lagret." />
        </div>
      )}

      <PossibleDuplicatesNotice items={duplicates.items} hasMore={duplicates.hasMore} />

      {order.status === "converted" && order.assignmentNumber && (
        <Card className="mb-6">
          {order.assignmentCancelled ? (
            // Kansellert oppdrag har ingen side lenger, så ingen lenke.
            <p className="text-lg font-medium text-slate-900">
              Gjort om til oppdrag <span className="tabular-nums">{order.assignmentNumber}</span>{" "}
              (kansellert)
            </p>
          ) : order.assignmentId ? (
            <Link
              href={`/oppdrag/${order.assignmentId}`}
              className="inline-flex min-h-11 items-center text-lg font-medium text-brand-700 underline"
            >
              Gjort om til oppdrag&nbsp;
              <span className="tabular-nums">{order.assignmentNumber}</span>
            </Link>
          ) : (
            <p className="text-lg font-medium text-slate-900">
              Gjort om til oppdrag <span className="tabular-nums">{order.assignmentNumber}</span>
            </p>
          )}
        </Card>
      )}
      {order.status === "rejected" && (
        <Card className="mb-6">
          <h2 className="text-sm text-slate-600">Grunn for avvisning</h2>
          <p className="mt-0.5 break-words whitespace-pre-line text-slate-900">
            {order.rejectedReason}
          </p>
        </Card>
      )}

      <Card>
        <dl>
          <Detail label="Adresse">{order.addressText}</Detail>
          <Detail label="Mottatt">{formatOsloDateTime(order.receivedAt)}</Detail>
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
          <Detail label="Ekstern referanse">{order.externalRef || EMPTY}</Detail>
          <Detail label="Gårdsnummer">{order.gnr || EMPTY}</Detail>
          <Detail label="Bruksnummer">{order.bnr || EMPTY}</Detail>
          <Detail label="Seksjonsnummer">{order.snr || EMPTY}</Detail>
          <Detail label="Borettslag eller sameie">{order.housingAssociationName || EMPTY}</Detail>
          <Detail label="Egenerklæring mottatt">
            {order.sellerDeclarationReceived ? "Ja" : "Nei"}
          </Detail>
        </dl>
      </Card>

      {context.canEditOrders ? (
        // Ny nøkkel etter lagring (versjonen øker), så skjemaet lukkes og viser den nye ordren.
        <OrderEditSection
          key={order.rowVersion}
          orderId={order.id}
          rowVersion={order.rowVersion}
          converted={order.status === "converted"}
          action={updateOrderAction}
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
          {handling}
        </OrderEditSection>
      ) : (
        handling
      )}

      <OrderHistory entries={history} />
    </main>
  );
}
