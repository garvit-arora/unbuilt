import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Integration tests talk to the local Supabase stack; its URL and keys live in .env.local (`npm run db:env`). */
function localEnv(): Record<string, string> {
  const file = `${root}.env.local`;
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    Object.entries(parseEnv(readFileSync(file, "utf8"))).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@/": `${root}src/`,
      // `server-only` throws outside a React Server Components bundle; tests run in plain Node.
      "server-only": `${root}tests/support/empty-module.ts`,
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: localEnv(),
        },
      },
    ],
  },
});
