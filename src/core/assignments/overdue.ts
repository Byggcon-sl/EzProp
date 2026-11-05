import { todayInOslo } from "@/shared/lib/dates";
import type { AssignmentStatus } from "./codes";

/*
 * Merket «Forfalt» i arbeidskøen. Ren funksjon uten database, så den kan kjøre både på iPaden og
 * på serveren. Fristen er en ren dato; «i dag» regnes i norsk tid (Europe/Oslo).
 */

/**
 * Sann når fristen er før dagens dato i norsk tid og oppdraget fortsatt er Bestilt eller Under
 * arbeid. Frist i dag er ikke forfalt. Uten frist er oppdraget aldri forfalt.
 */
export function isOverdue(
  input: { dueDate: string | null; status: AssignmentStatus | string },
  now: Date,
): boolean {
  if (input.dueDate === null) return false;
  if (input.status !== "ordered" && input.status !== "in_progress") return false;
  // ÅÅÅÅ-MM-DD kan sammenlignes som tekst.
  return input.dueDate < todayInOslo(now);
}
