"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { brand } from "@/shared/config/brand";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { logOutThisDevice } from "../log-out-button";
import type { SessionActionState } from "./actions";

/*
 * Delen «Mine innlogginger» på /profil (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 3 og 5).
 * Radene er ferdig formatert på serveren og har bare id, enhet, nettleser og tidstekst; token, IP
 * og rå user-agent kommer aldri hit. «Logg ut» på andre enheter er ett trykk uten bekreftelse;
 * «Logg ut her» er vanlig utlogging, som også tømmer KI-køen på enheten.
 * Støtter hovedmål: de ansatte (oppdager en ukjent innlogging og stenger den med ett trykk).
 */

/** Én innlogging slik listen viser den. */
export type SessionRowView = {
  id: string;
  device: string;
  browser: string;
  /** «Aktiv nå», «Aktiv i dag», «Aktiv i går» eller «Aktiv 12. nov.». */
  lastUsedLabel: string;
  /** «logget inn 3. nov.». */
  createdLabel: string;
  isCurrent: boolean;
};

type RevokeOne = (
  previous: SessionActionState | undefined,
  formData: FormData,
) => Promise<SessionActionState>;
type RevokeOthers = (previous?: SessionActionState) => Promise<SessionActionState>;

export const OFFLINE_SESSION_MESSAGE = "Du er uten nett. Prøv igjen når du har dekning.";
const UNKNOWN_CLIENT_ERROR = "Noe gikk galt. Ingen enhet er logget ut. Prøv igjen.";

/** Det nettleseren på denne enheten selv vet. Leses bare lokalt og sendes aldri. */
export type LocalEnvironment = {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
};

/**
 * Enhet og nettleser for raden (forbedreren F3). Bare «denne enheten» endres: en iPad melder seg
 * som Macintosh i Safari, men har berøringsskjerm; fra hjemskjermen vises appnavnet i stedet for
 * nettleseren. Andre rader vises som serveren leste dem.
 */
export function localDeviceView(
  row: Pick<SessionRowView, "device" | "browser" | "isCurrent">,
  local: LocalEnvironment | null,
): { device: string; browser: string } {
  if (!row.isCurrent || !local) return { device: row.device, browser: row.browser };
  const device =
    local.userAgent.includes("Macintosh") && local.maxTouchPoints > 1 ? "iPad" : row.device;
  const browser = local.standalone ? `${brand.productName}-appen` : row.browser;
  return { device, browser };
}

/** Lest én gang per sidevisning; verdiene endres ikke mens siden er åpen. */
let localEnvironment: LocalEnvironment | null = null;

function readLocalEnvironment(): LocalEnvironment {
  localEnvironment ??= {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone:
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches,
  };
  return localEnvironment;
}

const subscribeNever = () => () => {};

/** Det nettleseren vet om seg selv; `null` på serveren og ved første visning (ingen avvik). */
function useLocalEnvironment(): LocalEnvironment | null {
  return useSyncExternalStore(subscribeNever, readLocalEnvironment, () => null);
}

type Message = { kind: "status" | "alert"; text: string; signedOut?: boolean; attempt: number };

/** Kvittering (`role=status`) eller feil (`role=alert`). Får fokus ved hvert nytt svar. */
function SessionMessage({ message }: { message: Message | null }) {
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
            href="/logg-inn?neste=%2Fprofil"
            className="inline-flex min-h-11 items-center font-medium underline"
          >
            Logg inn
          </Link>
        </>
      )}
    </p>
  );
}

export function SessionsList({
  sessions,
  revokeOne,
  revokeOthers,
}: {
  sessions: readonly SessionRowView[];
  revokeOne: RevokeOne;
  revokeOthers: RevokeOthers;
}) {
  const router = useRouter();
  const local = useLocalEnvironment();
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, startTransition] = useTransition();
  const attempt = useRef(0);
  const hasOthers = sessions.some((row) => !row.isCurrent);

  function show(kind: Message["kind"], text: string, signedOut?: boolean) {
    attempt.current += 1;
    setMessage({ kind, text, signedOut, attempt: attempt.current });
  }

  function failed(error: unknown) {
    const offline = !navigator.onLine || error instanceof TypeError;
    show("alert", offline ? OFFLINE_SESSION_MESSAGE : UNKNOWN_CLIENT_ERROR);
  }

  function showResult(result: SessionActionState) {
    if (!result.message) return;
    show(result.status === "done" ? "status" : "alert", result.message, result.signedOut);
  }

  /** Kjør en serverhandling. Uten nett sendes ingenting, og raden står. */
  function run(action: () => Promise<SessionActionState>) {
    if (!navigator.onLine) {
      show("alert", OFFLINE_SESSION_MESSAGE);
      return;
    }
    startTransition(async () => {
      try {
        showResult(await action());
      } catch (error) {
        failed(error);
      }
    });
  }

  function revoke(sessionId: string) {
    const formData = new FormData();
    formData.set("sessionId", sessionId);
    run(() => revokeOne(undefined, formData));
  }

  function logOutHere() {
    if (!navigator.onLine) {
      show("alert", OFFLINE_SESSION_MESSAGE);
      return;
    }
    startTransition(async () => {
      try {
        // Samme utlogging som knappen i toppen: KI-køen på enheten tømmes også.
        const { failed: signOutFailed } = await logOutThisDevice();
        if (signOutFailed) {
          failed(null);
          return;
        }
        router.replace("/logg-inn");
        router.refresh();
      } catch (error) {
        failed(error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <SessionMessage message={message} />
      {sessions.length === 0 ? (
        <p className="text-slate-600">Ingen aktive innlogginger.</p>
      ) : (
        <ul aria-label="Enheter du er logget inn på" className="divide-y divide-slate-200">
          {sessions.map((row) => {
            const { device, browser } = localDeviceView(row, local);
            const name = `${device}, ${browser}`;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0 flex-1 break-words">
                  {row.isCurrent && (
                    <p className="mb-1">
                      <Badge tone="brand">Denne enheten</Badge>
                    </p>
                  )}
                  <p className="text-slate-700">
                    <span className="font-medium text-slate-900">
                      {device} · {browser}
                    </span>
                    {` · ${row.lastUsedLabel} · ${row.createdLabel}`}
                  </p>
                </div>
                {row.isCurrent ? (
                  <Button variant="secondary" disabled={pending} onClick={logOutHere}>
                    Logg ut her
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={pending} onClick={() => revoke(row.id)}>
                    Logg ut<span className="sr-only">{` ${name}`}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hasOthers && (
        <Button variant="primary" disabled={pending} onClick={() => run(() => revokeOthers())}>
          Logg ut av alle andre enheter
        </Button>
      )}
    </div>
  );
}
