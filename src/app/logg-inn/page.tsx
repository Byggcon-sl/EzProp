import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/core/auth/session";
import { brand } from "@/shared/config/brand";
import { Card } from "@/shared/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Logg inn" };

export default async function LoginPage() {
  if (await getCurrentActor()) redirect("/arbeidskoe");
  return (
    <main className="flex min-h-[calc(100dvh-4px)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-2xl font-semibold text-brand-700">
          {brand.productName}
        </p>
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900">Logg inn</h1>
          <p className="mt-2 text-slate-600">
            Skriv inn e-postadressen din. Vi sender deg en kode. Du trenger ikke passord.
          </p>
          <div className="mt-6">
            <LoginForm />
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
