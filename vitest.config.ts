import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
      "eslint-rules/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    globalSetup: ["./tests/global-setup.ts"],
    // Sperren mot ekte KI-kall gjelder alle testfiler (fase2a-ki-leverandor Omfang 11).
    setupFiles: ["./tests/setup-env.ts", "./tests/block-external-fetch.ts"],
    // Integrasjonstestene deler én testdatabase og tømmer den mellom testene.
    fileParallelism: false,
  },
});
