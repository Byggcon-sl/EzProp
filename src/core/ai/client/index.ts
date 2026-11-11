/*
 * Klientdelen av KI-modulen: KI-køen uten nett (docs/adr/0006-ki-i-bunnen.md del 10).
 * Egen inngang, `@/core/ai/client`. `src/core/ai/index.ts` eksporterer aldri denne mappen, og
 * denne mappen laster aldri servermodulene. Til «Sperring av iPader» er levert (fase 2b), kan
 * bare prøvesiden `/prove/ki` og utloggingsknappen importere herfra (lint-regelen
 * `ezprop/module-boundaries`).
 */

export { AI_QUEUE_ALLOWED_FIELDS } from "./allowed-fields";
export { AiQueueUnavailableError } from "./errors";
export { createMemoryAiQueueStore } from "./memory-store";
export type { MemoryAiQueueStore, MemoryAiQueueStoreOptions } from "./memory-store";
export { AI_QUEUE_GAVE_UP_MESSAGE, AI_QUEUE_REJECT_MESSAGES } from "./messages";
export { classifyQueueOutcome } from "./outcome";
export { clearAiQueue, createAiQueue } from "./queue";
export { createIndexedDbAiQueueStore } from "./queue-store";
export { aiQueueEntrySchema, parseAiQueueEntry } from "./schema";
export {
  AI_QUEUE_DB_NAME,
  AI_QUEUE_DB_VERSION,
  AI_QUEUE_MAX_AGE_MS,
  AI_QUEUE_MAX_ATTEMPTS,
  AI_QUEUE_MAX_ENTRIES,
  AI_QUEUE_SEND_TIMEOUT_MS,
  AI_QUEUE_STORE_NAME,
} from "./types";
export type {
  AiQueue,
  AiQueueDeps,
  AiQueueEnqueueInput,
  AiQueueEnqueueResult,
  AiQueueEntry,
  AiQueueEvent,
  AiQueueFailureReason,
  AiQueueListResult,
  AiQueueOutcome,
  AiQueueOwner,
  AiQueueRejectReason,
  AiQueueRunResult,
  AiQueueSend,
  AiQueueSendAttempt,
  AiQueueSendPayload,
  AiQueueSendResult,
  AiQueueStore,
  AiQueueStoreChange,
  AiQueueTarget,
  AiQueueUnavailableErrorShape,
  ClassifyQueueOutcome,
  ClearAiQueue,
  CreateAiQueue,
  CreateIndexedDbAiQueueStore,
  CreateMemoryAiQueueStore,
} from "./types";
