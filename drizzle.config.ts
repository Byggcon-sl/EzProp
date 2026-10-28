import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Kjernens tabeller + hver moduls egne tabeller
  schema: ["./src/db/schema/index.ts", "./src/modules/*/schema.ts"],
  out: "./src/db/migrations",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
