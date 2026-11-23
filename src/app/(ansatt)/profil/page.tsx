import type { Metadata } from "next";
import { listOwnSessions } from "@/core/auth/sessions-list";
import { requireActor } from "@/core/auth/session";
import { Card } from "@/shared/ui/card";
import { sessionCreatedLabel, sessionLastUsedLabel } from "../oslo-format";
import { revokeOtherOwnSessionsAction, revokeOwnSessionAction } from "./actions";
import { SessionsList, type SessionRowView } from "./sessions-list";

export const metadata: Metadata = { title: "Profil" };

/*
 * Profilen til den innloggede (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 5): navn og
 * e-post som tekst, og «Mine innlogginger». Kjernen gir bare egne aktive økter; her formateres
 * tidene i norsk tid, og bare id, enhet, nettleser og tidstekst sendes til klienten.
 * Støtter hovedmål: de ansatte.
 */
export default async function ProfilePage() {
  const actor = await requireActor();
  const sessions = await listOwnSessions(actor);
  const now = new Date();
  const rows: SessionRowView[] = sessions.map((session) => ({
    id: session.id,
    device: session.device,
    browser: session.browser,
    lastUsedLabel: sessionLastUsedLabel(session.lastUsed, now, session.isCurrent),
    createdLabel: sessionCreatedLabel(session.createdAt, now),
    isCurrent: session.isCurrent,
  }));

  return (
    <main className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Profil</h1>
      <div className="mt-6 space-y-6">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Om deg</h2>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="text-sm text-slate-600">Navn</dt>
              <dd className="break-words text-slate-900">{actor.name.trim() || "Ikke oppgitt"}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">E-post</dt>
              <dd className="break-all text-slate-900">{actor.email}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <section aria-labelledby="mine-innlogginger" className="space-y-3">
            <h2 id="mine-innlogginger" className="text-lg font-semibold text-slate-900">
              Mine innlogginger
            </h2>
            <p className="text-sm text-slate-600">
              Enhetene du er logget inn på. Kjenner du ikke igjen en enhet, logg den ut.
            </p>
            <SessionsList
              sessions={rows}
              revokeOne={revokeOwnSessionAction}
              revokeOthers={revokeOtherOwnSessionsAction}
            />
          </section>
        </Card>
      </div>
    </main>
  );
}
