import { installAiNetworkGuard } from "./ai-network-guard";
import { testDatabaseUrl } from "./test-env";

const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = testDatabaseUrl();
env.NODE_ENV = "test";
env.DEV_MAILBOX = "1";
env.BETTER_AUTH_SECRET ??= "test-secret-som-er-lang-nok-for-better-auth";

// Ingen nettkall til KI-leverandøren, og ingen nøkkel i miljøet (fase2a-ki-leverandor S2)
installAiNetworkGuard();
