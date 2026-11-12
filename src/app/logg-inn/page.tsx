import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isMicrosoftLoginEnabled } from "@/core/auth/microsoft-login";
import { getCurrentActor } from "@/core/auth/session";
import { brand } from "@/shared/config/brand";
import { Card } from "@/shared/ui/card";
import { LoginForm, type LoginFailure } from "./login-form";
import { safeNextPath } from "./safe-next-path";

/**
 * Feilkoder fra Better Auth som betyr at noe teknisk gikk galt i runden (utløpt eller avbrutt
 * innlogging, feil hos Microsoft), ikke at personen er avvist. Alt annet regnes som avvist (A215).
 */
const TECHNICAL_ERRORS = new Set([
  "state_mismatch",
  "state_not_found",
  "invalid_code",
  "no_code",
  "no_callback_url",
  "please_restart_the_process",
  "oauth_provider_not_found",
  "invalid_callback_request",
  "internal_server_error",
  "access_denied",
]);

function loginFailure(error: string | string[] | undefined): LoginFailure {
  if (error === undefined) return null;
  const code = Array.isArray(error) ? error[0] : error;
  return code !== undefined && TECHNICAL_ERRORS.has(code) ? "technical" : "rejected";
}

export const metadata: Metadata = { title: "Logg inn" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ neste?: string | string[]; error?: string | string[] }>;
}) {
  const { neste, error } = await searchParams;
  const next = safeNextPath(neste);
  if (await getCurrentActor()) redirect(next);
  // Bare en boolsk verdi går til siden (ADR 0008). Feilkoden fra Better Auth vises ikke (A215).
  const microsoft = isMicrosoftLoginEnabled();
  const failure = loginFailure(error);
  return (
    <main className="flex min-h-[calc(100dvh-4px)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-2xl font-semibold text-brand-700">
          {brand.productName}
        </p>
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900">Logg inn</h1>
          <p className="mt-2 text-slate-600">
            {microsoft
              ? `Bruk ${brand.companyName}-kontoen din i Microsoft. Du trenger ikke passord her.`
              : "Skriv inn e-postadressen din. Vi sender deg en kode. Du trenger ikke passord."}
          </p>
          <div className="mt-6">
            <LoginForm next={next} microsoft={microsoft} failure={failure} />
          </div>
        </Card>
        <p className="mt-6 text-center text-sm text-slate-600">
          Har du ikke tilgang? Kontakt {brand.companyName} på{" "}
          <a className="font-medium text-brand-700 underline" href={`mailto:${brand.supportEmail}`}>
            {brand.supportEmail}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
