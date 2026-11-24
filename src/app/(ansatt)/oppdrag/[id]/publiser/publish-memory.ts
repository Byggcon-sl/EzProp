import type { PublishFindingView } from "@/core/reports/publish-types";
import type { OverrideState } from "./publish-model";

/*
 * Kladdene på publiser-siden mens den ansatte er på rommet etter «Gå til» (F3, design avsnitt 10
 * og 14). Bare i minnet i fanen (modulens variabel), aldri i localStorage, IndexedDB eller på
 * serveren: lukkes fanen eller lastes siden på nytt, er kladdene borte. Ingenting av dette lagres
 * før «Publiser».
 * Støtter hovedmål: de ansatte (valgt grunn og påbegynt tekst går ikke tapt ved «Gå til»).
 */

export type PublishMemory = {
  findings: PublishFindingView[];
  overrides: Map<string, OverrideState>;
  /** Funnet den ansatte gikk fra med «Gå til». */
  fromKey: string | null;
};

const memory = new Map<string, PublishMemory>();

export function rememberPublishPage(assignmentId: string, value: PublishMemory): void {
  memory.set(assignmentId, value);
}

/** Kladdene for oppdraget, uten å glemme dem (trygt å kalle to ganger ved første visning). */
export function peekPublishPage(assignmentId: string): PublishMemory | null {
  return memory.get(assignmentId) ?? null;
}

/** Glemmer kladdene for oppdraget når siden har tatt dem i bruk. */
export function forgetPublishPage(assignmentId: string): void {
  memory.delete(assignmentId);
}

/** Om den ansatte kom til rommet fra publiser-siden og har kladder der. */
export function hasPublishMemory(assignmentId: string): boolean {
  return memory.has(assignmentId);
}
