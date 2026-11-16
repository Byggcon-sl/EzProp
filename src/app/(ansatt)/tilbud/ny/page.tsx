import type { Metadata } from "next";
import Link from "next/link";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { createOrderAction } from "../actions";
import { osloDateTimeLocal } from "../received-at";
import { OrderForm } from "./order-form";

export const metadata: Metadata = { title: "Ny ordre" };

/** Ny ordre fra e-posten. «Lagre» går til ordresiden. Kjernen sjekker `assignment.edit`. */
export default async function NewOrderPage() {
  const context = await getEmployeeContext();
  if (!context || !context.canEditOrders) return <NoAccess />;

  return (
    <main className="max-w-2xl">
      <Link
        href="/ordre"
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        Tilbake til ordre
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-slate-900">Ny ordre</h1>
      <OrderForm action={createOrderAction} receivedAtDefault={osloDateTimeLocal(new Date())} />
    </main>
  );
}
