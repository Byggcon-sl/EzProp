import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AccessDeniedError } from "@/core/access";
import { listOffices } from "@/core/organization";
import { getOrder, listOrderHistory } from "@/core/orders";
import { isUuid } from "@/shared/lib/uuid";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Notice } from "@/shared/ui/notice";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { convertOrderAction, rejectOrderAction, updateOrderAction } from "../actions";
import { officeChoice } from "../office-choice";
import { OrderStatusBadge } from "../order-status-badge";
import { formatOsloDateTime, osloDateTimeLocal } from "../received-at";
import { EditOrderForm } from "./edit-order-form";
import { ConvertOrderForm, RejectOrderForm } from "./order-actions";
import { OrderHistory } from "./order-history";

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
 * Ordren med «Gjør om til oppdrag» og «Avvis» når den er mottatt og den ansatte kan endre, og
 * «Rett ordren» i alle statuser (T1). `?rett=1` åpner skjemaet på samme side, `?rettet=1` gir
 * beskjeden etter lagring. Under ordren står «Endringer». Ugyldig, ukjent og fremmed id gir samme
 * svar som manglende tilgang.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rett?: string | string[]; rettet?: string | string[] }>;
}) {
  const { id } = await params;
  const context = await getEmployeeContext();
  if (!context || !isUuid(id)) return <NoAccess />;

  let order: Awaited<ReturnType<typeof getOrder>>;
  let history: Awaited<ReturnType<typeof listOrderHistory>>;
  try {
    [order, history] = await Promise.all([
      getOrder(context.actor, context.organizationId, id),
      listOrderHistory(context.actor, context.organizationId, id),
    ]);
  } catch (error) {
    if (error instanceof AccessDeniedError) return <NoAccess />;
    throw error;
  }

  const search = await searchParams;
  // Knappen og skjemaet vises bare for dem som kan endre; selve sjekken skjer i kjernen.
  const editing = search.rett === "1" && context.canEditOrders;
  const corrected = search.rettet === "1" && !editing;
  const canHandle = order.status === "received" && context.canEditOrders && !editing;
  const choice = canHandle
    ? officeChoice(await listOffices(context.actor, context.organizationId), context.officeId)
    : null;

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

      {corrected && (
        <div className="mb-6">
          <Notice message="Ordren er rettet." />
        </div>
      )}

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

      {editing ? (
        <EditOrderForm
          action={updateOrderAction}
          orderId={order.id}
          rowVersion={order.rowVersion}
          converted={order.status === "converted"}
          defaults={{
            addressText: order.addressText,
            receivedAt: osloDateTimeLocal(order.receivedAt),
            orderedByText: order.orderedByText ?? "",
            orderedByContact: order.orderedByContactId
              ? {
                  id: order.orderedByContactId,
                  name: order.orderedByText || "kontakten i registeret",
                }
              : null,
            externalRef: order.externalRef ?? "",
            gnr: order.gnr ?? "",
            bnr: order.bnr ?? "",
            snr: order.snr ?? "",
            housingAssociationName: order.housingAssociationName ?? "",
            sellerDeclarationReceived: order.sellerDeclarationReceived,
          }}
        />
      ) : (
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
          {context.canEditOrders && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <Link
                href={`/ordre/${order.id}?rett=1`}
                className={buttonVariants({ variant: "secondary", size: "md" })}
              >
                Rett ordren
              </Link>
            </div>
          )}
        </Card>
      )}

      {choice && (
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
      )}

      <OrderHistory entries={history} />
    </main>
  );
}
