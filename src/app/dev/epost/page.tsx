import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readDevMailbox } from "@/core/email";
import { getEnv } from "@/shared/config/env";
import { Card } from "@/shared/ui/card";

export const metadata: Metadata = { title: "Utviklings-postkasse" };
export const dynamic = "force-dynamic";

/** Viser e-poster som ville blitt sendt. Kun tilgjengelig når DEV_MAILBOX=1 (aldri i produksjon). */
export default function DevMailboxPage() {
  if (!getEnv().DEV_MAILBOX) notFound();
  const emails = readDevMailbox();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Utviklings-postkasse</h1>
      <p className="mt-1 mb-6 text-slate-600">
        E-poster sendes ikke på ekte i utvikling. De havner her i stedet. Nyeste øverst.
      </p>
      {emails.length === 0 ? (
        <Card>
          <p>Ingen e-poster ennå. Be om en innloggingskode, så dukker den opp her.</p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {emails.map((email) => (
            <li key={email.id} data-testid="dev-email">
              <Card>
                <p className="text-sm break-all text-slate-600">
                  Til: <span data-testid="dev-email-to">{email.to}</span> ·{" "}
                  {email.sentAt.toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })}
                </p>
                <p className="mt-1 font-medium text-slate-900" data-testid="dev-email-subject">
                  {email.subject}
                </p>
                <pre className="mt-3 border-t border-slate-100 pt-3 font-sans text-sm whitespace-pre-wrap text-slate-700">
                  {email.text}
                </pre>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
