/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Zod-skjema for endringsbunten fra enheten (`POST /api/prove/synk/endringer`). Grensene står i
 * `TRIAL_SYNC_LIMITS`. Ren fil: ingen database, ingen DOM, så den kan testes og importeres overalt.
 * Ukjente kolonner i `data` slippes gjennom her; `applyTrialChanges` bruker bare dem den kjenner.
 */
import { z } from "zod";
import { isUuid } from "@/shared/lib/uuid";
import { TRIAL_CHANGE_TABLES, TRIAL_SYNC_LIMITS } from "./types";

const encoder = new TextEncoder();

/** Størrelsen i byte (UTF-8). `value` som ikke er tekst, måles som JSON. */
function byteSize(value: unknown): number {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return encoder.encode(text).length;
}

const changeDataSchema = z.record(z.string(), z.unknown()).superRefine((data, ctx) => {
  if (data.value !== undefined && byteSize(data.value) > TRIAL_SYNC_LIMITS.maxValueBytes) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "value er for stor" });
  }
  const textState = data.text_state;
  if (textState !== undefined && textState !== null) {
    if (typeof textState !== "string") {
      ctx.addIssue({ code: "custom", path: ["text_state"], message: "text_state må være tekst" });
    } else if (byteSize(textState) > TRIAL_SYNC_LIMITS.maxTextStateBytes) {
      ctx.addIssue({ code: "custom", path: ["text_state"], message: "text_state er for stor" });
    }
  }
  const deviceId = data.device_id;
  if (deviceId !== undefined && deviceId !== null) {
    if (typeof deviceId !== "string" || deviceId.length > TRIAL_SYNC_LIMITS.maxDeviceIdLength) {
      ctx.addIssue({ code: "custom", path: ["device_id"], message: "device_id er ugyldig" });
    }
  }
});

export const trialChangeOperationSchema = z.object({
  op: z.enum(["PUT", "PATCH"]),
  table: z.enum(TRIAL_CHANGE_TABLES),
  id: z.string().refine(isUuid, "id må være en uuid"),
  data: changeDataSchema,
});

export const trialChangeOperationsSchema = z
  .array(trialChangeOperationSchema)
  .max(TRIAL_SYNC_LIMITS.maxOperationsPerBatch);

/** Hele kroppen. `organizationId` brukes bare til tilgangssjekken, aldri i spørringene. */
export const trialChangesRequestSchema = z.object({
  organizationId: z.string(),
  operations: trialChangeOperationsSchema,
});

export type ParsedTrialChangeOperation = z.infer<typeof trialChangeOperationSchema>;
