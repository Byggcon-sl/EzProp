import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Innlogging fra nettleseren. */
export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
});
