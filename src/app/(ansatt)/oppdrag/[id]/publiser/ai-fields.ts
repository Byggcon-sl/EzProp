import "server-only";
import type { Actor } from "@/core/access";
import { getRoomView } from "@/core/reports";
import type { PublishCheckView } from "@/core/reports/publish-types";
import { aiFieldTarget } from "./ai-target";

/*
 * Feltnavn og teksten som står i feltet nå for hvert KI-forslag som venter (F4). Leses med
 * `getRoomView` (samme tilgang og kjede som rommet), ett kall per rom med forslag. Bare for
 * serveren: siden og handlingen for oppdatert liste bruker den.
 */

export type AiFieldInfo = { label: string; currentText: string };

export async function aiFieldsOf(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  check: PublishCheckView,
): Promise<Record<string, AiFieldInfo>> {
  if (check.state !== "draft" || check.pendingAiSuggestions.length === 0) return {};
  const roomIds = [
    ...new Set(
      check.pendingAiSuggestions.flatMap((s) => (s.target.roomId ? [s.target.roomId] : [])),
    ),
  ];
  const views = new Map(
    await Promise.all(
      roomIds.map(
        async (roomId) =>
          [roomId, await getRoomView(actor, organizationId, { assignmentId, roomId })] as const,
      ),
    ),
  );
  const result: Record<string, AiFieldInfo> = {};
  for (const suggestion of check.pendingAiSuggestions) {
    const view = suggestion.target.roomId ? views.get(suggestion.target.roomId) : undefined;
    if (!view || view.state !== "started") continue;
    const target = aiFieldTarget(view, suggestion.field);
    if (target) {
      result[suggestion.aiUsageId] = { label: target.label, currentText: target.currentText };
    }
  }
  return result;
}
