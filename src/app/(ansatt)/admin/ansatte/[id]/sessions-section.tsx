"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type SyntheticEvent,
} from "react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/form";
import { logOutThisDevice } from "../../../log-out-button";
import { EmployeeCard } from "../employee-forms";
import {
  CONFIRM_SELF_FIELD,
  CONFIRM_SELF_VALUE,
  type EmployeeSessionsActionState,
} from "./sessions-state";

/*
 * Delen «Innlogginger» på /admin/ansatte/[id] (docs/funksjoner/fase2a-mine-innlogginger.md
 * Omfang 6). Bare enhet og nettleser per rad og antallet: ingen «sist brukt», ingen dato og ingen
 * økt-id (spørsmål 89, A428). «Logg ut av alle enheter» krever bekreftelse i en dialog; er det
 * admin selv, må et eget felt krysses av (serveren krever det også), og admin logges ut her etterpå.
 * Ingen tilgangslogikk her: siden vises bare for admin, og kjernen sjekker rettigheten.
 * Støtter hovedmål: de ansatte (en som slutter eller mister iPaden, stenges ute med to trykk).
 */

/** Én innlogging slik admin ser den. */
export type EmployeeSessionView = { device: string; browser: string };

type RevokeAll = (
  previous: EmployeeSessionsActionState | undefined,
  formData: FormData,
) => Promise<EmployeeSessionsActionState>;

export const OFFLINE_REVOKE_MESSAGE = "Du er uten nett. Prøv igjen når du har dekning.";
const UNKNOWN_CLIENT_ERROR = "Noe gikk galt. Ingen enheter er logget ut. Prøv igjen.";

/** «Ingen aktive innlogginger.», «1 aktiv innlogging», «3 aktive innlogginger». */
export function activeSessionsLabel(count: number): string {
  if (count === 0) return "Ingen aktive innlogginger.";
  return count === 1 ? "1 aktiv innlogging" : `${count} aktive innlogginger`;
}

type Message = { kind: "status" | "alert"; text: string; signedOut?: boolean; attempt: number };

/** Kvittering (`role=status`) eller feil (`role=alert`). Får fokus ved hvert nytt svar. */
function SectionMessage({ message, loginHref }: { message: Message | null; loginHref: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const attempt = message?.attempt ?? 0;
  useEffect(() => {
    if (attempt > 0) ref.current?.focus();
  }, [attempt]);
  if (!message) return null;
  const tone =
    message.kind === "status" ? "bg-sand text-slate-900" : "bg-urgent-fill text-urgent-text";
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role={message.kind}
      className={`rounded-xl px-4 py-3 text-sm ${tone}`}
    >
      {message.text}
      {message.signedOut && (
        <>
          {" "}
          <Link
            href={loginHref}
            className="inline-flex min-h-11 items-center font-medium underline"
          >
            Logg inn
          </Link>
        </>
      )}
    </p>
  );
}

