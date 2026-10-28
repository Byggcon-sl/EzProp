"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/core/auth/auth-client";
import { Button } from "@/shared/ui/button";

export function LogOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/logg-inn");
        router.refresh();
      }}
    >
      Logg ut
    </Button>
  );
}
