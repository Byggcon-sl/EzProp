import { recordConnectionResult } from "@/core/integrations/connections";
import { getEnv, type Env } from "@/shared/config/env";
import { devMailboxStore } from "./dev-mailbox";
import { resolveEmailSender, type ResolveEmailOptions } from "./resolve";
import type { Email, StoredEmail } from "./types";

/*
 * E-postporten i tilkoblingslaget (docs/funksjoner/fase0b-tilkoblingslag.md, Omfang 6). Tre
 * leverandører bak samme grensesnitt: utviklings-postkassen (lokalt), serverloggen (bare første
 * admin, før e-post er satt opp) og Microsoft 365 (Graph, som i Optiplan). Valget av leverandør
 * ligger i `resolve.ts` og eksporteres bevisst ikke herfra.
 */

export type { Email, EmailProvider, EmailSender, StoredEmail } from "./types";
export { createGraphEmailSender, EmailSendError } from "./graph";

/** Kort tekst om feilen til `last_error`. Vaskes og kortes ned der den lagres. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Ukjent feil ved sending av e-post.";
}

/**
 * Sender e-post med leverandøren som er valgt (se `resolve.ts`). Med `organizationId` (alltid
 * `grant.organizationId`) brukes organisasjonens e-posttilkobling hvis den finnes. Gikk sendingen
 * gjennom en tilkobling, oppdateres `last_ok_at`/`last_error`/`status` på raden (uten rad i
 * revisjonsloggen), og en feil kastes videre etterpå. `fetchFn` er bare for tester.
 */
export async function sendEmail(
  email: Email,
  options: ResolveEmailOptions = {},
  env: Env = getEnv(),
): Promise<void> {
  const { sender, connectionId } = await resolveEmailSender(options, env);
  const organizationId = options.organizationId;
  if (!connectionId || !organizationId) return sender.send(email);

  try {
    await sender.send(email);
  } catch (error) {
    await recordConnectionResult(organizationId, connectionId, {
      ok: false,
      error: describeError(error),
    });
    throw error;
  }
  await recordConnectionResult(organizationId, connectionId, { ok: true });
}

/** Siste e-poster i utviklings-postkassen. Tom liste når den er slått av. */
export function readDevMailbox(): StoredEmail[] {
  if (!getEnv().DEV_MAILBOX) return [];
  return [...devMailboxStore()];
}
