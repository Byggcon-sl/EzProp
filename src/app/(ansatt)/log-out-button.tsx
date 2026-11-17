"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/core/auth/auth-client";
import { Button } from "@/shared/ui/button";
import { logOutAndClear } from "./log-out";

/**
 * Vanlig utlogging på denne enheten: tømmer KI-køen og logger ut. Brukes av knappen i toppen og
 * av «Logg ut her» i «Mine innlogginger» (profil/sessions-list.tsx). `failed` er satt når
 * innloggingen svarte med feil, slik at kalleren kan vise en melding i stedet for å gå videre.
 * Nettverksfeil kastes videre.
 */
export async function logOutThisDevice(): Promise<{ failed: boolean }> {
  let failed = false;
  // KI-køen hentes først ved utlogging, så fellesbunten ikke vokser (fase2a-ki-ko Omfang 6)
  await logOutAndClear({
    clearQueue: async () => (await import("@/core/ai/client")).clearAiQueue(),
    signOut: async () => {
      const result = await authClient.signOut();
      failed = Boolean(result?.error);
    },
  });
  return { failed };
}

export function LogOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await logOutThisDevice();
        router.replace("/logg-inn");
        router.refresh();
      }}
    >
      Logg ut
    </Button>
  );
}