export function SessionsSection({
  employeeName,
  sessions,
  isSelf,
  revokeAll,
}: {
  employeeName: string;
  sessions: readonly EmployeeSessionView[];
  /** Om siden gjelder admin selv (avgjort på serveren). */
  isSelf: boolean;
  revokeAll: RevokeAll;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const titleId = useId();
  const textId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmSelfRef = useRef<HTMLInputElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, startTransition] = useTransition();
  const attempt = useRef(0);
  const count = sessions.length;

  function show(kind: Message["kind"], text: string, signedOut?: boolean) {
    attempt.current += 1;
    setMessage({ kind, text, signedOut, attempt: attempt.current });
  }

  /**
   * Åpner dialogen (`showModal`: resten av siden er utilgjengelig, og fokus holdes i dialogen).
   * Fokus starter på det minst farlige valget: avkryssingsfeltet for admin selv, ellers «Avbryt».
   */
  function openDialog() {
    setConfirmed(false);
    dialogRef.current?.showModal();
    (isSelf ? confirmSelfRef.current : cancelRef.current)?.focus();
  }

  /** Lukker uten å gjøre noe (Avbryt eller Esc). Fokus tilbake til knappen som åpnet. */
  function cancel() {
    if (pending) return;
    dialogRef.current?.close();
    setConfirmed(false);
    openerRef.current?.focus();
  }

  function onCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Esc: samme som Avbryt, men ikke mens forespørselen går
    event.preventDefault();
    cancel();
  }

  function closeAfterAnswer() {
    dialogRef.current?.close();
    setConfirmed(false);
  }

  /**
   * Admin har logget ut seg selv: økten er alt slettet på serveren. Vanlig utlogging her tømmer
   * KI-køen og informasjonskapselen (`logOutAndClear` via `logOutThisDevice`). Feiler den, er økten
   * likevel ugyldig, så admin sendes uansett til innloggingssiden.
   */
  async function logOutHere() {
    try {
      await logOutThisDevice();
    } catch {
      // Bevisst tom: økten er slettet på serveren, og eiersjekken i KI-køen rydder ved neste lesing.
    }
    router.replace("/logg-inn");
    router.refresh();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSelf && !confirmed) return;
    const formData = new FormData(event.currentTarget);
    if (!navigator.onLine) {
      closeAfterAnswer();
      show("alert", OFFLINE_REVOKE_MESSAGE);
      return;
    }
    startTransition(async () => {
      let result: EmployeeSessionsActionState;
      try {
        result = await revokeAll(undefined, formData);
      } catch (error) {
        closeAfterAnswer();
        const offline = !navigator.onLine || error instanceof TypeError;
        show("alert", offline ? OFFLINE_REVOKE_MESSAGE : UNKNOWN_CLIENT_ERROR);
        return;
      }
      closeAfterAnswer();
      if (result.message) {
        show(result.status === "done" ? "status" : "alert", result.message, result.signedOut);
      }
      if (result.status === "done" && result.isSelf) await logOutHere();
    });
  }

  return (
    <EmployeeCard title="Innlogginger">
      <p className="text-sm text-slate-600">
        Enhetene personen er logget inn på. Data som ligger lagret på en iPad, blir liggende selv om
        enheten logges ut.
      </p>
      <SectionMessage
        message={message}
        loginHref={`/logg-inn?neste=${encodeURIComponent(pathname)}`}
      />
      <p className="font-medium text-slate-900" data-testid="active-sessions-count">
        {activeSessionsLabel(count)}
      </p>
      {count > 0 && (
        <ul aria-label="Enheter personen er logget inn på" className="divide-y divide-slate-200">
          {sessions.map((row, index) => (
            <li key={index} className="py-2.5 break-words text-slate-700 first:pt-0">
              {row.device} · {row.browser}
            </li>
          ))}
        </ul>
      )}
      {count > 0 && (
        <Button ref={openerRef} variant="secondary" disabled={pending} onClick={openDialog}>
          Logg ut av alle enheter
        </Button>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={textId}
        data-testid="revoke-all-dialog"
        onCancel={onCancel}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] max-w-none rounded-xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-night/40"
      >
        <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
          <h2 id={titleId} className="text-lg font-semibold break-words">
            Logg ut {employeeName} fra alle enheter?
          </h2>
          <p id={textId} className="text-slate-700">
            Hen må logge inn på nytt med kode eller Microsoft. Data som ligger lagret på iPaden
            slettes ikke. Har hen sluttet, sett også hen til «Har sluttet», ellers kan hen logge inn
            igjen.
          </p>
          {isSelf && (
            <div className="space-y-1 rounded-xl bg-watch-fill px-4 py-3 text-watch-text">
              <p className="font-semibold">Du blir også logget ut her.</p>
              <Checkbox
                name={CONFIRM_SELF_FIELD}
                value={CONFIRM_SELF_VALUE}
                label="Jeg forstår at jeg også blir logget ut her"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
                ref={confirmSelfRef}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            <Button type="submit" variant="primary" disabled={pending || (isSelf && !confirmed)}>
              {pending ? "Logger ut …" : "Logg ut av alle enheter"}
            </Button>
            <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={cancel}>
              Avbryt
            </Button>
          </div>
        </form>
      </dialog>
    </EmployeeCard>
  );
}
