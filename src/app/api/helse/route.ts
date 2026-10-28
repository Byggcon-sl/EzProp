import { checkHealth } from "@/core/health";

/** Helsesjekk for hosting og overvåking. Åpen, uten innlogging. */
export const dynamic = "force-dynamic";

export async function GET() {
  const { httpStatus, body } = await checkHealth();
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
