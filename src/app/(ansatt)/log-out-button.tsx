"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/core/auth/auth-client";
import { Button } from "@/shared/ui/button";
import { logOutAndClear } from "./log-out";

export function LogOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        // KI-køen hentes først ved utlogging, så fellesbunten ikke vokser (fase2a-ki-ko Omfang 6)
        await logOutAndClear({
          clearQueue: async () => (await import("@/core/ai/client")).clearAiQueue(),
          signOut: () => authClient.signOut(),
        });
        router.replace("/logg-inn");
        router.refresh();
      }}
    >
      Logg ut
    </Button>
  );
}
